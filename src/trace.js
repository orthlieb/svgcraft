// SVGCraft — Image → Image Trace…: a placed bitmap turned into shapes.
'use strict';

// Illustrator's Image Trace, done the way it's done there: reduce the image
// to a few colours, trace each colour's outline, smooth the outlines into
// curves, and put each colour on its own layer. Stacked (the default)
// orders the colours largest first and fills each layer with its colour
// and every colour above it, so the layers overlap and no hairline gaps
// show between them; Abutting gives each colour only its own area.
//
// The pixel work runs in a worker made from the function below (a blob
// URL, so it works from file:// too), or on the page if workers aren't
// available. Images are traced at 400–1000 px on the long side.

// ---- the worker ------------------------------------------------------------------
// Input: { id, data (RGBA), w, h, o: options }. Output: { id, layers: [{ hex,
// area, loops: [Float32Array x,y,…] }] }, in stacking order, bottom first.
// `scope` is the worker's global (or a stand-in on the page).
function traceWorker(scope) {
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  const fl = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  function lab(r, g, b) {
    const R = LIN[r];
    const G = LIN[g];
    const B = LIN[b];
    const x = fl((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
    const y = fl(0.2126 * R + 0.7152 * G + 0.0722 * B);
    const z = fl((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  // k-means in Lab (k-means++ start, on a sample), then every pixel to its
  // nearest centre. Greyscale clusters on lightness alone.
  function kmeans(P, n, k, grey) {
    const dims = grey ? 1 : 3;
    const step = Math.max(1, Math.floor(n / 20000));
    const sample = [];
    for (let i = 0; i < n; i += step) sample.push(i);
    const dist = (i, c) => {
      let d = 0;
      for (let j = 0; j < dims; j++) {
        const t = P[i * 3 + j] - c[j];
        d += t * t;
      }
      return d;
    };
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const centres = [Array.from(P.subarray(sample[0] * 3, sample[0] * 3 + 3))];
    const best = new Float64Array(sample.length).fill(Infinity);
    while (centres.length < k) {
      const c = centres[centres.length - 1];
      let total = 0;
      for (let s = 0; s < sample.length; s++) {
        best[s] = Math.min(best[s], dist(sample[s], c));
        total += best[s];
      }
      if (!total) break;
      let r = rnd() * total;
      let pick = sample.length - 1;
      for (let s = 0; s < sample.length; s++)
        if ((r -= best[s]) <= 0) {
          pick = s;
          break;
        }
      centres.push(Array.from(P.subarray(sample[pick] * 3, sample[pick] * 3 + 3)));
    }
    for (let it = 0; it < 12; it++) {
      const sum = centres.map(() => [0, 0, 0, 0]);
      for (const i of sample) {
        let bi = 0;
        let bd = Infinity;
        for (let c = 0; c < centres.length; c++) {
          const d = dist(i, centres[c]);
          if (d < bd) [bd, bi] = [d, c];
        }
        const s = sum[bi];
        for (let j = 0; j < 3; j++) s[j] += P[i * 3 + j];
        s[3]++;
      }
      let moved = 0;
      centres.forEach((c, ci) => {
        const s = sum[ci];
        if (!s[3]) return;
        for (let j = 0; j < 3; j++) {
          const v = s[j] / s[3];
          moved += Math.abs(v - c[j]);
          c[j] = v;
        }
      });
      if (moved < 0.01) break;
    }
    return centres;
  }

  // Anti-aliased edges make colours of their own: slivers, a few pixels
  // wide, along the borders between real colours (thicker when a small
  // image is scaled up). A colour with almost no solid inside (5 × 5 patches
  // of itself) is one of those, and folds into the colours around it.
  function thinOut(label, w, h, k) {
    const n = w * h;
    const core = new Int32Array(k);
    const all = new Int32Array(k);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = label[y * w + x];
        if (c < 0) continue;
        all[c]++;
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
        let solid = true;
        for (let dy = -2; dy <= 2 && solid; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (label[(y + dy) * w + x + dx] !== c) {
              solid = false;
              break;
            }
        if (solid) core[c]++;
      }
    const sliver = Array.from(all, (a, c) => a > 0 && core[c] / a < 0.05);
    if (!sliver.some(Boolean) || sliver.every((v, c) => v || !all[c])) return;
    // From the edges in: a pixel takes the commonest solid colour next to it.
    for (let pass = 0; pass < 6; pass++) {
      const next = label.slice();
      let left = 0;
      for (let p = 0; p < n; p++) {
        const c = label[p];
        if (c < 0 || !sliver[c]) continue;
        const x = p % w;
        const y = (p / w) | 0;
        const votes = new Map();
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = label[yy * w + xx];
            if (q >= 0 && !sliver[q]) votes.set(q, (votes.get(q) || 0) + 1);
          }
        let to = c;
        let most = 0;
        for (const [q, m] of votes) if (m > most) [most, to] = [m, q];
        next[p] = to;
        if (to === c) left++;
      }
      label.set(next);
      if (!left) break;
    }
  }

  // Pieces smaller than `min` pixels join the colour around them most
  // (with `clear`, transparency counts as a colour too).
  function despeckle(lab8, w, h, min, clear = false) {
    if (min < 2) return;
    const n = w * h;
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    const comp = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      const v = lab8[s];
      let top = 0;
      let len = 0;
      stack[top++] = s;
      seen[s] = 1;
      comp.length = 0;
      while (top) {
        const p = stack[--top];
        comp.push(p);
        len++;
        const x = p % w;
        const y = (p / w) | 0;
        const nb = [
          x > 0 ? p - 1 : -1,
          x < w - 1 ? p + 1 : -1,
          y > 0 ? p - w : -1,
          y < h - 1 ? p + w : -1,
        ];
        for (const q of nb)
          if (q >= 0 && !seen[q] && lab8[q] === v) {
            seen[q] = 1;
            stack[top++] = q;
          }
      }
      if (len >= min || v < 0) continue;
      const votes = new Map();
      for (const p of comp) {
        const x = p % w;
        const y = (p / w) | 0;
        for (const q of [
          x > 0 ? p - 1 : -1,
          x < w - 1 ? p + 1 : -1,
          y > 0 ? p - w : -1,
          y < h - 1 ? p + w : -1,
        ])
          if (q >= 0 && lab8[q] !== v) votes.set(lab8[q], (votes.get(lab8[q]) || 0) + 1);
      }
      let to = v;
      let most = 0;
      for (const [c, m] of votes) if (m > most && (c >= 0 || clear)) [most, to] = [m, c];
      if (to !== v) for (const p of comp) lab8[p] = to;
    }
  }

  // Outlines of a mask as closed loops of pixel-corner points, inside on
  // the right; at a pinch (two pixels touching at a corner) the walk turns
  // right, so diagonal neighbours stay separate shapes.
  function loopsOf(inside, w, h) {
    const W = w + 1;
    const out = new Uint8Array(W * (h + 1));
    const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!inside[y * w + x]) continue;
        if (!at(x, y - 1)) out[y * W + x] |= 1; // right, along the top
        if (!at(x + 1, y)) out[y * W + x + 1] |= 2; // down the right side
        if (!at(x, y + 1)) out[(y + 1) * W + x + 1] |= 4; // left, along the bottom
        if (!at(x - 1, y)) out[(y + 1) * W + x] |= 8; // up the left side
      }
    const DX = [1, 0, -1, 0];
    const DY = [0, 1, 0, -1];
    const loops = [];
    for (let v0 = 0; v0 < out.length; v0++) {
      while (out[v0]) {
        let d = Math.log2(out[v0] & -out[v0]);
        out[v0] &= ~(1 << d);
        const d0 = d;
        let x = v0 % W;
        let y = (v0 / W) | 0;
        const pts = [x, y];
        for (;;) {
          x += DX[d];
          y += DY[d];
          const v = y * W + x;
          const avail = out[v] | (v === v0 ? 1 << d0 : 0);
          let nd = -1;
          for (const t of [(d + 1) % 4, d, (d + 3) % 4])
            if (avail & (1 << t)) {
              nd = t;
              break;
            }
          if (nd < 0 || (v === v0 && nd === d0)) break;
          out[v] &= ~(1 << nd);
          pts.push(x, y);
          d = nd;
        }
        if (pts.length >= 6) loops.push(pts);
      }
    }
    return loops;
  }

  // A traced outline is a pixel staircase. Smoothing averages each point
  // with r neighbours either side, except real corners: a turn with a
  // straight run of 3+ pixels on both sides (a rectangle's corner, not a
  // step of a slanted edge), which stays put.
  function smoothLoop(pts, r) {
    const n = pts.length / 2;
    const fixed = new Uint8Array(n);
    const dir = (i) => {
      const a = ((i % n) + n) % n;
      const b = (a + 1) % n;
      return (pts[b * 2] - pts[a * 2]) * 3 + (pts[b * 2 + 1] - pts[a * 2 + 1]);
    };
    const run = (i, step) => {
      const d = dir(i);
      let k = 1;
      while (k < 4 && dir(i + step * k) === d) k++;
      return k;
    };
    for (let i = 0; i < n; i++)
      if (dir(i - 1) !== dir(i) && run(i - 1, -1) >= 3 && run(i, 1) >= 3) fixed[i] = 1;
    if (!r) return { pts, fixed };
    const out = new Float32Array(pts.length);
    for (let i = 0; i < n; i++) {
      if (fixed[i]) {
        out[i * 2] = pts[i * 2];
        out[i * 2 + 1] = pts[i * 2 + 1];
        continue;
      }
      let sx = 0;
      let sy = 0;
      for (let k = -r; k <= r; k++) {
        const j = (((i + k) % n) + n) % n;
        sx += pts[j * 2];
        sy += pts[j * 2 + 1];
      }
      out[i * 2] = sx / (2 * r + 1);
      out[i * 2 + 1] = sy / (2 * r + 1);
    }
    return { pts: out, fixed };
  }

  // Douglas–Peucker on a closed loop, split at its two farthest-apart
  // points and at the fixed corners, which are always kept.
  function simplify(pts, eps, fixed) {
    const n = pts.length / 2;
    const P = (i) => [pts[(i % n) * 2], pts[(i % n) * 2 + 1]];
    let far = 0;
    let fd = -1;
    for (let i = 1; i < n; i++) {
      const [x, y] = P(i);
      const d = (x - pts[0]) ** 2 + (y - pts[1]) ** 2;
      if (d > fd) [fd, far] = [d, i];
    }
    const keep = new Uint8Array(n + 1);
    keep[0] = keep[far] = keep[n] = 1;
    for (let i = 0; i < n; i++) if (fixed[i]) keep[i] = 1;
    const stack = [];
    for (let a = 0, b = 1; b <= n; b++)
      if (keep[b]) {
        stack.push([a, b]);
        a = b;
      }
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = P(a);
      const [bx, by] = P(b);
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-9;
      let max = 0;
      let idx = -1;
      for (let i = a + 1; i < b; i++) {
        const [x, y] = P(i);
        const d = Math.abs(dy * x - dx * y + bx * ay - by * ax) / len;
        if (d > max) [max, idx] = [d, i];
      }
      if (max > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(...P(i));
    return new Float32Array(out);
  }

  // A loop that's an ellipse (or circle), at any angle: the ellipse with
  // its area, centre and second moments, kept if every point of the
  // outline is within about a pixel of it. Returned as [NaN, cx, cy, rx,
  // ry, degrees].
  function ellipseOf(pts) {
    const n = pts.length / 2;
    if (n < 12) return null;
    let A = 0;
    let Sx = 0;
    let Sy = 0;
    let Sxx = 0;
    let Syy = 0;
    let Sxy = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [x0, y0, x1, y1] = [pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]];
      const cr = x0 * y1 - x1 * y0;
      A += cr;
      Sx += (x0 + x1) * cr;
      Sy += (y0 + y1) * cr;
      Sxx += (x0 * x0 + x0 * x1 + x1 * x1) * cr;
      Syy += (y0 * y0 + y0 * y1 + y1 * y1) * cr;
      Sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cr;
    }
    A /= 2;
    if (Math.abs(A) < 30) return null;
    const cx = Sx / (6 * A);
    const cy = Sy / (6 * A);
    const mxx = Sxx / (12 * A) - cx * cx;
    const myy = Syy / (12 * A) - cy * cy;
    const mxy = Sxy / (24 * A) - cx * cy;
    const tr = (mxx + myy) / 2;
    const det = Math.sqrt(Math.max(0, ((mxx - myy) / 2) ** 2 + mxy * mxy));
    const a = 2 * Math.sqrt(Math.max(0, tr + det));
    const b = 2 * Math.sqrt(Math.max(0, tr - det));
    if (b < 3) return null;
    const th = 0.5 * Math.atan2(2 * mxy, mxx - myy);
    const [co, si] = [Math.cos(th), Math.sin(th)];
    // A step along the pixel staircase is up to ~0.7 px off a true curve.
    const tol = 1.2 + 0.015 * b;
    for (let i = 0; i < n; i++) {
      const dx = pts[i * 2] - cx;
      const dy = pts[i * 2 + 1] - cy;
      const u = (dx * co + dy * si) / a;
      const v = (-dx * si + dy * co) / b;
      const r = Math.hypot(u, v);
      // Distance off the ellipse, roughly, in pixels.
      if ((Math.abs(r - 1) * Math.hypot(u * a, v * b)) / (r || 1) > tol) return null;
    }
    return new Float32Array([NaN, cx, cy, a, b, (th * 180) / Math.PI]);
  }

  // A loop that's a rectangle, at any angle, with square or evenly rounded
  // corners: the smallest box round it (rotating callipers on its hull),
  // the corner radius from how far the outline stays off the box's corners,
  // kept if every point is within about a pixel of that shape. Returned as
  // [NaN, cx, cy, half width, half height, degrees, radius].
  function rectOf(pts) {
    const n = pts.length / 2;
    if (n < 8) return null;
    const P = [];
    for (let i = 0; i < n; i++) P.push([pts[i * 2], pts[i * 2 + 1]]);
    // Convex hull (monotone chain).
    const S = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => {
      const out = [];
      for (const p of list) {
        while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0)
          out.pop();
        out.push(p);
      }
      out.pop();
      return out;
    };
    const hull = [...half(S), ...half(S.slice().reverse())];
    if (hull.length < 3) return null;
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const t = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const [c, s] = [Math.cos(t), Math.sin(t)];
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const [x, y] of hull) {
        const u = x * c + y * s;
        const v = -x * s + y * c;
        x0 = Math.min(x0, u);
        x1 = Math.max(x1, u);
        y0 = Math.min(y0, v);
        y1 = Math.max(y1, v);
      }
      const area = (x1 - x0) * (y1 - y0);
      if (!best || area < best.area) best = { area, t, x0, x1, y0, y1 };
    }
    const { t, x0, x1, y0, y1 } = best;
    let hw = (x1 - x0) / 2;
    let hh = (y1 - y0) / 2;
    // Small blobs fit a box within a pixel without being boxes.
    if (hw < 6 || hh < 6) return null;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const uc = (x0 + x1) / 2;
    const vc = (y0 + y1) / 2;
    const cx = uc * c - vc * s;
    const cy = uc * s + vc * c;
    // Each point in the box's own frame, centred.
    const L = P.map(([x, y]) => [(x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c]);
    // Corner radius: a rounded corner keeps r(√2 − 1) off the box corner,
    // plus about a pixel that the outline's steps keep off any corner.
    const rs = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([kx, ky]) => {
      let m = Infinity;
      for (const [u, v] of L) m = Math.min(m, Math.hypot(u - kx, v - ky));
      return Math.max(0, m - 1.2) / (Math.SQRT2 - 1);
    });
    const rmin = Math.min(...rs);
    const rmax = Math.max(...rs);
    if (rmax - rmin > 3 + 0.2 * rmax) return null;
    // The radius that fits best near that estimate (or square corners),
    // with the box inset by up to a pixel (it's round the outermost pixel
    // corners): the outline's largest distance from the rounded rectangle.
    const off = (r, inset) => {
      const [bw, bh] = [hw - inset, hh - inset];
      let worst = 0;
      for (const [u, v] of L) {
        const qx = Math.abs(u) - (bw - r);
        const qy = Math.abs(v) - (bh - r);
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
        worst = Math.max(worst, Math.abs(d));
      }
      return worst;
    };
    const r0 = (rmin + rmax) / 2;
    let round = { fit: Infinity, r: 0, inset: 0 };
    let square = { fit: Infinity, r: 0, inset: 0 };
    for (const inset of [0, 0.25, 0.5, 0.75, 1]) {
      const sq = off(0, inset);
      if (sq < square.fit) square = { fit: sq, r: 0, inset };
      for (let c = Math.max(2, r0 - 5); c <= Math.min(r0 + 5, hw - inset, hh - inset); c += 0.5) {
        const e = off(c, inset);
        if (e < round.fit) round = { fit: e, r: c, inset };
      }
    }
    // Square corners unless rounding fits clearly better.
    const pick = round.fit < square.fit - 0.5 ? round : square;
    if (pick.fit > 1.2 + 0.01 * Math.min(hw, hh)) return null;
    const r = pick.r;
    hw -= pick.inset;
    hh -= pick.inset;
    // Corners that take up most of a near-square's sides make a circle.
    if (r > 0.8 * Math.min(hw, hh) && Math.abs(hw - hh) < 0.2 * Math.max(hw, hh)) {
      const rad = (hw + hh) / 2;
      return new Float32Array([NaN, cx, cy, rad, rad, 0]);
    }
    // The angle between -45° and 45°, the sides swapped to suit.
    let deg = (t * 180) / Math.PI;
    while (deg > 45) {
      deg -= 90;
      [hw, hh] = [hh, hw];
    }
    while (deg <= -45) {
      deg += 90;
      [hw, hh] = [hh, hw];
    }
    return new Float32Array([NaN, cx, cy, hw, hh, deg, r]);
  }

  function trace({ id, data, w, h, o }) {
    const n = w * h;
    const opaque = new Uint8Array(n);
    const P = new Float32Array(n * 3);
    let m = 0;
    const idx = new Int32Array(n);
    for (let p = 0; p < n; p++) {
      if (data[p * 4 + 3] < 128) continue;
      opaque[p] = 1;
      const [L, A, B] = lab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
      P[m * 3] = L;
      P[m * 3 + 1] = o.mode === 'grey' ? 0 : A;
      P[m * 3 + 2] = o.mode === 'grey' ? 0 : B;
      idx[m++] = p;
    }
    // Each pixel's colour (-1: transparent).
    const label = new Int16Array(n).fill(-1);
    let k;
    if (o.mode === 'bw') {
      k = 2;
      for (let i = 0; i < m; i++) label[idx[i]] = P[i * 3] < (o.threshold / 255) * 100 ? 1 : 0;
    } else {
      let centres = m ? kmeans(P, m, Math.min(o.colours, m), o.mode === 'grey') : [];
      // "Up to" that many: centres that look the same (ΔE under 4) are one
      // colour, so a flat image keeps only the colours it has.
      const merged = [];
      for (const c of centres)
        if (!merged.some((d) => Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]) < 4))
          merged.push(c);
      centres = merged;
      k = centres.length;
      const dims = o.mode === 'grey' ? 1 : 3;
      for (let i = 0; i < m; i++) {
        let bi = 0;
        let bd = Infinity;
        for (let c = 0; c < k; c++) {
          let d = 0;
          for (let j = 0; j < dims; j++) d += (P[i * 3 + j] - centres[c][j]) ** 2;
          if (d < bd) [bd, bi] = [d, c];
        }
        label[idx[i]] = bi;
      }
    }
    if (o.mode !== 'bw' && o.speck >= 2) thinOut(label, w, h, k);
    despeckle(label, w, h, o.speck);
    // The background: the colour round the edge, cleared where it's
    // connected to the edge.
    if (o.ignoreBg) {
      const edge = new Map();
      for (let x = 0; x < w; x++)
        for (const p of [x, (h - 1) * w + x]) edge.set(label[p], (edge.get(label[p]) || 0) + 1);
      for (let y = 0; y < h; y++)
        for (const p of [y * w, y * w + w - 1]) edge.set(label[p], (edge.get(label[p]) || 0) + 1);
      let bg = -1;
      let most = 0;
      for (const [c, cnt] of edge) if (c >= 0 && cnt > most) [most, bg] = [cnt, c];
      if (bg >= 0) {
        const stack = [];
        const push = (p) => {
          if (label[p] === bg) {
            label[p] = -1;
            stack.push(p);
          }
        };
        for (let x = 0; x < w; x++) {
          push(x);
          push((h - 1) * w + x);
        }
        for (let y = 0; y < h; y++) {
          push(y * w);
          push(y * w + w - 1);
        }
        while (stack.length) {
          const p = stack.pop();
          const x = p % w;
          const y = (p / w) | 0;
          if (x > 0) push(p - 1);
          if (x < w - 1) push(p + 1);
          if (y > 0) push(p - w);
          if (y < h - 1) push(p + w);
        }
      }
    }
    // Specks the background left behind go with it.
    if (o.ignoreBg) despeckle(label, w, h, o.speck, true);
    // Colours by area, largest first (the bottom layer). Each colour is the
    // mean of its solid inside (5 × 5 patches of it), away from edges that
    // blend into the colours next to it; a colour with no such inside uses
    // all its pixels.
    const stats = Array.from({ length: k }, () => [0, 0, 0, 0]);
    const inner = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const c = label[p];
        if (c < 0) continue;
        const s = stats[c];
        s[0] += data[p * 4];
        s[1] += data[p * 4 + 1];
        s[2] += data[p * 4 + 2];
        s[3]++;
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
        let solid = true;
        for (let dy = -2; dy <= 2 && solid; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (label[p + dy * w + dx] !== c) {
              solid = false;
              break;
            }
        if (!solid) continue;
        const t = inner[c];
        t[0] += data[p * 4];
        t[1] += data[p * 4 + 1];
        t[2] += data[p * 4 + 2];
        t[3]++;
      }
    const total = stats.reduce((t, s) => t + s[3], 0) || 1;
    const order = stats
      .map((s, c) => ({ c, s }))
      .filter((x) => x.s[3] > 0)
      .sort((a, b) => b.s[3] - a.s[3]);
    const rank = new Int16Array(k).fill(-1);
    order.forEach((x, r) => (rank[x.c] = r));
    const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
    // Smoothing radius (points either side) and simplifying tolerance.
    const rad = o.smooth ? 1 + Math.floor(o.smooth / 3) : 0;
    const eps = o.smooth ? 0.4 + o.smooth * 0.08 : 0.5;
    const layers = [];
    const inside = new Uint8Array(n);
    order.forEach(({ c, s }, r) => {
      for (let p = 0; p < n; p++) {
        const lr = label[p] < 0 ? -1 : rank[label[p]];
        inside[p] = o.stacked ? (lr >= r ? 1 : 0) : lr === r ? 1 : 0;
      }
      // Stacked: each layer above the bottom reaches a pixel further over
      // the one below, so smoothing can't open a sliver of gap between
      // them (not out over transparency, which would grow the outline).
      if (o.stacked && r > 0) {
        const grown = inside.slice();
        for (let p = 0; p < n; p++) {
          if (inside[p] || label[p] < 0) continue;
          const x = p % w;
          if (
            (x > 0 && inside[p - 1]) ||
            (x < w - 1 && inside[p + 1]) ||
            (p >= w && inside[p - w]) ||
            (p < n - w && inside[p + w])
          )
            grown[p] = 1;
        }
        inside.set(grown);
      }
      const loops = loopsOf(inside, w, h)
        .map((pts) => {
          const e = o.shapes && o.smooth ? ellipseOf(pts) || rectOf(pts) : null;
          if (e) return e;
          const sm = smoothLoop(pts, rad);
          return simplify(sm.pts, eps, sm.fixed);
        })
        .filter((pts) => pts.length >= 6);
      const colour =
        o.mode === 'bw'
          ? c === 1
            ? '#000000'
            : '#ffffff'
          : (() => {
              const t = inner[c][3] >= 9 ? inner[c] : s;
              return `#${hex(t[0] / t[3])}${hex(t[1] / t[3])}${hex(t[2] / t[3])}`;
            })();
      layers.push({ hex: colour, area: s[3] / total, loops });
    });
    return { id, layers };
  }

  scope.onmessage = (e) => {
    const r = trace(e.data);
    scope.postMessage(
      r,
      r.layers.flatMap((l) => l.loops.map((a) => a.buffer)),
    );
  };
  return trace;
}

// ---- running it ------------------------------------------------------------------
let traceW = null;
let traceRun = null; // the page-side fallback
const traceJobs = new Map();
let traceId = 0;
function traceStart(data, w, h, o) {
  const id = ++traceId;
  if (traceW === null) {
    try {
      const url = URL.createObjectURL(
        new Blob([`(${traceWorker.toString()})(self);`], { type: 'text/javascript' }),
      );
      traceW = new Worker(url);
      traceW.onmessage = (e) => {
        traceJobs.get(e.data.id)?.resolve(e.data);
        traceJobs.delete(e.data.id);
      };
      // A worker that fails (blocked, or out of memory) hands its jobs to
      // the page, so tracing still finishes.
      traceW.onerror = (e) => {
        e.preventDefault?.();
        console.warn('Image Trace: the background thread failed; tracing on the page.', e.message);
        traceW.terminate();
        traceW = false;
        for (const [, job] of traceJobs) onPage(job.args, job.resolve, job.reject);
        traceJobs.clear();
      };
    } catch {
      traceW = false;
    }
  }
  return new Promise((resolve, reject) => {
    const args = { id, data, w, h, o };
    if (traceW) {
      // The worker gets a copy, so the job can still run here if it fails.
      traceJobs.set(id, { args, resolve, reject });
      traceW.postMessage({ ...args, data: data.slice() });
    } else onPage(args, resolve, reject);
  });
}
// No worker: the same code on the page.
function onPage(args, resolve, reject) {
  setTimeout(() => {
    try {
      traceRun ??= traceWorker({});
      resolve(traceRun(args));
    } catch (e) {
      reject(e);
    }
  }, 0);
}

// One loop as path data: straight between corners, curves elsewhere
// (Catmull-Rom tangents). Smoothness 0 is all corners: plain polygons.
const tf = (v) => String(+v.toFixed(1));
function loopD(pts, smooth) {
  // A recognised rectangle: four sides, and quarter-circle arcs for
  // rounded corners.
  if (Number.isNaN(pts[0]) && pts.length === 7) {
    const [, cx, cy, hw, hh, deg, r] = pts;
    const t = (deg * Math.PI) / 180;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const P = (x, y) => `${tf(cx + x * c - y * s)} ${tf(cy + x * s + y * c)}`;
    if (!r) return `M${P(-hw, -hh)}L${P(hw, -hh)}L${P(hw, hh)}L${P(-hw, hh)}Z`;
    const A = `A${tf(r)} ${tf(r)} 0 0 1 `;
    return (
      `M${P(-hw + r, -hh)}L${P(hw - r, -hh)}${A}${P(hw, -hh + r)}` +
      `L${P(hw, hh - r)}${A}${P(hw - r, hh)}L${P(-hw + r, hh)}${A}${P(-hw, hh - r)}` +
      `L${P(-hw, -hh + r)}${A}${P(-hw + r, -hh)}Z`
    );
  }
  // A recognised ellipse: two half-ellipse arcs.
  if (Number.isNaN(pts[0])) {
    const [, cx, cy, a, b, deg] = pts;
    const t = (deg * Math.PI) / 180;
    const [dx, dy] = [a * Math.cos(t), a * Math.sin(t)];
    const arc = (x, y) => `A${tf(a)} ${tf(b)} ${tf(deg)} 1 1 ${tf(x)} ${tf(y)}`;
    return `M${tf(cx + dx)} ${tf(cy + dy)}${arc(cx - dx, cy - dy)}${arc(cx + dx, cy + dy)}Z`;
  }
  const n = pts.length / 2;
  const P = (i) => {
    const j = ((i % n) + n) % n;
    return [pts[j * 2], pts[j * 2 + 1]];
  };
  const limit = smooth ? ((20 + smooth * 10) * Math.PI) / 180 : -1;
  const corner = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = P(i - 1);
    const [bx, by] = P(i);
    const [cx, cy] = P(i + 1);
    let t = Math.abs(Math.atan2(cy - by, cx - bx) - Math.atan2(by - ay, bx - ax));
    if (t > Math.PI) t = 2 * Math.PI - t;
    corner.push(limit < 0 || t > limit);
  }
  const [x0, y0] = P(0);
  let d = `M${tf(x0)} ${tf(y0)}`;
  for (let i = 0; i < n; i++) {
    const p1 = P(i);
    const p2 = P(i + 1);
    const c1n = corner[i];
    const c2n = corner[(i + 1) % n];
    if (c1n && c2n) {
      d += `L${tf(p2[0])} ${tf(p2[1])}`;
      continue;
    }
    const p0 = P(i - 1);
    const p3 = P(i + 2);
    // Handles along the Catmull-Rom tangent, but no longer than a third of
    // this segment: where a long side meets a short one (a narrow end) a
    // longer handle would overshoot into a spike.
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3;
    const handle = (from, tx, ty) => {
      const l = Math.hypot(tx, ty);
      const k = l > seg ? seg / l : 1;
      return [from[0] + tx * k, from[1] + ty * k];
    };
    const c1 = c1n
      ? [p1[0] + (p2[0] - p1[0]) / 3, p1[1] + (p2[1] - p1[1]) / 3]
      : handle(p1, (p2[0] - p0[0]) / 6, (p2[1] - p0[1]) / 6);
    const c2 = c2n
      ? [p2[0] - (p2[0] - p1[0]) / 3, p2[1] - (p2[1] - p1[1]) / 3]
      : handle(p2, -(p3[0] - p1[0]) / 6, -(p3[1] - p1[1]) / 6);
    d += `C${tf(c1[0])} ${tf(c1[1])} ${tf(c2[0])} ${tf(c2[1])} ${tf(p2[0])} ${tf(p2[1])}`;
  }
  return d + 'Z';
}
// The traced layers as path elements (in trace pixels).
function tracePaths(layers, smooth) {
  return layers
    .filter((l) => l.loops.length)
    .map((l) =>
      mk('path', {
        d: l.loops.map((pts) => loopD(pts, smooth)).join(''),
        fill: l.hex,
        'fill-rule': 'evenodd',
        'data-name': `Colour ${l.hex} · ${Math.max(1, Math.round(l.area * 100))}%`,
      }),
    );
}

// ---- the dialog -----------------------------------------------------------------
const TRACE_PRESETS = {
  logo: { mode: 'colour', colours: 12, speck: 8, smooth: 5, ignoreBg: true },
  illustration: { mode: 'colour', colours: 16, speck: 4, smooth: 4, ignoreBg: false },
  photo: { mode: 'colour', colours: 24, speck: 12, smooth: 5, ignoreBg: false },
  sketch: { mode: 'bw', threshold: 128, speck: 10, smooth: 6, ignoreBg: true },
};
const trDlg = $('#sc-trace');
const trField = (k) => trDlg.querySelector(`[data-tr="${k}"]`);
const tr = { img: null, pixels: null, w: 0, h: 0, layers: null, M: null, timer: 0, busy: 0 };

function traceOptions() {
  const mode =
    trDlg.querySelector('[data-tr-mode][aria-checked="true"]')?.dataset.trMode || 'colour';
  return {
    mode,
    colours: clamp(Math.round(+trField('colours').value) || 6, 2, 32),
    threshold: clamp(+trField('threshold').value || 128, 0, 255),
    speck: clamp(Math.round(+trField('speck').value) || 0, 0, 500),
    smooth: clamp(+trField('smooth').value || 0, 0, 10),
    stacked: trField('stacked').checked,
    ignoreBg: trField('ignoreBg').checked,
    shapes: trField('shapes').checked,
  };
}
function syncTraceFields() {
  const mode = traceOptions().mode;
  trField('colours').closest('label').hidden = mode === 'bw';
  trField('threshold').closest('label').hidden = mode !== 'bw';
}
function setTracePreset(k) {
  const p = TRACE_PRESETS[k];
  if (!p) return;
  for (const b of trDlg.querySelectorAll('[data-tr-mode]'))
    b.setAttribute('aria-checked', b.dataset.trMode === p.mode);
  for (const key of ['colours', 'threshold', 'speck', 'smooth'])
    if (key in p) trField(key).value = p[key];
  trField('ignoreBg').checked = p.ignoreBg;
  syncTraceFields();
}

// The image's pixels at tracing size, and the matrix from tracing pixels
// to the drawing (its placement, aspect ratio and transform). place maps
// the <image>'s own x / y / width / height to the layer's parent: its
// transform, or more when it's drawn through a <use> or a pattern.
// Each failure is an Error whose message says why, for the status bar.
async function imagePixels(el, place = getM(el)) {
  const href = (el.getAttribute('href') || el.getAttribute('xlink:href') || '').trim();
  const why = (text, cause) => Object.assign(new Error(text), { cause });
  if (!href) throw why('the image layer has no picture in it');
  if (!/^data:image\//i.test(href))
    throw why('it’s linked from elsewhere, not embedded in the drawing, so it can’t be read');
  const img = new Image();
  img.src = href;
  try {
    await img.decode();
  } catch (e) {
    throw why('its picture data is damaged, or in a format this browser can’t read', e);
  }
  // An SVG picture may have no size of its own: take the layer's.
  const num = (a) => parseFloat(el.getAttribute(a)) || 0;
  const nw = img.naturalWidth || num('width') || 300;
  const nh = img.naturalHeight || num('height') || 150;
  // 400–1000 px on the long side: big enough for detail, small enough to be quick.
  const long = Math.max(nw, nh);
  const k = clamp(long, 400, 1000) / long;
  const w = Math.max(1, Math.round(nw * k));
  const h = Math.max(1, Math.round(nh * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch (e) {
    throw why('the browser won’t let SVGCraft read its pixels', e);
  }
  if (!data.some((v, i) => i % 4 === 3 && v))
    throw why('it’s completely transparent: there’s nothing to trace');
  // Where the image is drawn (preserveAspectRatio: meet, or none).
  const W = num('width') || nw;
  const H = num('height') || nh;
  const par = el.getAttribute('preserveAspectRatio') || '';
  let sx = W / nw;
  let sy = H / nh;
  let ox = 0;
  let oy = 0;
  if (!/^none/.test(par)) {
    sx = sy = Math.min(sx, sy);
    const a = /x(Min|Mid|Max)Y(Min|Mid|Max)/.exec(par) || [0, 'Mid', 'Mid'];
    const frac = { Min: 0, Mid: 0.5, Max: 1 };
    ox = (W - nw * sx) * frac[a[1]];
    oy = (H - nh * sy) * frac[a[2]];
  }
  const M = place.translate(num('x') + ox, num('y') + oy).scale((sx * nw) / w, (sy * nh) / h);
  return { data, w, h, M };
}

// The element a "#id" or url(#id) points at, in the drawing.
function refTarget(s) {
  const m = /^(?:url\(\s*["']?)?#([^"')\s]+)/.exec((s || '').trim());
  const t = m && document.getElementById(m[1]);
  return t && (doc.contains(t) || defs.contains(t)) ? t : null;
}
const useHref = (u) => u.getAttribute('href') ?? u.getAttributeNS(XLINK, 'href');

// The matrix fitting a viewBox into a w × h viewport (preserveAspectRatio).
function fitM(vb, w, h, par = '') {
  const [x, y, vw, vh] = vb;
  if (!(vw > 0 && vh > 0)) return new DOMMatrix();
  let sx = w / vw;
  let sy = h / vh;
  let ox = 0;
  let oy = 0;
  if (!/^none/.test(par)) {
    sx = sy = /slice/.test(par) ? Math.max(sx, sy) : Math.min(sx, sy);
    const a = /x(Min|Mid|Max)Y(Min|Mid|Max)/.exec(par) || [0, 'Mid', 'Mid'];
    const frac = { Min: 0, Mid: 0.5, Max: 1 };
    ox = (w - vw * sx) * frac[a[1]];
    oy = (h - vh * sy) * frac[a[2]];
  }
  return new DOMMatrix().translate(ox, oy).scale(sx, sy).translate(-x, -y);
}
const viewBoxOf = (el) => {
  const v = (el.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return v.length === 4 && v.every(Number.isFinite) ? v : null;
};

// The <image>s el draws, through groups, <use> and symbols (in <defs> or
// not), each with the matrix from its own x / y / width / height to the
// coordinates m starts from (el's parent's, by default).
function drawnImages(el, m = new DOMMatrix(), depth = 0) {
  if (depth > 10 || el.getAttribute('display') === 'none') return [];
  const n = el.localName;
  if (n === 'image') return [{ img: el, m: m.multiply(getM(el)) }];
  if (n === 'g' || n === 'a' || n === 'switch') {
    const k = m.multiply(getM(el));
    return [...el.children].flatMap((c) => drawnImages(c, k, depth + 1));
  }
  if (n !== 'use') return [];
  const ref = refTarget(useHref(el));
  if (!ref) return [];
  const num = (a) => parseFloat(el.getAttribute(a)) || 0;
  const k = m.multiply(getM(el)).translate(num('x'), num('y'));
  if (ref.localName !== 'symbol') return drawnImages(ref, k, depth + 1);
  // A symbol with a viewBox fits it into the instance's width × height.
  const vb = viewBoxOf(ref);
  const s = vb
    ? k.multiply(
        fitM(
          vb,
          num('width') || parseFloat(ref.getAttribute('width')) || vb[2],
          num('height') || parseFloat(ref.getAttribute('height')) || vb[3],
          ref.getAttribute('preserveAspectRatio') || '',
        ),
      )
    : k;
  return [...ref.children].flatMap((c) => drawnImages(c, s, depth + 1));
}

// The <image>s a shape's pattern fill draws in its first tile, each with
// the matrix from its own coordinates to the shape's parent. A pattern
// takes what it doesn't set from the one its href points at.
function patternImages(el) {
  const fill = getComputedStyle(el).fill;
  let p = refTarget(fill);
  const chain = [];
  while (p?.localName === 'pattern' && !chain.includes(p) && chain.length < 10) {
    chain.push(p);
    p = refTarget(useHref(p));
  }
  if (!chain.length) return [];
  const get = (a) => chain.find((q) => q.hasAttribute(a))?.getAttribute(a);
  const box = el.getBBox();
  const obbTile = get('patternUnits') !== 'userSpaceOnUse';
  const len = (a, size, base) => {
    const v = get(a) || '0';
    const f = parseFloat(v) || 0;
    if (!obbTile) return f;
    return base + (v.endsWith('%') ? f / 100 : f) * size;
  };
  const tx = len('x', box.width, box.x);
  const ty = len('y', box.height, box.y);
  const tw = len('width', box.width, 0);
  const th = len('height', box.height, 0);
  let m = getM(el);
  const pt = get('patternTransform');
  if (pt) {
    const g = mk('g', { transform: pt });
    m = m.multiply(getM(g));
  }
  m = m.translate(tx, ty);
  const holder = chain.find((q) => q.children.length);
  const vb = holder && viewBoxOf(chain.find((q) => q.hasAttribute('viewBox')) || holder);
  if (vb) m = m.multiply(fitM(vb, tw, th, get('preserveAspectRatio') || ''));
  else if (get('patternContentUnits') === 'objectBoundingBox') m = m.scale(box.width, box.height);
  return holder ? [...holder.children].flatMap((c) => drawnImages(c, m)) : [];
}

// The image layer to trace, as { el, img, place }: el is the layer the
// result goes beside (and replaces), img the <image> read, and place maps
// img's x / y / width / height to el's parent. It's the image selected,
// the one in a selected group, the one a <use> draws (straight from
// <defs>, or through a symbol), or the one a shape's pattern fill shows.
// Otherwise { why } there isn't one. The menu item is off without one
// (actionRules.imageTrace).
function traceImage() {
  const sel = state.sel;
  if (!sel.length) return { why: 'select an image layer first (File → Import… places one).' };
  if (sel.length > 1) return { why: 'select just one image layer.' };
  const el = sel[0];
  const one = (found, holds) => {
    if (found.length === 1) return { el, img: found[0].img, place: found[0].m };
    if (found.length > 1)
      return {
        why: `“${layerName(el)}” ${holds} ${found.length} images. Select one of them in the Layers panel.`,
      };
    return null;
  };
  if (el.localName === 'image') return { el, img: el, place: getM(el) };
  if (el.localName === 'use') {
    const r = one(drawnImages(el), 'draws');
    if (r) return r;
  } else if (el.localName === 'g') {
    const inside = [...el.querySelectorAll('image')];
    if (inside.length === 1) return { el: inside[0], img: inside[0], place: getM(inside[0]) };
    if (inside.length > 1)
      return {
        why: `“${layerName(el)}” holds ${inside.length} images. Select one of them in the Layers panel.`,
      };
  } else if (el instanceof SVGGraphicsElement) {
    const r = one(patternImages(el), 'is filled with');
    if (r) return r;
  }
  return { why: `“${layerName(el)}” isn’t an image layer.` };
}

async function openTrace() {
  const { el, img, place, why } = traceImage();
  if (!el) return warn(`Image Trace: ${why}`);
  if (refuseLocked([el], 'edit')) return;
  let px;
  try {
    px = await imagePixels(img, place);
  } catch (e) {
    console.warn('Image Trace:', e.message, e.cause || '');
    return warn(`Image Trace can’t read “${layerName(el)}”: ${e.message}.`);
  }
  Object.assign(tr, { img: el, pixels: px.data, w: px.w, h: px.h, M: px.M, layers: null });
  trField('preview').setAttribute('viewBox', `0 0 ${px.w} ${px.h}`);
  showDialog(trDlg, () => closeTrace(false));
  setTimeout(() => trDlg.querySelector('[data-tr-btn="ok"]').focus(), 0);
  retrace(0);
}
// Trace again (after a pause while settings change); the newest run wins.
function retrace(wait = 250) {
  clearTimeout(tr.timer);
  // The last result no longer matches the settings: wait for the new one.
  const id = ++tr.busy;
  tr.layers = null;
  trField('status').textContent = 'Tracing…';
  trDlg.querySelector('[data-tr-btn="ok"]').disabled = true;
  tr.timer = setTimeout(async () => {
    const o = traceOptions();
    let r;
    try {
      r = await traceStart(new Uint8ClampedArray(tr.pixels), tr.w, tr.h, o);
    } catch (e) {
      if (id !== tr.busy || !trDlg.open) return;
      console.error('Image Trace failed:', e);
      trField('status').textContent = `Tracing failed: ${e.message || e}`;
      return;
    }
    if (id !== tr.busy || !trDlg.open) return;
    tr.layers = r.layers;
    const paths = tracePaths(r.layers, o.smooth);
    trField('preview').replaceChildren(...paths);
    const bytes = paths.reduce((t, p) => t + p.outerHTML.length, 0);
    const shapes = r.layers.reduce((t, l) => t + l.loops.length, 0);
    const count = (len) =>
      r.layers.reduce(
        (t, l) => t + l.loops.filter((a) => Number.isNaN(a[0]) && a.length === len).length,
        0,
      );
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const found = [
      count(6) && plural(count(6), 'ellipse'),
      count(7) && plural(count(7), 'rectangle'),
    ].filter(Boolean);
    trField('status').textContent = !paths.length
      ? 'Nothing left to trace with these settings: lower Ignore specks under, or turn off Ignore background.'
      : `${paths.length} colour${paths.length === 1 ? '' : 's'} · ${shapes} shape${shapes === 1 ? '' : 's'}` +
        (found.length ? ` (${found.join(', ')})` : '') +
        ` · ${kb(bytes)}`;
    trDlg.querySelector('[data-tr-btn="ok"]').disabled = !paths.length;
  }, wait);
}
function closeTrace(ok) {
  hideDialog(trDlg);
  clearTimeout(tr.timer);
  tr.busy++;
  const el = tr.img;
  const layers = tr.layers;
  tr.pixels = null;
  if (!ok || !el?.isConnected || !layers) return;
  const paths = tracePaths(layers, traceOptions().smooth);
  if (!paths.length)
    return warn('Nothing to trace: lower Ignore specks under, or turn off Ignore background.');
  const g = mk('g', { 'data-name': 'Image Trace' });
  setM(g, tr.M);
  // The top layer first in the Layers panel: SVG paints later children on top.
  g.append(...paths);
  el.after(g);
  if (trField('keep').checked) el.setAttribute('display', 'none');
  else el.remove();
  state.sel = [g];
  commit();
  say(`Traced into ${paths.length} colour layer${paths.length === 1 ? '' : 's'}.`);
}

for (const b of trDlg.querySelectorAll('[data-tr-mode]'))
  b.addEventListener('click', () => {
    for (const x of trDlg.querySelectorAll('[data-tr-mode]'))
      x.setAttribute('aria-checked', x === b);
    trField('preset').value = '';
    syncTraceFields();
    retrace();
  });
trField('preset').addEventListener('change', () => {
  setTracePreset(trField('preset').value);
  retrace();
});
for (const k of ['colours', 'threshold', 'speck', 'smooth', 'stacked', 'ignoreBg', 'shapes'])
  trField(k).addEventListener('input', () => {
    if (['colours', 'threshold', 'speck', 'smooth'].includes(k)) trField('preset').value = '';
    retrace();
  });
trDlg.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.target.closest('button, select')) {
    e.preventDefault();
    if (!trDlg.querySelector('[data-tr-btn="ok"]').disabled) closeTrace(true);
  } else if (e.key === 'Escape') closeTrace(false);
});
trDlg.querySelector('[data-tr-btn="ok"]').addEventListener('click', () => closeTrace(true));
trDlg.querySelector('[data-tr-btn="cancel"]').addEventListener('click', () => closeTrace(false));
setTracePreset('logo');
