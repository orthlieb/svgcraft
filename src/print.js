// SVGCraft — File → Print… (Ctrl+P). A module of its own: loaded the first
// time it's used (loadModule in src/core.js), listed in index.html's
// on-demand <template> so it's kept for offline use and counted in the
// version.
'use strict';

// Each artboard prints on a page of its own, at its real size (a CSS px is
// 1/96 in, so a drawing set up in mm prints in mm), or fitted to the paper.
// The pages are the artboards drawn as images, so ids in one can't clash
// with the drawing's, and the fonts are embedded as for a PNG. While they
// print, everything else on the page is hidden. The browser's print dialog
// does the rest: printer, copies, paper, or Save as PDF.
const printDlg = (() => {
  const d = document.createElement('dialog');
  d.className = 'sc-dialog';
  d.id = 'sc-print-dlg';
  d.dataset.help = 'print';
  d.setAttribute('aria-labelledby', 'sc-pr-title');
  d.innerHTML = `
    <div class="sc-dialog-title" id="sc-pr-title">Print</div>
    <div class="sc-dialog-body">
      <fieldset class="sc-pr-set">
        <legend>Artboards</legend>
        <label class="sc-check"><input type="radio" name="sc-pr-which" value="all" checked />
          <span data-pr="all-label">All artboards</span></label>
        <label class="sc-check"><input type="radio" name="sc-pr-which" value="one" />
          Just <select data-pr="board" aria-label="Artboard to print"></select></label>
      </fieldset>
      <fieldset class="sc-pr-set">
        <legend>Size</legend>
        <label class="sc-check"><input type="radio" name="sc-pr-size" value="actual" checked />
          Actual size, each on a page its own size</label>
        <label class="sc-check"><input type="radio" name="sc-pr-size" value="fit" />
          Fit to the paper</label>
      </fieldset>
      <p class="sc-hint">
        Next, your browser's print dialog: pick a printer, or Save as PDF for a vector PDF.
      </p>
    </div>
    <div class="sc-dialog-foot">
      <button class="sc-tbtn" data-pr-btn="cancel">Cancel</button>
      <button class="sc-tbtn sc-primary-btn" data-pr-btn="ok">Print…</button>
    </div>`;
  document.body.append(d);
  const title = d.querySelector('.sc-dialog-title');
  dragWindow(d, title);
  title.append(helpButton('Help on this', () => d.dataset.help));
  return d;
})();

// While printing: only the pages show, each with its own @page size.
const printCss = document.createElement('style');
printCss.id = 'sc-print-css';
document.head.append(printCss);

function openPrint() {
  if (!curDoc) return warn('Open a drawing to print it.');
  const boards = allBoards();
  const sel = printDlg.querySelector('[data-pr="board"]');
  sel.replaceChildren(
    ...boards.map((b, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = b.name;
      return o;
    }),
  );
  sel.value = String(Math.max(0, boardSel));
  printDlg.querySelector('[data-pr="all-label"]').textContent =
    boards.length > 1 ? `All ${boards.length} artboards` : 'The drawing';
  printDlg.querySelector('[value="one"]').closest('label').style.display =
    boards.length < 2 ? 'none' : '';
  if (boards.length < 2) printDlg.querySelector('[value="all"]').checked = true;
  showDialog(printDlg);
  setTimeout(() => printDlg.querySelector('[data-pr-btn="ok"]').focus(), 0);
}

// The pages to print, as an element ready for window.print(): the artboards
// asked for, at their real size or fitted to the paper. Async: each page's
// image is loaded (and its fonts fetched) before it's returned.
async function preparePrint({ which = 'all', board = 0, fit = false } = {}) {
  clearPrint();
  const all = allBoards();
  const boards = which === 'all' ? all : [all[board] || all[0]];
  const fontCss = await embeddedFontCss(usedGoogleFonts());
  const box = document.createElement('div');
  box.id = 'sc-print';
  const rules = [];
  for (const [i, b] of boards.entries()) {
    const svg = serialize({ board: b, fontCss, animate: false });
    const img = new Image();
    img.alt = b.name;
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const pg = document.createElement('div');
    pg.className = 'sc-print-page';
    if (!fit) {
      pg.style.page = `sc-page-${i}`;
      pg.style.width = `${b.w}px`;
      pg.style.height = `${b.h}px`;
      rules.push(`@page sc-page-${i} { size: ${b.w}px ${b.h}px; margin: 0; }`);
    }
    pg.append(img);
    box.append(pg);
    await img.decode().catch(() => {});
  }
  printCss.textContent = `
    #sc-print { display: none; }
    @media print {
      body > :not(#sc-print) { display: none !important; }
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      #sc-print { display: block; }
      .sc-print-page { break-after: page; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .sc-print-page:last-child { break-after: auto; }
      .sc-print-page img { width: 100%; height: 100%; object-fit: contain; }
      ${fit ? '.sc-print-page { width: 100%; height: 100vh; } @page { margin: 10mm; }' : ''}
      ${rules.join('\n      ')}
    }`;
  document.body.append(box);
  return box;
}

function clearPrint() {
  const box = document.getElementById('sc-print');
  if (box) {
    for (const img of box.querySelectorAll('img')) URL.revokeObjectURL(img.src);
    box.remove();
  }
  printCss.textContent = '';
}
window.addEventListener('afterprint', clearPrint);

printDlg
  .querySelector('[data-pr-btn="cancel"]')
  .addEventListener('click', () => hideDialog(printDlg));
printDlg.querySelector('[data-pr-btn="ok"]').addEventListener('click', async () => {
  const which = printDlg.querySelector('[name="sc-pr-which"]:checked').value;
  const fit = printDlg.querySelector('[name="sc-pr-size"]:checked').value === 'fit';
  const board = +printDlg.querySelector('[data-pr="board"]').value;
  hideDialog(printDlg);
  say('Preparing the pages…');
  await preparePrint({ which, board, fit });
  window.print();
});
