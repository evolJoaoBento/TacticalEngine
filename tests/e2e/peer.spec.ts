import { test, expect, type Browser, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

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

/** A page's game up, at the table, the dice not waited for. */
async function seated(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

interface Peers {
  host: Page;
  guest: Page;
  names: { host: string; guest: string };
  hosts: string;
  guests: string;
  close: () => Promise<void>;
}

/** A peer game hosted by `page`, a guest invited into it from a browser of their own, seated, and started. */
async function peers(page: Page, browser: Browser): Promise<Peers> {
  await page.goto('/?peer=host&as=Hana&ice=none');
  await seated(page);
  await expect(page.getByTestId('lobby')).toBeVisible();
  await page.getByTestId('peer-invite').click();
  const code = page.getByTestId('peer-invite-code');
  await expect(code).toHaveValue(/^TE1\./, { timeout: 15_000 });

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto('/?peer=join&as=Gus&ice=none');
  await expect(guest.getByTestId('peer-join')).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId('peer-name')).toHaveValue('Gus');
  // Something that is not a code is said to be none, and the guest may paste again.
  await guest.getByTestId('peer-code').fill('hello');
  await guest.getByTestId('peer-make-reply').click();
  await expect(guest.getByTestId('peer-join-problem')).toContainText('not an invitation code');
  await guest.getByTestId('peer-code').fill(await code.inputValue());
  await guest.getByTestId('peer-make-reply').click();
  const reply = guest.getByTestId('peer-reply');
  await expect(reply).toHaveValue(/^TE1\./, { timeout: 15_000 });
  await guest.screenshot({ path: 'test-results/peer-reply.png' });

  await page.getByTestId('peer-invite-reply').fill(await reply.inputValue());
  await page.getByTestId('peer-invite-connect').click();
  await expect(page.getByTestId('peer-invite-said')).toContainText('Gus is at the table', { timeout: 30_000 });
  await seated(guest);

  // The lobby on both pages: who is at the table, the guest's seat taken by the guest, the game started by the host.
  for (const each of [page, guest]) await expect(each.getByTestId('lobby-members')).toHaveText('Hana (host) · Gus', { timeout: 15_000 });
  await expect(guest.getByTestId('lobby-waiting')).toContainText('Waiting for Hana to start the game.');
  await page.screenshot({ path: 'test-results/peer-lobby.png' });
  const party = await page.evaluate(() => window.__engine!.party());
  const [hosts, guests] = [party[0]!, party[1]!];
  await guest.locator(`[data-testid=lobby-seat][data-character="${guests}"] [data-testid=lobby-take]`).click();
  const guestId = await guest.evaluate(() => window.__table!.table()!.members.find((m) => m.name === 'Gus')!.id);
  await expect.poll(() => page.evaluate((c) => window.__table!.table()!.seats[c], guests), { timeout: 15_000 }).toBe(guestId);
  await page.getByTestId('lobby-start').click();
  for (const each of [page, guest]) await expect(each.getByTestId('lobby')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(guests);
  return { host: page, guest, names: { host: 'Hana', guest: 'Gus' }, hosts, guests, close: () => guestContext.close() };
}

/** Whatever the game asks, answered on the page that plays its character, the other saying whom it waits on. */
async function settle(at: Peers): Promise<void> {
  const { host, guest } = at;
  let quiet = 0;
  for (let n = 0; n < 80 && quiet < 2; n++) {
    const kinds = await Promise.all([host, guest].map((each) => each.evaluate(() => window.__engine!.pendingKind())));
    if (kinds.every((kind) => kind === null)) {
      quiet++;
      await host.waitForTimeout(200);
      continue;
    }
    quiet = 0;
    const waits = await Promise.all([host, guest].map((each) => each.getByTestId('waiting-on').count()));
    const i = [0, 1].find((i) => kinds[i] !== null && waits[i] === 0);
    if (i === undefined) {
      await host.waitForTimeout(200);
      continue;
    }
    const [answering, other] = i === 0 ? [host, guest] : [guest, host];
    await expect(other.getByTestId('waiting-on')).toContainText(`Waiting for ${i === 0 ? at.names.host : at.names.guest}`, { timeout: 15_000 });
    await answering.bringToFront();
    await answering.evaluate((kind) => {
      const a = window.__engine!;
      a.answer(kind === 'check' ? { kind: 'roll' } : kind === 'rolled' ? { kind: 'answered' } : kind === 'dialogue' ? { kind: 'continue' } : { kind: 'choose', index: 0 });
    }, kinds[i]!);
    await host.waitForTimeout(200);
  }
  for (const each of [host, guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.pendingKind()), { timeout: 15_000 }).toBeNull();
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
  }
}

async function nothingParted(at: Peers): Promise<void> {
  for (const each of [at.host, at.guest]) {
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }
}

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
