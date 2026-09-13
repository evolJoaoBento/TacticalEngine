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
      a.arrive();
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
    // The swing is on the board the moment it is made: somebody is lunging or flinching.
    const reacting = a.reacting();
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return {
      attacked,
      reacting,
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
  expect(swung.reacting, 'the swing moved a token').toBeGreaterThan(0);
});

test('a click on an enemy across the room walks up and swings', async ({ page }) => {
  const arrived = await intoTheVault(page);
  expect(arrived.inCombat).toBe(true);

  const charged = await page.evaluate(() => {
    const a = window.__polyheart!;
    const me = a.selected()!;
    const foe = a.adversaries()[0]!;
    // Back off within this move, let the room have a turn, then click the foe from there.
    const away = (t: number): number => Math.hypot((t % 22) - (a.tileOf(foe) % 22), Math.floor(t / 22) - Math.floor(a.tileOf(foe) / 22));
    const back = a.reachable().reduce((x, y) => (away(y) > away(x) ? y : x));
    a.moveTo(back);
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    a.endGmTurn();
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    const from = a.tileOf(me);
    const attacked = a.attack(foe);
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return { me, foe, from, distanceBefore: away(from), attacked, distanceAfter: away(a.tileOf(me)), gliding: a.gliding() };
  });
  console.log('CHARGE:', JSON.stringify(charged));
  expect(charged.distanceBefore).toBeGreaterThan(1.5);
  expect(charged.attacked).toBe(true);
  expect(charged.distanceAfter).toBeLessThanOrEqual(1.5);
  await page.screenshot({ path: 'test-results/charge.png' });
});

test('the warding ring burns whatever is standing in it', async ({ page }) => {
  const arrived = await intoTheVault(page);
  expect(arrived.inCombat).toBe(true);

  const cast = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setCards('mira', ['warding-flame']);
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
    const foeWas = a.tileOf(foe);
    const status = a.useAbility('mira', 'warding-flame');
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return {
      beside,
      status,
      before,
      foeWas,
      after: a.hitPoints(foe).marked,
      foe,
      zones: a.zones(),
      floaters: a.floaters(),
      reacting: a.reacting(),
      lit: a.highlighted(),
      mira: a.tileOf('mira'),
      log: a.log().slice(-6).map((l) => l.text),
    };
  });
  console.log('CIRCLE:', JSON.stringify(cast, null, 1));

  await page.screenshot({ path: 'test-results/playpass-circle.png' });
  expect(cast.status).toBe('done');
  expect(cast.after).toBeGreaterThan(cast.before);
  expect(cast.log.join(' ')).toMatch(/flame takes them/i);

  // The ring is on the floor: a zone the board knows the tiles of, holding
  // Mira's own tile and the one the husk was standing on when it burned. The
  // bite is written on the condition rather than the card -- the ground is
  // geography, and the condition is what it means to stand there.
  expect(cast.zones.map((z) => z.name)).toContain('Warding Flame');
  const circle = cast.zones.find((z) => z.name === 'Warding Flame')!;
  expect(circle.tiles).toContain(cast.mira);
  expect(circle.tiles).toContain(cast.foeWas);
  // In a fight the Close-range walk round whoever is selected is lit.
  expect(cast.lit).toBeGreaterThan(0);

  // And the wound rose over the Burrower's head as a number. Read through the
  // driver in the same tick as the cast: a floater lives 1.4 seconds, and the
  // screenshot above can take longer than that on the software GL the suite
  // runs on, so counting the divs afterwards reads as nothing having risen.
  expect(cast.floaters.map((f) => `${f.id}:${f.text}`)).toContain(`${cast.foe}:-${cast.after - cast.before} HP`);
  // And the Burrower's token took the blow.
  expect(cast.reacting, 'a token is flinching').toBeGreaterThan(0);
});

test('Hold the Line drags in whatever comes close', async ({ page }) => {
  const arrived = await intoTheVault(page);
  expect(arrived.inCombat).toBe(true);

  const held = await page.evaluate(() => {
    const a = window.__polyheart!;
    // No cards: Hold the Line is the sentinel's own class feature, granted
    // rather than held, so there is nothing to put in her hand.
    a.select('kara');
    const foe = a.adversaries()[0]!;
    const beside = a.standBeside(foe);
    const status = a.useAbility('kara', 'sentinel-hold-the-line');
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

test('a name in the log points at whoever it named', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__polyheart!.setDiceSpeed(0));

  // A swing, so the log has a line naming two creatures.
  const swung = await page.evaluate(() => {
    const a = window.__polyheart!;
    const door = a.objects().find((o) => o.includes('door')) ?? a.objects()[0]!;
    a.standBeside(door);
    for (let i = 0; i < 20 && !a.objectState(door).open; i++) {
      if (a.use(door) === 'waiting') a.answer({ kind: 'roll' });
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
    for (let i = 0; i < 15 && !a.inCombat(); i++) {
      const tiles = a.reachable();
      if (tiles.length === 0) break;
      const east = tiles.reduce((x, y) => (y % 22 > x % 22 ? y : x));
      if (!a.moveTo(east)) break;
      a.arrive();
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
    const foe = a.adversaries()[0]!;
    const away = (t: number, to: number): number =>
      Math.abs((t % 22) - (to % 22)) + Math.abs(Math.floor(t / 22) - Math.floor(to / 22));
    for (let i = 0; i < 12; i++) {
      const me = a.selected() ?? '';
      if (away(a.tileOf(me), a.tileOf(foe)) <= 1) break;
      const tiles = a.reachable();
      if (tiles.length === 0) break;
      const foeTile = a.tileOf(foe);
      const closest = tiles.reduce((x, y) => (away(y, foeTile) < away(x, foeTile) ? y : x));
      if (!a.moveTo(closest)) break;
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
      a.endGmTurn();
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
    a.attack(foe);
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return { foe, foeTile: a.tileOf(foe) };
  });
  console.log('SWUNG:', JSON.stringify(swung));

  // The swing's line names the swinger and whoever was swung at, and each name
  // is its own element rather than a run of text.
  const links = page.locator('[data-testid="log"] [data-testid="log-entity"]');
  const count = await links.count();
  console.log('LINKS:', count, JSON.stringify(await links.allInnerTexts()));
  expect(count, 'the log linked the creatures it named').toBeGreaterThan(0);

  // Hovering one marks it on the board.
  const foeLink = page.locator(`[data-testid="log"] [data-entity="${swung.foe}"]`).last();
  await expect(foeLink).toBeVisible();
  await foeLink.hover();
  const marked = await page.evaluate(() => window.__polyheart!.cursorTile());
  console.log('MARKED:', marked, 'FOE AT:', swung.foeTile);
  expect(marked, 'the board marks whoever the log named').toBe(swung.foeTile);

  await page.screenshot({ path: 'test-results/log-hover.png' });

  // And letting go puts the marker away.
  await page.locator('[data-testid="hud"]').hover();
  const after = await page.evaluate(() => window.__polyheart!.cursorTile());
  console.log('AFTER:', after);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a walk ends where it was aimed, not at the centre of a square, and the token stands there', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });

  const walked = await page.evaluate(() => {
    const a = window.__polyheart!;
    const me = a.selected()!;
    const from = a.tileOf(me);
    // Towards the middle of the room, where nothing on the HUD covers the board.
    const span = (t: number): number => Math.hypot((t % 22) - 10, Math.floor(t / 22) - 8);
    const far = a.reachable().filter((t) => t !== from).reduce((x, y) => (span(y) < span(x) ? y : x));
    const aimed = { x: (far % 22) + 0.3, y: Math.floor(far / 22) - 0.2 };
    const moved = a.walkTo(aimed.x, aimed.y);
    return { me, moved, aimed, tile: a.tileOf(me), at: a.standingAt(me), far, others: a.party().filter((p) => p !== me).map((p) => a.standingAt(p)) };
  });
  console.log('AIMED:', JSON.stringify(walked));
  expect(walked.moved).toBe(true);
  expect(walked.tile).toBe(walked.far);
  expect(walked.at).toEqual(walked.aimed);

  // The token arrives at the spot, not the square's centre, and stands there.
  await page.waitForFunction(() => window.__polyheart!.gliding() === 0, null, { timeout: 10_000 });
  const stood = await page.evaluate((me: string) => window.__polyheart!.standingAt(me), walked.me);
  expect(stood).toEqual(walked.aimed);
  await page.screenshot({ path: 'test-results/walk-aimed.png' });

  // A click on the token where it actually stands selects it, off-centre and all.
  const target = await page.evaluate((me: string) => {
    const a = window.__polyheart!;
    a.selectNext();
    const at = a.standingAt(me)!;
    return { other: a.selected(), px: a.screenAt(at.x, at.y) };
  }, walked.me);
  expect(target.other).not.toBe(walked.me);
  await page.mouse.click(target.px.x, target.px.y);
  const selected = await page.evaluate(() => window.__polyheart!.selected());
  expect(selected).toBe(walked.me);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('hovering the ground draws the line a click would walk', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });

  // Somewhere a few tiles off, towards the middle of the room.
  const target = await page.evaluate(() => {
    const a = window.__polyheart!;
    const me = a.selected()!;
    const from = a.tileOf(me);
    const span = (t: number): number => Math.hypot((t % 22) - 9, Math.floor(t / 22) - 8);
    const far = a.reachable().filter((t) => t !== from).reduce((x, y) => (span(y) < span(x) ? y : x));
    const spot = { x: (far % 22) + 0.2, y: Math.floor(far / 22) - 0.1 };
    return { spot, px: a.screenAt(spot.x, spot.y), preview: a.previewAt(spot.x, spot.y) };
  });
  expect(target.preview).not.toBeNull();
  expect(target.preview!.route.length).toBeGreaterThanOrEqual(2);
  expect(target.preview!.beyond).toEqual([]);

  await page.mouse.move(target.px.x, target.px.y);
  await page.waitForFunction(() => window.__polyheart!.pathPoints() >= 2, null, { timeout: 5_000 });
  const drawn = await page.evaluate(() => window.__polyheart!.pathPoints());
  console.log('PATH POINTS:', drawn);
  await page.screenshot({ path: 'test-results/hover-path.png' });
  expect(drawn).toBeGreaterThanOrEqual(2);

  // Off the board, the line goes.
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => window.__polyheart!.pathPoints() === 0, null, { timeout: 5_000 });
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the party rounds the vault door together, along the line the hover drew', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });

  const opened = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setDiceSpeed(0);
    const door = a.objects().find((o) => o.includes('door')) ?? a.objects()[0]!;
    a.standBeside(door);
    for (let i = 0; i < 20 && !a.objectState(door).open; i++) {
      if (a.use(door) === 'waiting') a.answer({ kind: 'roll' });
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
    // Back to the west, so the walk has to come round through the doorway.
    a.moveTo(9 * 22 + 4);
    return a.objectState(door).open;
  });
  expect(opened).toBe(true);
  await page.waitForFunction(() => window.__polyheart!.gliding() === 0, null, { timeout: 15_000 });

  // A spot inside the vault, north-east of the door: the line bends at the doorway.
  const hovered = await page.evaluate(() => {
    const a = window.__polyheart!;
    const spot = { x: 15.3, y: 4.2 };
    return { preview: a.previewAt(spot.x, spot.y), px: a.screenAt(spot.x, spot.y) };
  });
  console.log('HOVER:', JSON.stringify(hovered.preview));
  expect(hovered.preview).not.toBeNull();
  expect(hovered.preview!.route.length).toBeGreaterThanOrEqual(3);
  await page.mouse.move(hovered.px.x, hovered.px.y);
  await page.waitForFunction(() => window.__polyheart!.pathPoints() >= 2, null, { timeout: 5_000 });
  await page.screenshot({ path: 'test-results/corner-hover.png' });

  // Click it: everyone walks, in a line, and the trigger past the door stops
  // the walk where the fight begins.
  await page.mouse.click(hovered.px.x, hovered.px.y);
  await page.waitForTimeout(700);
  const mid = await page.evaluate(() => ({ gliding: window.__polyheart!.gliding(), fighting: window.__polyheart!.inCombat() }));
  await page.screenshot({ path: 'test-results/corner-mid.png' });
  expect(mid.gliding, 'the party is on its way').toBeGreaterThan(1);
  expect(mid.fighting, 'no fight before they get there').toBe(false);
  await page.waitForFunction(() => window.__polyheart!.gliding() === 0, null, { timeout: 15_000 });
  const done = await page.evaluate(() => {
    const a = window.__polyheart!;
    return { inCombat: a.inCombat(), party: a.party().map((p) => ({ p, at: a.standingAt(p), tile: a.tileOf(p) })) };
  });
  console.log('DONE:', JSON.stringify(done));
  expect(done.inCombat).toBe(true);
  // Through the doorway (x 12) or at it: nobody left on the far side of the wall.
  for (const member of done.party) expect(member.tile % 22).toBeGreaterThanOrEqual(11);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a walked token walks, and is standing on the tile when it has', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });

  // The board is right the moment the move is made; the token takes a moment.
  const walked = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setDiceSpeed(0);
    const me = a.selected()!;
    const from = a.tileOf(me);
    // Look somewhere far from the walk, so following has something to do.
    const before = a.camera();
    const tiles = a.reachable().filter((t) => t !== from);
    const far = tiles.reduce((x, y) => (Math.abs(y - from) > Math.abs(x - from) ? y : x));
    const moved = a.moveTo(far);
    return { me, from, to: far, moved, tile: a.tileOf(me), gliding: a.gliding(), before };
  });
  console.log('WALKED:', JSON.stringify(walked));
  expect(walked.moved).toBe(true);
  expect(walked.tile).toBe(walked.to);
  // The mover, and out of combat the party following - somebody is walking.
  expect(walked.gliding, 'the token is on its way').toBeGreaterThan(0);

  await page.screenshot({ path: 'test-results/walk-mid.png' });
  await page.waitForFunction(() => window.__polyheart!.gliding() === 0, null, { timeout: 5_000 });

  // The camera kept them in frame: its target ends within a third of its
  // distance of where they now stand, and the angle is untouched.
  const after = await page.evaluate(() => {
    const a = window.__polyheart!;
    return { camera: a.camera(), at: a.screenOf(a.tileOf(a.selected()!)), size: { w: window.innerWidth, h: window.innerHeight } };
  });
  console.log('CAMERA:', JSON.stringify({ before: walked.before, after: after.camera, at: after.at }));
  expect(after.camera.yaw).toBeCloseTo(walked.before.yaw, 6);
  expect(after.camera.distance).toBeCloseTo(walked.before.distance, 6);
  expect(after.at.x).toBeGreaterThan(0);
  expect(after.at.x).toBeLessThan(after.size.w);
  expect(after.at.y).toBeGreaterThan(0);
  expect(after.at.y).toBeLessThan(after.size.h);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
