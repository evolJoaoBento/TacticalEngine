import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import { Pathfinder } from '../grid/pathfinding';
import { Party } from './party';
import { SceneState, createAdversaryEntity, createPartyEntity } from './state';

function makeGrid(rows: string[]): TileGrid {
  const grid = new TileGrid({ width: rows[0]!.length, height: rows.length });
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      if (char === '#') grid.setTerrainById(grid.indexOf(x, y), 'wall');
    });
  });
  return grid;
}

function setup(rows = ['..........', '..........', '..........']): {
  state: SceneState;
  grid: TileGrid;
  party: Party;
} {
  const grid = makeGrid(rows);
  const state = new SceneState({ id: 'room' }, grid);
  state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(0, 1)));
  state.addEntity(createPartyEntity('finn', 'nightwalker', grid.indexOf(0, 0)));
  state.addEntity(createPartyEntity('mira', 'seer', grid.indexOf(0, 2)));
  return { state, grid, party: new Party(state, new Pathfinder(grid)) };
}

describe('selection', () => {
  it('starts on the first member', () => {
    const { party } = setup();
    expect(party.members()).toEqual(['kara', 'finn', 'mira']);
    expect(party.selected).toBe('kara');
  });

  it('selects by id and refuses anyone who is not in the party', () => {
    const { state, grid, party } = setup();
    state.addEntity(createAdversaryEntity('husk', 'husk', grid.indexOf(5, 1), { hitPoints: 3, stress: 2 }));
    expect(party.select('mira')).toBe(true);
    expect(party.selected).toBe('mira');
    expect(party.select('husk')).toBe(false);
    expect(party.select('nobody')).toBe(false);
    expect(party.selected).toBe('mira');
  });

  it('cycles through the living, wrapping around', () => {
    const { party } = setup();
    expect(party.selectNext()).toBe('finn');
    expect(party.selectNext()).toBe('mira');
    expect(party.selectNext()).toBe('kara');
  });

  it('skips the fallen when cycling', () => {
    const { state, party } = setup();
    state.entity('finn')!.alive = false;
    expect(party.selectNext()).toBe('mira');
  });

  it('keeps a fallen member selected but refuses to command them', () => {
    const { state, party } = setup();
    state.entity('kara')!.alive = false;
    expect(party.selected).toBe('kara');
    expect(party.canCommand()).toBe(false);
    expect(party.canCommand('finn')).toBe(true);
  });

  it('reports no selection when the whole party is down', () => {
    const { state, party } = setup();
    for (const id of party.members()) state.entity(id)!.alive = false;
    expect(party.selectNext()).toBeNull();
    expect(party.living()).toEqual([]);
  });
});

describe('movement', () => {
  it('walks a member to a tile in reach and reports the path', () => {
    const { grid, party, state } = setup();
    const destination = grid.indexOf(3, 1);
    const path = party.moveTo('kara', destination)!;
    expect(path[0]).toBe(grid.indexOf(0, 1));
    expect(path.at(-1)).toBe(destination);
    expect(state.entity('kara')!.tile).toBe(destination);
  });

  it('refuses a tile out of reach and changes nothing', () => {
    const { grid, party, state } = setup();
    const start = state.entity('kara')!.tile;
    expect(party.moveTo('kara', grid.indexOf(9, 2), { budget: 2 })).toBeNull();
    expect(state.entity('kara')!.tile).toBe(start);
  });

  it('refuses to command a fallen member', () => {
    const { grid, state, party } = setup();
    state.entity('kara')!.alive = false;
    expect(party.moveTo('kara', grid.indexOf(2, 1))).toBeNull();
  });

  it('lets allies be walked through out of combat and not in it', () => {
    // A corridor one tile wide, with finn standing in the way.
    const { grid, state, party } = setup(['###########', '...........', '###########']);
    state.moveEntity('kara', grid.indexOf(0, 1));
    state.moveEntity('finn', grid.indexOf(1, 1));
    state.moveEntity('mira', grid.indexOf(9, 1));

    const past = grid.indexOf(4, 1);
    expect(party.reachable('kara', { inCombat: false }).canReach(past)).toBe(true);
    expect(party.reachable('kara', { inCombat: true }).canReach(past)).toBe(false);
  });

  it('never walks through an adversary, in or out of combat', () => {
    const { grid, state, party } = setup(['###########', '...........', '###########']);
    state.moveEntity('kara', grid.indexOf(0, 1));
    state.moveEntity('finn', grid.indexOf(9, 1));
    state.moveEntity('mira', grid.indexOf(8, 1));
    state.addEntity(createAdversaryEntity('husk', 'husk', grid.indexOf(2, 1), { hitPoints: 3, stress: 2 }));
    expect(party.reachable('kara', { inCombat: false }).canReach(grid.indexOf(4, 1))).toBe(false);
  });
});

describe('following', () => {
  it('strings the followers out along the leader trail', () => {
    const { grid, party, state } = setup();
    const path = party.moveTo('kara', grid.indexOf(5, 1))!;
    const spots = party.follow('kara', path);

    // Both followers land on the trail, behind the leader, on distinct tiles.
    expect(spots.size).toBe(2);
    const tiles = [...spots.values()];
    expect(new Set(tiles).size).toBe(2);
    for (const tile of tiles) {
      expect(path).toContain(tile);
      expect(tile).not.toBe(state.entity('kara')!.tile);
    }
    // And the state agrees with what was reported.
    for (const [id, tile] of spots) expect(state.entity(id)!.tile).toBe(tile);
  });

  it('orders followers by who is closest to the leader', () => {
    const { grid, state, party } = setup();
    state.moveEntity('finn', grid.indexOf(9, 0)); // far
    state.moveEntity('mira', grid.indexOf(1, 1)); // near

    const path = party.moveTo('kara', grid.indexOf(5, 1))!;
    const spots = party.follow('kara', path);
    const leaderTile = state.entity('kara')!.tile;

    // The nearer follower gets the tile closest behind the leader.
    const miraDistance = grid.manhattanDistance(spots.get('mira')!, leaderTile);
    const finnDistance = grid.manhattanDistance(spots.get('finn')!, leaderTile);
    expect(miraDistance).toBeLessThanOrEqual(finnDistance);
  });

  it('falls back to a tile near the leader when the trail is too short', () => {
    const { grid, party, state } = setup();
    // One step: the trail cannot seat two followers.
    const path = party.moveTo('kara', grid.indexOf(1, 1))!;
    expect(path).toHaveLength(2);
    const spots = party.follow('kara', path);

    expect(spots.size).toBe(2);
    for (const tile of spots.values()) {
      expect(grid.isPassable(tile)).toBe(true);
      expect(tile).not.toBe(state.entity('kara')!.tile);
    }
    expect(new Set([...spots.values()]).size).toBe(2);
  });

  it('leaves the fallen where they lie', () => {
    const { grid, state, party } = setup();
    state.entity('mira')!.alive = false;
    const resting = state.entity('mira')!.tile;
    const path = party.moveTo('kara', grid.indexOf(4, 1))!;
    const spots = party.follow('kara', path);
    expect(spots.has('mira')).toBe(false);
    expect(state.entity('mira')!.tile).toBe(resting);
  });

  it('does nothing when there is nobody to follow', () => {
    const grid = makeGrid(['.....']);
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', 0));
    const party = new Party(state, new Pathfinder(grid));
    const path = party.moveTo('kara', 3)!;
    expect(party.follow('kara', path).size).toBe(0);
  });

  it('is deterministic', () => {
    const run = (): string => {
      const { grid, party } = setup();
      const path = party.moveTo('kara', grid.indexOf(6, 1))!;
      return JSON.stringify([...party.follow('kara', path)].sort());
    };
    expect(run()).toBe(run());
  });
});
