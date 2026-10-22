// SVGCraft — Tooltips.
'use strict';

// Tooltips -------------------------------------------------------------
// One shared box for every [data-tip]. It's a popover, so it sits in the top
// layer above menus, panels and dialogs, and hides itself after a few
// seconds. Tools add data-tip-desc for a second, explanatory line.
const tip = document.createElement('div');
tip.className = 'sc-tip';
tip.hidden = true;
tip.setAttribute('aria-hidden', 'true');
if ('popover' in tip) tip.popover = 'manual';
document.body.append(tip);
const TIP_DELAY = 450;
const TIP_LIFE = 3000;
let tipFor = null;
let tipWait = 0;
let tipLife = 0;
let tipLast = 0;

function fillTip(el) {
  const text = el.dataset.tip;
  const desc = el.dataset.tipDesc;
  tip.replaceChildren();
  if (!desc) return tip.append(text);
  const [name, ...keys] = text.split(' · ');
  const b = document.createElement('b');
  b.textContent = name;
  tip.append(b);
  if (keys.length) {
    const k = document.createElement('kbd');
    k.textContent = keys.join(' · ');
    tip.append(k);
  }
  const p = document.createElement('p');
  p.textContent = desc;
  tip.append(p);
}

function placeTip(el) {
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const vw = innerWidth;
  const vh = innerHeight;
  const gap = 6;
  let x;
  let y;
  if (el.closest('.sc-tools')) {
    // Beside the toolbar, like Photoshop.
    x = r.right + gap + 2;
    y = r.top + r.height / 2 - t.height / 2;
  } else {
    x = r.left + r.width / 2 - t.width / 2;
    y = r.bottom + gap;
    if (y + t.height > vh - 4) y = r.top - gap - t.height;
  }
  // Whole pixels, rounded towards the inside so the far edge stays in view.
  tip.style.left = `${Math.max(4, Math.min(Math.round(x), Math.floor(vw - t.width - 4)))}px`;
  tip.style.top = `${Math.max(4, Math.min(Math.round(y), Math.floor(vh - t.height - 4)))}px`;
}

function showTip(el, life = TIP_LIFE) {
  clearTimeout(tipWait);
  clearTimeout(tipLife);
  if (!el.isConnected || !el.dataset.tip) return;
  tipFor = el;
  fillTip(el);
  tip.hidden = false;
  // Re-enter the top layer so the tip lands above a dialog opened since.
  if (tip.popover) {
    if (tip.matches(':popover-open')) tip.hidePopover();
    tip.showPopover();
  }
  placeTip(el);
  tip.classList.add('on');
  tipLife = setTimeout(hideTip, life);
}

function hideTip() {
  clearTimeout(tipWait);
  clearTimeout(tipLife);
  if (tip.hidden) return;
  tipLast = Date.now();
  tip.classList.remove('on');
  if (tip.popover && tip.matches(':popover-open')) tip.hidePopover();
  tip.hidden = true;
}

document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch' || e.buttons) return;
  const el = e.target.closest?.('[data-tip]');
  if (!el || el === tipFor) return;
  hideTip();
  tipFor = el;
  // Sweeping along a row of buttons shows each tip straight away.
  const quick = Date.now() - tipLast < 600;
  tipWait = setTimeout(() => showTip(el), quick ? 0 : TIP_DELAY);
});
document.addEventListener('pointerout', (e) => {
  if (!tipFor || e.pointerType === 'touch') return;
  if (e.relatedTarget && tipFor.contains(e.relatedTarget)) return;
  if (!tipFor.contains(e.target)) return;
  hideTip();
  tipFor = null;
});
// Pressing hides the tip; a tap on a touch screen shows it briefly.
document.addEventListener(
  'pointerdown',
  (e) => {
    hideTip();
    if (e.pointerType !== 'touch') return;
    const el = e.target.closest?.('[data-tip]');
    tipFor = el;
    if (el) tipWait = setTimeout(() => showTip(el, 2500), 350);
  },
  true,
);
document.addEventListener('focusin', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el && e.target.matches(':focus-visible')) showTip(el);
});
document.addEventListener('focusout', () => {
  hideTip();
  tipFor = null;
});
document.addEventListener('keydown', hideTip, true);
document.addEventListener('wheel', hideTip, { capture: true, passive: true });
window.addEventListener('blur', hideTip);
