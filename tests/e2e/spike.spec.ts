import { test, expect } from '@playwright/test';

test('three.js renders under headless chromium (WebGL2, non-uniform pixels, no errors)', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__spike?.frames ?? 0) > 5);
  const spike = await page.evaluate(() => window.__spike!);
  expect(spike.webgl2).toBe(true);
  expect(spike.errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  const distinct = new Set(spike.samples.map((s) => s.join(',')));
  expect(distinct.size).toBeGreaterThan(1);
  await expect(page.locator('#spike-hud')).toContainText('frames');
});
