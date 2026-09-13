/**
 * The bridge from a running scene to a script.
 *
 * `ScriptRunner` is deliberately ignorant of `SceneState` — it talks to a
 * `ScriptWorld` interface, so a test can drive a script against a stub and a
 * replay can drive one against a restored snapshot. This is the implementation
 * that connects it to the real thing.
 *
 * Scenario variables live here rather than in `SceneState` because they outlive a
 * scene: the one-shot's `mood` is chosen in the pit and read in the theater
 * (docs/research/legacy-campaign.md §1.1). They serialise with the rest.
 *
 * The combat half — damage through thresholds, Stress, Light, conditions, a
 * weapon attack, a knockback — is what lets an ability be a script. It reads
 * sheets and stat blocks that are injected, so a scene with neither still runs
 * a chest's check exactly as it did.
 */

import { z } from 'zod';

import {
  clear as clearPool,
  gain,
  markHitPoints,
  markStress as markStressPool,
  spend,
  unmarked,
} from '../rules/resources';
import {
  hpForSeverity,
  isSevere,
  resolveDamage,
  type DamageDefenses,
  type DamageReduction,
  type DamageSeverity,
  type IncomingDamage,
} from '../rules/damage';
import { GOOD_DIE_SIDES, rollDuality, type DualityRoll, type RollOutcome } from '../rules/duality';
import { rollGmDie } from '../rules/gm-die';
import {
  bandForSpan,
  bandIndex,
  maxTilesForBand,
  reaches,
  RANGE_BANDS,
  type BandTiles,
  type RangeBand,
  type TargetableRangeBand,
} from '../rules/range';
import { applyAttack, conditionModifiers, resolveAttack, type AttackProfile } from '../combat/attack';
import { resolveDefense, type Defense, type DefensePolicy } from '../combat/defense';
import { attackProfile, grantedCards, traitPart, UNARMED, type DerivedCharacter } from '../character/sheet';
import { abilitiesFor, loadoutOf, type AbilityDef, type AbilityModifier } from '../content/abilities';
import type { ConditionBlock, ConditionDef } from '../content/conditions';
import { formatDice, parseDice, type DamageType, type ParsedDamage } from '../rules/dice';
import type { AdversaryDef } from '../content/types';
import type { CardDef } from '../content/pack/import';
import { NO_TILE, type Spot } from '../grid/grid';
import { DEFAULT_WALK, smoothPath, type WalkRules } from '../grid/walk';
import { traceLine } from '../grid/los';
import { DEFAULT_MOVEMENT, Pathfinder, tracePath, type MovementRules, type ReachableField } from '../grid/pathfinding';
import { createAdversaryEntity, type EntityState, type SceneState } from '../scene/state';
import type { Trait } from '../scene/schema';
import { scriptValueSchema, type ConditionDuration, type PoolName, type ScriptValue } from './schema';
import type { CheckTrait, Condition, Effect, TargetSelector } from './schema';
import type { Rng } from '../core/rng';
import { rollLoot, type LootDrop, type LootTable } from '../content/items';
import { questStatusSchema, type QuestProgress, type QuestQuery } from '../content/quests';
import {
  advanceBoard,
  endCreatureCountdowns,
  reapBoard,
  runningCountdownSchema,
  type CountdownBoard,
  type CountdownMoved,
  type RunningCountdown,
} from './countdowns';
import { runningZoneSchema, type RunningZone, type ZoneBoard } from './zones';
import { markKey, parseMarkKey } from './marks';
import type { CountdownCue } from '../rules/countdown';
import type { AttackSummary, DealtDamage, ScriptWorld } from './runner';
import { evaluate, type TargetBindings } from './conditions';
import type { HookFn, HookMap } from './hooks';

/**
 * What outlives a scene: variables, story flags, the keys the party carries, and
 * who is acting.
 *
 * Flags and keys used to live on `SceneState`, which was wrong the moment a
 * campaign had two rooms in it — a key found in the vault would not open a door
 * in the pit, and `SceneState.snapshot()` serialised them, so returning to a
 * room would have restored *stale* flags over the campaign's real ones.
 */
export interface ScenarioState {
  variables: Record<string, ScriptValue>;
  /** Story flags, set and cleared by scripts. */
  flags: Set<string>;
  /**
   * What the party is carrying, by item id, with how many of each.
   *
   * This used to be a `Set` of key names. Folding keys into items means a
   * designer learns one idea rather than two — a key is an item you have one of,
   * and `hasKey` is `hasItem` with a quantity of one.
   */
  items: Map<string, number>;
  /** The character a script's `actor` selector refers to. */
  actorId: string | null;
  /** Quest progress by quest id. A quest with no entry has not been started. */
  quests: Map<string, QuestProgress>;
  /**
   * The level the party has been granted. A character whose sheet is below it
   * has a level-up waiting; the choices are theirs, the moment is the GM's.
   */
  partyLevel: number;
  /**
   * How many times each character has used each limited ability since it last
   * refreshed, keyed "character/ability". A rest or a scene's end clears the
   * ones it refreshes.
   */
  abilityUses: Map<string, number>;
  /** Tokens on a card, keyed the same way: "who/which-card". */
  abilityTokens: Map<string, number>;
  /**
   * Clocks the fight is carrying, by countdown id. On the scenario rather than
   * the scene because a countdown outlives a defence prompt and a GM turn, and
   * because a save that lost what a countdown was counting towards would be a
   * save of a different fight.
   */
  countdowns: CountdownBoard;
  /**
   * Patches of ground that mean something, by zone id. On the scenario for the
   * same reason countdowns are: one outlives a defence prompt and a reload.
   */
  zones: ZoneBoard;
}

/** The key `abilityUses` files a use under. */
export function useKey(characterId: string, abilityId: string): string {
  return `${characterId}/${abilityId}`;
}

export function createScenarioState(
  variables: Record<string, ScriptValue> = {},
  actorId: string | null = null,
  flags: Iterable<string> = [],
  items: Iterable<readonly [string, number]> = [],
): ScenarioState {
  return {
    variables: { ...variables },
    flags: new Set(flags),
    items: new Map(items),
    actorId,
    quests: new Map(),
    partyLevel: 1,
    abilityUses: new Map(),
    abilityTokens: new Map(),
    countdowns: new Map(),
    zones: new Map(),
  };
}

/**
 * A JSON-safe `ScenarioState` — the `Set` and the `Map` flattened.
 *
 * Items are pairs rather than an object so an item id is never quietly coerced
 * into a property name, and so the order the party picked things up in survives
 * a round trip.
 */
export const scenarioSnapshotSchema = z.object({
  variables: z.record(z.string(), scriptValueSchema),
  flags: z.array(z.string()),
  items: z.array(z.tuple([z.string(), z.number().int().min(0)])),
  actorId: z.string().nullable(),
  /**
   * Defaulted, so a save written before quests existed still loads. A save
   * format is a promise to every file already on disk.
   */
  quests: z
    .array(
      z.object({
        quest: z.string(),
        status: questStatusSchema,
        done: z.array(z.string()),
        revealed: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  partyLevel: z.number().int().min(1).max(10).default(1),
  abilityUses: z.array(z.tuple([z.string(), z.number().int().min(0)])).default([]),
  abilityTokens: z.array(z.tuple([z.string(), z.number().int().min(0)])).default([]),
  /** Defaulted like the rest: a save written before countdowns existed loads. */
  countdowns: z.array(runningCountdownSchema).default([]),
  zones: z.array(runningZoneSchema).default([]),
});

export type ScenarioSnapshot = z.infer<typeof scenarioSnapshotSchema>;

export function scenarioSnapshot(scenario: ScenarioState): ScenarioSnapshot {
  return {
    variables: { ...scenario.variables },
    flags: [...scenario.flags],
    items: [...scenario.items].map(([id, quantity]) => [id, quantity] as [string, number]),
    actorId: scenario.actorId,
    quests: [...scenario.quests].map(([quest, progress]) => ({
      quest,
      status: progress.status,
      done: [...progress.done],
      revealed: [...progress.revealed],
    })),
    partyLevel: scenario.partyLevel,
    abilityUses: [...scenario.abilityUses].map(([key, used]) => [key, used] as [string, number]),
    abilityTokens: [...scenario.abilityTokens].map(([key, held]) => [key, held] as [string, number]),
    countdowns: [...scenario.countdowns.values()].map((countdown) => ({
      ...countdown,
      effects: [...countdown.effects],
    })),
    zones: [...scenario.zones.values()].map((zone) => ({ ...zone })),
  };
}

/**
 * Refill a scenario from a snapshot, **in place**.
 *
 * In place, not replaced: every `SceneScriptWorld` built so far holds a reference
 * to this object, so handing back a new one would leave the live scene writing
 * flags nobody reads.
 */
export function restoreScenario(scenario: ScenarioState, snapshot: ScenarioSnapshot): void {
  for (const name of Object.keys(scenario.variables)) delete scenario.variables[name];
  Object.assign(scenario.variables, snapshot.variables);
  scenario.flags.clear();
  for (const flag of snapshot.flags) scenario.flags.add(flag);
  scenario.items.clear();
  for (const [id, quantity] of snapshot.items) scenario.items.set(id, quantity);
  scenario.actorId = snapshot.actorId;
  scenario.quests.clear();
  for (const entry of snapshot.quests) {
    scenario.quests.set(entry.quest, {
      status: entry.status,
      done: new Set(entry.done),
      revealed: new Set(entry.revealed),
    });
  }
  scenario.partyLevel = snapshot.partyLevel;
  scenario.abilityUses.clear();
  for (const [key, used] of snapshot.abilityUses) scenario.abilityUses.set(key, used);
  scenario.abilityTokens.clear();
  for (const [key, held] of snapshot.abilityTokens ?? []) scenario.abilityTokens.set(key, held);
  scenario.countdowns.clear();
  for (const countdown of snapshot.countdowns ?? []) scenario.countdowns.set(countdown.id, countdown);
  scenario.zones.clear();
  for (const zone of snapshot.zones ?? []) scenario.zones.set(zone.id, zone);
}

/** A blow that landed, waiting for the features that answer it. */
export interface DamageNote {
  /** Who took it. */
  id: string;
  /** Who dealt it, when a creature did. */
  attacker: string | null;
  /** Hit Points it actually marked, after armor and reactions. */
  hitPoints: number;
  /**
   * The damage rolled, before armor took anything off it: what "half the
   * damage they dealt" is half of. Hit Points are what landed; this is what
   * was thrown.
   */
  damage: number;
  /** What kind it was, so damage sent back is the same kind. */
  types: readonly DamageType[];
  /** Whether any part of it was Severe. */
  severe: boolean;
}

/** Thresholds for a creature nothing describes: the demo's stand-in numbers. */
const FALLBACK_DEFENDER = { difficulty: 11, thresholds: { major: 6, severe: 12 } };

export interface SceneScriptWorldOptions {
  /**
   * The project's loot tables, by id. Left out when a caller has none, which is
   * every test that never loots and the legacy import.
   */
  lootTables?: ReadonlyMap<string, LootTable>;
  /**
   * Trait modifiers for a check rolled *as the party* — an object's check, the
   * party's best hand at each trait. A scenario supplies these.
   */
  traits?: Partial<Record<Trait, number>>;
  /** The party's derived sheets, by character id, for rolls made as the actor. */
  characters?: ReadonlyMap<string, DerivedCharacter>;
  /** Stat blocks by content id, for an adversary's Difficulty and thresholds. */
  adversaries?: ReadonlyMap<string, AdversaryDef>;
  /** How many tiles each range band spans on this map. */
  bandTiles?: BandTiles;
  /** The movement rules a script walks a creature by; the engine's four-way default when left out. */
  movement?: MovementRules;
  /** Whether a fight is running. Read off the scene's encounters when left out. */
  inCombat?: () => boolean;
  /**
   * Whether a creature marks Armor Slots against damage without being asked.
   * `auto` marks the one that lowers the Hit Points marked; the defender's
   * choice as a prompt is a later refinement of the same policy.
   */
  armor?: 'auto' | 'never';
  /** Whether reactions to damage fire on their own. On when left out. */
  reactions?: boolean;
  /** Every ability the project knows, for a character's modifiers and reactions. */
  abilities?: readonly AbilityDef[];
  /**
   * Every card, by id, for what a character has in play without choosing it. Asked each time, like
   * the hooks, so a card handed over after the world was built is in hand at once. Left out, a
   * character holds what their sheet was derived with.
   */
  cards?: ReadonlyMap<string, CardDef> | (() => ReadonlyMap<string, CardDef>);
  /** What a named condition does to its bearer. */
  conditionDefs?: readonly ConditionDef[];
  /**
   * Logic in code, by id: the engine's native hooks and the project's compiled
   * code. A function is asked each time, so an editor rewriting a hook does
   * not need the world rebuilt to see the change.
   */
  hooks?: HookMap | (() => HookMap);
}

/** A stat a modifier can move at roll time. */
export type RollStat = 'attackRoll' | 'damageRoll' | 'spellcastRoll' | 'actionRoll';
/** A stat a modifier can move on a pool or a defence. */
export type PoolStat = 'evasion' | 'armorScore' | 'hitPoints' | 'stress' | 'majorThreshold' | 'severeThreshold' | 'thresholds';

/** Somebody who has just come to stand in a zone whose condition bites. */
export interface ZoneEntry {
  /** Who walked in. */
  id: string;
  condition: string;
  /** Whose spell the ground is, or nobody's. */
  owner: string | null;
}

/** What a condition on the one who was swung at owes the one who swung. */
export interface Payout {
  condition: string;
  effects: readonly Effect[];
  when?: Condition;
  auto?: boolean;
  /** The condition stands after it pays: a price rather than a debt. */
  keeps?: boolean;
}

/** A `ScriptWorld` backed by a live scene. */
export class SceneScriptWorld implements ScriptWorld {
  readonly state: SceneState;
  readonly scenario: ScenarioState;
  private readonly traits: Partial<Record<Trait, number>>;
  private readonly lootTables: ReadonlyMap<string, LootTable>;
  private readonly characters: ReadonlyMap<string, DerivedCharacter>;
  private readonly adversaries: ReadonlyMap<string, AdversaryDef>;
  private readonly bandTiles: BandTiles | undefined;
  private readonly movement: MovementRules | undefined;
  /** Built the first time a script walks someone, and kept for the scene. */
  private pathfinder: Pathfinder | null = null;
  /**
   * Whether a creature has already been given the spotlight this GM turn.
   *
   * Joining a swarm *is* being spotlighted — "spotlight all Giant Rats within
   * Close range of them" — so a rat that has already bitten does not bite
   * again behind the next one. Whoever is running the turn sets this; a world
   * with nobody keeping turns says no, and everyone joins.
   */
  spotlightSpent: (id: string) => boolean = () => false;
  private readonly fighting: () => boolean;
  private readonly defense: DefensePolicy;
  private readonly abilities: readonly AbilityDef[];
  private readonly cards: (() => ReadonlyMap<string, CardDef>) | null;
  private readonly conditionDefs: ReadonlyMap<string, ConditionDef>;
  private readonly hooks: () => HookMap;
  /** Blows that landed since anyone last looked, and what they did. */
  private readonly damaged: DamageNote[] = [];
  /** Crossings into ground that bites, waiting for somebody with a runner. */
  private readonly entered: ZoneEntry[] = [];

  constructor(state: SceneState, scenario: ScenarioState, options: SceneScriptWorldOptions = {}) {
    this.state = state;
    this.scenario = scenario;
    this.traits = options.traits ?? {};
    this.lootTables = options.lootTables ?? new Map();
    this.characters = options.characters ?? new Map();
    this.adversaries = options.adversaries ?? new Map();
    this.bandTiles = options.bandTiles;
    this.movement = options.movement;
    this.fighting = options.inCombat ?? (() => state.encounterRunning());
    this.defense = { armor: options.armor ?? 'auto', reactions: options.reactions ?? true };
    this.abilities = options.abilities ?? [];
    const cards = options.cards;
    this.cards = cards === undefined ? null : typeof cards === 'function' ? cards : () => cards;
    this.conditionDefs = new Map((options.conditionDefs ?? []).map((c) => [c.id, c]));
    const hooks = options.hooks ?? new Map<string, HookFn>();
    this.hooks = typeof hooks === 'function' ? hooks : () => hooks;
  }

  // ---- reads ---------------------------------------------------------------

  hasFlag(flag: string): boolean {
    return this.scenario.flags.has(flag);
  }

  hasKey(key: string): boolean {
    return this.hasItem(key, 1);
  }

  hasItem(item: string, quantity = 1): boolean {
    return (this.scenario.items.get(item) ?? 0) >= quantity;
  }

  itemCount(item: string): number {
    return this.scenario.items.get(item) ?? 0;
  }

  questStatus(quest: string): QuestQuery {
    return this.scenario.quests.get(quest)?.status ?? 'inactive';
  }

  objectiveDone(quest: string, objective: string): boolean {
    return this.scenario.quests.get(quest)?.done.has(objective) ?? false;
  }

  getVar(name: string): ScriptValue {
    // An unset variable reads as null rather than undefined, so conditions
    // comparing against null behave the way content expects.
    return this.scenario.variables[name] ?? null;
  }

  interactableState(id: string): { used: boolean; open: boolean; removed: boolean } {
    const s = this.state.interactable(id);
    return { used: s.used, open: s.open, removed: s.removed };
  }

  encounterState(id: string): { started: boolean; ended: boolean; triggered: boolean } {
    const s = this.state.encounter(id);
    return { started: s.started, ended: s.ended, triggered: s.triggered };
  }

  /**
   * What a creature bears that answers a fall in place of a death move, and
   * the name of the condition spent doing it.
   */
  insteadOfDeath(id: string): { condition: string; clears: number; says: string } | null {
    for (const name of [...(this.state.entity(id)?.conditions ?? [])].sort()) {
      const instead = this.conditionDefs.get(name)?.insteadOfDeath;
      if (instead !== undefined) return { condition: name, ...instead };
    }
    return null;
  }

  /** What a condition is called, for a line the log writes about it. */
  conditionName(condition: string): string {
    return this.conditionDefs.get(condition)?.name ?? condition;
  }

  /** The whole of what a condition says, for a caller that runs one of its scripts. */
  conditionDef(condition: string): ConditionDef | undefined {
    return this.conditionDefs.get(condition);
  }

  /**
   * What the conditions on a creature owe whoever just did this to them: the
   * condition's name and the script it carries, in a stable order.
   *
   * `keeps` is the one that is not a debt: the condition stands after it pays,
   * so the caller must not clear it.
   */
  payoutsOn(id: string, on: 'attacked'): Payout[] {
    const entity = this.state.entity(id);
    if (entity === undefined) return [];
    const owed: Payout[] = [];
    for (const name of [...entity.conditions].sort()) {
      const payout = this.conditionDefs.get(name)?.payout;
      if (payout === undefined || payout.on !== on || payout.effects.length === 0) continue;
      owed.push({
        condition: name,
        effects: payout.effects,
        ...(payout.when === undefined ? {} : { when: payout.when }),
        ...(payout.auto === undefined ? {} : { auto: payout.auto }),
        ...(payout.keeps === undefined ? {} : { keeps: payout.keeps }),
      });
    }
    return owed;
  }

  /**
   * What the conditions on a creature add to an Armor Slot they just marked,
   * and which of them are spent if that is what saved them.
   */
  armorAid(id: string): { steps: number; endsWhenItSaves: readonly string[] } {
    const entity = this.state.entity(id);
    if (entity === undefined) return { steps: 0, endsWhenItSaves: [] };
    let steps = 0;
    const spent: string[] = [];
    for (const name of entity.conditions) {
      const armor = this.conditionDefs.get(name)?.armor;
      if (armor === undefined) continue;
      steps += armor.steps;
      if (armor.endsWhenItSaves === true) spent.push(name);
    }
    return { steps, endsWhenItSaves: spent };
  }

  factionOf(id: string): 'party' | 'adversary' | null {
    const faction = this.state.entity(id)?.faction;
    return faction === 'party' || faction === 'adversary' ? faction : null;
  }

  countAlive(faction: 'party' | 'adversary'): number {
    return this.state.entitiesOf(faction).filter((e) => e.alive).length;
  }

  startCountdown(countdown: RunningCountdown): void {
    this.scenario.countdowns.set(countdown.id, countdown);
  }

  /**
   * Creatures ordered by how close they are to another, ties by id.
   *
   * The same order the GM's own targeting uses, and for the same reason: a
   * feature that takes "up to five allies" has to take the same five every
   * time a seed is replayed.
   */
  nearestFirst(from: string, ids: readonly string[]): string[] {
    const here = this.state.entity(from)?.tile ?? NO_TILE;
    if (here === NO_TILE) return [...ids].sort((a, b) => a.localeCompare(b));
    const away = (id: string): number => {
      const tile = this.state.entity(id)?.tile ?? NO_TILE;
      return tile === NO_TILE ? Infinity : this.state.grid.manhattanDistance(here, tile);
    };
    return [...ids].sort((a, b) => away(a) - away(b) || a.localeCompare(b));
  }

  /** The clocks the fight is carrying, in the order they were armed. */
  // ---- zones ----------------------------------------------------------------

  /** Where a creature is standing, or `NO_TILE` for one that is nowhere. */
  tileOf(id: string): number {
    return this.state.entity(id)?.tile ?? NO_TILE;
  }

  zones(): readonly RunningZone[] {
    return [...this.scenario.zones.values()];
  }

  /**
   * The tiles a zone holds: every one within its band of its anchor, by the
   * same measure `refreshZones` uses to decide who is standing in it. So what
   * is drawn is the rule, not a picture of it - a creature on a painted tile
   * bears the condition, and one off it does not.
   */
  zoneFootprint(zone: RunningZone): number[] {
    const tiles: number[] = [];
    for (let tile = 0; tile < this.state.grid.size; tile++) {
      const band = this.bandBetween(zone.anchor, tile);
      if (band !== null && reaches(band, zone.band)) tiles.push(tile);
    }
    return tiles;
  }

  /** Every standing zone with its ground, for a board that draws them. */
  zoneFootprints(): { id: string; name: string; condition: string; owner: string | null; tiles: number[] }[] {
    return this.zones().map((zone) => ({
      id: zone.id,
      name: zone.name,
      condition: zone.condition,
      owner: zone.owner,
      tiles: this.zoneFootprint(zone),
    }));
  }

  /**
   * Put a zone on the map, or move the one already standing under that id.
   *
   * Casting a spell again under the same id is the SRD's "or you cast it
   * again": the old patch of ground goes and the new one takes its place, so
   * whoever was standing in the first is no longer standing in anything.
   */
  placeZone(zone: RunningZone): void {
    const standing = this.scenario.zones.get(zone.id);
    if (standing !== undefined && standing.condition !== zone.condition) this.stripZone(standing.condition);
    this.scenario.zones.set(zone.id, zone);
    this.refreshZones();
  }

  /** Take a zone off the map, and its condition off everybody in it. */
  endZone(id: string): boolean {
    const zone = this.scenario.zones.get(id);
    if (zone === undefined) return false;
    this.scenario.zones.delete(id);
    this.stripZone(zone.condition);
    this.refreshZones();
    return true;
  }

  /**
   * Make what everybody bears match where they are standing.
   *
   * A zone is a condition applied by geography, so this is the whole of what a
   * zone *does*: walk in and you have it, walk out and you do not. Called
   * wherever somebody may have moved; it is cheap when the board is empty,
   * which is nearly always, and it is written to be safe to call twice.
   *
   * A zone whose owner has fallen and does not outlive them comes off first,
   * so nobody is left standing in a dead wizard's light.
   */
  refreshZones(): void {
    const board = this.scenario.zones;
    if (board.size === 0) return;
    for (const zone of [...board.values()]) {
      if (zone.onDeath !== 'end' || zone.owner === null) continue;
      if (this.state.entity(zone.owner)?.alive === true) continue;
      board.delete(zone.id);
      this.stripZone(zone.condition);
    }

    const standing = [...this.state.entitiesOf('party'), ...this.state.entitiesOf('adversary')];
    const inside = new Map<string, Set<string>>();
    // Whose spell each patch of ground is, for the script a crossing may run.
    const owners = new Map<string, string | null>();
    for (const zone of board.values()) {
      const held = inside.get(zone.condition) ?? new Set<string>();
      if (!owners.has(zone.condition)) owners.set(zone.condition, zone.owner);
      const mine = zone.owner === null ? 'party' : this.factionOf(zone.owner);
      for (const entity of standing) {
        if (!entity.alive || entity.tile === NO_TILE) continue;
        if (zone.side !== undefined && mine !== null) {
          const want = zone.side === 'allies' ? mine : mine === 'party' ? 'adversary' : 'party';
          if (entity.faction !== want) continue;
        }
        const band = this.bandBetween(zone.anchor, entity.tile);
        if (band === null || !reaches(band, zone.band)) continue;
        held.add(entity.id);
      }
      inside.set(zone.condition, held);
    }

    for (const [condition, ids] of inside) {
      const bites = this.conditionDefs.get(condition)?.onEnter;
      for (const entity of standing) {
        const should = ids.has(entity.id);
        const has = entity.conditions.has(condition);
        if (should && !has) {
          this.applyCondition(entity.id, condition, 'scene');
          // The crossing, for whoever drains it: the ground only bites the one
          // who was not standing in it a moment ago.
          if (bites !== undefined && bites.effects.length > 0) {
            this.entered.push({ id: entity.id, condition, owner: owners.get(condition) ?? null });
          }
        } else if (!should && has) this.clearCondition(entity.id, condition);
      }
    }
  }

  /**
   * Who has just walked into ground that means something, and what it says.
   *
   * Drained rather than run here: the world has no runner, and a script that
   * damages somebody has to go through the same path every other script does.
   * `settleFight` refreshes the zones and drains this in the same breath.
   */
  drainEntered(): ZoneEntry[] {
    const crossed = [...this.entered];
    this.entered.length = 0;
    return crossed;
  }

  /** The zones a creature is standing in, by the condition they are bearing. */
  private zonesOver(id: string): RunningZone[] {
    const entity = this.state.entity(id);
    if (entity === undefined || this.scenario.zones.size === 0) return [];
    return [...this.scenario.zones.values()].filter((zone) => entity.conditions.has(zone.condition));
  }

  /**
   * A blow was answered by the ground somebody was standing on, so the ground
   * is that much more spent: "you then increase the die's value by one. When
   * the die's value would exceed 6, this effect ends."
   */
  private growZones(id: string): void {
    for (const zone of this.zonesOver(id)) {
      if (zone.grows === undefined || zone.value === undefined) continue;
      const value = zone.value + zone.grows.by;
      if (value > zone.grows.until) this.endZone(zone.id);
      else this.scenario.zones.set(zone.id, { ...zone, value });
    }
  }

  /** Take one zone's condition off everybody, standing in one or not. */
  private stripZone(condition: string): void {
    for (const entity of [...this.state.entitiesOf('party'), ...this.state.entitiesOf('adversary')]) {
      this.clearCondition(entity.id, condition);
    }
  }

  countdowns(): readonly RunningCountdown[] {
    return [...this.scenario.countdowns.values()];
  }

  /**
   * Something happened at the table: advance whatever was waiting on it.
   *
   * The countdowns that moved come back, the ones that reached 0 marked
   * `fired`, and playing what those do is the caller's — the world has no
   * runner and a countdown's effects are a script.
   */
  advanceCountdowns(cue: CountdownCue, rng: Rng): CountdownMoved[] {
    return advanceBoard(this.scenario.countdowns, cue, rng);
  }

  /**
   * Countdowns whose owner has fallen: ended, or set off where the feature
   * says they go off. Safe to call after every death — a countdown leaves the
   * board either way, so nothing fires twice.
   */
  reapCountdowns(): CountdownMoved[] {
    return reapBoard(this.scenario.countdowns, (id) => {
      const entity = this.state.entity(id);
      // Not in this room is not the same as dead: the scenario carries a clock
      // from room to room, and the creature that armed it does not follow.
      if (entity === undefined) return 'gone';
      return entity.alive ? 'alive' : 'fallen';
    });
  }

  /** The fight is over: the clocks its creatures were counting stop. */
  endCreatureCountdowns(): void {
    endCreatureCountdowns(this.scenario.countdowns);
  }

  actorId(): string | null {
    return this.scenario.actorId;
  }

  /**
   * How many of a domain's cards a character has active. Null for anyone
   * without a sheet: an adversary has no loadout, and a condition that reads
   * one of them is false rather than an error.
   */
  loadoutDomain(id: string, domain: string): number | null {
    const character = this.characters.get(id);
    if (character === undefined) return null;
    const active = new Set(loadoutOf(character));
    return character.cards.filter((card) => active.has(card.id) && card.domain === domain).length;
  }

  inCombat(): boolean {
    return this.fighting();
  }

  /** The acting character's sheet, when the actor is a party member with one. */
  private actorCharacter(): DerivedCharacter | undefined {
    const id = this.scenario.actorId;
    return id === null ? undefined : this.characters.get(id);
  }

  traitModifier(trait: Trait): number {
    return this.traits[trait] ?? 0;
  }

  checkModifier(trait: CheckTrait, as: 'party' | 'actor'): number | null {
    const character = this.actorCharacter();
    const actor = this.scenario.actorId;
    // What the sheet adds to *any* action roll. The two branches below get it
    // from `rollBonus` along with their own kind; a plain trait check asks for
    // no kind at all, so it is added here by hand.
    //
    // Read from the actor's chair even when the trait is the party's best: the
    // modifier belongs to whoever is making the roll, and the borrowed trait is
    // only where the number came from.
    const any = actor === null ? 0 : this.rollBonus(actor, 'actionRoll');
    if (trait === 'spellcast') {
      if (character?.spellcastTrait === undefined || actor === null) return null;
      return character.traits[character.spellcastTrait] + this.rollBonus(actor, 'spellcastRoll');
    }
    if (trait === 'weapon') {
      if (character === undefined || actor === null) return null;
      const weapon = character.primaryWeapon;
      return character.traits[weapon?.trait ?? UNARMED.trait] + this.rollBonus(actor, 'attackRoll', { melee: (weapon?.range ?? UNARMED.range) === 'melee' });
    }
    if (as === 'actor' && character !== undefined) return character.traits[trait] + any;
    return this.traitModifier(trait) + any;
  }

  // ---- modifiers -------------------------------------------------------------

  /**
   * Every modifier on a creature right now: its abilities' (those whose
   * `when` holds, read with the creature as the actor) and its conditions'.
   * Static ability modifiers are already in the derived numbers, so only the
   * `when`-gated ones count for pools; every one counts for a roll.
   */
  /**
   * The abilities a creature holds: a character's class, subclass and loadout,
   * or the features printed on an adversary's stat block. One question, so
   * that what a passive says holds on either side of the table.
   */
  heldBy(id: string): readonly AbilityDef[] {
    const character = this.characters.get(id);
    const own = character !== undefined ? abilitiesFor(this.inPlay(character), this.abilities) : this.abilitiesOfEntity(id);
    // And whatever a condition has lent them. A spell cast *on* somebody puts
    // the card's own reaction in their hands for as long as it lasts, which is
    // the only way an ally who does not hold the card can answer with it.
    const lent = this.lentTo(id);
    return lent.length === 0 ? own : [...own, ...lent];
  }

  /** A character with the cards granted to them as the content stands now, not as it stood. */
  private inPlay(character: DerivedCharacter): DerivedCharacter {
    return this.cards === null ? character : { ...character, granted: grantedCards(character.sheet, this.cards().values()) };
  }

  private abilitiesOfEntity(id: string): readonly AbilityDef[] {
    const entity = this.state.entity(id);
    return entity === undefined ? [] : this.abilitiesForAdversary(entity.definition);
  }

  /** The abilities the conditions on a creature grant them, in a stable order. */
  private lentTo(id: string): AbilityDef[] {
    const entity = this.state.entity(id);
    if (entity === undefined || entity.conditions.size === 0) return [];
    const lent: AbilityDef[] = [];
    for (const name of [...entity.conditions].sort()) {
      const granted = this.conditionDefs.get(name)?.grants;
      if (granted === undefined) continue;
      const ability = this.abilities.find((a) => a.id === granted.ability);
      if (ability !== undefined) lent.push(ability);
    }
    return lent;
  }

  modifiersOf(id: string, scope: 'roll' | 'pool', bindings: TargetBindings = { targets: [], hit: [] }): AbilityModifier[] {
    const entity = this.state.entity(id);
    if (entity === undefined) return [];
    const character = this.characters.get(id);
    // A character's are derived once, with the armour and the class in them; a
    // stat block's are read off the passives it prints.
    const mine =
      character !== undefined
        ? character.modifiers
        : this.heldBy(id).filter((a) => a.kind === 'passive').flatMap((a) => a.modifiers);
    const own = mine.filter((m) => {
      // A character's unconditional modifiers are already in the numbers
      // `deriveCharacter` worked out, so only the scene-dependent ones are
      // added again here. A stat block is not derived: what its passives say
      // is only ever read from here, so all of them count.
      // …except one that counts tokens, which `deriveCharacter` deliberately
      // left out: it is read here, with however many are on the card now.
      if (scope === 'pool' && m.when === undefined && m.perToken === undefined && character !== undefined) return false;
      if (m.when === undefined) return true;
      // Read from the holder's chair: "while within Melee range" on a stat
      // block means within Melee of *it*, and the bindings name whoever the
      // question is about - the creature swinging at it, usually.
      const was = this.scenario.actorId;
      this.scenario.actorId = id;
      const holds = evaluate(m.when, this, bindings);
      this.scenario.actorId = was;
      return holds;
    });
    const worn: AbilityModifier[] = [];
    for (const condition of entity.conditions) {
      const def = this.conditionDefs.get(condition);
      if (def !== undefined) worn.push(...def.modifiers);
    }
    return [...own, ...worn];
  }

  /**
   * What a stat block's passives say about the swing it prints — at the moment
   * only whether it goes through armour. Read from the definition, because a
   * block's passives belong to the block and not to one creature standing on
   * the map.
   */
  standardAttackOf(definition: string, between?: { attacker: string; target: string }): {
    direct?: boolean;
    damage?: ParsedDamage;
    double?: boolean;
    severity?: DamageSeverity;
  } {
    let direct = false;
    let damage: ParsedDamage | undefined;
    let double = false;
    let severity: DamageSeverity | undefined;
    for (const ability of this.abilitiesForAdversary(definition)) {
      const swing = ability.kind === 'passive' ? ability.standardAttack : undefined;
      if (swing === undefined) continue;
      // "If the Sniper is Hidden when they make a successful standard attack":
      // read from the attacker's chair with the target bound, so a condition
      // on either of them is a plain `hasCondition`. A passive that says
      // nothing about when always applies, which is what `direct` meant.
      if (swing.when !== undefined) {
        if (between === undefined) continue;
        const was = this.scenario.actorId;
        this.scenario.actorId = between.attacker;
        const holds = evaluate(swing.when, this, { targets: [between.target], hit: [between.target] });
        this.scenario.actorId = was;
        if (!holds) continue;
      }
      if (swing.direct === true) direct = true;
      if (swing.double === true) double = true;
      if (swing.severity !== undefined) severity = swing.severity;
      // Last one printed wins, which is only ever one of them: no block prints
      // two swaps that could hold at once.
      if (swing.damage !== undefined) damage = parseDice(swing.damage) ?? damage;
    }
    return {
      ...(direct ? { direct: true } : {}),
      ...(damage === undefined ? {} : { damage }),
      ...(double ? { double: true } : {}),
      ...(severity === undefined ? {} : { severity }),
    };
  }

  /**
   * The damage types a creature halves or ignores: what its passives say, plus
   * what the conditions on it say. Nothing stacks — resisting physical twice
   * halves it once, which is the SRD's rule and also the only sane reading.
   */
  defensesOf(id: string): DamageDefenses {
    const resistances = new Set<DamageType>();
    const immunities = new Set<DamageType>();
    // Reduction stacks rather than merging: two passives that each take 3 off
    // take 6, which is how a table reads two lines that both say "reduce it".
    const reduce: DamageReduction[] = [];
    const take = (defenses: DamageDefenses | undefined): void => {
      for (const type of defenses?.resistances ?? []) resistances.add(type);
      for (const type of defenses?.immunities ?? []) immunities.add(type);
      for (const entry of defenses?.reduce ?? []) reduce.push(entry);
    };
    for (const ability of this.heldBy(id)) {
      if (ability.kind === 'passive') take(ability.defenses);
    }
    for (const condition of this.state.entity(id)?.conditions ?? []) {
      take(this.conditionDefs.get(condition)?.defenses);
    }
    // And what the ground they are standing on takes off it. Written as a
    // flat reduction because that is what "reduce it by the die's value" is;
    // the die itself lives on the zone, where everybody in it reads the same
    // one.
    for (const zone of this.zonesOver(id)) {
      if (zone.value !== undefined && zone.value > 0) reduce.push({ dice: String(zone.value) });
    }
    return {
      ...(resistances.size === 0 ? {} : { resistances: [...resistances] }),
      ...(immunities.size === 0 ? {} : { immunities: [...immunities] }),
      ...(reduce.length === 0 ? {} : { reduce }),
    };
  }

  private sumModifiers(id: string, modifiers: readonly AbilityModifier[]): number {
    const character = this.characters.get(id);
    return modifiers.reduce((sum, m) => {
      const one =
        m.bonus +
        (character === undefined ? 0 : traitPart(m, character.traits)) +
        (m.plusProficiency === true ? this.proficiencyOf(id) : 0);
      // "A +5 bonus to your damage roll for each token on this card": the
      // whole bonus, once per token, and nothing at all with an empty card.
      return sum + (m.perToken === undefined ? one : one * this.tokensOn(id, m.perToken));
    }, 0);
  }

  /**
   * The bonus a creature's modifiers add to a roll of this kind.
   *
   * An `actionRoll` modifier is one that reads on every action roll there is,
   * so asking for the attack or the Spellcast bonus gets it too: a caller that
   * is about to make an action roll should not have to know which cards happen
   * to be worded that way. `damageRoll` is the one that does not, being a roll
   * the rules do not call an action roll - and asking for `actionRoll` itself
   * gets it once, not twice.
   */
  rollBonus(id: string, stat: RollStat, context: { melee?: boolean } = {}): number {
    const alsoAny = stat === 'attackRoll' || stat === 'spellcastRoll';
    const applicable = this.modifiersOf(id, 'roll').filter(
      (m) =>
        (m.stat === stat || (alsoAny && m.stat === 'actionRoll')) &&
        m.against !== true &&
        (m.requires !== 'meleeWeapon' || context.melee === true),
    );
    return this.sumModifiers(id, applicable);
  }

  /** What a creature's scene-dependent modifiers add to a pool or a defence. */
  poolBonus(id: string, stat: PoolStat): number {
    const applicable = this.modifiersOf(id, 'pool').filter(
      (m) => m.stat === stat && m.against !== true && m.requires !== 'meleeWeapon',
    );
    return this.sumModifiers(id, applicable);
  }

  /**
   * The advantage and disadvantage dice a swing carries beyond what the
   * target's conditions already say: what the attacker's own passives grant
   * ("the Assassin has advantage on attacks if they are Hidden") and what the
   * defender's take away ("creatures within Melee range of the Gaoler have
   * disadvantage on attack rolls against them").
   *
   * Each side is read from its own chair, with the other bound as the target,
   * so a range in either sentence measures from the creature the passive
   * belongs to. They come back as counts because that is what the roll takes;
   * a die of each still cancels there.
   */
  advantageFor(attacker: string, defender: string): { advantage: number; disadvantage: number } {
    const mine = this.modifiersOf(attacker, 'roll', { targets: [defender], hit: [] }).filter(
      (m) => m.stat === 'advantage' && m.against !== true,
    );
    const theirs = this.modifiersOf(defender, 'roll', { targets: [attacker], hit: [] }).filter(
      (m) => m.stat === 'advantage' && m.against === true,
    );
    const net = this.sumModifiers(attacker, mine) + this.sumModifiers(defender, theirs);
    return { advantage: Math.max(0, net), disadvantage: Math.max(0, -net) };
  }

  /**
   * The same, with what the feature itself said folded in: "make an attack
   * with advantage" is one more die on the scales, not a separate roll.
   */
  private advantageWith(attacker: string, defender: string, extra: number): { advantage: number; disadvantage: number } {
    const passives = this.advantageFor(attacker, defender);
    const net = passives.advantage - passives.disadvantage + extra;
    return { advantage: Math.max(0, net), disadvantage: Math.max(0, -net) };
  }

  /**
   * The scales the acting creature carries into a roll that is not a swing:
   * the advantage a card gave them for their *next action roll*, whatever
   * they roll it at.
   *
   * Only the modifiers that say so, and only their own: everything else
   * printed about advantage is about an attack, and is read by `advantageFor`
   * with a defender to measure from. Read from the same chair `rollsFrom`
   * spends the condition from, so what pays for the die is what the die is
   * taken off.
   */
  advantageRolling(): { advantage: number; disadvantage: number } {
    const actor = this.scenario.actorId;
    if (actor === null) return { advantage: 0, disadvantage: 0 };
    const mine = this.modifiersOf(actor, 'roll').filter(
      (m) => m.stat === 'advantage' && m.against !== true && m.anyRoll === true,
    );
    const net = this.sumModifiers(actor, mine);
    return { advantage: Math.max(0, net), disadvantage: Math.max(0, -net) };
  }

  /**
   * The other chair of the same roll: what the creatures a check is aimed at
   * do to it. Vulnerable is "all rolls targeting you" and Hidden is "any rolls
   * against you", and neither of those says *attack* — so a Spellcast Roll at
   * something Vulnerable takes the die the swing would have taken.
   *
   * The conditions the attack rules read directly come from the same function
   * the attack path uses, so there is one place that knows those two names;
   * everything else a creature carries is a modifier flagged `against` *and*
   * `anyRoll`, which is what tells "all rolls targeting you" from "attack
   * rolls have disadvantage when targeting you".
   *
   * **House rule** — a check is one roll and may name several creatures, which
   * is the thing that stopped this being written. The answer: the best any
   * target grants and the worst any target imposes, added. A roll that names a
   * Vulnerable creature does target them, so it has the die; one Hidden
   * creature in the group costs it; the two cancel, as dice always do here.
   * Nothing stacks past a single die either way, and `rollDuality` would clamp
   * it if it tried.
   */
  advantageAgainst(targets: readonly string[]): { advantage: number; disadvantage: number } {
    const actor = this.scenario.actorId;
    let best = 0;
    let worst = 0;
    for (const id of targets) {
      const entity = this.state.entity(id);
      if (entity === undefined) continue;
      const theirs = this.modifiersOf(id, 'roll', {
        targets: actor === null ? [] : [actor],
        hit: [],
      }).filter((m) => m.stat === 'advantage' && m.against === true && m.anyRoll === true);
      const conditions = conditionModifiers(entity);
      const net = conditions.advantage - conditions.disadvantage + this.sumModifiers(id, theirs);
      best = Math.max(best, net);
      worst = Math.min(worst, net);
    }
    const net = best + worst;
    return { advantage: Math.max(0, net), disadvantage: Math.max(0, -net) };
  }

  /** The reactions to incoming damage a creature holds. */
  reactionsOf(id: string): AbilityDef[] {
    return this.reactionsFor(id, 'incomingDamage');
  }

  /**
   * The reactions a creature holds that answer this trigger — a defence, or
   * an interrupt like Not This Time. Stunned silences all of them.
   */
  reactionsFor(
    id: string,
    trigger: NonNullable<AbilityDef['trigger']>,
    bindings?: TargetBindings,
  ): AbilityDef[] {
    if (this.blocks(id, 'reactions')) return [];
    // A card's own `available` is read with its holder as the actor, the same
    // way a passive's `when` is: "when you have 2 or fewer Hit Points
    // unmarked" is about the one holding the card, not whoever is swinging.
    //
    // Bindings are for the reaction that answers somebody: a blow binds whoever
    // dealt it, so "when the Knight takes damage from an attack within Melee
    // range" is a plain `withinRange` on the target. Passing an empty binding
    // is not the same as passing none: damage with nobody behind it leaves
    // "the attacker" resolving to nobody, and a feature that asks how far away
    // they are does not fire. Passing none binds the holder to itself, which
    // is what every other trigger wants.
    const was = this.scenario.actorId;
    this.scenario.actorId = id;
    const offered = this.heldBy(id).filter(
      (a) =>
        a.kind === 'reaction' &&
        a.trigger === trigger &&
        (a.available === undefined || evaluate(a.available, this, bindings ?? { targets: [id], hit: [] })),
    );
    this.scenario.actorId = was;
    return offered;
  }

  /**
   * The scripted features of an adversary's stat block. Named by the
   * definition id, not the entity's, so every husk in a room shares them.
   */
  abilitiesForAdversary(definition: string): AbilityDef[] {
    return this.abilities.filter((a) => 'adversaries' in a.source && a.source.adversaries.includes(definition));
  }

  /**
   * The stat block a definition names, out of the content this fight is being
   * played with — the pack the app shipped *and* whatever the project carries.
   *
   * The world already holds that merged map, and until this existed every
   * caller had to reach around it into the shipped one, which quietly answered
   * with the wrong creature for anything a project brought itself.
   */
  adversaryDef(definition: string): AdversaryDef | undefined {
    return this.adversaries.get(definition);
  }

  /** Tokens sitting on a card a creature holds. */
  tokensOn(id: string, ability: string): number {
    return this.scenario.abilityTokens.get(useKey(id, ability)) ?? 0;
  }

  /**
   * Put tokens on a card. With no amount, the card's own count is placed —
   * "a number of tokens equal to your Spellcast trait", with its minimum.
   */
  addTokens(id: string, ability: string, amount?: number): number {
    const key = useKey(id, ability);
    const placed = amount ?? this.tokenCount(id, ability);
    const left = Math.max(0, (this.scenario.abilityTokens.get(key) ?? 0) + placed);
    this.scenario.abilityTokens.set(key, left);
    return left;
  }

  spendTokens(id: string, ability: string, amount: number): number {
    const key = useKey(id, ability);
    const held = this.scenario.abilityTokens.get(key) ?? 0;
    const spent = Math.min(held, Math.max(0, amount));
    this.scenario.abilityTokens.set(key, held - spent);
    return spent;
  }

  /** How many tokens the card places at once, for whoever holds it. */
  tokenCount(id: string, ability: string): number {
    const tokens = this.abilities.find((a) => a.id === ability)?.tokens;
    if (tokens === undefined) return 0;
    const amount =
      typeof tokens.amount === 'number'
        ? tokens.amount
        : tokens.amount === 'spellcast'
          ? (this.spellcastValue(id) ?? 0)
          : tokens.amount === 'domainCards'
            ? (this.loadoutDomain(id, tokens.domain ?? '') ?? 0)
            : (this.traitValue(id, tokens.amount) ?? 0);
    return Math.max(tokens.minimum, amount);
  }

  /**
   * The faces on a creature's Light Die right now: twelve, unless something they
   * are carrying says otherwise. The biggest wins, two cards saying it being a
   * thing that could happen rather than a thing that adds up.
   */
  goodDieSides(id: string): number {
    const entity = this.state.entity(id);
    if (entity === undefined) return GOOD_DIE_SIDES;
    let sides = GOOD_DIE_SIDES;
    for (const name of entity.conditions) {
      const die = this.conditionDefs.get(name)?.goodDie;
      if (die !== undefined) sides = Math.max(sides, die.sides);
    }
    return sides;
  }

  /**
   * Whether anybody in the party is holding a card that answers a roll this
   * creature has just made.
   *
   * Asked before a check pauses, so that a chest, a door and a conversation -
   * every roll nobody has a card for - runs from the dice to its arms without
   * stopping, exactly as it did before there was a moment to stop in.
   *
   * The gates on those cards are read here, with the roller bound, so a card
   * that only answers an ally does not stop the ally-less roll and one that
   * wants a failure does not stop a success.
   */
  markSpot(actor: string, mark: string): boolean {
    const tile = this.state.entity(actor)?.tile ?? NO_TILE;
    if (tile === NO_TILE) return false;
    this.scenario.variables[markKey(mark, actor)] = tile;
    return true;
  }

  recallSpot(actor: string, mark: string): number {
    const value = this.scenario.variables[markKey(mark, actor)];
    return typeof value === 'number' && this.state.grid.isTile(value) ? value : NO_TILE;
  }

  forgetSpot(actor: string, mark: string): boolean {
    const key = markKey(mark, actor);
    if (!(key in this.scenario.variables)) return false;
    delete this.scenario.variables[key];
    return true;
  }

  /** Every spot anybody has marked, for a board that draws them. */
  marks(): { mark: string; owner: string; tile: number }[] {
    const found: { mark: string; owner: string; tile: number }[] = [];
    for (const [name, value] of Object.entries(this.scenario.variables)) {
      const parsed = parseMarkKey(name);
      if (parsed === null || typeof value !== 'number') continue;
      found.push({ mark: parsed.mark, owner: parsed.actor, tile: value });
    }
    return found;
  }

  /** Forget every mark: the party rested, or left the room the tiles were in. */
  forgetSpots(): void {
    for (const name of Object.keys(this.scenario.variables)) {
      if (parseMarkKey(name) !== null) delete this.scenario.variables[name];
    }
  }

  answersRoll(id: string, roll: { total: number; outcome: RollOutcome; tags?: readonly string[]; trait?: CheckTrait }): boolean {
    if (this.state.entity(id)?.faction !== 'party') return false;
    const bindings: TargetBindings = { targets: [id], hit: [id], roll };
    for (const member of this.state.entitiesOf('party')) {
      if (!member.alive) continue;
      if (this.reactionsFor(member.id, 'partyRolling', bindings).some((a) => a.effects.length > 0)) return true;
    }
    return false;
  }

  /**
   * What the roller's own cards will put behind a roll they have just made, and
   * what it costs them.
   *
   * Spent to save a roll that can be saved, and never otherwise: the least
   * number of tokens that carries the total over the Difficulty, nothing when
   * the roll already succeeds, and nothing when even the whole card would not
   * be enough. That is the choice anybody holding it would make, and it is made
   * here rather than asked because the question comes inside a roll, between
   * the dice being read and the check knowing which arm to run.
   *
   * A critical is left alone: matched dice already succeed against anything.
   */
  liftRoll(id: string, trait: CheckTrait, total: number, difficulty: number, critical: boolean): number {
    if (critical || total >= difficulty || !Number.isFinite(difficulty)) return 0;
    let lifted = 0;
    for (const ability of this.heldBy(id)) {
      const lift = ability.lift;
      if (lift === undefined) continue;
      if (lift.only === 'spellcast' && trait !== 'spellcast') continue;
      const held = this.tokensOn(id, ability.id);
      if (held === 0) continue;
      const short = difficulty - (total + lifted);
      if (short <= 0) break;
      const wanted = Math.ceil(short / lift.each);
      if (wanted > held) continue;
      lifted += this.spendTokens(id, ability.id, wanted) * lift.each;
    }
    return lifted;
  }

  /** Logic in code by id, or null when nothing defines it. */
  hook(id: string): HookFn | null {
    return this.hooks().get(id) ?? null;
  }

  /** The conditions on a creature that stop it from doing this. */
  blocking(id: string, what: ConditionBlock): string[] {
    const entity = this.state.entity(id);
    if (entity === undefined) return [];
    return [...entity.conditions].filter((c) => this.conditionDefs.get(c)?.blocks.includes(what) ?? false);
  }

  /**
   * The Armor Slots a creature can actually mark. A condition that forbids
   * armor - Frenzy's rage - leaves them all marked as far as the defence is
   * concerned, so nothing offers a slot that cannot be spent.
   */
  armorFor(id: string): { max: number; marked: number } {
    const entity = this.state.entity(id);
    if (entity === undefined) return { max: 0, marked: 0 };
    return this.blocks(id, 'armor') ? { ...entity.armorSlots, marked: entity.armorSlots.max } : entity.armorSlots;
  }

  blocks(id: string, what: ConditionBlock): boolean {
    return this.blocking(id, what).length > 0;
  }

  /** Conditions that end when an attack succeeds against their bearer — Rogue's Dodge. */
  endsOnHit(id: string): string[] {
    return this.endConditions(id, 'hit');
  }

  /** Conditions that end when damage marks something of their bearer's — Asleep. */
  endsOnDamage(id: string): string[] {
    return this.endConditions(id, 'damaged');
  }

  /** Conditions that end when their bearer makes an attack — Hidden. */
  endsOnAttack(id: string): string[] {
    return this.endConditions(id, 'attacks');
  }

  /**
   * Conditions that end when their bearer makes an action roll of any kind —
   * "your *next* action roll has advantage", which is spent on whatever they
   * roll next rather than on the next thing they swing at.
   */
  endsOnRoll(id: string): string[] {
    return this.endConditions(id, 'rolls');
  }

  private endConditions(id: string, when: NonNullable<ConditionDef['endsWhen']>): string[] {
    const entity = this.state.entity(id);
    if (entity === undefined) return [];
    const ended: string[] = [];
    for (const condition of [...entity.conditions]) {
      if (this.conditionDefs.get(condition)?.endsWhen === when) {
        entity.conditions.delete(condition);
        entity.conditionDurations.delete(condition);
        ended.push(condition);
      }
    }
    return ended;
  }

  /** A character's primary weapon dice (unarmed when they carry none); an adversary's attack. */
  /** The same order `nearestFirst` gives, measured from a tile rather than a creature. */
  private nearestToTile(at: number, ids: readonly string[]): string[] {
    return [...ids].sort(
      (a, b) =>
        this.state.grid.manhattanDistance(at, this.state.entity(a)?.tile ?? NO_TILE) -
          this.state.grid.manhattanDistance(at, this.state.entity(b)?.tile ?? NO_TILE) || a.localeCompare(b),
    );
  }

  /** How far a character's weapon reaches, or nothing for anyone without one. */
  weaponRange(id: string): RangeBand | null {
    const character = this.characters.get(id);
    return character === undefined ? null : attackProfile(character).range;
  }

  weaponDamage(id: string): ParsedDamage | null {
    const character = this.characters.get(id);
    if (character !== undefined) return attackProfile(character).damage;
    const entity = this.state.entity(id);
    const def = entity === undefined ? undefined : this.adversaries.get(entity.definition);
    return def?.attackDamage ?? null;
  }

  experiences(): readonly { name: string; modifier: number }[] {
    return this.actorCharacter()?.experiences ?? [];
  }

  difficultyOf(id: string): number | null {
    const entity = this.state.entity(id);
    if (entity === undefined) return null;
    return this.defenderOf(entity).difficulty;
  }

  hasCondition(id: string, condition: string): boolean {
    return this.state.entity(id)?.conditions.has(condition) ?? false;
  }

  poolValue(id: string, pool: PoolName, measure: 'available' | 'marked' | 'max'): number | null {
    const entity = this.state.entity(id);
    if (entity === undefined) return null;
    if (pool === 'good') {
      if (entity.good === undefined) return null;
      return measure === 'max' ? entity.good.max : measure === 'marked' ? entity.good.max - entity.good.value : entity.good.value;
    }
    const track = entity[pool];
    return measure === 'max' ? track.max : measure === 'marked' ? track.marked : unmarked(track);
  }

  bandTo(from: string, to: string): RangeBand | null {
    return this.bandBetween(this.state.entity(from)?.tile ?? NO_TILE, this.state.entity(to)?.tile ?? NO_TILE);
  }

  /**
   * The same measure between two tiles rather than two creatures, which is
   * what a shape aimed at a point needs: the ground has no entity to look up.
   */
  bandBetween(a: number, b: number): RangeBand | null {
    if (a === NO_TILE || b === NO_TILE) return null;
    // The same rule as targeting: as the crow flies, to the nearest tile.
    return bandForSpan(this.state.grid.euclideanDistance(a, b), this.bandTiles);
  }

  /**
   * Every living creature standing within `range` of the straight line from a
   * tile to a tile: the far endpoint included, the near one not.
   *
   * The run leaves the tile it started on, so what was standing beside the
   * charger before it moved is behind it rather than in its way. Keeping that
   * tile would make a charge with somebody at its elbow catch them whichever
   * way it was aimed, which is not what "all targets in their path" means.
   *
   * The line is the one sight is traced along, so a charge and a look down the
   * same corridor agree about what is on it. Nothing here asks whether the
   * ground is passable: a gallop that ends in a wall is the map's business and
   * the mover's, not the shape's.
   */
  alongPath(from: number, to: number, range: RangeBand, except: readonly string[] = []): string[] {
    if (from === NO_TILE || to === NO_TILE) return [];
    const walked: number[] = [];
    traceLine(this.state.grid, from, to, (tile) => {
      walked.push(tile);
    });
    const line = walked.filter((tile) => tile !== from);
    const left = new Set(except);
    const caught: string[] = [];
    for (const entity of [...this.state.entitiesOf('party'), ...this.state.entitiesOf('adversary')]) {
      if (!entity.alive || entity.tile === NO_TILE || left.has(entity.id)) continue;
      const near = line.some((tile) => {
        const band = this.bandBetween(tile, entity.tile);
        return band !== null && reaches(band, range);
      });
      if (near) caught.push(entity.id);
    }
    return caught;
  }

  proficiencyOf(id: string): number {
    return this.characters.get(id)?.sheet.proficiency ?? 1;
  }

  /**
   * A trait off a creature's sheet, or the one they cast with. A stat block has
   * no traits and reads null, which every caller turns into nothing happening.
   */
  traitValue(id: string, trait: Trait | 'spellcast' | 'proficiency'): number | null {
    if (trait === 'spellcast') return this.spellcastValue(id);
    if (trait === 'proficiency') return this.characters.has(id) ? this.proficiencyOf(id) : null;
    return this.characters.get(id)?.traits[trait] ?? null;
  }

  spellcastValue(id: string): number | null {
    const character = this.characters.get(id);
    if (character?.spellcastTrait === undefined) return null;
    return character.traits[character.spellcastTrait];
  }

  /** Who a selector names, living and in a stable order. */
  resolveTargets(selector: TargetSelector, bindings: TargetBindings): string[] {
    const living = (ids: readonly string[]): string[] =>
      ids.filter((id) => this.state.entity(id)?.alive === true);
    switch (selector.kind) {
      case 'actor': {
        const id = this.scenario.actorId;
        return id === null || this.state.entity(id) === undefined ? [] : [id];
      }
      case 'party':
        return this.state.entitiesOf('party').filter((e) => e.alive).map((e) => e.id);
      case 'entity':
        return this.state.entity(selector.id) === undefined ? [] : [selector.id];
      case 'entities':
        return living(selector.ids);
      case 'target':
        return living(bindings.targets);
      case 'hit': {
        const beaten = living(bindings.hit).filter(
          (id) => selector.having === undefined || this.state.entity(id)?.conditions.has(selector.having) === true,
        );
        if (selector.nearest === undefined || this.scenario.actorId === null) return beaten;
        return this.nearestFirst(this.scenario.actorId, beaten).slice(0, selector.nearest);
      }
      case 'allies': {
        const actor = this.scenario.actorId;
        if (selector.around === 'point') {
          const at = bindings.point ?? NO_TILE;
          if (at === NO_TILE) return [];
          return this.state
            .entitiesOf('party')
            .filter((e) => e.alive && e.tile !== NO_TILE && (selector.includeSelf === true || e.id !== actor))
            .filter((e) => {
              const band = this.bandBetween(at, e.tile);
              return band !== null && (selector.range === undefined || reaches(band, selector.range));
            })
            .map((e) => e.id);
        }
        const left = selector.except === 'target' ? new Set(bindings.targets) : null;
        // "An ally within Melee range of the adversary": measured from the one
        // the script is aimed at rather than from the one casting it. With
        // nobody bound the band has nothing to measure from and names nobody,
        // which is the same quiet answer every other selector gives.
        const from = selector.around === 'target' ? (bindings.targets[0] ?? null) : actor;
        if (selector.around === 'target' && from === null) return [];
        const standing = this.state
          .entitiesOf('party')
          .filter((e) => e.alive && (selector.includeSelf === true || e.id !== actor))
          .filter((e) => !(left?.has(e.id) ?? false))
          .filter((e) => selector.range === undefined || from === null || this.within(from, e.id, selector.range))
          .map((e) => e.id);
        if (selector.nearest === undefined || from === null) return standing;
        return this.nearestFirst(from, standing).slice(0, selector.nearest);
      }
      case 'inPath': {
        const actor = this.scenario.actorId;
        const from = actor === null ? NO_TILE : (this.state.entity(actor)?.tile ?? NO_TILE);
        const reach =
          selector.reach === 'weapon' && actor !== null
            ? (this.weaponRange(actor) ?? selector.range ?? 'melee')
            : (selector.range ?? 'melee');
        const caught = this.alongPath(from, bindings.point ?? NO_TILE, reach, actor === null ? [] : [actor]);
        if (selector.side === undefined) return caught;
        const want = selector.side === 'allies' ? 'party' : 'adversary';
        return caught.filter((id) => this.state.entity(id)?.faction === want);
      }
      case 'adversaries': {
        // Around the tile that was picked, when the card aims at one: the band
        // is measured from the ground rather than from anybody standing on it.
        if (selector.around === 'point') {
          const at = bindings.point ?? NO_TILE;
          if (at === NO_TILE) return [];
          const near = this.state.entitiesOf('adversary').filter((e) => {
            if (!e.alive || e.tile === NO_TILE) return false;
            const band = this.bandBetween(at, e.tile);
            return band !== null && reaches(band, selector.range);
          });
          const ids = near.map((e) => e.id);
          return selector.nearest === undefined ? ids : this.nearestToTile(at, ids).slice(0, selector.nearest);
        }
        const origin = selector.around === 'target' ? bindings.targets[0] : this.scenario.actorId;
        if (origin === undefined || origin === null) return [];
        const left =
          selector.except === 'target'
            ? new Set(bindings.targets)
            : selector.except === 'actor' && this.scenario.actorId !== null
              ? new Set([this.scenario.actorId])
              : null;
        // "All Giant Rats", not "all adversaries": the same stat block as the
        // one acting. A creature with no block — a party member running a
        // card — names nobody, which is what "the rest of its kind" means
        // when there is no kind.
        const kind =
          selector.sameKind !== true
            ? null
            : (this.scenario.actorId === null ? undefined : this.state.entity(this.scenario.actorId)?.definition) ?? '';
        // "Within your weapon's range" is whatever the actor is holding; a
        // creature the engine has no weapon for keeps the band the card named.
        const reach =
          selector.reach === 'weapon'
            ? (this.scenario.actorId === null ? null : this.weaponRange(this.scenario.actorId)) ?? selector.range
            : selector.range;
        const standing = this.state
          .entitiesOf('adversary')
          .filter((e) => e.alive && !(left?.has(e.id) ?? false) && (kind === null || e.definition === kind))
          .filter((e) => this.within(origin, e.id, reach))
          .map((e) => e.id);
        if (selector.nearest === undefined) return standing;
        return this.nearestFirst(origin, standing).slice(0, selector.nearest);
      }
    }
  }

  private within(from: string, to: string, range: RangeBand): boolean {
    const band = this.bandTo(from, to);
    return band !== null && reaches(band, range);
  }

  // ---- writes --------------------------------------------------------------

  setFlag(flag: string): void {
    this.scenario.flags.add(flag);
  }

  clearFlag(flag: string): void {
    this.scenario.flags.delete(flag);
  }

  giveKey(key: string): void {
    this.addItem(key, 1);
  }

  /** Draw from one of the project's tables. An unknown table finds nothing. */
  rollLoot(table: string | undefined, rng: Rng): LootDrop[] {
    if (table === undefined) return [];
    const found = this.lootTables.get(table);
    return found === undefined ? [] : rollLoot(found, rng);
  }

  addItem(item: string, quantity = 1): number {
    if (quantity <= 0) return this.itemCount(item);
    const next = this.itemCount(item) + quantity;
    this.scenario.items.set(item, next);
    return next;
  }

  /** Take some away, and report how many actually went. */
  removeItem(item: string, quantity = 1): number {
    const held = this.itemCount(item);
    // Taking more than the party has takes what it has, rather than going
    // negative and leaving a phantom debt in the save.
    const taken = Math.max(0, Math.min(held, quantity));
    if (taken === 0) return 0;
    if (held - taken === 0) this.scenario.items.delete(item);
    else this.scenario.items.set(item, held - taken);
    return taken;
  }

  // ---- quests --------------------------------------------------------------
  //
  // Completed and failed are terminal: a finished quest does not restart, a
  // failed one is not completed by a late objective. Finishing is explicit —
  // ticking the last objective does not complete a quest, because "you have
  // everything, now bring it back" is a beat a designer places on purpose.

  gainGood(): boolean {
    const id = this.scenario.actorId;
    return id !== null && this.gainGoodFor(id, 1) > 0;
  }

  /**
   * "Steal a number of Shadow from the GM": the pool goes down rather than up,
   * and an empty pool is nothing stolen rather than a refusal.
   */
  loseBad(): boolean {
    if (this.state.bad.value <= 0) return false;
    this.state.bad = { ...this.state.bad, value: this.state.bad.value - 1 };
    return true;
  }

  gainBad(): boolean {
    const result = gain(this.state.bad);
    this.state.bad = result.currency;
    return result.applied > 0;
  }

  grantLevel(level?: number): number | null {
    const target = Math.min(10, level ?? this.scenario.partyLevel + 1);
    if (target <= this.scenario.partyLevel) return null;
    this.scenario.partyLevel = target;
    return target;
  }

  startQuest(quest: string): boolean {
    if (this.scenario.quests.has(quest)) return false;
    this.scenario.quests.set(quest, { status: 'active', done: new Set(), revealed: new Set() });
    return true;
  }

  revealObjective(quest: string, objective: string): boolean {
    const progress = this.scenario.quests.get(quest);
    if (progress === undefined || progress.status !== 'active') return false;
    if (progress.revealed.has(objective) || progress.done.has(objective)) return false;
    progress.revealed.add(objective);
    return true;
  }

  completeObjective(quest: string, objective: string): boolean {
    const progress = this.scenario.quests.get(quest);
    if (progress === undefined || progress.status !== 'active') return false;
    if (progress.done.has(objective)) return false;
    progress.done.add(objective);
    return true;
  }

  completeQuest(quest: string): boolean {
    return this.finishQuest(quest, 'completed');
  }

  failQuest(quest: string): boolean {
    return this.finishQuest(quest, 'failed');
  }

  private finishQuest(quest: string, status: 'completed' | 'failed'): boolean {
    const progress = this.scenario.quests.get(quest);
    if (progress === undefined || progress.status !== 'active') return false;
    progress.status = status;
    return true;
  }

  setVar(name: string, value: ScriptValue): void {
    this.scenario.variables[name] = value;
  }

  openInteractable(id: string): void {
    // Through the method, not the flag: an opened door has to stop blocking its
    // tile, or unlocking one leaves the party standing in front of it.
    this.state.openInteractable(id);
  }

  removeInteractable(id: string): void {
    const s = this.state.interactable(id);
    s.removed = true;
    // A removed interactable stops blocking the tile it stood on.
    const tile = this.state.interactableTile(id);
    if (tile >= 0) this.state.setInteractableBlocking(tile, false);
  }

  markInteractableUsed(id: string): void {
    this.state.interactable(id).used = true;
  }

  startEncounter(id: string): void {
    this.state.encounter(id).started = true;
    this.state.encounter(id).triggered = true;
  }

  endEncounter(id: string): void {
    this.state.encounter(id).ended = true;
  }

  /**
   * Hit Points marked outright: "force them to mark 5 Hit Points", the vines
   * that squeeze, a trap. Past the thresholds and past any armor, because the
   * number is what the card said rather than what a blow rolled.
   *
   * Heard the same way a rolled wound is. A wound is a wound however it was
   * dealt: the Shark still smells the blood, and a stat block that answers
   * being hurt still answers. Nobody is named, like damage out of any other
   * script, so the ones that hit back have nobody to hit.
   */
  damage(target: TargetSelector, amount: number, _source?: string, bindings: TargetBindings = { targets: [], hit: [] }): number {
    let total = 0;
    for (const entity of this.entitiesFor(target, bindings)) {
      const result = markHitPoints(entity.hitPoints, amount);
      entity.hitPoints = result.hitPoints;
      if (result.fell) entity.alive = false;
      if (result.hpMarked > 0) {
        this.noteDamage(entity.id, {
          hitPoints: result.hpMarked,
          damage: amount,
          severe: result.hpMarked >= hpForSeverity('severe'),
        });
      }
      total += result.hpMarked;
    }
    return total;
  }

  /**
   * Share a number of Hit Points out among several creatures rather than
   * giving each of them all of it: a Hit Point at a time, round by round, to
   * whoever still has one marked.
   *
   * The order is the selector's, which is stable, so a replay heals the same
   * people. What nobody can use is not spent: a beam with more in it than the
   * room has wounds simply runs out of wounds.
   */
  healShared(target: TargetSelector, amount: number, bindings: TargetBindings = { targets: [], hit: [] }): number {
    const among = this.entitiesFor(target, bindings);
    let left = Math.max(0, Math.trunc(amount));
    let total = 0;
    let healing = true;
    while (left > 0 && healing) {
      healing = false;
      for (const entity of among) {
        if (left <= 0) break;
        if (entity.hitPoints.marked <= 0) continue;
        const result = clearPool(entity.hitPoints, 1);
        if (result.applied <= 0) continue;
        entity.hitPoints = result.pool;
        if (entity.hitPoints.marked < entity.hitPoints.max && entity.dead !== true) entity.alive = true;
        left -= result.applied;
        total += result.applied;
        healing = true;
      }
    }
    return total;
  }

  heal(target: TargetSelector, amount: number, bindings: TargetBindings = { targets: [], hit: [] }): number {
    let total = 0;
    for (const entity of this.entitiesFor(target, bindings)) {
      const result = clearPool(entity.hitPoints, amount);
      entity.hitPoints = result.pool;
      // "They return to consciousness when an ally clears 1 or more of their
      // marked Hit Points." One who crossed through the veil does not.
      if (result.applied > 0 && entity.hitPoints.marked < entity.hitPoints.max && entity.dead !== true) {
        entity.alive = true;
      }
      total += result.applied;
    }
    return total;
  }

  /**
   * On their feet at full strength, whatever put them down.
   *
   * A heal stands somebody up and stops at the veil, deliberately. This does
   * not stop: every marked Hit Point cleared and the death undone, which is
   * what 'restore one creature who has been dead no longer than 100 years to
   * full strength' asks for and nothing else here does.
   */
  revive(target: TargetSelector, bindings: TargetBindings = { targets: [], hit: [] }): string[] {
    // Every selector that reads the board drops the fallen on the way past,
    // which is right for everything except this: the one it is aimed at is the
    // one who is down. A creature named outright - the chosen target, an id,
    // the actor - is taken as named.
    const named =
      target.kind === 'target'
        ? bindings.targets.map((id) => this.state.entity(id)).filter((e): e is EntityState => e !== undefined)
        : this.entitiesFor(target, bindings);
    const raised: string[] = [];
    for (const entity of named) {
      if (entity.alive && entity.hitPoints.marked === 0) continue;
      entity.hitPoints = { max: entity.hitPoints.max, marked: 0 };
      delete entity.dead;
      entity.alive = true;
      raised.push(entity.id);
    }
    return raised;
  }

  /**
   * Killed outright, and past the veil where a heal cannot reach.
   *
   * The mirror of `revive`: that one clears the death, this one writes it. What
   * it does *not* do is deal damage - there are no thresholds to cross and no
   * Armor Slot to mark, because the card that asks for this is not hitting
   * anybody.
   */
  slay(target: TargetSelector, bindings: TargetBindings = { targets: [], hit: [] }): string[] {
    const killed: string[] = [];
    for (const entity of this.entitiesFor(target, bindings)) {
      if (!entity.alive) continue;
      entity.hitPoints = { max: entity.hitPoints.max, marked: entity.hitPoints.max };
      entity.alive = false;
      entity.dead = true;
      killed.push(entity.id);
    }
    return killed;
  }

  private entitiesFor(target: TargetSelector, bindings: TargetBindings): EntityState[] {
    // `damage` and `heal` reach fallen creatures too — a heal is how one gets up.
    if (target.kind === 'entity') {
      const entity = this.state.entity(target.id);
      return entity === undefined ? [] : [entity];
    }
    if (target.kind === 'actor') {
      const id = this.scenario.actorId;
      const actor = id === null ? undefined : this.state.entity(id);
      return actor === undefined ? [] : [actor];
    }
    return this.resolveTargets(target, bindings)
      .map((id) => this.state.entity(id))
      .filter((e): e is EntityState => e !== undefined);
  }

  // ---- what an ability does to a creature ----------------------------------

  /**
   * How a creature is attacked: its sheet's Evasion and thresholds, or its
   * stat block's, with whatever its conditions and scene-gated features add.
   */
  defenderOf(entity: EntityState): {
    difficulty: number;
    thresholds: { major: number; severe: number };
    defenses?: DamageDefenses;
  } {
    const character = this.characters.get(entity.id);
    const base =
      character !== undefined
        ? { difficulty: character.evasion, thresholds: character.thresholds }
        : (() => {
            const def = this.adversaries.get(entity.definition);
            return def === undefined ? FALLBACK_DEFENDER : { difficulty: def.difficulty, thresholds: def.thresholds };
          })();
    const both = this.poolBonus(entity.id, 'thresholds');
    const defenses = this.defensesOf(entity.id);
    return {
      difficulty: base.difficulty + this.poolBonus(entity.id, 'evasion'),
      thresholds: {
        major: base.thresholds.major + this.poolBonus(entity.id, 'majorThreshold') + both,
        severe: base.thresholds.severe + this.poolBonus(entity.id, 'severeThreshold') + both,
      },
      ...(Object.keys(defenses).length === 0 ? {} : { defenses }),
    };
  }

  /**
   * Decide and pay the defence against one damage event: Armor Slots and the
   * reactions the creature holds, under the world's policy. Pays the Light and
   * Stress the reactions cost; the caller marks the Armor Slots and Hit Points
   * the result says.
   */
  defend(id: string, damage: IncomingDamage, rng: Rng): Defense {
    const entity = this.state.entity(id);
    if (entity === undefined) {
      return { resolved: resolveDamage(damage, FALLBACK_DEFENDER.thresholds), armorSlotsMarked: 0, reactions: [], goodSpent: 0, stressMarked: 0 };
    }
    const against = this.defenderOf(entity);
    const defense = resolveDefense(
      rng,
      damage,
      {
        thresholds: against.thresholds,
        ...(against.defenses === undefined ? {} : { defenses: against.defenses }),
        armorSlots: this.armorFor(id),
        stress: entity.stress,
        ...(entity.good === undefined ? {} : { good: entity.good }),
        reactions: this.reactionsOf(id),
      },
      this.defense,
    );
    if (defense.goodSpent > 0) this.spendGood(id, defense.goodSpent);
    if (defense.stressMarked > 0) this.markStress(id, defense.stressMarked);
    return defense;
  }

  dealDamage(id: string, damage: IncomingDamage, rng: Rng): DealtDamage {
    const entity = this.state.entity(id);
    if (entity === undefined || !entity.alive) return { incoming: 0, reduced: 0, hpMarked: 0, armorSlotsSpent: 0, fell: false, reactions: [] };
    const defense = this.defend(id, damage, rng);
    const resolved = defense.resolved;
    if (resolved.armorSlotsSpent > 0) {
      entity.armorSlots = { max: entity.armorSlots.max, marked: entity.armorSlots.marked + resolved.armorSlotsSpent };
    }
    const marked = markHitPoints(entity.hitPoints, resolved.hpMarked);
    entity.hitPoints = marked.hitPoints;
    if (marked.fell) entity.alive = false;
    if (resolved.hpMarked > 0 || resolved.armorSlotsSpent > 0) this.endsOnDamage(id);
    // Damage out of a script is not an attack: a trap, a countdown, the gas a
    // creature breathes. It is noted so the features that answer *being* hurt
    // fire, with nobody named, so the ones that hit back have nobody to hit.
    if (resolved.hpMarked > 0 || resolved.severity !== 'none') {
      this.noteDamage(id, {
        hitPoints: resolved.hpMarked,
        damage: resolved.incoming,
        types: damage.types ?? [],
        severe: isSevere(resolved.severity),
      });
    }
    return {
      incoming: resolved.incoming,
      reduced: resolved.reduced,
      hpMarked: marked.hpMarked,
      armorSlotsSpent: resolved.armorSlotsSpent,
      fell: marked.fell,
      reactions: defense.reactions.map((r) => ({
        name: r.ability.name,
        goodSpent: r.goodSpent,
        stressMarked: r.stressMarked,
        ...(r.rolled === undefined ? {} : { rolled: r.rolled }),
      })),
    };
  }

  markStress(id: string, amount: number): { stressMarked: number; hpMarked: number; fell: boolean } {
    const entity = this.state.entity(id);
    if (entity === undefined) return { stressMarked: 0, hpMarked: 0, fell: false };
    const result = markStressPool(entity.stress, entity.hitPoints, amount);
    entity.stress = result.stress;
    entity.hitPoints = result.hitPoints;
    if (result.fell) entity.alive = false;
    return { stressMarked: result.stressMarked, hpMarked: result.hpMarked, fell: result.fell };
  }

  clearStress(id: string, amount: number): number {
    const entity = this.state.entity(id);
    if (entity === undefined) return 0;
    const result = clearPool(entity.stress, amount);
    entity.stress = result.pool;
    return result.applied;
  }

  clearArmor(id: string, amount: number): number {
    const entity = this.state.entity(id);
    if (entity === undefined) return 0;
    const result = clearPool(entity.armorSlots, amount);
    entity.armorSlots = result.pool;
    return result.applied;
  }

  gainGoodFor(id: string, amount: number): number {
    const entity = this.state.entity(id);
    if (entity?.good === undefined) return 0;
    // `gain` is pure; the new currency replaces the old on the entity.
    const result = gain(entity.good, amount);
    entity.good = result.currency;
    return result.applied;
  }

  spendGood(id: string, amount: number): boolean {
    const entity = this.state.entity(id);
    if (entity?.good === undefined) return false;
    const result = spend(entity.good, amount);
    if (!result.ok) return false;
    entity.good = result.currency;
    return true;
  }

  /**
   * Light taken rather than spent: a creature with two loses two of three, and
   * one with none loses nothing. Never refused — "all targets lose a Light"
   * happens to whoever has one.
   */
  loseGood(id: string, amount: number): number {
    const entity = this.state.entity(id);
    if (entity?.good === undefined) return 0;
    const lost = Math.min(entity.good.value, amount);
    if (lost <= 0) return 0;
    entity.good = { max: entity.good.max, value: entity.good.value - lost };
    return lost;
  }

  applyCondition(id: string, condition: string, duration: ConditionDuration): boolean {
    const entity = this.state.entity(id);
    if (entity === undefined || !entity.alive) return false;
    // "The same condition can't be stacked."
    if (entity.conditions.has(condition)) return false;
    entity.conditions.add(condition);
    entity.conditionDurations.set(condition, duration);
    return true;
  }

  clearCondition(id: string, condition: string): boolean {
    const entity = this.state.entity(id);
    if (entity === undefined || !entity.conditions.has(condition)) return false;
    entity.conditions.delete(condition);
    entity.conditionDurations.delete(condition);
    return true;
  }

  /**
   * Note that a blow landed, so whoever runs the fight can play the features
   * that answer it — Acid Bath, Thorny Armor, a Flickerfly's first wound.
   * Kept as a queue rather than fired here: the world applies rules, it does
   * not start scripts.
   *
   * Who dealt it is recorded because most of these features hit back, and a
   * retaliation with nobody to aim at is not one. It stays optional: damage
   * out of a script has no attacker, and a feature that only answers *being*
   * hurt should still fire.
   */
  noteDamage(
    id: string,
    note: { attacker?: string; hitPoints?: number; damage?: number; types?: readonly DamageType[]; severe?: boolean } = {},
  ): void {
    const already = this.damaged.find((d) => d.id === id && d.attacker === (note.attacker ?? null));
    const entry: DamageNote = already ?? { id, attacker: note.attacker ?? null, hitPoints: 0, damage: 0, types: [], severe: false };
    entry.hitPoints += note.hitPoints ?? 0;
    entry.damage += note.damage ?? 0;
    if (note.types !== undefined && note.types.length > 0) entry.types = [...note.types];
    entry.severe = entry.severe || note.severe === true;
    if (already === undefined) this.damaged.push(entry);
    // The one funnel every blow that landed on somebody passes through, which
    // is where the ground that answered it is spent.
    this.growZones(id);
  }

  /** Severe damage with nobody named: the older half of `noteDamage`. */
  noteSevere(id: string): void {
    this.noteDamage(id, { severe: true });
  }

  /** What has landed since the last call. Clears as it reports. */
  drainDamage(): DamageNote[] {
    const took = [...this.damaged];
    this.damaged.length = 0;
    return took;
  }

  markArmor(id: string, amount: number): number {
    const entity = this.state.entity(id);
    if (entity === undefined) return 0;
    const marked = Math.min(amount, unmarked(entity.armorSlots));
    entity.armorSlots = { max: entity.armorSlots.max, marked: entity.armorSlots.marked + marked };
    return marked;
  }

  attack(
    request: {
      attacker: string;
      target: string;
      weapon: 'primary' | 'secondary';
      advantage?: number;
      damageBonus?: number;
      damage?: string;
      /** Reach for this swing, when a feature says further than the block does. */
      range?: RangeBand;
      /** Damage no Armor Slot reduces. */
      direct?: boolean;
      /** Creatures that pile in behind this one, already resolved by the caller. */
      joinedBy?: readonly string[];
    },
    rng: Rng,
  ): AttackSummary {
    const none: AttackSummary = {
      refused: null,
      weapon: '',
      hit: false,
      critical: false,
      hitPointsMarked: 0,
      goodGained: 0,
      badGained: 0,
      stressCleared: 0,
      spotlightToGm: false,
    };
    const attacker = this.state.entity(request.attacker);
    const target = this.state.entity(request.target);
    const character = this.characters.get(request.attacker);
    if (attacker === undefined) return { ...none, refused: 'no weapon to attack with' };
    if (target === undefined || !target.alive) return { ...none, refused: 'nothing to attack' };

    // A character swings their weapon; an adversary swings whatever its stat
    // block prints, so a feature can be written as an attack like any other.
    const stated = request.damage === undefined ? null : parseDice(request.damage);
    const own =
      character !== undefined
        ? attackProfile(character, request.weapon)
        : this.adversaryProfile(attacker.definition, { attacker: request.attacker, target: request.target });
    if (own === null) return { ...none, refused: 'no weapon to attack with' };
    // A feature says its own reach and whether it goes through armor; what the
    // block prints is only the default for the creature's own teeth.
    const profile: AttackProfile = {
      ...own,
      ...(stated === null ? {} : { damage: stated }),
      ...(request.range === undefined ? {} : { range: request.range }),
      ...(request.direct === undefined ? {} : { direct: request.direct }),
    };
    // The rest of its kind pile in before the roll: they walk in, and the ones
    // standing in reach when it is thrown swing with it. One roll, and the
    // damage counted once for each of them.
    const joined =
      request.joinedBy === undefined
        ? []
        : this.walkIn(request.joinedBy, request.attacker, request.target, profile.range);
    if (joined.length > 0) {
      const each = profile.damage;
      const times = joined.length + 1;
      profile.damage = {
        ...each,
        count: each.count * times,
        modifier: each.modifier * times,
      };
    }
    const melee = profile.range === 'melee';
    const outcome = resolveAttack(rng, {
      grid: this.state.grid,
      attacker,
      target,
      profile,
      defender: this.defenderOf(target),
      options: {
        ...(this.bandTiles === undefined ? {} : { bandTiles: this.bandTiles }),
        bonus: this.rollBonus(request.attacker, 'attackRoll', { melee }),
        damageBonus: (request.damageBonus ?? 0) + this.rollBonus(request.attacker, 'damageRoll', { melee }),
        // A party member attacked from a script defends the same way as from
        // an adversary; an adversary has no Armor Slots to mark.
        armorSlotsMarked: this.defense.armor === 'auto' ? Math.min(1, unmarked(target.armorSlots)) : 0,
        goodDieSides: this.goodDieSides(request.attacker),
        ...this.advantageWith(request.attacker, request.target, request.advantage ?? 0),
      },
    });
    if (outcome.refused !== null) return { ...none, weapon: profile.name, refused: outcome.targeting.bandLabel + ': ' + outcome.refused };
    const applied = applyAttack(this.state, outcome);
    this.endsOnAttack(request.attacker);
    if (outcome.hit) {
      this.endsOnHit(request.target);
      if (applied.hitPointsMarked > 0) this.endsOnDamage(request.target);
      this.noteDamage(request.target, {
        attacker: request.attacker,
        hitPoints: applied.hitPointsMarked,
        damage: outcome.damageRoll?.total ?? 0,
        types: profile.damage.types ?? [],
        severe: outcome.damage !== undefined && isSevere(outcome.damage.severity),
      });
    }
    return {
      refused: null,
      weapon: profile.name,
      hit: outcome.hit,
      critical: outcome.critical,
      hitPointsMarked: applied.hitPointsMarked,
      ...(outcome.damage === undefined || outcome.damage.reduced === 0 ? {} : { reduced: outcome.damage.reduced }),
      ...(joined.length === 0 ? {} : { joined }),
      ...(outcome.damageRoll === undefined
        ? {}
        : {
            damage: outcome.damageRoll.total,
            damageDice: formatDice(outcome.damageRoll.expression),
            damageTypes: profile.damage.types ?? [],
          }),
      ...(outcome.dualityRoll === undefined ? {} : { roll: outcome.dualityRoll }),
      goodGained: applied.goodGained,
      badGained: applied.badGained,
      stressCleared: applied.stressCleared,
      spotlightToGm: outcome.spotlightToGm,
    };
  }

  /**
   * Bring a swarm to the target: everyone named walks in, and the ones who get
   * within reach are the ones who count.
   *
   * A creature that cannot move — Restrained, or with a wall in the way — is
   * simply left out, which is what a table does with the one that could not
   * get there. The attacker is never in this list: it is already swinging.
   */
  private walkIn(ids: readonly string[], attacker: string, target: string, reach: RangeBand): string[] {
    const joined: string[] = [];
    // The one swinging is one of them: "those Minions move into Melee range of
    // the target" is the whole swarm, the spotlighted one included.
    if (!this.within(attacker, target, reach)) this.drawIn(attacker, target, reach);
    for (const id of ids) {
      if (id === attacker || id === target) continue;
      const entity = this.state.entity(id);
      if (entity === undefined || !entity.alive || entity.tile === NO_TILE) continue;
      if (this.blocks(id, 'act') || this.spotlightSpent(id)) continue;
      if (!this.within(id, target, reach)) this.drawIn(id, target, reach);
      if (this.within(id, target, reach)) joined.push(id);
    }
    return joined;
  }

  /** What an adversary swings, from its stat block. */
  private adversaryProfile(definition: string, between?: { attacker: string; target: string }): AttackProfile | null {
    const def = this.adversaries.get(definition);
    if (def === undefined) return null;
    // "The Ogre's attacks deal direct damage", "1d10+4 instead of their
    // standard damage", "double damage to PCs with 0 Light": passives on the
    // block, read against whoever it is swinging at.
    const swing = this.standardAttackOf(definition, between);
    return {
      kind: 'adversary',
      name: def.attackName,
      modifier: def.attackModifier,
      range: def.attackRange,
      damage: swing.damage ?? def.attackDamage,
      ...(swing.direct === undefined ? {} : { direct: swing.direct }),
      ...(swing.double === undefined ? {} : { double: swing.double }),
    };
  }

  /**
   * Put creatures on the map: "summon three Jagged Knife Lackeys, who appear
   * at Far range".
   *
   * They stand in the band the feature names, measured from whoever summoned
   * them — a ring, not a disc, because "at Far range" is a place to arrive at
   * and not an area to fill. A room too small to hold that ring would summon
   * nobody, which reads as a broken feature rather than a small room, so the
   * search falls inward a band at a time until it finds standing room.
   *
   * They are on the map the moment they are placed, and that is all it takes:
   * the encounter reads the map for whose turn is next and for whether the
   * fight is over, so nothing keeps a roster that could disagree.
   */
  summon(definition: string, count: number, range: RangeBand): { ids: string[]; refused?: string } {
    const summoner = this.scenario.actorId === null ? undefined : this.state.entity(this.scenario.actorId);
    const block = this.adversaries.get(definition);
    if (block === undefined) return { ids: [], refused: `nothing is a "${definition}"` };
    if (summoner === undefined || summoner.tile === NO_TILE) return { ids: [], refused: 'nobody to summon them' };
    const wanted = Math.max(0, Math.trunc(count));
    if (wanted === 0) return { ids: [] };

    const placed: string[] = [];
    for (let i = 0; i < wanted; i++) {
      const tile = this.standingRoom(summoner.tile, range);
      if (tile === null) break;
      const id = this.freeId(definition);
      this.state.addEntity(
        createAdversaryEntity(id, definition, tile, { hitPoints: block.hitPoints, stress: block.stress }),
      );
      placed.push(id);
    }
    return placed.length === 0 ? { ids: [], refused: `nowhere for a ${block.name} to stand` } : { ids: placed };
  }

  /**
   * Take the creature acting off the map and stand others where it was.
   *
   * The first of them takes its tile, so a phase change is in the same place
   * the fight left it; the rest stand as close as there is room for. They come
   * off their own stat block with nothing marked - "two Tiny Green Oozes (with
   * no marked HP or Stress)" - and the one they replace is gone rather than
   * fallen, so nothing mourns it and no countdown of its goes off.
   */
  replace(definition: string, count: number): { ids: string[]; was?: string; refused?: string } {
    const actor = this.scenario.actorId === null ? undefined : this.state.entity(this.scenario.actorId);
    const block = this.adversaries.get(definition);
    if (block === undefined) return { ids: [], refused: `nothing is a "${definition}"` };
    if (actor === undefined || actor.tile === NO_TILE) return { ids: [], refused: 'nobody to replace' };
    // A card in a player's hand cannot take its holder off the map: this is
    // the GM's move, and a party member replaced by a stat block is a bug
    // rather than a feature.
    if (actor.faction !== 'adversary') return { ids: [], refused: 'only the GM replaces a creature' };
    const wanted = Math.max(0, Math.trunc(count));
    if (wanted === 0) return { ids: [] };

    // Its name before it goes: the log has nobody to ask afterwards.
    const was = this.adversaries.get(actor.definition)?.name ?? actor.id;
    const tile = actor.tile;
    this.state.removeEntity(actor.id);
    const placed: string[] = [];
    for (let i = 0; i < wanted; i++) {
      const where = i === 0 ? tile : this.standingRoom(tile, 'melee');
      if (where === null) break;
      const id = this.freeId(definition);
      this.state.addEntity(
        createAdversaryEntity(id, definition, where, { hitPoints: block.hitPoints, stress: block.stress }),
      );
      placed.push(id);
    }
    return placed.length === 0 ? { ids: [], refused: `nowhere for a ${block.name} to stand` } : { ids: placed, was };
  }

  /**
   * A free tile in that band around a point, nearest first and lowest index on
   * a tie — the same rule the GM's walk uses, so a summons arrives in the same
   * places on every replay. Falls inward when the band itself is full or off
   * the map.
   */
  private standingRoom(from: number, range: RangeBand): number | null {
    const grid = this.state.grid;
    const bands = RANGE_BANDS.filter((band): band is TargetableRangeBand => band !== 'outOfRange');
    const wanted = bands.indexOf(range as TargetableRangeBand);
    if (wanted < 0) return null;
    for (let step = wanted; step >= 0; step--) {
      const band = bands[step]!;
      let best: number | null = null;
      let bestDistance = Infinity;
      for (let tile = 0; tile < grid.size; tile++) {
        if (!this.state.bodyFree(tile)) continue;
        const distance = grid.euclideanDistance(from, tile);
        if (distance === 0) continue;
        if (bandForSpan(distance, this.bandTiles) !== band) continue;
        if (distance < bestDistance || (distance === bestDistance && (best === null || tile < best))) {
          best = tile;
          bestDistance = distance;
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /**
   * An id nothing in the room is using. The fallen keep theirs — a corpse is
   * still an entity — so a summons can never reuse one, save and load
   * included.
   */
  private freeId(definition: string): string {
    for (let n = 1; ; n++) {
      const id = `${definition}-s${n}`;
      if (this.state.entity(id) === undefined) return id;
    }
  }

  /**
   * Walk a creature in: step by step straight towards `toward`, until it is
   * within the band asked for or something is in the way.
   *
   * The mirror of `pushBack`, and as blunt: no path is searched, so a wall
   * between them stops the walk where it stands. A swarm that cannot reach
   * does not join the swing, which is the honest reading of "those Minions
   * move into Melee range of the target".
   */
  drawIn(mover: string, toward: string, band: RangeBand, budget: RangeBand = 'close'): { from: number; to: number; route?: readonly Spot[] } | null {
    return this.drawTo(mover, this.state.entity(toward)?.tile ?? NO_TILE, band, budget);
  }

  /** The body a walk is measured with: the engine's, stepping as far as the movement rules step. */
  private walkRules(): WalkRules {
    return { ...DEFAULT_WALK, maxStepHeight: (this.movement ?? DEFAULT_MOVEMENT).maxStepHeight };
  }

  /**
   * The line a creature crosses to a tile of a field it can reach: the path's
   * corners pulled straight where its body fits, from where it stands now to
   * the tile's centre. Read before the creature is moved.
   */
  private lineOf(mover: string, field: ReachableField, to: number): readonly Spot[] | undefined {
    const walking = this.state.entity(mover);
    const path = tracePath(field, to);
    if (walking === undefined || path === null) return undefined;
    return smoothPath(this.state.grid, path, this.state.blockedFor(mover), this.walkRules(), {
      start: { ...walking.at },
      end: this.state.grid.spotOf(to),
    });
  }

  /**
   * The same walk toward a place rather than toward a creature: "run a
   * straight path to a point within Far range", "move the Ogre to a point
   * within Close range".
   *
   * The path is still walked rather than teleported - what the ground allows
   * is what happens - so a charge at a spot behind a wall stops where the wall
   * is, and what the run passed on the way is what it passed.
   */
  drawTo(mover: string, goalTile: number, band: RangeBand, budget: RangeBand = 'close'): { from: number; to: number; route?: readonly Spot[] } | null {
    const walking = this.state.entity(mover);
    if (walking === undefined) return null;
    if (walking.tile === NO_TILE || goalTile === NO_TILE) return null;
    if (this.blocks(mover, 'move')) return null;
    const already = this.bandBetween(walking.tile, goalTile);
    if (already !== null && reaches(already, band)) return null;
    const goal = { tile: goalTile };

    // The same walk the GM's turn makes: everywhere it could get to, then the
    // tile closest to what it is walking at. Closer wins, and a tie goes to
    // the lower index, so a swarm arrives in the same order every replay.
    const grid = this.state.grid;
    const start = walking.tile;
    const field = this.paths().reachable(start, maxTilesForBand(budget, this.bandTiles), {
      rules: this.movement,
      isBlocked: this.state.blockedFor(mover),
    });
    let best = start;
    let bestDistance = grid.euclideanDistance(start, goal.tile);
    for (const tile of field.tiles()) {
      if (tile === goal.tile) continue;
      const distance = grid.euclideanDistance(tile, goal.tile);
      if (distance < bestDistance || (distance === bestDistance && tile < best)) {
        best = tile;
        bestDistance = distance;
      }
    }
    if (best === start) return null;
    const route = this.lineOf(mover, field, best);
    this.state.moveEntity(mover, best);
    return route === undefined ? { from: start, to: best } : { from: start, to: best, route };
  }

  /**
   * Put a creature on a tile without walking them to it: a blink, not a run.
   *
   * Only the band between where they stand and where they are going is read -
   * no path, so a wall between the two is no argument. The tile itself when it
   * is free, and otherwise the nearest free passable one to it, so two
   * creatures arriving together do not end up on top of each other.
   */
  blinkTo(mover: string, goalTile: number, band: RangeBand = 'far'): { from: number; to: number } | null {
    const walking = this.state.entity(mover);
    if (walking === undefined || walking.tile === NO_TILE || goalTile === NO_TILE) return null;
    if (this.blocks(mover, 'move')) return null;
    // `outOfRange` as the band is "however far": a rift back to a mark does
    // not measure, where a door aimed at a point is as far as the card said.
    if (band !== 'outOfRange') {
      const reach = this.bandBetween(walking.tile, goalTile);
      if (reach === null || !reaches(reach, band)) return null;
    }

    const grid = this.state.grid;
    const blocked = this.state.blockedFor(mover);
    const free = (tile: number): boolean => grid.isTile(tile) && grid.isPassable(tile) && !blocked(tile);
    let best = free(goalTile) ? goalTile : NO_TILE;
    if (best === NO_TILE) {
      // Somebody is standing there, so the next tile along - and only the next
      // one. A search of the whole map would put them across the room, or
      // through a wall, for want of a foot of floor; a spell with nowhere to
      // land is one that fizzles.
      let bestDistance = Infinity;
      grid.forEachNeighbor(goalTile, true, (tile) => {
        if (!free(tile)) return;
        const distance = grid.euclideanDistance(tile, goalTile);
        if (distance < bestDistance || (distance === bestDistance && tile < best)) {
          best = tile;
          bestDistance = distance;
        }
      });
    }
    if (best === NO_TILE || best === walking.tile) return null;
    const from = walking.tile;
    this.state.moveEntity(mover, best);
    return { from, to: best };
  }

  /**
   * The mirror of `drawIn`: as much ground between them as the walk allows.
   *
   * "Teleport up to Far range", "move anywhere within Far range" - a creature
   * getting itself out of reach. The same field and the same tie-break, so a
   * replay puts it on the same tile; the far side of a wall is not reachable,
   * which is the honest reading of a walk rather than a step through stone.
   */
  breakAway(mover: string, from: string, budget: RangeBand = 'close'): { from: number; to: number; route?: readonly Spot[] } | null {
    const walking = this.state.entity(mover);
    const away = this.state.entity(from);
    if (walking === undefined || away === undefined) return null;
    if (walking.tile === NO_TILE || away.tile === NO_TILE) return null;
    if (this.blocks(mover, 'move')) return null;

    const grid = this.state.grid;
    const start = walking.tile;
    const field = this.paths().reachable(start, maxTilesForBand(budget, this.bandTiles), {
      rules: this.movement,
      isBlocked: this.state.blockedFor(mover),
    });
    let best = start;
    let bestDistance = grid.euclideanDistance(start, away.tile);
    for (const tile of field.tiles()) {
      const distance = grid.euclideanDistance(tile, away.tile);
      if (distance > bestDistance || (distance === bestDistance && tile < best && distance > grid.euclideanDistance(start, away.tile))) {
        best = tile;
        bestDistance = distance;
      }
    }
    if (best === start) return null;
    const route = this.lineOf(mover, field, best);
    this.state.moveEntity(mover, best);
    return route === undefined ? { from: start, to: best } : { from: start, to: best, route };
  }

  /** The pathfinder this world walks with, built once for the scene's grid. */
  private paths(): Pathfinder {
    if (this.pathfinder === null) this.pathfinder = new Pathfinder(this.state.grid);
    return this.pathfinder;
  }

  /**
   * Knock a creature back: step by step directly away from `from`, until it
   * stands in the band asked for or something is in the way. "If the fiction
   * doesn't support it — an adversary hits a wall — follow the fiction."
   */
  pushBack(from: string, target: string, band: RangeBand): { from: number; to: number } | null {
    const source = this.state.entity(from);
    const pushed = this.state.entity(target);
    if (source === undefined || pushed === undefined || pushed.tile === NO_TILE || source.tile === NO_TILE) return null;
    const grid = this.state.grid;
    const start = pushed.tile;
    const dx = Math.sign(grid.xOf(start) - grid.xOf(source.tile));
    const dy = Math.sign(grid.yOf(start) - grid.yOf(source.tile));
    if (dx === 0 && dy === 0) return null;
    const blocked = this.state.blockedFor(target);
    const goal = bandIndex(band);
    const bandOf = (tile: number): number =>
      bandIndex(bandForSpan(grid.euclideanDistance(source.tile, tile), this.bandTiles));

    let tile = start;
    let x = grid.xOf(start);
    let y = grid.yOf(start);
    // Far enough is "the nearest tile in that band"; the loop stops as soon as
    // the distance from the pusher reads as that band.
    while (bandOf(tile) < goal) {
      const nx = x + dx;
      const ny = y + dy;
      if (!grid.inBounds(nx, ny)) break;
      const next = grid.indexOf(nx, ny);
      if (!grid.isPassable(next) || blocked(next)) break;
      tile = next;
      x = nx;
      y = ny;
    }
    if (tile === start) return null;
    this.state.moveEntity(target, tile);
    return { from: start, to: tile };
  }

  rollReaction(
    id: string,
    difficulty: number,
    trait: Trait,
    rng: Rng,
  ): { success: boolean; total: number; roll?: DualityRoll } {
    const entity = this.state.entity(id);
    const character = this.characters.get(id);
    if (entity === undefined) return { success: false, total: 0 };
    if (entity.faction === 'adversary' || character === undefined) {
      // "When this occurs, roll a d20 to determine whether they succeed or fail."
      const roll = rollGmDie(rng, { difficulty, reaction: true });
      return { success: roll.success, total: roll.total };
    }
    // A party member rolls the Duality Dice, and hands back both faces: the
    // table watches those land, and only a d20 has nothing to watch.
    const roll = rollDuality(rng, { difficulty, modifier: character.traits[trait], reaction: true });
    return { success: roll.success, total: roll.total, roll };
  }
}
