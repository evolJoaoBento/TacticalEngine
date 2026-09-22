import { expect, test } from '@playwright/test';

/**
 * Losing Hit Points, where the player sees it: the sheet card is jolted and flushes red, the
 * hearts that went break, the number lost rises off the card - and on the board the token is
 * knocked and the line round it burns red.
 */

test('a wound shakes the sheet, breaks the hearts it took, and is gone again', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  const card = page.locator('[data-member="kara"]');
  await expect(card).not.toHaveClass(/is-hurt/);
  await expect(card.locator('.is-lost')).toHaveCount(0);

  // Two Hit Points marked, read a moment later, inside the page so a slow frame cannot hide it.
  const seen = await page.evaluate(async () => {
    window.__engine!.wound('kara', 2);
    await new Promise((done) => setTimeout(done, 150));
    const kara = document.querySelector('[data-member="kara"]')!;
    const finn = document.querySelector('[data-member="finn"]')!;
    return {
      hurt: kara.classList.contains('is-hurt'),
      count: kara.getAttribute('data-hurt'),
      says: kara.querySelector('[data-testid="wound"]')?.textContent ?? null,
      broken: kara.querySelectorAll('[data-testid="hp"] .is-lost').length,
      brokenAreHollow: [...kara.querySelectorAll('[data-testid="hp"] .is-lost')].every((pip) => !pip.classList.contains('is-marked')),
      breaking: getComputedStyle(kara.querySelector('[data-testid="hp"] .is-lost')!).animationName,
      shaking: getComputedStyle(kara).animationName,
      marked: kara.querySelector('[data-testid="hp"]')!.getAttribute('data-marked'),
      bystander: finn.classList.contains('is-hurt'),
    };
  });
  expect(seen).toEqual({ hurt: true, count: '2', says: '-2', broken: 2, brokenAreHollow: true, breaking: 'pip-lost', shaking: 'hud-hurt', marked: '2', bystander: false });
  await page.screenshot({ path: 'test-results/hurt-card.png' });

  // And it passes: the card is a card again, with two hollow hearts and nothing breaking.
  await expect(card).not.toHaveClass(/is-hurt/, { timeout: 15_000 });
  await expect(card.locator('.is-lost')).toHaveCount(0);
  await expect(card.getByTestId('wound')).toHaveCount(0);

  // A second blow is a second wound, counted from the first; a healing is not a wound at all.
  const again = await page.evaluate(async () => {
    window.__engine!.wound('kara', 3);
    await new Promise((done) => setTimeout(done, 150));
    const first = document.querySelector('[data-member="kara"]')!.getAttribute('data-hurt');
    await new Promise((done) => setTimeout(done, 1200));
    window.__engine!.wound('kara', 0);
    await new Promise((done) => setTimeout(done, 150));
    return { first, healed: document.querySelector('[data-member="kara"]')!.classList.contains('is-hurt') };
  });
  expect(again).toEqual({ first: '1', healed: false });
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a fall that hurts knocks the token on the board as well as the sheet', async ({ page }) => {
  test.setTimeout(300_000);
  // The dice thrown for her, so nothing waits on a card.
  await page.addInitScript(() => localStorage.setItem('tactical-engine:user-settings', JSON.stringify({ autoRollJumps: true })));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));

  // Two blocks stacked in the open: up is a climb, and down again is a fall past a safe drop.
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  await page.evaluate(() => window.__engine!.setTerrain('block'));
  await page.evaluate(() => window.__engine!.buildAt(3, 10));
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Raise build level', exact: true }).click();
  await page.evaluate(() => window.__engine!.buildAt(3, 10));
  await page.evaluate(() => window.__engine!.setMode('play'));
  await page.evaluate(() => window.__engine!.select('kara'));

  const jump = async (x: number, y: number): Promise<void> => {
    await page.getByTestId('jump-button').click();
    const at = await page.evaluate((spot) => window.__engine!.screenAt(spot.x, spot.y), { x, y });
    await page.mouse.move(at.x, at.y - 8);
    await page.mouse.move(at.x, at.y, { steps: 3 });
    await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
    await page.mouse.click(at.x, at.y);
  };
  await jump(3, 10);
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 40_000 }).toBe(0);
  expect(await page.evaluate(() => window.__engine!.tileOf('kara'))).toBe(10 * 44 + 3);
  const before = await page.evaluate(() => window.__engine!.hitPoints('kara').marked);

  await jump(3, 12);
  // The fall marked something, and the token is reacting to it on the board.
  await expect.poll(() => page.evaluate(() => window.__engine!.hitPoints('kara').marked)).toBeGreaterThan(before);
  await expect.poll(() => page.evaluate(() => window.__engine!.reacting()), { intervals: [50], timeout: 20_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/hurt-token.png' });
  await expect.poll(() => page.evaluate(() => window.__engine!.reacting()), { timeout: 40_000 }).toBe(0);
  expect(await page.evaluate(() => window.__engine!.log().some((line) => line.text.includes('drops 2 blocks')))).toBe(true);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});
