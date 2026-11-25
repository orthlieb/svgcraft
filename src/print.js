// SVGCraft — File → Print… (Ctrl+P). A module of its own: loaded the first
// time it's used (loadModule in src/core.js), listed in index.html's
// on-demand <template> so it's kept for offline use and counted in the
// version.
'use strict';

// The canvas prints at its real size (a CSS px is 1/96 in, so a drawing set
// up in mm prints in mm), or fitted to the paper. The page is the drawing
// as an image, so its ids can't clash with the editor's, and the fonts are embedded as for a PNG. While they
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
        <legend>Size</legend>
        <label class="sc-check"><input type="radio" name="sc-pr-size" value="actual" checked />
          Actual size, on a page the canvas's size</label>
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
  showDialog(printDlg);
  setTimeout(() => printDlg.querySelector('[data-pr-btn="ok"]').focus(), 0);
}

// The page to print, as an element ready for window.print(): the canvas,
// at its real size or fitted to the paper. Async: the page's image is
// loaded (and its fonts fetched) before it's returned.
async function preparePrint({ fit = false } = {}) {
  clearPrint();
  const boards = [{ name: state.fileName || 'Drawing', x: 0, y: 0, w: state.w, h: state.h }];
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
  const fit = printDlg.querySelector('[name="sc-pr-size"]:checked').value === 'fit';
  hideDialog(printDlg);
  say('Preparing the pages…');
  await preparePrint({ fit });
  window.print();
});
