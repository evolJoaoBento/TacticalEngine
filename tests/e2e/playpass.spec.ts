import { test, expect, type Page } from '@playwright/test';

/**
 * A play pass over the slices this session added, in a real browser.
 *
 * Nine slices of rules landed without anybody watching the game run. This
 * drives the demo the way a player would - pick the vault door, walk into the
 * fight, cast the thing - and screenshots what is on screen, because a test
 * that only reads engine state cannot tell you the HUD went blank.
 */

/**
 * The route the demo actually has: the vault is behind a locked door, and the
 * fight starts when somebody crosses the trigger past it. The same way in that
 * `demo.spec.ts` walks, because `startFight` on its own leaves the party
 * standing across the room from everything it is fighting.
 */
async function intoTheVault(page: Page): Promise<{ inCombat: boolean; foe: string | null }> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });

  const got = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setDiceSpeed(0);
    const door = a.objects().find((o) => o.includes('door')) ?? a.objects()[0]!;
    a.standBeside(door);
    for (let i = 0; i < 20 && !a.objectState(door).open; i++) {
      if (a.use(door) === 'waiting') a.answer({ kind: 'roll' });
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
    // East until the trigger wakes what is in there.
    for (let i = 0; i < 15 && !a.inCombat(); i++) {
      const tiles = a.reachable();
      if (tiles.length === 0) break;
      const east = tiles.reduce((x, y) => (y % 22 > x % 22 ? y : x));
      if (!a.moveTo(east)) break;
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
    return { inCombat: a.inCombat(), foe: a.adversaries()[0] ?? null };
  });

  // Close on the nearest adversary over as many turns as it takes. One move a
  // turn is what a character gets, and the vault is bigger than one move.
  await page.evaluate(() => {
    const a = window.__polyheart!;
    const foe = a.adversaries()[0];
    if (foe === undefined) return;
    const away = (t: number, to: number): number =>
      Math.abs((t % 22) - (to % 22)) + Math.abs(Math.floor(t / 22) - Math.floor(to / 22));
    for (let i = 0; i < 12; i++) {
      const here = a.tileOf(a.selected() ?? '');
      if (away(here, a.tileOf(foe)) <= 1) break;
      const tiles = a.reachable();
      if (tiles.length === 0) break;
      const foeTile = a.tileOf(foe);
      const closest = tiles.reduce((x, y) => (away(y, foeTile) < away(x, foeTile) ? y : x));
      if (!a.moveTo(closest)) break;
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
      // Their turn is spent; let the room have one so the party gets another.
      a.endGmTurn();
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
  });

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  return got;
}

test('the vault fight runs, and a swing reads out on screen', async ({ page }) => {
  const arrived = await intoTheVault(page);
  console.log('ARRIVED:', JSON.stringify(arrived));
  expect(arrived.inCombat).toBe(true);

  const swung = await page.evaluate(() => {
    const a = window.__polyheart!;
    const foe = a.adversaries()[0]!;
    const before = a.hitPoints(foe).marked;
    a.standBeside(foe);
    const attacked = a.attack(foe);
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return {
      attacked,
      before,
      after: a.hitPoints(foe).marked,
      dice: a.dice(),
      log: a.log().slice(-4).map((l) => l.text),
    };
  });
  console.log('SWING:', JSON.stringify(swung, null, 1));

  await page.screenshot({ path: 'test-results/playpass-swing.png' });
  expect(swung.attacked).toBe(true);
  expect(swung.dice.length).toBeGreaterThan(0);
});

test("Korvax's circle burns whatever is standing in it", async ({ page }) => {
  const arrived = await intoTheVault(page);
  expect(arrived.inCombat).toBe(true);

  const cast = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setCards('mira', ['book-of-korvax']);
    a.select('mira');
    const foe = a.adversaries()[0]!;
    // The closing loop walked whoever was selected then; the caster is Mira,
    // and a circle at her feet only catches what is standing by her feet.
    const away = (x: number, to: number): number =>
      Math.abs((x % 22) - (to % 22)) + Math.abs(Math.floor(x / 22) - Math.floor(to / 22));
    let beside = a.standBeside(foe);
    for (let i = 0; i < 12 && !beside; i++) {
      const tiles = a.reachable();
      if (tiles.length === 0) break;
      const foeTile = a.tileOf(foe);
      const closest = tiles.reduce((x, y) => (away(y, foeTile) < away(x, foeTile) ? y : x));
      if (!a.moveTo(closest)) break;
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
      a.endGmTurn();
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
      a.select('mira');
      beside = away(a.tileOf('mira'), a.tileOf(foe)) <= 1;
    }
    const before = a.hitPoints(foe).marked;
    const status = a.useAbility('mira', 'book-of-korvax-magic-circle');
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return {
      beside,
      status,
      before,
      after: a.hitPoints(foe).marked,
      log: a.log().slice(-6).map((l) => l.text),
    };
  });
  console.log('CIRCLE:', JSON.stringify(cast, null, 1));

  await page.screenshot({ path: 'test-results/playpass-circle.png' });
  expect(cast.status).toBe('done');
  expect(cast.after).toBeGreaterThan(cast.before);
  expect(cast.log.join(' ')).toMatch(/circle takes them/i);
});

test('Hold the Line drags in whatever comes close', async ({ page }) => {
  const arrived = await intoTheVault(page);
  expect(arrived.inCombat).toBe(true);

  const held = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setCards('kara', ['hold-the-line']);
    a.select('kara');
    const foe = a.adversaries()[0]!;
    const beside = a.standBeside(foe);
    const status = a.useAbility('kara', 'hold-the-line');
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return {
      beside,
      status,
      kara: a.conditionsOf('kara'),
      foe: a.conditionsOf(foe),
      log: a.log().slice(-6).map((l) => l.text),
    };
  });
  console.log('LINE:', JSON.stringify(held, null, 1));

  await page.screenshot({ path: 'test-results/playpass-line.png' });
  expect(held.kara).toContain('holding-the-line');
  expect(held.foe).toContain('caught-in-the-line');
});
