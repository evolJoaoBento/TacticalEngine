import { test, expect } from './fixtures';
import { ON_SERVER } from './server-mode';
import { invited, nothingParted, peers, seated } from './peers';

/**
 * A peer game's save (`docs/PEER.md`, "Saves"): the host saves an evening, who played whom kept with it in the host's
 * browser; another evening - every tab new, so every player's id - the host hosts it again from the save, and the
 * lobby keeps the guest's character for them by name; the guest comes, from a browser of their own, and is seated in
 * it as they join, the game where it was saved. Played the ordinary way alone, as `peer.spec.ts` is.
 */

test.skip(ON_SERVER, 'a peer game has no server: the ordinary run plays it');

test('a peer game saved, hosted again another evening: the guest, in a new tab, seated in their own by name', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const at = await peers(page, browser);
  const { guest, guests } = at;

  // The guest walks theirs, and the host saves the evening.
  await guest.bringToFront();
  const walked = await guest.evaluate((id) => {
    const a = window.__engine!;
    const from = a.tileOf(id);
    const away = (x: number): number => Math.abs((x % 44) - (from % 44)) + Math.abs(Math.floor(x / 44) - Math.floor(from / 44));
    const tiles = a.reachable().filter((t) => t !== from).sort((x, y) => away(x) - away(y));
    a.moveTo(tiles[Math.min(8, tiles.length - 1)]!);
    a.arrive();
    return a.tileOf(id);
  }, guests);
  await guest.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  await expect.poll(() => page.evaluate((id) => window.__engine!.tileOf(id), guests), { timeout: 15_000 }).toBe(walked);
  await page.bringToFront();
  const slot = await page.evaluate(() => window.__engine!.saveAs('The evening'));
  expect(slot).not.toBeNull();
  await nothingParted(at);
  await at.close();

  // Another evening, another tab: the host hosts the save again.
  const host = await page.context().newPage();
  await page.close();
  await host.goto(`/?play&peer=host&as=Hana&ice=none&load=${slot!}`);
  await seated(host);
  await expect(host.getByTestId('lobby')).toBeVisible();
  const seat = (on: typeof host) => on.locator(`[data-testid=lobby-seat][data-character="${guests}"]`);
  await expect(seat(host).getByTestId('lobby-kept')).toHaveText('Kept for Gus', { timeout: 15_000 });
  await expect.poll(() => host.evaluate((id) => window.__engine!.tileOf(id), guests), { timeout: 15_000 }).toBe(walked);
  await host.screenshot({ path: 'test-results/peer-kept.png' });

  // Gus comes, from a browser of their own: their character is theirs as they join.
  const back = await invited(host, browser, 'Gus');
  const gusId = await back.guest.evaluate(() => window.__table!.table()!.members.find((m) => m.name === 'Gus')!.id);
  await expect.poll(() => host.evaluate((c) => window.__table!.table()!.seats[c], guests), { timeout: 15_000 }).toBe(gusId);
  await expect(seat(host).getByTestId('lobby-kept')).toHaveCount(0);
  await expect(seat(back.guest).getByTestId('lobby-seated')).toHaveText('You');
  await host.getByTestId('lobby-start').click();
  for (const each of [host, back.guest]) await expect(each.getByTestId('lobby')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => back.guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(guests);
  expect(await back.guest.evaluate((id) => window.__engine!.tileOf(id), guests)).toBe(walked);
  await nothingParted({ ...at, host, guest: back.guest });
  await back.close();
});
