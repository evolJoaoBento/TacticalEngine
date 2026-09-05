/**
 * Fidelity test: import the *real* legacy campaign, not a hand-written fixture.
 *
 * `legacy/js/data.js` imports nothing and `legacy/js/data-campaign.js` imports
 * only `makeEnemy` from it, so both load under Vitest in node without three.js or
 * the DOM — which means the three one-shot maps and the demo map can be imported
 * as they actually ship. Between them they cover every shape the research
 * catalogued: walls, difficult terrain, cover, elevation up to 6, editor nodes
 * with checks and outcomes, scripted nodes, enemies in groups, a trigger, decos
 * with rotations and narrative ids, multiple spawns and a fog band.
 *
 * `legacy/` is never modified — see docs/CONTEXT.md.
 */

import { describe, it, expect } from 'vitest';
import { demoMap, makeCampaign, type LegacyMapDoc } from '../../legacy/js/data.js';
import { campMap, pitMap, theaterMap } from '../../legacy/js/data-campaign.js';
import { NO_TILE } from '../../src/engine/grid/grid';
import { Pathfinder } from '../../src/engine/grid/pathfinding';
import { gridFromScene, tileOf } from '../../src/engine/scene/grid-from-scene';
import {
  WALL_HEIGHT,
  importLegacyCampaign,
  importLegacyScene,
} from '../../src/engine/scene/legacy-import';
import { projectSchema, sceneSchema } from '../../src/engine/scene/schema';
import { createPartyEntity, sceneStateFromScene } from '../../src/engine/scene/state';

const legacyScenes: [string, () => LegacyMapDoc][] = [
  ['camp', campMap],
  ['pit', pitMap],
  ['theater', theaterMap],
  ['demo', demoMap],
];

describe('every shipped legacy map imports cleanly', () => {
  it.each(legacyScenes)('%s imports with no issues and validates', (_name, build) => {
    const { scene, issues } = importLegacyScene(build());
    expect(issues).toEqual([]);
    const parsed = sceneSchema.safeParse(scene);
    // The error is printed on failure, which names the offending field.
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it.each(legacyScenes)('%s keeps its size, tiles and content counts', (_name, build) => {
    const legacy = build();
    const { scene } = importLegacyScene(legacy);
    expect(scene!.width).toBe(legacy.w);
    expect(scene!.height).toBe(legacy.h);
    expect(scene!.terrain).toHaveLength(legacy.w * legacy.h);
    expect(scene!.heights).toHaveLength(legacy.w * legacy.h);
    expect(scene!.interactables).toHaveLength(legacy.nodes.length);
    expect(scene!.decos).toHaveLength(legacy.decos.length);

    const placed = scene!.encounters.reduce((n, e) => n + e.adversaries.length, 0);
    expect(placed).toBe(legacy.enemies.length);
  });

  it.each(legacyScenes)('%s gives every piece of content a unique stable id', (_name, build) => {
    const scene = importLegacyScene(build()).scene!;
    const ids = [
      ...scene.interactables.map((i) => i.id),
      ...scene.encounters.map((e) => e.id),
      ...scene.encounters.flatMap((e) => e.adversaries.map((a) => a.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);

    // Re-importing the same document must produce byte-identical output.
    expect(importLegacyScene(build()).scene).toEqual(scene);
  });
});

describe('terrain conversion against the real maps', () => {
  it('turns exactly the wall-height tiles into walls', () => {
    for (const [, build] of legacyScenes) {
      const legacy = build();
      const scene = importLegacyScene(legacy).scene!;
      legacy.tiles.forEach((tile, i) => {
        const expected =
          tile.h >= WALL_HEIGHT
            ? 'wall'
            : tile.prop === 'difficult'
              ? 'difficult'
              : tile.prop === 'cover'
                ? 'cover'
                : 'floor';
        expect(scene.terrain[i]).toBe(expected);
      });
    }
  });

  it('loses no elevation', () => {
    for (const [, build] of legacyScenes) {
      const legacy = build();
      const scene = importLegacyScene(legacy).scene!;
      expect(scene.heights).toEqual(legacy.tiles.map((t) => t.h));
    }
  });

  it('covers walls, difficult terrain, cover and elevation across the set', () => {
    const seen = new Set<string>();
    let maxHeight = 0;
    for (const [, build] of legacyScenes) {
      const scene = importLegacyScene(build()).scene!;
      for (const id of scene.terrain) seen.add(id);
      maxHeight = Math.max(maxHeight, ...scene.heights);
    }
    expect([...seen].sort()).toEqual(['cover', 'difficult', 'floor', 'wall']);
    expect(maxHeight).toBe(6);
  });

  /**
   * The legacy format had no passability flag: a tile was a wall only because
   * `|dh| <= 1` made it unreachable. Turning `h >= 4` into impassable terrain is
   * therefore a semantic change — but only if some wall tile was in fact
   * reachable. This asserts that none ever was, on the real content, which is
   * what makes the conversion behaviour-preserving rather than merely plausible.
   */
  it('never makes a tile impassable that the legacy rules could actually reach', () => {
    for (const [name, build] of legacyScenes) {
      const legacy = build();
      for (let y = 0; y < legacy.h; y++) {
        for (let x = 0; x < legacy.w; x++) {
          const tile = legacy.tiles[y * legacy.w + x]!;
          if (tile.h < WALL_HEIGHT) continue;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= legacy.w || ny >= legacy.h) continue;
            const neighbour = legacy.tiles[ny * legacy.w + nx]!;
            if (neighbour.h >= WALL_HEIGHT) continue;
            expect(
              Math.abs(neighbour.h - tile.h),
              `${name}: wall at (${x}, ${y}) was steppable from (${nx}, ${ny})`,
            ).toBeGreaterThan(1);
          }
        }
      }
    }
  });
});

describe('imported scenes drive the grid and the pathfinder', () => {
  it.each(legacyScenes)('%s builds a grid with no unknown terrain', (_name, build) => {
    const scene = importLegacyScene(build()).scene!;
    const { grid, issues } = gridFromScene(scene);
    expect(issues).toEqual([]);
    expect(grid.size).toBe(scene.width * scene.height);
  });

  it('can path from a spawn across the demo map', () => {
    const scene = importLegacyScene(demoMap()).scene!;
    const { grid } = gridFromScene(scene);
    const pathfinder = new Pathfinder(grid);
    const start = tileOf(grid, scene.spawns[0]!);

    const field = pathfinder.reachable(start, Infinity);
    const reachable = field.tiles();
    // The demo map is a connected vault, so most of it is walkable from a spawn.
    expect(reachable.length).toBeGreaterThan(grid.size / 4);
    // And every wall stays out of reach.
    for (const tile of reachable) expect(grid.isPassable(tile)).toBe(true);
  });

  it('stands a full scene up and gates the vault behind its door', () => {
    // The whole chain: legacy document -> SceneDoc -> TileGrid -> SceneState ->
    // pathfinding with real occupancy, which is the seam combat will sit on.
    //
    // The demo map is a sealed vault: a solid wall at x = 12 with a single door
    // at (12, 7). Every enemy, the chest and the pillar are behind it, so "can
    // the party reach the fight" is a question about the door, not the terrain —
    // which is exactly what a scene state has to model and a bare grid cannot.
    const scene = importLegacyScene(demoMap()).scene!;
    const { grid } = gridFromScene(scene);

    // The demo map fields Hollow Husks, the prototype's homebrew: no SRD stat
    // block exists for them, so a project has to supply one.
    const husk = { id: 'hollow-husk', hitPoints: 5, stress: 3 };
    const { state, issues } = sceneStateFromScene(scene, grid, {
      adversaries: new Map([[husk.id, husk]]),
      party: [createPartyEntity('kara', 'sentinel', -1)],
    });
    expect(issues).toEqual([]);

    const placements = scene.encounters.flatMap((e) => e.adversaries);
    expect(placements.length).toBe(3);
    expect(state.entitiesOf('adversary')).toHaveLength(placements.length);

    const kara = state.entity('kara')!;
    expect(kara.tile).toBe(tileOf(grid, scene.spawns[0]!));

    const pathfinder = new Pathfinder(grid);
    const door = scene.interactables.find((i) => i.kind === 'door')!;
    const doorTile = tileOf(grid, door.position);

    // Closed: an adversary's own tile is held, and none can even be approached.
    const shut = pathfinder.reachable(kara.tile, Infinity, {
      isBlocked: state.blockedFor('kara'),
    });
    expect(shut.canReach(doorTile)).toBe(false);
    for (const placement of placements) {
      const tile = tileOf(grid, placement.position);
      expect(state.blockedFor('kara')(tile)).toBe(true);
      expect(pathfinder.nearestReachableAdjacentTo(shut, tile)).toBe(NO_TILE);
    }

    // Opened: the same query, the same grid, one line of state changed.
    state.interactable(door.id).open = true;
    state.setInteractableBlocking(doorTile, false);
    const opened = pathfinder.reachable(kara.tile, Infinity, {
      isBlocked: state.blockedFor('kara'),
    });
    expect(opened.canReach(doorTile)).toBe(true);
    for (const placement of placements) {
      const tile = tileOf(grid, placement.position);
      expect(
        pathfinder.nearestReachableAdjacentTo(opened, tile),
        `${placement.id} at (${placement.position.x}, ${placement.position.y}) cannot be approached`,
      ).not.toBe(NO_TILE);
    }
  });

  it('makes difficult terrain cost more to cross', () => {
    const scene = importLegacyScene(demoMap()).scene!;
    const { grid } = gridFromScene(scene);
    const difficult = scene.terrain.indexOf('difficult');
    expect(difficult).toBeGreaterThanOrEqual(0);
    expect(grid.costAt(difficult)).toBe(2);
  });
});

describe('the whole one-shot as a project', () => {
  const campaign = makeCampaign([campMap(), pitMap(), theaterMap()], "The Conductor's Stage");

  it('imports into a project that validates', () => {
    const { project, issues } = importLegacyCampaign(campaign);
    expect(issues).toEqual([]);
    const parsed = projectSchema.safeParse(project);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('keeps all three scenes, in order, with unique ids', () => {
    const { project } = importLegacyCampaign(campaign);
    // Phase 3 reuses the campaign's own title as its map name.
    expect(project!.scenes.map((s) => s.name)).toEqual([
      'The Quiet Camp',
      'The Pit',
      "The Conductor's Stage",
    ]);
    expect(project!.startScene).toBe(project!.scenes[0]!.id);
    expect(new Set(project!.scenes.map((s) => s.id)).size).toBe(3);
  });

  it('carries the one-shot content the research catalogued', () => {
    const { project } = importLegacyCampaign(campaign);
    const [camp, pit, theater] = project!.scenes;

    // Phase 1: four bodies to inhabit, and the fog wall.
    const bodies = camp!.interactables.filter((i) => i.tags.includes('heroKey'));
    expect(bodies).toHaveLength(4);
    expect(bodies.map((b) => b.data['heroKey']).sort()).toEqual([
      'battleMage',
      'defender',
      'frostMage',
      'knight',
    ]);
    expect(camp!.fogBand).toBe(2);

    // Phase 2: the arena fight, as a triggered encounter of Tangle Brambles.
    const arena = pit!.encounters.find((e) => e.adversaries.length > 0)!;
    expect(arena.adversaries.every((a) => a.adversary === 'tangle-bramble')).toBe(true);
    expect(arena.triggerCells.length).toBeGreaterThan(0);

    // Phase 3: the spotlight pillars and the hidden cranks.
    expect(theater!.interactables.filter((i) => i.tags.includes('pillar')).length).toBe(4);
    expect(theater!.interactables.filter((i) => i.tags.includes('crank')).length).toBe(4);
  });

  it('holds no runtime state in the document', () => {
    const { project } = importLegacyCampaign(campaign);
    const forbidden = ['open', 'used', 'fired', 'lit', 'inserted', 'found', 'hp'];
    for (const scene of project!.scenes) {
      for (const interactable of scene.interactables) {
        for (const key of forbidden) {
          expect(Object.keys(interactable)).not.toContain(key);
          expect(Object.keys(interactable.data)).not.toContain(key);
        }
      }
    }
  });

  it('survives a JSON round trip unchanged', () => {
    const { project } = importLegacyCampaign(campaign);
    const roundTripped = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(roundTripped).toEqual(project);
  });
});
