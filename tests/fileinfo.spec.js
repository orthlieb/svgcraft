import fs from 'node:fs';
import { test, expect, load, menu, select } from './fixtures.js';

// File → File Info…: the document's title, author, licence and so on, kept
// in history and saved as SVG <title>, <desc> and Inkscape-style RDF
// <metadata>.

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DC = 'http://purl.org/dc/elements/1.1/';
const CC = 'http://creativecommons.org/ns#';
const XMPR = 'http://ns.adobe.com/xap/1.0/rights/';

const dlg = (page) => page.locator('#sc-fileinfo');
const field = (page, k) => page.locator(`#sc-fileinfo [data-meta="${k}"]`);
const meta = (page) => page.evaluate(() => window.svgcraft.state.meta);
const title = (page) => page.locator('#sc-doc-title');
// What each row of the Layers panel stands for.
const layerRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#sc-layers > li')].map((li) => li.layerEl?.localName),
  );

async function saveFile(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  return fs.readFileSync(await dl.path(), 'utf8');
}

// Fill the dialog (opened from the menu) and press OK.
async function fillInfo(page, values) {
  await menu(page, 'File', 'fileInfo');
  await expect(dlg(page)).toBeVisible();
  for (const [k, v] of Object.entries(values)) {
    const el = field(page, k);
    if (await el.evaluate((n) => n.localName === 'select')) await el.selectOption(v);
    else await el.fill(v);
  }
  await page.click('#sc-fileinfo [data-info="ok"]');
}

// Pull the File Info out of SVG text, the way another tool would: by
// namespace, not by prefix.
const readRdf = (page, svg) =>
  page.evaluate(
    ([svg, RDF, DC, CC, XMPR]) => {
      const x = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = x.documentElement;
      const work = x.getElementsByTagNameNS(CC, 'Work')[0];
      const kid = (ns, n) =>
        [...work.children].find((c) => c.namespaceURI === ns && c.localName === n);
      const txt = (ns, n) => kid(ns, n)?.textContent ?? null;
      const agent = (n) =>
        kid(DC, n)?.getElementsByTagNameNS(CC, 'Agent')[0]?.getElementsByTagNameNS(DC, 'title')[0]
          ?.textContent ?? null;
      const lic = x.getElementsByTagNameNS(CC, 'License')[0];
      return {
        parseError: !!x.querySelector('parsererror'),
        first: [...root.children].slice(0, 3).map((c) => c.localName),
        title: root.querySelector(':scope > title')?.textContent ?? null,
        desc: root.querySelector(':scope > desc')?.textContent ?? null,
        about: work.getAttributeNS(RDF, 'about'),
        format: txt(DC, 'format'),
        type: kid(DC, 'type')?.getAttributeNS(RDF, 'resource'),
        dcTitle: txt(DC, 'title'),
        creator: agent('creator'),
        rights: agent('rights'),
        date: txt(DC, 'date'),
        description: txt(DC, 'description'),
        keywords: [...(kid(DC, 'subject')?.getElementsByTagNameNS(RDF, 'li') || [])].map(
          (l) => l.textContent,
        ),
        source: txt(DC, 'source'),
        language: txt(DC, 'language'),
        marked: txt(XMPR, 'Marked'),
        usage: txt(XMPR, 'UsageTerms'),
        license: kid(CC, 'license')?.getAttributeNS(RDF, 'resource') ?? null,
        licAbout: lic?.getAttributeNS(RDF, 'about') ?? null,
        licTerms: lic
          ? [...lic.children].map((c) => `${c.localName}:${c.getAttributeNS(RDF, 'resource')}`)
          : [],
      };
    },
    [svg, RDF, DC, CC, XMPR],
  );

const FULL = {
  title: 'Harbour at dawn',
  creator: 'Ada Lovelace',
  description: 'Boats in the harbour.\nSecond line.',
  keywords: 'boats, harbour , dawn,,boats',
  date: '2026-10-01',
  marked: 'true',
  rights: '© 2026 Ada Lovelace',
  license: 'cc-by-sa',
  source: 'https://example.com/harbour',
  language: 'en-GB',
};

test('File Info opens from the menu and the shortcut, with focus on Title', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  await menu(page, 'File', 'fileInfo');
  await expect(dlg(page)).toBeVisible();
  await expect(field(page, 'title')).toBeFocused();
  // A fresh document's date defaults to today.
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await expect(field(page, 'date')).toHaveValue(today);
  await page.keyboard.press('Escape');
  await expect(dlg(page)).toBeHidden();

  await page.click('#sc-stage');
  await page.keyboard.press('Control+Alt+Shift+I');
  await expect(dlg(page)).toBeVisible();
  await expect(field(page, 'title')).toBeFocused();
  // Typing in the dialog doesn't reach the canvas's tool keys.
  await page.keyboard.type('Vb');
  await expect(field(page, 'title')).toHaveValue('Vb');
  await page.click('#sc-fileinfo [data-info="cancel"]');
  await expect(dlg(page)).toBeHidden();
  // Cancel and an untouched OK change nothing.
  expect(await meta(page)).toEqual({});
  await menu(page, 'File', 'fileInfo');
  await page.click('#sc-fileinfo [data-info="ok"]');
  expect(await meta(page)).toEqual({});
  await expect(title(page)).not.toHaveText(/\*/);
});

test('Save writes <title>, <desc> and Inkscape-style RDF metadata', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  await fillInfo(page, FULL);
  const svg = await saveFile(page);
  const r = await readRdf(page, svg);
  expect(r.parseError).toBe(false);
  expect(r.first).toEqual(['title', 'desc', 'metadata']);
  expect(r).toMatchObject({
    title: 'Harbour at dawn',
    desc: 'Boats in the harbour.\nSecond line.',
    about: '',
    format: 'image/svg+xml',
    type: 'http://purl.org/dc/dcmitype/StillImage',
    dcTitle: 'Harbour at dawn',
    creator: 'Ada Lovelace',
    rights: '© 2026 Ada Lovelace',
    date: '2026-10-01',
    description: 'Boats in the harbour.\nSecond line.',
    keywords: ['boats', 'harbour', 'dawn'],
    source: 'https://example.com/harbour',
    language: 'en-GB',
    marked: 'True',
    usage: null,
    license: 'https://creativecommons.org/licenses/by-sa/4.0/',
    licAbout: 'https://creativecommons.org/licenses/by-sa/4.0/',
  });
  expect(r.licTerms).toEqual([
    `permits:${CC}Reproduction`,
    `permits:${CC}Distribution`,
    `permits:${CC}DerivativeWorks`,
    `requires:${CC}Notice`,
    `requires:${CC}Attribution`,
    `requires:${CC}ShareAlike`,
  ]);
  // The drawing itself is untouched.
  expect(svg).toMatch(/<rect id="r"/);
  // The tab's tooltip names the drawing.
  await expect(page.locator('#sc-doctabs .sc-doctab[aria-selected="true"]')).toHaveAttribute(
    'data-tip',
    'Harbour at dawn · test.svg',
  );
});

test('reopening a saved file restores every field', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  await fillInfo(page, { ...FULL, license: 'custom', licenseUrl: 'https://example.org/licence' });
  const svg = await saveFile(page);
  await page.click('.sc-doctab-new');
  expect(await meta(page)).toEqual({});
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'again.svg'), svg);
  expect(await meta(page)).toEqual({
    title: 'Harbour at dawn',
    creator: 'Ada Lovelace',
    description: 'Boats in the harbour.\nSecond line.',
    keywords: ['boats', 'harbour', 'dawn'],
    date: '2026-10-01',
    marked: 'true',
    rights: '© 2026 Ada Lovelace',
    license: 'https://example.org/licence',
    source: 'https://example.com/harbour',
    language: 'en-GB',
  });
  await menu(page, 'File', 'fileInfo');
  await expect(field(page, 'title')).toHaveValue('Harbour at dawn');
  await expect(field(page, 'creator')).toHaveValue('Ada Lovelace');
  await expect(field(page, 'description')).toHaveValue('Boats in the harbour.\nSecond line.');
  await expect(field(page, 'keywords')).toHaveValue('boats, harbour, dawn');
  await expect(field(page, 'date')).toHaveValue('2026-10-01');
  await expect(field(page, 'marked')).toHaveValue('true');
  await expect(field(page, 'rights')).toHaveValue('© 2026 Ada Lovelace');
  await expect(field(page, 'license')).toHaveValue('custom');
  await expect(field(page, 'licenseUrl')).toBeVisible();
  await expect(field(page, 'licenseUrl')).toHaveValue('https://example.org/licence');
  await expect(field(page, 'source')).toHaveValue('https://example.com/harbour');
  await expect(field(page, 'language')).toHaveValue('en-GB');
  // Reopened, it's clean, and saving again writes the same metadata.
  await page.keyboard.press('Escape');
  await expect(title(page)).not.toHaveText(/\*/);
  expect(await page.evaluate(() => window.svgcraft.serialize())).toBe(svg);
});

const INKSCAPE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
  xmlns:rdf="${RDF}" xmlns:cc="${CC}" xmlns:dc="${DC}" width="200" height="100" viewBox="0 0 200 100">
  <title id="title1">Inkscape title</title>
  <desc id="desc1">Plain desc</desc>
  <sodipodi:namedview id="base" pagecolor="#ffffff"/>
  <defs id="defs1"/>
  <metadata id="metadata5">
    <rdf:RDF>
      <cc:Work rdf:about="">
        <dc:format>image/svg+xml</dc:format>
        <dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/>
        <dc:title>Inkscape title</dc:title>
        <dc:date>2024-02-29</dc:date>
        <dc:creator><cc:Agent><dc:title>Grace Hopper</dc:title></cc:Agent></dc:creator>
        <dc:rights><cc:Agent><dc:title>Some rights</dc:title></cc:Agent></dc:rights>
        <dc:publisher><cc:Agent><dc:title>Pub</dc:title></cc:Agent></dc:publisher>
        <dc:language>de</dc:language>
        <dc:subject><rdf:Bag><rdf:li>one</rdf:li><rdf:li>two words</rdf:li></rdf:Bag></dc:subject>
        <dc:source>http://example.net/src</dc:source>
        <dc:description>RDF description</dc:description>
        <cc:license rdf:resource="http://creativecommons.org/publicdomain/zero/1.0/"/>
      </cc:Work>
      <cc:License rdf:about="http://creativecommons.org/publicdomain/zero/1.0/">
        <cc:permits rdf:resource="http://creativecommons.org/ns#Reproduction"/>
      </cc:License>
    </rdf:RDF>
  </metadata>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1">
    <rect id="ir" width="50" height="40" fill="#f00"/>
  </g>
</svg>`;

test('an Inkscape file’s metadata is read, and none of it becomes a layer', async ({ page }) => {
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'ink.svg'), INKSCAPE);
  expect(await meta(page)).toEqual({
    title: 'Inkscape title',
    creator: 'Grace Hopper',
    description: 'RDF description',
    keywords: ['one', 'two words'],
    date: '2024-02-29',
    rights: 'Some rights',
    // Recognised as CC0 and written back as the current URL.
    license: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'http://example.net/src',
    language: 'de',
  });
  // Only the drawing's own layer (and its rect) shows in the Layers panel.
  expect(await layerRows(page)).toEqual(['g', 'rect']);
  expect(
    await page.evaluate(() =>
      [...document.getElementById('sc-doc').querySelectorAll('*')].map((e) => e.localName),
    ),
  ).toEqual(['g', 'rect']);
  await menu(page, 'File', 'fileInfo');
  await expect(field(page, 'license')).toHaveValue('cc0');
  await expect(field(page, 'licenseUrl')).toBeHidden();
  await expect(field(page, 'marked')).toHaveValue('');
});

test('plain <title> and <desc> are read when there is no RDF', async ({ page }) => {
  await load(page, '<title>Just a title</title><desc>  Some\n  words </desc><circle r="5"/>');
  expect(await meta(page)).toEqual({ title: 'Just a title', description: 'Some\n  words' });
  expect(await layerRows(page)).toEqual(['circle']);
});

test('special characters round-trip safely', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  const nasty = `<b>Fish & "Chips" 'n' ]]> </title><script>alert(1)</script> 🐟`;
  await fillInfo(page, {
    title: nasty,
    creator: 'A&B <c>',
    description: '<desc>\n&amp; 🎨',
    keywords: '<k>, &, 🙂',
    rights: '"quoted"',
    language: 'x<y',
  });
  const svg = await saveFile(page);
  expect(svg).not.toContain('<script>');
  const r = await readRdf(page, svg);
  expect(r.parseError).toBe(false);
  expect(r.title).toBe(nasty);
  expect(r.dcTitle).toBe(nasty);
  expect(r.creator).toBe('A&B <c>');
  expect(r.desc).toBe('<desc>\n&amp; 🎨');
  expect(r.keywords).toEqual(['<k>', '&', '🙂']);
  expect(r.rights).toBe('"quoted"');
  expect(r.language).toBe('x<y');
  const before = await meta(page);
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'back.svg'), svg);
  expect(await meta(page)).toEqual(before);
  expect(await page.evaluate(() => document.querySelectorAll('#sc-doc script').length)).toBe(0);
});

test('File Info is one undo step and marks the tab dirty', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  await expect(title(page)).not.toHaveText(/\*/);
  await fillInfo(page, { title: 'One', creator: 'Me' });
  await expect(title(page)).toHaveText(/^test\.svg\*/);
  expect(await meta(page)).toMatchObject({ title: 'One', creator: 'Me' });
  await fillInfo(page, { title: 'Two' });
  expect((await meta(page)).title).toBe('Two');

  await page.click('#sc-undo');
  expect((await meta(page)).title).toBe('One');
  await page.click('#sc-undo');
  expect(await meta(page)).toEqual({});
  await expect(title(page)).not.toHaveText(/\*/);
  expect(await page.evaluate(() => window.svgcraft.serialize())).not.toContain('<metadata');
  await page.click('#sc-redo');
  await page.click('#sc-redo');
  expect((await meta(page)).title).toBe('Two');
  await expect(title(page)).toHaveText(/\*/);
  // Saving clears the *.
  await saveFile(page);
  await expect(title(page)).not.toHaveText(/\*/);
});

test('each tab keeps its own File Info', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>', 800, 600, 'first.svg');
  await fillInfo(page, { title: 'First drawing' });
  await page.click('.sc-doctab-new');
  expect(await meta(page)).toEqual({});
  await fillInfo(page, { title: 'Second drawing' });
  const tabs = page.locator('#sc-doctabs .sc-doctab');
  await expect(tabs.nth(0)).toHaveAttribute('data-tip', 'First drawing · first.svg');
  await tabs.nth(0).click();
  expect((await meta(page)).title).toBe('First drawing');
  await page.click('#sc-undo');
  expect(await meta(page)).toEqual({});
  await tabs.nth(1).click();
  expect((await meta(page)).title).toBe('Second drawing');
});

test('importing an SVG keeps the drawing’s own File Info', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  await fillInfo(page, { title: 'Mine', creator: 'Me', license: 'cc-by' });
  const before = await meta(page);
  await page.evaluate((t) => window.svgcraft.placeSvg(t, 'ink.svg'), INKSCAPE);
  expect(await meta(page)).toEqual(before);
  // The import arrives as a group of its graphics only.
  const kids = await page.evaluate(() =>
    [...document.getElementById('sc-doc').lastElementChild.querySelectorAll('*')].map(
      (e) => e.localName,
    ),
  );
  expect(kids).toEqual(['g', 'rect']);
  // A copied selection carries no document metadata.
  await select(page, 'r');
  const clip = await page.evaluate(() => window.svgcraft.serialize({ selection: true }));
  expect(clip).not.toMatch(/<metadata|<title|<desc|rdf:/);
});

test('licence choices map to the right URLs', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  const cases = [
    ['cc-by', 'https://creativecommons.org/licenses/by/4.0/', ['ShareAlike', 'CommercialUse']],
    ['cc-by-sa', 'https://creativecommons.org/licenses/by-sa/4.0/', ['CommercialUse']],
    ['cc-by-nd', 'https://creativecommons.org/licenses/by-nd/4.0/', ['DerivativeWorks']],
    ['cc-by-nc', 'https://creativecommons.org/licenses/by-nc/4.0/', ['ShareAlike']],
    ['cc-by-nc-sa', 'https://creativecommons.org/licenses/by-nc-sa/4.0/', []],
    ['cc0', 'https://creativecommons.org/publicdomain/zero/1.0/', ['Attribution', 'Notice']],
  ];
  for (const [opt, url, absent] of cases) {
    await fillInfo(page, { title: 'T', license: opt });
    const r = await readRdf(page, await page.evaluate(() => window.svgcraft.serialize()));
    expect(r.license, opt).toBe(url);
    expect(r.licAbout, opt).toBe(url);
    expect(r.usage).toBeNull();
    for (const t of absent) expect(r.licTerms.join(' '), opt).not.toContain(`#${t}`);
  }
  expect(
    (await readRdf(page, await page.evaluate(() => window.svgcraft.serialize()))).licTerms,
  ).toEqual([
    `permits:${CC}Reproduction`,
    `permits:${CC}Distribution`,
    `permits:${CC}DerivativeWorks`,
  ]);
  const nc = await page.evaluate(() => window.svgcraft.serialize());
  expect(nc).not.toContain('xmpRights');

  // All rights reserved: XMP usage terms, no CC licence.
  await fillInfo(page, { license: 'arr', marked: 'true' });
  let r = await readRdf(page, await page.evaluate(() => window.svgcraft.serialize()));
  expect(r).toMatchObject({
    license: null,
    licAbout: null,
    usage: 'All rights reserved.',
    marked: 'True',
  });
  // Public domain status, custom licence URL.
  await fillInfo(page, {
    license: 'custom',
    licenseUrl: 'http://example.com/terms',
    marked: 'false',
  });
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  r = await readRdf(page, svg);
  expect(r).toMatchObject({ license: 'http://example.com/terms', licAbout: null, marked: 'False' });
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'x.svg'), svg);
  expect(await meta(page)).toMatchObject({ license: 'http://example.com/terms', marked: 'false' });
  // None: no licence at all.
  await fillInfo(page, { license: '', marked: '' });
  r = await readRdf(page, await page.evaluate(() => window.svgcraft.serialize()));
  expect(r).toMatchObject({ license: null, usage: null, marked: null });
});

test('invalid URLs are refused', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  for (const bad of [
    'javascript:alert(1)',
    'ftp://example.com/x',
    'not a url',
    'data:text/html,hi',
  ]) {
    await fillInfo(page, { title: 'T', source: bad });
    await expect(dlg(page)).toBeVisible();
    await expect(page.locator('#sc-fileinfo .sc-info-err')).toBeVisible();
    await expect(field(page, 'source')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page, 'source')).toBeFocused();
    expect(await meta(page)).toEqual({});
    await page.keyboard.press('Escape');
  }
  await fillInfo(page, { license: 'custom', licenseUrl: 'javascript:alert(1)' });
  await expect(dlg(page)).toBeVisible();
  await expect(field(page, 'licenseUrl')).toHaveAttribute('aria-invalid', 'true');
  // Fixing it lets OK through.
  await field(page, 'licenseUrl').fill('https://example.com/ok');
  await expect(page.locator('#sc-fileinfo .sc-info-err')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(dlg(page)).toBeHidden();
  expect((await meta(page)).license).toBe('https://example.com/ok');
});

test('hostile metadata in a file is read as data only', async ({ page }) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:rdf="${RDF}" xmlns:cc="${CC}" xmlns:dc="${DC}" viewBox="0 0 10 10">
    <title onclick="window.pwned=1">T<script>window.pwned=2</script></title>
    <metadata><rdf:RDF><cc:Work rdf:about="">
      <dc:title>Hi<script>window.pwned=3</script></dc:title>
      <dc:source>javascript:window.pwned=4</dc:source>
      <cc:license rdf:resource="javascript:window.pwned=5"/>
      <dc:description><foreignObject><img src="x" onerror="window.pwned=6"/></foreignObject>ok</dc:description>
    </cc:Work></rdf:RDF></metadata>
    <rect width="5" height="5"/></svg>`;
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'evil.svg'), svg);
  expect(await meta(page)).toEqual({ title: 'Hi', description: 'ok' });
  const out = await page.evaluate(() => window.svgcraft.serialize());
  expect(out).not.toMatch(/<script|javascript:|onclick|onerror|foreignObject/i);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(await layerRows(page)).toEqual(['rect']);
});

test('File Info survives a reload and shows in the SVG source', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  await fillInfo(page, { title: 'Kept', creator: 'Me', license: 'cc-by-nc' });
  const before = await meta(page);
  // Wait for the debounced save of open tabs to reach IndexedDB.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const r = indexedDB.open('svgcraft', 1);
            r.onsuccess = () => {
              const q = r.result.transaction('kv').objectStore('kv').get('docs');
              q.onsuccess = () => resolve(!!q.result?.docs?.some((d) => d.svg.includes('Kept')));
            };
            r.onerror = () => resolve(false);
          }),
      ),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
  expect(await meta(page)).toEqual(before);
  await expect(page.locator('#sc-doctabs .sc-doctab[aria-selected="true"]')).toHaveAttribute(
    'data-tip',
    'Kept · test.svg',
  );
  await menu(page, 'View', 'toggleSource');
  await expect(page.locator('#sc-source')).toBeVisible();
  const text = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-src-code .sc-src-c')].map((c) => c.textContent).join('\n'),
  );
  expect(text).toContain('<title>Kept</title>');
  expect(text).toContain(
    '<cc:license rdf:resource="https://creativecommons.org/licenses/by-nc/4.0/"/>',
  );
});
