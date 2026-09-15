import { test, expect, type Page } from '@playwright/test';

/**
 * The two gestures the mouse's third button and the wheel's modifier add: a middle drag
 * turns the camera in either mode, and Ctrl + wheel moves the editor's build level. The
 * left drag, the right drag and the plain wheel are `demo.spec.ts`'s.
 */

async function booted(page: Page): Promise<{ cx: number; cy: number }> {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  const box = (await page.locator('#gl').boundingBox())!;
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

const camera = (page: Page) => page.evaluate(() => window.__engine!.camera());

test('a middle drag orbits in play and in the editor, where a right drag still pans', async ({ page }) => {
  const { cx, cy } = await booted(page);

  for (const mode of ['play', 'edit'] as const) {
    await page.evaluate((m) => window.__engine!.setMode(m), mode);
    const before = await camera(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 120, cy + 30, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    const turned = await camera(page);
    expect(turned.yaw, mode).not.toBeCloseTo(before.yaw);
    expect(turned.target, mode).toEqual(before.target);
  }

  // The editor's right drag is untouched by this: it moves the target and keeps the angle.
  const turned = await camera(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 80, cy + 40, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  const panned = await camera(page);
  expect(panned.yaw).toBeCloseTo(turned.yaw);
  expect(Math.hypot(panned.target.x - turned.target.x, panned.target.z - turned.target.z)).toBeGreaterThan(0.5);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('Ctrl + wheel over the board moves the build level a quarter tile a notch, and the plain wheel still zooms', async ({ page }) => {
  const { cx, cy } = await booted(page);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  const ladder = page.getByTestId('height-ladder');
  await expect(ladder).toHaveAttribute('aria-valuenow', '0');

  await page.mouse.move(cx, cy);
  const before = await camera(page);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await expect(ladder).toHaveAttribute('aria-valuenow', '0.25');
  await page.mouse.wheel(0, -100);
  await expect(ladder).toHaveAttribute('aria-valuenow', '0.5');
  await page.mouse.wheel(0, 100);
  await expect(ladder).toHaveAttribute('aria-valuenow', '0.25');
  await page.keyboard.up('Control');
  // The level moved and the camera did not.
  expect((await camera(page)).distance).toBeCloseTo(before.distance);

  // Without Ctrl the wheel is the camera's, and the level stays where it was put.
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await camera(page)).distance).toBeLessThan(before.distance);
  await expect(ladder).toHaveAttribute('aria-valuenow', '0.25');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});
