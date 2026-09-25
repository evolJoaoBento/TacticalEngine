import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The party's pack, open: it is in the loadout now, as cards on the gear pages the character
 * sheet's Equipment button lays over the binder (`ui/GearBinder.tsx`). Opens the binder when it is
 * shut, and the gear pages when they are not showing; hands back the pack either way.
 */
export async function openPack(page: Page): Promise<Locator> {
  const pack = page.getByTestId('pack');
  if ((await pack.count()) === 0) {
    if ((await page.getByTestId('loadout').count()) === 0) await page.getByTestId('open-loadout').click();
    await page.getByTestId('open-gear').click();
  }
  await expect(pack).toBeVisible();
  // The pages turn to get there; a click on a card waits until they have settled.
  await expect(page.getByTestId('gear-turning')).toHaveCount(0);
  return pack;
}

/**
 * Put the binder away. There is no Close button: a click on the table round the binder shuts it, so
 * that is what this does - and on a screen too narrow to leave any table showing, Esc.
 */
export async function closeLoadout(page: Page): Promise<void> {
  const binder = (await page.getByTestId('loadout').boundingBox())!;
  if (binder.x > 8) await page.getByTestId('loadout-backdrop').click({ position: { x: 4, y: Math.round(binder.y + binder.height / 2) } });
  else {
    await page.getByTestId('loadout').focus();
    await page.keyboard.press('Escape');
  }
  await expect(page.getByTestId('loadout')).toHaveCount(0);
}
