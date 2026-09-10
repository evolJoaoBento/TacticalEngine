/**
 * Runtime scene state: everything that changes during play, kept strictly apart
 * from the authored `SceneDoc`.
 *
 * The legacy prototype wrote play state into its content objects — `node.used`,
 * `enemy.hp`, `trigger.fired`, heroes pushed onto `map.enemies` — so a session
 * could never be saved, replayed, or restarted without re-parsing the source JSON.
 * Here the document stays immutable and every mutable value lives in this overlay,
 * keyed by content id. The overlay is plain data, so it serialises as-is.
 *
 * It also owns the tile occupancy index, which is what a `MovementContext`'s
 * `isBlocked` reads: keeping it incremental means pathfinding never rebuilds a
 * set of occupied tiles per query the way the legacy code did.
 */

import { z } from 'zod';

import type { ContentIssue } from '../content/types';
import { NO_TILE, type Spot, type TileGrid } from '../grid/grid';
import {
  createFear,
  createHope,
  createMarkPool,
  type Currency,
  type MarkPool,
} from '../rules/resources';
import type { SceneDoc } from './schema';

/** Which side an entity fights for. */
export type Faction = 'party' | 'adversary' | 'neutral';

/** A creature on the map: a party member or a placed adversary. */
export interface EntityState {
  readonly id: string;
  readonly faction: Faction;
  /** Content id this entity was built from — an adversary def, or a character. */
  readonly definition: string;
  /** Tile the entity stands on, or `NO_TILE` when it is off the map. */
  tile: number;
  /**
   * Where exactly it stands, in tile units - Daggerheart is not played on a
   * grid, and a creature stops where it was walked to, not at the centre of
   * a square. `tile` is always the tile this rounds to; `SceneState` keeps
   * the two in step, and every rule reads `tile`.
   */
  at: Spot;
  hitPoints: MarkPool;
  stress: MarkPool;
  armorSlots: MarkPool;
  /** Party members carry Hope; adversaries do not. */
  hope?: Currency;
  /** Condition ids currently applied. A condition cannot be applied twice. */
  conditions: Set<string>;
  /**
   * How long each applied condition lasts. A condition with no entry here is
   * `permanent` — what a save written before durations existed says.
   */
  conditionDurations: Map<string, ConditionDuration>;
  /** False once the entity has fallen. */
  alive: boolean;
  /**
   * Past the veil: a character who crossed through it on a death move, or one
   * whose last Hope slot was crossed out. `alive` is false either way, and the
   * difference is that clearing a Hit Point brings the unconscious back and
   * does nothing for these. Absent on everything else, which is what a save
   * written before death moves existed says.
   */
  dead?: boolean;
}

/** When a condition ends. The SRD's "temporary" plus the engine's scopes. */
export type ConditionDuration = 'temporary' | 'scene' | 'rest' | 'permanent';

export interface InteractableState {
  /** An interaction that has been resolved and should not fire again. */
  used: boolean;
  /** Doors and chests that have been opened. */
  open: boolean;
  /** Removed from the scene entirely. */
  removed: boolean;
  /** Per-interactable script values: the legacy `lit`, `found`, `inserted` flags. */
  data: Record<string, string | number | boolean>;
}

export interface EncounterState {
  started: boolean;
  ended: boolean;
  /** Trigger cells already stepped on. */
  triggered: boolean;
}

/**
 * The zod mirror of `SceneStateSnapshot`.
 *
 * `restore` itself does no checking — it trusts what it is handed — so anything
 * that arrives from outside the process (a save file, `localStorage`) parses
 * through this first, and a corrupted save fails loudly at the door rather than
 * as a crash three moves into play.
 */
const markPoolSchema = z.object({ marked: z.number().int().min(0), max: z.number().int().min(0) });
const currencySchema = z.object({ value: z.number().int().min(0), max: z.number().int().min(0) });

export const sceneSnapshotSchema = z.object({
  sceneId: z.string(),
  entities: z.record(
    z.string(),
    z.object({
      id: z.string(),
      faction: z.enum(['party', 'adversary', 'neutral']),
      definition: z.string(),
      tile: z.number().int(),
      at: z.object({ x: z.number(), y: z.number() }).optional(),
      hitPoints: markPoolSchema,
      stress: markPoolSchema,
      armorSlots: markPoolSchema,
      hope: currencySchema.optional(),
      conditions: z.array(z.string()),
      conditionDurations: z
        .record(z.string(), z.enum(['temporary', 'scene', 'rest', 'permanent']))
        .default({}),
      alive: z.boolean(),
      dead: z.boolean().optional(),
    }),
  ),
  interactables: z.record(
    z.string(),
    z.object({
      used: z.boolean(),
      open: z.boolean(),
      removed: z.boolean(),
      data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    }),
  ),
  encounters: z.record(
    z.string(),
    z.object({ started: z.boolean(), ended: z.boolean(), triggered: z.boolean() }),
  ),
  fear: currencySchema,
});

export interface SceneStateSnapshot {
  sceneId: string;
  entities: Record<
    string,
    Omit<EntityState, 'conditions' | 'conditionDurations' | 'at'> & {
      /** Absent in a save written before creatures stood off-centre: the tile's centre then. */
      at?: Spot;
      conditions: string[];
      conditionDurations: Record<string, ConditionDuration>;
    }
  >;
  interactables: Record<string, InteractableState>;
  encounters: Record<string, EncounterState>;
  fear: Currency;
}

/**
 * Parse an untrusted snapshot.
 *
 * Typing the return as the interface is what keeps the schema honest: if the two
 * drift apart, this stops compiling.
 */
export function parseSceneSnapshot(value: unknown): SceneStateSnapshot {
  return sceneSnapshotSchema.parse(value);
}

/**
 * Mutable play state for one scene.
 *
 * Every mutation goes through a method so the occupancy index cannot drift out of
 * step with the entities — the one invariant here that is expensive to debug once
 * broken.
 */
export class SceneState {
  readonly sceneId: string;
  readonly grid: TileGrid;

  private readonly entities = new Map<string, EntityState>();
  private readonly interactables = new Map<string, InteractableState>();
  private readonly encounters = new Map<string, EncounterState>();
  /** Tile index -> entity ids standing on it. Kept incremental, never rebuilt. */
  private readonly occupants = new Map<number, Set<string>>();

  /** The GM's Fear pool. It carries between scenes; the caller passes it along. */
  fear: Currency;

  constructor(scene: Pick<SceneDoc, 'id'>, grid: TileGrid, fear: Currency = createFear()) {
    this.sceneId = scene.id;
    this.grid = grid;
    this.fear = fear;
  }

  // ---- entities -----------------------------------------------------------

  addEntity(entity: EntityState): EntityState {
    if (this.entities.has(entity.id)) {
      throw new RangeError(`entity "${entity.id}" is already in this scene`);
    }
    // The spot follows the tile unless it already agrees with it: a factory
    // does not know the grid, a spread copy carries a stale one, and a save
    // from before spots restores at the centre.
    const at = entity.at as Spot | undefined;
    if (at === undefined || this.grid.tileAtSpot(at.x, at.y) !== entity.tile) entity.at = this.grid.spotOf(entity.tile);
    this.entities.set(entity.id, entity);
    this.occupy(entity.tile, entity.id);
    return entity;
  }

  removeEntity(id: string): boolean {
    const entity = this.entities.get(id);
    if (entity === undefined) return false;
    this.vacate(entity.tile, id);
    this.entities.delete(id);
    return true;
  }

  entity(id: string): EntityState | undefined {
    return this.entities.get(id);
  }

  allEntities(): EntityState[] {
    return [...this.entities.values()];
  }

  entitiesOf(faction: Faction): EntityState[] {
    return this.allEntities().filter((e) => e.faction === faction);
  }

  /** Put an entity down at a tile's centre, keeping the occupancy index in step. */
  moveEntity(id: string, tile: number): void {
    const entity = this.entities.get(id);
    if (entity === undefined) throw new RangeError(`no entity "${id}" in this scene`);
    entity.at = this.grid.spotOf(tile);
    if (entity.tile === tile) return;
    this.vacate(entity.tile, id);
    entity.tile = tile;
    this.occupy(tile, id);
  }

  /**
   * Stand an entity at a spot - where a walk ended, not the centre of the
   * square it ended in. The tile it counts as standing on follows.
   */
  placeEntity(id: string, x: number, y: number): void {
    const entity = this.entities.get(id);
    if (entity === undefined) throw new RangeError(`no entity "${id}" in this scene`);
    const tile = this.grid.tileAtSpot(x, y);
    entity.at = tile === NO_TILE ? this.grid.spotOf(NO_TILE) : { x, y };
    if (entity.tile === tile) return;
    this.vacate(entity.tile, id);
    entity.tile = tile;
    this.occupy(tile, id);
  }

  /** Ids of the entities standing on a tile. Empty for an unoccupied tile. */
  occupantsOf(tile: number): readonly string[] {
    const set = this.occupants.get(tile);
    return set === undefined ? [] : [...set];
  }

  /** Whether any living entity stands on a tile. */
  isOccupied(tile: number): boolean {
    const set = this.occupants.get(tile);
    if (set === undefined) return false;
    for (const id of set) {
      if (this.entities.get(id)?.alive === true) return true;
    }
    return false;
  }

  /**
   * A `MovementContext.isBlocked` for one mover: tiles held by a living creature
   * it cannot pass, plus interactables that block movement and are still there.
   *
   * `passThrough` decides which factions the mover may walk past. The legacy rule
   * was that allies are transparent while exploring and everything blocks in
   * combat, which callers express by passing different sets rather than by the
   * engine hard-coding a mode.
   *
   * Each call builds a fresh predicate and a small `Set`. That is nothing next to
   * a pathfinding query, but a hover preview that runs per frame should hold on to
   * one predicate for as long as the mover and the pass-through set stay the same.
   */
  blockedFor(moverId: string, passThrough: readonly Faction[] = []): (tile: number) => boolean {
    const transparent = new Set(passThrough);
    return (tile: number): boolean => {
      const set = this.occupants.get(tile);
      if (set !== undefined) {
        for (const id of set) {
          if (id === moverId) continue;
          const other = this.entities.get(id);
          if (other === undefined || !other.alive) continue;
          if (!transparent.has(other.faction)) return true;
        }
      }
      return this.blockingInteractables.has(tile);
    };
  }

  // ---- interactables ------------------------------------------------------

  /** Tiles held by an interactable that blocks movement and has not been removed. */
  private readonly blockingInteractables = new Set<number>();
  /** Where each interactable stands, so removing one can free its tile. */
  private readonly interactableTiles = new Map<string, number>();
  /**
   * Interactables you can walk through once they are open — doors, and nothing
   * else. An opened chest still sits where it sat.
   */
  private readonly passableWhenOpen = new Set<string>();

  /** Register an interactable's tile as blocking. Called when the scene is built. */
  setInteractableBlocking(tile: number, blocking: boolean): void {
    if (tile === NO_TILE) return;
    if (blocking) this.blockingInteractables.add(tile);
    else this.blockingInteractables.delete(tile);
  }

  /**
   * Record where an interactable stands. Called when the scene is built.
   *
   * `passableWhenOpen` is what makes a door a door: opening it clears the tile,
   * and every path back into this room — a restore, a save reloaded — has to
   * agree, because the blocking index is built from the document and the
   * document says the door is shut.
   */
  placeInteractable(id: string, tile: number, passableWhenOpen = false): void {
    if (tile !== NO_TILE) this.interactableTiles.set(id, tile);
    if (passableWhenOpen) this.passableWhenOpen.add(id);
    else this.passableWhenOpen.delete(id);
  }

  /** Open something, and get out of the way if it is the kind of thing that does. */
  openInteractable(id: string): void {
    this.interactable(id).open = true;
    if (this.passableWhenOpen.has(id)) this.setInteractableBlocking(this.interactableTile(id), false);
  }

  /** The tile an interactable stands on, or `NO_TILE`. */
  interactableTile(id: string): number {
    return this.interactableTiles.get(id) ?? NO_TILE;
  }

  interactable(id: string): InteractableState {
    let state = this.interactables.get(id);
    if (state === undefined) {
      state = { used: false, open: false, removed: false, data: {} };
      this.interactables.set(id, state);
    }
    return state;
  }

  // ---- encounters ---------------------------------------------------------

  encounter(id: string): EncounterState {
    let state = this.encounters.get(id);
    if (state === undefined) {
      state = { started: false, ended: false, triggered: false };
      this.encounters.set(id, state);
    }
    return state;
  }

  /** Whether any encounter has started and not ended: the fight is on. */
  encounterRunning(): boolean {
    for (const encounter of this.encounters.values()) {
      if (encounter.started && !encounter.ended) return true;
    }
    return false;
  }

  // ---- conditions ---------------------------------------------------------

  /**
   * End the conditions a moment ends. A fight ending clears `temporary` and
   * `scene`; a rest clears those and `rest`. Returns what was cleared, by
   * creature, so the caller can say so.
   */
  clearConditions(scope: 'scene' | 'rest'): { id: string; condition: string }[] {
    const ending: ReadonlySet<ConditionDuration> =
      scope === 'rest' ? new Set(['temporary', 'scene', 'rest']) : new Set(['temporary', 'scene']);
    const cleared: { id: string; condition: string }[] = [];
    for (const entity of this.entities.values()) {
      for (const condition of [...entity.conditions]) {
        const duration = entity.conditionDurations.get(condition) ?? 'permanent';
        if (!ending.has(duration)) continue;
        entity.conditions.delete(condition);
        entity.conditionDurations.delete(condition);
        cleared.push({ id: entity.id, condition });
      }
    }
    return cleared;
  }

  // ---- serialisation ------------------------------------------------------

  /** A plain, JSON-safe snapshot — `Set`s become arrays, which the legacy state could not. */
  snapshot(): SceneStateSnapshot {
    const entities: SceneStateSnapshot['entities'] = {};
    for (const [id, entity] of this.entities) {
      entities[id] = {
        ...entity,
        at: { ...entity.at },
        conditions: [...entity.conditions],
        conditionDurations: Object.fromEntries(entity.conditionDurations),
      };
    }
    const interactables: Record<string, InteractableState> = {};
    for (const [id, state] of this.interactables) interactables[id] = { ...state, data: { ...state.data } };
    const encounters: Record<string, EncounterState> = {};
    for (const [id, state] of this.encounters) encounters[id] = { ...state };

    return {
      sceneId: this.sceneId,
      entities,
      interactables,
      encounters,
      fear: { ...this.fear },
    };
  }

  /** Rebuild state from a snapshot, restoring the occupancy index as it goes. */
  restore(snapshot: SceneStateSnapshot): void {
    this.entities.clear();
    this.occupants.clear();
    this.interactables.clear();
    this.encounters.clear();

    for (const [id, entity] of Object.entries(snapshot.entities)) {
      this.addEntity({
        ...entity,
        id,
        at: entity.at ?? this.grid.spotOf(entity.tile),
        conditions: new Set(entity.conditions),
        conditionDurations: new Map(Object.entries(entity.conditionDurations)),
      });
    }
    for (const [id, state] of Object.entries(snapshot.interactables)) {
      this.interactables.set(id, { ...state, data: { ...state.data } });
      // The blocking index is built from the *document*, so it comes back
      // believing a door the party opened or smashed is still in the way. Only
      // the snapshot knows otherwise.
      if (state.removed || (state.open && this.passableWhenOpen.has(id))) {
        this.setInteractableBlocking(this.interactableTile(id), false);
      }
    }
    for (const [id, state] of Object.entries(snapshot.encounters)) {
      this.encounters.set(id, { ...state });
    }
    this.fear = { ...snapshot.fear };
  }

  private occupy(tile: number, id: string): void {
    if (tile === NO_TILE) return;
    let set = this.occupants.get(tile);
    if (set === undefined) {
      set = new Set();
      this.occupants.set(tile, set);
    }
    set.add(id);
  }

  private vacate(tile: number, id: string): void {
    const set = this.occupants.get(tile);
    if (set === undefined) return;
    set.delete(id);
    if (set.size === 0) this.occupants.delete(tile);
  }
}

/** A spot no tile rounds to: `addEntity` puts the creature at its tile's centre. */
const UNPLACED: Spot = { x: Number.NaN, y: Number.NaN };

/** A party member's starting state. */
export function createPartyEntity(
  id: string,
  definition: string,
  tile: number,
  options: { hitPoints: number; stress: number; armorSlots?: number } = {
    hitPoints: 6,
    stress: 6,
  },
): EntityState {
  return {
    id,
    faction: 'party',
    definition,
    tile,
    at: UNPLACED,
    hitPoints: createMarkPool(options.hitPoints),
    stress: createMarkPool(options.stress),
    armorSlots: createMarkPool(options.armorSlots ?? 0),
    hope: createHope(),
    conditions: new Set(),
    conditionDurations: new Map(),
    alive: true,
  };
}

/** An adversary's starting state, from an imported stat block. */
export function createAdversaryEntity(
  id: string,
  definition: string,
  tile: number,
  options: { hitPoints: number; stress: number },
): EntityState {
  return {
    id,
    faction: 'adversary',
    definition,
    tile,
    at: UNPLACED,
    hitPoints: createMarkPool(options.hitPoints),
    stress: createMarkPool(options.stress),
    armorSlots: createMarkPool(0),
    conditions: new Set(),
    conditionDurations: new Map(),
    alive: true,
  };
}

/** The part of an `AdversaryDef` this needs to stand a stat block up on the map. */
export interface AdversaryStats {
  id: string;
  hitPoints: number;
  stress: number;
}

export interface SceneStateOptions {
  /**
   * Stat blocks by content id, from the adversary importer. A placement whose
   * definition is missing is reported and skipped — the legacy prototype's
   * homebrew Hollow Husk and Shadow Hag have no SRD stat block, so a project has
   * to supply them before those scenes can be played.
   */
  adversaries?: ReadonlyMap<string, AdversaryStats>;
  /** Party members to place on the scene's spawn points, in order. */
  party?: EntityState[];
  /** The GM's Fear, carried in from the previous scene. */
  fear?: Currency;
}

/**
 * Stand a scene up: place every encounter's adversaries, register the
 * interactables that block movement, and seat the party on the spawn points.
 *
 * Adversaries are placed immediately but their encounter stays unstarted, which
 * is how the legacy prototype worked — enemies stand on the map, dormant, until a
 * trigger cell or an effect wakes them.
 */
export function sceneStateFromScene(
  scene: SceneDoc,
  grid: TileGrid,
  options: SceneStateOptions = {},
): { state: SceneState; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const state = new SceneState(scene, grid, options.fear ?? createFear());
  const stats = options.adversaries ?? new Map<string, AdversaryStats>();

  for (const interactable of scene.interactables) {
    const tile = grid.indexOf(interactable.position.x, interactable.position.y);
    state.placeInteractable(interactable.id, tile, interactable.kind === 'door');
    if (interactable.blocksMovement) state.setInteractableBlocking(tile, true);
  }

  for (const encounter of scene.encounters) {
    for (const placement of encounter.adversaries) {
      const definition = stats.get(placement.adversary);
      if (definition === undefined) {
        issues.push({
          source: scene.id,
          entry: placement.id,
          field: 'adversary',
          message: `no stat block for adversary "${placement.adversary}"`,
        });
        continue;
      }
      state.addEntity(
        createAdversaryEntity(
          placement.id,
          placement.adversary,
          grid.indexOf(placement.position.x, placement.position.y),
          {
            hitPoints: placement.hitPoints ?? definition.hitPoints,
            stress: definition.stress,
          },
        ),
      );
    }
  }

  // Spawns repeat when the party outnumbers them, as the legacy code did.
  (options.party ?? []).forEach((member, i) => {
    const spawn = scene.spawns[i % scene.spawns.length]!;
    state.addEntity({ ...member, tile: grid.indexOf(spawn.x, spawn.y) });
  });

  return { state, issues };
}
