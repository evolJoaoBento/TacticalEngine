import { test, expect, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';
import { nothingParted, peers, seated, settle } from './peers';

/**
 * A peer game (`docs/PEER.md`), in two browsers and no server: the host's page keeps the game, and a guest's meets it
 * over WebRTC, the codes carried between them by hand - here by the test, through the very boxes a player pastes
 * into. The host invites from the lobby; the guest pastes the host's code before their page boots, and sends a reply
 * back; the host pastes that, and the guest's page boots over the host's project and joins. In the lobby the guest
 * takes a seat, the host starts the game, and each plays their own, seen on the other's page - and a fight: the
 * vault opened, the party's spotlight shared, the GM's turn handed over by the guest, played on the host's table, the
 * round going on on both pages, the logs alike. Nothing parts. Played the ordinary way alone: the server's run has
 * a server, which a peer game does without. On one machine no STUN server is asked (`?ice=none`).
 */

test.skip(ON_SERVER, 'a peer game has no server: the ordinary run plays it');

test("the menu's Peer to Peer: a name given, a game joined, or one hosted from the list", async ({ page }) => {
  await page.goto('/?menu');
  await page.getByTestId('menu-peer').click();
  await page.getByTestId('menu-peer-name').fill('  Gus ');
  await page.getByTestId('menu-peer-join').click();
  await expect(page).toHaveURL(/[?&]peer=join&as=Gus$/);
  await expect(page.getByTestId('peer-join')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('peer-name')).toHaveValue('Gus');
  await page.goto('/?menu');
  await page.getByTestId('menu-peer').click();
  await page.getByTestId('menu-peer-name').fill('Hana');
  await page.getByTestId('menu-peer-list').getByTestId('menu-play-demo').click();
  await expect(page).toHaveURL(/[?&]play&peer=host&as=Hana$/);
  await seated(page);
  await expect(page.getByTestId('lobby')).toBeVisible();
  await expect(page.getByTestId('lobby-members')).toHaveText('Hana (host)');
  await expect(page.getByTestId('peer-invite')).toBeVisible();
});

test('a peer game: hosted with no server, a guest invited by code, seated, started, each playing their own', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const at = await peers(page, browser);
  const { guest, hosts, guests } = at;

  // The guest walks theirs: the host's page stood where it leaves them.
  await guest.bringToFront();
  const walked = await guest.evaluate((id) => {
    const a = window.__engine!;
    const from = a.tileOf(id);
    const tiles = a.reachable().filter((t) => t !== from);
    a.moveTo(tiles[Math.floor(tiles.length / 2)]!);
    a.arrive();
    return a.tileOf(id);
  }, guests);
  await guest.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  await expect.poll(() => page.evaluate((id) => window.__engine!.tileOf(id), guests), { timeout: 15_000 }).toBe(walked);

  // The host walks theirs: the guest's page stood where it leaves them.
  await page.bringToFront();
  const went = await page.evaluate((id) => {
    const a = window.__engine!;
    a.select(id);
    const from = a.tileOf(id);
    const tiles = a.reachable().filter((t) => t !== from);
    a.moveTo(tiles[0]!);
    a.arrive();
    return a.tileOf(id);
  }, hosts);
  await page.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
  await expect.poll(() => guest.evaluate((id) => window.__engine!.tileOf(id), hosts), { timeout: 15_000 }).toBe(went);

  // Each plays their own: the host's character is not the guest's to pick up.
  expect(await guest.evaluate((id) => window.__engine!.select(id), hosts)).toBe(false);
  expect(await guest.evaluate(() => window.__engine!.selected())).toBe(guests);
  await guest.screenshot({ path: 'test-results/peer-playing.png' });
  await nothingParted(at);
  await at.close();
});

test('a fight at a peer game: the GM\'s turn handed over by the guest, played on the host\'s table, the round on on both', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const at = await peers(page, browser);
  const { guest, hosts } = at;

  // The host's character opens the vault and walks in.
  const door = await page.evaluate((id) => {
    const a = window.__engine!;
    a.select(id);
    const door = a.objects().find((o) => o.includes('door')) ?? a.objects()[0]!;
    a.standBeside(door);
    return door;
  }, hosts);
  for (let n = 0; n < 20 && !(await page.evaluate((id) => window.__engine!.objectState(id).open, door)); n++) {
    await page.bringToFront();
    await page.evaluate((id) => window.__engine!.use(id), door);
    await settle(at);
  }
  expect(await page.evaluate((id) => window.__engine!.objectState(id).open, door)).toBe(true);
  for (let n = 0; n < 15 && !(await page.evaluate(() => window.__engine!.inCombat())); n++) {
    await page.bringToFront();
    const moved = await page.evaluate(() => {
      const a = window.__engine!;
      const tiles = a.reachable();
      if (tiles.length === 0) return false;
      const inside = tiles.filter((t) => Math.floor(t / 44) < 16);
      const east = (inside.length > 0 ? inside : tiles).reduce((x, y) => (y % 44 > x % 44 ? y : x));
      const walked = a.moveTo(east);
      a.arrive();
      return walked;
    });
    await settle(at);
    if (!moved) break;
  }
  for (const each of [page, guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => each.evaluate(() => window.__engine!.turnSide()), { timeout: 15_000 }).toBe('party');
  }

  // The guest hands the spotlight to the GM, twice: each time the GM's turn is played and the round goes on on both.
  for (let turn = 0; turn < 2; turn++) {
    if (!(await page.evaluate(() => window.__engine!.inCombat()))) break;
    const round = await page.evaluate(() => window.__engine!.round());
    for (const each of [page, guest]) await expect(each.getByTestId('action-bar')).toContainText(`Round ${round}`, { timeout: 15_000 });
    await guest.bringToFront();
    await expect(guest.getByTestId('pass-to-gm')).toBeEnabled({ timeout: 15_000 });
    await guest.getByTestId('pass-to-gm').click();
    for (let n = 0; n < 30 && (await page.evaluate(() => window.__engine!.round())) === round; n++) await settle(at);
    for (const each of [page, guest]) await expect.poll(() => each.evaluate(() => window.__engine!.round()), { timeout: 30_000 }).toBeGreaterThan(round);
    await settle(at);
    const lines = (each: Page): Promise<string[]> => each.evaluate(() => window.__engine!.log().slice(-12).map((l) => l.text));
    await expect.poll(async () => JSON.stringify(await lines(guest)), { timeout: 15_000 }).toBe(JSON.stringify(await lines(page)));
  }
  await guest.screenshot({ path: 'test-results/peer-fight.png' });
  await nothingParted(at);
  await at.close();
});
