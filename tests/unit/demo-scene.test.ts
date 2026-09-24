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
import { hollowVaultMap } from '../../src/game/demo-map';
import { characterContentFor } from '../../src/game/room';
import { SceneView } from '../../src/engine/render/scene-view';
import { movementCircle } from '../../src/game/circle';
import { tilesDrawn } from '../../src/engine/render/terrain-mesh';
import { tileOf } from '../../src/engine/scene/grid-from-scene';
import { attackProfile } from '../../src/engine/character/sheet';
import type { Rng } from '../../src/engine/core/rng';
import {
  attackWithSelected,
  buildDemoScene,
  endTurn,
  moveSelectedTo,
  answerPending,
  playGmTurn,
  setSheet,
  type DemoScene,
} from '../../src/game/demo-scene';
import { inCombat } from '../../src/game/moment';
import {
  underPressureTiles,
  previewWalk,
  reachableTiles,
  startEncounter,
  arrive,
} from '../../src/game/movement';
import {
  DEMO_ADVERSARY_ID,
  DEMO_BAND_TILES,
  DEMO_MOVEMENT,
  PARTY_SHEETS,
  DEMO_ADVERSARIES,
  DEMO_CHARACTERS,
} from '../../src/game/demo-rules';
import { interactablesOf } from '../../src/engine/scene/prop-functions';

const build = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

/**
 * A project is played with the content it carries.
 *
 * The pack the app ships is a starting point, not the whole world: a project
 * may bring its own cards, classes and gear, and what it brings wins where the
 * two name the same id. This is what lets a scenario travel — and what lets a
 * test carry the one card it is about instead of borrowing a shipped one.
 */
describe('a project plays the content it carries', () => {
  const FIXTURE_CARD = {
    id: 'project-only-card',
    name: 'Project Only Card',
    grant: { kind: 'chosen' as const },
    domain: 'bulwark',
    type: 'ability' as const,
    level: 1,
    recallCost: 0,
    text: 'A card no pack has.',
    features: [],
  };

  it('resolves a card no shipped pack has', () => {
    const demo = build();
    demo.project.cards.push(FIXTURE_CARD);
    setSheet(demo, { ...demo.sheets.get('kara')!, domainCards: [FIXTURE_CARD.id] });

    expect(demo.characters.get('kara')!.cards.map((card) => card.id)).toEqual(['project-only-card']);
  });

  it('still plays the shipped pack when the project carries nothing', () => {
    const demo = build();
    setSheet(demo, { ...demo.sheets.get('kara')!, domainCards: ['power-slash'] });

    expect(demo.characters.get('kara')!.cards.map((card) => card.id)).toEqual(['power-slash']);
  });
});

/** The vault door starts shut; these tests are about what is behind it. */
function openTheDoor(demo: DemoScene): void {
  const door = interactablesOf(demo.scene).find((i) => i.kind === 'door')!;
  demo.world.openInteractable(door.id);
}

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
  it('builds the woods and the vault, and stands a party in them', () => {
    const demo = build();
    expect(demo.scene.width).toBe(44);
    expect(demo.grid.size).toBe(44 * 32);
    expect(demo.party.members()).toEqual(['kara', 'finn', 'mira', 'arty', 'pint', 'ganja']);
    expect(demo.party.selected).toBe('kara');
  });

  it('reads its adversaries from the pack it ships', () => {
    const knight = DEMO_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
    expect(knight.name).toBe('Hollow Knight');
    expect(DEMO_ADVERSARIES.size).toBe(10);

    // The prototype's husks are homebrew ids with no stat block, so the import
    // points every one of them at the demo's own creature: one block, however
    // many of them are standing in the vault.
    const demo = build();
    const adversaries = demo.state.entitiesOf('adversary');
    expect(adversaries.length).toBeGreaterThan(0);
    for (const a of adversaries) expect(a.hitPoints.max).toBe(knight.hitPoints);
  });

  it('stands one of every stat block along the back wall, on nobody\'s side', () => {
    const demo = build();
    const lineUp = demo.state.entitiesOf('neutral');
    expect(lineUp.map((e) => e.definition).sort()).toEqual([...DEMO_ADVERSARIES.keys()].sort());
    // Each on a tile of its own that can be stood on, and none of them where something else is.
    const taken = new Set([...demo.state.entitiesOf('party'), ...demo.state.entitiesOf('adversary')].map((e) => e.tile));
    expect(new Set(lineUp.map((e) => e.tile)).size).toBe(lineUp.length);
    for (const one of lineUp) {
      expect(demo.grid.isPassable(one.tile), one.id).toBe(true);
      expect(taken.has(one.tile), one.id).toBe(false);
      expect(one.hitPoints.max).toBe(DEMO_ADVERSARIES.get(one.definition)!.hitPoints);
    }
    // And the fight in the room is the one it always was: the three husks, and only them.
    expect(demo.state.entitiesOf('adversary').map((e) => e.id).sort()).toEqual(['group-1-husk-16-8', 'group-1-husk-18-3', 'group-1-husk-19-11']);
  });

  it('calls the fight won with the line-up still standing', () => {
    const demo = build();
    const runner = startEncounter(demo, 'group-1');
    expect([...runner.view().waiting].sort()).toEqual(['group-1-husk-16-8', 'group-1-husk-18-3', 'group-1-husk-19-11']);
    for (const husk of demo.state.entitiesOf('adversary')) husk.alive = false;
    expect(runner.settleIfDecided()).toBe(true);
    expect(runner.outcome).toBe('victory');
    expect(demo.state.entitiesOf('neutral').every((e) => e.alive)).toBe(true);
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

  it('keeps the preview off the walls and, out of a fight, counts no steps', () => {
    const demo = build();
    const field = reachableTiles(demo);
    const tiles = field.tiles();
    expect(tiles.length).toBeGreaterThan(1);
    for (const tile of tiles) expect(demo.grid.isPassable(tile)).toBe(true);
    // Everywhere the floor goes from where they stand: the far end of the vault included.
    const start = demo.state.entity('kara')!.tile;
    const farthest = Math.max(...tiles.map((t) => demo.grid.euclideanDistance(start, t)));
    expect(farthest).toBeGreaterThan(DEMO_BAND_TILES.close);
  });

  it('in a fight, the ground is a circle of Close range round where the spotlight found them', () => {
    const demo = build();
    openTheDoor(demo);
    const target = demo.state.entitiesOf('adversary')[0]!.tile;
    walkTowards(demo, target);
    expect(inCombat(demo)).toBe(true);
    const id = demo.party.selected!;
    const circle = movementCircle(demo, id)!;
    expect(circle.band).toBe('close');
    expect(circle.radius).toBe(DEMO_BAND_TILES.close + 0.5);
    const start = demo.grid.tileAtSpot(circle.anchor.x, circle.anchor.y);
    const tiles = reachableTiles(demo).tiles();
    expect(tiles.length).toBeGreaterThan(1);
    for (const tile of tiles) {
      expect(demo.grid.isPassable(tile)).toBe(true);
      expect(Math.hypot(demo.grid.xOf(tile) - circle.anchor.x, demo.grid.yOf(tile) - circle.anchor.y)).toBeLessThanOrEqual(circle.radius);
    }
    // And a diagonal is one step, so the disc is round rather than a diamond.
    const corner = [...tiles].find((t) => {
      const dx = Math.abs(demo.grid.xOf(t) - demo.grid.xOf(start));
      const dy = Math.abs(demo.grid.yOf(t) - demo.grid.yOf(start));
      return dx === dy && dx >= 2;
    });
    expect(corner).toBeDefined();
  });

  it('walks to the spot clicked, not the centre of its square, and brings the others along the line', () => {
    const demo = build();
    const start = demo.state.entity('kara')!.tile;
    const target = reachableTiles(demo)
      .tiles()
      .find((t) => demo.grid.chebyshevDistance(t, start) >= 3 && demo.grid.xOf(t) > demo.grid.xOf(start))!;
    const aimed = { x: demo.grid.xOf(target) + 0.3, y: demo.grid.yOf(target) - 0.2 };
    const result = moveSelectedTo(demo, target, aimed);
    expect(result.moved).toBe(true);
    const kara = demo.state.entity('kara')!;
    expect(kara.tile).toBe(target);
    expect(kara.at).toEqual(aimed);
    const motion = demo.motions.find((m) => m.id === 'kara')!;
    expect(motion.route!.at(-1)).toEqual(aimed);
    expect(motion.route!.length).toBeLessThanOrEqual(motion.path!.length);
    // The others followed and stand somewhere distinct, each in the tile they count on.
    for (const id of ['finn', 'mira']) {
      const follower = demo.state.entity(id)!;
      expect(demo.grid.tileAtSpot(follower.at.x, follower.at.y)).toBe(follower.tile);
    }
  });

  it('previews the line a click would walk, without walking it', () => {
    const demo = build();
    const start = demo.state.entity('kara')!.tile;
    const target = reachableTiles(demo)
      .tiles()
      .find((t) => demo.grid.chebyshevDistance(t, start) >= 3)!;
    const aimed = { x: demo.grid.xOf(target) + 0.2, y: demo.grid.yOf(target) + 0.1 };
    const preview = previewWalk(demo, target, aimed)!;
    expect(preview.route[0]).toEqual(demo.state.entity('kara')!.at);
    expect(preview.route.at(-1)).toEqual(aimed);
    expect(preview.beyond).toEqual([]);
    expect(demo.state.entity('kara')!.tile).toBe(start);
    // And the walk itself takes exactly that line.
    moveSelectedTo(demo, target, aimed);
    expect(demo.motions.find((m) => m.id === 'kara')!.route).toEqual(preview.route);
  });

  it('in a fight, previews the way beyond one move in a second line', () => {
    const demo = build();
    openTheDoor(demo);
    const target = demo.state.entitiesOf('adversary')[0]!.tile;
    walkTowards(demo, target);
    expect(inCombat(demo)).toBe(true);
    const id = demo.party.selected!;
    const inReach = new Set(reachableTiles(demo).tiles());
    const far = demo.party.reachable(id, { inCombat: true, budget: Infinity }).tiles().find((t) => !inReach.has(t))!;
    const preview = previewWalk(demo, far, demo.grid.spotOf(far))!;
    expect(preview.route.length).toBeGreaterThanOrEqual(2);
    const stop = preview.route.at(-1)!;
    // The first line stays inside the circle they move freely in, and stops at its edge: not in a lit square.
    const circle = movementCircle(demo, id)!;
    for (const spot of preview.route) expect(Math.hypot(spot.x - circle.anchor.x, spot.y - circle.anchor.y)).toBeLessThanOrEqual(circle.radius + 1e-6);
    expect(Math.hypot(stop.x - circle.anchor.x, stop.y - circle.anchor.y)).toBeGreaterThan(circle.radius - 0.2);
    expect(preview.beyond.length).toBeGreaterThanOrEqual(2);
    expect(preview.beyond[0]).toEqual(stop);
    expect(preview.beyond.at(-1)).toEqual(demo.grid.spotOf(far));
  });

  it('walks up to a spot it cannot reach out of a fight: the nearest reachable one', () => {
    const demo = build();
    const start = demo.state.entity('kara')!.tile;
    const reachable = new Set(reachableTiles(demo).tiles());
    // The shut vault door: the far side is out of reach, so the walk ends at the door.
    // On the floor, that is: the top of the wall is out of reach too, and a click there is a jump.
    const unreachable = [...Array(demo.grid.size).keys()].find((t) => !reachable.has(t) && demo.grid.isPassable(t) && demo.grid.standAt(t) === demo.grid.standAt(start))!;
    const aimed = demo.grid.spotOf(unreachable);
    expect(moveSelectedTo(demo, unreachable, aimed).moved).toBe(true);
    const kara = demo.state.entity('kara')!;
    expect(kara.tile).not.toBe(start);
    expect(reachable.has(kara.tile)).toBe(true);
    const near = (t: number): number => Math.hypot(demo.grid.xOf(t) - aimed.x, demo.grid.yOf(t) - aimed.y);
    for (const tile of reachable) expect(near(kara.tile)).toBeLessThanOrEqual(near(tile) + 1e-9);
  });

  it('in a fight, a click past even the push asks for the push, and refuses only the unreachable', () => {
    const demo = build();
    openTheDoor(demo);
    const target = demo.state.entitiesOf('adversary')[0]!.tile;
    walkTowards(demo, target);
    expect(inCombat(demo)).toBe(true);
    const id = demo.party.selected!;
    const start = demo.state.entity(id)!.tile;
    const inReach = new Set(reachableTiles(demo).tiles());
    // Past what one push opens, too: the roll is still asked, and a success walks as far as the wider circle goes.
    const run = new Set(underPressureTiles(demo));
    const whole = demo.party.reachable(id, { inCombat: true, budget: Infinity }).tiles();
    const far = whole.find((t) => !inReach.has(t) && !run.has(t))!;
    expect(far).toBeDefined();
    expect(moveSelectedTo(demo, far)).toMatchObject({ moved: false, pending: true });
    answerPending(demo, { kind: 'cancel' });
    expect(demo.state.entity(id)!.tile).toBe(start);
    // A wall is nowhere to go at all.
    const wall = [...Array(demo.grid.size).keys()].find((t) => !demo.grid.isPassable(t))!;
    demo.encounter!.endGmTurn();
    const before = demo.state.entity(demo.party.selected!)!.tile;
    expect(moveSelectedTo(demo, wall).moved).toBe(false);
    expect(demo.state.entity(demo.party.selected!)!.tile).toBe(before);
  });
});

describe('walking into the fight', () => {
  it('starts the encounter when the party crosses a trigger cell', () => {
    const demo = build();
    openTheDoor(demo);
    const target = demo.state.entitiesOf('adversary')[0]!.tile;
    expect(inCombat(demo)).toBe(false);

    walkTowards(demo, target);
    expect(inCombat(demo)).toBe(true);
    expect(demo.encounter!.view().side).toBe('party');
  });

  it('holds the fight until the tokens arrive when somebody is drawing the walk', () => {
    const demo = build();
    demo.animated = true;
    openTheDoor(demo);
    const target = demo.state.entitiesOf('adversary')[0]!.tile;
    walkTowards(demo, target);
    // The board crossed the trigger; the fight is woken, not begun.
    expect(demo.ambush).not.toBeNull();
    expect(inCombat(demo)).toBe(false);
    // Nobody walks or swings on the way in.
    const here = demo.state.entity(demo.party.selected!)!.tile;
    expect(moveSelectedTo(demo, here - 1).moved).toBe(false);
    expect(previewWalk(demo, here - 1, demo.grid.spotOf(here - 1))).toBeNull();
    expect(attackWithSelected(demo, demo.state.entitiesOf('adversary')[0]!.id)).toBeNull();
    // The tokens get there.
    expect(arrive(demo)).toBe(true);
    expect(demo.ambush).toBeNull();
    expect(inCombat(demo)).toBe(true);
    expect(arrive(demo)).toBe(false);
  });

  it('walks an adversary closing in along a line that ends where it now stands', () => {
    const demo = build();
    openTheDoor(demo);
    const target = demo.state.entitiesOf('adversary')[0]!.tile;
    walkTowards(demo, target);
    expect(inCombat(demo)).toBe(true);
    // Nobody in reach of anybody: whoever the GM spotlights has to walk.
    for (const member of demo.state.entitiesOf('party')) {
      const west = demo.grid.indexOf(demo.grid.xOf(member.tile) - 2, demo.grid.yOf(member.tile));
      if (demo.state.bodyFree(west, member.id)) demo.state.moveEntity(member.id, west);
    }
    for (const member of demo.state.entitiesOf('party')) {
      for (const foe of demo.state.entitiesOf('adversary')) expect(demo.grid.chebyshevDistance(member.tile, foe.tile)).toBeGreaterThan(1);
    }
    demo.motions.length = 0;
    endTurn(demo);
    const walks = demo.motions.filter((m) => m.route !== undefined);
    expect(walks.length).toBeGreaterThan(0);
    for (const walk of walks) {
      const mover = demo.state.entity(walk.id)!;
      expect(walk.route!.at(-1)).toEqual(mover.at);
      expect(walk.path!.at(-1)).toBe(mover.tile);
    }
  });

  it('stops the mover on the trigger rather than running past the ambush', () => {
    const demo = build();
    openTheDoor(demo);
    let hit: string | undefined;
    for (let i = 0; i < 12 && hit === undefined; i++) {
      // East along the door's own row: the woods now run further east than the vault does, and a
      // walk out into them would never cross the trigger.
      const field = reachableTiles(demo);
      const best = field
        .tiles()
        .filter((tile) => demo.grid.yOf(tile) === 7)
        .reduce((a, b) => (demo.grid.xOf(b) > demo.grid.xOf(a) ? b : a));
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

  it('closes as far as it can on a target it cannot reach, without rolling, and that is the action', () => {
    const demo = fighting();
    const far = demo.state.entitiesOf('adversary')[0]!.id;
    const start = demo.state.entity('kara')!.tile;
    const result = attackWithSelected(demo, far)!;
    expect(result.refused).toBe('outOfRange');
    expect(result.hitPointsMarked).toBe(0);
    // Behind the shut vault door: the walk gets nearer and stops, and the log says so.
    const stood = demo.state.entity('kara')!.tile;
    expect(stood).not.toBe(start);
    expect(demo.grid.euclideanDistance(stood, demo.state.entity(far)!.tile)).toBeLessThan(
      demo.grid.euclideanDistance(start, demo.state.entity(far)!.tile),
    );
    expect(demo.log.some((l) => l.text.includes('closes in, but cannot reach'))).toBe(true);
    expect(demo.motions.some((m) => m.id === 'kara' && m.route !== undefined)).toBe(true);
  });

  it('walks up to a target within one move and swings from where the weapon reaches', () => {
    const demo = fighting();
    openTheDoor(demo);
    const foe = demo.state.entitiesOf('adversary')[0]!;
    // Three tiles west of it, inside the vault: a walk, then the swing, in one action.
    const west = demo.grid.indexOf(demo.grid.xOf(foe.tile) - 3, demo.grid.yOf(foe.tile));
    expect(demo.state.bodyFree(west)).toBe(true);
    demo.state.moveEntity('kara', west);
    demo.motions.length = 0;
    const result = attackWithSelected(demo, foe.id)!;
    expect(result.refused).toBeNull();
    const kara = demo.state.entity('kara')!;
    expect(demo.world.bandBetween(kara.tile, foe.tile)).toBe('melee');
    const walk = demo.motions.find((m) => m.id === 'kara' && m.route !== undefined)!;
    expect(walk.route!.at(-1)).toEqual(kara.at);
    // And the swing followed the walk on the board.
    expect(demo.motions.some((m) => m.id === 'kara' && m.lunge !== undefined)).toBe(true);
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

  it('hands the spotlight to the GM on a roll with Shadow, and back again', () => {
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

describe('movement under pressure', () => {
  /** In the fight, with the selected fighter's one move measured and a spot past it that a run reaches. */
  const pressed = (seed = 'demo') => {
    const demo = build(seed);
    openTheDoor(demo);
    walkTowards(demo, demo.state.entitiesOf('adversary')[0]!.tile);
    expect(inCombat(demo)).toBe(true);
    const id = demo.party.selected!;
    const start = demo.state.entity(id)!.tile;
    const inReach = new Set(reachableTiles(demo).tiles());
    const far = underPressureTiles(demo)[0]!;
    expect(far).toBeDefined();
    return { demo, id, start, inReach, far };
  };

  /** How many times the encounter has recorded this fighter acting: what spending the action leaves. */
  const acted = (demo: DemoScene, id: string): number =>
    demo.encounter!.log.filter((event) => event.kind === 'acted' && event.id === id).length;

  /** Dice that come up as told, and ones after. */
  const dice = (...faces: number[]): Rng => {
    const rng: Rng = {
      next: () => 0,
      nextInt: () => 0,
      die: () => faces.shift() ?? 1,
      dice: (count: number) => Array.from({ length: count }, () => faces.shift() ?? 1),
      pick: <T,>(items: readonly T[]) => items[0]!,
      shuffle: <T,>(items: T[]) => items,
      fork: () => rng,
      save: () => 0,
      restore: () => {},
    };
    return rng;
  };

  it('previews a push in its own colour, and moves freely inside the circle again and again', () => {
    const { demo, id, inReach, far } = pressed();
    const run = previewWalk(demo, far, demo.grid.spotOf(far))!;
    expect(run.beyond.length).toBeGreaterThanOrEqual(2);
    expect(run.run).toBe(true);
    // Inside the circle nothing is spent: two moves, and still able to act.
    const before = acted(demo, id);
    const [first, second] = [...inReach].filter((t) => t !== demo.state.entity(id)!.tile).slice(0, 2) as [number, number];
    expect(moveSelectedTo(demo, first).moved).toBe(true);
    expect(moveSelectedTo(demo, second).moved).toBe(true);
    expect(acted(demo, id)).toBe(before);
    expect(demo.encounter!.canAct(id)).toBe(true);
    // The circle is where the spotlight found them, not where they have got to: the same ground is free after the moves.
    expect(new Set(reachableTiles(demo).tiles())).toEqual(inReach);
  });

  it('asks for an Agility Roll past one move, and a run called off costs nothing', () => {
    const { demo, id, start, far } = pressed();
    const before = acted(demo, id);
    expect(moveSelectedTo(demo, far)).toMatchObject({ moved: false, pending: true });
    expect(demo.pending?.kind === 'script' ? demo.pending.prompt.kind : null).toBe('check');
    expect(demo.state.entity(id)!.tile).toBe(start);

    answerPending(demo, { kind: 'cancel' });
    expect(demo.pending).toBeNull();
    expect(demo.state.entity(id)!.tile).toBe(start);
    expect(acted(demo, id)).toBe(before);
  });

  it('gets there on a success, the roll was the action, and the circle stays pushed out for the rest of the turn', () => {
    const { demo, id, far } = pressed();
    const before = acted(demo, id);
    expect(movementCircle(demo, id)!.band).toBe('close');
    demo.rng = dice(12, 11);
    moveSelectedTo(demo, far);
    answerPending(demo, { kind: 'roll' });
    expect(demo.pending).toBeNull();
    expect(demo.state.entity(id)!.tile).toBe(far);
    expect(acted(demo, id)).toBe(before + 1);
    expect(movementCircle(demo, id)!.band).toBe('far');
    expect(demo.encounter!.view().side).toBe('party');
    // Pushed out, the wider ground is free too; and the next spotlight draws the circle again at Close.
    expect(reachableTiles(demo).tiles().length).toBeGreaterThan(0);
    endTurn(demo);
    while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
    expect(movementCircle(demo, id)!.band).toBe('close');
  });

  it('walks as far as the wider circle goes when the click was past even that, and says so', () => {
    const { demo, id, inReach, far: pushed } = pressed();
    const run = new Set(underPressureTiles(demo));
    const whole = demo.party.reachable(id, { inCombat: true, budget: Infinity }).tiles();
    const far = whole.find((t) => !inReach.has(t) && !run.has(t)) ?? pushed;
    demo.rng = dice(12, 11);
    const logBefore = demo.log.length;
    moveSelectedTo(demo, far);
    answerPending(demo, { kind: 'roll' });
    const circle = movementCircle(demo, id)!;
    expect(circle.band).toBe('far');
    const walked = demo.motions.at(-1)!.route!;
    for (const spot of walked) expect(Math.hypot(spot.x - circle.anchor.x, spot.y - circle.anchor.y)).toBeLessThanOrEqual(circle.radius + 1e-6);
    expect(demo.state.entity(id)!.at).toEqual(walked.at(-1));
    if (far !== pushed) expect(demo.log.slice(logBefore).some((l) => l.text.includes('can go no further'))).toBe(true);
  });

  it('moves nobody on a failure, and the spotlight passes to the GM', () => {
    const { demo, id, start, far } = pressed();
    const before = acted(demo, id);
    demo.rng = dice(1, 2);
    const logBefore = demo.log.length;
    moveSelectedTo(demo, far);
    // The warning is on the card before the dice are thrown.
    expect(demo.pending?.kind === 'script' && demo.pending.prompt.kind === 'check' ? demo.pending.prompt.prompt ?? '' : '').toMatch(/spotlight passes to the GM/);
    answerPending(demo, { kind: 'roll' });
    expect(demo.state.entity(id)!.tile).toBe(start);
    expect(acted(demo, id)).toBe(before + 1);
    expect(demo.encounter!.view().side).toBe('gm');
    expect(demo.log.slice(logBefore).some((l) => l.text.includes('spotlight passes to the GM'))).toBe(true);
  });

  it('walks a creature with no swing in reach from within Close as far as Very Far, and that is its turn', () => {
    const demo = build('pressure-gm');
    demo.askDefender = false;
    const encounter = demo.scene.encounters.find((e) => e.adversaries.length > 0)!;
    startEncounter(demo, encounter.id);
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    const party = demo.state.entitiesOf('party').filter((e) => e.alive);
    const standing = new Set([...party, ...demo.state.entitiesOf('adversary')].map((e) => e.tile));
    const nearest = (tile: number): number => Math.min(...party.map((p) => demo.grid.euclideanDistance(tile, p.tile)));
    // Somewhere a Close walk cannot bring it to a swing, and a Very Far one can bring it near.
    const from = [...Array(demo.grid.size).keys()].find((tile) => {
      if (!demo.grid.isPassable(tile) || standing.has(tile)) return false;
      const d = nearest(tile);
      if (d <= DEMO_BAND_TILES.close + 2 || d >= DEMO_BAND_TILES.veryFar - 2) return false;
      const run = demo.pathfinder.reachable(tile, DEMO_BAND_TILES.veryFar, { rules: DEMO_MOVEMENT, isBlocked: demo.state.blockedFor(husk.id) });
      return run.tiles().some((t) => nearest(t) <= 2);
    })!;
    expect(from).toBeDefined();
    demo.state.moveEntity(husk.id, from);
    // Alone, so a blow the party takes this turn could only be its.
    for (const other of demo.state.entitiesOf('adversary')) if (other.id !== husk.id) other.alive = false;
    const hitPoints = party.map((p) => p.hitPoints.marked);

    endTurn(demo);
    const walked = demo.grid.euclideanDistance(from, husk.tile);
    expect(walked).toBeGreaterThan(DEMO_BAND_TILES.close);
    expect(nearest(husk.tile)).toBeLessThan(nearest(from));
    // The walk was the action: nobody it reached was struck by it.
    expect(party.map((p) => p.hitPoints.marked)).toEqual(hitPoints);
  });
});

describe('the party is built from content, not written down', () => {
  it('derives every sheet against the vendored SRD with no issues', () => {
    const demo = build();
    // Against what the demo is played with: the pack, plus whatever the project brings of its own.
    const content = characterContentFor(demo.project);
    expect(demo.characters.size).toBe(PARTY_SHEETS.length);
    for (const sheet of PARTY_SHEETS) {
      expect(content.classes.has(sheet.classId)).toBe(true);
      expect(content.armors.has(sheet.armorId!)).toBe(true);
      expect(content.weapons.has(sheet.primaryWeaponId!)).toBe(true);
      expect(content.ancestries.has(sheet.ancestryId!)).toBe(true);
    }
  });

  it('takes each character Hit Points and Armor Slots from their class and armor', () => {
    const demo = build();
    for (const [id, character] of demo.characters) {
      const klass = DEMO_CHARACTERS.classes.get(character.sheet.classId)!;
      const armor = DEMO_CHARACTERS.armors.get(character.sheet.armorId!)!;
      const entity = demo.state.entity(id)!;

      expect(entity.hitPoints.max).toBe(klass.startingHitPoints);
      // The pool is built from the derived score, which a class feature and a
      // held card both add to -- not from the armour's bare number.
      expect(entity.armorSlots.max).toBe(character.armorScore);
      expect(entity.stress.max).toBe(6);
      expect(entity.good!.value).toBe(2);
      // Level 1, so thresholds are the armor's plus one — plus one more for
      // Quim, whose subclass feature raises them.
      const raised = character.sheet.subclassId === 'shieldbearer' ? 1 : 0;
      expect(character.thresholds).toEqual({
        major: armor.baseThresholds.major + 1 + raised,
        severe: armor.baseThresholds.severe + 1 + raised,
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
    const bow = DEMO_CHARACTERS.weapons.get(finn.sheet.primaryWeaponId!)!;
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

    expect(tilesDrawn(view.terrain)).toBe(demo.grid.size);
    expect(view.terrain.meshes.length).toBeLessThanOrEqual(4);
    expect(view.decoCount).toBe(demo.scene.decos.length);
    for (const entity of demo.state.allEntities()) expect(view.tokenFor(entity.id)).toBeDefined();
    // The ground and most of the dressing are shipped files, which are imports: a view handed no
    // asset library has none of them, and everything else the room names is in the procedural one.
    expect(view.registry.missing()).toEqual([
      'banner-prop', 'barrel-prop', 'camp-fire-prop', 'cart-prop', 'chest-prop', 'crate-prop', 'dirt-ground', 'door-prop', 'grass-ground',
      'pillar-prop', 'portal-prop', 'rock-prop', 'standing-torch-prop', 'stone-block', 'stone-stairs', 'stone-wall', 'training-dummy-prop', 'tree-prop', 'withering-tree-prop',
    ]);
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
