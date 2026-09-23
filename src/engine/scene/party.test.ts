import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import { Pathfinder } from '../grid/pathfinding';
import { segmentClear } from '../grid/walk';
import { chainSpans } from '../../game/ui/party-chain';
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

  it('hands each follower the line they cross, round the same corner as the leader', () => {
    const { grid, party, state } = setup(['..........', '.#######..', '..........']);
    party.select('mira');
    const before = Object.fromEntries(['kara', 'finn'].map((id) => [id, { ...state.entity(id)!.at }]));
    const walk = party.walkTo('mira', grid.indexOf(9, 0))!;
    const walks = party.followAlong('mira', walk.path, walk.route);
    expect(walks.size).toBe(2);
    for (const [id, w] of walks) {
      const follower = state.entity(id)!;
      expect(w.route[0]).toEqual(before[id]);
      expect(w.route.at(-1)).toEqual(follower.at);
      expect(w.path.at(-1)).toBe(follower.tile);
      // Nothing crosses the wall: every leg is clear on its own.
      for (let i = 0; i + 1 < w.route.length; i++) expect(segmentClear(grid, w.route[i]!, w.route[i + 1]!)).toBe(true);
    }
  });

  it('seats whoever the trail reaches, and leaves the rest standing', () => {
    const { grid, party, state } = setup();
    const stood = Object.fromEntries(['finn', 'mira'].map((id) => [id, state.entity(id)!.tile]));
    // A walk of one tile: one place behind the leader, so one follower takes it.
    const walk = party.walkTo('kara', grid.indexOf(1, 1))!;
    const spots = party.follow('kara', walk.path, walk.route);
    expect(spots.size).toBe(1);
    for (const [id, tile] of spots) expect(state.entity(id)!.tile).toBe(tile);
    // Whoever the trail did not reach is where they were, not shuffled to a free tile nearby.
    for (const id of ['finn', 'mira']) if (!spots.has(id)) expect(state.entity(id)!.tile).toBe(stood[id]);
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

  it('grows the trail over several walks, until it seats the whole party', () => {
    const { grid, party, state } = setup();
    // One step: the trail is a tile long, which is one place.
    party.moveTo('kara', grid.indexOf(1, 1));
    expect(party.follow('kara', [grid.indexOf(0, 1), grid.indexOf(1, 1)]).size).toBeLessThanOrEqual(1);
    // Step by step, the ground behind the leader adds up and the second follower falls in.
    let spots = new Map<string, number>();
    for (let x = 2; x <= 5; x++) {
      const path = party.moveTo('kara', grid.indexOf(x, 1))!;
      spots = party.follow('kara', path);
    }
    expect(spots.size).toBe(2);
    expect(new Set([...spots.values()]).size).toBe(2);
    for (const tile of spots.values()) expect(tile).not.toBe(state.entity('kara')!.tile);
  });

  it('sends a follower who has been left far behind to catch up', () => {
    const { grid, party, state } = setup();
    state.moveEntity('mira', grid.indexOf(9, 2));
    state.placeEntity('mira', 9, 2);
    for (let x = 1; x <= 5; x++) party.follow('kara', party.moveTo('kara', grid.indexOf(x, 1))!);
    // Far enough that no trail reaches her: she is walked towards the leader rather than left.
    expect(grid.euclideanDistance(state.entity('mira')!.tile, state.entity('kara')!.tile)).toBeLessThan(6);
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

describe('groups', () => {
  it('start as one: everybody walks with everybody', () => {
    const { party } = setup();
    expect(party.groupOf('kara')).toEqual(['kara', 'finn', 'mira']);
    expect(party.linked('kara', 'mira')).toBe(true);
    expect(party.groupOf('husk')).toEqual([]);
    expect(party.linked('kara', 'husk')).toBe(false);
  });

  it('unlinks a member to walk alone, and only their own group follows a leader', () => {
    const { grid, party, state } = setup();
    expect(party.unlink('mira')).toBe(true);
    expect(party.unlink('mira')).toBe(false); // already alone
    expect(party.groupOf('mira')).toEqual(['mira']);
    expect(party.groupOf('kara')).toEqual(['kara', 'finn']);
    expect(party.linked('kara', 'mira')).toBe(false);
    const stood = state.entity('mira')!.tile;
    const walk = party.walkTo('kara', grid.indexOf(6, 1))!;
    const followed = party.follow('kara', walk.path, walk.route);
    expect([...followed.keys()]).toEqual(['finn']);
    expect(state.entity('mira')!.tile).toBe(stood);
    // Walking the one alone moves nobody else.
    const walked = party.walkTo('mira', grid.indexOf(6, 2))!;
    expect(party.follow('mira', walked.path, walked.route).size).toBe(0);
  });

  it('links a member to another’s group, making groups of any shape', () => {
    const { party } = setup();
    party.unlink('mira');
    party.unlink('finn');
    expect(party.groupOf('kara')).toEqual(['kara']);
    expect(party.link('finn', 'mira')).toBe(true);
    expect(party.groupOf('mira')).toEqual(['finn', 'mira']);
    expect(party.link('finn', 'mira')).toBe(false); // already together
    expect(party.link('kara', 'kara')).toBe(false);
    expect(party.link('kara', 'nobody')).toBe(false);
    expect(party.link('nobody', 'kara')).toBe(false);
    // Back to one party.
    expect(party.link('kara', 'finn')).toBe(true);
    expect(party.groupOf('kara')).toEqual(['kara', 'finn', 'mira']);
  });

  it('walks the followers round somebody left standing on the trail, rather than onto them', () => {
    const { grid, party, state } = setup();
    // Scarlet is left in the corridor the others walk down: a tile short of where Quim stops, where Violet would fall in.
    party.unlink('mira');
    state.moveEntity('mira', grid.indexOf(7, 1));
    state.moveEntity('finn', grid.indexOf(0, 1));
    state.moveEntity('kara', grid.indexOf(1, 1));
    const walk = party.walkTo('kara', grid.indexOf(8, 1))!;
    party.follow('kara', walk.path, walk.route);
    const mira = state.entity('mira')!;
    const finn = state.entity('finn')!;
    expect(mira.tile).toBe(grid.indexOf(7, 1));
    expect(finn.tile).not.toBe(mira.tile);
    expect(Math.hypot(finn.at.x - mira.at.x, finn.at.y - mira.at.y)).toBeGreaterThanOrEqual(0.7);
    // And the old way of claiming a trail tile, with no line to stand along, keeps clear of her too.
    state.moveEntity('finn', grid.indexOf(0, 1));
    const claimed = party.follow('kara', [grid.indexOf(5, 1), grid.indexOf(6, 1), grid.indexOf(7, 1), grid.indexOf(8, 1)]);
    expect(claimed.get('finn')).not.toBe(mira.tile);
  });

  it('is read in the order it is arranged in, and Tab follows it', () => {
    const { party } = setup();
    expect(party.arrange('mira', 'kara')).toBe(true);
    expect(party.members()).toEqual(['mira', 'kara', 'finn']);
    expect(party.arrange('mira', 'kara')).toBe(false); // already there
    expect(party.arrange('kara', null)).toBe(true);
    expect(party.members()).toEqual(['mira', 'finn', 'kara']);
    expect(party.living()).toEqual(['mira', 'finn', 'kara']);
    expect(party.arrange('kara', 'kara')).toBe(false);
    expect(party.arrange('nobody', 'kara')).toBe(false);
    expect(party.arrange('kara', 'nobody')).toBe(false);
    party.select('finn');
    expect(party.selectNext()).toBe('kara');
    expect(party.selectNext()).toBe('mira');
  });

  it('lifts somebody out of the middle of the group they leave, so the rest stay side by side', () => {
    const { party } = setup();
    // Quim, Violet, Scarlet, all walking together: the middle one steps out.
    expect(party.members()).toEqual(['kara', 'finn', 'mira']);
    expect(party.unlink('finn')).toBe(true);
    // They go above the group rather than staying in the hole they left.
    expect(party.members()).toEqual(['finn', 'kara', 'mira']);
    // And the two still together are next to each other, which is what the chain is drawn between.
    expect(party.groupOf('kara')).toEqual(['kara', 'mira']);
    expect(chainSpans(party.members().map((id) => ({ id, group: party.groupOf(id).length > 1 ? 0 : null })))).toEqual([
      { group: 0, from: 'kara', to: 'mira' },
    ]);
  });

  it('moves nobody when the one leaving is at either end of the group', () => {
    const { party } = setup();
    expect(party.unlink('kara')).toBe(true); // the top
    expect(party.members()).toEqual(['kara', 'finn', 'mira']);
    party.link('kara', 'finn');
    expect(party.unlink('mira')).toBe(true); // the foot
    expect(party.members()).toEqual(['kara', 'finn', 'mira']);
  });

  it('closes ranks the same way when the middle one joins somebody else', () => {
    const { grid, state, party } = setup();
    state.addEntity(createPartyEntity('rook', 'warden', grid.indexOf(5, 1)));
    party.unlink('rook');
    expect(party.link('finn', 'rook')).toBe(true);
    // Violet left the middle of the first group, so they go above it and the rest close up.
    expect(party.members()).toEqual(['finn', 'kara', 'mira', 'rook']);
    expect(party.groupOf('kara')).toEqual(['kara', 'mira']);
  });

  it('refuses to unlink the last of a group of one, and leaves the fallen where they are', () => {
    const { party, state } = setup();
    party.unlink('kara');
    expect(party.unlink('kara')).toBe(false);
    expect(party.unlink('nobody')).toBe(false);
    state.entity('finn')!.alive = false;
    expect(party.groupOf('mira')).toEqual(['finn', 'mira']); // the group is who they are, alive or not
  });
});

describe('a walk interrupted part-way through', () => {
  it('stands the character on the ground they had got to, not where they were going', () => {
    const { state, grid, party } = setup();
    party.select('kara');
    party.walkTo('kara', grid.indexOf(8, 1));
    // The document is already at the end of it: the walk resolved when it was ordered, and the
    // gliding is only the drawing of it. This is the state a second click arrives in.
    expect(state.entity('kara')!.at.x).toBeCloseTo(8, 6);

    expect(party.landAt('kara', { x: 3.4, y: 1 })).toBe(true);
    expect(state.entity('kara')!.at).toEqual({ x: 3.4, y: 1 });
    expect(state.entity('kara')!.tile).toBe(grid.indexOf(3, 1));
  });

  it('refuses ground nobody can stand on, so a landing cannot put somebody inside a wall', () => {
    const { party } = setup(['..........', '..###.....', '..........']);
    expect(party.landAt('kara', { x: 3, y: 1 })).toBe(false);
    expect(party.landAt('nobody', { x: 1, y: 1 })).toBe(false);
  });

  it('cuts the trail back, so the others do not queue along ground nobody walked', () => {
    const { grid, party } = setup();
    party.select('kara');
    const walk = party.walkTo('kara', grid.indexOf(9, 1))!;
    for (const [follower, walked] of party.followAlong('kara', walk.path, walk.route)) {
      const end = walked.route[walked.route.length - 1]!;
      party.landAt(follower, end);
    }
    // Everybody is put down where they had got to, which is what the app does on a second click.
    party.landAt('kara', { x: 4, y: 1 });

    // The trail is the leader's own history, and its head is where they are now. Anything ahead
    // of it was handed over when the first walk was ordered and never actually crossed, so no
    // follower may be seated out there: they all end up behind the leader, not in front.
    const next = party.walkTo('kara', grid.indexOf(6, 1))!;
    const behind = party.followAlong('kara', next.path, next.route);
    expect(behind.size).toBeGreaterThan(0);
    for (const [, walked] of behind) {
      expect(walked.route[walked.route.length - 1]!.x).toBeLessThanOrEqual(6.001);
    }
  });
});

describe('a walk planned from somewhere other than the document', () => {
  it('starts the line where the body is, not where the last walk was sent', () => {
    const { state, grid, party } = setup();
    party.select('kara');
    party.walkTo('kara', grid.indexOf(9, 1));
    expect(state.entity('kara')!.at.x).toBeCloseTo(9, 6);

    const plain = party.planWalk('kara', grid.indexOf(9, 2))!;
    const live = party.planWalk('kara', grid.indexOf(9, 2), { from: { x: 2, y: 1 } })!;
    expect(plain.route[0]!.x).toBeCloseTo(9, 6);
    expect(live.route[0]!).toEqual({ x: 2, y: 1 });
    // And it is a longer line, because it is drawn from further away - which is the whole point.
    expect(live.route.length).toBeGreaterThanOrEqual(2);
  });

  it('reads a click on the tile they are standing on as a step, not a journey', () => {
    const { grid, party } = setup();
    party.select('kara');
    party.walkTo('kara', grid.indexOf(9, 1));
    // From (2,1), the tile at (2,1) is under their feet: that is a shuffle within the tile.
    const walk = party.planWalk('kara', grid.indexOf(2, 1), { from: { x: 2.2, y: 1 }, at: { x: 2.4, y: 1.2 } })!;
    expect(walk).not.toBeNull();
    expect(walk.path.length).toBeLessThanOrEqual(2);
  });

  it('searches the ground from there too, so reach is measured from the body', () => {
    const { grid, party } = setup();
    party.select('kara');
    const far = party.reachable('kara', { inCombat: true, from: { x: 8, y: 1 } });
    expect(far.canReach(grid.indexOf(8, 1))).toBe(true);
    expect(far.canReach(grid.indexOf(0, 1))).toBe(false);
  });
});
