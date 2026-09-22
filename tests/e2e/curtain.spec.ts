import { test, expect } from '@playwright/test';

/**
 * The curtain over the table while it is laid. A driven browser gets none (`index.html` says why),
 * so these ask for it with `?curtain`.
 */

test('the curtain is up from the first paint and gone once the models are here', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Hold every model back, so the curtain can be looked at with the files still on their way.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/*.glb', async (route) => { await held; await route.continue(); });

  await page.goto('/?curtain');
  const curtain = page.getByTestId('curtain');
  await expect(curtain).toBeVisible();
  await page.waitForFunction(() => window.__engine && window.__engine.frames > 10);
  // The board has been drawing for a while and the curtain has not moved: it waits for the files.
  await expect(curtain).toBeVisible();
  await expect(curtain).toContainText(/Laying the table · \d+ of \d+/);
  // And it is in the way, which is the point: nothing under it can be clicked.
  const covered = await page.evaluate(() => document.elementFromPoint(40, 40)?.closest('#curtain') !== null);
  expect(covered).toBe(true);

  release();
  await expect(curtain).toHaveCount(0, { timeout: 60_000 });
  // The table under it is the one that was there all along, and it takes a click again.
  await page.evaluate(() => void window.__engine!.select('kara'));
  await page.getByTestId('open-loadout').click();
  await expect(page.getByTestId('loadout')).toBeVisible();
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a driven browser is not made to wait behind it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('curtain')).toBeHidden();
});
