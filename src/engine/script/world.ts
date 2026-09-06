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
 * The combat half — damage through thresholds, Stress, Hope, conditions, a
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
import { resolveDamage, type IncomingDamage } from '../rules/damage';
import { rollDuality } from '../rules/duality';
import { rollGmDie } from '../rules/gm-die';
import { bandForDistance, bandIndex, reaches, type BandTiles, type RangeBand } from '../rules/range';
import { applyAttack, resolveAttack } from '../combat/attack';
import { attackProfile, defenderProfile, UNARMED, type DerivedCharacter } from '../character/sheet';
import type { AdversaryDef } from '../content/types';
import { NO_TILE } from '../grid/grid';
import type { EntityState, SceneState } from '../scene/state';
import type { Trait } from '../scene/schema';
import { scriptValueSchema, type ConditionDuration, type PoolName, type ScriptValue } from './schema';
import type { CheckTrait, TargetSelector } from './schema';
import type { Rng } from '../core/rng';
import { rollLoot, type LootDrop, type LootTable } from '../content/items';
import { questStatusSchema, type QuestProgress, type QuestQuery } from '../content/quests';
import type { AttackSummary, DealtDamage, ScriptWorld } from './runner';
import type { TargetBindings } from './conditions';

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
  /** Whether a fight is running. Nothing is, when left out. */
  inCombat?: () => boolean;
  /**
   * Whether a creature marks Armor Slots against damage without being asked.
   * `auto` marks as many as lower the Hit Points marked; the defender's choice
   * as a prompt is a later refinement of the same policy.
   */
  armor?: 'auto' | 'never';
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
  private readonly fighting: () => boolean;
  private readonly armor: 'auto' | 'never';

  constructor(state: SceneState, scenario: ScenarioState, options: SceneScriptWorldOptions = {}) {
    this.state = state;
    this.scenario = scenario;
    this.traits = options.traits ?? {};
    this.lootTables = options.lootTables ?? new Map();
    this.characters = options.characters ?? new Map();
    this.adversaries = options.adversaries ?? new Map();
    this.bandTiles = options.bandTiles;
    this.fighting = options.inCombat ?? (() => false);
    this.armor = options.armor ?? 'auto';
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

  countAlive(faction: 'party' | 'adversary'): number {
    return this.state.entitiesOf(faction).filter((e) => e.alive).length;
  }

  actorId(): string | null {
    return this.scenario.actorId;
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
    if (trait === 'spellcast') {
      if (character?.spellcastTrait === undefined) return null;
      return character.traits[character.spellcastTrait];
    }
    if (trait === 'weapon') {
      if (character === undefined) return null;
      return character.traits[character.primaryWeapon?.trait ?? UNARMED.trait];
    }
    if (as === 'actor' && character !== undefined) return character.traits[trait];
    return this.traitModifier(trait);
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
    if (pool === 'hope') {
      if (entity.hope === undefined) return null;
      return measure === 'max' ? entity.hope.max : measure === 'marked' ? entity.hope.max - entity.hope.value : entity.hope.value;
    }
    const track = entity[pool];
    return measure === 'max' ? track.max : measure === 'marked' ? track.marked : unmarked(track);
  }

  bandTo(from: string, to: string): RangeBand | null {
    const a = this.state.entity(from)?.tile ?? NO_TILE;
    const b = this.state.entity(to)?.tile ?? NO_TILE;
    if (a === NO_TILE || b === NO_TILE) return null;
    // The same rule as targeting: a neighbouring tile is Melee, anything else
    // is measured as the crow flies.
    if (this.state.grid.manhattanDistance(a, b) <= 1) return 'melee';
    return bandForDistance(Math.ceil(this.state.grid.euclideanDistance(a, b)), this.bandTiles);
  }

  proficiencyOf(id: string): number {
    return this.characters.get(id)?.sheet.proficiency ?? 1;
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
      case 'target':
        return living(bindings.targets);
      case 'hit':
        return living(bindings.hit);
      case 'allies': {
        const actor = this.scenario.actorId;
        return this.state
          .entitiesOf('party')
          .filter((e) => e.alive && (selector.includeSelf === true || e.id !== actor))
          .filter((e) => selector.range === undefined || actor === null || this.within(actor, e.id, selector.range))
          .map((e) => e.id);
      }
      case 'adversaries': {
        const origin = selector.around === 'target' ? bindings.targets[0] : this.scenario.actorId;
        if (origin === undefined || origin === null) return [];
        return this.state
          .entitiesOf('adversary')
          .filter((e) => e.alive && this.within(origin, e.id, selector.range))
          .map((e) => e.id);
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

  gainHope(): boolean {
    const id = this.scenario.actorId;
    return id !== null && this.gainHopeFor(id, 1) > 0;
  }

  gainFear(): boolean {
    const result = gain(this.state.fear);
    this.state.fear = result.currency;
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

  damage(target: TargetSelector, amount: number, _source?: string, bindings: TargetBindings = { targets: [], hit: [] }): number {
    let total = 0;
    for (const entity of this.entitiesFor(target, bindings)) {
      const result = markHitPoints(entity.hitPoints, amount);
      entity.hitPoints = result.hitPoints;
      if (result.fell) entity.alive = false;
      total += result.hpMarked;
    }
    return total;
  }

  heal(target: TargetSelector, amount: number, bindings: TargetBindings = { targets: [], hit: [] }): number {
    let total = 0;
    for (const entity of this.entitiesFor(target, bindings)) {
      const result = clearPool(entity.hitPoints, amount);
      entity.hitPoints = result.pool;
      // Clearing a Hit Point brings an unconscious character back up.
      if (result.applied > 0 && entity.hitPoints.marked < entity.hitPoints.max) entity.alive = true;
      total += result.applied;
    }
    return total;
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

  /** How a creature is attacked: its sheet's Evasion and thresholds, or its stat block's. */
  private defenderOf(entity: EntityState): { difficulty: number; thresholds: { major: number; severe: number } } {
    const character = this.characters.get(entity.id);
    if (character !== undefined) return defenderProfile(character);
    const def = this.adversaries.get(entity.definition);
    if (def !== undefined) return { difficulty: def.difficulty, thresholds: def.thresholds };
    return FALLBACK_DEFENDER;
  }

  /**
   * Armor Slots to mark against a hit, under the world's policy. One, at most:
   * "mark an Armor Slot to reduce the severity by one threshold" is one slot
   * per hit unless a feature says otherwise, and features that do say so add
   * their own.
   */
  private armorAgainst(entity: EntityState): number {
    return this.armor === 'auto' ? Math.min(1, unmarked(entity.armorSlots)) : 0;
  }

  dealDamage(id: string, damage: IncomingDamage): DealtDamage {
    const entity = this.state.entity(id);
    if (entity === undefined || !entity.alive) return { incoming: 0, hpMarked: 0, armorSlotsSpent: 0, fell: false };
    const resolved = resolveDamage(damage, this.defenderOf(entity).thresholds, {
      armorSlotsMarked: this.armorAgainst(entity),
      armorSlotsAvailable: unmarked(entity.armorSlots),
    });
    if (resolved.armorSlotsSpent > 0) {
      entity.armorSlots = { max: entity.armorSlots.max, marked: entity.armorSlots.marked + resolved.armorSlotsSpent };
    }
    const marked = markHitPoints(entity.hitPoints, resolved.hpMarked);
    entity.hitPoints = marked.hitPoints;
    if (marked.fell) entity.alive = false;
    return { incoming: resolved.incoming, hpMarked: marked.hpMarked, armorSlotsSpent: resolved.armorSlotsSpent, fell: marked.fell };
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

  gainHopeFor(id: string, amount: number): number {
    const entity = this.state.entity(id);
    if (entity?.hope === undefined) return 0;
    // `gain` is pure; the new currency replaces the old on the entity.
    const result = gain(entity.hope, amount);
    entity.hope = result.currency;
    return result.applied;
  }

  spendHope(id: string, amount: number): boolean {
    const entity = this.state.entity(id);
    if (entity?.hope === undefined) return false;
    const result = spend(entity.hope, amount);
    if (!result.ok) return false;
    entity.hope = result.currency;
    return true;
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

  attack(
    request: { attacker: string; target: string; weapon: 'primary' | 'secondary'; advantage?: number; damageBonus?: number },
    rng: Rng,
  ): AttackSummary {
    const none: AttackSummary = {
      refused: null,
      weapon: '',
      hit: false,
      critical: false,
      hitPointsMarked: 0,
      hopeGained: 0,
      fearGained: 0,
      stressCleared: 0,
      spotlightToGm: false,
    };
    const attacker = this.state.entity(request.attacker);
    const target = this.state.entity(request.target);
    const character = this.characters.get(request.attacker);
    if (attacker === undefined || character === undefined) return { ...none, refused: 'no weapon to attack with' };
    if (target === undefined || !target.alive) return { ...none, refused: 'nothing to attack' };

    const profile = attackProfile(character, request.weapon);
    const outcome = resolveAttack(rng, {
      grid: this.state.grid,
      attacker,
      target,
      profile,
      defender: this.defenderOf(target),
      options: {
        ...(this.bandTiles === undefined ? {} : { bandTiles: this.bandTiles }),
        ...(request.advantage === undefined ? {} : { advantage: request.advantage }),
        ...(request.damageBonus === undefined ? {} : { damageBonus: request.damageBonus }),
        armorSlotsMarked: this.armorAgainst(target),
      },
    });
    if (outcome.refused !== null) return { ...none, weapon: profile.name, refused: outcome.targeting.bandLabel + ': ' + outcome.refused };
    const applied = applyAttack(this.state, outcome);
    return {
      refused: null,
      weapon: profile.name,
      hit: outcome.hit,
      critical: outcome.critical,
      hitPointsMarked: applied.hitPointsMarked,
      ...(outcome.dualityRoll === undefined ? {} : { roll: outcome.dualityRoll }),
      hopeGained: applied.hopeGained,
      fearGained: applied.fearGained,
      stressCleared: applied.stressCleared,
      spotlightToGm: outcome.spotlightToGm,
    };
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
      bandIndex(bandForDistance(Math.ceil(grid.euclideanDistance(source.tile, tile)), this.bandTiles));

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

  rollReaction(id: string, difficulty: number, trait: Trait, rng: Rng): { success: boolean; total: number } {
    const entity = this.state.entity(id);
    const character = this.characters.get(id);
    if (entity === undefined) return { success: false, total: 0 };
    if (entity.faction === 'adversary' || character === undefined) {
      // "When this occurs, roll a d20 to determine whether they succeed or fail."
      const roll = rollGmDie(rng, { difficulty, reaction: true });
      return { success: roll.success, total: roll.total };
    }
    const roll = rollDuality(rng, { difficulty, modifier: character.traits[trait], reaction: true });
    return { success: roll.success, total: roll.total };
  }
}
