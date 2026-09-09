import { test, expect, type Page } from '@playwright/test';

/**
 * What the game *says*, as opposed to what it does.
 *
 * The play pass found a condition written to the log by the id it is keyed by
 * rather than its name, and every unit test in the suite was happy with it -
 * they assert on ids too. This is that class of bug made catchable: play the
 * cards that put words on screen, then check that no content id the engine
 * knows about appears in the text a player reads.
 */

async function vault(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setDiceSpeed(0);
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
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
  });
}

test('nothing a player reads is a content id', async ({ page }) => {
  await vault(page);

  // Play a few of this session's cards - each writes a condition, a zone or a
  // token somewhere visible - and collect the ids the engine ended up holding.
  const ids = await page.evaluate(() => {
    const a = window.__polyheart!;
    const away = (t: number, to: number): number =>
      Math.abs((t % 22) - (to % 22)) + Math.abs(Math.floor(t / 22) - Math.floor(to / 22));
    const close = (): void => {
      const foe = a.adversaries()[0];
      const me = a.selected();
      if (foe === undefined || me === null) return;
      for (let i = 0; i < 12; i++) {
        if (away(a.tileOf(me), a.tileOf(foe)) <= 1) break;
        const tiles = a.reachable();
        if (tiles.length === 0) break;
        const foeTile = a.tileOf(foe);
        const closest = tiles.reduce((x, y) => (away(y, foeTile) < away(x, foeTile) ? y : x));
        if (!a.moveTo(closest)) break;
        while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
        a.endGmTurn();
        while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
        a.select(me);
      }
    };
    const play = (who: string, cards: string[], ability: string): void => {
      a.setCards(who, cards);
      a.select(who);
      close();
      a.useAbility(who, ability);
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
      a.endGmTurn();
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    };
    play('kara', ['hold-the-line'], 'hold-the-line');
    play('mira', ['book-of-korvax'], 'book-of-korvax-magic-circle');
    play('kara', ['signature-move'], 'signature-move');

    const everyone = [...a.party(), ...a.adversaries()];
    return {
      conditions: [...new Set(everyone.flatMap((id) => a.conditionsOf(id)))],
      creatures: everyone,
    };
  });
  console.log('IDS IN PLAY:', JSON.stringify(ids));
  expect(ids.conditions.length, 'the cards actually left something behind').toBeGreaterThan(0);

  // And the third readout: the card a right-click puts up about a creature.
  await page.evaluate(() => {
    const a = window.__polyheart!;
    const foe = a.adversaries()[0];
    if (foe !== undefined) a.inspect(a.tileOf(foe));
  });

  // What a player can actually read.
  const inspect = page.locator('[data-testid="inspect"]');
  const shown = {
    log: (await page.locator('[data-testid="log"]').innerText()) || '',
    hud: (await page.locator('[data-testid="hud"]').innerText()) || '',
    inspect: (await inspect.count()) > 0 ? await inspect.innerText() : '',
  };
  console.log('HUD TEXT:', JSON.stringify(shown.hud));

  await page.screenshot({ path: 'test-results/readout.png' });

  // A condition id is a key, not a word. Neither the log nor the HUD should
  // ever show one; a creature id is the same rule.
  const leaks: string[] = [];
  for (const [where, text] of Object.entries(shown)) {
    for (const id of [...ids.conditions, ...ids.creatures]) {
      if (text.includes(id)) leaks.push(`${where}: ${id}`);
    }
  }
  expect(leaks, 'ids leaking into what a player reads').toEqual([]);
});
