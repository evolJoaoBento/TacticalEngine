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

import { NO_TILE, type TileGrid } from '../grid/grid';
import { createFear, createHope, createMarkPool, type Currency, type MarkPool } from '../rules/resources';
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
  hitPoints: MarkPool;
  stress: MarkPool;
  armorSlots: MarkPool;
  /** Party members carry Hope; adversaries do not. */
  hope?: Currency;
  /** Condition ids currently applied. A condition cannot be applied twice. */
  conditions: Set<string>;
  /** False once the entity has fallen. */
  alive: boolean;
}

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

export interface SceneStateSnapshot {
  sceneId: string;
  entities: Record<string, Omit<EntityState, 'conditions'> & { conditions: string[] }>;
  interactables: Record<string, InteractableState>;
  encounters: Record<string, EncounterState>;
  flags: string[];
  keys: string[];
  fear: Currency;
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
  private readonly storyFlags = new Set<string>();
  private readonly partyKeys = new Set<string>();

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

  /** Move an entity, keeping the occupancy index in step. */
  moveEntity(id: string, tile: number): void {
    const entity = this.entities.get(id);
    if (entity === undefined) throw new RangeError(`no entity "${id}" in this scene`);
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

  /** Register an interactable's tile as blocking. Called when the scene is built. */
  setInteractableBlocking(tile: number, blocking: boolean): void {
    if (tile === NO_TILE) return;
    if (blocking) this.blockingInteractables.add(tile);
    else this.blockingInteractables.delete(tile);
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

  // ---- flags and keys -----------------------------------------------------

  setFlag(flag: string): void {
    this.storyFlags.add(flag);
  }

  hasFlag(flag: string): boolean {
    return this.storyFlags.has(flag);
  }

  giveKey(key: string): void {
    this.partyKeys.add(key);
  }

  hasKey(key: string): boolean {
    return this.partyKeys.has(key);
  }

  // ---- serialisation ------------------------------------------------------

  /** A plain, JSON-safe snapshot — `Set`s become arrays, which the legacy state could not. */
  snapshot(): SceneStateSnapshot {
    const entities: SceneStateSnapshot['entities'] = {};
    for (const [id, entity] of this.entities) {
      entities[id] = { ...entity, conditions: [...entity.conditions] };
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
      flags: [...this.storyFlags],
      keys: [...this.partyKeys],
      fear: { ...this.fear },
    };
  }

  /** Rebuild state from a snapshot, restoring the occupancy index as it goes. */
  restore(snapshot: SceneStateSnapshot): void {
    this.entities.clear();
    this.occupants.clear();
    this.interactables.clear();
    this.encounters.clear();
    this.storyFlags.clear();
    this.partyKeys.clear();

    for (const [id, entity] of Object.entries(snapshot.entities)) {
      this.addEntity({ ...entity, id, conditions: new Set(entity.conditions) });
    }
    for (const [id, state] of Object.entries(snapshot.interactables)) {
      this.interactables.set(id, { ...state, data: { ...state.data } });
    }
    for (const [id, state] of Object.entries(snapshot.encounters)) {
      this.encounters.set(id, { ...state });
    }
    for (const flag of snapshot.flags) this.storyFlags.add(flag);
    for (const key of snapshot.keys) this.partyKeys.add(key);
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
    hitPoints: createMarkPool(options.hitPoints),
    stress: createMarkPool(options.stress),
    armorSlots: createMarkPool(options.armorSlots ?? 0),
    hope: createHope(),
    conditions: new Set(),
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
    hitPoints: createMarkPool(options.hitPoints),
    stress: createMarkPool(options.stress),
    armorSlots: createMarkPool(0),
    conditions: new Set(),
    alive: true,
  };
}
