/**
 * The three who were added to play the rules against: what their cards do that nothing else does.
 *
 * Each of the six abilities here is the only one in the demo that reaches for its mechanic -
 * knockback, a magazine of tokens, a reroll of the duality dice, a place kept on the floor, and
 * Shadow handed to the GM by the party's own choice - so this is where those mechanics are held to
 * what they say they do.
 */

import { describe, expect, it } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { useAbility } from './demo-abilities';
import { answerPending, buildDemoScene, type DemoScene } from './demo-scene';
import { startEncounter } from './movement';

const build = (seed = 'party'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

/** A husk stood next to somebody, so a card with a range has something in it. */
function beside(demo: DemoScene, who: string, away = 1): string {
  const me = demo.state.entity(who)!;
  const foe = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
  demo.state.moveEntity(foe.id, demo.grid.indexOf(demo.grid.xOf(me.tile) + away, demo.grid.yOf(me.tile)));
  demo.state.placeEntity(foe.id, demo.grid.xOf(me.tile) + away, demo.grid.yOf(me.tile));
  return foe.id;
}

describe('the party as it stands', () => {
  it('is six, each with the body their sheet names', () => {
    const demo = build();
    expect(demo.party.members()).toEqual(['kara', 'finn', 'mira', 'arty', 'pint', 'ganja']);
    expect([...demo.sheets.values()].map((s) => s.name)).toEqual(['Quim', 'Violet', 'Scarlet', 'Arty', 'Pint', 'Ganja']);
    // The three who were here are named for the models they are drawn with.
    for (const id of ['kara', 'finn', 'mira', 'arty', 'pint', 'ganja']) {
      const sheet = demo.sheets.get(id)!;
      expect(sheet.model).toBe(sheet.name!.toLowerCase());
    }
  });

  it('stands them all on the map, on their own tiles', () => {
    const demo = build();
    const tiles = demo.party.members().map((id) => demo.state.entity(id)!.tile);
    expect(new Set(tiles).size).toBe(6);
    for (const tile of tiles) expect(demo.grid.isPassable(tile)).toBe(true);
  });
});

describe('Arty, who counts his shot', () => {
  it('will not fire an empty gun, loads two, and spends one a shot', () => {
    const demo = build();
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const empty = useAbility(demo, 'arty', 'grapeshot', []);
    expect(empty.status).toBe('refused');
    expect(demo.world.tokensOn('arty', 'grapeshot')).toBe(0);

    expect(useAbility(demo, 'arty', 'powder-and-shot', []).status).toBe('done');
    expect(demo.world.tokensOn('arty', 'grapeshot')).toBe(2);
    expect(demo.state.entity('arty')!.stress.marked).toBe(1);

    beside(demo, 'arty');
    expect(useAbility(demo, 'arty', 'grapeshot', []).status).toBe('done');
    expect(demo.world.tokensOn('arty', 'grapeshot')).toBe(1);
  });

  it('knocks what it hits back out of Very Close', () => {
    const demo = build();
    startEncounter(demo, demo.scene.encounters[0]!.id);
    useAbility(demo, 'arty', 'powder-and-shot', []);
    const foe = beside(demo, 'arty');
    const before = demo.grid.euclideanDistance(demo.state.entity('arty')!.tile, demo.state.entity(foe)!.tile);
    const hurt = demo.state.entity(foe)!.hitPoints.marked;
    useAbility(demo, 'arty', 'grapeshot', []);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    const after = demo.grid.euclideanDistance(demo.state.entity('arty')!.tile, demo.state.entity(foe)!.tile);
    expect(after).toBeGreaterThan(before);
    expect(demo.state.entity(foe)!.hitPoints.marked).toBeGreaterThanOrEqual(hurt);
  });
});

describe('Pint, who keeps the place', () => {
  it('marks the ground, and the second use puts them back on it', () => {
    const demo = build();
    const from = { ...demo.state.entity('pint')!.at };
    expect(useAbility(demo, 'pint', 'mark-the-page', []).status).toBe('done');
    expect(demo.world.marks().length).toBe(1);

    // Walked away, and then back by the card rather than by the feet.
    demo.state.placeEntity('pint', from.x + 6, from.y + 3);
    expect(useAbility(demo, 'pint', 'mark-the-page', []).status).toBe('done');
    const back = demo.state.entity('pint')!.at;
    expect(Math.hypot(back.x - from.x, back.y - from.y)).toBeLessThan(1);
    // And the place is let go, so the next use keeps a new one.
    expect(demo.world.marks().length).toBe(0);
  });

  it('holds Footnote in the vault, because a card that answers every failure stops every roll', () => {
    const demo = build();
    expect(demo.sheets.get('pint')!.domainCards).toContain('footnote');
    expect(demo.sheets.get('pint')!.loadout).not.toContain('footnote');
    expect(demo.world.answersRoll('pint', { total: 8, outcome: 'failureWithBad' })).toBe(false);
  });
});

describe('Ganja, who buys the round', () => {
  it('clears a Stress from everyone close, and hands the GM a Shadow for it', () => {
    const demo = build();
    for (const id of ['ganja', 'kara']) demo.state.entity(id)!.stress.marked = 2;
    demo.state.placeEntity('kara', demo.state.entity('ganja')!.at.x + 1, demo.state.entity('ganja')!.at.y);
    const shadow = demo.state.bad.value;

    expect(useAbility(demo, 'ganja', 'another-round', []).status).toBe('done');
    // One for the card's own cost, one cleared by it: the holder comes out level.
    expect(demo.state.entity('ganja')!.stress.marked).toBe(2);
    expect(demo.state.entity('kara')!.stress.marked).toBe(1);
    expect(demo.state.bad.value).toBe(shadow + 1);
  });

  it('shoves what is in Melee out to Very Close', () => {
    const demo = build();
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const foe = beside(demo, 'ganja');
    const before = demo.grid.euclideanDistance(demo.state.entity('ganja')!.tile, demo.state.entity(foe)!.tile);
    expect(useAbility(demo, 'ganja', 'barrel-through', []).status).toBe('done');
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(demo.grid.euclideanDistance(demo.state.entity('ganja')!.tile, demo.state.entity(foe)!.tile)).toBeGreaterThan(before);
  });
});
