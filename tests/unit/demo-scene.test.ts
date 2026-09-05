/**
 * The demo the page draws, asserted without a page.
 *
 * `game/demo-scene.ts` deliberately holds no renderer, camera or event handler,
 * so the thing the browser shows can be checked here — and an e2e failure means
 * the browser, not the scene.
 */

import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { NO_TILE } from '../../src/engine/grid/grid';
import { SceneView } from '../../src/engine/render/scene-view';
import { instanceCount } from '../../src/engine/render/terrain-mesh';
import { tileOf } from '../../src/engine/scene/grid-from-scene';
import {
  DEMO_ADVERSARY_ID,
  DEMO_MOVE_BUDGET,
  SRD_ADVERSARIES,
  buildDemoScene,
  moveLeaderTo,
  reachableTiles,
} from '../../src/game/demo-scene';

const build = () => buildDemoScene(demoMap());

describe('the demo scene', () => {
  it('imports the legacy vault and stands it up', () => {
    const demo = build();
    expect(demo.scene.width).toBe(22);
    expect(demo.scene.height).toBe(16);
    expect(demo.grid.size).toBe(22 * 16);
    expect(demo.state.entity(demo.leaderId)).toBeDefined();
  });

  it('reads its adversaries from the vendored SRD data', () => {
    const burrower = SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
    expect(burrower.name).toBe('Acid Burrower');
    expect(SRD_ADVERSARIES.size).toBe(129);

    const demo = build();
    const adversaries = demo.state.entitiesOf('adversary');
    expect(adversaries.length).toBe(
      demo.scene.encounters.reduce((n, e) => n + e.adversaries.length, 0),
    );
    for (const a of adversaries) expect(a.hitPoints.max).toBe(burrower.hitPoints);
  });

  it('seats the party on the scene spawn points', () => {
    const demo = build();
    const spawnTiles = demo.scene.spawns.map((p) => tileOf(demo.grid, p));
    for (const member of demo.state.entitiesOf('party')) {
      expect(spawnTiles).toContain(member.tile);
    }
  });

  it('opens the vault door so there is somewhere to walk', () => {
    const demo = build();
    const door = demo.scene.interactables.find((i) => i.kind === 'door')!;
    const doorTile = tileOf(demo.grid, door.position);
    expect(demo.state.interactable(door.id).open).toBe(true);
    expect(demo.state.blockedFor(demo.leaderId)(doorTile)).toBe(false);
    expect(reachableTiles(demo, 40).canReach(doorTile)).toBe(true);
  });

  it('keeps the movement preview inside the budget and off the walls', () => {
    const demo = build();
    const field = reachableTiles(demo);
    const tiles = field.tiles();

    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThan(demo.grid.size);
    for (const tile of tiles) {
      expect(demo.grid.isPassable(tile)).toBe(true);
      expect(field.costTo(tile)).toBeLessThanOrEqual(DEMO_MOVE_BUDGET);
    }
  });

  it('walks the leader to a reachable tile and reports the path', () => {
    const demo = build();
    const start = demo.state.entity(demo.leaderId)!.tile;
    const destination = reachableTiles(demo)
      .tiles()
      .filter((t) => t !== start)
      .pop()!;

    const result = moveLeaderTo(demo, destination);
    expect(result.moved).toBe(true);
    expect(result.path[0]).toBe(start);
    expect(result.path[result.path.length - 1]).toBe(destination);
    for (let i = 1; i < result.path.length; i++) {
      expect(demo.grid.manhattanDistance(result.path[i - 1]!, result.path[i]!)).toBe(1);
    }
    expect(demo.state.entity(demo.leaderId)!.tile).toBe(destination);
  });

  it('refuses a move out of reach, and changes nothing', () => {
    const demo = build();
    const start = demo.state.entity(demo.leaderId)!.tile;
    const reachable = new Set(reachableTiles(demo).tiles());
    const unreachable = [...Array(demo.grid.size).keys()].find((t) => !reachable.has(t))!;

    expect(moveLeaderTo(demo, unreachable)).toEqual({ moved: false, path: [] });
    expect(demo.state.entity(demo.leaderId)!.tile).toBe(start);
    expect(moveLeaderTo(demo, NO_TILE).moved).toBe(false);
  });

  it('moves the preview with the leader', () => {
    const demo = build();
    const before = reachableTiles(demo).tiles();
    const destination = before.filter((t) => t !== demo.state.entity(demo.leaderId)!.tile).pop()!;
    moveLeaderTo(demo, destination);
    const after = reachableTiles(demo).tiles();
    expect(after).toContain(destination);
    expect(after).not.toEqual(before);
  });
});

describe('the demo renders', () => {
  it('draws 352 tiles in a handful of draw calls', () => {
    const demo = build();
    const view = new SceneView(demo.grid, { tints: demo.scene.tints });
    view.syncTokens(demo.state);

    expect(instanceCount(view.terrain)).toBe(demo.grid.size);
    // One instanced mesh per terrain type present, not one per tile.
    expect(view.terrain.meshes.length).toBeLessThanOrEqual(4);
    for (const entity of demo.state.allEntities()) {
      expect(view.tokenFor(entity.id)).toBeDefined();
    }
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
