import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * The merchant in the default project, played: the camp's crate gives up a few coins, Tobin the
 * Pedlar is talked to rather than struck, "Show me your wares" opens his shop while the talk goes
 * on, buying pays from the party pack, and he buys back what he sells for half.
 *
 * Every other suite plays the demo built from code; this one is about what the project file holds,
 * so it serves `projects/default.json` itself, as `default-project.spec.ts` does - less any model an
 * author embedded in it, which is not what this is about.
 */

const shipped = ((project: { assets?: { url: string }[] }) =>
  JSON.stringify({ ...project, assets: (project.assets ?? []).filter((asset) => !asset.url.startsWith('data:')) }))(
  JSON.parse(readFileSync('projects/default.json', 'utf8')),
);

test('the merchant by the camp fire sells to a party that can pay', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/projects/default.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: shipped }));
  await page.goto('/?boot=file');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));

  // Down the trail to the camp, and the coin in its crate.
  const taken = await page.evaluate(() => {
    const api = window.__engine!;
    api.approach('crate-prop-3-24');
    api.arrive();
    let coins = 0;
    while (api.container()?.lines.some((line) => line.item === 'gold') === true && coins < 30) {
      api.take('gold');
      coins++;
    }
    return coins;
  });
  expect(taken).toBe(20);

  // Tobin is talked to, not struck.
  await page.evaluate(() => window.__engine!.attack('tobin'));
  expect(await page.evaluate(() => window.__engine!.hasDialogue())).toBe(true);
  expect(await page.evaluate(() => window.__engine!.hitPoints('tobin').marked)).toBe(0);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.answer({ kind: 'choose', index: api.dialogueOptions().indexOf('Show me your wares.') });
  });

  // His shop is open while the conversation goes on, and says what the party can spend.
  const shop = page.getByTestId('container');
  await expect(shop).toHaveAttribute('data-container', 'tobin');
  await expect(shop).toContainText('Tobin the Pedlar');
  await expect(shop.getByTestId('shop-purse')).toHaveText('You have 20 gold.');
  const draught = shop.locator('[data-item="healing-draught"]').getByTestId('shop-buy');
  await expect(draught).toContainText('6 gold');
  await page.screenshot({ path: 'test-results/merchant-shop.png' });
  await draught.click();
  await expect(shop.getByTestId('shop-purse')).toHaveText('You have 14 gold.');
  // What costs more than is left cannot be bought.
  await expect(shop.locator('[data-item="hunting-bow"]').getByTestId('shop-buy')).toBeDisabled();
  expect(await page.evaluate(() => window.__engine!.log().some((line) => /buys Healing Draught for 6 gold/i.test(line.text)))).toBe(true);

  // The pack says what the draught is worth, before anybody offers for it.
  await expect(page.getByTestId('pack').locator('[data-item="healing-draught"]').getByTestId('item-worth')).toHaveText('worth 6');
  await expect(page.getByTestId('pack').locator('[data-item="gold"]').getByTestId('item-worth')).toHaveCount(0);
  await page.getByTestId('pack').screenshot({ path: 'test-results/pack-worth.png' });

  // And he buys it back, for half what he asked.
  const sell = shop.getByTestId('shop-selling').locator('[data-sell="healing-draught"]').getByTestId('shop-sell');
  await expect(sell).toContainText('3 gold');
  await sell.click();
  await expect(shop.getByTestId('shop-purse')).toHaveText('You have 17 gold.');
  await expect(shop.getByTestId('shop-selling')).toHaveCount(0);

  // And the conversation ends as any other does.
  await page.evaluate(() => {
    const api = window.__engine!;
    for (let i = 0; i < 10 && api.pendingKind() !== null; i++) {
      const options = api.dialogueOptions();
      api.answer(options.length > 0 ? { kind: 'choose', index: options.length - 1 } : { kind: 'continue' });
    }
  });
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  expect(errors).toEqual([]);
});
