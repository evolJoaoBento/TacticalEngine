import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { abilitySchema } from '../engine/content/abilities';
import { conditionDefSchema } from '../engine/content/conditions';
import { cardDefSchema } from '../engine/content/pack/schema';
import { codeSchema } from '../engine/scene/schema';
import {
  FIXTURE_AREA_CARD,
  FIXTURE_AURA_CARD,
  FIXTURE_BARRAGE_CARD,
  FIXTURE_CARDS,
  FIXTURE_GRIMOIRE,
  FIXTURE_HAND,
} from '../../tests/fixtures/adversaries';
import {
  AN_AURA_OF_LAYERS,
  A_BARRAGE_HOOK,
  A_BARRAGE_THAT_ASKS,
  A_BOOK_OF_TWO_SPELLS,
  A_SPELL_FOR_A_WHOLE_BAND,
  A_SPEND_OF_WHATEVER_IS_ON_THE_CARD,
  CHAOS_ABILITY,
  CHAOS_CARD,
} from '../../tests/fixtures/cards';
import { useKey } from '../engine/script/world';
import { NO_TILE } from '../engine/grid/grid';
import { handedTo } from '../../tests/fixtures/cards';
import {
  abilityList,
  abilityTargets,
  abilityText,
  abilitiesOf,
  loadoutView,
  rest,
  statBlockCards,
  swapCard,
  useAbility,
} from './demo-abilities';
import {
  adversaryDefOf,
  characterContentFor,
  answerPending,
  attackWithSelected,
  buildDemoScene,
  endTurn,
  refreshWorld,
  startEncounter,
  type DemoScene,
} from './demo-scene';

/**
 * Playing cards. The engine's half — one roll, many targets, damage through
 * thresholds — is `abilities.test.ts`; this is the game's: who has what, what
 * it costs, who it can be aimed at, what a turn it spends, and how a rest and
 * the vault change all of that.
 */

const scene = (seed = 'cards'): DemoScene => buildDemoScene(demoMap(), seed);

/**
 * Every card these tests play, and the project code one of them runs.
 *
 * Guarded, because a test can give two characters different hands: pushing the pool
 * twice would leave duplicate ability ids in the project, and a card offered twice
 * fires twice.
 */
function carry(demo: DemoScene): void {
  if (demo.project.cards.some((c) => c.id === FIXTURE_AREA_CARD)) return;
  demo.project.cards.push(...FIXTURE_CARDS);
  for (const ability of [
    ...A_SPELL_FOR_A_WHOLE_BAND,
    ...A_BARRAGE_THAT_ASKS,
    ...AN_AURA_OF_LAYERS,
    ...A_BOOK_OF_TWO_SPELLS,
    ...A_SPEND_OF_WHATEVER_IS_ON_THE_CARD,
  ]) {
    demo.project.abilities.push(abilitySchema.parse(ability));
  }
  demo.project.code.push(codeSchema.parse(A_BARRAGE_HOOK));
}

/** A character holding exactly these cards, with the project carrying them. */
function holds(demo: DemoScene, who: string, cards: readonly string[]): void {
  carry(demo);
  const sheet = { ...demo.sheets.get(who)!, domainCards: [...cards], loadout: [...cards] };
  demo.sheets.set(who, sheet);
  demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
  refreshWorld(demo);
}

/** The living adversary nearest a character, and its tile. */
/** What the demo places, by name: the log lines are built from the block's own. */
function foeName(demo: DemoScene, id: string): string {
  return adversaryDefOf(demo, id)!.name;
}

function nearestFoe(demo: DemoScene, characterId: string): { id: string; tile: number } {
  const from = demo.state.entity(characterId)!.tile;
  const foe = demo.state
    .entitiesOf('adversary')
    .filter((e) => e.alive)
    .sort((a, b) => demo.grid.manhattanDistance(from, a.tile) - demo.grid.manhattanDistance(from, b.tile))[0]!;
  return { id: foe.id, tile: foe.tile };
}

/** Put a character on a free tile next to a foe, and start the fight. */
function closeIn(demo: DemoScene, characterId: string, foeId: string): void {
  const foe = demo.state.entity(foeId)!;
  const blocked = demo.state.blockedFor(characterId);
  let stand = NO_TILE;
  demo.grid.forEachNeighbor(foe.tile, false, (tile) => {
    if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
  });
  expect(stand).not.toBe(NO_TILE);
  demo.state.moveEntity(characterId, stand);
  demo.party.select(characterId);
}

const names = (demo: DemoScene, id: string): string[] => abilitiesOf(demo, id).map((a) => a.id);

describe('who has what', () => {
  it('lists class, Light, subclass and loadout abilities per character', () => {
    const demo = scene();
    // The class's, then the subclass's, then the cards in loadout order, which
    // is the order a sheet lists them. The sentinel has two class features: the
    // passive it is drilled in, and the signature stance the class prints.
    expect(names(demo, 'kara')).toEqual([
      'sentinel-drilled',
      'sentinel-hold-the-line',
      'sentinel-hold-fast',
      'shieldbearer-set-feet',
      'power-slash',
      'iron-stance',
      'rally-the-line',
    ]);
    expect(names(demo, 'finn')).toEqual(['lampsnuffer-softstep', 'quick-hands', 'backstab']);
    expect(names(demo, 'mira')).toEqual(['flamecaller-emberflow', 'arcane-ward', 'healing-word']);
  });

  it('shows the card\'s words and says why it is greyed out', () => {
    const demo = scene();
    const list = abilityList(demo, 'kara');
    const good = list.find((v) => v.ability.id === 'sentinel-hold-fast')!;
    expect(good.text).toContain('Spend 3 Light to clear 2 Armor Slots');
    expect(good.usable).toBe(false);
    expect(good.reason).toBe('needs 3 Light');
    // And a passive, which is never usable for a different reason.
    const passive = list.find((v) => v.ability.id === 'sentinel-drilled')!;
    expect(passive.reason).toBe('always on');
    expect(passive.text).toContain('Armor Score');
  });

  it("draws every card's art on the action bar, a granted one's in the granted colour", () => {
    const demo = scene();
    const list = abilityList(demo, 'kara');
    const on = (id: string) => list.find((v) => v.ability.id === id)!;
    // Chosen: its domain's colour, as it always was.
    expect(on('power-slash').card).toEqual({ id: 'power-slash', domain: 'bulwark' });
    // Granted by the class, and handed to her by the project: the colour a card nobody chose wears.
    for (const id of ['sentinel-drilled', 'rally-the-line']) {
      expect(on(id).card).toEqual({ id: on(id).ability.source.card, domain: 'granted' });
    }
    expect(list.every((v) => v.card !== null)).toBe(true);
  });
});

describe('a Light feature', () => {
  it('costs three Light, wants something to fix, and is not the turn', () => {
    const demo = scene();
    const kara = demo.state.entity('kara')!;
    kara.good = { max: 6, value: 3 };
    // Nothing marked: the feature has nothing to clear.
    expect(useAbility(demo, 'kara', 'sentinel-hold-fast').status).toBe('refused');
    expect(demo.log.at(-1)!.text).toContain('not now');
    expect(kara.good.value).toBe(3);

    kara.armorSlots = { max: kara.armorSlots.max, marked: 3 };
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const result = useAbility(demo, 'kara', 'sentinel-hold-fast');
    expect(result.status).toBe('done');
    expect(kara.good.value).toBe(0);
    expect(kara.armorSlots.marked).toBe(1);
    expect(demo.log.map((l) => l.text)).toContain('Kara clears 2 Armor Slots.');
    // Not an action: no `acted` event for Kara.
    expect(demo.encounter!.log.some((e) => e.kind === 'acted' && e.id === 'kara')).toBe(false);
  });
});

describe('a spell in a fight', () => {
  it('pays its Light, rolls against everyone Very Close, and spends the turn', () => {
    const demo = scene();
    holds(demo, 'finn', [FIXTURE_AREA_CARD]);
    const foe = nearestFoe(demo, 'finn');
    closeIn(demo, 'finn', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const finn = demo.state.entity('finn')!;
    finn.good = { max: 6, value: 2 };
    const badBefore = demo.state.bad.value;

    const result = useAbility(demo, 'finn', 'fixture-bladefall');
    expect(result.status).toBe('waiting');
    expect(demo.pending?.prompt.kind).toBe('check');
    if (demo.pending?.prompt.kind !== 'check') throw new Error('expected a check');
    // Finn's Spellcast trait is Finesse +2, and the targets are the adversaries in reach.
    expect(demo.pending.prompt.modifier).toBe(2);
    expect(demo.pending.prompt.trait).toBe('spellcast');
    expect(demo.pending.prompt.targets).toContain(foe.id);
    expect(demo.pending.prompt.experiences.length).toBeGreaterThan(0);
    // The Light is spent before the roll.
    expect(finn.good.value).toBe(1);
    // The turn is not spent until the roll is made.
    expect(demo.encounter!.log.some((e) => e.kind === 'acted' && e.id === 'finn')).toBe(false);

    const answered = answerPending(demo, { kind: 'roll' });
    expect(answered.status).toBe('done');
    expect(demo.pending).toBeNull();
    const checkLine = demo.log.find((l) => l.text.startsWith('Light '))!;
    expect(checkLine).toBeDefined();
    // The dice decide the rest, but the bookkeeping is the same either way.
    const withGood = /with Light|Critical/.test(checkLine.text);
    expect(finn.good.value).toBe(withGood ? 2 : 1);
    expect(demo.state.bad.value).toBe(withGood ? badBefore : badBefore + 1);
    expect(demo.encounter!.log.some((e) => e.kind === 'acted' && e.id === 'finn')).toBe(true);
    if (demo.encounter!.outcome === 'ongoing') {
      expect(demo.encounter!.view().side).toBe(withGood && /succeeds|Critical/.test(checkLine.text) ? 'party' : 'gm');
    }
  });

  it('knocks a husk back on a Power Push', () => {
    // Try seeds until the roll lands: the point is what a hit does, not the dice.
    for (let seed = 1; seed < 40; seed++) {
      const demo = scene(`push-${seed}`);
      holds(demo, 'mira', [FIXTURE_GRIMOIRE]);
      const foe = nearestFoe(demo, 'mira');
      closeIn(demo, 'mira', foe.id);
      startEncounter(demo, demo.scene.encounters[0]!.id);
      const before = demo.grid.euclideanDistance(demo.state.entity('mira')!.tile, demo.state.entity(foe.id)!.tile);
      expect(useAbility(demo, 'mira', 'fixture-grimoire-shove', [foe.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      const log = demo.log.map((l) => l.text);
      if (!log.some((t) => t.includes('is thrown back'))) continue;
      const after = demo.grid.euclideanDistance(demo.state.entity('mira')!.tile, demo.state.entity(foe.id)!.tile);
      expect(after).toBeGreaterThan(before);
      expect(log.some((t) => new RegExp(`d10\\+2 → \\d+ damage to ${foeName(demo, foe.id)}`).test(t))).toBe(true);
      return;
    }
    throw new Error('no seed landed a Power Push in forty tries');
  });

  it('refuses a target out of range, and a spell with none, drawing nothing', () => {
    const demo = scene();
    // Two hands, and `carry` is guarded so the pool is not pushed twice.
    holds(demo, 'mira', [FIXTURE_GRIMOIRE]);
    holds(demo, 'finn', [FIXTURE_AREA_CARD]);
    // Mira starts far from every husk: the splinter reaches Far, and the room is wider.
    const before = demo.rng.save();
    expect(abilityTargets(demo, 'mira', abilitiesOf(demo, 'mira').find((a) => a.id === 'fixture-grimoire-splinter')!)).toEqual([]);
    expect(useAbility(demo, 'mira', 'fixture-grimoire-splinter').status).toBe('refused');
    expect(demo.log.at(-1)!.text).toContain('nothing in range');
    expect(demo.rng.save()).toBe(before);
    // Bladefall wants nobody picked, but wants somebody to hit.
    expect(useAbility(demo, 'finn', 'fixture-bladefall').status).toBe('refused');
  });

  it("is refused on the GM's turn, and after acting only when the spotlight rules say", () => {
    const demo = scene();
    holds(demo, 'mira', [FIXTURE_GRIMOIRE]);
    const foe = nearestFoe(demo, 'mira');
    closeIn(demo, 'mira', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    demo.encounter!.passToGm();
    expect(useAbility(demo, 'mira', 'fixture-grimoire-shove', [foe.id]).status).toBe('refused');
    expect(demo.log.at(-1)!.text).toContain("the GM's turn");
  });
});

describe('the loadout and the vault', () => {
  const grow = (demo: DemoScene): void => {
    demo.project.cards.push(...FIXTURE_CARDS);
    const sheet = demo.sheets.get('kara')!;
    const cards = [...FIXTURE_HAND];
    const grown = { ...sheet, domainCards: cards };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('holds five, vaults the rest, and only active cards are abilities', () => {
    const demo = scene();
    grow(demo);
    const view = loadoutView(demo, 'kara');
    expect(view.loadout.map((c) => c.id)).toEqual(FIXTURE_HAND.slice(0, 5));
    expect(view.vault.map((c) => c.id)).toEqual([FIXTURE_HAND[5]]);
    expect(names(demo, 'kara')).not.toContain(FIXTURE_HAND[5]);
  });

  it('lays out what she has without choosing it: face up, in sheet order, read as the cards stand', () => {
    const demo = scene();
    const view = loadoutView(demo, 'kara');
    // Her class's four (the pack's three and the demo's own), her subclass's foundation, her
    // ancestry's, her community's, and the one the demo hands her.
    expect(view.granted.map((c) => c.id)).toEqual([
      'sentinel-shield-trained',
      'sentinel-drilled',
      'sentinel-hold-the-line',
      'sentinel-hold-fast',
      'shieldbearer-bulwark-stance',
      'shieldbearer-set-feet',
      'stoneborn-deep-footing',
      'wayfarer-road-sense',
      'rally-the-line',
    ]);
    // Said the way the table says it, never by id.
    expect([...new Set(view.granted.map((c) => c.from))]).toEqual([
      'Sentinel',
      'Shieldbearer · foundation',
      'Stoneborn',
      'Wayfarer',
      'Given',
    ]);
    // None of it is in the hand the loadout limit counts.
    expect(view.loadout.map((c) => c.id)).toEqual(['power-slash', 'iron-stance']);
    // A card handed over now is in play now.
    demo.project.cards.push(handedTo({ id: 'lantern-oath', name: 'Lantern Oath' }, 'kara'));
    expect(loadoutView(demo, 'kara').granted.at(-1)?.id).toBe('lantern-oath');
  });

  it('recalls a card for Stress equal to its Recall Cost, and free at a rest', () => {
    const demo = scene();
    grow(demo);
    const kara = demo.state.entity('kara')!;
    // The card recalled and the one vaulted both cost 1 to recall, which is what
    // makes the refusal at full Stress further down mean anything.
    const content = characterContentFor(demo.project);
    expect(content.cards.get(FIXTURE_HAND[5]!)!.recallCost).toBe(1);
    expect(content.cards.get(FIXTURE_HAND[4]!)!.recallCost).toBe(1);
    expect(swapCard(demo, 'kara', FIXTURE_HAND[5]!)).toEqual({ ok: false, reason: expect.stringContaining('holds 5') });
    const swapped = swapCard(demo, 'kara', FIXTURE_HAND[5]!, FIXTURE_HAND[4]!);
    expect(swapped).toEqual({ ok: true, stress: 1 });
    expect(kara.stress.marked).toBe(1);
    expect(loadoutView(demo, 'kara').vault.map((c) => c.id)).toEqual([FIXTURE_HAND[4]]);
    expect(demo.log.at(-1)!.text).toBe('Kara recalls Hand VI and vaults Hand V, marking 1 Stress.');

    // Full Stress: no room to mark the cost.
    kara.stress = { max: kara.stress.max, marked: kara.stress.max };
    expect(swapCard(demo, 'kara', FIXTURE_HAND[4]!, FIXTURE_HAND[5]!).ok).toBe(false);
    // At a rest the swap is free.
    expect(swapCard(demo, 'kara', FIXTURE_HAND[4]!, FIXTURE_HAND[5]!, { resting: true })).toEqual({ ok: true, stress: 0 });
    // The loadout rides on the sheet, so a save carries it.
    expect(demo.sheets.get('kara')!.loadout).toEqual(FIXTURE_HAND.slice(0, 5));
  });
});

describe('a rest', () => {
  it('clears 1d4 + tier on a short rest, everything on a long one, and hands the GM Shadow', () => {
    const demo = scene();
    // The use key below has to name an ability the project knows: `rest` looks it up
    // to read how often it refreshes, and an id it cannot find is never cleared.
    carry(demo);
    const kara = demo.state.entity('kara')!;
    const mira = demo.state.entity('mira')!;
    kara.hitPoints = { ...kara.hitPoints, marked: 6 };
    kara.stress = { ...kara.stress, marked: 5 };
    kara.armorSlots = { ...kara.armorSlots, marked: 3 };
    mira.hitPoints = { ...mira.hitPoints, marked: 4 };
    mira.good = { max: 6, value: 0 };
    demo.scenario.abilityUses.set(useKey('mira', 'fixture-aura'), 1);
    demo.scenario.abilityUses.set(useKey('kara', 'some-scene-thing'), 1);

    const short = rest(demo, 'short', {
      moves: {
        kara: [{ kind: 'tendWounds' }, { kind: 'repairArmor' }],
        mira: [{ kind: 'tendWounds', target: 'kara' }, { kind: 'prepare' }],
        finn: [{ kind: 'prepare' }, { kind: 'clearStress' }],
      },
    });
    expect(short).toEqual({ ok: true, badGained: expect.any(Number) });
    if (!short.ok) return;
    expect(short.badGained).toBeGreaterThanOrEqual(1);
    expect(short.badGained).toBeLessThanOrEqual(4);
    // Two tendings of 2–5 each on 6 marked: between 0 and 2 left.
    expect(kara.hitPoints.marked).toBeLessThanOrEqual(2);
    expect(kara.armorSlots.marked).toBeLessThanOrEqual(1);
    // Two characters prepared together: 2 Light each.
    expect(mira.good!.value).toBe(2);
    // A once-per-long-rest card is still used; a per-rest one would refresh.
    expect(demo.scenario.abilityUses.get(useKey('mira', 'fixture-aura'))).toBe(1);

    kara.hitPoints = { ...kara.hitPoints, marked: 5 };
    const badBefore = demo.state.bad.value;
    const long = rest(demo, 'long', { moves: { kara: [{ kind: 'tendWounds' }, { kind: 'clearStress' }] } });
    expect(long.ok).toBe(true);
    expect(kara.hitPoints.marked).toBe(0);
    expect(kara.stress.marked).toBe(0);
    expect(demo.scenario.abilityUses.has(useKey('mira', 'fixture-aura'))).toBe(false);
    // 1d4 + three party members, capped by the pool.
    expect(demo.state.bad.value - badBefore).toBeGreaterThanOrEqual(Math.min(4, demo.state.bad.max - badBefore));
  });

  it('is refused mid-fight', () => {
    const demo = scene();
    startEncounter(demo, demo.scene.encounters[0]!.id);
    expect(rest(demo, 'short', { moves: {} })).toEqual({ ok: false, reason: 'not in the middle of a fight' });
  });
});

describe("the GM's turn", () => {
  it('closes the distance before attacking, and passes the spotlight back', () => {
    const demo = scene();
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const foe = nearestFoe(demo, 'kara');
    const before = demo.grid.manhattanDistance(demo.state.entity('kara')!.tile, foe.tile);
    expect(before).toBeGreaterThan(1);
    const acted = endTurn(demo);
    expect(acted).toBeGreaterThan(0);
    const after = demo.grid.manhattanDistance(demo.state.entity('kara')!.tile, demo.state.entity(foe.id)!.tile);
    expect(after).toBeLessThan(before);
    expect(demo.encounter!.view().side).toBe('party');
  });

  it('spends a Restrained adversary\'s spotlight tearing free', () => {
    const demo = scene();
    const foe = nearestFoe(demo, 'kara');
    closeIn(demo, 'kara', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const husk = demo.state.entity(foe.id)!;
    husk.conditions.add('restrained');
    husk.conditionDurations.set('restrained', 'temporary');
    const hpBefore = demo.state.entity('kara')!.hitPoints.marked;
    endTurn(demo);
    expect(husk.conditions.has('restrained')).toBe(false);
    expect(demo.log.map((l) => l.text)).toContain(`The ${foeName(demo, foe.id)} shakes off restrained.`);
    // It did not also attack.
    expect(demo.log.some((l) => l.text.includes(`${foeName(demo, foe.id)}'s`) && l.text.includes('Kara'))).toBe(false);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBe(hpBefore);
  });

  it('ends the scene\'s conditions and says so when the last one falls', () => {
    const demo = scene();
    const foe = nearestFoe(demo, 'kara');
    closeIn(demo, 'kara', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const kara = demo.state.entity('kara')!;
    kara.conditions.add('dodging');
    kara.conditionDurations.set('dodging', 'scene');
    // Every husk but the nearest is already down; that one has one Hit Point left.
    for (const e of demo.state.entitiesOf('adversary')) {
      if (e.id !== foe.id) {
        e.hitPoints = { ...e.hitPoints, marked: e.hitPoints.max };
        e.alive = false;
      }
    }
    const husk = demo.state.entity(foe.id)!;
    husk.hitPoints = { ...husk.hitPoints, marked: husk.hitPoints.max - 1 };
    kara.good = { max: 6, value: 6 };
    for (let i = 0; i < 40 && demo.encounter!.outcome === 'ongoing'; i++) {
      if (demo.pending !== null) answerPending(demo, demo.pending.prompt.kind === 'choice' ? { kind: 'choose', index: 1 } : { kind: 'roll' });
      else if (demo.encounter!.view().side === 'gm') endTurn(demo);
      else expect(attackWithSelected(demo, foe.id)).not.toBeNull();
    }
    expect(demo.encounter!.outcome).toBe('victory');
    expect(demo.log.map((l) => l.text)).toContain('The last of them falls. The fight is over.');
    expect(kara.conditions.has('dodging')).toBe(false);
  });
});

describe('what holds an adversary', () => {
  it('an Asleep husk loses its spotlight, and the GM spends a Shadow to wake it when there is one', () => {
    const demo = scene();
    const foe = nearestFoe(demo, 'kara');
    closeIn(demo, 'kara', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const husk = demo.state.entity(foe.id)!;
    husk.conditions.add('asleep');
    husk.conditionDurations.set('asleep', 'scene');
    demo.state.bad = { ...demo.state.bad, value: 0 };
    const hpBefore = demo.state.entity('kara')!.hitPoints.marked;
    endTurn(demo);
    // Still asleep, and it did not attack.
    expect(husk.conditions.has('asleep')).toBe(true);
    expect(demo.log.some((l) => l.text.includes(`${foeName(demo, foe.id)}'s`) && l.text.includes('Kara'))).toBe(false);
    expect(demo.state.entity('kara')!.hitPoints.marked).toBe(hpBefore);

    demo.state.bad = { ...demo.state.bad, value: 1 };
    endTurn(demo);
    expect(husk.conditions.has('asleep')).toBe(false);
    expect(demo.state.bad.value).toBe(0);
    expect(demo.log.map((l) => l.text)).toContain(`The GM spends a Shadow: the ${foeName(demo, foe.id)} shakes off asleep.`);
  });

  it('a hit that marks a Hit Point wakes a sleeper', () => {
    const demo = scene();
    const foe = nearestFoe(demo, 'kara');
    closeIn(demo, 'kara', foe.id);
    const husk = demo.state.entity(foe.id)!;
    husk.conditions.add('asleep');
    husk.conditionDurations.set('asleep', 'scene');
    let woke = false;
    for (let i = 0; i < 12 && !woke; i++) {
      const swing = attackWithSelected(demo, foe.id);
      if (swing?.hit && swing.hitPointsMarked > 0) {
        woke = true;
        expect(husk.conditions.has('asleep')).toBe(false);
      } else {
        expect(husk.conditions.has('asleep')).toBe(true);
      }
      if (!husk.alive) break;
    }
    expect(woke || !husk.alive).toBe(true);
  });
});

describe('stepping back from a roll', () => {
  it('puts the card down with its cost returned, and the turn still to take', () => {
    const demo = scene();
    holds(demo, 'finn', [FIXTURE_AREA_CARD]);
    const foe = nearestFoe(demo, 'finn');
    closeIn(demo, 'finn', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const finn = demo.state.entity('finn')!;
    finn.good = { max: 6, value: 2 };
    expect(useAbility(demo, 'finn', 'fixture-bladefall').status).toBe('waiting');
    expect(finn.good.value).toBe(1);
    const stepped = answerPending(demo, { kind: 'cancel' });
    expect(stepped.status).toBe('done');
    expect(demo.pending).toBeNull();
    expect(finn.good.value).toBe(2);
    expect(demo.log.map((l) => l.text)).toContain('Finn steps back from Bladefall; its cost is returned.');
    expect(demo.encounter!.log.some((e) => e.kind === 'acted' && e.id === 'finn')).toBe(false);
    expect(demo.encounter!.canAct('finn')).toBe(true);
  });

  it('gives a once-per-rest use back when the choice it opens with is cancelled', () => {
    const demo = scene();
    carry(demo);
    const sheet = demo.sheets.get('mira')!;
    const grown = { ...sheet, domainCards: [...(sheet.domainCards ?? []), FIXTURE_BARRAGE_CARD] };
    demo.sheets.set('mira', grown);
    demo.characters.set('mira', deriveCharacter(grown, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    const foe = nearestFoe(demo, 'mira');
    closeIn(demo, 'mira', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    demo.state.entity('mira')!.good = { max: 6, value: 2 };
    expect(useAbility(demo, 'mira', 'fixture-barrage').status).toBe('waiting');
    expect(demo.pending?.prompt.kind).toBe('choice');
    expect(demo.scenario.abilityUses.get(useKey('mira', 'fixture-barrage'))).toBe(1);
    expect(answerPending(demo, { kind: 'cancel' }).status).toBe('done');
    expect(demo.scenario.abilityUses.has(useKey('mira', 'fixture-barrage'))).toBe(false);
    expect(demo.state.entity('mira')!.good!.value).toBe(2);
    expect(demo.encounter!.log.some((e) => e.kind === 'acted' && e.id === 'mira')).toBe(false);
  });
});

describe("a grimoire spell's words", () => {
  it('are the spell\'s own feature text, not the whole book', () => {
    const demo = scene();
    // The book has to be in her hand: this reads the abilities she actually holds.
    demo.project.cards.push(...FIXTURE_CARDS);
    for (const ability of A_BOOK_OF_TWO_SPELLS) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get('mira')!, domainCards: [FIXTURE_GRIMOIRE], loadout: [FIXTURE_GRIMOIRE] };
    demo.sheets.set('mira', sheet);
    demo.characters.set('mira', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);

    const push = abilitiesOf(demo, 'mira').find((a) => a.id === 'fixture-grimoire-shove')!;
    const text = abilityText(demo, push);
    expect(text.startsWith('Shove something away from you, hard')).toBe(true);
    // The other spell in the same book stays out of the answer.
    expect(text).not.toContain('Splinter');
  });
});

describe('a card written in the project\'s own code', () => {
  it('clears a Hit Point from the badly hurt and a Stress from the rest', () => {
    const demo = scene();
    const kara = demo.state.entity('kara')!;
    const finn = demo.state.entity('finn')!;
    const mira = demo.state.entity('mira')!;
    // Everyone stands together, so the selector reaches them.
    demo.state.moveEntity('finn', demo.grid.indexOf(demo.grid.xOf(kara.tile) + 1, demo.grid.yOf(kara.tile)));
    demo.state.moveEntity('mira', demo.grid.indexOf(demo.grid.xOf(kara.tile), demo.grid.yOf(kara.tile) + 1));
    kara.good = { max: 6, value: 2 };
    // Finn is badly hurt; Mira is merely rattled.
    finn.hitPoints = { ...finn.hitPoints, marked: finn.hitPoints.max - 1 };
    finn.stress = { ...finn.stress, marked: 1 };
    mira.stress = { ...mira.stress, marked: 2 };
    kara.stress = { ...kara.stress, marked: 1 };

    const result = useAbility(demo, 'kara', 'rally-the-line');
    expect(result.status).toBe('done');
    expect(kara.good.value).toBe(1);
    expect(finn.hitPoints.marked).toBe(finn.hitPoints.max - 2);
    expect(finn.stress.marked).toBe(1);
    expect(mira.stress.marked).toBe(1);
    expect(kara.stress.marked).toBe(0);
    expect(demo.log.map((l) => l.text)).toContain('The line steadies.');
  });
});

describe('tokens on a card', () => {
  it('refills a session card on a long rest and not on a short one', () => {
    const demo = scene();
    holds(demo, 'mira', [CHAOS_CARD]);
    // "At the beginning of a session": a session boundary falls on a long rest, and
    // what proves it is the behaviour below rather than the card restating itself.
    expect(rest(demo, 'short', { moves: {} }).ok).toBe(true);
    expect(demo.world.tokensOn('mira', CHAOS_ABILITY)).toBe(0);
    expect(rest(demo, 'long', { moves: {} }).ok).toBe(true);
    expect(demo.world.tokensOn('mira', CHAOS_ABILITY)).toBe(demo.world.spellcastValue('mira')!);
  });


  it('places them on a rest, spends them for the damage rolled, and clears them on the next', () => {
    const demo = scene();
    // Her Spellcast trait is Knowledge, so that many tokens go on the card.
    holds(demo, 'mira', [CHAOS_CARD]);
    const spellcast = demo.world.spellcastValue('mira')!;
    expect(spellcast).toBeGreaterThan(0);

    // Nothing on the card yet: the card is greyed out and says why.
    const before = abilityList(demo, 'mira').find((a) => a.ability.id === CHAOS_ABILITY)!;
    expect(before.usable).toBe(false);

    expect(rest(demo, 'long', { moves: {} }).ok).toBe(true);
    expect(demo.world.tokensOn('mira', CHAOS_ABILITY)).toBe(spellcast);
    expect(demo.log.map((l) => l.text).some((t) => t.includes('places') && t.includes('Let It Out'))).toBe(true);

    const foe = nearestFoe(demo, 'mira');
    closeIn(demo, 'mira', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const result = useAbility(demo, 'mira', CHAOS_ABILITY, [foe.id]);
    expect(result.status).toBe('waiting');
    if (demo.pending?.kind !== 'script' || demo.pending.prompt.kind !== 'choice') throw new Error('expected a choice');
    // One option per token held.
    expect(demo.pending.prompt.options).toHaveLength(spellcast);
    answerPending(demo, { kind: 'choose', index: spellcast - 1 });
    expect(demo.world.tokensOn('mira', CHAOS_ABILITY)).toBe(0);
    // Spending them all leaves the card unusable until the next long rest.
    const after = abilityList(demo, 'mira').find((a) => a.ability.id === CHAOS_ABILITY)!;
    expect(after.usable).toBe(false);
  });
});

describe("a stat block's cards", () => {
  it('are every card printed on it, named and worded, and none printed elsewhere', () => {
    const demo = scene();
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const block = adversaryDefOf(demo, husk.id)!.id;
    const before = statBlockCards(demo, block).length;

    const printedOn = (id: string, name: string, adversaries: string[], text = '') =>
      cardDefSchema.parse({ id, name, text, grant: { kind: 'adversary', adversaries } });
    // One that is only words, one whose words are on the ability the editor wrote on it, one elsewhere.
    demo.project.cards.push(printedOn('grasp', 'Grasping Roots', [block], 'Roots hold whoever it hits.'));
    demo.project.cards.push(printedOn('howl', 'Howl', ['someone-else', block]));
    demo.project.abilities.push(abilitySchema.parse({ id: 'howl', name: 'Howl', source: { card: 'howl' }, text: 'Everyone near marks a Stress.' }));
    demo.project.cards.push(printedOn('elsewhere', 'Elsewhere', ['someone-else']));

    const shown = statBlockCards(demo, block);
    expect(shown).toHaveLength(before + 2);
    expect(shown.slice(before)).toEqual([
      { id: 'grasp', name: 'Grasping Roots', text: 'Roots hold whoever it hits.' },
      { id: 'howl', name: 'Howl', text: 'Everyone near marks a Stress.' },
    ]);
  });
});

describe('a card a condition lends', () => {
  /** A mark that lends a card with two abilities on it: a passive, and one to play. */
  const lending = (seed: string): DemoScene => {
    const demo = scene(seed);
    demo.project.conditionDefs.push(conditionDefSchema.parse({ id: 'steadied', name: 'Steadied', text: 'Somebody has your back.' }));
    demo.project.cards.push(
      cardDefSchema.parse({ id: 'steady-hand', name: 'Steady Hand', text: 'Held while you are steadied.', grant: { kind: 'condition', conditions: ['steadied'] } }),
    );
    demo.project.abilities.push(
      abilitySchema.parse({ id: 'steady-footing', name: 'Steady Footing', source: { card: 'steady-hand' }, kind: 'passive', modifiers: [{ stat: 'evasion', bonus: 1 }] }),
      abilitySchema.parse({ id: 'steady-strike', name: 'Steady Strike', source: { card: 'steady-hand' }, effects: [{ kind: 'log', text: 'Steady.', tone: 'good' }] }),
    );
    refreshWorld(demo);
    return demo;
  };
  const zone = (demo: DemoScene): string[] => loadoutView(demo, 'kara').granted.map((card) => card.id);

  it('is in the hands of whoever bears the condition, for as long as it lasts', () => {
    const demo = lending('lent');
    const evasion = demo.world.poolBonus('kara', 'evasion');
    expect(names(demo, 'kara')).not.toContain('steady-strike');
    expect(zone(demo)).not.toContain('steady-hand');

    demo.world.applyCondition('kara', 'steadied', 'scene');
    // Last, after everything she has for good: on the bar, in the world's hands, and face up.
    expect(names(demo, 'kara').slice(-2)).toEqual(['steady-footing', 'steady-strike']);
    expect(demo.world.heldBy('kara').map((a) => a.id).slice(-2)).toEqual(['steady-footing', 'steady-strike']);
    expect(loadoutView(demo, 'kara').granted.at(-1)).toEqual({
      id: 'steady-hand',
      name: 'Steady Hand',
      text: 'Held while you are steadied.',
      from: 'Lent by Steadied',
    });
    expect(names(demo, 'mira')).not.toContain('steady-strike');
    // Never derived into the numbers her sheet keeps, so read as the world reads a condition's own.
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(evasion + 1);

    demo.world.clearCondition('kara', 'steadied');
    expect(names(demo, 'kara')).not.toContain('steady-strike');
    expect(zone(demo)).not.toContain('steady-hand');
    expect(demo.world.poolBonus('kara', 'evasion')).toBe(evasion);
  });

  it('lends a creature the same card, beside what its block prints', () => {
    const demo = lending('lent-foe');
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const printed = demo.world.heldBy(husk.id).map((a) => a.id);
    demo.world.applyCondition(husk.id, 'steadied', 'scene');
    expect(demo.world.heldBy(husk.id).map((a) => a.id)).toEqual([...printed, 'steady-footing', 'steady-strike']);
  });
});
