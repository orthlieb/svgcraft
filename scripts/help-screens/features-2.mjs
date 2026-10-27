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

// The window from the top, down to y, from the left edge to x: the options
// bar, the toolbar and the top-left of the canvas.
const topLeft = (width, height) => ({ clip: { x: 0, y: 0, width, height } });

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
    },
  },
  {
    id: 'shape-tools-create',
    async shoot(h) {
      await h.page.evaluate(() => window.svgcraft.setTool('polygon'));
      await h.clickDoc(400, 280, null);
      await h.page.waitForSelector('#sc-createshape[open]');
      await h.shot('#sc-createshape', { pad: 0 });
    },
  },
  {
    id: 'pencil',
    async shoot(h) {
      await h.open('', 'sketch.svg', 800, 500);
      await h.page.evaluate(() => window.svgcraft.setTool('pencil'));
      await stroke(h, wave(60, 520, 150, 70));
      await stroke(h, wave(60, 520, 300, 40, 30));
      await h.page.evaluate(() => window.svgcraft.setTool('pencil'));
      await h.shot(null, topLeft(760, 520));
    },
  },
  {
    id: 'pen',
    async shoot(h) {
      await h.open('', 'pen.svg', 800, 500);
      await h.clickDoc(80, 360, 'pen');
      await h.dragDoc([240, 120], [340, 120]);
      await h.dragDoc([460, 360], [560, 360]);
      await h.clickDoc(600, 160, null);
      await h.shot(null, topLeft(860, 560));
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
      await h.page.press('[aria-label="Angle"]', 'Tab');
      await h.shot(null, topLeft(900, 470));
    },
  },
  {
    id: 'align-and-distribute',
    async shoot(h) {
      await h.select('Red paint', 'Yellow paint', 'Blue paint');
      await h.menu('Layer', 'alignHCenter', { click: false });
      await h.shot('.sc-menu-list:not([hidden])', { pad: 6 });
    },
  },
  {
    id: 'eyedropper',
    async shoot(h) {
      await h.page.evaluate(() => window.svgcraft.setTool('eyedropper'));
      await h.shot(null, topLeft(560, 120));
    },
  },
  {
    id: 'edit-points',
    async shoot(h) {
      await h.open(
        '<path data-name="Leaf" d="M120 300 C 160 120 360 60 520 110 C 470 260 330 340 120 300 Z" fill="#16a34a"/>',
        'leaf.svg',
        640,
        400,
      );
      await h.select('Leaf');
      await h.page.evaluate(() => window.svgcraft.setTool('node'));
      await h.clickDoc(330, 200, null);
      await h.shot(null, topLeft(860, 560));
    },
  },
  {
    id: 'fill-rule-and-path-direction',
    async shoot(h) {
      await h.open(
        '<path data-name="Rings" fill-rule="evenodd" fill="#7c3aed" d="M300 40a160 160 0 1 0 0.1 0Z M300 100a100 100 0 1 0 0.1 0Z M300 160a40 40 0 1 0 0.1 0Z"/>',
        'rings.svg',
        600,
        400,
      );
      await h.select('Rings');
      await h.tab('props');
      await h.page.waitForSelector('#sc-fillrule-props:not([hidden])');
      await h.shot('#sc-fillrule-props', { pad: 8 });
    },
  },
  {
    id: 'animate',
    async shoot(h) {
      await h.select('Brush');
      await h.tab('animation');
      await h.page.selectOption('#sc-anim-add', 'popIn');
      await h.page.selectOption('#sc-anim-add', 'float');
      await h.page.waitForSelector('#sc-anim-list li');
      await h.shot(PROPS_GROUP, { pad: 0 });
    },
  },
  {
    id: 'zoom-and-pan',
    async shoot(h) {
      await h.page.evaluate(() => window.svgcraft.setTool('zoom'));
      await h.menu('View', 'zoomIn', { click: false });
      await h.shot(['.sc-menu-list:not([hidden])', '#sc-options'], {
        pad: 6,
        clip: undefined,
      });
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
      await h.shot('#sc-stage', { pad: 0 });
    },
  },
  {
    id: 'eraser',
    async shoot(h) {
      const lines = [0, 1, 2, 3, 4]
        .map(
          (i) =>
            `<path data-name="Line ${i + 1}" d="M60 ${80 + i * 70} H 520" stroke="#e8a33d" stroke-width="10" stroke-linecap="round" fill="none"/>`,
        )
        .join('');
      await h.open(lines, 'lines.svg', 800, 460);
      await h.page.evaluate(() => window.svgcraft.setTool('eraser'));
      await h.page.click('[data-eraser="cut"]');
      await stroke(h, [
        [280, 40],
        [300, 200],
        [320, 420],
      ]);
      await h.shot(null, topLeft(860, 540));
    },
  },
  {
    id: 'gradients',
    async shoot(h) {
      await h.select('Backdrop');
      await h.page.click('[aria-label="Fill type"] [data-kind="linear"]');
      await h.page.waitForSelector('#sc-grad-preset:visible');
      await h.shot(COLOR_GROUP, { pad: 0 });
    },
  },
  {
    id: 'stroke-options',
    async shoot(h) {
      await h.select('Frame');
      await h.page.selectOption('.sc-pbody[data-pane="color"] [data-stroke-dash]', 'custom');
      await h.shot(COLOR_GROUP, { pad: 0 });
    },
  },
  {
    id: 'rounded-rectangles',
    async shoot(h) {
      await h.open(
        '<rect data-name="Card" x="120" y="80" width="360" height="240" rx="36" fill="#2563eb"/>',
        'card.svg',
        600,
        400,
      );
      await h.select('Card');
      await h.tab('props');
      await h.page.waitForSelector('#sc-corner-props:not([hidden])');
      await h.shot(['#sc-stage', '#sc-corner-props'], { pad: 0 });
    },
  },
  {
    id: 'patterns',
    async shoot(h) {
      await h.select('Backdrop');
      await h.tab('patterns');
      await h.page.locator('.sc-pbody[data-pane="patterns"] .sc-lib-grid > *').nth(5).click();
      await h.tab('color');
      await h.page.waitForSelector('#sc-pat-pick:visible');
      await h.shot(COLOR_GROUP, { pad: 0 });
    },
  },
  {
    id: 'libraries',
    async shoot(h) {
      await h.tab('swatches');
      await h.shot(COLOR_GROUP, { pad: 0 });
    },
  },
  {
    id: 'colours',
    async shoot(h) {
      await h.select('Red paint');
      await h.shot(COLOR_GROUP, { pad: 0 });
    },
  },
  {
    id: 'selecting-moving-and-arranging',
    async shoot(h) {
      await h.select('Red paint', 'Yellow paint');
      await h.shot(null, { clip: { x: 0, y: 0, width: 1280, height: 520 } });
    },
  },
];
