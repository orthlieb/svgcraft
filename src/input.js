// SVGCraft — Pointer, keyboard, drag and drop, and files.
'use strict';

// Pointer plumbing --------------------------------------------------------
let gesture = null;
let pinch = null;
let spaceDown = false;
let altDown = false; // flips the Zoom tool's direction while held
const pointers = new Map();

function abortGesture() {
  if (gesture?.tool) {
    gesture.tool.cancel?.();
    if (hIdx >= 0) restoreInIso(hist[hIdx]);
  }
  gesture = null;
}

stage.addEventListener('pointerdown', (e) => {
  if (e.isPrimary) pointers.clear();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && e.pointerType === 'touch') {
    abortGesture();
    const [a, b] = [...pointers.values()];
    pinch = {
      d: dist(a, b),
      z: state.zoom,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      px: state.panX,
      py: state.panY,
    };
    return;
  }
  if (pointers.size > 1) return;
  stage.setPointerCapture(e.pointerId);
  if (e.button === 1 || spaceDown || state.tool === 'hand') {
    e.preventDefault();
    gesture = { pan: true, sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY };
    stage.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  snapCache = null;
  snapOff = e.ctrlKey || e.metaKey;
  const gh = e.target.closest?.('[data-guide]');
  if (gh && state.tool === 'select' && !state.guidesLocked) {
    dragGuide(e, +gh.dataset.guide, stage);
    return;
  }
  const t = tools[state.tool];
  gesture = { tool: t };
  t.down?.(e, toDoc(e));
});

stage.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const p = toDoc(e);
  snapOff = e.ctrlKey || e.metaKey;
  rulerMark = p;
  if (state.rulers) drawRulers();
  $('#sc-pos').textContent =
    `${$('#sc-pos').dataset.sel || ''}   ${state.units === 'px' ? `${Math.round(p.x)}, ${Math.round(p.y)}` : `${inUnits(p.x)}, ${inUnits(p.y)} ${state.units}`}`;
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const r = stage.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = clamp((pinch.z * dist(a, b)) / pinch.d, 0.02, 64);
    const ox = pinch.mid.x - r.left;
    const oy = pinch.mid.y - r.top;
    const dx = (ox - pinch.px) / pinch.z;
    const dy = (oy - pinch.py) / pinch.z;
    state.zoom = z;
    state.panX = ox - dx * z + (mid.x - pinch.mid.x);
    state.panY = oy - dy * z + (mid.y - pinch.mid.y);
    applyView();
    return;
  }
  if (gesture?.pan) {
    state.panX = gesture.px + e.clientX - gesture.sx;
    state.panY = gesture.py + e.clientY - gesture.sy;
    applyView();
  } else if (gesture?.tool) gesture.tool.move?.(e, p);
  else if (!pointers.size || e.pointerType !== 'touch') tools[state.tool].move?.(e, p);
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) {
    if (pointers.size < 2) pinch = null;
    return;
  }
  if (gesture?.pan) stage.style.cursor = spaceDown ? 'grab' : tools[state.tool].cursor;
  else if (gesture?.tool) gesture.tool.up?.(e, toDoc(e));
  gesture = null;
  snapCache = null;
  clearSmart();
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('pointerleave', () => {
  if (state.tool === 'eraser' && !gesture) guides.replaceChildren();
});
// Pointer capture retargets dblclick to the stage itself, so hand the tool
// the element that is actually under the cursor.
stage.addEventListener('dblclick', (e) => {
  const target = document.elementFromPoint(e.clientX, e.clientY) || e.target;
  const { clientX, clientY, timeStamp } = e;
  tools[state.tool].dblclick?.({ target, clientX, clientY, timeStamp });
});
stage.addEventListener('contextmenu', (e) => e.preventDefault());

stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey)
      zoomAt(state.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else {
      state.panX -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      state.panY -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      applyView();
    }
  },
  { passive: false },
);

// Browser zoom ----------------------------------------------------------
// The editor's own zoom is for the drawing; the page itself never zooms, so
// the panels keep their size and nothing scrolls off. Ctrl/⌘ + = − 0 (also
// on the number pad) zoom the canvas, as in Photoshop, even in a field;
// Ctrl/⌘ + wheel and trackpad pinches outside the canvas do nothing.
// (Touch pinches: the viewport meta tag and touch-action in style.css.)
window.addEventListener(
  'keydown',
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const zoom = {
      Equal: 1.25,
      NumpadAdd: 1.25,
      Minus: 1 / 1.25,
      NumpadSubtract: 1 / 1.25,
      Digit0: 0,
      Numpad0: 0,
    }[e.code];
    if (zoom == null) return;
    e.preventDefault();
    e.stopPropagation();
    if (zoom) zoomAt(state.zoom * zoom);
    else fit();
  },
  true,
);
document.addEventListener('wheel', (e) => (e.ctrlKey || e.metaKey) && e.preventDefault(), {
  passive: false,
});
// Safari's trackpad pinch: zoom the canvas over it, nothing elsewhere.
let pinchFrom = 0;
for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(t, (e) => {
    e.preventDefault();
    if (!stage.contains(e.target)) return;
    if (t === 'gesturestart') pinchFrom = state.zoom;
    else if (t === 'gesturechange') {
      const r = stage.getBoundingClientRect();
      zoomAt(pinchFrom * e.scale, e.clientX - r.left, e.clientY - r.top);
    }
  });

// Keyboard ------------------------------------------------------------
// Photoshop's tool keys (U, the Shape tools, is handled on its own); R, O
// and L also pick the rectangle, ellipse and line.
const TOOL_KEYS = {
  v: 'select',
  a: 'node',
  p: 'pen',
  b: 'pencil',
  e: 'eraser',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'text',
  i: 'eyedropper',
  g: 'gradient',
  h: 'hand',
  z: 'zoom',
};

window.addEventListener('keydown', (e) => {
  // Previewing on a phone: only viewing keys (zoom, fit, open).
  if (previewMode && !/^[-+=_01]$/.test(e.key) && !((e.ctrlKey || e.metaKey) && /^o$/i.test(e.key)))
    return;
  if (openMenu && e.key === 'Escape') {
    closeMenus();
    return;
  }
  const typing = e.target.matches?.(
    'input:not([type=range]):not([type=checkbox]), textarea, select',
  );
  if (typing || e.target.isContentEditable) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === ' ') {
    if (!spaceDown) {
      spaceDown = true;
      if (!gesture) stage.style.cursor = 'grab';
    }
    e.preventDefault();
    return;
  }
  if (state.tf && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    endTransform(e.key === 'Enter');
    return;
  }
  // Browsers keep Ctrl+T / Ctrl+Shift+T for tabs, so Alt stands in.
  if (e.altKey && e.code === 'KeyT') {
    e.preventDefault();
    if (e.shiftKey) ifAllowed(mod ? 'againCopy' : 'again', () => transformAgain(mod));
    else if (!mod) ifAllowed('freeTransform', () => beginTransform('free'));
    return;
  }
  if (tools[state.tool].key?.(e)) {
    e.preventDefault();
    return;
  }
  // Ctrl+Alt+G / Ctrl+Alt+Shift+G (Photoshop's Create Clipping Mask), by
  // key position: Alt can change the character typed. Not Illustrator's
  // Ctrl+7: browsers keep Ctrl+1–8 for switching tabs.
  // File Info…: Photoshop's Ctrl+Alt+Shift+I, by key position.
  if (mod && e.altKey && e.shiftKey && e.code === 'KeyI') {
    e.preventDefault();
    openFileInfo();
    return;
  }
  if (mod && e.altKey && e.code === 'KeyP') {
    e.preventDefault();
    toggleIconPreview();
    return;
  }
  // Image Size (Ctrl+Alt+I) and Canvas Size (Ctrl+Alt+C), as in Photoshop.
  if (mod && e.altKey && !e.shiftKey && (e.code === 'KeyI' || e.code === 'KeyC')) {
    e.preventDefault();
    if (e.code === 'KeyI') openImageSize();
    else openCanvasSize();
    return;
  }
  // Ctrl+Alt+; locks the guides.
  if (mod && e.altKey && e.code === 'Semicolon') {
    e.preventDefault();
    toggleView('guidesLocked');
    return;
  }
  if (mod && e.altKey && e.code === 'KeyG') {
    e.preventDefault();
    if (e.shiftKey) ifAllowed('clipRelease', releaseClip);
    else ifAllowed('clipMake', makeClip);
    return;
  }
  if (mod) {
    const map = {
      z: () => (e.shiftKey ? redo() : undo()),
      y: redo,
      s: exportSvg,
      o: () => (e.shiftKey ? ifAllowed('createOutlines', createOutlines) : openPicker('open')),
      u: toggleSource,
      j: () => ifAllowed('duplicate', cmds.duplicate),
      d: () => setSel([]),
      a: cmds.selectAll,
      ...(e.shiftKey && { i: cmds.invertSelection }),
      g: () => (e.shiftKey ? ifAllowed('ungroup', cmds.ungroup) : cmds.group()),
      r: () => toggleView('rulers'),
    };
    // By key position, so Shift and keyboard layouts don't change them.
    const byCode = {
      BracketRight: () => ifAllowed(e.shiftKey ? 'front' : 'forward'),
      BracketLeft: () => ifAllowed(e.shiftKey ? 'back' : 'backward'),
      Semicolon: () => (e.shiftKey ? setSnapOn(!state.snap) : toggleView('guidesOn')),
      Quote: () => setGridOn(!state.grid),
    };
    const run = byCode[e.code] || map[k];
    if (run) {
      e.preventDefault();
      run();
    }
    return;
  }
  if (e.altKey) return;
  // Photoshop's other Select → Inverse key; Chrome keeps Ctrl+Shift+I.
  if (k === 'f7' && e.shiftKey) {
    e.preventDefault();
    cmds.invertSelection();
    return;
  }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k]) {
    e.preventDefault();
    const s = e.shiftKey ? 10 : 1;
    nudge(arrows[k][0] * s, arrows[k][1] * s);
  } else if (k === 'delete' || k === 'backspace') {
    e.preventDefault();
    ifAllowed('delete');
  } else if (k === 'escape') {
    if (iso) exitIso();
    else setSel([]);
  } else if (k === 'u') shapeKey(e.shiftKey);
  else if (k === 'tab') {
    // Tab hides the panels (Shift+Tab just the right-hand ones) while
    // you're working on the canvas; with a control focused it moves focus.
    const at = document.activeElement;
    if (
      (at && at !== document.body && !stage.contains(at)) ||
      document.querySelector('dialog[open]')
    )
      return;
    e.preventDefault();
    togglePanels(e.shiftKey);
  } else if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
  else if (k === 'x') swapPaint();
  else if (k === 'd') defaultPaint();
  // Photoshop's brush size keys: the stroke width.
  else if (e.code === 'BracketRight' || e.code === 'BracketLeft')
    setStrokeWidthBy(e.code === 'BracketRight' ? 1 : -1);
  else if (k === '+' || k === '=') zoomAt(state.zoom * 1.25);
  else if (k === '-' || k === '_') zoomAt(state.zoom / 1.25);
  else if (k === '0') fit();
  else if (k === '1') zoomAt(1);
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    if (!gesture) stage.style.cursor = tools[state.tool].cursor;
  }
});

// Clipboard: copy / cut the selection as SVG, paste SVG markup or images.
document.addEventListener('copy', (e) => {
  if (
    e.target.matches?.('input, textarea') ||
    e.target.isContentEditable ||
    !state.sel.length ||
    inSource(e)
  )
    return;
  e.clipboardData.setData('text/plain', serialize({ selection: true }));
  e.preventDefault();
});
document.addEventListener('cut', (e) => {
  if (
    e.target.matches?.('input, textarea') ||
    e.target.isContentEditable ||
    !state.sel.length ||
    inSource(e)
  )
    return;
  e.clipboardData.setData('text/plain', serialize({ selection: true }));
  e.preventDefault();
  cmds.delete();
});
document.addEventListener('paste', (e) => {
  if (previewMode) return;
  if (e.target.matches?.('input, textarea') || e.target.isContentEditable) return;
  const file = [...(e.clipboardData?.files || [])][0];
  if (file) {
    e.preventDefault();
    importFile(file, 'place');
    return;
  }
  const text = e.clipboardData?.getData('text/plain') || '';
  if (/<svg[\s>]/i.test(text)) {
    e.preventDefault();
    try {
      placeSvg(text.slice(text.search(/<svg[\s>]/i)));
    } catch (err) {
      say(err.message);
    }
  }
});

// Drag & drop ---------------------------------------------------------
const drop = $('#sc-drop');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  drop.classList.add('on');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove('on');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('on');
  for (const file of e.dataTransfer?.files || []) importFile(file, previewMode ? 'open' : 'auto');
});

// Files -------------------------------------------------------------
let pickMode = 'open';
function openPicker(mode) {
  pickMode = mode;
  $('#sc-file').click();
}
$('#sc-file').addEventListener('change', (e) => {
  importFile(e.target.files[0], pickMode);
  e.target.value = '';
});
