import { test, expect } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * The engine in the page, asked beside the game (`docs/SERVER.md`, phase 3, slice 2c).
 *
 * In development every question the pointer asks - the ground a walk reaches, where a push asks a roll,
 * the line a click would walk, where a card may land and whom it may be aimed at, whom it would catch,
 * whether a jump is offered - is put to the game and to a replica of it in the Rust engine built to
 * WebAssembly (`src/game/shadow.ts`), and where the two part is counted. This plays a fight and asks all of
 * it, every member, round after round, and holds the count to nought. It needs `npm run wasm`: without the
 * engine there is no replica, and it says so.
 */

test('the replica answers the pointer as the game does, through a fight', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 30_000 });
  const replica = await page
    .waitForFunction(() => window.__replica !== undefined, null, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  expect(replica, 'no replica in the page: build the engine with `npm run wasm`').toBe(true);

  const played = await page.evaluate(() => {
    const a = window.__engine!;
    a.setDiceSpeed(0);
    const drain = (): void => {
      for (let i = 0; i < 20 && a.pendingKind() !== null; i++) a.answer({ kind: 'choose', index: 0 });
    };
    // Out of a fight first: the walk anywhere, and its previews.
    for (const id of a.party()) {
      a.select(id);
      a.reachable();
      const at = a.standingAt(id);
      if (at !== null) for (const [dx, dy] of [[3, 0], [0, 4], [-5, 2]]) a.previewAt(at.x + dx!, at.y + dy!);
    }
    // Into a fight, beside the first creature.
    const foe = a.adversaries()[0];
    if (foe === undefined) return { fought: false, rounds: 0 };
    a.select(a.party()[0]!);
    a.standNear(foe);
    a.startFight();
    let rounds = 0;
    for (; rounds < 3 && a.inCombat(); rounds++) {
      for (const id of a.party()) {
        if (!a.inCombat()) break;
        a.select(id);
        a.reachable();
        a.underPressure();
        const at = a.standingAt(id);
        if (at !== null) for (const [dx, dy] of [[2, 1], [-3, 0], [6, 6]]) a.previewAt(at.x + dx!, at.y + dy!);
        for (const card of a.abilities(id)) {
          const tiles = a.aim(card.id);
          for (const tile of tiles.slice(0, 3)) a.shape(card.id, tile);
        }
        const usable = a.abilities(id).filter((card) => card.usable);
        const card = usable[0];
        if (card !== undefined) {
          const tiles = a.aim(card.id);
          a.useAbility(id, card.id, card.targets.slice(0, 1), tiles[0]);
          drain();
        }
      }
      a.endGmTurn();
      drain();
    }
    return { fought: true, rounds };
  });
  expect(played.fought).toBe(true);

  // Played on the server, every intent's answer back before the count is read.
  if (ON_SERVER) await page.waitForFunction(() => window.__replica!.server() === 'in', null, { timeout: 15_000 });
  const count = await page.evaluate(() => window.__replica!.count());
  const playing = await page.evaluate(() => window.__replica!.playing());
  const server = await page.evaluate(() => window.__replica!.server());
  console.log('REPLICA:', JSON.stringify({ playing, server, asked: count.asked, parted: count.parted }));
  // The engine plays the page's game, on the server too: there is no other.
  expect(playing).toBe('wasm');
  // On the server: the wire in step with the server's game, which played every intent of the fight.
  expect(server).toBe(ON_SERVER ? 'in' : 'off');
  expect(count.parted, `where the replica parted from the game: ${JSON.stringify(count.first, null, 1)}`).toBe(0);
  expect(count.asked).toBeGreaterThan(100);
});
