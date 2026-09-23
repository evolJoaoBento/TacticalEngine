import { expect, test, type Page } from '@playwright/test';

/**
 * Who walks with whom is the cards: the party walks as one until a card is dragged to the side,
 * and a card dropped on another walks with that character; between two cards it takes that
 * place in the order, and joins the two either side when they walk together.
 */

async function centre(page: Page, id: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = (await page.locator(`.hud-card[data-member="${id}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
}

/** Pick a card up by its middle and put it down at a point on the screen. */
async function dragCard(page: Page, id: string, to: { x: number; y: number }): Promise<void> {
  const from = await centre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 4);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('a card dragged aside walks alone, dropped on another walks with them, and between two takes its place', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);

  const party = await page.evaluate(() => {
    const api = window.__engine!;
    api.setDiceSpeed(0);
    return api.party();
  });
  expect(party.length).toBeGreaterThanOrEqual(3);
  const [first, second, third] = party as [string, string, string];
  const cards = () => page.locator('.hud-card[data-member]');
  const chains = page.locator('[data-testid="chain"]');
  await expect(cards()).toHaveCount(party.length);
  // One party: every card wears the same band, and one chain runs the length of the column.
  await expect(cards().first()).toHaveAttribute('data-group', '0');
  await expect(chains).toHaveCount(1);

  // Dragged out to the side of the column, a card is put down alone: no band, and nobody's walk moves them.
  const stoodOn = await page.evaluate((id) => window.__engine!.tileOf(id), first);
  const at = await centre(page, second);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + at.w + 60, at.y, { steps: 6 });
  await expect(page.locator('[data-testid="hud"]')).toHaveAttribute('data-drop', 'aside');
  await page.screenshot({ path: 'test-results/link-aside.png' });
  await page.mouse.up();
  await expect(page.locator(`.hud-card[data-member="${second}"]`)).not.toHaveAttribute('data-group', /.+/);
  // The card was let go over the board: putting a card down is not a click on the ground, and nobody walked.
  expect(await page.evaluate((id) => window.__engine!.tileOf(id), first)).toBe(stoodOn);
  // The one let go walks alone: no chain reaches their card, and the rest are still chained to
  // each other, so the chain that is drawn is not theirs.
  await expect(page.locator(`.hud-card[data-member="${second}"] [data-testid="group-tab"]`)).toHaveCount(0);
  const reaches = await page.evaluate((id) => {
    const card = document.querySelector(`.hud-card[data-member="${id}"]`)!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid="chain"]')].some((el) => {
      const chain = el.getBoundingClientRect();
      return chain.top < card.bottom - 4 && chain.bottom > card.top + 4;
    });
  }, second);
  expect(reaches).toBe(false);
  await page.screenshot({ path: 'test-results/link-stranded.png' });
  expect(await page.evaluate((id) => window.__engine!.linked(id), second)).toEqual([second]);
  // The drop was not a click: the selection stayed where it was.
  expect(await page.evaluate(() => window.__engine!.selected())).toBe(first);

  const walked = await page.evaluate(({ first, second, third }) => {
    const api = window.__engine!;
    api.select(first);
    const stood = { second: api.tileOf(second), third: api.tileOf(third) };
    const from = api.standingAt(first)!;
    api.walkTo(from.x + 4, from.y);
    return { stood, second: api.tileOf(second), third: api.tileOf(third) };
  }, { first, second, third });
  expect(walked.second).toBe(walked.stood.second);
  expect(walked.third).not.toBe(walked.stood.third);

  // Dropped on the third card, the second walks with the third, and the cards read first, third, second.
  const onto = await centre(page, third);
  await dragCard(page, second, { x: onto.x, y: onto.y });
  expect(await page.evaluate(() => window.__engine!.party())).toEqual([first, third, second, ...party.slice(3)]);
  // Back with the others, and their card under the one they were dropped on.
  const withSecond = await page.evaluate((id) => window.__engine!.linked(id), second);
  expect(withSecond).toContain(third);
  expect(withSecond.indexOf(second)).toBe(withSecond.indexOf(third) + 1);
  await expect(page.locator(`.hud-card[data-member="${second}"]`)).toHaveAttribute('data-group', /.+/);

  // The first dragged aside walks alone; dropped between the third and the second, they are second in the order, and one of their group again.
  const firstAt = await centre(page, first);
  await dragCard(page, first, { x: firstAt.x + firstAt.w + 60, y: firstAt.y });
  expect(await page.evaluate((id) => window.__engine!.linked(id), first)).toEqual([first]);
  const above = await centre(page, third);
  const gap = { x: above.x, y: above.y + above.h / 2 + 2 };
  await dragCard(page, first, gap);
  expect(await page.evaluate(() => window.__engine!.party())).toEqual([third, first, second, ...party.slice(3)]);
  // Back in the group they were dropped into, in the place they were dropped: between the two.
  const group = await page.evaluate((id) => window.__engine!.linked(id), first);
  expect(group.indexOf(first)).toBe(group.indexOf(third) + 1);
  expect(group.indexOf(second)).toBe(group.indexOf(first) + 1);
  // The cards read in the party's order, and the column is the party's alone.
  expect(await page.locator('[data-testid="hud"] > .hud-card').evaluateAll((els) => els.map((el) => el.getAttribute('data-member')))).toEqual([third, first, second, ...party.slice(3)]);
  // They all walk together again: one chain, starting at the top card's middle and running down
  // past the one they were dropped above.
  await expect(chains).toHaveCount(1);
  const whole = (await chains.first().boundingBox())!;
  const top = await centre(page, third);
  const foot = await centre(page, second);
  expect(Math.abs(whole.y - top.y)).toBeLessThan(3);
  expect(whole.y + whole.height).toBeGreaterThan(foot.y - 3);
  await page.screenshot({ path: 'test-results/link-grouped.png' });

  // A card that grows - a condition, a level-up button - moves everything under it, and the chain follows.
  const grown = (await chains.first().boundingBox())!;
  await page.locator(`.hud-card[data-member="${first}"]`).evaluate((el) => { (el as HTMLElement).style.paddingBottom = '40px'; });
  await expect.poll(async () => (await chains.first().boundingBox())!.height).toBeGreaterThan(grown.height + 30);
  await page.locator(`.hud-card[data-member="${first}"]`).evaluate((el) => { (el as HTMLElement).style.paddingBottom = ''; });

  // A plain click on a card still selects it.
  await page.locator(`.hud-card[data-member="${second}"]`).click();
  expect(await page.evaluate(() => window.__engine!.selected())).toBe(second);
  // And the driver can do the same as the hand.
  const again = await page.evaluate(({ first, second }) => {
    const api = window.__engine!;
    return { parted: api.unlink(first), joined: api.link(first, second), twice: api.link(first, second) };
  }, { first, second });
  expect(again).toEqual({ parted: true, joined: true, twice: false });
});
