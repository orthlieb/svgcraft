// Isolation mode: double-click a group to work inside it. Clicks pick its
// children, the rest is dimmed and out of reach, new shapes go into it, and
// Esc / the bar's crumbs / Done / a double-click off it step back out. The
// dimming is an editor mark: never saved, never in the history.
import { test, expect, load, toScreen } from './fixtures.js';

// Outer group (moved 100 right) holding two squares and an inner group;
// a loose circle beside it.
const SCENE =
  '<g id="outer" data-name="Outer" transform="translate(100 0)">' +
  '<rect id="a" x="0" y="20" width="60" height="60" fill="#dc2626"/>' +
  '<rect id="b" x="80" y="20" width="60" height="60" fill="#2563eb"/>' +
  '<g id="inner" data-name="Inner"><rect id="c" x="0" y="120" width="60" height="60" fill="#16a34a"/>' +
  '<rect id="d" x="80" y="120" width="60" height="60" fill="#facc15"/></g></g>' +
  '<circle id="loose" cx="500" cy="200" r="40" fill="#7c3aed"/>';

const at = async (page, x, y) => toScreen(page, x, y);
async function click(page, x, y, opts) {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y, opts);
}
async function dbl(page, x, y) {
  const p = await at(page, x, y);
  await page.mouse.dblclick(p.x, p.y);
}
const sel = (page) => page.evaluate(() => window.svgcraft.state.sel.map((e) => e.id));
const dimmed = (page) => page.$$eval('#sc-doc [data-sc-dim]', (ns) => ns.map((n) => n.id));
const bar = (page) => page.locator('#sc-scope');

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 600, 300);
  await page.evaluate(() => window.svgcraft.setTool('select'));
});

test('double-clicking a group isolates it: clicks pick its children, the rest is out of reach', async ({
  page,
}) => {
  // Outside isolation a click picks the whole group.
  await click(page, 130, 50);
  expect(await sel(page)).toEqual(['outer']);
  await dbl(page, 130, 50);
  await expect(bar(page)).toBeVisible();
  await expect(page.locator('#sc-scope-path')).toHaveText('Drawing › Outer');
  expect(await dimmed(page)).toEqual(['loose']);
  await expect(page.locator('#sc-layers li.scope')).toHaveCount(1);
  // Inside, a click picks the child; the dimmed circle can't be picked.
  await click(page, 130, 50);
  expect(await sel(page)).toEqual(['a']);
  await click(page, 500, 200);
  expect(await sel(page)).toEqual([]);
  // A child group is picked whole.
  await click(page, 130, 150);
  expect(await sel(page)).toEqual(['inner']);
  // Select All and a marquee stay inside.
  await page.keyboard.press('Control+a');
  expect(await sel(page)).toEqual(['a', 'b', 'inner']);
  await click(page, 300, 280);
  const p0 = await at(page, 90, 10);
  const p1 = await at(page, 590, 100);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 5 });
  await page.mouse.up();
  expect(await sel(page)).toEqual(['a', 'b']);
});

test('nested groups: double-click goes deeper; crumbs, Esc and Done come back out', async ({
  page,
}) => {
  await dbl(page, 130, 50);
  await dbl(page, 130, 150);
  await expect(page.locator('#sc-scope-path')).toHaveText('Drawing › Outer › Inner');
  expect((await dimmed(page)).sort()).toEqual(['a', 'b', 'loose']);
  // The Outer crumb goes back up a level.
  await page.click('#sc-scope-path button:text-is("Outer")');
  await expect(page.locator('#sc-scope-path')).toHaveText('Drawing › Outer');
  // Esc: first deselects, then steps out, selecting the group it left.
  await dbl(page, 130, 150);
  await click(page, 130, 150);
  expect(await sel(page)).toEqual(['c']);
  await page.keyboard.press('Escape');
  expect(await sel(page)).toEqual([]);
  await expect(page.locator('#sc-scope-path')).toHaveText('Drawing › Outer › Inner');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sc-scope-path')).toHaveText('Drawing › Outer');
  expect(await sel(page)).toEqual(['inner']);
  // Done leaves isolation altogether.
  await dbl(page, 130, 150);
  await page.click('#sc-scope [data-action="scopeDone"]');
  await expect(bar(page)).toBeHidden();
  expect(await dimmed(page)).toEqual([]);
  expect(await sel(page)).toEqual(['inner']);
});

test('a double-click off the group, or picking a layer outside it, steps out', async ({ page }) => {
  await dbl(page, 130, 50);
  await dbl(page, 300, 280);
  await expect(bar(page)).toBeHidden();
  expect(await sel(page)).toEqual(['outer']);
  await dbl(page, 130, 50);
  await page.locator('#sc-layers li', { hasText: 'Circle' }).first().click();
  await expect(bar(page)).toBeHidden();
  expect(await sel(page)).toEqual(['loose']);
});

test('a shape drawn while isolated goes into the group, where it was drawn', async ({ page }) => {
  await dbl(page, 130, 50);
  await page.evaluate(() => window.svgcraft.setTool('rect'));
  const p0 = await at(page, 300, 200);
  const p1 = await at(page, 360, 260);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 5 });
  await page.mouse.up();
  const drawn = await page.evaluate(() => {
    const outer = document.getElementById('outer');
    const r = outer.lastElementChild;
    const b = r.getBoundingClientRect();
    const m = document.getElementById('sc-doc').getScreenCTM().inverse();
    const tl = new DOMPoint(b.left, b.top).matrixTransform(m);
    return {
      tag: r.localName,
      x: Math.round(tl.x),
      y: Math.round(tl.y),
      dim: r.hasAttribute('data-sc-dim'),
    };
  });
  expect(drawn).toMatchObject({ tag: 'rect', dim: false });
  expect(Math.abs(drawn.x - 300)).toBeLessThanOrEqual(2);
  expect(Math.abs(drawn.y - 200)).toBeLessThanOrEqual(2);
  // Undo takes it out again and keeps the group isolated.
  await page.keyboard.press('Control+z');
  await expect(page.locator('#outer > rect')).toHaveCount(2);
  await expect(page.locator('#sc-scope-path')).toHaveText('Drawing › Outer');
  expect(await dimmed(page)).toEqual(['loose']);
});

test('the dimming is never saved or kept in the history', async ({ page }) => {
  await dbl(page, 130, 50);
  await click(page, 130, 50);
  await page.keyboard.press('ArrowRight');
  const out = await page.evaluate(() => ({
    svg: window.svgcraft.serialize(),
    // eslint-disable-next-line no-undef -- the editor's own history
    hist: hist.map((h) => h.d).join(''),
  }));
  expect(out.svg).not.toContain('data-sc-dim');
  expect(out.hist).not.toContain('data-sc-dim');
  expect(await dimmed(page)).toEqual(['loose']);
});

test('Ctrl/⌘-click and a Ctrl/⌘-drag pick shapes inside groups, within the isolated group', async ({
  page,
}) => {
  // Not isolated: Ctrl-click reaches the square inside the inner group.
  const p = await at(page, 130, 150);
  await page.keyboard.down('Control');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
  expect(await sel(page)).toEqual(['c']);
  // A Ctrl-drag box picks the shapes inside groups that it touches.
  await click(page, 300, 280);
  const q0 = await at(page, 90, 100);
  const q1 = await at(page, 590, 290);
  await page.keyboard.down('Control');
  await page.mouse.move(q0.x, q0.y);
  await page.mouse.down();
  await page.mouse.move(q1.x, q1.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  expect((await sel(page)).sort()).toEqual(['c', 'd', 'loose']);
  // Isolated in Outer, Ctrl-click still can't reach the dimmed circle.
  await dbl(page, 130, 50);
  await page.keyboard.down('Control');
  await click(page, 500, 200);
  await page.keyboard.up('Control');
  expect(await sel(page)).toEqual([]);
});
