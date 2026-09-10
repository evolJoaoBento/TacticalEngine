/**
 * Party control: who the player is moving, and where everyone else goes.
 *
 * A CRPG is a party game, and the two halves of that are selection (which
 * character a click commands) and following (what the rest do while you walk
 * around out of combat). BG3 does both; the legacy prototype did a conga line
 * behind the leader and no selection at all.
 *
 * Both are engine concerns rather than UI ones, because both have to be
 * deterministic and both are the same in a replay as in a session.
 */

import { NO_TILE, type Spot, type TileGrid } from '../grid/grid';
import { DEFAULT_MOVEMENT, Pathfinder, tracePath, type MovementContext, type MovementRules } from '../grid/pathfinding';
import { DEFAULT_WALK, canStandAt, lineLength, pointAlong, settleEnd, smoothPath, type WalkRules } from '../grid/walk';
import { DEFAULT_BAND_TILES } from '../rules/range';
import type { EntityState, Faction, SceneState } from './state';

/** Factions a party member walks through rather than around, out of combat. */
export const PARTY_PASSES_THROUGH: readonly Faction[] = ['party'];

export interface PartyOptions {
  /**
   * How far a member may move in a fight as part of an action, in tiles
   * along the walk: the SRD's "within Close range", spent the way BG3 spends
   * movement - along the path actually taken, so a walk round a pillar costs
   * the way round, and marsh costs what marsh costs.
   */
  combatReach?: number;
  /**
   * Movement points a member may spend on one walk out of a fight. Nobody
   * counts steps out of a fight, so this is `Infinity` unless a project wants a
   * leash; it also caps how far a follower searches for a spot.
   */
  moveBudget?: number;
  followerBudget?: number;
  /** How far behind the leader a follower tries to stay. */
  followDistance?: number;
  /** The movement rules every member walks by; the engine's default is four-way. */
  rules?: MovementRules;
  /** How wide a member's body is, for the line it walks and where it can stop. */
  walk?: WalkRules;
}

/** A walk: the tiles the pathfinder took, and the line the creature actually crosses. */
export interface Walk {
  path: number[];
  route: Spot[];
}

export const DEFAULT_PARTY_OPTIONS: Required<PartyOptions> = {
  combatReach: DEFAULT_BAND_TILES.close,
  moveBudget: Infinity,
  followerBudget: 60,
  followDistance: 1,
  rules: DEFAULT_MOVEMENT,
  walk: DEFAULT_WALK,
};

/**
 * The party in a scene.
 *
 * Selection is by id and survives a member falling — a fallen character stays
 * selected so a UI can still show their sheet — but `canCommand` reports that
 * they cannot be told to do anything.
 */
export class Party {
  private readonly state: SceneState;
  private readonly grid: TileGrid;
  private readonly pathfinder: Pathfinder;
  private readonly options: Required<PartyOptions>;
  private selectedId: string | null = null;

  constructor(state: SceneState, pathfinder: Pathfinder, options: PartyOptions = {}) {
    this.state = state;
    this.grid = state.grid;
    this.pathfinder = pathfinder;
    this.options = { ...DEFAULT_PARTY_OPTIONS, ...options };
    this.selectedId = this.members()[0] ?? null;
  }

  /** Every party member, in scene order. */
  members(): string[] {
    return this.state.entitiesOf('party').map((e) => e.id);
  }

  /** Members still standing. */
  living(): string[] {
    return this.state.entitiesOf('party').filter((e) => e.alive).map((e) => e.id);
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** Select a member. Returns false for anyone who is not one. */
  select(id: string): boolean {
    const entity = this.state.entity(id);
    if (entity === undefined || entity.faction !== 'party') return false;
    this.selectedId = id;
    return true;
  }

  /**
   * Select the next living member, wrapping — the Tab key in every CRPG.
   * Returns the new selection, or null when nobody is standing.
   */
  selectNext(): string | null {
    const living = this.living();
    if (living.length === 0) return null;
    const at = this.selectedId === null ? -1 : living.indexOf(this.selectedId);
    this.selectedId = living[(at + 1) % living.length]!;
    return this.selectedId;
  }

  /** Whether the selected member can be given an order. */
  canCommand(id = this.selectedId): boolean {
    if (id === null) return false;
    const entity = this.state.entity(id);
    return entity !== undefined && entity.faction === 'party' && entity.alive;
  }

  /** The movement context for one member — occupancy, minus themselves. */
  movementFor(id: string, inCombat: boolean): MovementContext {
    // Out of combat allies are transparent, so the party does not jam itself in a
    // corridor; in combat everything blocks, which is what makes position matter.
    const passThrough = inCombat ? [] : PARTY_PASSES_THROUGH;
    return { rules: this.options.rules, isBlocked: this.state.blockedFor(id, passThrough) };
  }

  /**
   * Tiles a member can reach, for a movement preview. In a fight that is the
   * Close-range disc round them; out of one, everywhere the floor goes. An
   * explicit `budget` bounds either by steps, for a rule that counts them.
   */
  reachable(id: string, options: { inCombat?: boolean; budget?: number } = {}) {
    const entity = this.state.entity(id);
    const from = entity?.tile ?? NO_TILE;
    const fighting = options.inCombat === true;
    const budget = options.budget ?? (fighting ? this.options.combatReach : this.options.moveBudget);
    return this.pathfinder.reachable(from, budget, this.movementFor(id, fighting));
  }

  /**
   * Walk a member to a tile.
   *
   * Returns the path taken, or null when the tile is out of reach. State is
   * updated immediately — the engine's truth never waits on an animation, and a
   * caller animates along the returned path.
   */
  moveTo(
    id: string,
    destination: number,
    options: { inCombat?: boolean; budget?: number; at?: Spot } = {},
  ): number[] | null {
    return this.walkTo(id, destination, options)?.path ?? null;
  }

  /**
   * Walk a member to a tile, and to a spot in it when one is aimed at: the
   * path the pathfinder took and the line the creature crosses - straight
   * wherever nothing is in the way, ending at the spot if a body fits there
   * clear of everyone else, and as near it as one does otherwise.
   */
  walkTo(
    id: string,
    destination: number,
    options: { inCombat?: boolean; budget?: number; at?: Spot } = {},
  ): Walk | null {
    const walk = this.planWalk(id, destination, options);
    if (walk === null) return null;
    const end = walk.route[walk.route.length - 1]!;
    this.state.placeEntity(id, end.x, end.y);
    return walk;
  }

  /** The walk `walkTo` would make, without making it: what a hover draws on the ground. */
  planWalk(
    id: string,
    destination: number,
    options: { inCombat?: boolean; budget?: number; at?: Spot } = {},
  ): Walk | null {
    if (!this.canCommand(id)) return null;
    const entity = this.state.entity(id)!;
    const field = this.reachable(id, options);
    if (!field.canReach(destination)) return null;
    const path = tracePath(field, destination);
    if (path === null || path.length < 2) return null;
    const start = { ...entity.at };
    const end = this.settle(id, destination, options.at, options.inCombat === true);
    return { path, route: this.lineAlong(id, path, start, end, options.inCombat === true) };
  }

  /** Where a walk to a tile ends, given the spot it was aimed at, if any. */
  private settle(id: string, tile: number, aimed: Spot | undefined, inCombat: boolean): Spot {
    if (aimed === undefined) return this.grid.spotOf(tile);
    const others = this.state
      .allEntities()
      .filter((e) => e.id !== id && e.alive && e.tile !== NO_TILE)
      .map((e) => e.at);
    return settleEnd(this.grid, tile, aimed, this.blockedForWalk(id, inCombat), others, this.walkRules());
  }

  /** The line a member crosses along a path, from where it stood to where it ends. */
  lineAlong(id: string, path: readonly number[], start: Spot, end: Spot, inCombat: boolean): Spot[] {
    return smoothPath(this.grid, path, this.blockedForWalk(id, inCombat), this.walkRules(), { start, end });
  }

  private walkRules(): WalkRules {
    return { ...this.options.walk, maxStepHeight: this.options.rules.maxStepHeight };
  }

  /** What a walking body must keep clear of: the same as the pathfinder, less the mover. */
  private blockedForWalk(id: string, inCombat: boolean): (tile: number) => boolean {
    return this.movementFor(id, inCombat).isBlocked ?? (() => false);
  }

  /**
   * Where the rest of the party should stand after the leader has moved.
   *
   * Followers claim tiles along the leader's own trail, nearest-first, which is
   * what makes a party read as a line rather than a swarm; anyone who cannot get
   * a trail tile falls back to the closest free tile near the leader. Ordering is
   * by current distance to the leader and then by id, so the result is the same
   * on every run.
   */
  followPositions(
    leaderId: string,
    leaderPath: readonly number[],
    already: ReadonlyMap<string, number> = new Map(),
  ): Map<string, number> {
    const result = new Map<string, number>();
    const leader = this.state.entity(leaderId);
    if (leader === undefined) return result;

    const followers = this.followersOf(leaderId).filter((e) => !already.has(e.id));
    if (followers.length === 0) return result;

    // The trail, closest-behind first, skipping the tile the leader now holds.
    const trail = [...leaderPath].reverse().slice(this.options.followDistance);
    const taken = new Set<number>([leader.tile, ...already.values()]);

    for (const follower of followers) {
      const spot =
        this.claimFrom(trail, taken, follower.id) ?? this.claimNear(leader.tile, taken, follower.id);
      if (spot === NO_TILE || spot === null) continue;
      taken.add(spot);
      result.set(follower.id, spot);
    }
    return result;
  }

  /**
   * Move every follower to where they should stand behind the leader.
   *
   * Given the line the leader walked, each stands on it, a tile further back
   * than the one before, so the party lines up along the walk rather than
   * snapping to the centres of squares; whoever the line has no room for -
   * it was short, or hugs a wall - claims a trail tile the old way.
   */
  follow(leaderId: string, leaderPath: readonly number[], route?: readonly Spot[]): Map<string, number> {
    return new Map([...this.followAlong(leaderId, leaderPath, route)].map(([id, walk]) => [id, walk.path[walk.path.length - 1]!]));
  }

  /**
   * `follow`, handing back each follower's own walk: the tiles from where
   * they stood to where they stand now, and the line they cross - round the
   * same corner the leader went round, not through the wall.
   */
  followAlong(leaderId: string, leaderPath: readonly number[], route?: readonly Spot[]): Map<string, Walk> {
    const along = route === undefined ? new Map<string, { tile: number; at: Spot }>() : this.alongTheLine(leaderId, route);
    const positions = this.followPositions(leaderId, leaderPath, new Map([...along].map(([id, s]) => [id, s.tile])));
    const goals = new Map<string, { tile: number; at: Spot }>();
    for (const [id, tile] of positions) goals.set(id, { tile, at: this.grid.spotOf(tile) });
    for (const [id, goal] of along) goals.set(id, goal);

    const walks = new Map<string, Walk>();
    for (const [id, { tile, at }] of goals) {
      const follower = this.state.entity(id);
      if (follower === undefined) continue;
      const stood = { ...follower.at };
      const context = this.movementFor(id, false);
      const path = tracePath(this.pathfinder.reachable(follower.tile, Infinity, context), tile) ?? [follower.tile, tile];
      const line = smoothPath(this.grid, path, context.isBlocked ?? (() => false), this.walkRules(), { start: stood, end: at });
      this.state.moveEntity(id, tile);
      this.state.placeEntity(id, at.x, at.y);
      walks.set(id, { path, route: line });
    }
    return walks;
  }

  /** The living members other than the leader, nearest the leader first, then by id. */
  private followersOf(leaderId: string): EntityState[] {
    const leader = this.state.entity(leaderId);
    if (leader === undefined) return [];
    return this.state
      .entitiesOf('party')
      .filter((e) => e.alive && e.id !== leaderId)
      .sort(
        (a, b) =>
          this.grid.manhattanDistance(a.tile, leader.tile) -
            this.grid.manhattanDistance(b.tile, leader.tile) || a.id.localeCompare(b.id),
      );
  }

  /**
   * Where along the leader's line each follower stands: a tile's length back
   * for the first, two for the next, and so on, skipping any spot a body does
   * not fit or that is already somebody's. A follower the line runs out for is
   * left out, for `followPositions` to place.
   */
  private alongTheLine(leaderId: string, route: readonly Spot[]): Map<string, { tile: number; at: Spot }> {
    const result = new Map<string, { tile: number; at: Spot }>();
    const leader = this.state.entity(leaderId);
    if (leader === undefined || route.length < 2) return result;
    const length = lineLength(route);
    const spacing = Math.max(this.options.followDistance, 2 * this.options.walk.radius + 0.05);
    const taken = new Set<number>([leader.tile]);
    let back = spacing;
    for (const follower of this.followersOf(leaderId)) {
      const blocked = this.blockedForWalk(follower.id, false);
      let found: { tile: number; at: Spot } | null = null;
      while (back <= length + 1e-9) {
        const at = pointAlong(route, length - back);
        back += spacing;
        const tile = this.grid.tileAtSpot(at.x, at.y);
        if (taken.has(tile) || !canStandAt(this.grid, at, blocked, this.walkRules())) continue;
        found = { tile, at };
        break;
      }
      if (found === null) break;
      taken.add(found.tile);
      result.set(follower.id, found);
    }
    return result;
  }

  private claimFrom(trail: readonly number[], taken: Set<number>, moverId: string): number | null {
    const blocked = this.state.blockedFor(moverId, PARTY_PASSES_THROUGH);
    for (const tile of trail) {
      if (taken.has(tile)) continue;
      if (!this.grid.isPassable(tile) || blocked(tile)) continue;
      return tile;
    }
    return null;
  }

  /** The nearest free tile to the leader, for a follower with no trail left. */
  private claimNear(leaderTile: number, taken: Set<number>, moverId: string): number | null {
    const field = this.pathfinder.reachable(leaderTile, this.options.followerBudget, {
      rules: this.options.rules,
      isBlocked: this.state.blockedFor(moverId, PARTY_PASSES_THROUGH),
    });
    let best: number | null = null;
    let bestCost = Infinity;
    for (const tile of field.tiles()) {
      if (tile === leaderTile || taken.has(tile)) continue;
      const cost = field.costTo(tile);
      if (cost < bestCost) {
        bestCost = cost;
        best = tile;
      }
    }
    return best;
  }
}
