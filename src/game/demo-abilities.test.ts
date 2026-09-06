import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { useKey } from '../engine/script/world';
import { NO_TILE } from '../engine/grid/grid';
import {
  abilityList,
  abilityTargets,
  abilitiesOf,
  loadoutView,
  rest,
  swapCard,
  useAbility,
} from './demo-abilities';
import {
  SRD_CHARACTERS,
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

/** The living adversary nearest a character, and its tile. */
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
  it('lists class, Hope, subclass and loadout abilities per character', () => {
    const demo = scene();
    expect(names(demo, 'kara')).toEqual(['guardian-frontline-tank', 'stalwart-unwavering', 'stalwart-iron-will', 'bare-bones', 'get-back-up']);
    expect(names(demo, 'finn')).toEqual(['rogue-rogues-dodge', 'pick-and-pull', 'rain-of-blades']);
    expect(names(demo, 'mira')).toEqual([
      'wizard-not-this-time',
      'book-of-ava-power-push',
      'book-of-ava-tavas-armor',
      'book-of-ava-ice-spike',
      'rune-ward',
    ]);
  });

  it("shows the SRD's words and says why a card is greyed out", () => {
    const demo = scene();
    const list = abilityList(demo, 'kara');
    const tank = list.find((v) => v.ability.id === 'guardian-frontline-tank')!;
    expect(tank.text).toContain('Spend 3 Hope to clear 2 Armor Slots');
    expect(tank.usable).toBe(false);
    expect(tank.reason).toBe('needs 3 Hope');
    const bones = list.find((v) => v.ability.id === 'bare-bones')!;
    expect(bones.reason).toBe('always on');
    expect(bones.text).toContain('Armor Score');
  });
});

describe('a Hope feature', () => {
  it('costs three Hope, wants something to fix, and is not the turn', () => {
    const demo = scene();
    const kara = demo.state.entity('kara')!;
    kara.hope = { max: 6, value: 3 };
    // Nothing marked: the feature has nothing to clear.
    expect(useAbility(demo, 'kara', 'guardian-frontline-tank').status).toBe('refused');
    expect(demo.log.at(-1)!.text).toContain('not now');
    expect(kara.hope.value).toBe(3);

    kara.armorSlots = { max: kara.armorSlots.max, marked: 3 };
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const result = useAbility(demo, 'kara', 'guardian-frontline-tank');
    expect(result.status).toBe('done');
    expect(kara.hope.value).toBe(0);
    expect(kara.armorSlots.marked).toBe(1);
    expect(demo.log.map((l) => l.text)).toContain('Kara clears 2 Armor Slots.');
    // Not an action: no `acted` event for Kara.
    expect(demo.encounter!.log.some((e) => e.kind === 'acted' && e.id === 'kara')).toBe(false);
  });
});

describe('a spell in a fight', () => {
  it('pays its Hope, rolls against everyone Very Close, and spends the turn', () => {
    const demo = scene();
    const foe = nearestFoe(demo, 'finn');
    closeIn(demo, 'finn', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    const finn = demo.state.entity('finn')!;
    finn.hope = { max: 6, value: 2 };
    const fearBefore = demo.state.fear.value;

    const result = useAbility(demo, 'finn', 'rain-of-blades');
    expect(result.status).toBe('waiting');
    expect(demo.pending?.prompt.kind).toBe('check');
    if (demo.pending?.prompt.kind !== 'check') throw new Error('expected a check');
    // Finn's Spellcast trait is Finesse +2, and the targets are the adversaries in reach.
    expect(demo.pending.prompt.modifier).toBe(2);
    expect(demo.pending.prompt.trait).toBe('spellcast');
    expect(demo.pending.prompt.targets).toContain(foe.id);
    expect(demo.pending.prompt.experiences.length).toBeGreaterThan(0);
    // The Hope is spent before the roll.
    expect(finn.hope.value).toBe(1);
    // The turn is not spent until the roll is made.
    expect(demo.encounter!.log.some((e) => e.kind === 'acted' && e.id === 'finn')).toBe(false);

    const answered = answerPending(demo, { kind: 'roll' });
    expect(answered.status).toBe('done');
    expect(demo.pending).toBeNull();
    const checkLine = demo.log.find((l) => l.text.startsWith('Hope '))!;
    expect(checkLine).toBeDefined();
    // The dice decide the rest, but the bookkeeping is the same either way.
    const withHope = /with Hope|Critical/.test(checkLine.text);
    expect(finn.hope.value).toBe(withHope ? 2 : 1);
    expect(demo.state.fear.value).toBe(withHope ? fearBefore : fearBefore + 1);
    expect(demo.encounter!.log.some((e) => e.kind === 'acted' && e.id === 'finn')).toBe(true);
    if (demo.encounter!.outcome === 'ongoing') {
      expect(demo.encounter!.view().side).toBe(withHope && /succeeds|Critical/.test(checkLine.text) ? 'party' : 'gm');
    }
  });

  it('knocks a husk back on a Power Push', () => {
    // Try seeds until the roll lands: the point is what a hit does, not the dice.
    for (let seed = 1; seed < 40; seed++) {
      const demo = scene(`push-${seed}`);
      const foe = nearestFoe(demo, 'mira');
      closeIn(demo, 'mira', foe.id);
      startEncounter(demo, demo.scene.encounters[0]!.id);
      const before = demo.grid.euclideanDistance(demo.state.entity('mira')!.tile, demo.state.entity(foe.id)!.tile);
      expect(useAbility(demo, 'mira', 'book-of-ava-power-push', [foe.id]).status).toBe('waiting');
      answerPending(demo, { kind: 'roll' });
      const log = demo.log.map((l) => l.text);
      if (!log.some((t) => t.includes('is thrown back'))) continue;
      const after = demo.grid.euclideanDistance(demo.state.entity('mira')!.tile, demo.state.entity(foe.id)!.tile);
      expect(after).toBeGreaterThan(before);
      expect(log.some((t) => /d10\+2 → \d+ damage to Acid Burrower/.test(t))).toBe(true);
      return;
    }
    throw new Error('no seed landed a Power Push in forty tries');
  });

  it('refuses a target out of range, and a spell with none, drawing nothing', () => {
    const demo = scene();
    // Mira starts far from every husk: Ice Spike reaches Far, but the vault is wider.
    const before = demo.rng.save();
    expect(abilityTargets(demo, 'mira', abilitiesOf(demo, 'mira').find((a) => a.id === 'book-of-ava-ice-spike')!)).toEqual([]);
    expect(useAbility(demo, 'mira', 'book-of-ava-ice-spike').status).toBe('refused');
    expect(demo.log.at(-1)!.text).toContain('nothing in range');
    expect(demo.rng.save()).toBe(before);
    // Rain of Blades wants nobody picked, but wants somebody to hit.
    expect(useAbility(demo, 'finn', 'rain-of-blades').status).toBe('refused');
  });

  it("is refused on the GM's turn, and after acting only when the spotlight rules say", () => {
    const demo = scene();
    const foe = nearestFoe(demo, 'mira');
    closeIn(demo, 'mira', foe.id);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    demo.encounter!.passToGm();
    expect(useAbility(demo, 'mira', 'book-of-ava-power-push', [foe.id]).status).toBe('refused');
    expect(demo.log.at(-1)!.text).toContain("the GM's turn");
  });
});

describe('the loadout and the vault', () => {
  const grow = (demo: DemoScene): void => {
    const sheet = demo.sheets.get('kara')!;
    const cards = ['bare-bones', 'get-back-up', 'forceful-push', 'i-am-your-shield', 'not-good-enough', 'reckless'];
    const grown = { ...sheet, domainCards: cards };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, SRD_CHARACTERS).character);
    refreshWorld(demo);
  };

  it('holds five, vaults the rest, and only active cards are abilities', () => {
    const demo = scene();
    grow(demo);
    const view = loadoutView(demo, 'kara');
    expect(view.loadout.map((c) => c.id)).toEqual(['bare-bones', 'get-back-up', 'forceful-push', 'i-am-your-shield', 'not-good-enough']);
    expect(view.vault.map((c) => c.id)).toEqual(['reckless']);
    expect(names(demo, 'kara')).not.toContain('reckless');
  });

  it('recalls a card for Stress equal to its Recall Cost, and free at a rest', () => {
    const demo = scene();
    grow(demo);
    const kara = demo.state.entity('kara')!;
    // Reckless and Not Good Enough both recall for 1.
    expect(SRD_CHARACTERS.domainCards.get('reckless')!.recallCost).toBe(1);
    expect(swapCard(demo, 'kara', 'reckless')).toEqual({ ok: false, reason: expect.stringContaining('holds 5') });
    const swapped = swapCard(demo, 'kara', 'reckless', 'not-good-enough');
    expect(swapped).toEqual({ ok: true, stress: 1 });
    expect(kara.stress.marked).toBe(1);
    expect(loadoutView(demo, 'kara').vault.map((c) => c.id)).toEqual(['not-good-enough']);
    expect(demo.log.at(-1)!.text).toBe('Kara recalls Reckless and vaults Not Good Enough, marking 1 Stress.');

    // Full Stress: no room to mark the cost.
    kara.stress = { max: kara.stress.max, marked: kara.stress.max };
    expect(swapCard(demo, 'kara', 'not-good-enough', 'reckless').ok).toBe(false);
    // At a rest the swap is free.
    expect(swapCard(demo, 'kara', 'not-good-enough', 'reckless', { resting: true })).toEqual({ ok: true, stress: 0 });
    // The loadout rides on the sheet, so a save carries it.
    expect(demo.sheets.get('kara')!.loadout).toEqual(['bare-bones', 'get-back-up', 'forceful-push', 'i-am-your-shield', 'not-good-enough']);
  });
});

describe('a rest', () => {
  it('clears 1d4 + tier on a short rest, everything on a long one, and hands the GM Fear', () => {
    const demo = scene();
    const kara = demo.state.entity('kara')!;
    const mira = demo.state.entity('mira')!;
    kara.hitPoints = { ...kara.hitPoints, marked: 6 };
    kara.stress = { ...kara.stress, marked: 5 };
    kara.armorSlots = { ...kara.armorSlots, marked: 3 };
    mira.hitPoints = { ...mira.hitPoints, marked: 4 };
    mira.hope = { max: 6, value: 0 };
    demo.scenario.abilityUses.set(useKey('mira', 'healing-hands'), 1);
    demo.scenario.abilityUses.set(useKey('kara', 'some-scene-thing'), 1);

    const short = rest(demo, 'short', {
      moves: {
        kara: [{ kind: 'tendWounds' }, { kind: 'repairArmor' }],
        mira: [{ kind: 'tendWounds', target: 'kara' }, { kind: 'prepare' }],
        finn: [{ kind: 'prepare' }, { kind: 'clearStress' }],
      },
    });
    expect(short).toEqual({ ok: true, fearGained: expect.any(Number) });
    if (!short.ok) return;
    expect(short.fearGained).toBeGreaterThanOrEqual(1);
    expect(short.fearGained).toBeLessThanOrEqual(4);
    // Two tendings of 2–5 each on 6 marked: between 0 and 2 left.
    expect(kara.hitPoints.marked).toBeLessThanOrEqual(2);
    expect(kara.armorSlots.marked).toBeLessThanOrEqual(1);
    // Two characters prepared together: 2 Hope each.
    expect(mira.hope!.value).toBe(2);
    // A once-per-long-rest card is still used; a per-rest one would refresh.
    expect(demo.scenario.abilityUses.get(useKey('mira', 'healing-hands'))).toBe(1);

    kara.hitPoints = { ...kara.hitPoints, marked: 5 };
    const fearBefore = demo.state.fear.value;
    const long = rest(demo, 'long', { moves: { kara: [{ kind: 'tendWounds' }, { kind: 'clearStress' }] } });
    expect(long.ok).toBe(true);
    expect(kara.hitPoints.marked).toBe(0);
    expect(kara.stress.marked).toBe(0);
    expect(demo.scenario.abilityUses.has(useKey('mira', 'healing-hands'))).toBe(false);
    // 1d4 + three party members, capped by the pool.
    expect(demo.state.fear.value - fearBefore).toBeGreaterThanOrEqual(Math.min(4, demo.state.fear.max - fearBefore));
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
    expect(demo.log.map((l) => l.text)).toContain('The Acid Burrower shakes off restrained.');
    // It did not also attack.
    expect(demo.log.some((l) => l.text.includes("Acid Burrower's") && l.text.includes('Kara'))).toBe(false);
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
    kara.hope = { max: 6, value: 6 };
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
