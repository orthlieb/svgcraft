// SVGCraft — Artboards: more than one page in a drawing.
'use strict';

// The drawing's own page (0, 0, state.w × state.h) is the first artboard;
// state.boards holds the others, in document coordinates, each
// { name, x, y, w, h }. They're drawn behind the art like the first, named
// above their top-left corners. Saved, the file's viewBox covers them all and
// data-sc-artboards lists them (the first included), so it reopens with every
// artboard; File → Export Artboards… writes one clean SVG per artboard.
const mainBoard = () => ({
  name: state.boardName || 'Artboard 1',
  x: 0,
  y: 0,
  w: state.w,
  h: state.h,
});
const allBoards = () => [mainBoard(), ...state.boards];
function boardsBox() {
  const all = allBoards();
  const x = Math.min(...all.map((b) => b.x));
  const y = Math.min(...all.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...all.map((b) => b.x + b.w)) - x,
    h: Math.max(...all.map((b) => b.y + b.h)) - y,
  };
}

// A saved list (data-sc-artboards) read back: the first is the page, the
// rest the extra artboards. Anything malformed is dropped.
function readBoards(attr) {
  let list;
  try {
    list = JSON.parse(attr || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const ok = list
    .filter((b) => b && ['x', 'y', 'w', 'h'].every((k) => isFinite(+b[k])) && +b.w > 0 && +b.h > 0)
    .map((b, i) => ({
      name: String(b.name ?? `Artboard ${i + 1}`).slice(0, 80),
      x: +b.x,
      y: +b.y,
      w: +b.w,
      h: +b.h,
    }));
  return ok.length > 1 ? ok : null;
}

let boardSel = -1; // the artboard the Artboard tool has picked (0: the page)

// The extra artboards' pages (behind the art), their frames and every name
// (over it), and the picked one's outline and size handle.
function renderBoards() {
  const back = $('#sc-boards');
  const front = $('#sc-board-names');
  back.replaceChildren();
  front.replaceChildren();
  const z = state.zoom;
  const many = state.boards.length > 0;
  allBoards().forEach((b, i) => {
    const r = { x: b.x, y: b.y, width: b.w, height: b.h };
    if (i > 0) {
      mk('rect', { ...r, fill: 'url(#sc-checker)', class: 'sc-board-page' }, back);
      mk('rect', { ...r, fill: 'none', class: 'sc-board-edge' }, front);
    }
    if (many || state.tool === 'artboard') {
      const t = mk(
        'text',
        {
          x: b.x,
          y: b.y - 6 / z,
          'font-size': 11 / z,
          class: 'sc-board-name' + (i === boardSel ? ' sel' : ''),
        },
        front,
      );
      t.textContent = b.name;
    }
    if (state.tool === 'artboard' && i === boardSel) {
      mk('rect', { ...r, fill: 'none', class: 'sc-board-sel' }, front);
      const s = 8 / z;
      mk(
        'rect',
        { x: b.x + b.w - s / 2, y: b.y + b.h - s / 2, width: s, height: s, class: 'sc-board-grip' },
        front,
      );
    }
  });
}

// The Artboard tool's options bar: the picked artboard's name and size.
function syncBoardOpts() {
  const b = allBoards()[boardSel];
  for (const id of ['#sc-board-name', '#sc-board-w', '#sc-board-h']) $(id).disabled = !b;
  $('#sc-board-name').value = b ? b.name : '';
  $('#sc-board-w').value = b ? f(b.w) : '';
  $('#sc-board-h').value = b ? f(b.h) : '';
  syncActions();
}

// Change the picked artboard (the page goes through setSize).
function setBoard(i, props) {
  if (i === 0) {
    if ('name' in props) state.boardName = props.name;
    if ('w' in props || 'h' in props) setSize(props.w ?? state.w, props.h ?? state.h);
  } else Object.assign(state.boards[i - 1], props);
  renderBoards();
}

function deleteBoard() {
  if (boardSel < 0) return warn('Click an artboard with the Artboard tool first.');
  if (boardSel === 0)
    return warn('The first artboard is the drawing’s own page, so it can’t be deleted.');
  const [gone] = state.boards.splice(boardSel - 1, 1);
  boardSel = -1;
  noteStep('Delete Artboard');
  commit();
  renderBoards();
  syncBoardOpts();
  say(`Deleted “${gone.name}”. The art on it stays.`);
}

// Every artboard as its own clean SVG, in one zip.
function exportArtboards() {
  const used = new Set();
  const files = allBoards().map((b) => {
    let name = b.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Artboard';
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${b.name} ${n}`;
    used.add(name.toLowerCase());
    return [`${name}.svg`, cleanSvgText(serialize({ board: b }), CLEAN_DEFAULTS)];
  });
  download(zipBlob(files), `${state.fileName || 'drawing'}-artboards.zip`);
  say(`Exported ${files.length} artboard${files.length > 1 ? 's' : ''}.`);
  return files;
}

tools.artboard = {
  hint: 'Drag on the pasteboard to add an artboard · Drag one to move it, its corner to resize it · Del deletes it',
  cursor: 'crosshair',
  enter() {
    boardSel = -1;
    renderBoards();
    syncBoardOpts();
  },
  leave() {
    boardSel = -1;
    this.g = null;
    guides.replaceChildren();
    renderBoards();
  },
  restored() {
    if (boardSel > state.boards.length) boardSel = -1;
    renderBoards();
    syncBoardOpts();
  },
  down(e, p) {
    const all = allBoards();
    const z = state.zoom;
    const s = all[boardSel];
    if (s && Math.abs(p.x - (s.x + s.w)) < 8 / z && Math.abs(p.y - (s.y + s.h)) < 8 / z) {
      this.g = { mode: 'size', i: boardSel, b0: { ...s }, p0: p };
      return;
    }
    let i = -1;
    for (let k = all.length - 1; k >= 0; k--) {
      const b = all[k];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        i = k;
        break;
      }
    }
    boardSel = i;
    // The page stays where it is (the art is measured from its corner).
    this.g =
      i > 0 ? { mode: 'move', i, b0: { ...all[i] }, p0: p } : i < 0 ? { mode: 'new', p0: p } : null;
    renderBoards();
    syncBoardOpts();
  },
  move(e, p) {
    const g = this.g;
    if (!g) return;
    const dx = Math.round(p.x - g.p0.x);
    const dy = Math.round(p.y - g.p0.y);
    if (g.mode === 'new') {
      guides.replaceChildren();
      mk(
        'rect',
        {
          x: Math.min(g.p0.x, p.x),
          y: Math.min(g.p0.y, p.y),
          width: Math.abs(p.x - g.p0.x),
          height: Math.abs(p.y - g.p0.y),
          class: 'sc-ov sc-ov-dash',
        },
        guides,
      );
      return;
    }
    if (!dx && !dy && !g.moved) return;
    g.moved = true;
    if (g.mode === 'move') setBoard(g.i, { x: g.b0.x + dx, y: g.b0.y + dy });
    else setBoard(g.i, { w: Math.max(1, g.b0.w + dx), h: Math.max(1, g.b0.h + dy) });
    syncBoardOpts();
  },
  up(e, p) {
    const g = this.g;
    this.g = null;
    guides.replaceChildren();
    if (!g) return;
    if (g.mode === 'new') {
      const x = Math.round(Math.min(g.p0.x, p.x));
      const y = Math.round(Math.min(g.p0.y, p.y));
      const w = Math.round(Math.abs(p.x - g.p0.x));
      const h = Math.round(Math.abs(p.y - g.p0.y));
      if (w * state.zoom < 4 || h * state.zoom < 4) return;
      state.boards.push({ name: `Artboard ${allBoards().length + 1}`, x, y, w, h });
      boardSel = state.boards.length;
      noteStep('New Artboard');
      commit();
    } else if (g.moved) {
      noteStep(g.mode === 'move' ? 'Move Artboard' : 'Resize Artboard');
      commit();
    }
    renderBoards();
    syncBoardOpts();
  },
  cancel() {
    this.g = null;
    guides.replaceChildren();
  },
};

// The options bar's fields.
$('#sc-board-name').addEventListener('change', (e) => {
  if (boardSel < 0) return;
  setBoard(boardSel, { name: e.target.value.trim().slice(0, 80) || `Artboard ${boardSel + 1}` });
  noteStep('Rename Artboard');
  commit();
  syncBoardOpts();
});
for (const k of ['w', 'h'])
  $(`#sc-board-${k}`).addEventListener('change', (e) => {
    const v = Math.round(+e.target.value);
    if (boardSel < 0 || !(v > 0)) return syncBoardOpts();
    setBoard(boardSel, { [k]: v });
    noteStep('Resize Artboard');
    commit();
    syncBoardOpts();
  });
