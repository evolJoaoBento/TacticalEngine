import { test, expect, type Page } from '@playwright/test';

/**
 * The editor's strip shows what each card puts down: a creature or a prop as a picture of its
 * model, an object as a drawn icon. A card with a letter on it is the fallback for a browser with
 * no WebGL to spare, which Chromium under test is not.
 */

async function editing(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  return errors;
}

test('every creature, prop and object card shows what it puts down, and no card is a letter', async ({ page }) => {
  const errors = await editing(page);

  await page.getByTestId('mode-combat').click();
  const creatures = page.getByTestId('combat-library');
  const cards = creatures.locator('[data-item]');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThan(1);
  await expect(creatures.locator('.ph-thumb img[src^="data:image/png"]')).toHaveCount(count);
  await expect(creatures.locator('.ph-glyph')).toHaveCount(0);
  // Every stat block the pack ships has a model of its own now, so no card is a stand-in. The
  // label is still what a creature without one gets: the husk's body, said to be the husk's.
  await expect(creatures.locator('.ph-stand-in')).toHaveCount(0);

  // The pack ships nothing above tier 2: an empty tier says so, rather than that a search missed,
  // and its tab is dimmed so the empty ones can be told apart without opening them.
  await creatures.locator('[data-tab="tier-3"]').click();
  await expect(creatures.locator('.ph-empty')).toHaveText('Nothing in Tier 3 yet.');
  await expect(creatures.locator('[data-tab="tier-3"]')).toHaveClass(/ph-tab-empty/);
  await expect(creatures.locator('[data-tab="tier-1"]')).not.toHaveClass(/ph-tab-empty/);

  await page.getByTestId('mode-terrain').click();
  const terrain = page.getByTestId('terrain-library');
  await terrain.locator('[data-tab="props"]').click();
  const props = terrain.locator('[data-item]');
  const propCount = await props.count();
  expect(propCount).toBeGreaterThan(1);
  await expect(terrain.locator('.ph-thumb img[src^="data:image/png"]')).toHaveCount(propCount);
  // Every built-in prop is its own model, so none is a stand-in.
  await expect(terrain.locator('.ph-stand-in')).toHaveCount(0);

  await terrain.locator('[data-tab="objects"]').click();
  const objects = terrain.locator('[data-item]');
  await expect(objects).toHaveCount(5);
  await expect(terrain.locator('.ph-thumb svg.ph-object-icon')).toHaveCount(5);
  await expect(terrain.locator('.ph-glyph')).toHaveCount(0);

  expect(errors).toEqual([]);
});
