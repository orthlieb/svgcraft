// SVGCraft — File → File Info (title, author, licence as SVG metadata).
'use strict';

// ---------------------------------------------------------------------
// File → File Info… (Photoshop's File Info, Inkscape's Document Metadata)
//
// state.meta holds the document's title, author, licence and so on. It's
// part of history (see snapshot) and serialize writes it where SVG keeps
// such things: <title> and <desc> as the root's first children (read by
// screen readers and shown as tooltips) and a <metadata> block of RDF/XML
// in the shape Inkscape writes (Dublin Core inside a Creative Commons
// cc:Work). Copyright status is XMP's xmpRights:Marked (True =
// copyrighted, False = public domain, absent = unknown), and "All rights
// reserved" is xmpRights:UsageTerms. Files are only ever read for text and
// http(s) URLs; nothing from a <metadata> block enters the drawing.
// ---------------------------------------------------------------------
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DC = 'http://purl.org/dc/elements/1.1/';
const CC = 'http://creativecommons.org/ns#';
const XMPR = 'http://ns.adobe.com/xap/1.0/rights/';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const ARR = 'All rights reserved';
const CC_BASE = { permits: ['Reproduction', 'Distribution', 'DerivativeWorks'] };
const CC_BY = { ...CC_BASE, requires: ['Notice', 'Attribution'] };
// Licence menu value → URL and the terms its cc:License block lists.
const LICENCES = {
  'cc-by': { url: 'https://creativecommons.org/licenses/by/4.0/', ...CC_BY },
  'cc-by-sa': {
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    ...CC_BY,
    requires: [...CC_BY.requires, 'ShareAlike'],
  },
  'cc-by-nd': {
    url: 'https://creativecommons.org/licenses/by-nd/4.0/',
    ...CC_BY,
    permits: ['Reproduction', 'Distribution'],
  },
  'cc-by-nc': {
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    ...CC_BY,
    prohibits: ['CommercialUse'],
  },
  'cc-by-nc-sa': {
    url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    ...CC_BY,
    requires: [...CC_BY.requires, 'ShareAlike'],
    prohibits: ['CommercialUse'],
  },
  cc0: { url: 'https://creativecommons.org/publicdomain/zero/1.0/', ...CC_BASE },
};
// Field order, also the key order history compares.
const META_KEYS = [
  'title',
  'creator',
  'description',
  'keywords',
  'date',
  'marked',
  'rights',
  'license',
  'source',
  'language',
];
// Text from a file or the dialog: no control characters XML can't hold;
// one line unless it's the description.
const metaText = (v, multi = false) => {
  let s = [...String(v ?? '')]
    .filter((ch) => {
      const c = ch.codePointAt(0);
      return (c >= 32 || c === 9 || c === 10 || c === 13) && c !== 0xfffe && c !== 0xffff;
    })
    .join('')
    .trim();
  s = multi ? s.replace(/\r\n?/g, '\n') : s.replace(/\s+/g, ' ');
  return s.slice(0, 10000);
};
const httpUrl = (v) => {
  const s = metaText(v);
  if (!s) return '';
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && u.hostname ? s : null;
  } catch {
    return null;
  }
};
const licenceKey = (url) => {
  const bare = (u) => u.replace(/^https?:\/\//i, '').replace(/\/?$/, '/');
  return Object.keys(LICENCES).find((k) => bare(LICENCES[k].url) === bare(url || '')) || '';
};
// A tidy meta object: known keys only, in order, empty ones left out.
function cleanMeta(m = {}) {
  const out = {};
  for (const k of META_KEYS) {
    let v = m[k];
    if (k === 'keywords')
      v = (Array.isArray(v) ? v : [])
        .map((s) => metaText(s))
        .filter((s, i, a) => s && a.indexOf(s) === i);
    else if (k === 'marked') v = v === 'true' || v === 'false' ? v : '';
    else if (k === 'license') v = v === 'arr' ? v : httpUrl(v) || '';
    else if (k === 'source') v = httpUrl(v) || '';
    else v = metaText(v, k === 'description');
    if (v.length) out[k] = v;
  }
  return out;
}
const metaJson = () => JSON.stringify(state.meta || {});

// File Info from a parsed SVG root: Inkscape-style RDF, then the plain
// <title> / <desc> for whatever the RDF doesn't say.
function readMeta(root) {
  const kids = [...root.children];
  const plain = (name) => kids.find((c) => c.localName === name)?.textContent || '';
  const md = kids.find((c) => c.localName === 'metadata');
  const work =
    md &&
    (md.getElementsByTagNameNS(CC, 'Work')[0] || md.getElementsByTagNameNS(RDF, 'Description')[0]);
  const own = (ns, name) =>
    work ? [...work.children].find((c) => c.namespaceURI === ns && c.localName === name) : null;
  const text = (ns, name) => own(ns, name)?.textContent || '';
  // dc:creator / dc:rights hold a cc:Agent with a dc:title, or plain text.
  const agent = (name) => {
    const el = own(DC, name);
    return el ? (el.getElementsByTagNameNS(DC, 'title')[0] || el).textContent : '';
  };
  const resource = (ns, name) => {
    const el = own(ns, name);
    return el ? el.getAttributeNS(RDF, 'resource') || el.textContent : '';
  };
  const subj = own(DC, 'subject');
  const lis = subj ? [...subj.getElementsByTagNameNS(RDF, 'li')] : [];
  const keywords = lis.length
    ? lis.map((li) => li.textContent)
    : (subj?.textContent || '').split(/[,;]/);
  const marked = text(XMPR, 'Marked').trim().toLowerCase();
  const lic = resource(CC, 'license').trim();
  const terms = metaText(text(XMPR, 'UsageTerms')).replace(/\.$/, '');
  return cleanMeta({
    title: text(DC, 'title') || plain('title'),
    creator: agent('creator'),
    description: text(DC, 'description') || plain('desc'),
    keywords,
    date: text(DC, 'date'),
    marked: marked === 'true' || marked === 'false' ? marked : '',
    rights: agent('rights'),
    license: licenceKey(lic)
      ? LICENCES[licenceKey(lic)].url
      : httpUrl(lic) || (terms.toLowerCase() === ARR.toLowerCase() ? 'arr' : ''),
    source: resource(DC, 'source'),
    language: text(DC, 'language'),
  });
}

// <title>, <desc> and <metadata> for the saved file, built with the DOM's
// namespace APIs so every value is escaped by the serializer.
function metaNodes() {
  const m = state.meta || {};
  const out = [];
  const node = (ns, name, parent, txt) => {
    const el = document.createElementNS(ns, name);
    if (txt != null) el.textContent = txt;
    parent?.append(el);
    return el;
  };
  if (m.title) out.push(node(NS, 'title', null, m.title));
  if (m.description) out.push(node(NS, 'desc', null, m.description));
  if (!Object.keys(m).length) return out;
  const lic = LICENCES[licenceKey(m.license)];
  const xmp = m.marked || m.license === 'arr';
  const md = node(NS, 'metadata');
  const rdf = node(RDF, 'rdf:RDF', md);
  for (const [p, u] of [
    ['rdf', RDF],
    ['cc', CC],
    ['dc', DC],
    ...(xmp ? [['xmpRights', XMPR]] : []),
  ])
    rdf.setAttributeNS(XMLNS, `xmlns:${p}`, u);
  const work = node(CC, 'cc:Work', rdf);
  work.setAttributeNS(RDF, 'rdf:about', '');
  const res = (ns, name, parent, url) =>
    node(ns, name, parent).setAttributeNS(RDF, 'rdf:resource', url);
  const agent = (name, v) => node(DC, 'dc:title', node(CC, 'cc:Agent', node(DC, name, work)), v);
  node(DC, 'dc:format', work, 'image/svg+xml');
  res(DC, 'dc:type', work, 'http://purl.org/dc/dcmitype/StillImage');
  if (m.title) node(DC, 'dc:title', work, m.title);
  if (m.creator) agent('dc:creator', m.creator);
  if (m.rights) agent('dc:rights', m.rights);
  if (m.date) node(DC, 'dc:date', work, m.date);
  if (m.description) node(DC, 'dc:description', work, m.description);
  if (m.keywords) {
    const bag = node(RDF, 'rdf:Bag', node(DC, 'dc:subject', work));
    for (const k of m.keywords) node(RDF, 'rdf:li', bag, k);
  }
  if (m.source) node(DC, 'dc:source', work, m.source);
  if (m.language) node(DC, 'dc:language', work, m.language);
  if (m.marked) node(XMPR, 'xmpRights:Marked', work, m.marked === 'true' ? 'True' : 'False');
  if (m.license === 'arr') node(XMPR, 'xmpRights:UsageTerms', work, ARR + '.');
  else if (m.license) res(CC, 'cc:license', work, m.license);
  if (lic) {
    const cl = node(CC, 'cc:License', rdf);
    cl.setAttributeNS(RDF, 'rdf:about', lic.url);
    for (const kind of ['permits', 'requires', 'prohibits'])
      for (const t of lic[kind] || []) res(CC, `cc:${kind}`, cl, CC + t);
  }
  // Indent the RDF, one element per line, as Inkscape does.
  const indent = (el, depth) => {
    const kids = [...el.children];
    if (!kids.length) return;
    for (const c of kids) {
      el.insertBefore(document.createTextNode('\n' + '  '.repeat(depth + 1)), c);
      indent(c, depth + 1);
    }
    el.append(document.createTextNode('\n' + '  '.repeat(depth)));
  };
  indent(md, 1);
  out.push(md);
  return out;
}

// The dialog.
const infoDlg = $('#sc-fileinfo');
const infoField = (k) => infoDlg.querySelector(`[data-meta="${k}"]`);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function syncLicenceUrl() {
  const custom = infoField('license').value === 'custom';
  infoDlg.querySelector('.sc-info-licurl').hidden = !custom;
}
function infoError(k, msg) {
  for (const el of infoDlg.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  const err = infoDlg.querySelector('.sc-info-err');
  err.textContent = msg || '';
  err.hidden = !msg;
  if (!k) return;
  const el = infoField(k);
  el.setAttribute('aria-invalid', 'true');
  el.focus();
}
function openFileInfo() {
  if (infoDlg.open) return;
  closeMenus();
  const m = state.meta || {};
  for (const k of ['title', 'creator', 'description', 'rights', 'source', 'language'])
    infoField(k).value = m[k] || '';
  infoField('keywords').value = (m.keywords || []).join(', ');
  infoField('date').value = m.date || today();
  infoField('marked').value = m.marked || '';
  const key = m.license === 'arr' ? 'arr' : licenceKey(m.license);
  infoField('license').value = key || (m.license ? 'custom' : '');
  infoField('licenseUrl').value = key || m.license === 'arr' ? '' : m.license || '';
  syncLicenceUrl();
  infoError();
  showDialog(infoDlg, () => closeFileInfo(false));
  setTimeout(() => {
    infoField('title').focus();
    infoField('title').select();
  }, 0);
}
function closeFileInfo(ok) {
  if (!infoDlg.open) return;
  if (ok) {
    const v = (k) => infoField(k).value;
    const choice = v('license');
    let license = LICENCES[choice]?.url || (choice === 'arr' ? 'arr' : '');
    if (choice === 'custom') {
      license = httpUrl(v('licenseUrl'));
      if (!license)
        return infoError(
          'licenseUrl',
          'Enter the licence’s web address, starting http:// or https://.',
        );
    }
    const source = httpUrl(v('source'));
    if (source === null)
      return infoError('source', 'The source must be a web address starting http:// or https://.');
    const next = cleanMeta({
      title: v('title'),
      creator: v('creator'),
      description: v('description'),
      keywords: v('keywords').split(','),
      date: v('date'),
      marked: v('marked'),
      rights: v('rights'),
      license,
      source,
      language: v('language'),
    });
    // The date fills itself in; on its own it isn't worth writing down.
    if (Object.keys(next).join() === 'date' && !state.meta?.date) delete next.date;
    if (JSON.stringify(next) !== metaJson()) {
      state.meta = next;
      commit();
    }
  }
  hideDialog(infoDlg);
}
infoField('license').addEventListener('change', () => {
  syncLicenceUrl();
  if (infoField('license').value === 'custom') infoField('licenseUrl').focus();
});
infoDlg.addEventListener('input', (e) => {
  if (e.target.getAttribute('aria-invalid')) infoError();
});
infoDlg.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') closeFileInfo(false);
  else if (e.key === 'Enter' && !e.target.matches('select, button, textarea')) {
    e.preventDefault();
    closeFileInfo(true);
  }
});
infoDlg.querySelector('[data-info="ok"]').addEventListener('click', () => closeFileInfo(true));
infoDlg.querySelector('[data-info="cancel"]').addEventListener('click', () => closeFileInfo(false));

// `animate: false` leaves the animations out, for the still images (PNG,
// app icons, previews) drawn from it.
function serialize({ selection = false, fontCss = '', animate = true } = {}) {
  const root = document.createElementNS(NS, 'svg');
  let box = { x: 0, y: 0, w: state.w, h: state.h };
  if (selection) {
    // As painted, so strokes and effects aren't cut off at the edges.
    box = paintBox(normalizeSel(state.sel)) || selBox() || box;
    root.setAttribute('data-svgcraft', 'clip');
  }
  // A drawing in mm, in… says its real size; the viewBox stays in px.
  const len = (px) => (selection || state.units === 'px' ? f(px) : `${inUnits(px)}${state.units}`);
  root.setAttribute('width', len(box.w));
  root.setAttribute('height', len(box.h));
  root.setAttribute('viewBox', [box.x, box.y, box.w, box.h].map(f).join(' '));
  // Guides ride along as inert metadata, so reopening the file restores them.
  if (!selection && state.guides.length) root.setAttribute('data-sc-guides', guidesAttr());
  const nl = () => document.createTextNode('\n  ');
  // File Info belongs to the document, not to a copied selection.
  if (!selection) for (const n of metaNodes()) root.append(nl(), n);
  isoWrite();
  const layers = selection ? normalizeSel(state.sel) : [...(iso ? iso.back : doc).children];
  // A copied selection only takes the symbols it uses along.
  const unused = selection ? unusedSymbols(layers) : new Set();
  if (defs.children.length || fontCss) {
    const d = document.createElementNS(NS, 'defs');
    if (fontCss) {
      const st = document.createElementNS(NS, 'style');
      st.textContent = fontCss;
      d.append(st);
    }
    for (const c of defs.childNodes) if (!unused.has(c)) d.append(c.cloneNode(true));
    root.append(nl(), d);
  }
  const genDefs = [];
  for (const el of layers) {
    const c = el.cloneNode(true);
    // Editor marks: the symbol being edited, and layers shown or hidden in
    // the phone preview.
    for (const n of [c, ...c.querySelectorAll('[data-sc-iso], [data-sc-peek]')]) {
      n.removeAttribute('data-sc-iso');
      n.removeAttribute('data-sc-peek');
    }
    const top = writeAnimations(el, c, animate, (d) => genDefs.push(d));
    // A nested layer copied on its own keeps where it sits and how it looks.
    if (selection && el.parentNode !== doc) {
      setM(c, fullM(el));
      bakeInherited(el, c);
    }
    root.append(nl(), top);
  }
  // Clips, filters and gradients the animations made.
  if (genDefs.length) {
    let d = [...root.children].find((n) => n.localName === 'defs');
    if (!d) {
      d = document.createElementNS(NS, 'defs');
      root.firstElementChild ? root.firstElementChild.before(d) : root.append(d);
    }
    d.append(...genDefs);
  }
  // Paths layers move along (Move along path), out of sight in the file;
  // marked, so reopening it shows them again for editing.
  const routes = selection ? new Set() : hiddenRoutes();
  if (routes.size)
    for (const n of root.querySelectorAll('[id]'))
      if (routes.has(n.id) && n.getAttribute('display') !== 'none') {
        n.setAttribute('display', 'none');
        n.setAttribute('data-sc-route', '');
      }
  root.append(document.createTextNode('\n'));
  let s = new XMLSerializer().serializeToString(root);
  if (s.includes('xlink:') && !s.includes('xmlns:xlink'))
    s = s.replace('<svg ', `<svg xmlns:xlink="${XLINK}" `);
  return s;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// An exported SVG links the Google Fonts it uses, so browsers draw it right.
const fontImport = () => {
  const g = usedGoogleFonts();
  return g.length ? `@import url('${googleUrl(g)}');` : '';
};

function exportSvg() {
  download(
    new Blob([serialize({ fontCss: fontImport() })], { type: 'image/svg+xml' }),
    `${state.fileName}.svg`,
  );
  markSaved();
  say(`Downloaded ${state.fileName}.svg.`);
}
