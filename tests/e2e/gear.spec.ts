import { expect, test, type Page } from '@playwright/test';
import { closeLoadout } from './pack';

/**
 * The gear pages of the loadout, played: the sheet's Equipment button lays a sheet of plastic over
 * it with a sleeve for each place gear goes, the page opposite turns to the party's pack as cards,
 * and a card dragged from the pack onto its sleeve is put on - with a real mouse, since that is the
 * whole of the feature. Hands are counted; a card dragged back comes off; the Use and Equip buttons
 * do what the Carried list's did.
 */

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 850 });
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
  return errors;
}

/** Carry a card from one place on the screen to another, as a hand would: pressed, moved, let go. */
async function drag(page: Page, from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2 + 5, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('cards dragged from the pack onto their sleeves are put on, and dragged back come off', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page);
  const who = await page.evaluate(() => {
    const api = window.__engine!;
    for (const id of ['primary-broadsword', 'secondary-round-shield', 'armor-leather-armor', 'primary-longbow']) api.giveItem(id);
    api.giveItem('consumable-minor-health-potion', 2);
    return api.selected()!;
  });

  await page.getByTestId('open-loadout').click();
  await expect(page.getByTestId('loadout')).toBeVisible();
  // The Equipment divider's tab, out past the edge of the card pages. The pages are not lifted while
  // the pack is not under them: lifted, they painted over the binder's cover as it swung shut.
  await expect(page.getByTestId('open-gear')).toHaveText('Equipment');
  expect(await page.locator('.deck-leafstack').evaluate((n) => getComputedStyle(n).zIndex)).toBe('auto');
  await page.getByTestId('open-gear').click();
  // Caught mid-turn, for a look at the leaves going over.
  await page.waitForTimeout(260);
  await page.screenshot({ path: 'test-results/gear-turning.png' });
  await page.waitForTimeout(170);
  await page.screenshot({ path: 'test-results/gear-turning-2.png' });
  const slots = page.getByTestId('gear-slots');
  const pack = page.getByTestId('pack');
  await expect(slots).toBeVisible();
  await expect(pack).toBeVisible();
  // Getting here was a turn of the pages: the leaves were flipping, and the drags below wait for them to settle.
  await expect(page.getByTestId('gear-turning')).toHaveCount(0);
  // Three sleeves, labelled; the pack's cards each in one of their own.
  await expect(slots.locator('.gear-label')).toHaveText(['Primary weapon', 'Secondary weapon', 'Armor']);
  await expect(pack.locator('[data-item="primary-broadsword"]')).toHaveCount(1);
  await expect(pack.locator('[data-item="consumable-minor-health-potion"] [data-testid="item-count"]')).toHaveText('×2');
  await expect(pack.locator('[data-item="primary-broadsword"] [data-testid="item-worth"]')).toHaveText('worth 10');
  await page.screenshot({ path: 'test-results/gear-pages.png' });

  // The broadsword onto the primary sleeve, by hand.
  await drag(page, (await pack.locator('[data-item="primary-broadsword"] .gear-hold').boundingBox())!, (await page.getByTestId('slot-primary').boundingBox())!);
  await expect.poll(() => page.evaluate((id) => window.__engine!.gear(id).weapon, who)).toBe('Broadsword');
  await expect(pack.locator('[data-item="primary-broadsword"]')).toHaveCount(0);
  await expect(page.getByTestId('slot-primary').locator('[data-item="primary-broadsword"]')).toHaveCount(1);

  // A card let go over a sleeve it does not fit stays where it was.
  await drag(page, (await pack.locator('[data-item="armor-leather-armor"] .gear-hold').boundingBox())!, (await page.getByTestId('slot-secondary').boundingBox())!);
  await expect(pack.locator('[data-item="armor-leather-armor"]')).toHaveCount(1);
  // Onto its own, and it is worn.
  await drag(page, (await pack.locator('[data-item="armor-leather-armor"] .gear-hold').boundingBox())!, (await page.getByTestId('slot-armor').boundingBox())!);
  await expect.poll(() => page.evaluate((id) => window.__engine!.gear(id).armor, who)).toBe('Leather Armor');

  // The shield beside a one-handed sword; then a two-handed bow, which sends the shield back.
  await pack.locator('[data-item="secondary-round-shield"] [data-testid="equip"]').click();
  await expect(page.getByTestId('slot-secondary').locator('[data-item="secondary-round-shield"]')).toHaveCount(1);
  await pack.locator('[data-item="primary-longbow"] [data-testid="equip"]').click();
  await expect(page.getByTestId('slot-secondary').locator('.gear-empty')).toHaveCount(1);
  await expect(pack.locator('[data-item="secondary-round-shield"]')).toHaveCount(1);
  // And the shield will not go on while the bow takes both hands: said on the plastic.
  await pack.locator('[data-item="secondary-round-shield"] [data-testid="equip"]').click();
  await expect(page.getByTestId('gear-issue')).toContainText('takes both');

  // The armour dragged back to the pack comes off.
  await drag(page, (await page.getByTestId('slot-armor').locator('.gear-hold').boundingBox())!, (await pack.boundingBox())!);
  await expect(pack.locator('[data-item="armor-leather-armor"]')).toHaveCount(1);
  await expect(page.getByTestId('slot-armor').locator('.gear-empty')).toHaveCount(1);

  await page.screenshot({ path: 'test-results/gear-worn.png' });

  // Back to the cards: by the divider's tab, which reads Back on this side - the pages turn home, and
  // only then is the divider gone.
  await expect(page.getByTestId('close-loadout')).toHaveCount(0);
  await expect(page.getByTestId('close-gear')).toHaveText('Back');
  await page.screenshot({ path: 'test-results/gear-divider.png' });
  await page.getByTestId('close-gear').click();
  await expect(page.getByTestId('gear-turning')).toHaveCount(1);
  await expect(slots).toHaveCount(0);
  await expect(page.getByTestId('gear-turning')).toHaveCount(0);
  // And a click on the table round the binder puts the binder away.
  await closeLoadout(page);
  expect(errors).toEqual([]);
});
