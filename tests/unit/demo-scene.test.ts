/**
 * The demo the page drives, asserted without a page.
 *
 * `game/demo-scene.ts` deliberately holds no renderer, camera or event handler,
 * so what the browser shows can be checked here — and an e2e failure means the
 * browser, not the scene.
 *
 * This is also the closest thing to a playable vertical slice, so these tests
 * double as the check on whether the engine can actually run one.
 */

import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { SceneView } from '../../src/engine/render/scene-view';
import { instanceCount } from '../../src/engine/render/terrain-mesh';
import { tileOf } from '../../src/engine/scene/grid-from-scene';
import { attackProfile } from '../../src/engine/character/sheet';
import {
  DEMO_ADVERSARY_ID,
  DEMO_MOVE_BUDGET,
  PARTY_SHEETS,
  SRD_ADVERSARIES,
  SRD_CHARACTERS,
  attackWithSelected,
  buildDemoScene,
  inCombat,
  moveSelectedTo,
  playGmTurn,
  reachableTiles,
  startEncounter,
  type DemoScene,
} from '../../src/game/demo-scene';

const build = (seed = 'demo'): DemoScene => buildDemoScene(demoMap(), seed);

/** Walk the selected member to the far side of a reachable set, repeatedly. */
function walkTowards(demo: DemoScene, target: number, steps = 12): void {
  for (let i = 0; i < steps; i++) {
    const field = reachableTiles(demo);
    if (field.canReach(target)) {
      moveSelectedTo(demo, target);
      return;
    }
    const best = field
      .tiles()
      .reduce((a, b) => (demo.grid.manhattanDistance(b, target) < demo.grid.manhattanDistance(a, target) ? b : a));
    if (!moveSelectedTo(demo, best).moved) return;
  }
}

describe('the demo scene', () => {
  it('imports the legacy vault and stands a party in it', () => {
    const demo = build();
    expect(demo.scene.width).toBe(22);
    expect(demo.grid.size).toBe(22 * 16);
    expect(demo.party.members()).toEqual(['kara', 'finn', 'mira']);
    expect(demo.party.selected).toBe('kara');
  });

  it('reads its adversaries from the vendored SRD data', () => {
    const burrower = SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
    expect(burrower.name).toBe('Acid Burrower');
    expect(SRD_ADVERSARIES.size).toBe(129);

    const demo = build();
    const adversaries = demo.state.entitiesOf('adversary');
    expect(adversaries.length).toBeGreaterThan(0);
    for (const a of adversaries) expect(a.hitPoints.max).toBe(burrower.hitPoints);
  });

  it('seats the party on the scene spawn points', () => {
    const demo = build();
    const spawns = demo.scene.spawns.map((p) => tileOf(demo.grid, p));
    for (const member of demo.state.entitiesOf('party')) expect(spawns).toContain(member.tile);
  });

  it('indexes the map trigger cells', () => {
    const demo = build();
    expect(demo.triggers.size).toBeGreaterThan(0);
  });
});

describe('party control', () => {
  it('moves whoever is selected, and lets the selection change', () => {
    const demo = build();
    const start = demo.state.entity('finn')!.tile;
    demo.party.select('finn');
    expect(demo.party.selected).toBe('finn');

    const destination = reachableTiles(demo).tiles().at(-1)!;
    expect(moveSelectedTo(demo, destination).moved).toBe(true);
    expect(demo.state.entity('finn')!.tile).toBe(destination);
    expect(demo.state.entity('finn')!.tile).not.toBe(start);
  });

  it('brings the rest of the party along out of combat', () => {
    const demo = build();
    const before = demo.party.members().map((id) => demo.state.entity(id)!.tile);
    const destination = reachableTiles(demo).tiles().at(-1)!;
    moveSelectedTo(demo, destination);
    const after = demo.party.members().map((id) => demo.state.entity(id)!.tile);

    expect(after).not.toEqual(before);
    // Everyone ends up somewhere distinct and passable.
    expect(new Set(after).size).toBe(after.length);
    for (const tile of after) expect(demo.grid.isPassable(tile)).toBe(true);
  });

  it('keeps the preview inside the budget and off the walls', () => {
    const demo = build();
    const field = reachableTiles(demo);
    const tiles = field.tiles();
    expect(tiles.length).toBeGreaterThan(1);
    for (const tile of tiles) {
      expect(demo.grid.isPassable(tile)).toBe(true);
      expect(field.costTo(tile)).toBeLessThanOrEqual(DEMO_MOVE_BUDGET);
    }
  });

  it('refuses a move out of reach and changes nothing', () => {
    const demo = build();
    const start = demo.state.entity('kara')!.tile;
    const reachable = new Set(reachableTiles(demo).tiles());
    const unreachable = [...Array(demo.grid.size).keys()].find((t) => !reachable.has(t))!;
    expect(moveSelectedTo(demo, unreachable).moved).toBe(false);
    expect(demo.state.entity('kara')!.tile).toBe(start);
  });
});

describe('walking into the fight', () => {
  it('starts the encounter when the party crosses a trigger cell', () => {
    const demo = build();
    const target = demo.state.entitiesOf('adversary')[0]!.tile;
    expect(inCombat(demo)).toBe(false);

    walkTowards(demo, target);
    expect(inCombat(demo)).toBe(true);
    expect(demo.encounter!.view().side).toBe('party');
  });

  it('stops the mover on the trigger rather than running past the ambush', () => {
    const demo = build();
    let hit: string | undefined;
    for (let i = 0; i < 12 && hit === undefined; i++) {
      const field = reachableTiles(demo);
      const best = field
        .tiles()
        .reduce((a, b) =>
          demo.grid.xOf(b) > demo.grid.xOf(a) ? b : a,
        );
      const result = moveSelectedTo(demo, best);
      if (!result.moved) break;
      hit = result.triggered;
      if (hit !== undefined) {
        // The mover finished on the tile that fired it.
        expect(demo.state.entity(demo.party.selected!)!.tile).toBe(result.path.at(-1));
      }
    }
    expect(hit).toBeDefined();
  });
});

describe('a fight, end to end', () => {
  /** Start the fight directly, so the exchange is what is under test. */
  function fighting(seed = 'fight'): DemoScene {
    const demo = build(seed);
    const encounter = demo.scene.encounters.find((e) => e.adversaries.length > 0)!;
    startEncounter(demo, encounter.id);
    return demo;
  }

  it('puts the party in combat with the spotlight', () => {
    const demo = fighting();
    expect(inCombat(demo)).toBe(true);
    expect(demo.encounter!.view()).toMatchObject({ side: 'party', round: 1, outcome: 'ongoing' });
  });

  it('refuses an attack on a target out of reach, without rolling', () => {
    const demo = fighting();
    const far = demo.state.entitiesOf('adversary')[0]!.id;
    const result = attackWithSelected(demo, far)!;
    expect(result.refused).not.toBeNull();
    expect(result.hitPointsMarked).toBe(0);
  });

  it('lands a hit once adjacent, and marks Hit Points', () => {
    const demo = fighting();
    const target = demo.state.entitiesOf('adversary')[0]!;
    // Put the selected character next to it rather than walking the whole way.
    demo.state.moveEntity('kara', demo.grid.indexOf(demo.grid.xOf(target.tile) - 1, demo.grid.yOf(target.tile)));

    let marked = 0;
    for (let i = 0; i < 12 && marked === 0 && target.alive; i++) {
      const result = attackWithSelected(demo, target.id);
      if (result === null) break;
      expect(result.refused).toBeNull();
      marked += result.hitPointsMarked;
      if (demo.encounter!.view().side === 'gm') demo.encounter!.endGmTurn();
    }
    expect(marked).toBeGreaterThan(0);
  });

  it('hands the spotlight to the GM on a roll with Fear, and back again', () => {
    const demo = fighting();
    const target = demo.state.entitiesOf('adversary')[0]!;
    demo.state.moveEntity('kara', demo.grid.indexOf(demo.grid.xOf(target.tile) - 1, demo.grid.yOf(target.tile)));

    let sawGmTurn = false;
    for (let i = 0; i < 20 && !sawGmTurn; i++) {
      attackWithSelected(demo, target.id);
      if (demo.encounter!.view().side === 'gm') {
        sawGmTurn = true;
        const acted = playGmTurn(demo);
        expect(acted).toBeGreaterThan(0);
        expect(demo.encounter!.view().side).toBe('party');
        expect(demo.encounter!.round).toBeGreaterThan(1);
      }
      if (!target.alive) break;
    }
    expect(sawGmTurn).toBe(true);
  });

  it('resolves to a victory when the adversaries fall', () => {
    const demo = fighting();
    for (const adversary of demo.state.entitiesOf('adversary')) {
      adversary.alive = false;
      adversary.hitPoints = { max: adversary.hitPoints.max, marked: adversary.hitPoints.max };
    }
    demo.encounter!.act('kara');
    expect(demo.encounter!.outcome).toBe('victory');
    expect(inCombat(demo)).toBe(false);
  });

  it('replays identically from the same seed', () => {
    const run = (): string => {
      const demo = fighting('same');
      const target = demo.state.entitiesOf('adversary')[0]!;
      demo.state.moveEntity('kara', demo.grid.indexOf(demo.grid.xOf(target.tile) - 1, demo.grid.yOf(target.tile)));
      const marks: number[] = [];
      for (let i = 0; i < 6; i++) {
        const result = attackWithSelected(demo, target.id);
        marks.push(result?.hitPointsMarked ?? -1);
        if (demo.encounter!.view().side === 'gm') playGmTurn(demo);
      }
      return marks.join(',');
    };
    expect(run()).toBe(run());
  });
});

describe('the party is built from content, not written down', () => {
  it('derives every sheet against the vendored SRD with no issues', () => {
    const demo = build();
    expect(demo.characters.size).toBe(PARTY_SHEETS.length);
    for (const sheet of PARTY_SHEETS) {
      expect(SRD_CHARACTERS.classes.has(sheet.classId)).toBe(true);
      expect(SRD_CHARACTERS.armors.has(sheet.armorId!)).toBe(true);
      expect(SRD_CHARACTERS.weapons.has(sheet.primaryWeaponId!)).toBe(true);
      expect(SRD_CHARACTERS.ancestries.has(sheet.ancestryId!)).toBe(true);
    }
  });

  it('takes each character Hit Points and Armor Slots from their class and armor', () => {
    const demo = build();
    for (const [id, character] of demo.characters) {
      const klass = SRD_CHARACTERS.classes.get(character.sheet.classId)!;
      const armor = SRD_CHARACTERS.armors.get(character.sheet.armorId!)!;
      const entity = demo.state.entity(id)!;

      expect(entity.hitPoints.max).toBe(klass.startingHitPoints);
      expect(entity.armorSlots.max).toBe(armor.baseScore);
      expect(entity.stress.max).toBe(6);
      expect(entity.hope!.value).toBe(2);
      // Level 1, so thresholds are the armor's plus one.
      expect(character.thresholds).toEqual({
        major: armor.baseThresholds.major + 1,
        severe: armor.baseThresholds.severe + 1,
      });
    }
  });

  it('gives the party genuinely different characters', () => {
    const demo = build();
    const evasions = [...demo.characters.values()].map((c) => c.evasion);
    const hitPoints = [...demo.characters.values()].map((c) => c.hitPoints);
    // Three classes, so these are not all the same number by construction.
    expect(new Set([...evasions, ...hitPoints]).size).toBeGreaterThan(1);
  });

  it('rolls the trait the equipped weapon names', () => {
    const demo = build();
    const finn = demo.characters.get('finn')!;
    const bow = SRD_CHARACTERS.weapons.get(finn.sheet.primaryWeaponId!)!;
    const profile = attackProfile(finn);
    expect(profile.name).toBe(bow.name);
    expect(profile.modifier.modifier).toBe(finn.sheet.traits[bow.trait]);
    expect(profile.range).toBe(bow.range);
  });

  it('gives the ranged character a longer reach than the sword-carrier', () => {
    const demo = build();
    const kara = attackProfile(demo.characters.get('kara')!);
    const finn = attackProfile(demo.characters.get('finn')!);
    expect(kara.range).toBe('melee');
    expect(finn.range).not.toBe('melee');
  });
});

describe('the demo renders', () => {
  it('draws every tile in a handful of draw calls, with a model per entity', () => {
    const demo = build();
    const view = new SceneView(demo.grid, { tints: demo.scene.tints });
    view.setDecos(demo.scene.decos);
    view.syncTokens(demo.state);

    expect(instanceCount(view.terrain)).toBe(demo.grid.size);
    expect(view.terrain.meshes.length).toBeLessThanOrEqual(4);
    expect(view.decoCount).toBe(demo.scene.decos.length);
    for (const entity of demo.state.allEntities()) expect(view.tokenFor(entity.id)).toBeDefined();
    expect(view.registry.missing()).toEqual([]);
    view.dispose();
  });

  it('paints exactly the reachable tiles', () => {
    const demo = build();
    const view = new SceneView(demo.grid);
    const tiles = reachableTiles(demo).tiles();
    view.showHighlights(tiles);
    expect(view.highlightedCount).toBe(tiles.length);
    view.dispose();
  });
});
