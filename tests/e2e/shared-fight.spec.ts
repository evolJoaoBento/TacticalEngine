import { test, expect, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * A fight at a shared game (`docs/SERVER.md`, phase 5: the turn, as decided), in two browsers: the host's page and a
 * guest's, each signed in to an account of its own. The host's character opens the vault and walks in, and the fight
 * it wakes is on both pages. In it the party's spotlight is shared - the guest walks their own, the host swings with
 * theirs, each seen on the other's page - and the GM's turn comes between, handed over by either: the guest with the
 * End Turn key, the host with Space - or by a roll that went the GM's way, the key then saying the GM's turn is to be
 * played, and playing it. Each time it is played on the server, the round goes on and the spotlight
 * comes back to the party on both pages, and both logs say the same. Whatever the fight asks - a roll, how a blow
 * lands - is answered on the page that plays its character, the other shown whom it waits on, and while the GM's
 * turn is held on such a question nobody's End Turn is pressed. Nothing parts. Played on the server alone: the
 * ordinary run has no server to share a game on.
 */

test.skip(!ON_SERVER, 'a shared game is played on the server: npm run test:e2e:server');

/** A page up, its game on the server, and the dice not waited for. */
async function playing(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

/** The questions answered, by the page that answered them; and how many held the GM's turn. */
interface Asked { host: number; guest: number; heldGmTurn: number }

/**
 * Whatever the game asks, answered until neither page is asked anything: each question on the page that plays the
 * character it is put to - the one not saying whom it waits on - once the other says it. Each answer waited for
 * outside the pages, where the server's answer and the other's push come back between them.
 */
async function settle(host: Page, guest: Page, asked: Asked): Promise<void> {
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
    const at = [0, 1].find((i) => kinds[i] !== null && waits[i] === 0);
    if (at === undefined) {
      await host.waitForTimeout(200);
      continue;
    }
    const [answering, other] = at === 0 ? [host, guest] : [guest, host];
    // The other page shows it too, held: whom it waits on, nothing to answer.
    await expect(other.getByTestId('waiting-on')).toContainText('to answer for', { timeout: 15_000 });
    // A question holding the GM's turn: nobody hands the spotlight over meanwhile, on either page.
    if ((await answering.evaluate(() => window.__engine!.turnSide())) === 'gm') {
      for (const each of [host, guest]) await expect(each.getByTestId('pass-to-gm')).toBeDisabled();
      asked.heldGmTurn++;
    }
    const kind = kinds[at]!;
    await answering.bringToFront();
    await answering.evaluate((kind) => {
      const a = window.__engine!;
      a.answer(kind === 'check' ? { kind: 'roll' } : kind === 'rolled' ? { kind: 'answered' } : kind === 'dialogue' ? { kind: 'continue' } : { kind: 'choose', index: 0 });
    }, kind);
    if (at === 0) asked.host++;
    else asked.guest++;
    await host.waitForTimeout(200);
  }
  // Both pages stood where the game is.
  for (const each of [host, guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.pendingKind()), { timeout: 15_000 }).toBeNull();
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
  }
}

test("a fight at a shared game: the party's spotlight shared, the GM's turn between, handed over by either player", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await playing(page, '/');
  const invite = await page.evaluate(() => window.__table!.table()!.invite);
  const guestContext = await browser.newContext();
  const made = await guestContext.request.post('/__accounts/register', {
    headers: { 'x-tactical-save': '1', origin: baseURL! },
    data: { name: `fighter${Date.now().toString(36).slice(-6)}`, password: 'played-on-the-server' },
  });
  expect(made.status(), await made.text()).toBe(200);
  const guestId = ((await made.json()) as { id: string }).id;
  const guest = await guestContext.newPage();
  await playing(guest, `/?join=${invite}`);
  await page.waitForFunction(() => window.__table!.table()!.members.length === 2, null, { timeout: 15_000 });
  const party = await page.evaluate(() => window.__engine!.party());
  const [hosts, guests] = [party[0]!, party[1]!];
  expect(await page.evaluate(([character, account]) => window.__table!.seat(character!, account!), [guests, guestId])).toBe(true);
  await expect.poll(() => guest.evaluate(() => window.__engine!.selected()), { timeout: 15_000 }).toBe(guests);
  const asked: Asked = { host: 0, guest: 0, heldGmTurn: 0 };

  // The host's character picks the vault door open, the roll the host's to make.
  await page.bringToFront();
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
    await settle(page, guest, asked);
  }
  expect(await page.evaluate((id) => window.__engine!.objectState(id).open, door)).toBe(true);

  // And walks east until the trigger past it wakes the room: the fight on both pages, the party's spotlight first.
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
    await settle(page, guest, asked);
    if (!moved) break;
  }
  for (const each of [page, guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => each.evaluate(() => window.__engine!.turnSide()), { timeout: 15_000 }).toBe('party');
  }
  const foe = (await page.evaluate(() => window.__engine!.adversaries()[0]))!;
  expect(foe).toBeDefined();
  expect(await guest.evaluate(() => window.__engine!.adversaries())).toContain(foe);

  let swung = false;
  const handedBy = { host: 0, guest: 0 };
  let rolledOver = 0;
  for (let turn = 0; turn < 10 && !(swung && handedBy.host > 0 && handedBy.guest > 0); turn++) {
    if (!(await page.evaluate(() => window.__engine!.inCombat()))) break;
    const round = await page.evaluate(() => window.__engine!.round());
    // The party's spotlight, on both pages: Round N, and either may hand it over.
    for (const each of [page, guest]) {
      await expect.poll(() => each.evaluate(() => window.__engine!.round()), { timeout: 15_000 }).toBe(round);
      await expect(each.getByTestId('action-bar')).toContainText(`Round ${round}`);
      await expect(each.getByTestId('pass-to-gm')).toBeEnabled();
    }

    // The guest walks their own toward the foe: the host's page stood where it leaves them.
    await guest.bringToFront();
    const walked = await guest.evaluate(([id, foe]) => {
      const a = window.__engine!;
      const away = (t: number, to: number): number => Math.abs((t % 44) - (to % 44)) + Math.abs(Math.floor(t / 44) - Math.floor(to / 44));
      const from = a.tileOf(id!);
      const there = a.tileOf(foe!);
      const nearer = a.reachable().filter((t) => away(t, there) < away(from, there) && away(t, there) > 1);
      if (nearer.length === 0) return { from, to: from };
      a.moveTo(nearer.reduce((x, y) => (away(y, there) < away(x, there) ? y : x)));
      return { from, to: a.tileOf(id!) };
    }, [guests, foe]);
    await guest.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
    await settle(page, guest, asked);
    await expect.poll(() => page.evaluate((id) => window.__engine!.tileOf(id), guests), { timeout: 15_000 }).toBe(walked.to);
    if (!(await page.evaluate(() => window.__engine!.inCombat()))) break;

    // The host's goes at the foe with theirs: a swing when it is in reach, closing on it when it is not.
    if (!swung && (await page.evaluate(() => window.__engine!.turnSide())) === 'party') {
      await page.bringToFront();
      const before = await page.evaluate(() => window.__engine!.log().length);
      const hit = await page.evaluate((foe) => window.__engine!.attack(foe), foe);
      await page.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
      await settle(page, guest, asked);
      if (hit) {
        swung = true;
        // The swing on the guest's page as on the host's: the same lines, the same dice.
        const said = await page.evaluate((before) => window.__engine!.log().slice(before).map((l) => l.text), before);
        expect(said.length).toBeGreaterThan(0);
        await expect.poll(() => guest.evaluate(() => window.__engine!.log().map((l) => l.text)), { timeout: 15_000 }).toEqual(expect.arrayContaining(said));
        await guest.bringToFront();
        await guest.screenshot({ path: 'test-results/shared-fight-swing.png' });
      }
    }
    if (!(await page.evaluate(() => window.__engine!.inCombat()))) break;

    // The spotlight handed to the GM, by each player in turn - the guest with the key, the host with Space. A roll
    // that went the GM's way has handed it over already: the key on both pages says the GM's turn is to be played,
    // and plays it.
    const side = await page.evaluate(() => window.__engine!.turnSide());
    const key = side === 'gm' ? "GM's Turn" : 'End Turn';
    for (const each of [page, guest]) {
      await expect(each.getByTestId('pass-to-gm')).toHaveText(key);
      await expect(each.getByTestId('pass-to-gm')).toBeEnabled();
    }
    if (side === 'gm') rolledOver++;
    const handing = handedBy.guest <= handedBy.host ? 'guest' : 'host';
    if (handing === 'guest') {
      await guest.bringToFront();
      await guest.getByTestId('pass-to-gm').click();
    } else {
      await page.bringToFront();
      await page.keyboard.press('Space');
    }
    handedBy[handing]++;
    await settle(page, guest, asked);

    // The GM's turn played on the server, between: the round gone on and the spotlight the party's again, on both
    // pages, and both logs the same.
    for (const each of [page, guest]) {
      await expect.poll(() => each.evaluate(() => window.__engine!.round()), { timeout: 15_000 }).toBeGreaterThan(round);
    }
    if (!(await page.evaluate(() => window.__engine!.inCombat()))) break;
    for (const each of [page, guest]) {
      await expect.poll(() => each.evaluate(() => window.__engine!.turnSide()), { timeout: 15_000 }).toBe('party');
    }
    const hostLog = await page.evaluate(() => window.__engine!.log().map((l) => l.text));
    await expect.poll(() => guest.evaluate(() => window.__engine!.log().map((l) => l.text).slice(-12)), { timeout: 15_000 }).toEqual(hostLog.slice(-12));
  }
  console.log('SHARED FIGHT:', JSON.stringify({ swung, handedBy, rolledOver, asked }));
  expect(swung, 'the host swung at the foe').toBe(true);
  expect(handedBy.guest, 'the guest handed the spotlight over').toBeGreaterThan(0);
  expect(handedBy.host, 'the host handed the spotlight over').toBeGreaterThan(0);
  await guest.bringToFront();
  await guest.screenshot({ path: 'test-results/shared-fight-guest.png' });

  // Nothing parted on either page.
  for (const each of [page, guest]) {
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }
  await guestContext.close();
});
