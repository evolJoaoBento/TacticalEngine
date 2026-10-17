import { test, expect } from './fixtures';
import { ON_SERVER } from './server-mode';
import { nothingParted, seated } from './peers';

/**
 * A peer game whose codes the Rust server carries (`docs/PEER.md`, "A link instead of codes"; `server/serve/src/peer.rs`):
 * the host, signed in, has a link to send in place of codes; the guest - no account, a browser of their own - opens
 * it and presses Join, and is at the table; their link to the host cut, they are back by themselves, nobody pasting
 * anything; their page opened again, they are back by themselves too. The game is still the host's page's, played
 * browser to browser: only the codes went through the server. Played on the server alone: the ordinary run has none.
 */

test.skip(!ON_SERVER, "the relay is the Rust server's: npm run test:e2e:server");

test('a peer game joined by a link: one click to join, and back by itself after a drop and after a reload', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.goto('/?peer=host&as=Hana&ice=none');
  await seated(page);
  await expect(page.getByTestId('lobby')).toBeVisible();
  const link = page.getByTestId('peer-room-link');
  await expect(link).toHaveValue(/\/\?peer=join&room=[0-9a-f]{32}$/, { timeout: 15_000 });
  await page.screenshot({ path: 'test-results/peer-room-link.png' });

  // A guest with no account opens the link, and presses Join.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const sent = new URL(await link.inputValue());
  await guest.goto(`${sent.pathname}${sent.search}&as=Gus&ice=none`);
  await expect(guest.getByTestId('peer-join')).toBeVisible({ timeout: 30_000 });
  await guest.getByTestId('peer-room-join').click();
  await seated(guest);
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
  await nothingParted({ host: page, guest, names: { host: 'Hana', guest: 'Gus' }, hosts, guests, close: () => guestContext.close() });
  await guestContext.close();
});
