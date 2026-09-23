import { expect, test } from '@playwright/test';

/**
 * The hand, as a thing on screen rather than a thing that works.
 *
 * Both checks here are for defects no unit test can see and no assertion on behaviour would
 * catch: the card did what it was asked, and looked wrong doing it. Both were found by looking at
 * a screenshot, which is the only way this class of bug is ever found - so once found, it gets an
 * assertion, because the next one will be found the same slow way.
 */

test('a card in hand prints its cost on itself and keeps its own corners', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setDiceSpeed(0);
    api.select('kara');
    api.setCards('kara', ['power-slash', 'shield-wall', 'iron-stance', 'rallying-cry', 'unbroken']);
  });
  const bar = page.locator('[data-testid="action-bar"]');
  await expect(bar.locator('.hand-card').first()).toBeVisible();

  // What a card costs is printed on the card, the way the full card prints its recall cost: the
  // coin sits inside its own card and down on the art, so the name above it is still readable.
  const coins = await bar.locator('.hand-cost').evaluateAll((els) => els.map((el) => {
    const card = el.closest('.hand-card')!;
    const coin = el.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const title = card.querySelector('.face-title')!.getBoundingClientRect();
    return { inside: coin.top > box.top && coin.left >= box.left && coin.right <= box.right, clear: coin.top >= title.bottom - 3 };
  }));
  expect(coins.length).toBeGreaterThan(0);
  expect(coins.every((coin) => coin.inside && coin.clear), JSON.stringify(coins)).toBe(true);

  // Nothing inside a card reaches past its rounded corner. The domain band at the foot bleeds to
  // the card's edge on square corners, so it used to poke out through both bottom corners: the
  // card had been told not to clip, back when the cost gem hung outside it. The cost came inside
  // and the exception stayed behind, which is how a fix leaves a defect where it used to live.
  const bled = await bar.locator('.hand-card').evaluateAll((cards) => cards.map((card) => {
    const box = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    const over = [...card.querySelectorAll('.face-footer,.face-title,.face-rules,.face-art')].map((part) => {
      const at = part.getBoundingClientRect();
      // A hair of tolerance: the cards are scaled and rotated, so the edges are fractional.
      return Math.max(box.left - at.left, at.right - box.right, at.bottom - box.bottom, box.top - at.top);
    });
    return { clips: style.overflow, radius: parseFloat(style.borderBottomLeftRadius), out: Math.max(...over) };
  }));
  expect(bled.length).toBeGreaterThan(2);
  for (const card of bled) {
    // The clip is the guard. A corner can only be poked through by something the card is not cutting.
    expect(card.clips, 'a hand card must clip to its own corners').toBe('hidden');
    expect(card.radius, 'a hand card has a rounded corner to protect').toBeGreaterThan(0);
    expect(card.out, 'something inside the card reaches past its edge').toBeLessThan(1.5);
  }
});
