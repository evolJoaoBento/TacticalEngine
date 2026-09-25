import { test, expect, type Page } from '@playwright/test';
import { closeLoadout } from './pack';

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
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const a = window.__engine!;
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
      // The vault's own rows: the woods run further east than the vault does.
      const inside = tiles.filter((t) => Math.floor(t / 44) < 16);
      const east = (inside.length > 0 ? inside : tiles).reduce((x, y) => (y % 44 > x % 44 ? y : x));
      if (!a.moveTo(east)) break;
      a.arrive();
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
  });
}

/**
 * Every panel that puts engine strings in front of a player. A panel that is
 * not on screen reads as nothing, which is what an absent locator should be.
 */
const PANELS = [
  'log',
  'hud',
  'inspect',
  'action-bar',
  'dice-tray',
  'check-prompt',
  'roll-result',
  'choice-prompt',
  'dialogue',
  'journal',
  'pack',
  'gear',
  'gm',
] as const;

async function readAll(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const panel of PANELS) {
    const at = page.locator(`[data-testid="${panel}"]`);
    out[panel] = (await at.count()) > 0 ? await at.first().innerText() : '';
  }
  return out;
}

/** Which ids are showing where, as `panel: id`. */
function leaksIn(shown: Record<string, string>, ids: readonly string[]): string[] {
  const found: string[] = [];
  for (const [where, text] of Object.entries(shown)) {
    for (const id of ids) {
      if (id !== '' && text.includes(id)) found.push(`${where}: ${id}`);
    }
  }
  return found;
}

test('nothing a player reads is a content id', async ({ page }) => {
  await vault(page);

  // Play a few of this session's cards - each writes a condition, a zone or a
  // token somewhere visible - and collect the ids the engine ended up holding.
  const ids = await page.evaluate(() => {
    const a = window.__engine!;
    const away = (t: number, to: number): number =>
      Math.abs((t % 44) - (to % 44)) + Math.abs(Math.floor(t / 44) - Math.floor(to / 44));
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
    // Both of these are aimed at the caster and leave a condition behind, which
    // is what this test needs: `play` passes no targets, and `useAbility` picks
    // for the caller only when exactly one target is valid, so a card that wants
    // an ally would be refused here with the party standing together.
    play('kara', [], 'sentinel-hold-the-line');
    play('mira', ['warding-flame'], 'warding-flame');

    const everyone = [...a.party(), ...a.adversaries()];
    return {
      conditions: [...new Set(everyone.flatMap((id) => a.conditionsOf(id)))],
      creatures: everyone,
    };
  });
  console.log('IDS IN PLAY:', JSON.stringify(ids));
  expect(ids.conditions.length, 'the cards actually left something behind').toBeGreaterThan(0);

  // The card a right-click puts up about a creature.
  await page.evaluate(() => {
    const a = window.__engine!;
    const foe = a.adversaries()[0];
    if (foe !== undefined) a.inspect(a.tileOf(foe));
  });

  const shown = await readAll(page);
  console.log('READ:', JSON.stringify(shown, null, 1));

  await page.screenshot({ path: 'test-results/readout.png' });

  expect(leaksIn(shown, [...ids.conditions, ...ids.creatures]), 'ids leaking into what a player reads').toEqual([]);
});

test('the loadout, the journal and a rest read as English too', async ({ page }) => {
  await vault(page);

  // Cards in hand and a quest running, then the panels that show them.
  const ids = await page.evaluate(() => {
    const a = window.__engine!;
    a.setCards('kara', ['power-slash', 'shield-wall', 'iron-stance']);
    a.select('kara');
    // Something in the pack, so the panel has a row to render rather than the
    // assertion passing on an empty list.
    a.giveItem('healing-draught', 2);
    a.giveItem('husk-carapace');
    const held = a.loadout('kara');
    return {
      cards: [...held.loadout, ...held.vault],
      quests: a.journal().map((q) => q.id),
      items: a.carried().map((i) => i.id),
      creatures: [...a.party(), ...a.adversaries()],
      conditions: [] as string[],
    };
  });
  console.log('IDS:', JSON.stringify(ids));

  // The pack is in the loadout now, as cards on its gear pages: open them, so what the pack says is
  // read with the rest of the binder.
  await page.locator('[data-testid="open-loadout"]').click();
  await page.locator('[data-testid="open-gear"]').click();
  await expect(page.locator('[data-testid="pack"] [data-item]').first()).toBeVisible();
  const loadout = await page.locator('[data-testid="loadout"]').innerText();
  console.log('LOADOUT:', JSON.stringify(loadout));
  await closeLoadout(page);

  const shown = { ...(await readAll(page)), loadout };
  await page.screenshot({ path: 'test-results/readout-panels.png' });

  expect(ids.cards.length, 'cards are in hand to be listed').toBeGreaterThan(0);
  expect(
    leaksIn(shown, [...ids.cards, ...ids.quests, ...ids.items, ...ids.creatures]),
    'ids leaking into what a player reads',
  ).toEqual([]);
});
