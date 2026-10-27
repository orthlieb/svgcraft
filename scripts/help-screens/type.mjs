// Help screenshots for the README's Type and Text on a path sections
// (see scripts/gen-help-screens.mjs).

// A poster with a headline, a tagline and a curve to set text along.
const POSTER = `
  <rect data-name="Paper" width="800" height="500" fill="#fdf6e3"/>
  <text data-name="Headline" x="60" y="130" font-family="'Playfair Display', serif"
    font-size="72" font-weight="700" fill="#1e3a5f">Harbour Lights</text>
  <text data-name="Tagline" x="64" y="185" font-family="'Montserrat', sans-serif"
    font-size="28" fill="#b45309">A festival of lanterns</text>
  <text data-name="Date" x="520" y="330" transform="rotate(-8 600 320)"
    font-family="'Pacifico', cursive" font-size="44" fill="#be123c">Friday 7 pm</text>`;

// Text and a curve, ready to go on the path.
const CURVE = `
  <rect data-name="Paper" width="800" height="500" fill="#fdf6e3"/>
  <path data-name="Curve" d="M 90 360 C 230 120 570 120 710 360" fill="none"
    stroke="#94a3b8" stroke-width="2" stroke-dasharray="6 6"/>
  <text data-name="Words" x="90" y="440" font-family="'Lobster', cursive"
    font-size="40" fill="#be123c">Over the hills and far away, over the sea</text>`;

// Text already on a circle.
const RING = `
  <rect data-name="Paper" width="800" height="500" fill="#fdf6e3"/>
  <circle data-name="Ring" id="ring" cx="400" cy="250" r="170" fill="#fde68a"
    stroke="#d97706" stroke-width="3"/>
  <text data-name="Badge text" font-family="'Oswald', sans-serif" font-size="40"
    font-weight="700" fill="#7c2d12" data-sc-textpath="ring" letter-spacing="4"
    ><textPath href="#ring" startOffset="0%">FRESH • LOCAL • HANDMADE •</textPath></text>`;

// Put the curve's text on it, as the user would.
async function onCurve(h) {
  await h.open(CURVE, 'curve.svg', 800, 500);
  await h.select('Words', 'Curve');
  await h.menu('Type', 'textOnPath');
  await h.page.waitForSelector('#sc-doc textPath');
}

// Select a text layer and show its settings in the type controls.
async function selectText(h, name) {
  await h.select(name);
  await h.page.evaluate(() => {
    // eslint-disable-next-line no-undef -- the editor's own global
    readTypeFromSelection();
  });
}

// Show the SVG Source panel, scrolled to the first match for find.
async function source(h, find) {
  await h.menu('Window', 'toggleSource');
  await h.page.waitForSelector('#sc-source:not([hidden])');
  await h.page.fill('#sc-src-find', find);
  await h.page.press('#sc-src-find', 'Enter');
}

// The Type options bar and the canvas under it.
const workArea = ['#sc-options .sc-opt[data-for="text"]', '#sc-stage-wrap'];

export default [
  {
    id: 'add-text',
    async shoot(h) {
      await h.open(POSTER, 'poster.svg', 800, 500);
      await h.dragDoc([64, 240], [460, 400], 'text');
      await h.page.waitForSelector('.sc-type-edit');
      await h.page.keyboard.type(
        'Lanterns light the harbour wall from dusk on Friday until the last boat comes in.',
      );
      await h.shot(workArea, { pad: 0 });
    },
  },
  {
    id: 'edit-text-on-the-canvas',
    async shoot(h) {
      await h.open(POSTER, 'poster.svg', 800, 500);
      await h.clickDoc(600, 320, 'text');
      await h.page.waitForSelector('.sc-type-edit');
      await h.page.keyboard.press('End');
      await h.page.keyboard.type(' sharp');
      await h.shot('#sc-stage-wrap', { pad: 0 });
    },
  },
  {
    id: 'choose-a-font',
    async shoot(h) {
      await h.open(POSTER, 'poster.svg', 800, 500);
      await selectText(h, 'Headline');
      await h.page.evaluate(() => window.svgcraft.setTool('text'));
      await h.page.click('#sc-options [data-fontpick]');
      await h.page.waitForSelector('#sc-fontpop:not([hidden]) .sc-font-item');
      await h.shot(['#sc-fontpop', '#sc-options [data-fontpick]'], { pad: 6 });
    },
  },
  {
    id: 'style-individual-characters',
    async shoot(h) {
      await h.open(POSTER, 'poster.svg', 800, 500);
      await h.clickDoc(300, 110, 'text');
      await h.page.waitForSelector('.sc-type-edit');
      await h.page.keyboard.press('End');
      for (let i = 0; i < 6; i++) await h.page.keyboard.press('Shift+ArrowLeft');
      await h.tab('character');
      await h.page.fill('[data-pane="character"] [data-type="tracking"]', '200');
      await h.page.press('[data-pane="character"] [data-type="tracking"]', 'Enter');
      await h.page.click('[data-pane="character"] [data-type-toggle="underline"]');
      await h.shot(['#sc-stage-wrap', '#sc-panel'], { pad: 0 });
    },
  },
  {
    id: 'character-panel',
    async shoot(h) {
      await h.open(POSTER, 'poster.svg', 800, 500);
      await selectText(h, 'Headline');
      await h.tab('character');
      await h.page.waitForSelector('[data-pane="character"]:not([hidden])');
      await h.shot(['[data-tab="character"]', '[data-pane="character"]'], { pad: 4 });
    },
  },
  {
    id: 'paragraph-panel',
    async shoot(h) {
      await h.open(POSTER, 'poster.svg', 800, 500);
      await h.dragDoc([64, 240], [460, 400], 'text');
      await h.page.waitForSelector('.sc-type-edit');
      await h.page.keyboard.type('Lanterns light the harbour wall from dusk on Friday.');
      await h.page.keyboard.press('Control+Enter');
      await h.tab('paragraph');
      await h.page.waitForSelector('[data-pane="paragraph"]:not([hidden])');
      await h.shot(['[data-tab="paragraph"]', '[data-pane="paragraph"]'], { pad: 4 });
    },
  },
  {
    id: 'text-in-the-saved-file',
    async shoot(h) {
      await h.open(POSTER, 'poster.svg', 800, 500);
      await h.clickDoc(300, 110, 'text');
      await h.page.waitForSelector('.sc-type-edit');
      await h.page.keyboard.press('End');
      for (let i = 0; i < 6; i++) await h.page.keyboard.press('Shift+ArrowLeft');
      await h.tab('character');
      await h.page.click('[data-pane="character"] [data-type-toggle="underline"]');
      await h.page.keyboard.press('Control+Enter');
      await h.page.waitForSelector('#sc-doc [data-run]');
      await selectText(h, 'Headline');
      await source(h, 'data-run');
      await h.shot('#sc-source', { pad: 0 });
    },
  },
  {
    id: 'put-text-on-a-path',
    async shoot(h) {
      await h.open(CURVE, 'curve.svg', 800, 500);
      await h.select('Words', 'Curve');
      await h.tab('props');
      await h.page.waitForSelector('#sc-tp-make:visible');
      await h.shot(['#sc-stage-wrap', '#sc-panel'], { pad: 0 });
    },
  },
  {
    id: 'adjust-text-on-a-path',
    async shoot(h) {
      await h.open(RING, 'badge.svg', 800, 500);
      await h.select('Badge text');
      await h.tab('props');
      await h.page.waitForSelector('#sc-tp-opts:visible');
      await h.shot(['#sc-stage-wrap', '#sc-panel'], { pad: 0 });
    },
  },
  {
    id: 'release-text-from-a-path',
    async shoot(h) {
      await onCurve(h);
      await h.menu('Type', 'releaseTextOnPath', { click: false });
      await h.shot(['.sc-menu-btn:text-is("Type")', '.sc-menu-list:not([hidden])', '#sc-doc'], {
        pad: 8,
      });
    },
  },
  {
    id: 'how-text-on-a-path-is-saved',
    async shoot(h) {
      await onCurve(h);
      await source(h, 'textPath');
      await h.shot('#sc-source', { pad: 0 });
    },
  },
];
