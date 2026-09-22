/**
 * A room growing under a game that is being played in it: everybody stays where they were,
 * what they left open stays open, and the tiles that made it grow are somewhere to go.
 */

import { describe, expect, it } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { EditorController } from '../editor/controller';
import { EditorSession } from '../editor/session';
import { gridFromScene, paletteForProject } from '../engine/scene/grid-from-scene';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { planJump } from './leap';
import { takeGround } from './room';

/** The demo with an editor over its document, holding a platform. */
function table(): { demo: DemoScene; session: EditorSession; lay: (x: number, y: number) => boolean } {
  const demo = buildDemoScene(hollowVaultMap(), 'grow');
  const session = new EditorSession(demo.project);
  const editor = new EditorController({ session, sceneId: demo.scene.id });
  editor.setTool('placeTile');
  editor.set('tileId', 'platform');
  const lay = (x: number, y: number): boolean => {
    editor.begin({ x, y });
    editor.end();
    return takeGround(demo, demo.scene, demo.grid, gridFromScene(demo.scene, paletteForProject(demo.project)).grid);
  };
  return { demo, session, lay };
}

describe('the room growing under the party', () => {
  it('takes ordinary ground into the grid everybody already holds', () => {
    const { demo, lay } = table();
    const grid = demo.grid;
    expect(lay(5, 5)).toBe(true);
    expect(demo.grid).toBe(grid);
  });

  it('stands the game up again on a bigger grid, with everybody where they were', () => {
    const { demo, lay } = table();
    demo.party.select('mira');
    demo.state.placeEntity('kara', 4.3, 6.2);
    const before = Object.fromEntries(demo.party.members().map((id) => [id, { ...demo.state.entity(id)!.at }]));
    const marked = demo.state.entity('kara')!.hitPoints.marked;
    demo.state.entity('kara')!.hitPoints.marked = marked + 1;
    const width = demo.grid.width;

    // Two tiles west of the west edge: the room grows by two, and the corner moves.
    expect(lay(-2, 6)).toBe(false);
    expect(demo.grid.width).toBe(width + 2);
    expect(demo.grid.origin).toEqual({ x: 2, y: 0 });
    expect(demo.scene.width).toBe(width + 2);
    for (const id of demo.party.members()) {
      const entity = demo.state.entity(id)!;
      expect(entity.at).toEqual({ x: before[id]!.x + 2, y: before[id]!.y });
      expect(entity.tile).toBe(demo.grid.tileAtSpot(entity.at.x, entity.at.y));
    }
    // The same game: her wound came with her, and so did who was selected.
    expect(demo.state.entity('kara')!.hitPoints.marked).toBe(marked + 1);
    expect(demo.party.selected).toBe('mira');
    // The pathfinder is the new room's: a walk along the old floor still works, at its new numbers.
    expect(demo.party.reachable('kara', { inCombat: false }).canReach(demo.grid.indexOf(10, 6))).toBe(true);
  });

  it('makes the tiles laid outside somewhere to go: nothing between is a gap, and a gap is jumped', () => {
    const { demo, lay } = table();
    lay(-2, 6);
    const { grid } = demo;
    const platform = grid.indexOf(0, 6);
    const gap = grid.indexOf(1, 6);
    const edge = grid.indexOf(2, 6);
    expect(grid.isPassable(platform)).toBe(true);
    expect(grid.isPassable(gap)).toBe(false);
    demo.party.select('kara');
    demo.state.moveEntity('kara', edge);
    expect(demo.party.reachable('kara', { inCombat: false }).canReach(platform)).toBe(false);
    expect(planJump(demo, 'kara', platform)).not.toBeNull();
    expect(planJump(demo, 'kara', gap)).toBeNull();
  });

  it('keeps a door where it was and as it was left', () => {
    const { demo, lay } = table();
    const door = demo.scene.interactables.find((thing) => thing.kind === 'door' && thing.blocksMovement)!;
    const at = { ...door.position };
    expect(demo.grid.isTile(demo.grid.indexOf(at.x, at.y))).toBe(true);
    const shut = demo.state.blockedFor('kara', ['party']);
    expect(shut(demo.grid.indexOf(at.x, at.y))).toBe(true);
    lay(-1, -1);
    const moved = demo.scene.interactables.find((thing) => thing.id === door.id)!.position;
    expect(moved).toMatchObject({ x: at.x + 1, y: at.y + 1 });
    const still = demo.state.blockedFor('kara', ['party']);
    expect(still(demo.grid.indexOf(moved.x, moved.y))).toBe(true);
    expect(still(demo.grid.indexOf(at.x, at.y))).toBe(false);
  });

  it('goes back when the growth is undone, and whoever was standing on it goes to where the party comes in', () => {
    const { demo, session, lay } = table();
    const home = { ...demo.state.entity('finn')!.at };
    lay(-1, 6);
    demo.state.moveEntity('kara', demo.grid.indexOf(0, 6));
    session.undo();
    expect(takeGround(demo, demo.scene, demo.grid, gridFromScene(demo.scene, paletteForProject(demo.project)).grid)).toBe(false);
    expect(demo.grid.origin).toEqual({ x: 0, y: 0 });
    expect(demo.state.entity('finn')!.at).toEqual(home);
    const spawn = demo.scene.spawns[0]!;
    expect(demo.state.entity('kara')!.tile).toBe(demo.grid.indexOf(spawn.x, spawn.y));
  });
});
