import { test, expect, type Browser, type Page } from './fixtures';
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
 * turn is held on such a question nobody's End Turn is pressed. And when the guest's character leads the way in, it
 * is theirs the GM's blows land on: how one lands is the guest's to say, on the panel on their page, the host's page
 * saying it waits on them, the GM's turn held until they do. Nothing parts. Played on the server alone: the ordinary
 * run has no server to share a game on.
 */

test.skip(!ON_SERVER, 'a shared game is played on the server: npm run test:e2e:server');

/** A page up, its game on the server, and the dice not waited for. */
async function playing(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__replica?.server() === 'in' && window.__table?.table() !== null, null, { timeout: 30_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

/** The questions answered, by the page that answered them; and of them, those that held the GM's turn. */
interface Asked { host: number; guest: number; heldGmTurn: number; held: { host: number; guest: number } }

const ASKED = (): Asked => ({ host: 0, guest: 0, heldGmTurn: 0, held: { host: 0, guest: 0 } });

/** The two pages of a shared game, and who plays at them. */
interface Sharing {
  host: Page;
  guest: Page;
  names: { host: string; guest: string };
  /** The host's first character, and the one the guest is seated in. */
  hosts: string;
  guests: string;
  close: () => Promise<void>;
}

/** A game opened by the host's page and joined by a guest's, in a browser and an account of its own, seated. */
async function sharing(page: Page, browser: Browser, baseURL: string, name: string): Promise<Sharing> {
  await playing(page, '/');
  const invite = await page.evaluate(() => window.__table!.table()!.invite);
  const guestContext = await browser.newContext();
  const guestName = `${name}${Date.now().toString(36).slice(-6)}`;
  const made = await guestContext.request.post('/__accounts/register', {
    headers: { 'x-tactical-save': '1', origin: baseURL },
    data: { name: guestName, password: 'played-on-the-server' },
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
  const hostName = await page.evaluate(() => {
    const table = window.__table!.table()!;
    return table.members.find((member) => member.id === table.host)!.name;
  });
  return { host: page, guest, names: { host: hostName, guest: guestName }, hosts, guests, close: () => guestContext.close() };
}

/**
 * Whatever the game asks, answered until neither page is asked anything: each question on the page that plays the
 * character it is put to - the one not saying whom it waits on - once the other says it. Each answer waited for
 * outside the pages, where the server's answer and the other's push come back between them.
 */
async function settle(at: Sharing, asked: Asked, byHand = false): Promise<void> {
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
    // Whose question it is, as each page's game says - not as it is drawn: a page in the background has not drawn the
    // banner for a question the server just pushed it, and would be taken for the one to answer it.
    const waits = await Promise.all([host, guest].map((each) => each.evaluate(() => window.__engine!.waitingOn())));
    const i = [0, 1].find((i) => kinds[i] !== null && waits[i] === null);
    if (i === undefined) {
      await host.waitForTimeout(200);
      continue;
    }
    const whose = i === 0 ? 'host' : 'guest';
    const [answering, other] = i === 0 ? [host, guest] : [guest, host];
    // The other page shows it too, held: whom it waits on, by name, nothing to answer - looked at, as its player would.
    await other.bringToFront();
    await expect(other.getByTestId('waiting-on')).toContainText(`Waiting for ${at.names[whose]} to answer for`, { timeout: 15_000 });
    await expect(other.getByTestId('choice-prompt')).toHaveCount(0);
    // A question holding the GM's turn: nobody hands the spotlight over meanwhile, on either page.
    if ((await answering.evaluate(() => window.__engine!.turnSide())) === 'gm') {
      for (const each of [host, guest]) await expect(each.getByTestId('pass-to-gm')).toBeDisabled();
      asked.heldGmTurn++;
      asked.held[whose]++;
      if (whose === 'guest' && asked.held.guest === 1) {
        await host.bringToFront();
        await host.screenshot({ path: 'test-results/shared-fight-waiting.png' });
      }
    }
    const kind = kinds[i]!;
    await answering.bringToFront();
    const panel = answering.getByTestId('choice-prompt');
    if (byHand && kind === 'choice' && (await panel.count()) > 0) {
      if (whose === 'guest' && asked.held.guest === 1) await guest.screenshot({ path: 'test-results/shared-fight-asked.png' });
      await panel.locator('[data-option]').first().click();
    } else {
      await answering.evaluate((kind) => {
        const a = window.__engine!;
        a.answer(kind === 'check' ? { kind: 'roll' } : kind === 'rolled' ? { kind: 'answered' } : kind === 'dialogue' ? { kind: 'continue' } : { kind: 'choose', index: 0 });
      }, kind);
    }
    asked[whose]++;
    await host.waitForTimeout(200);
  }
  // Both pages stood where the game is.
  for (const each of [host, guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.pendingKind()), { timeout: 15_000 }).toBeNull();
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
  }
}

/**
 * The vault door picked open by somebody's character, the roll their player's to make, and the vault walked into
 * east until the trigger past it wakes the room: the fight on both pages, the party's spotlight first. The foe it
 * is about to be with, the same on both.
 */
async function intoTheVault(at: Sharing, who: 'host' | 'guest', asked: Asked): Promise<string> {
  const page = at[who];
  const id = who === 'host' ? at.hosts : at.guests;
  await page.bringToFront();
  const door = await page.evaluate((id) => {
    const a = window.__engine!;
    a.select(id);
    const door = a.objects().find((o) => o.includes('door')) ?? a.objects()[0]!;
    a.standBeside(door);
    return door;
  }, id);
  for (let n = 0; n < 20 && !(await page.evaluate((id) => window.__engine!.objectState(id).open, door)); n++) {
    await page.bringToFront();
    await page.evaluate((id) => window.__engine!.use(id), door);
    await settle(at, asked);
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
    await settle(at, asked);
    if (!moved) break;
  }
  for (const each of [at.host, at.guest]) {
    await expect.poll(() => each.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => each.evaluate(() => window.__engine!.turnSide()), { timeout: 15_000 }).toBe('party');
  }
  const foe = (await page.evaluate(() => window.__engine!.adversaries()[0]))!;
  expect(foe).toBeDefined();
  expect(await at[who === 'host' ? 'guest' : 'host'].evaluate(() => window.__engine!.adversaries())).toContain(foe);
  return foe;
}

/** Nothing parted on either page, each stood where the game is. */
async function nothingParted(at: Sharing): Promise<void> {
  for (const each of [at.host, at.guest]) {
    await expect.poll(() => each.evaluate(() => window.__replica!.server()), { timeout: 15_000 }).toBe('in');
    expect(await each.evaluate(() => window.__replica!.count().parted)).toBe(0);
  }
}

test("a fight at a shared game: the party's spotlight shared, the GM's turn between, handed over by either player", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  const at = await sharing(page, browser, baseURL!, 'fighter');
  const { guest, guests } = at;
  const asked = ASKED();
  // The host's character opens the vault and walks in.
  const foe = await intoTheVault(at, 'host', asked);

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
    await settle(at, asked);
    await expect.poll(() => page.evaluate((id) => window.__engine!.tileOf(id), guests), { timeout: 15_000 }).toBe(walked.to);
    if (!(await page.evaluate(() => window.__engine!.inCombat()))) break;

    // The host's goes at the foe with theirs: a swing when it is in reach, closing on it when it is not.
    if (!swung && (await page.evaluate(() => window.__engine!.turnSide())) === 'party') {
      await page.bringToFront();
      const before = await page.evaluate(() => window.__engine!.log().length);
      const hit = await page.evaluate((foe) => window.__engine!.attack(foe), foe);
      await page.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
      await settle(at, asked);
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
    await settle(at, asked);

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

  await nothingParted(at);
  await at.close();
});

test("a blow the GM's turn lands on the guest's character is the guest's to answer, the host's page waiting on them", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  const at = await sharing(page, browser, baseURL!, 'leader');
  const { guest, guests } = at;
  const asked = ASKED();
  // The guest's character leads the way in, the door's roll theirs; the host's stay outside, so the room's blows are
  // the guest's to take.
  const foe = await intoTheVault(at, 'guest', asked);
  expect(asked.guest, "the door's roll the guest's").toBeGreaterThan(0);

  // Each round the guest goes at the foe - closing on it, or loosing at it - and hands the spotlight over, until a
  // blow of the GM's turn lands on them.
  for (let turn = 0; turn < 10 && asked.held.guest === 0; turn++) {
    if (!(await page.evaluate(() => window.__engine!.inCombat()))) break;
    const round = await page.evaluate(() => window.__engine!.round());
    await guest.bringToFront();
    await guest.evaluate((foe) => window.__engine!.attack(foe), foe);
    await guest.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 15_000 });
    await settle(at, asked, true);
    if (!(await page.evaluate(() => window.__engine!.inCombat()))) break;
    await guest.bringToFront();
    await guest.getByTestId('pass-to-gm').click();
    await settle(at, asked, true);
    // The GM's turn played to its end once the guest said how it lands: on both pages, the round on.
    for (const each of [page, guest]) {
      await expect.poll(() => each.evaluate(() => window.__engine!.round()), { timeout: 15_000 }).toBeGreaterThan(round);
    }
    if (await page.evaluate(() => window.__engine!.inCombat())) {
      for (const each of [page, guest]) await expect.poll(() => each.evaluate(() => window.__engine!.turnSide()), { timeout: 15_000 }).toBe('party');
    }
  }
  console.log('SHARED FIGHT, LED BY THE GUEST:', JSON.stringify({ asked, guests }));
  expect(asked.held.guest, "a blow of the GM's turn the guest's to answer").toBeGreaterThan(0);
  expect(asked.held.host, "none of the GM's turn the host's").toBe(0);
  const hostLog = await page.evaluate(() => window.__engine!.log().map((l) => l.text));
  await expect.poll(() => guest.evaluate(() => window.__engine!.log().map((l) => l.text).slice(-12)), { timeout: 15_000 }).toEqual(hostLog.slice(-12));
  await nothingParted(at);
  await at.close();
});
