// Builds help.html (Help → SVGCraft Help) from README.md's user sections,
// so the README stays the one place features are written up.
//
//   node scripts/gen-help.mjs          write help.html
//   node scripts/gen-help.mjs --check  exit 1 if help.html is out of date
//
// Every ## section of the README from "Workspace" up to "Development"
// becomes a section of the help, and every top-level bullet that starts
// with a bold name becomes a topic with its own anchor (#image-trace,
// #gradients, …), which the editor's ? buttons link to. Run it after
// editing the README; tests/help.spec.js fails while help.html is stale.
import fs from 'node:fs';
import path from 'node:path';
import * as prettier from 'prettier';

const ROOT = path.resolve(import.meta.dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const OUT = path.join(ROOT, 'help.html');
const FIRST = 'Workspace';
const LAST = 'Development'; // not included

// GitHub's heading anchors: lower case, punctuation dropped, spaces → -.
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline Markdown: code, bold, links (README anchors map to the help's).
function inline(s) {
  const code = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => `\u2063${code.push(c) - 1}\u2063`);
  s = esc(s)
    .replace(/\\([*_\\[\]`#])/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, href) => {
      if (href.startsWith('#')) return `<a href="${href}">${t}</a>`;
      if (/^https?:/.test(href)) return `<a href="${href}">${t}</a>`;
      // A file in the repository: on GitHub.
      return `<a href="https://github.com/orthlieb/svgcraft/blob/main/${href}">${t}</a>`;
    });
  return s.replace(/\u2063(\d+)\u2063/g, (m, i) => `<code>${esc(code[i])}</code>`);
}

// The README's user sections: [{ title, lines }].
function sections() {
  const out = [];
  let cur = null;
  let on = false;
  for (const line of README.split('\n')) {
    const h = line.match(/^## (.+)$/);
    if (h) {
      if (h[1] === FIRST) on = true;
      if (h[1] === LAST) break;
      if (on) out.push((cur = { title: h[1], lines: [] }));
      continue;
    }
    if (on && cur) cur.lines.push(line);
  }
  return out;
}

// Blocks of a section: paragraphs, ### headings, tables and lists (a list
// item is its first line plus the more-indented lines after it).
function blocks(lines) {
  const out = [];
  let i = 0;
  const indent = (l) => l.match(/^ */)[0].length;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    const h3 = l.match(/^### (.+)$/);
    if (h3) {
      out.push({ k: 'h3', text: h3[1] });
      i++;
    } else if (l.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      out.push({ k: 'table', rows });
    } else if (/^- /.test(l)) {
      const items = [];
      while (
        i < lines.length &&
        (/^- /.test(lines[i]) ||
          (lines[i].trim() && indent(lines[i]) > 0) ||
          (!lines[i].trim() && /^(- | )/.test(lines[i + 1] || '')))
      ) {
        if (/^- /.test(lines[i])) items.push([lines[i].slice(2)]);
        else items.at(-1).push(lines[i].replace(/^ {2}/, ''));
        i++;
      }
      out.push({ k: 'ul', items });
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(- |\||### )/.test(lines[i]))
        para.push(lines[i++]);
      out.push({ k: 'p', text: para.join(' ') });
    }
  }
  return out;
}

// A list item's lines → HTML (a nested list inside it is converted too).
function itemHtml(lines) {
  const firstSub = lines.findIndex((l, j) => j > 0 && /^- /.test(l));
  const text = (firstSub < 0 ? lines : lines.slice(0, firstSub)).map((l) => l.trim()).join(' ');
  let html = inline(text);
  if (firstSub >= 0)
    html += listHtml(blocks(lines.slice(firstSub)).filter((b) => b.k === 'ul')[0].items);
  return html;
}
const listHtml = (items) => `<ul>${items.map((it) => `<li>${itemHtml(it)}</li>`).join('')}</ul>`;

function tableHtml(rows) {
  const cells = (r) =>
    r
      .slice(1, -1)
      .split('|')
      .map((c) => inline(c.trim()));
  const [head, , ...body] = rows;
  return `<table><thead><tr>${cells(head)
    .map((c) => `<th>${c}</th>`)
    .join('')}</tr></thead><tbody>${body
    .map(
      (r) =>
        `<tr>${cells(r)
          .map((c) => `<td>${c}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>`;
}

// ---- the page ---------------------------------------------------------------------
const secs = sections();
// Topic anchors: the bold name's slug, or section-prefixed where two
// sections share a name (Type's "Fonts." and Create Outlines' "Fonts.").
const topicName = (lines) => lines[0].match(/^(?:[^*\w]*\s)?\*\*(.+?)\*\*/)?.[1];
const counts = new Map();
for (const s of secs)
  for (const b of blocks(s.lines))
    if (b.k === 'ul')
      for (const it of b.items) {
        const n = topicName(it);
        if (n) counts.set(slug(n), (counts.get(slug(n)) || 0) + 1);
      }
const sectionIds = new Set(secs.map((s) => slug(s.title)));
const used = new Set(sectionIds);
const topicId = (sec, name) => {
  let id = slug(name);
  if (counts.get(id) > 1 || used.has(id)) id = `${slug(sec)}-${id}`;
  while (used.has(id)) id += '-2';
  used.add(id);
  return id;
};

const nav = [];
const body = secs
  .map((s) => {
    const sid = slug(s.title);
    const topics = [];
    const html = blocks(s.lines)
      .map((b) => {
        if (b.k === 'h3') return `<h3 id="${slug(b.text)}">${inline(b.text)}</h3>`;
        if (b.k === 'p') return `<p data-find>${inline(b.text)}</p>`;
        if (b.k === 'table') return `<div data-find>${tableHtml(b.rows)}</div>`;
        return `<ul>${b.items
          .map((it) => {
            const n = topicName(it);
            if (!n) return `<li data-find>${itemHtml(it)}</li>`;
            const id = topicId(s.title, n);
            topics.push([id, n.replace(/[.:]$/, '')]);
            return `<li data-find id="${id}">${itemHtml(it)}</li>`;
          })
          .join('')}</ul>`;
      })
      .join('\n');
    nav.push(
      `<li><a href="#${sid}">${inline(s.title)}</a>${
        topics.length
          ? `<ul>${topics.map(([id, n]) => `<li><a href="#${id}">${inline(n)}</a></li>`).join('')}</ul>`
          : ''
      }</li>`,
    );
    return `<section id="${sid}"><h2>${inline(s.title)}</h2>\n${html}</section>`;
  })
  .join('\n');

const page = `<!doctype html>
<!-- Generated by scripts/gen-help.mjs from README.md: edit the README, then
     run node scripts/gen-help.mjs. -->
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SVGCraft Help</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<link rel="icon" href="favicon-32.png" type="image/png" sizes="32x32" />
<meta name="theme-color" content="#001e36" />
<script>
try {
  const t = localStorage.getItem('svgcraft.theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch {
  /* storage blocked: follow the OS theme */
}
</script>
<style>
:root { --bg: #f5f5f5; --card: #ffffff; --text: #2c2c2c; --text-dim: #5f5f5f; --line: #dadada; --accent: #1473e6; --hero: #001e36; --hero-text: #e8f1fb; --kbd: #ececec; --mark: #fff3b0; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { --bg: #1b1b1b; --card: #262626; --text: #dcdcdc; --text-dim: #9a9a9a; --line: #363636; --accent: #2680eb; --kbd: #333333; --mark: #4a3f00; color-scheme: dark; } }
:root[data-theme='dark'] { --bg: #1b1b1b; --card: #262626; --text: #dcdcdc; --text-dim: #9a9a9a; --line: #363636; --accent: #2680eb; --kbd: #333333; --mark: #4a3f00; color-scheme: dark; }
* { box-sizing: border-box; }
html { scroll-padding-top: 72px; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 16px; padding: 12px max(16px, calc((100vw - 1180px) / 2)); background: var(--hero); color: var(--hero-text); }
header h1 { margin: 0; font-size: 18px; white-space: nowrap; }
header a { color: var(--hero-text); }
header input { flex: 1; min-width: 0; max-width: 420px; height: 32px; padding: 0 10px; border: 0; border-radius: 6px; font: inherit; }
.count { font-size: 13px; opacity: 0.8; white-space: nowrap; }
.wrap { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 32px; max-width: 1180px; margin: 0 auto; padding: 24px 16px 80px; }
nav { position: sticky; top: 72px; align-self: start; max-height: calc(100vh - 96px); overflow-y: auto; font-size: 14px; }
nav ul { margin: 0; padding: 0; list-style: none; }
nav > ul > li { margin-bottom: 10px; }
nav > ul > li > a { font-weight: 600; }
nav li li { padding-left: 12px; }
nav a { display: block; padding: 2px 0; color: var(--text-dim); text-decoration: none; }
nav a:hover { color: var(--accent); }
main section { padding: 4px 24px 12px; margin-bottom: 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
h2 { margin: 16px 0 8px; font-size: 22px; }
h3 { margin: 18px 0 6px; font-size: 17px; }
main a { color: var(--accent); }
main ul { padding-left: 22px; }
main li { margin: 6px 0; }
li:target, li.flash { border-radius: 6px; background: var(--mark); box-shadow: 0 0 0 6px var(--mark); }
code { padding: 1px 4px; border-radius: 4px; background: var(--kbd); font-size: 13px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 5px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
[hidden] { display: none !important; }
@media (max-width: 760px) { .wrap { grid-template-columns: minmax(0, 1fr); } nav { display: none; } main section { padding: 4px 14px 10px; } }
</style>
</head>
<body>
<header>
<h1>SVGCraft Help</h1>
<input type="search" id="find" placeholder="Search the help" aria-label="Search the help" autocomplete="off" />
<span class="count" id="count" aria-live="polite"></span>
<a href="index.html">Open SVGCraft</a>
</header>
<div class="wrap">
<nav aria-label="Topics"><ul>${nav.join('')}</ul></nav>
<main>
${body}
</main>
</div>
<script>
// Search: only the paragraphs, topics and tables that hold every word.
const find = document.getElementById('find');
const blocks = [...document.querySelectorAll('[data-find]')];
const text = new Map(blocks.map((b) => [b, b.textContent.toLowerCase()]));
find.addEventListener('input', () => {
  const words = find.value.toLowerCase().split(/\\s+/).filter(Boolean);
  let shown = 0;
  for (const b of blocks) {
    const hit = words.every((w) => text.get(b).includes(w));
    b.hidden = !hit;
    if (hit) shown++;
  }
  for (const s of document.querySelectorAll('main section'))
    s.hidden = !s.querySelector('[data-find]:not([hidden])');
  for (const ul of document.querySelectorAll('main ul'))
    ul.hidden = !ul.querySelector(':scope > li:not([hidden])');
  for (const a of document.querySelectorAll('nav a')) {
    const t = document.getElementById(a.getAttribute('href').slice(1));
    a.parentElement.hidden = !!t && t.hidden;
  }
  document.getElementById('count').textContent = words.length
    ? shown + (shown === 1 ? ' match' : ' matches')
    : '';
});
// A link from the editor (help.html#topic) lights the topic up.
const flash = () => {
  const t = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (!t) return;
  t.classList.add('flash');
  setTimeout(() => t.classList.remove('flash'), 1600);
};
addEventListener('hashchange', flash);
flash();
</script>
</body>
</html>
`;

const formatted = await prettier.format(page, {
  ...(await prettier.resolveConfig(OUT)),
  parser: 'html',
});
if (process.argv.includes('--check')) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (now !== formatted) {
    console.error('help.html is out of date: run node scripts/gen-help.mjs');
    process.exit(1);
  }
  console.log('help.html is up to date');
} else {
  fs.writeFileSync(OUT, formatted);
  console.log(`wrote help.html (${secs.length} sections, ${used.size - sectionIds.size} topics)`);
}
