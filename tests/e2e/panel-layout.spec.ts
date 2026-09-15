import { test, expect, type Page } from '@playwright/test';

/**
 * Nothing in an editor panel is painted over anything else.
 *
 * Twice a heading drew itself over its neighbours while every test passed, because they read values,
 * not the screen: the section strip put on a `label` wrapping its own control (a label is inline, so
 * the strip's padding took no room), and the rule that lifts a panel's first heading flush under its
 * edge catching the first heading of a block inside the panel. These read the boxes.
 */

type Row = { top: number; bottom: number; controlTop: number | null; text: string };

/** A panel's rows, top to bottom: each child's box, and where its control starts if it wraps one. */
async function rowsOf(page: Page, testId: string): Promise<Row[]> {
  return page.getByTestId(testId).evaluate((root) =>
    [...root.children].map((child) => {
      const box = child.getBoundingClientRect();
      const control = child.matches('label') ? child.querySelector('input, select, textarea') : null;
      return {
        top: box.top,
        bottom: box.bottom,
        controlTop: control === null ? null : control.getBoundingClientRect().top,
        text: (child.textContent ?? '').trim().slice(0, 30),
      };
    }),
  );
}

/** Each row starts where the one above it ends, or lower; a label's words sit above its control. */
function expectStacked(rows: readonly Row[], where: string): void {
  expect(rows.length, where).toBeGreaterThan(2);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i]!.top, `${where}: "${rows[i]!.text}" overlaps "${rows[i - 1]!.text}"`).toBeGreaterThanOrEqual(rows[i - 1]!.bottom - 0.5);
  }
  for (const row of rows) {
    if (row.controlTop !== null) expect(row.controlTop, `${where}: "${row.text}"`).toBeGreaterThan(row.top + 8);
  }
}

test('the side panels stack their rows, each label over its own control', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));

  await page.getByTestId('mode-terrain').click();
  expectStacked(await rowsOf(page, 'terrain-side'), 'Terrain');

  await page.getByTestId('mode-combat').click();
  await page.evaluate(() => {
    const api = window.__engine!;
    const project = JSON.parse(api.exportProject()) as {
      scenes: { width: number; encounters: { adversaries: { position: { x: number; y: number } }[] }[] }[];
    };
    const scene = project.scenes[0]!;
    const at = scene.encounters[0]!.adversaries[0]!.position;
    api.setTool('select');
    api.editAt(at.y * scene.width + at.x);
  });
  await expect(page.getByTestId('selected-creature')).toBeVisible();
  expectStacked(await rowsOf(page, 'combat-side'), 'Combat');
  const creature = await rowsOf(page, 'selected-creature');
  expect(creature.length).toBeGreaterThanOrEqual(6);
  expectStacked(creature, 'Selected creature');
});
