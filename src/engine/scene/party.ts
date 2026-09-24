/**
 * Party control: who the player is moving, and where everyone else goes.
 *
 * A CRPG is a party game, and the two halves of that are selection (which
 * character a click commands) and following (what the rest do while you walk
 * around out of combat). BG3 does both; the legacy prototype did a conga line
 * behind the leader and no selection at all. Who follows is a matter of groups:
 * the party walks as one until a member is unlinked, and then only their own
 * group comes along, as BG3's portraits chain and unchain.
 *
 * Both are engine concerns rather than UI ones, because both have to be
 * deterministic and both are the same in a replay as in a session.
 */

import { NO_TILE, type Spot, type TileGrid } from '../grid/grid';
import { DEFAULT_MOVEMENT, Pathfinder, tracePath, type MovementContext, type MovementRules, type ReachableField } from '../grid/pathfinding';
import { DEFAULT_WALK, canStandAt, segmentClear, distanceInside, distanceWithin, insideCircle, lineCost, lineLength, pointAlong, settleEnd, smoothPath, splitLine, type Circle, type WalkRules } from '../grid/walk';
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
  /** How far back a leader's trail is remembered, in tiles, for followers to walk down. */
  trailLength?: number;
  /** The movement rules every member walks by; the engine's default is four-way. */
  rules?: MovementRules;
  /** How wide a member's body is, for the line it walks and where it can stop. */
  walk?: WalkRules;
}

/** A walk: the tiles the pathfinder took, and the line the creature actually crosses. */
export interface Walk {
  path: number[];
  route: Spot[];
  /** A walk cut short where the allowance ran out: the rest of the line, to where it was going. */
  beyond?: Spot[];
}

/** What a walk may be asked for. */
export interface WalkOptions {
  inCombat?: boolean;
  budget?: number;
  at?: Spot;
  /**
   * Where the walk begins, when that is not where the character's document says they are.
   *
   * A figure part-way through a walk is between two tiles: the document has already put them at
   * the end of it, because the walk resolved the moment it was ordered and the gliding is only
   * the drawing of it. A new walk ordered before the old one finishes starts from the ground the
   * figure is actually standing on, and so does the line drawn for it, or the two disagree and
   * the preview is a promise the walk does not keep.
   */
  from?: Spot;
  /**
   * A circle the whole walk must stay inside - the ground a fighter moves freely in this
   * spotlight. A walk that would leave it is refused, or with `short` cut where it crosses the
   * edge. The budget still applies as well, where a project counts one.
   */
  within?: Circle;
  /**
   * Go as far as the allowance does when it does not cover the way, rather than not at all:
   * the walk stops on the line where the movement ran out - to a fraction of a tile, not at
   * the last whole square - and says what was left.
   */
  short?: boolean;
}

/** How much further than its allowance a search looks for ground the straighter line might still cover. */
const WIDER = 1.1;
const ROUND_THE_ENDS = 1.5;
/** How finely a walk cut short is backed up to somewhere a body can stand, in tiles. */
const BACK_OFF = 0.1;
/** The least a walk can be, in tiles: a click nearer their feet than this is a click on them, not a step. */
export const LEAST_STEP = 0.05;

export const DEFAULT_PARTY_OPTIONS: Required<PartyOptions> = {
  combatReach: DEFAULT_BAND_TILES.close,
  moveBudget: Infinity,
  followerBudget: 60,
  followDistance: 1,
  trailLength: 24,
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
  private options: Required<PartyOptions>;
  private selectedId: string | null = null;
  /**
   * Who walks with whom: each member's group. Everybody starts in group 0 - the whole party
   * follows whoever is walked - and `unlink` puts a member in a fresh group of their own, to
   * be left where they stand, or linked to somebody else's group with `link`.
   */
  private readonly groups = new Map<string, number>();
  private nextGroup = 1;
  /**
   * Members held where they are, busy with something else - a conversation set aside while the
   * rest of the party goes on. Still in their group, and still selectable; but they take no order,
   * and the others walk off without them until they are let go.
   */
  private readonly heldIds = new Set<string>();
  /** The order the party is read in, once somebody has been moved in it; scene order until then, and for anyone not named. */
  private order: readonly string[] = [];
  /**
   * The ground each leader has lately covered, newest point first, for their group to walk down.
   *
   * Following is walking where the leader walked, a few paces back - not standing wherever is free
   * near them. Kept as a trail because a walk may be a tenth of a tile long (a held button steers in
   * little steps) and a line that short has no room to space a party along; the trail remembers the
   * ones before it. Trimmed to what the party at its longest needs.
   */
  private readonly trails = new Map<string, Spot[]>();

  /** Walk by other rules from here on: a project's house rule for a step changed under a party already standing. */
  setRules(rules: MovementRules): void {
    this.options = { ...this.options, rules };
  }

  constructor(state: SceneState, pathfinder: Pathfinder, options: PartyOptions = {}) {
    this.state = state;
    this.grid = state.grid;
    this.pathfinder = pathfinder;
    this.options = { ...DEFAULT_PARTY_OPTIONS, ...options };
    this.selectedId = this.members()[0] ?? null;
  }

  /** Every party member, in the party's order: as arranged, and in scene order until then. */
  members(): string[] {
    const ids = this.state.entitiesOf('party').map((e) => e.id);
    // Ranked before the sort, not from the array being sorted: anyone unnamed keeps their scene place, after those named.
    const scene = new Map(ids.map((id, i) => [id, i]));
    const rank = (id: string): number => { const at = this.order.indexOf(id); return at === -1 ? this.order.length + scene.get(id)! : at; };
    return ids.sort((a, b) => rank(a) - rank(b));
  }

  /** Members still standing, in the party's order. */
  living(): string[] {
    return this.members().filter((id) => this.state.entity(id)!.alive);
  }

  /** Put a member before another in the party's order, or last with nobody named. False when nothing moves, or either is no member. */
  arrange(id: string, before: string | null): boolean {
    const members = this.members();
    if (!members.includes(id) || (before !== null && !members.includes(before)) || id === before) return false;
    const rest = members.filter((other) => other !== id);
    const at = before === null ? rest.length : rest.indexOf(before);
    const order = [...rest.slice(0, at), id, ...rest.slice(at)];
    if (order.every((other, i) => other === members[i])) return false;
    this.order = order;
    return true;
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

  /** The members who walk with this one, themselves included, in scene order; just them for anybody who is not a member. */
  groupOf(id: string): string[] {
    const group = this.groupIndex(id);
    return group === null ? [] : this.members().filter((other) => this.groupIndex(other) === group);
  }

  /** Whether two members walk together. */
  linked(id: string, withId: string): boolean {
    const group = this.groupIndex(id);
    return group !== null && group === this.groupIndex(withId);
  }

  /** Put a member in a group of their own: the others walk on without them. False when they already walk alone, or are no member. */
  unlink(id: string): boolean {
    if (this.groupIndex(id) === null || this.groupOf(id).length === 1) return false;
    const left = this.groupOf(id);
    this.groups.set(id, this.nextGroup++);
    this.closeRanks(id, left);
    return true;
  }

  /** Have a member walk with another's group, leaving their own. False when they already do, or either is no member. */
  link(id: string, withId: string): boolean {
    const group = this.groupIndex(withId);
    if (group === null || this.groupIndex(id) === null || id === withId || this.linked(id, withId)) return false;
    const left = this.groupOf(id);
    this.groups.set(id, group);
    this.closeRanks(id, left);
    return true;
  }

  /**
   * Lift somebody out of the middle of the group they have just left.
   *
   * Who walks with whom is read off the cards, and the chain that says so is only drawn between
   * cards standing side by side. Somebody stepping out from the middle of a group would leave the
   * ones still together on either side of the hole they left - chained in two pieces, or in none -
   * which reads as the group breaking up when it has not. So the one leaving goes above the group
   * instead, and the rest close up behind them. Leaving from either end splits nothing, and moves
   * nobody.
   */
  private closeRanks(id: string, left: readonly string[]): void {
    const rest = left.filter((other) => other !== id);
    if (rest.length < 2) return;
    const order = this.members();
    const at = order.indexOf(id);
    const above = rest.some((other) => order.indexOf(other) < at);
    const below = rest.some((other) => order.indexOf(other) > at);
    if (above && below) this.arrange(id, rest[0]!);
  }

  private groupIndex(id: string): number | null {
    const entity = this.state.entity(id);
    if (entity === undefined || entity.faction !== 'party') return null;
    return this.groups.get(id) ?? 0;
  }

  /** Whether the selected member can be given an order: a member, standing, and not held. */
  canCommand(id = this.selectedId): boolean {
    if (id === null) return false;
    const entity = this.state.entity(id);
    return entity !== undefined && entity.faction === 'party' && entity.alive && !this.heldIds.has(id);
  }

  /** Hold a member where they are: no orders, and they do not follow. False for anyone who is no member. */
  hold(id: string): boolean {
    if (this.groupIndex(id) === null) return false;
    this.heldIds.add(id);
    return true;
  }

  /** Let a held member go again. Whether they were held. */
  release(id: string): boolean {
    return this.heldIds.delete(id);
  }

  /** Whether a member is held. */
  isHeld(id: string): boolean {
    return this.heldIds.has(id);
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
  reachable(id: string, options: { inCombat?: boolean; budget?: number; from?: Spot } = {}) {
    const entity = this.state.entity(id);
    const from = options.from === undefined ? entity?.tile ?? NO_TILE : this.grid.tileAtSpot(options.from.x, options.from.y);
    const fighting = options.inCombat === true;
    return this.pathfinder.reachable(from, this.allowance(options), this.movementFor(id, fighting));
  }

  /** How much movement a walk has: Close range in a fight, no count out of one, or what the caller says. */
  private allowance(options: { inCombat?: boolean; budget?: number }): number {
    return options.budget ?? (options.inCombat === true ? this.options.combatReach : this.options.moveBudget);
  }

  /**
   * The ground a member's movement covers, for lighting it: every tile `reachable` counts,
   * and every tile whose centre the *line* reaches though the count of squares says not -
   * movement is spent along the line walked, and the straight way is shorter than the
   * squares under it. Detached: it survives later searches.
   */
  covered(id: string, options: { inCombat?: boolean; budget?: number; within?: Circle } = {}): ReachableField {
    const entity = this.state.entity(id);
    const circle = options.within;
    if (circle !== undefined) {
      // Inside the circle: every reachable tile whose centre is, and whose walk from here stays in it.
      const asked = { ...options, budget: options.budget ?? Infinity };
      const all = this.reachable(id, asked).clone();
      const inside = new Set(all.tiles().filter((tile) => insideCircle(this.grid.spotOf(tile), circle) && (entity === undefined || tile === entity.tile || this.planWalk(id, tile, { ...asked, short: false }) !== null)));
      const field: ReachableField = {
        start: all.start,
        budget: all.budget,
        costTo: (tile) => (inside.has(tile) ? all.costTo(tile) : Infinity),
        canReach: (tile) => inside.has(tile),
        cameFrom: (tile) => all.cameFrom(tile),
        tiles: () => [...inside],
        clone: () => field,
      };
      return field;
    }
    const counted = this.reachable(id, options).clone();
    const allowance = counted.budget;
    if (entity === undefined || !Number.isFinite(allowance) || !this.grid.isTile(entity.tile)) return counted;
    const fighting = options.inCombat === true;
    const wide = this.pathfinder.reachable(entity.tile, allowance * WIDER + ROUND_THE_ENDS, this.movementFor(id, fighting)).clone();
    const more = new Set<number>();
    for (const tile of wide.tiles()) {
      if (counted.canReach(tile)) continue;
      const path = tracePath(wide, tile);
      if (path === null) continue;
      const route = this.lineAlong(id, path, { ...entity.at }, this.grid.spotOf(tile), fighting);
      if (lineCost(this.grid, route) <= allowance + 1e-9) more.add(tile);
    }
    if (more.size === 0) return counted;
    const field: ReachableField = {
      start: counted.start,
      budget: allowance,
      costTo: (tile) => (more.has(tile) ? allowance : counted.costTo(tile)),
      canReach: (tile) => more.has(tile) || counted.canReach(tile),
      cameFrom: (tile) => wide.cameFrom(tile),
      tiles: () => [...counted.tiles(), ...more],
      clone: () => field,
    };
    return field;
  }

  /**
   * Walk a member to a tile.
   *
   * Returns the path taken, or null when the tile is out of reach. State is
   * updated immediately — the engine's truth never waits on an animation, and a
   * caller animates along the returned path.
   */
  moveTo(id: string, destination: number, options: WalkOptions = {}): number[] | null {
    return this.walkTo(id, destination, options)?.path ?? null;
  }

  /**
   * Walk a member to a tile, and to a spot in it when one is aimed at: the
   * path the pathfinder took and the line the creature crosses - straight
   * wherever nothing is in the way, ending at the spot if a body fits there
   * clear of everyone else, and as near it as one does otherwise.
   */
  walkTo(id: string, destination: number, options: WalkOptions = {}): Walk | null {
    const walk = this.planWalk(id, destination, options);
    if (walk === null) return null;
    const end = walk.route[walk.route.length - 1]!;
    this.state.placeEntity(id, end.x, end.y);
    return walk;
  }

  /** The walk `walkTo` would make, without making it: what a hover draws on the ground. */
  planWalk(id: string, destination: number, options: WalkOptions = {}): Walk | null {
    if (!this.canCommand(id)) return null;
    const entity = this.state.entity(id)!;
    const fighting = options.inCombat === true;
    const allowance = this.allowance(options);
    // Where they are standing, which mid-walk is not where the document has already put them.
    const stood = options.from ?? entity.at;
    const stoodOn = options.from === undefined ? entity.tile : this.grid.tileAtSpot(stood.x, stood.y);
    // Movement is spent along the line walked, which is never longer than the squares under
    // it and often shorter: so the way is found without counting, and the line is what is
    // measured. A way the count of squares covers is covered - the line only ever adds.
    if (destination === stoodOn) return this.shuffle(id, options.at, fighting, options.within, options.from);
    const field = this.reachable(id, { ...options, budget: Infinity });
    if (!field.canReach(destination)) return null;
    const counted = field.costTo(destination);
    const path = tracePath(field, destination);
    if (path === null || path.length < 2) return null;
    const start = { ...stood };
    const end = this.settle(id, destination, options.at, fighting);
    const route = this.lineAlong(id, path, start, end, fighting);
    const covered = counted <= allowance || lineCost(this.grid, route) <= allowance + 1e-9;
    const inside = options.within === undefined || route.every((spot) => insideCircle(spot, options.within!)) && distanceInside(route, options.within) >= lineLength(route) - 1e-9;
    if (covered && inside) return { path, route };
    if (options.short !== true) return null;
    // Cut at whichever runs out first: the allowance along the line, or the circle's edge.
    const reach = Math.min(covered ? Infinity : distanceWithin(this.grid, route, allowance), inside ? Infinity : distanceInside(route, options.within!));
    return this.cutShort(id, path, route, reach, fighting);
  }

  /**
   * A step within the tile they are in: half a pace to one side, up to the wall, out of
   * somebody's way. Straight there when a body can cross it and stand at the end clear of
   * everybody; null for no spot aimed at, one under their feet already, or nowhere to stand.
   */
  private shuffle(id: string, aimed: Spot | undefined, fighting: boolean, within?: Circle, stood?: Spot): Walk | null {
    const entity = this.state.entity(id)!;
    // Where they are standing, and the tile that is: mid-walk neither is what the document holds.
    const start = { ...(stood ?? entity.at) };
    const on = stood === undefined ? entity.tile : this.grid.tileAtSpot(stood.x, stood.y);
    if (aimed === undefined || this.grid.tileAtSpot(aimed.x, aimed.y) !== on) return null;
    const end = this.settle(id, on, aimed, fighting);
    if (within !== undefined && !insideCircle(end, within)) return null;
    if (Math.hypot(end.x - start.x, end.y - start.y) < LEAST_STEP) return null;
    if (!segmentClear(this.grid, start, end, this.blockedForWalk(id, fighting), this.walkRules())) return null;
    return { path: [on], route: [start, end] };
  }

  /**
   * A walk the allowance does not cover, as far as it goes: the line cut where the movement
   * runs out, and backed up from there to the first place a body can stand clear of
   * everybody. Null when that is nowhere but where they already are.
   */
  private cutShort(id: string, path: readonly number[], route: readonly Spot[], distance: number, fighting: boolean): Walk | null {
    const blocked = this.blockedForWalk(id, fighting);
    const rules = this.walkRules();
    const others = this.state
      .allEntities()
      .filter((e) => e.id !== id && e.alive && e.tile !== NO_TILE)
      .map((e) => e.at);
    const clear = (spot: Spot): boolean =>
      canStandAt(this.grid, spot, blocked, rules) && others.every((o) => Math.hypot(o.x - spot.x, o.y - spot.y) >= 2 * rules.radius);
    let reach = distance;
    while (reach > BACK_OFF && !clear(pointAlong(route, reach))) reach -= BACK_OFF;
    if (reach <= BACK_OFF) return null;
    const { within, beyond } = splitLine(route, reach);
    const end = within[within.length - 1]!;
    const last = this.grid.tileAtSpot(end.x, end.y);
    // The tiles as far as the one the walk ends in: the path's own, up to whichever of them is nearest the end.
    let nearest = 0;
    let best = Infinity;
    path.forEach((tile, i) => {
      const away = Math.hypot(this.grid.xOf(tile) - end.x, this.grid.yOf(tile) - end.y);
      if (away < best) [nearest, best] = [i, away];
    });
    const walked = path.slice(0, nearest + 1);
    if (walked[walked.length - 1] !== last) walked.push(last);
    if (walked.length < 2) return null;
    return { path: walked, route: within, beyond };
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
    only?: readonly EntityState[],
  ): Map<string, number> {
    const result = new Map<string, number>();
    const leader = this.state.entity(leaderId);
    if (leader === undefined) return result;

    const wanted = only ?? this.followersOf(leaderId);
    const followers = wanted.filter((e) => !already.has(e.id));
    if (followers.length === 0) return result;

    // The trail, closest-behind first, skipping the tile the leader now holds - and anybody
    // left standing on it, who is not walking and is not to be stood on.
    const trail = [...leaderPath].reverse().slice(this.options.followDistance);
    const taken = new Set<number>([leader.tile, ...already.values(), ...this.leftStanding(leaderId).map((e) => e.tile)]);

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
   *
   * Each walks down the leader's trail, a spacing further back than the one in front, so the party
   * reads as a line however the leader was moved - one long click, or a held button steering in
   * steps a tenth of a tile long. Whoever the trail cannot place is left standing rather than put
   * somewhere free nearby, because a follower who hops about is worse than one who waits; only
   * somebody the trail has run away from is sent to catch up.
   */
  followAlong(leaderId: string, leaderPath: readonly number[], route?: readonly Spot[]): Map<string, Walk> {
    const trail = this.remember(leaderId, route ?? leaderPath.map((tile) => this.grid.spotOf(tile)));
    const along = this.downTheTrail(leaderId, trail);
    // Whoever the trail did not reach keeps their ground, with two exceptions: somebody the leader
    // has walked away from, and somebody the leader has walked *into*. A follower standing where
    // the leader is trying to put their feet stops them dead, so that one is sent a pace off.
    const leader = this.state.entity(leaderId)!;
    const underfoot = 2 * this.options.walk.radius + 0.05;
    const adrift = this.followersOf(leaderId).filter((e) => {
      if (along.has(e.id)) return false;
      const near = Math.hypot(e.at.x - leader.at.x, e.at.y - leader.at.y);
      return near < underfoot || this.grid.euclideanDistance(e.tile, leader.tile) > this.options.trailLength;
    });
    const positions = this.followPositions(leaderId, leaderPath, new Map([...along].map(([id, s]) => [id, s.tile])), adrift);
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

  /**
   * Stop a walk where the figure has actually got to: the character stands here now.
   *
   * A walk resolves the instant it is ordered - the document is moved, and the gliding that
   * follows is only the drawing of it - so interrupting one means moving the character back from
   * where they were going to where they had reached. The trail has to come back with them: it was
   * given the whole route at the moment the walk was ordered, and the part past here is ground
   * nobody has crossed, which the followers would otherwise queue up along.
   */
  landAt(id: string, at: Spot): boolean {
    const entity = this.state.entity(id);
    if (entity === undefined) return false;
    const tile = this.grid.tileAtSpot(at.x, at.y);
    if (!this.grid.isTile(tile) || !this.grid.isPassable(tile)) return false;
    this.state.placeEntity(id, at.x, at.y);
    const trail = this.trails.get(id);
    if (trail !== undefined && trail.length > 0) {
      // Newest first, so the ground never walked is at the head: drop it, and stand here instead.
      let nearest = 0;
      let away = Infinity;
      trail.forEach((spot, i) => {
        const gap = Math.hypot(spot.x - at.x, spot.y - at.y);
        if (gap < away) {
          away = gap;
          nearest = i;
        }
      });
      trail.splice(0, nearest);
      if (trail.length === 0 || Math.hypot(trail[0]!.x - at.x, trail[0]!.y - at.y) > 1e-6) trail.unshift({ x: at.x, y: at.y });
    }
    return true;
  }

  /**
   * Take in the ground the leader has just covered, and hand back their trail: newest point first,
   * cut to the length a party needs. A leader who has jumped somewhere - a portal, a script, a new
   * room - starts a fresh trail, since the ground between is not ground they walked.
   */
  private remember(leaderId: string, route: readonly Spot[]): Spot[] {
    const leader = this.state.entity(leaderId);
    if (leader === undefined) return [];
    const trail = this.trails.get(leaderId) ?? [];
    // The line walked where there is one, the tiles crossed where there is not, and where they
    // stand when there is neither: a leader who has not moved still has a trail behind them.
    const walked = route.length < 2 ? [leader.at] : [...route];
    const head = trail[0];
    const start = walked[0]!;
    if (head === undefined || Math.hypot(head.x - start.x, head.y - start.y) > ROUND_THE_ENDS) trail.length = 0;
    // Newest first, and never two points in the same place: a stationary leader must not fill it.
    for (const spot of walked) {
      const first = trail[0];
      if (first !== undefined && Math.hypot(first.x - spot.x, first.y - spot.y) < 1e-6) continue;
      trail.unshift({ ...spot });
    }
    let gone = 0;
    for (let i = 0; i + 1 < trail.length; i++) {
      gone += Math.hypot(trail[i + 1]!.x - trail[i]!.x, trail[i + 1]!.y - trail[i]!.y);
      if (gone > this.options.trailLength) {
        trail.length = i + 2;
        break;
      }
    }
    this.trails.set(leaderId, trail);
    return trail;
  }

  /**
   * Where each follower stands on the leader's trail: a spacing back for the first, two for the
   * next, and so on, sliding further back past anywhere a body does not fit or that is already
   * somebody's. A follower the trail does not reach is left out, to be left where they are.
   */
  private downTheTrail(leaderId: string, trail: readonly Spot[]): Map<string, { tile: number; at: Spot }> {
    const result = new Map<string, { tile: number; at: Spot }>();
    const leader = this.state.entity(leaderId);
    if (leader === undefined || trail.length < 2) return result;
    const spacing = Math.max(this.options.followDistance, 2 * this.options.walk.radius + 0.05);
    // Allies are walked through out of a fight but not stood on: anybody not walking with this
    // leader is holding the ground they are on, trail or no trail.
    const standing = this.leftStanding(leaderId);
    const taken = new Set<number>([leader.tile, ...standing.map((e) => e.tile)]);
    let back = spacing;
    for (const follower of this.followersOf(leaderId)) {
      const blocked = this.blockedForWalk(follower.id, false);
      let found: { tile: number; at: Spot } | null = null;
      for (let slide = 0; slide < 9 && found === null; slide++) {
        const at = this.backAlong(trail, back + slide * 0.2);
        if (at === null) break;
        const tile = this.grid.tileAtSpot(at.x, at.y);
        if (taken.has(tile) || !canStandAt(this.grid, at, blocked, this.walkRules())) continue;
        if (standing.some((e) => Math.hypot(e.at.x - at.x, e.at.y - at.y) < 2 * this.options.walk.radius)) continue;
        found = { tile, at };
      }
      back += spacing;
      if (found === null) continue;
      taken.add(found.tile);
      result.set(follower.id, found);
    }
    return result;
  }

  /** The point this far back down a trail, or null where the trail does not reach that far. */
  private backAlong(trail: readonly Spot[], back: number): Spot | null {
    let gone = 0;
    for (let i = 0; i + 1 < trail.length; i++) {
      const a = trail[i]!;
      const b = trail[i + 1]!;
      const leg = Math.hypot(b.x - a.x, b.y - a.y);
      if (gone + leg >= back) {
        const t = leg <= 1e-9 ? 0 : (back - gone) / leg;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      gone += leg;
    }
    return null;
  }

  /** The living members of the leader's group other than the leader, nearest the leader first, then by id. */
  private followersOf(leaderId: string): EntityState[] {
    const leader = this.state.entity(leaderId);
    if (leader === undefined) return [];
    return this.state
      .entitiesOf('party')
      .filter((e) => e.alive && e.id !== leaderId && !this.heldIds.has(e.id) && this.linked(leaderId, e.id))
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
    const standing = this.leftStanding(leaderId);
    const taken = new Set<number>([leader.tile, ...standing.map((e) => e.tile)]);
    let back = spacing;
    for (const follower of this.followersOf(leaderId)) {
      const blocked = this.blockedForWalk(follower.id, false);
      let found: { tile: number; at: Spot } | null = null;
      while (back <= length + 1e-9) {
        const at = pointAlong(route, length - back);
        back += spacing;
        const tile = this.grid.tileAtSpot(at.x, at.y);
        // Allies are walked through out of a fight, but not stood on: a body's width clear of anyone left behind.
        if (taken.has(tile) || !canStandAt(this.grid, at, blocked, this.walkRules())) continue;
        if (standing.some((e) => Math.hypot(e.at.x - at.x, e.at.y - at.y) < 2 * this.options.walk.radius)) continue;
        found = { tile, at };
        break;
      }
      if (found === null) break;
      taken.add(found.tile);
      result.set(follower.id, found);
    }
    return result;
  }

  /** The living members who are not walking with this leader: standing where they are, and not to be stood on. */
  private leftStanding(leaderId: string): EntityState[] {
    return this.state.entitiesOf('party').filter((e) => e.alive && e.tile !== NO_TILE && !this.linked(leaderId, e.id));
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
