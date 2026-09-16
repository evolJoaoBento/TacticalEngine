import { test, expect, type Page } from '@playwright/test';

/**
 * A check, asked and thrown.
 *
 * The roll a player is asked for is the one moment the game stops and waits on
 * them, and it is drawn as such: the room blurs out behind a card that names the
 * roll and sets the dice down with what is added to them, the dice tumble on it,
 * and it holds what they came to until it is read. This drives that from the
 * vault door — the first locked thing in the demo — through every state of it.
 */

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5, null, { timeout: 30_000 });
  return errors;
}

/** Stand at the locked door and try it: that is what asks for a roll. */
async function tryTheDoor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const api = window.__engine!;
    const door = api.objects().find((id) => id.includes('door')) ?? api.objects()[0]!;
    api.standBeside(door);
    return api.use(door);
  });
}

test('the door asks for a roll on a card over the room, and holds the dice until they are read', async ({ page }) => {
  const errors = await ready(page);
  // A slow throw, so the dice are caught in the air rather than raced past.
  await page.evaluate(() => window.__engine!.setDiceSpeed(2000));

  expect(await tryTheDoor(page)).toBe('waiting');
  const card = page.locator('[data-testid="check-prompt"]');
  await expect(card).toBeVisible();
  // What a player decides from: what is being rolled, against what, and the pair
  // of dice with the modifier beside them.
  await expect(card.locator('[data-testid="difficulty"]')).toBeVisible();
  await expect(card.locator('[data-testid="die"]')).toHaveCount(2);
  await expect(card.locator('[data-testid="roll"]')).toContainText(/[+−-]\d/);
  await page.screenshot({ path: 'test-results/roll-asked.png' });

  // Cancel steps back out of it, and the room is there to walk around again.
  await card.locator('[data-testid="cancel-roll"]').click();
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();

  // Ask again, and throw them.
  expect(await tryTheDoor(page)).toBe('waiting');
  await expect(card).toBeVisible();
  await card.locator('[data-testid="roll"]').click();

  const result = page.locator('[data-testid="roll-result"]');
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute('data-settled', 'false');
  await page.screenshot({ path: 'test-results/roll-thrown.png' });

  // They land on what the rules already rolled, and both dice show it.
  await expect(result).toHaveAttribute('data-settled', 'true', { timeout: 20_000 });
  const faces = await result.evaluate((el) => ({
    good: el.getAttribute('data-good'),
    bad: el.getAttribute('data-bad'),
    shown: [...el.querySelectorAll('[data-testid="die"]')].map((die) => die.getAttribute('data-face')),
  }));
  console.log('FACES:', JSON.stringify(faces));
  expect(faces.shown).toEqual([faces.good, faces.bad]);
  await page.screenshot({ path: 'test-results/roll-tally.png' });

  // The sum is read out a term at a time, and the verdict lands on the end of it.
  await expect(result.locator('[data-testid="verdict"]')).toBeVisible();
  expect(await result.locator('[data-testid="step"]').count()).toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: 'test-results/roll-read.png' });

  // Accept is what lets the room move on — and the throw was this card's, so the
  // tray behind it never shows the same dice over again.
  await result.locator('[data-testid="accept"]').click();
  await expect(result).toHaveCount(0);
  await expect(page.locator('[data-testid="dice-tray"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.dice().length)).toBe(0);

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a fighter clicks past one move, and an Agility Roll stands between them and the spot', async ({ page }) => {
  const errors = await ready(page);
  const tile = await page.evaluate(() => {
    const api = window.__engine!;
    api.startFight();
    api.select('kara');
    return api.underPressure()[0] ?? -1;
  });
  expect(tile).toBeGreaterThanOrEqual(0);
  const before = await page.evaluate(() => window.__engine!.standingAt('kara'));

  // The click asks rather than walks.
  expect(await page.evaluate((t) => window.__engine!.moveTo(t), tile)).toBe(false);
  const prompt = page.locator('[data-testid="check-prompt"]');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Agility');
  expect(await page.evaluate(() => window.__engine!.standingAt('kara'))).toEqual(before);

  // Answered, she goes: the whole way on a success, as far as one move on a failure.
  await prompt.locator('[data-testid="roll"]').click();
  await expect(prompt).toHaveCount(0);
  await page.locator('[data-testid="accept"]').click();
  expect(await page.evaluate(() => window.__engine!.standingAt('kara'))).not.toEqual(before);

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
