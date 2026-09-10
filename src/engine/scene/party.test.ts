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

describe('walking to a spot', () => {
  it('stops where it was sent, on the tile that spot lies in, along a straight line', () => {
    const { grid, party, state } = setup();
    const walk = party.walkTo('kara', grid.indexOf(5, 1), { at: { x: 5.3, y: 0.8 } })!;
    expect(walk.path[0]).toBe(grid.indexOf(0, 1));
    expect(walk.path.at(-1)).toBe(grid.indexOf(5, 1));
    expect(state.entity('kara')!.at).toEqual({ x: 5.3, y: 0.8 });
    expect(state.entity('kara')!.tile).toBe(grid.indexOf(5, 1));
    // Open floor: one leg, from where she stood to where she stopped.
    expect(walk.route).toEqual([
      { x: 0, y: 1 },
      { x: 5.3, y: 0.8 },
    ]);
  });

  it('stops short of a spot where its body would not fit, and at the centre with no aim', () => {
    const { grid, party, state } = setup(['..........', '..........', '.....#....']);
    // Aimed at the edge of the tile above the wall, body over the wall.
    party.walkTo('kara', grid.indexOf(5, 1), { at: { x: 5, y: 1.4 } });
    const at = state.entity('kara')!.at;
    expect(at.x).toBe(5);
    expect(at.y).toBeLessThan(1.4);
    expect(at.y).toBeGreaterThan(1);
    expect(state.entity('kara')!.tile).toBe(grid.indexOf(5, 1));
    party.walkTo('kara', grid.indexOf(7, 1));
    expect(state.entity('kara')!.at).toEqual({ x: 7, y: 1 });
  });

  it('keeps clear of somebody already standing near the spot', () => {
    const { grid, party, state } = setup();
    state.moveEntity('finn', grid.indexOf(6, 1));
    party.walkTo('kara', grid.indexOf(5, 1), { at: { x: 5.4, y: 1 } });
    const at = state.entity('kara')!.at;
    expect(Math.hypot(at.x - 6, at.y - 1)).toBeGreaterThanOrEqual(0.7);
    expect(state.entity('kara')!.tile).toBe(grid.indexOf(5, 1));
  });

  it('bends round a wall and walks straight where it can', () => {
    const { grid, party } = setup(['..........', '.#######..', '..........']);
    party.select('mira');
    const walk = party.walkTo('mira', grid.indexOf(9, 0))!;
    expect(walk.route.length).toBeGreaterThanOrEqual(3);
    expect(walk.route.length).toBeLessThan(walk.path.length);
    expect(walk.route[0]).toEqual({ x: 0, y: 2 });
    expect(walk.route.at(-1)).toEqual({ x: 9, y: 0 });
  });

  it('lines the followers up along the walk', () => {
    const { grid, party, state } = setup();
    // A diagonal walk: the trail's centres lie off the straight line.
    state.moveEntity('finn', grid.indexOf(1, 0));
    state.moveEntity('mira', grid.indexOf(0, 0));
    state.moveEntity('kara', grid.indexOf(0, 0 + 2));
    const walk = party.walkTo('kara', grid.indexOf(6, 0))!;
    expect(walk.route).toHaveLength(2);
    const spots = party.follow('kara', walk.path, walk.route);
    const [a, b] = [walk.route[0]!, walk.route[1]!];
    const offLine = (spot: { x: number; y: number }): number =>
      Math.abs((b.x - a.x) * (spot.y - a.y) - (b.y - a.y) * (spot.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    const backOf = (spot: { x: number; y: number }): number => Math.hypot(b.x - spot.x, b.y - spot.y);
    const kara = state.entity('kara')!;
    for (const id of ['finn', 'mira']) {
      const follower = state.entity(id)!;
      // On the line, off any centre, counted on the tile the spot lies in, and reported.
      expect(offLine(follower.at)).toBeLessThan(1e-9);
      expect(follower.at).not.toEqual(grid.spotOf(follower.tile));
      expect(grid.tileAtSpot(follower.at.x, follower.at.y)).toBe(follower.tile);
      expect(spots.get(id)).toBe(follower.tile);
      expect(follower.tile).not.toBe(kara.tile);
      // Nobody stands on anybody.
      expect(Math.hypot(follower.at.x - kara.at.x, follower.at.y - kara.at.y)).toBeGreaterThanOrEqual(0.7);
    }
    // One behind the other: a tile's length apart along the line.
    const backs = ['finn', 'mira'].map((id) => backOf(state.entity(id)!.at)).sort((x, y) => x - y);
    expect(backs[0]).toBeCloseTo(1, 6);
    expect(backs[1]).toBeCloseTo(2, 6);
  });

  it('falls back to the trail for whoever the line has no room for', () => {
    const { grid, party, state } = setup();
    // A walk of one tile: room for one on the line, the other claims the trail.
    const walk = party.walkTo('kara', grid.indexOf(1, 1))!;
    const spots = party.follow('kara', walk.path, walk.route);
    expect(spots.size).toBe(2);
    const tiles = [...spots.values()];
    expect(new Set(tiles).size).toBe(2);
    for (const [id, tile] of spots) expect(state.entity(id)!.tile).toBe(tile);
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
