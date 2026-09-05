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

import { NO_TILE, type TileGrid } from '../grid/grid';
import { Pathfinder, tracePath, type MovementContext } from '../grid/pathfinding';
import type { Faction, SceneState } from './state';

/** Factions a party member walks through rather than around, out of combat. */
export const PARTY_PASSES_THROUGH: readonly Faction[] = ['party'];

export interface PartyOptions {
  /**
   * Movement points a member spends per move. Out of combat the legacy prototype
   * gave the leader `speed + 4` and followers an effectively unlimited budget so
   * they could catch up; the same shape is kept here.
   */
  moveBudget?: number;
  followerBudget?: number;
  /** How far behind the leader a follower tries to stay. */
  followDistance?: number;
}

export const DEFAULT_PARTY_OPTIONS: Required<PartyOptions> = {
  moveBudget: 8,
  followerBudget: 60,
  followDistance: 1,
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
    return { isBlocked: this.state.blockedFor(id, passThrough) };
  }

  /** Tiles a member can reach, for a movement preview. */
  reachable(id: string, options: { inCombat?: boolean; budget?: number } = {}) {
    const entity = this.state.entity(id);
    const from = entity?.tile ?? NO_TILE;
    const budget = options.budget ?? this.options.moveBudget;
    return this.pathfinder.reachable(from, budget, this.movementFor(id, options.inCombat === true));
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
    options: { inCombat?: boolean; budget?: number } = {},
  ): number[] | null {
    if (!this.canCommand(id)) return null;
    const field = this.reachable(id, options);
    if (!field.canReach(destination)) return null;
    const path = tracePath(field, destination);
    if (path === null || path.length < 2) return null;
    this.state.moveEntity(id, destination);
    return path;
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
  followPositions(leaderId: string, leaderPath: readonly number[]): Map<string, number> {
    const result = new Map<string, number>();
    const leader = this.state.entity(leaderId);
    if (leader === undefined) return result;

    const followers = this.state
      .entitiesOf('party')
      .filter((e) => e.alive && e.id !== leaderId)
      .sort(
        (a, b) =>
          this.grid.manhattanDistance(a.tile, leader.tile) -
            this.grid.manhattanDistance(b.tile, leader.tile) || a.id.localeCompare(b.id),
      );
    if (followers.length === 0) return result;

    // The trail, closest-behind first, skipping the tile the leader now holds.
    const trail = [...leaderPath].reverse().slice(this.options.followDistance);
    const taken = new Set<number>([leader.tile]);

    for (const follower of followers) {
      const spot =
        this.claimFrom(trail, taken, follower.id) ?? this.claimNear(leader.tile, taken, follower.id);
      if (spot === NO_TILE || spot === null) continue;
      taken.add(spot);
      result.set(follower.id, spot);
    }
    return result;
  }

  /** Move every follower to where `followPositions` puts them. */
  follow(leaderId: string, leaderPath: readonly number[]): Map<string, number> {
    const positions = this.followPositions(leaderId, leaderPath);
    for (const [id, tile] of positions) this.state.moveEntity(id, tile);
    return positions;
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
