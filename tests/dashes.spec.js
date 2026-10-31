import { test, expect, load, select, stageBox } from './fixtures.js';

// Custom dash / gap fields: data-dash records the pattern in stroke widths,
// stroke-dasharray holds it scaled by the current stroke width.

const props = '#sc-appearance';

// data-dash and stroke-dasharray of #a.
const attrs = (page) =>
  page.evaluate(() => {
    const e = document.getElementById('a');
    return { dash: e.getAttribute('data-dash'), array: e.getAttribute('stroke-dasharray') };
  });

const fields = (page) => page.locator('#sc-dash-custom input');
const fieldValues = (page) => fields(page).evaluateAll((els) => els.map((i) => i.value));

async function setField(page, i, v) {
  const inp = fields(page).nth(i);
  await inp.fill(String(v));
  await inp.press('Enter');
}

async function openProps(page) {
  await page.click('[data-tab="props"]');
  await expect(page.locator(`${props} select[data-stroke-dash]`)).toBeVisible();
}

const LINE = (extra = '', w = 4) =>
  `<path id="a" d="M20 100H280" stroke="#000" stroke-width="${w}" fill="none" ${extra}/>`;

test.describe('custom dash pattern', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, LINE(), 300, 200);
    await select(page, 'a');
    await openProps(page);
  });

  test('a solid stroke hides the custom fields', async ({ page }) => {
    await expect(page.locator(`${props} select[data-stroke-dash]`)).toHaveValue('solid');
    await expect(page.locator('#sc-dash-custom')).toBeHidden();
    expect(await fieldValues(page)).toEqual(['4', '2', '', '', '', '']);
  });

  test('picking Custom shows the fields and applies the default 4 2 pattern', async ({ page }) => {
    await page.selectOption(`${props} select[data-stroke-dash]`, 'custom');
    expect(await attrs(page)).toEqual({ dash: '4 2', array: '16 8' });
    await expect(page.locator('#sc-dash-custom')).toBeVisible();
    await expect(page.locator(`${props} select[data-stroke-dash]`)).toHaveValue('custom');
    expect(await fieldValues(page)).toEqual(['4', '2', '', '', '', '']);
  });

  test('extra dash / gap fields extend the pattern, scaled by stroke width', async ({ page }) => {
    await page.selectOption(`${props} select[data-stroke-dash]`, 'custom');
    await setField(page, 2, 1);
    await setField(page, 3, 2);
    expect(await attrs(page)).toEqual({ dash: '4 2 1 2', array: '16 8 4 8' });
  });

  test('changing the stroke width rescales the dasharray', async ({ page }) => {
    await page.selectOption(`${props} select[data-stroke-dash]`, 'custom');
    await setField(page, 2, 1);
    await setField(page, 3, 2);
    const w = page.locator(`${props} [data-bind="strokeWidth"]`);
    await w.fill('2');
    await w.press('Enter');
    expect(await attrs(page)).toEqual({ dash: '4 2 1 2', array: '8 4 2 4' });
  });

  test('blanking a field ends the pattern there', async ({ page }) => {
    await page.selectOption(`${props} select[data-stroke-dash]`, 'custom');
    await setField(page, 2, 1);
    await setField(page, 3, 2);
    await setField(page, 2, '');
    expect(await attrs(page)).toEqual({ dash: '4 2', array: '16 8' });
    await expect(page.locator('#sc-dash-custom')).toBeVisible();
    await expect(page.locator(`${props} select[data-stroke-dash]`)).toHaveValue('custom');
    expect(await fieldValues(page)).toEqual(['4', '2', '', '', '', '']);
  });
});

test.describe('imported dasharray', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, LINE('stroke-dasharray="10 5 2.5 5"', 5), 300, 200);
    await select(page, 'a');
    await openProps(page);
  });

  test('a raw dasharray reads back as a custom pattern in stroke widths', async ({ page }) => {
    await expect(page.locator('#sc-dash-custom')).toBeVisible();
    await expect(page.locator(`${props} select[data-stroke-dash]`)).toHaveValue('custom');
    expect(await fieldValues(page)).toEqual(['2', '1', '0.5', '1', '', '']);
  });

  test('editing a field rewrites the whole pattern', async ({ page }) => {
    await setField(page, 0, 3);
    expect(await attrs(page)).toEqual({ dash: '3 1 0.5 1', array: '15 5 2.5 5' });
  });

  test('picking a preset replaces it and hides the fields', async ({ page }) => {
    await setField(page, 0, 3);
    await page.selectOption(`${props} select[data-stroke-dash]`, 'dash');
    expect(await attrs(page)).toEqual({ dash: 'dash', array: '20 10' });
    await expect(page.locator('#sc-dash-custom')).toBeHidden();
    await expect(page.locator(`${props} select[data-stroke-dash]`)).toHaveValue('dash');
    // The fields keep the last custom pattern for next time.
    expect(await fieldValues(page)).toEqual(['3', '1', '0.5', '1', '', '']);
  });
});

test('Custom in the options bar opens the Color panel', async ({ page }) => {
  const group = page.locator('#sc-panel > .sc-pgroup').first();
  await group.locator('.sc-pcollapse').click();
  await expect(group).toHaveClass(/collapsed/);
  await page.keyboard.press('r');
  await page.selectOption('.sc-opt.on select[data-stroke-dash]', 'custom');
  await expect(group).not.toHaveClass(/collapsed/);
  await expect(page.locator('#sc-appearance')).toBeVisible();
});

test('a newly drawn shape gets the custom pattern', async ({ page }) => {
  await load(page, '', 300, 200);
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('rect');
    Object.assign(s.state, { strokeOn: true, strokeWidth: 2, dash: 'custom', dashPat: [3, 1] });
  });
  const st = await stageBox(page);
  await page.mouse.move(st.x + 300, st.y + 200);
  await page.mouse.down();
  await page.mouse.move(st.x + 400, st.y + 300, { steps: 4 });
  await page.mouse.up();
  const r = page.locator('#sc-doc rect');
  await expect(r).toHaveCount(1);
  await expect(r).toHaveAttribute('data-dash', '3 1');
  await expect(r).toHaveAttribute('stroke-dasharray', '6 2');
});
