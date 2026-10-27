// Help screenshots for the README's Features section, Shape tools to the
// end of the section (see scripts/gen-help-screens.mjs).

// The panel group holding Color, Swatches, Gradients and Patterns, and the
// one holding Properties, Character … Animation, History.
const COLOR_GROUP = '.sc-pgroup:has([data-tab="color"])';
const PROPS_GROUP = '.sc-pgroup:has([data-tab="props"])';

// Drag the mouse through document points, as a hand would.
async function stroke(h, pts) {
  const at = [];
  for (const p of pts) at.push(await h.at(...p));
  await h.page.mouse.move(at[0].x, at[0].y);
  await h.page.mouse.down();
  for (const p of at.slice(1)) await h.page.mouse.move(p.x, p.y, { steps: 3 });
  await h.page.mouse.up();
}

// A wave across the drawing, as points.
const wave = (x0, x1, y, amp, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => [
    x0 + ((x1 - x0) * i) / n,
    y + amp * Math.sin((i / n) * Math.PI * 3),
  ]);

// The box round some document rectangles and page elements, in page
// pixels, plus pad. bars: true stretches it to the window's top-left
// corner, taking in the menu bar, the options bar and the toolbar.
async function around(h, { doc = [], els = [], pad = 12, bars = false }) {
  const boxes = [];
  for (const [x0, y0, x1, y1] of doc) {
    const a = await h.at(x0, y0);
    const b = await h.at(x1, y1);
    boxes.push({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
  }
  for (const e of els) boxes.push(await h.page.locator(e).first().boundingBox());
  const vp = h.page.viewportSize();
  const x0 = bars ? 0 : Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y0 = bars ? 0 : Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return { pad: 0, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
}

// Fold every other panel group away and let this one grow to fit its
// content, so a panel shows whole.
async function tall(h, group) {
  await h.page.evaluate((sel) => {
    const g = document.querySelector(sel);
    for (const o of document.querySelectorAll('#sc-panel > .sc-pgroup'))
      if (o !== g && !o.classList.contains('collapsed')) o.querySelector('.sc-pcollapse').click();
    g.style.setProperty('--h', '2000px');
  }, group);
}

// The clip for a panel group, from its tabs down to the last thing showing
// in it, so the empty space a tall group leaves isn't in the shot.
async function panel(h, group, pad = 10) {
  const clip = await h.page.evaluate((sel) => {
    const g = document.querySelector(sel);
    const r = g.getBoundingClientRect();
    let bottom = r.top;
    for (const e of g.querySelectorAll('*')) {
      const b = e.getBoundingClientRect();
      if (b.height && e.checkVisibility()) bottom = Math.max(bottom, b.bottom);
    }
    return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, bottom - r.top) };
  }, group);
  clip.height = Math.min(clip.height + pad, h.page.viewportSize().height - clip.y);
  return { clip };
}

// A drawing of a few plain shapes for the tool shots.
const SHAPES = `
  <rect data-name="Box" x="80" y="90" width="220" height="160" fill="#2563eb"/>
  <ellipse data-name="Disc" cx="460" cy="170" rx="110" ry="80" fill="#dc2626"/>
  <polygon data-name="Star" points="660,80 684,150 758,150 698,193 721,263 660,220 599,263 622,193 562,150 636,150" fill="#e8a33d"/>`;

export default [
  {
    id: 'shape-tools',
    async shoot(h) {
      await h.open(SHAPES, 'shapes.svg', 800, 340);
      await h.page.click('#sc-shape-btn', { button: 'right' });
      await h.page.waitForSelector('#sc-shape-menu:not([hidden])');
      await h.shot(['#sc-shape-menu', '#sc-shape-btn'], { pad: 12 });
      // A click without a drag: the Create box.
      await h.page.keyboard.press('Escape');
      await h.page.evaluate(() => window.svgcraft.setTool('polygon'));
      await h.clickDoc(400, 280, null);
      await h.page.waitForSelector('#sc-createshape[open]');
      await h.page.fill('[data-cs-shape="ratio"]', '50');
      await h.shot('#sc-createshape', { pad: 0, name: 'shape-tools-create' });
    },
  },
  {
    id: 'pencil',
    async shoot(h) {
      await h.open('', 'sketch.svg', 1000, 700);
      await h.page.evaluate(() => window.svgcraft.setTool('pencil'));
      await stroke(h, wave(60, 560, 130, 60));
      await stroke(h, wave(60, 560, 300, 40, 30));
      await h.shot(
        null,
        await around(h, {
          doc: [[0, 0, 600, 400]],
          els: ['.sc-opt[data-for="pencil"]'],
          bars: true,
        }),
      );
    },
  },
  {
    id: 'pen',
    async shoot(h) {
      await h.open('', 'pen.svg', 1000, 700);
      await h.clickDoc(60, 340, 'pen');
      await h.dragDoc([200, 100], [290, 100]);
      await h.dragDoc([400, 340], [490, 340]);
      await h.clickDoc(560, 120, null);
      await h.shot(null, await around(h, { doc: [[0, 0, 600, 400]], bars: true }));
    },
  },
  {
    id: 'free-transform-and-edit-transform',
    async shoot(h) {
      await h.open(SHAPES, 'shapes.svg', 800, 340);
      await h.select('Box');
      await h.menu('Edit', 'freeTransform');
      await h.page.waitForSelector('.sc-opt[data-for="transform"]:visible');
      await h.page.fill('[aria-label="Angle"]', '15');
      await h.page.press('[aria-label="Angle"]', 'Enter');
      await h.shot(
        null,
        await around(h, {
          doc: [[0, 0, 340, 300]],
          els: ['.sc-opt[data-for="transform"]'],
          bars: true,
          pad: 4,
        }),
      );
    },
  },
  {
    id: 'align-and-distribute',
    async shoot(h) {
      await h.select('Red paint', 'Yellow paint', 'Blue paint');
      await h.menu('Layer', 'alignHCenter', { click: false });
      const menus = h.page.locator('.sc-menu-list:not([hidden])');
      await h.shot([menus.nth(0), menus.nth(1)], { pad: 6 });
    },
  },
  {
    id: 'eyedropper',
    async shoot(h) {
      await h.open(SHAPES, 'shapes.svg', 800, 340);
      await h.select('Disc');
      await h.page.evaluate(() => window.svgcraft.setTool('eyedropper'));
      await h.shot(null, { clip: { x: 0, y: 0, width: 1280, height: 560 } });
    },
  },
  {
    id: 'edit-points',
    async shoot(h) {
      await h.open(
        '<path data-name="Leaf" d="M80 330 C 120 130 300 70 460 110 C 420 260 300 360 80 330 Z" fill="#16a34a"/>',
        'leaf.svg',
        1000,
        700,
      );
      await h.select('Leaf');
      await h.page.evaluate(() => window.svgcraft.setTool('node'));
      await h.clickDoc(460, 110, null);
      await h.shot(null, await around(h, { doc: [[0, 0, 560, 400]], bars: true }));
    },
  },
  {
    id: 'fill-rule-and-path-direction',
    async shoot(h) {
      await h.open(
        '<path data-name="Rings" fill-rule="evenodd" fill="#7c3aed" d="M840 60a170 170 0 1 0 0.1 0Z M840 120a110 110 0 1 0 0.1 0Z M840 180a50 50 0 1 0 0.1 0Z"/>',
        'rings.svg',
        1100,
        500,
      );
      await h.select('Rings');
      await h.tab('props');
      await tall(h, PROPS_GROUP);
      await h.page.waitForSelector('#sc-fillrule-props:visible');
      await h.shot(
        null,
        await around(h, { doc: [[660, 50, 1020, 410]], els: ['#sc-fillrule-props'] }),
      );
    },
  },
  {
    id: 'animate',
    async shoot(h) {
      await h.select('Brush');
      await h.tab('animation');
      await tall(h, PROPS_GROUP);
      await h.page.selectOption('#sc-anim-add', 'popIn');
      await h.page.selectOption('#sc-anim-add', 'float');
      await h.page.waitForSelector('#sc-anim-list li');
      await h.shot(null, await panel(h, PROPS_GROUP));
    },
  },
  {
    id: 'stagger',
    async shoot(h) {
      // The five paints in a group of their own.
      await h.page.evaluate(() => {
        /* eslint-disable no-undef -- the editor's own globals */
        const first = doc.querySelector('[data-name="Red paint"]');
        const g = mk('g', { 'data-name': 'Paints' });
        first.before(g);
        g.append(...doc.querySelectorAll('[data-name$=" paint"]'));
        afterChange();
        /* eslint-enable no-undef */
      });
      await h.select('Paints');
      await h.tab('animation');
      await tall(h, PROPS_GROUP);
      await h.page.selectOption('#sc-anim-add', 'popIn');
      const st = h.page.locator('#sc-anim-opts [data-anim-opt="stagger"]');
      await st.fill('0.15');
      await st.dispatchEvent('change');
      await h.page.evaluate(() => document.activeElement.blur());
      await h.shot(
        null,
        await around(h, { doc: [[40, 40, 520, 420]], els: [PROPS_GROUP], pad: 6 }),
      );
    },
  },
  {
    id: 'move-along-path',
    async shoot(h) {
      // A curve for the brush to fly along, above it.
      await h.page.evaluate(() => {
        /* eslint-disable no-undef -- the editor's own globals */
        mk(
          'path',
          {
            'data-name': 'Flight path',
            d: 'M660 250C600 60 330 40 250 200',
            fill: 'none',
            stroke: '#f5f5f5',
            'stroke-width': '3',
            'stroke-dasharray': '10 8',
          },
          doc,
        );
        afterChange();
        /* eslint-enable no-undef */
      });
      await h.select('Brush', 'Flight path');
      await h.tab('animation');
      await tall(h, PROPS_GROUP);
      await h.page.selectOption('#sc-anim-add', 'followPath');
      await h.page.check('#sc-anim-opts [data-anim-opt="orient"]');
      await h.page.waitForSelector('#sc-anim-list li');
      await h.shot(
        null,
        await around(h, { doc: [[200, 20, 800, 400]], els: [PROPS_GROUP], pad: 6 }),
      );
    },
  },
  {
    id: 'zoom-and-pan',
    async shoot(h) {
      await h.open(SHAPES, 'shapes.svg', 800, 340);
      await h.page.evaluate(() => window.svgcraft.setTool('zoom'));
      await h.menu('View', 'zoomIn', { click: false });
      await h.shot(
        null,
        await around(h, { els: ['.sc-menu-list:not([hidden])'], bars: true, pad: 6 }),
      );
    },
  },
  {
    id: 'pixel-grid-and-snap-to-pixel',
    async shoot(h) {
      await h.open(
        '<rect data-name="Key" x="4" y="4" width="10" height="7" rx="1.5" fill="#2563eb"/><path data-name="Bit" d="M14 7.5h6" stroke="#e8a33d" stroke-width="1"/>',
        'icon.svg',
        24,
        16,
      );
      await h.menu('View', 'togglePixelGrid');
      await h.menu('View', 'toggleSnapPixel');
      await h.select('Key');
      await h.shot(null, await around(h, { doc: [[0, 0, 24, 16]], pad: 8 }));
    },
  },
  {
    id: 'eraser',
    async shoot(h) {
      const lines = [0, 1, 2, 3, 4]
        .map(
          (i) =>
            `<path data-name="Line ${i + 1}" d="M60 ${60 + i * 70} H 540" stroke="#e8a33d" stroke-width="10" stroke-linecap="round" fill="none"/>`,
        )
        .join('');
      await h.open(lines, 'lines.svg', 1000, 700);
      await h.page.evaluate(() => window.svgcraft.setTool('eraser'));
      await h.page.click('[data-eraser="cut"]');
      await stroke(
        h,
        Array.from({ length: 41 }, (_, i) => [260 + 60 * Math.sin(i / 6), 20 + i * 9.5]),
      );
      await h.shot(null, await around(h, { doc: [[0, 0, 600, 400]], bars: true }));
    },
  },
  {
    id: 'gradients',
    async shoot(h) {
      await h.select('Backdrop');
      await tall(h, COLOR_GROUP);
      await h.page.click('[aria-label="Fill type"] [data-kind="linear"]');
      await h.page.waitForSelector('#sc-grad-preset:visible');
      await h.page.selectOption('#sc-grad-preset', { label: 'Sunset' });
      await h.shot(null, await panel(h, COLOR_GROUP));
    },
  },
  {
    id: 'stroke-options',
    async shoot(h) {
      await h.select('Frame');
      await tall(h, COLOR_GROUP);
      await h.page.selectOption('.sc-pbody[data-pane="color"] [data-stroke-dash]', 'custom');
      await h.shot(null, await panel(h, COLOR_GROUP));
    },
  },
  {
    id: 'rounded-rectangles',
    async shoot(h) {
      await h.open(
        '<rect data-name="Card" x="560" y="80" width="360" height="240" rx="36" fill="#2563eb"/>',
        'card.svg',
        1000,
        400,
      );
      await h.select('Card');
      await h.tab('props');
      await tall(h, PROPS_GROUP);
      await h.page.waitForSelector('#sc-corner-props:visible');
      await h.shot(
        null,
        await around(h, { doc: [[540, 60, 940, 340]], els: ['#sc-corner-props'] }),
      );
    },
  },
  {
    id: 'patterns',
    async shoot(h) {
      await h.select('Backdrop');
      await h.tab('patterns');
      await tall(h, COLOR_GROUP);
      await h.page.locator('#sc-patlib > *').nth(5).click();
      await h.shot(null, await panel(h, COLOR_GROUP));
    },
  },
  {
    id: 'libraries',
    async shoot(h) {
      await h.tab('swatches');
      await tall(h, COLOR_GROUP);
      await h.shot(null, await panel(h, COLOR_GROUP));
    },
  },
  {
    id: 'colours',
    async shoot(h) {
      await h.open(SHAPES, 'shapes.svg', 800, 340);
      await h.select('Disc');
      await tall(h, COLOR_GROUP);
      await h.shot(null, await panel(h, COLOR_GROUP));
    },
  },
  {
    id: 'selecting-moving-and-arranging',
    async shoot(h) {
      await h.open(SHAPES, 'shapes.svg', 800, 340);
      await h.select('Box', 'Disc');
      await h.shot(null, { clip: { x: 0, y: 0, width: 1008, height: 600 } });
    },
  },
];
