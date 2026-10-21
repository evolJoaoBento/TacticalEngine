import { test, expect, type Browser, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';
import { nothingParted, seated } from './peers';

/**
 * A peer game whose codes the Rust server carries (`docs/PEER.md`, "A link instead of codes"; `server/serve/src/peer.rs`):
 * the host, signed in, has a link to send in place of codes; the guest - no account, a browser of their own - opens
 * it and presses Join, the host lets them in, and they are at the table; their link to the host cut, they are back by
 * themselves, nobody pasting anything or asked; their page opened again, they are back by themselves too. A stranger
 * the host turns away is told so; a guest the host removes is told so, does not come back by themselves, and coming
 * back by the link is the host's to allow again. The game is still the host's page's, played browser to browser:
 * only the codes went through the server. Played on the server alone: the ordinary run has none.
 */

test.skip(!ON_SERVER, "the relay is the Rust server's: npm run test:e2e:server");

/** The host's page hosting, its room's link up. */
async function hosting(page: Page): Promise<string> {
  await page.goto('/?peer=host&as=Hana&ice=none');
  await seated(page);
  await expect(page.getByTestId('lobby')).toBeVisible();
  const link = page.getByTestId('peer-room-link');
  await expect(link).toHaveValue(/\/\?peer=join&room=[0-9a-f]{32}$/, { timeout: 15_000 });
  const sent = new URL(await link.inputValue());
  return `${sent.pathname}${sent.search}`;
}

/** Somebody with no account opening the link from a browser of their own, and pressing Join. */
async function knocks(browser: Browser, link: string, name: string): Promise<{ guest: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(`${link}&as=${name}&ice=none`);
  await expect(guest.getByTestId('peer-join')).toBeVisible({ timeout: 30_000 });
  await guest.getByTestId('peer-room-join').click();
  await expect(guest.getByTestId('peer-join-meeting')).toHaveText('Waiting for your host to let you in…');
  return { guest, close: () => context.close() };
}

/** The host letting in whoever is at the door by that name. */
async function lets(page: Page, name: string): Promise<void> {
  const door = page.locator('[data-testid=peer-knock]', { hasText: `${name} wants to join` });
  await expect(door).toBeVisible({ timeout: 15_000 });
  await door.getByTestId('peer-knock-let').click();
}

test('a peer game joined by a link: one click to join, and back by itself after a drop and after a reload', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const link = await hosting(page);
  await page.screenshot({ path: 'test-results/peer-room-link.png' });

  // A guest with no account opens the link, presses Join, and the host lets them in.
  const { guest, close } = await knocks(browser, link, 'Gus');
  await expect(page.getByTestId('peer-knock')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/peer-knock.png' });
  await lets(page, 'Gus');
  await seated(guest);
  await expect(page.getByTestId('peer-knocks')).toHaveCount(0);
  for (const each of [page, guest]) await expect(each.getByTestId('lobby-members')).toHaveText('Hana (host) · Gus', { timeout: 15_000 });
  const party = await page.evaluate(() => window.__engine!.party());
  const [hosts, guests] = [party[0]!, party[1]!];
  await guest.locator(`[data-testid=lobby-seat][data-character="${guests}"] [data-testid=lobby-take]`).click();
  await expect.poll(() => page.evaluate((c) => window.__table!.table()!.seats[c] !== undefined, guests), { timeout: 15_000 }).toBe(true);
  await page.getByTestId('lobby-start').click();
  for (const each of [page, guest]) await expect(each.getByTestId('lobby')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(guests);

  // Cut off: back through the room by itself.
  await guest.evaluate(() => window.__peer!.drop());
  await expect(guest.getByTestId('peer-lost-auto')).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByTestId('peer-lost')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => guest.evaluate(() => window.__replica!.server()), { timeout: 30_000 }).toBe('in');

  // Opened again: back by itself too, in the game going on, in the same seat.
  await guest.reload();
  await seated(guest);
  await expect(guest.getByTestId('lobby')).toHaveCount(0);
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(guests);

  // And played on: the host walks theirs, the guest's page sees it.
  await page.bringToFront();
  const went = await page.evaluate((id) => {
    const a = window.__engine!;
    a.select(id);
    const from = a.tileOf(id);
    const away = (x: number): number => Math.abs((x % 44) - (from % 44)) + Math.abs(Math.floor(x / 44) - Math.floor(from / 44));
    const tiles = a.reachable().filter((t) => t !== from).sort((x, y) => away(x) - away(y));
    a.moveTo(tiles[Math.min(6, tiles.length - 1)]!);
    a.arrive();
    return a.tileOf(id);
  }, hosts);
  await page.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  await expect.poll(() => guest.evaluate((id) => window.__engine!.tileOf(id), hosts), { timeout: 15_000 }).toBe(went);
  // Coming back, a player at the game is never asked about.
  await expect(page.getByTestId('peer-knocks')).toHaveCount(0);
  await nothingParted({ host: page, guest, names: { host: 'Hana', guest: 'Gus' }, hosts, guests, close });
  await close();
});

test('the host turns a stranger away, and removes a guest - who comes back only if let in again', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const link = await hosting(page);
  const gus = await knocks(browser, link, 'Gus');
  await lets(page, 'Gus');
  await seated(gus.guest);

  // A stranger at the door, turned away: told so on their page.
  const stranger = await knocks(browser, link, 'Mallory');
  const door = page.locator('[data-testid=peer-knock]', { hasText: 'Mallory wants to join' });
  await expect(door).toBeVisible({ timeout: 15_000 });
  await door.getByTestId('peer-knock-away').click();
  await expect(stranger.guest.getByTestId('peer-join-problem')).toHaveText('The host did not let you in.', { timeout: 15_000 });
  await expect(page.getByTestId('peer-knocks')).toHaveCount(0);
  await expect(page.getByTestId('lobby-members')).toHaveText('Hana (host) · Gus');

  // Gus removed: told so, and not back by themselves.
  await page.locator('[data-testid=peer-member]', { hasText: 'Gus' }).getByTestId('peer-remove').click();
  await expect(gus.guest.getByTestId('peer-ended')).toContainText('The host removed you from the game.', { timeout: 15_000 });
  // At no table now: no lobby over their game, and every character theirs to play, alone.
  await expect(gus.guest.getByTestId('lobby')).toHaveCount(0, { timeout: 15_000 });
  expect(await gus.guest.evaluate(() => window.__table!.table())).toBeNull();
  const theirs = (await gus.guest.evaluate(() => window.__engine!.party()))[0]!;
  expect(await gus.guest.evaluate((id) => window.__engine!.select(id), theirs)).toBe(true);
  await expect(page.getByTestId('lobby-members')).toHaveText('Hana (host)', { timeout: 15_000 });
  await gus.guest.screenshot({ path: 'test-results/peer-removed.png' });
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('peer-knocks')).toHaveCount(0);
  await expect(page.getByTestId('lobby-members')).toHaveText('Hana (host)');

  // Opened again, Gus knocks by themselves: the host is asked, as for anybody, and lets them back in.
  await gus.guest.reload();
  await lets(page, 'Gus');
  await seated(gus.guest);
  await expect(page.getByTestId('lobby-members')).toHaveText('Hana (host) · Gus', { timeout: 15_000 });
  await stranger.close();
  await gus.close();
});
