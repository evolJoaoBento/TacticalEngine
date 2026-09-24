/**
 * The script runner: an effect list, executed one step at a time.
 *
 * The awkward part of scripting a CRPG is that most effects are instantaneous and
 * a few need the player. A door opens; a bargain waits for an answer. The legacy
 * prototype solved that with `await` all the way down, which pulled the DOM into
 * its rules and made a scenario impossible to test or replay.
 *
 * Here the runner is a **stepper**. It executes effects until one needs an answer,
 * then stops and hands the caller a prompt. The caller — a UI, a test, a replay —
 * supplies the answer and calls `resume`. Nothing is async, nothing calls back,
 * and a whole conversation is a pure function of (script, answers, seed).
 *
 * Everything it did comes back in a journal, so a caller can render a log, assert
 * on a scenario, or diff two runs.
 *
 * An ability is the same machine with two things bound: `targets`, the creatures
 * the player chose, and `hit`, the ones the last roll beat. A `check` against
 * targets binds `hit`; a `damage` with dice lands on whatever `hit` names. So a
 * card's text — "make a Spellcast Roll against a target within Far range; on a
 * success, deal d8+2 magic damage" — is a check whose success list holds a
 * damage effect, in the one vocabulary a chest's outcome is written in.
 */

import type { Rng } from '../core/rng';
import { NO_TILE, type Spot } from '../grid/grid';
import { BAD_DIE_SIDES, GOOD_DIE_SIDES, rollDuality, withFaces, type DualityRoll, type RollOutcome } from '../rules/duality';
import { formatDice, parseDice, rollDice, withProficiency, type DamageType, type DiceExpression, type ParsedDamage } from '../rules/dice';
import type { RunningCountdown } from './countdowns';
import type { RunningZone } from './zones';
import { hookReads } from './conditions';
import { runHook, type HookContext } from './hooks';
import { rollDamage, type DamageSeverity, type IncomingDamage } from '../rules/damage';
import type { RangeBand } from '../rules/range';
import type { Trait } from '../scene/primitives';
import {
  evaluateOptional,
  NO_BINDINGS,
  type Condition,
  type ConditionContext,
  type DiceHand,
  type ScriptValue,
  type TargetBindings,
} from './conditions';
import {
  outcomeEffects,
  type CheckOutcome,
  type CheckRequest,
  type ChoiceOption,
  type Effect,
  type LogTone,
  type TargetSelector,
} from './effects';
import type { Amount, CheckTrait, ConditionDuration, CountName } from './schema';
import { COUNT_NAMES } from './schema';
import { applyThingEffect } from './thing-effects';

/** What one damage event did to one creature. */
export interface DealtDamage {
  /** Damage after resistance and immunity. */
  incoming: number;
  /** Damage the defender's own passives took off before the thresholds. */
  reduced: number;
  hpMarked: number;
  armorSlotsSpent: number;
  fell: boolean;
  /** Reactions the defender used against it, and what they cost. */
  reactions: readonly { name: string; goodSpent: number; stressMarked: number; rolled?: number }[];
}

/** An attack made from inside a script, reported the way the log needs it. */
export interface AttackSummary {
  refused: string | null;
  weapon: string;
  hit: boolean;
  /** What the target's own passives took off the damage, if any. */
  reduced?: number;
  /** Who piled in and got there, if the swing asked anyone to. */
  joined?: readonly string[];
  critical: boolean;
  hitPointsMarked: number;
  roll?: DualityRoll;
  /** What the damage dice came to, for a card that reuses the same roll. */
  damage?: number;
  /** The expression rolled, as the log writes it. */
  damageDice?: string;
  /** What the damage counted as, so a reuse of it counts as the same. */
  damageTypes?: readonly DamageType[];
  goodGained: number;
  badGained: number;
  stressCleared: number;
  spotlightToGm: boolean;
}

/** What the world must let a script do. Implemented over `SceneState` in `world.ts`. */
export interface ScriptWorld extends ConditionContext {
  addItem(item: string, quantity?: number): number;
  /**
   * What a loot table yields, or nothing when the project has no such table.
   * Resolving here rather than in a UI layer means a `loot` inside a dialogue
   * reply or a check outcome behaves exactly like one on a chest.
   */
  rollLoot(table: string | undefined, rng: Rng): { item: string; quantity: number }[];
  /** Returns how many were actually taken. */
  removeItem(item: string, quantity?: number): number;
  setFlag(flag: string): void;
  clearFlag(flag: string): void;
  giveKey(key: string): void;
  setVar(name: string, value: ScriptValue): void;
  openInteractable(id: string): void;
  closeInteractable(id: string): void;
  removeInteractable(id: string): void;
  markInteractableUsed(id: string): void;
  startEncounter(id: string): void;
  endEncounter(id: string): void;
  /** Bypasses the attack roll — a trap, a hidden thorn. Returns HP actually marked. */
  damage(target: TargetSelector, amount: number, source?: string, bindings?: TargetBindings): number;
  /** Returns HP actually cleared. */
  heal(target: TargetSelector, amount: number, bindings?: TargetBindings): number;
  healShared(target: TargetSelector, amount: number, bindings?: TargetBindings): number;
  /**
   * The modifier for a check. `party` is how an object's check has always been
   * rolled — the party's best hand at that trait — and `actor` is the acting
   * character's own, which is what a card demands. Null when the actor cannot
   * make that roll at all: a Spellcast Roll with no Spellcast trait.
   */
  checkModifier(trait: CheckTrait, as: 'party' | 'actor'): number | null;
  /**
   * The advantage the acting creature carries into any action roll, as against
   * the advantage a swing carries.
   */
  advantageRolling(): { advantage: number; disadvantage: number };
  /**
   * And what the creatures the roll is aimed at do to it — Vulnerable and
   * Hidden are about rolls rather than swings. Ids that are not creatures (the
   * door a check is made on) count for nothing.
   */
  advantageAgainst(targets: readonly string[]): { advantage: number; disadvantage: number };
  /**
   * What the roller's own cards put behind a roll already made, and what that
   * costs them. Nothing, for a roll that does not need saving or cannot be.
   */
  liftRoll(id: string, trait: CheckTrait, total: number, difficulty: number, critical: boolean): number;
  /** The faces on this creature's Light Die: twelve unless a card says otherwise. */
  goodDieSides(id: string): number;
  /**
   * Whether anybody is holding a card that answers the roll this creature has
   * just made. False stops the check pausing at all, which is what keeps every
   * chest, door and conversation in the game running exactly as it did.
   *
   * The roll goes with the question because the cards gate on it: one that
   * answers a failure must not stop a success, and asking without the dice
   * would read every such gate as false.
   */
  answersRoll(id: string, roll: { total: number; outcome: RollOutcome; tags?: readonly string[]; trait?: CheckTrait }): boolean;
  /** Remember where a creature stands under a name. False for one not on the board. */
  markSpot(actor: string, mark: string): boolean;
  /** The tile a creature marked under a name, or `NO_TILE`. */
  recallSpot(actor: string, mark: string): number;
  /** Forget it. False when there was nothing to forget. */
  forgetSpot(actor: string, mark: string): boolean;
  /** The acting character's Experiences, spendable for a Light each. */
  experiences(): readonly { name: string; modifier: number }[];
  /** What a roll against this creature must meet: Evasion, or an adversary's Difficulty. */
  difficultyOf(id: string): number | null;
  /** Raise the party's level to `level` (or by one). Returns the level reached, or null if nothing changed. */
  grantLevel(level?: number): number | null;
  /** The acting character gains a Light. Returns whether anyone was there to gain it. */
  gainGood(): boolean;
  /** The GM gains a Shadow. Returns whether the pool had room. */
  gainBad(): boolean;
  /**
   * Quest progress. Each returns whether anything changed, so the runner can
   * journal a real event and stay quiet about a `startQuest` that was already
   * started — scripts re-run, and the journal must not say "New quest" twice.
   */
  startQuest(quest: string): boolean;
  completeObjective(quest: string, objective: string): boolean;
  revealObjective(quest: string, objective: string): boolean;
  completeQuest(quest: string): boolean;
  failQuest(quest: string): boolean;

  // ---- what an ability does to a creature ----------------------------------
  /** Rolled damage through thresholds, resistances, Armor Slots and the defender's reactions. */
  dealDamage(id: string, damage: IncomingDamage, rng: Rng): DealtDamage;
  /** Mark Stress; a full track marks a Hit Point instead, as the SRD says. */
  markStress(id: string, amount: number): { stressMarked: number; hpMarked: number; fell: boolean };
  clearStress(id: string, amount: number): number;
  clearArmor(id: string, amount: number): number;
  /** Mark Armor Slots with no benefit. Returns how many were actually marked. */
  markArmor(id: string, amount: number): number;
  /** Returns Light actually gained (an adversary gains none). */
  gainGoodFor(id: string, amount: number): number;
  /** Returns whether the Light was there to spend. */
  spendGood(id: string, amount: number): boolean;
  /** Take Light away, as far as it goes. Returns how much was actually lost. */
  loseGood(id: string, amount: number): number;
  applyCondition(id: string, condition: string, duration: ConditionDuration): boolean;
  clearCondition(id: string, condition: string): boolean;
  /** Back on their feet at full strength, past the veil if that is where they went. */
  revive(target: TargetSelector, bindings?: TargetBindings): string[];
  /** Killed outright, past the veil. Returns who actually went. */
  slay(target: TargetSelector, bindings?: TargetBindings): string[];
  /** A creature onto nobody's side, or back among the adversaries. False when it changed nothing. */
  setAttitude(id: string, attitude: 'friendly' | 'hostile'): boolean;
  proficiencyOf(id: string): number;
  /** Tokens sitting on a card this creature holds. */
  tokensOn(id: string, ability: string): number;
  /** Put tokens on a card; returns how many are there now. */
  addTokens(id: string, ability: string, amount?: number): number;
  /** Take tokens off a card. Returns how many were actually spent. */
  spendTokens(id: string, ability: string, amount: number): number;
  /** The value of the creature's Spellcast trait, or null when it has none. */
  spellcastValue(id: string): number | null;
  /** Take one Shadow off the GM's pool; false when there is none to take. */
  loseBad(): boolean;
  /** A trait off a sheet, for an amount that reads one. Null for a stat block. */
  traitValue(id: string, trait: Trait | 'spellcast' | 'proficiency'): number | null;
  /** The creature's primary weapon dice (an adversary's attack), or null when it has none. */
  weaponDamage(id: string): ParsedDamage | null;
  /** A weapon attack, rolled and applied. */
  attack(
    request: {
      attacker: string;
      target: string;
      weapon: 'primary' | 'secondary';
      advantage?: number;
      damageBonus?: number;
      /** Damage dice instead of the attacker's own. */
      damage?: string;
      /** Reach instead of the attacker's own, when a feature says further. */
      range?: RangeBand;
      /** Damage no Armor Slot reduces. */
      direct?: boolean;
      /**
       * Creatures that pile in behind this one: they walk into reach and the
       * damage is multiplied by how many are standing there. Resolved by the
       * caller, because who they are is a selector read with the script's own
       * bindings.
       */
      joinedBy?: readonly string[];
    },
    rng: Rng,
  ): AttackSummary;
  /** Knock a creature away from another to a band. Null when it could not move at all. */
  pushBack(from: string, target: string, band: RangeBand): { from: number; to: number } | null;
  /** Walk towards a creature until within a band, as far as the budget allows; `route` is the line crossed. */
  drawIn(mover: string, toward: string, band: RangeBand, budget?: RangeBand): { from: number; to: number; route?: readonly Spot[] } | null;
  /** The same, at a tile: a run across the map rather than at somebody. */
  drawTo(mover: string, goalTile: number, band: RangeBand, budget?: RangeBand): { from: number; to: number; route?: readonly Spot[] } | null;
  blinkTo(mover: string, goalTile: number, band?: RangeBand): { from: number; to: number } | null;
  /** Walk away from a creature, as far as the budget allows. */
  breakAway(mover: string, from: string, budget?: RangeBand): { from: number; to: number; route?: readonly Spot[] } | null;
  /**
   * Put creatures off a stat block onto the map, in the band named, around the
   * one summoning them. Returns the ones that found somewhere to stand.
   */
  summon(definition: string, count: number, range: RangeBand): { ids: string[]; refused?: string };
  /** How many of a faction are still standing. */
  countAlive(faction: 'party' | 'adversary'): number;
  factionOf(id: string): 'party' | 'adversary' | null;
  /** Arm a countdown, replacing one already running under the same id. */
  startCountdown(countdown: RunningCountdown): void;
  placeZone(zone: RunningZone): void;
  endZone(id: string): boolean;
  refreshZones(): void;
  tileOf(id: string): number;
  /** Whether a creature has already been given the spotlight this GM turn. */
  spotlightSpent(id: string): boolean;
  /** Creatures ordered by how close they are to another, ties by id. */
  nearestFirst(from: string, ids: readonly string[]): string[];
  /**
   * Take the creature acting off the map and stand this many of another stat
   * block where it was: a phase change, a Split.
   */
  replace(definition: string, count: number): { ids: string[]; was?: string; refused?: string };
  /** A reaction roll: a d20 for an adversary, Duality Dice for a party member. */
  rollReaction(
    id: string,
    difficulty: number,
    trait: Trait,
    rng: Rng,
  ): { success: boolean; total: number; roll?: DualityRoll };
}

/** One thing that happened, in order. A UI renders these; a test asserts on them. */
export type JournalEntry =
  | { kind: 'log'; text: string; tone: LogTone }
  | { kind: 'story'; title: string; paragraphs: readonly string[]; button: string }
  | { kind: 'flag'; flag: string; set: boolean }
  | { kind: 'key'; key: string }
  /** Items gained or lost. `change` is negative when they went. */
  | { kind: 'item'; item: string; change: number }
  | { kind: 'var'; name: string; value: ScriptValue }
  | { kind: 'interactable'; id: string; change: 'open' | 'closed' | 'removed' | 'used' }
  | { kind: 'openContainer'; id: string }
  | { kind: 'teleport'; pair: string; from: string | null }
  | { kind: 'loot'; table?: string; found: readonly { item: string; quantity: number }[] }
  /** `targets` and `dice` are set when the damage was rolled at someone. */
  | {
      kind: 'damage';
      amount: number;
      marked: number;
      source?: string;
      targets?: readonly string[];
      dice?: string;
      /** What the targets' own passives took off, added up. */
      reduced?: number;
    }
  /** `ids` is who was healed, for a view that shows it over their heads. */
  | { kind: 'heal'; amount: number; cleared: number; ids?: readonly string[]; spread?: true }
  | { kind: 'encounter'; id: string; change: 'started' | 'ended'; intro?: string }
  | { kind: 'goto'; scene: string }
  | { kind: 'dialogue'; dialogue: string }
  | { kind: 'attitude'; id: string; attitude: 'friendly' | 'hostile' }
  | { kind: 'quest'; quest: string; change: 'started' | 'completed' | 'failed' }
  | { kind: 'levelUp'; level: number }
  /** `id` is set when the Light went to someone other than the actor. */
  | { kind: 'good'; gained: number; id?: string }
  | { kind: 'goodLost'; lost: number; id: string }
  | { kind: 'goodSpent'; amount: number }
  | { kind: 'bad'; gained: number }
  /** Shadow taken off the GM's pool, which a card can do and a stat block cannot. */
  | { kind: 'badLost'; lost: number }
  | { kind: 'objective'; quest: string; objective: string }
  | { kind: 'revealed'; quest: string; objective: string }
  | { kind: 'chose'; label: string; index: number }
  /** `targets` are who the roll was against, `hit` the ones it beat. */
  | { kind: 'check'; outcome: CheckOutcome; roll: DualityRoll; targets: readonly string[]; hit: readonly string[]; reused?: boolean }
  | { kind: 'experience'; name: string; modifier: number }
  /** An effect that could not happen: no Light to spend, no Spellcast trait, no target. */
  | { kind: 'refused'; reason: string }
  | { kind: 'stress'; id: string; marked: number; cleared: number; hitPoints: number }
  | { kind: 'armor'; id: string; cleared: number }
  | { kind: 'tokens'; id: string; ability: string; added: number; spent: number; left: number }
  | { kind: 'condition'; id: string; condition: string; applied: boolean }
  | {
      kind: 'attack';
      attacker: string;
      target: string;
      weapon: string;
      hit: boolean;
      critical: boolean;
      hitPointsMarked: number;
      /** What the target's own passives took off before the thresholds. */
      reduced?: number;
      /** Who swung with them, when a feature called the rest of its kind in. */
      joined?: readonly string[];
      roll?: DualityRoll;
    }
  /** `walked` is the creature crossing the ground itself, along `route` when it is known; otherwise it was shoved. */
  | { kind: 'moved'; id: string; from: number; to: number; walked?: boolean; route?: readonly Spot[] }
  /** Creatures a feature put on the map, and whether they act at once. */
  | { kind: 'summoned'; adversary: string; ids: readonly string[]; spotlight: boolean }
  /** A clock armed. Advancing it is the game's job, not the runner's. */
  | { kind: 'countdown'; countdown: string; name: string; value: number }
  /** The GM's turn handed to its own side. Paid for by whatever said so. */
  | { kind: 'spotlighted'; ids: readonly string[]; halfDamage: boolean }
  /** The spotlight this script is running in ends without its creature acting. */
  | { kind: 'spotlightEnded'; id: string | null }
  /** The creature acting takes another spotlight, already paid for. */
  | { kind: 'spotlightedAgain'; id: string | null }
  /** One die of the blow being held comes up its highest face instead. */
  | { kind: 'dieMaxed' }
  /** Every face of it under this one is thrown again. */
  | { kind: 'damageRerolled'; below: number }
  /** A card put something behind a roll after it was read: what, and what it came to. */
  | { kind: 'lifted'; by: number; total: number }
  | { kind: 'dualityRerolled'; which: 'good' | 'bad' | 'both' }
  /**
   * A card named the roll's total rather than throwing it again. Written twice:
   * once by the card, with no number, as the asking; and once where the roll is
   * held, with what it came to.
   */
  | { kind: 'rollNamed'; total?: number }
  /** A card put a number behind the roll being read. */
  | { kind: 'rollRaised'; by: number }
  /** Somebody marked the ground where they stand. */
  | { kind: 'marked'; id: string; mark: string }
  /** Somebody put back on their feet at full strength. */
  | { kind: 'revived'; id: string }
  /** Somebody killed outright, past what a heal can reach. */
  | { kind: 'slain'; id: string }
  /** A patch of ground started or stopped meaning something. */
  | { kind: 'zone'; id: string; name: string; standing: boolean }
  /** Added to a blow that has landed and not yet been counted. */
  | { kind: 'damageBoosted'; id: string | null; by: number }
  /** That blow's own total counts twice, before anything added to it. */
  | { kind: 'damageDoubled'; id: string | null }
  /** And it counts as this kind of damage from here, whatever it was. */
  | { kind: 'damageRetyped'; id: string | null; types: readonly DamageType[] }
  /** That blow marks this many Hit Points instead of being rolled for. */
  | { kind: 'hitPointsForced'; id: string | null; to: number }
  /** A handful of dice rolled to see whether something happens at all. */
  | { kind: 'diceChecked'; id: string | null; dice: string; results: readonly number[]; passed: boolean }
  /** Taken off a blow that is arriving, by a card the defender played. */
  | { kind: 'blowSoftened'; id: string | null; by: number }
  /** That blow arrives and does nothing at all. */
  | { kind: 'blowAvoided'; id: string | null }
  /** That blow steps down a band, after whatever the armor did. */
  | { kind: 'severityStepped'; id: string | null; steps: number }
  /** The Difficulty that blow was rolled against, raised after the fact. */
  | { kind: 'evasionRaised'; id: string | null; by: number }
  /** That blow lands in this band instead of being rolled for, or no lower than it. */
  | { kind: 'severityForced'; id: string | null; severity: DamageSeverity; least?: boolean }
  /** One creature off the map and another in its place. `was` is its name. */
  | { kind: 'replaced'; was: string; adversary: string; ids: readonly string[]; spotlight: boolean }
  /** `roll` is set when a party member rolled it: an adversary's is a d20. */
  | { kind: 'reaction'; id: string; success: boolean; total: number; difficulty: number; roll?: DualityRoll }
  /** A defender's reaction to damage fired: Get Back Up, a Rune Ward. */
  | { kind: 'defended'; id: string; ability: string; goodSpent: number; stressMarked: number; rolled?: number };

/** What the runner is waiting for. */
export type Prompt =
  | {
      kind: 'choice';
      title?: string;
      body?: string;
      /** Only the options whose condition passed, with their original indices. */
      options: readonly { index: number; label: string; detail?: string }[];
    }
  | {
      kind: 'check';
      trait: CheckTrait;
      /** A number, or `target` when the roll is against each target's own Difficulty. */
      difficulty: number | 'target';
      modifier: number;
      prompt?: string;
      /** Who the roll is against, so a UI can name them. */
      targets: readonly string[];
      /** The actor's Experiences, each spendable for a Light with `roll.experience`. */
      experiences: readonly { name: string; modifier: number }[];
    }
  /**
   * The dice are read and nothing has come of them yet: "after an ally
   * attempts an action roll but before the consequences take place".
   *
   * Raised only when somebody is actually holding a card that answers one -
   * `answersRoll` - so every other check in the game runs exactly as it did,
   * straight from the dice to its arms. Answered with `answered`.
   */
  | { kind: 'rolled'; roll: DualityRoll; targets: readonly string[]; tags?: readonly string[]; trait?: CheckTrait }
  /** Play this conversation out, then resume with `continue`. */
  | { kind: 'dialogue'; dialogue: string };

export type RunStatus =
  | { status: 'done'; journal: readonly JournalEntry[] }
  | { status: 'waiting'; prompt: Prompt; journal: readonly JournalEntry[] };

/** The caller's answer to a prompt. */
export type Response =
  | { kind: 'choose'; index: number }
  /** The dialogue a `startDialogue` opened has finished; carry on. */
  | { kind: 'continue' }
  /**
   * Make the roll. `advantage`/`disadvantage`/`helpDice` come from the table;
   * `experience` names one of the actor's to Utilize — a Light is spent and its
   * modifier added, as the SRD has it.
   */
  | { kind: 'roll'; advantage?: number; disadvantage?: number; helpDice?: number; experience?: string }
  /**
   * What the room did about a roll it was shown: nothing, or a die put back in
   * the cup. The check carries on from where it stopped either way.
   */
  | { kind: 'answered'; reroll?: 'good' | 'bad' | 'both'; name?: boolean; raise?: number }
  /** Decline the roll — the legacy dialog let a player back out, costing nothing. */
  | { kind: 'cancel' };

/**
 * A script in progress.
 *
 * The pending stack holds the effects still to run, innermost list first, so a
 * choice or a check can splice its branch in without recursion or a copy of the
 * whole remaining script.
 */
export interface ScriptRunnerOptions {
  /** The interactable a bare `open`/`remove`/`markUsed` refers to. */
  subject?: string;
  /** The creatures `target` names: what the player chose when using an ability. */
  targets?: readonly string[];
  /**
   * The tile `point` names: what the player aimed at, for a card that runs a
   * path across the map or drops something on a spot. `NO_TILE` or nothing is
   * a card nobody aimed, and every shape reads it as catching nobody.
   */
  point?: number;
  /**
   * The creatures `hit` names, for a script that answers a blow that has
   * already landed: a stat block's "targets who mark HP from this attack…".
   */
  hit?: readonly string[];
  /**
   * Whose hand rolls a plain trait check. An object's check has always been
   * the party's best; an ability's is the actor's own.
   */
  rollAs?: 'party' | 'actor';
  /**
   * Numbers the blow that started this script left behind - how many Hit
   * Points it marked on whoever is answering it. A count nobody passes reads
   * as zero, which is what a feature run out of nowhere should see.
   */
  counts?: Partial<Record<CountName, number>>;
  /**
   * The damage that blow rolled, so `dice: 'same'` can carry it over: "deal an
   * amount of damage to the attacker equal to half the damage they dealt".
   */
  lastDamage?: { total: number; types?: readonly DamageType[] };
  /**
   * The roll that called for this script, for a feature that answers one: "when
   * a PC rolls a failure with Shadow". Read by a `rolled` condition, wherever one
   * is asked inside it.
   */
  roll?: { total: number; outcome: RollOutcome; tags?: readonly string[]; trait?: CheckTrait };
  /**
   * And the whole of that roll, when it was a swing, so a card answering it can
   * *reuse* it rather than only ask what it was: "they can hit an additional
   * target that their attack roll would succeed against".
   *
   * `roll` above is the summary a `rolled` gate reads; this is the dice. Only a
   * blow made outside the runner needs it - a script that swings sets its own
   * last roll as it goes.
   */
  swing?: DualityRoll;
}

/** A check whose dice have been read and whose arms have not run yet. */
interface RolledCheck {
  roll: DualityRoll;
  targets: readonly string[];
  difficulties: readonly number[];
}

/** A list of effects part-way through, and what `hit` meant when it was pushed. */
/**
 * The longest list of numbers a `howMany` will offer. Nobody reads twenty
 * buttons, and a pool that deep means the card wanted a different question.
 */
const HOW_MANY_LIMIT = 12;

interface Frame {
  effects: readonly Effect[];
  index: number;
  hit?: readonly string[];
}

export class ScriptRunner {
  private readonly world: ScriptWorld;
  private readonly rng: Rng;
  private readonly journal: JournalEntry[] = [];
  /** Stacked cursors into effect lists: [list, next index]. */
  private readonly stack: Frame[] = [];
  /**
   * What the script stopped on, and - for a check stopped after its dice - the
   * throw it stopped with, so resuming settles that roll rather than making a
   * new one.
   */
  private pending: { effect: Effect; rolled?: RolledCheck } | null = null;

  /**
   * The interactable this script was started from, if any. `open`, `remove` and
   * `markUsed` with no id of their own mean "this one" — which is how an author
   * writes a chest's outcome without repeating the chest's id in every branch.
   */
  private readonly subject: string | null;
  private readonly targets: readonly string[];
  private readonly rollAs: 'party' | 'actor';
  /** The creatures the last roll beat. */
  private hit: readonly string[] = [];
  /** The last action roll made, for a critical's extra damage and `difficulty: 'roll'`. */
  private lastRoll: DualityRoll | null = null;
  /** The last damage rolled in this script, for `dice: 'same'`. */
  private lastDamage: { total: number; dice: string; types: readonly DamageType[] } | null = null;
  /**
   * The numbers a written amount can be swapped for. What came in is seeded by
   * whoever started the script; what went out this script keeps for itself, as
   * its damage lands.
   */
  private readonly counts: Record<(typeof COUNT_NAMES)[number], number> = {
    hitPointsTaken: 0,
    hitPointsDealt: 0,
    targetsHit: 0,
  };
  /** The roll that called for this script, when something did. */
  private readonly answering: { total: number; outcome: RollOutcome } | null;

  /** Whether any action roll in this script hands the spotlight to the GM. */
  spotlightToGm = false;
  /** Whether an action roll was made at all. */
  rolled = false;
  /** Whether a roll it asked for was declined. */
  cancelled = false;

  /** The tile this script was aimed at, or `NO_TILE`. */
  private readonly point: number;

  /** "Then place this card in your vault": whether this script said so. */
  vaulted = false;

  /**
   * The last action roll this script made, for whoever ran it to read what came of it, the way
   * `spotlightToGm` and `cancelled` are read: null before one is made.
   */
  get lastActionRoll(): DualityRoll | null {
    return this.lastRoll;
  }

  constructor(world: ScriptWorld, rng: Rng, options: ScriptRunnerOptions = {}) {
    this.world = world;
    this.rng = rng;
    this.subject = options.subject ?? null;
    this.targets = [...(options.targets ?? [])];
    this.point = options.point ?? NO_TILE;
    this.hit = [...(options.hit ?? [])];
    this.rollAs = options.rollAs ?? 'party';
    this.answering = options.roll ?? null;
    for (const name of COUNT_NAMES) this.counts[name] = options.counts?.[name] ?? 0;
    // The dice of the swing that raised this, so `roll: 'last'` reuses them.
    if (options.swing !== undefined) this.lastRoll = options.swing;
    if (options.lastDamage !== undefined) {
      this.lastDamage = { total: options.lastDamage.total, dice: '', types: options.lastDamage.types ?? [] };
    }
  }

  /**
   * A written amount, or the count it names. `targetsHit` is read when it is
   * asked for rather than kept, because the roll that bound `hit` may have
   * happened since this script started.
   */
  /** The dice a gate may throw: this script's own stream, and its way of reading an amount. */
  private dice(): DiceHand {
    return {
      roll: (dice) => {
        const parsed = parseDice(dice);
        return parsed === null ? 0 : rollDice(this.rng, parsed).total;
      },
      amount: (amount) => this.amountOf(amount, 0),
    };
  }

  private amountOf(amount: Amount | undefined, fallback = 1): number {
    if (amount === undefined) return fallback;
    if (typeof amount === 'number') return amount;
    if (typeof amount === 'object') {
      // "Equal to the Demon's current number of marked HP": the actor's own
      // when nothing says otherwise, and nobody there is a quiet zero rather
      // than a refusal, the way an empty count is.
      // How many a selector names, rather than a number read off one of them.
      if ('count' in amount) return this.resolve(amount.count).length;
      // The one amount that draws dice. Thrown here rather than read off
      // anything, so it comes off the same seeded stream as everything else.
      if ('dice' in amount) {
        const actor = this.world.actorId();
        const parsed = parseDice(amount.dice);
        if (parsed === null) return 0;
        const expr =
          amount.using === 'proficiency' && actor !== null
            ? withProficiency(parsed, this.world.proficiencyOf(actor))
            : parsed;
        const thrown = rollDice(this.rng, expr);
        return amount.pick === 'highest'
          ? (thrown.rolls.length === 0 ? 0 : Math.max(...thrown.rolls) + expr.modifier)
          : thrown.total;
      }
      const who = this.resolve(amount.of ?? { kind: 'actor' })[0];
      if (who === undefined) return 0;
      if ('tokens' in amount) return this.world.tokensOn(who, amount.tokens);
      // "Twice your Strength": a trait nobody has is nothing added, which is
      // what a stat block reading a card's amount should come to.
      if ('trait' in amount) return (this.world.traitValue(who, amount.trait) ?? 0) * (amount.times ?? 1);
      return this.world.poolValue(who, amount.pool, amount.measure ?? 'marked') ?? 0;
    }
    if (amount === 'targetsHit') return this.hit.length;
    // `spent` never reaches here: `howMany` writes the number into a copy of
    // its effects, so anything still carrying the word is asking about nothing.
    if (amount === 'spent') return 0;
    return this.counts[amount];
  }

  /**
   * A copy of an effect list with the player's answer written into it.
   *
   * `'spent'` wherever an amount is written becomes the number; `{n}` inside
   * any string - dice, a countdown's start, a label - becomes the digits. This
   * is why `howMany` needs no binding: by the time these effects run there is
   * nothing left to look up.
   */
  private answered(effects: readonly Effect[], n: number): Effect[] {
    const rewrite = (value: unknown, key: string): unknown => {
      // `spent` is the number wherever a number was asked for - an amount, or
      // how many times to roll something. Every other string takes it as text.
      if (typeof value === 'string') {
        return (key === 'amount' || key === 'times') && value === 'spent' ? n : value.replaceAll('{n}', String(n));
      }
      if (Array.isArray(value)) return value.map((item) => rewrite(item, key));
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, k)]));
      }
      return value;
    };
    return rewrite(effects, '') as Effect[];
  }

  /** Start a script. Returns as soon as it finishes or needs an answer. */
  run(effects: readonly Effect[]): RunStatus {
    this.stack.push({ effects, index: 0 });
    return this.step();
  }

  /** Answer the outstanding prompt and continue. */
  resume(response: Response): RunStatus {
    const waiting = this.pending;
    if (waiting === null) {
      throw new Error('resume() was called while the script was not waiting for anything');
    }
    this.pending = null;

    if (waiting.effect.kind === 'choice') {
      this.applyChoice(waiting.effect.options, response);
    } else if (waiting.effect.kind === 'check') {
      // A check stopped after its dice settles them; one stopped before them
      // throws. The second can stop again, which is the only prompt in the
      // runner raised by something other than an effect.
      if (waiting.rolled !== undefined) {
        this.settleCheck(waiting.effect.check, waiting.rolled, response);
      } else {
        const again = this.applyCheck(waiting.effect.check, response);
        if (again !== null) return { status: 'waiting', prompt: again, journal: this.journal };
      }
    }
    return this.step();
  }

  /** Everything that has happened so far. */
  get entries(): readonly JournalEntry[] {
    return this.journal;
  }

  /** What `target` and `hit` mean right now. */
  bindings(): TargetBindings {
    return {
      targets: this.targets,
      hit: this.hit,
      counts: { ...this.counts, targetsHit: this.hit.length },
      ...(this.point === NO_TILE ? {} : { point: this.point }),
      ...(this.answering === null ? {} : { roll: this.answering }),
    };
  }

  private resolve(selector: TargetSelector): string[] {
    return this.world.resolveTargets(selector, this.bindings());
  }

  private refuse(reason: string): null {
    this.journal.push({ kind: 'refused', reason });
    return null;
  }

  private applyChoice(options: readonly ChoiceOption[], response: Response): void {
    if (response.kind !== 'choose') {
      // Cancelling a choice picks nothing; the caller may put the card back.
      if (response.kind === 'cancel') this.cancelled = true;
      return;
    }
    const option = options[response.index];
    if (option === undefined || !evaluateOptional(option.available, this.world, this.bindings(), this.dice())) return;
    this.journal.push({ kind: 'chose', label: option.label, index: response.index });
    this.stack.push({ effects: option.effects, index: 0 });
  }

  /**
   * The last roll stands against these targets too: the same total, the same
   * Light or Shadow, no dice. A target it does not reach is simply not hit; with
   * nobody reached the failure branch runs, flavoured as the roll was.
   */
  private reuseRoll(check: CheckRequest): null {
    const roll = this.lastRoll;
    if (roll === null) return this.refuse('no roll to reuse');
    const targets = check.targets === undefined ? [...this.targets] : this.resolve(check.targets);
    const beats = (difficulty: number): boolean => roll.critical || roll.total >= difficulty;
    const hit =
      check.difficulty === 'target'
        ? targets.filter((id) => beats(this.world.difficultyOf(id) ?? Infinity))
        : beats(check.difficulty)
          ? targets
          : [];
    const outcome: CheckOutcome =
      hit.length > 0 || targets.length === 0 ? roll.outcome : roll.good > roll.bad ? 'failureWithGood' : 'failureWithBad';
    this.hit = hit;
    this.journal.push({ kind: 'check', outcome, roll, targets, hit, reused: true });
    if (check.always !== undefined) this.stack.push({ effects: check.always, index: 0, hit });
    this.stack.push({ effects: outcomeEffects(check, outcome), index: 0, hit });
    return null;
  }

  private applyCheck(check: CheckRequest, response: Response): Prompt | null {
    if (response.kind !== 'roll') {
      // Declining costs nothing, as the legacy dialog did; the caller may put the card back.
      if (response.kind === 'cancel') this.cancelled = true;
      return null;
    }

    const base = this.world.checkModifier(check.trait, this.rollAs);
    if (base === null) {
      this.refuse(`no ${check.trait} trait to roll with`);
      return null;
    }
    let modifier = base;

    // Utilize an Experience: a Light for its modifier, before the dice.
    const actor = this.world.actorId();
    if (response.experience !== undefined) {
      const found = this.world.experiences().find((e) => e.name === response.experience);
      if (found !== undefined && actor !== null && this.world.spendGood(actor, 1)) {
        modifier += found.modifier;
        this.journal.push({ kind: 'goodSpent', amount: 1 });
        this.journal.push({ kind: 'experience', name: found.name, modifier: found.modifier });
      }
    }

    // One roll, however many targets. Against targets, the Difficulty that
    // decides success is the lowest, and each target is beaten on its own
    // number; against a fixed Difficulty, all of them stand or fall together.
    const targets = check.targets === undefined ? [...this.targets] : this.resolve(check.targets);
    const difficulties =
      check.difficulty === 'target'
        ? targets.map((id) => this.world.difficultyOf(id) ?? Infinity)
        : [check.difficulty];
    const difficulty = difficulties.length === 0 ? Infinity : Math.min(...difficulties);

    // What the roller was carrying for their next roll, and this is it, plus
    // what the creatures it is aimed at do to any roll aimed at them. Both go
    // on the same scales the table asked for, so a die of each still cancels
    // rather than all of them being rolled.
    const carried = this.world.advantageRolling();
    const aimed = this.world.advantageAgainst(targets);
    const net =
      (response.advantage ?? 0) -
      (response.disadvantage ?? 0) +
      carried.advantage -
      carried.disadvantage +
      aimed.advantage -
      aimed.disadvantage;
    const thrown = rollDuality(this.rng, {
      difficulty,
      modifier,
      ...(net > 0 ? { advantage: net } : {}),
      ...(net < 0 ? { disadvantage: -net } : {}),
      ...(response.helpDice === undefined ? {} : { helpDice: response.helpDice }),
      ...(actor === null ? {} : { goodDieSides: this.world.goodDieSides(actor) }),
    });
    // What the roller's own cards put behind a roll that has been read and has
    // not yet decided anything - the one moment the runner owns that the game
    // layer cannot reach. The dice stand; only the modifier moves, and the
    // whole roll is read again around it, so a lift that carries the total over
    // the Difficulty changes which arm runs.
    const lifted = actor === null ? 0 : this.world.liftRoll(actor, check.trait, thrown.total, difficulty, thrown.critical);
    const roll = lifted === 0 ? thrown : withFaces({ ...thrown, modifier: thrown.modifier + lifted }, {});
    if (lifted > 0) this.journal.push({ kind: 'lifted', by: lifted, total: roll.total });

    // And the moment somebody else can reach it. Only raised when a card that
    // answers a roll is actually in somebody's hand, so every other check goes
    // straight on to its arms exactly as it always did.
    const stopped: RolledCheck = { roll, targets, difficulties };
    const said = { ...(check.tags === undefined ? {} : { tags: check.tags }), trait: check.trait };
    if (actor !== null && this.world.answersRoll(actor, { total: roll.total, outcome: roll.outcome, ...said })) {
      // Waiting again, on the same effect and on the throw it stopped with, so
      // resuming settles these dice rather than reaching for new ones.
      this.pending = { effect: { kind: 'check', check }, rolled: stopped };
      return { kind: 'rolled', roll, targets, ...said };
    }
    this.settleCheck(check, stopped, null);
    return null;
  }

  /**
   * What a check's dice meant, once nothing more is going to change them.
   *
   * Split from the throw because a card can be offered in between: "after an
   * ally attempts an action roll but before the consequences take place". A
   * die put back in the cup is thrown here, and the whole roll read again
   * around the new pair, so the arm that runs is the one the new dice chose.
   */
  private settleCheck(check: CheckRequest, stopped: RolledCheck, response: Response | null): void {
    const { targets, difficulties } = stopped;
    let roll = stopped.roll;
    if (response !== null && response.kind === 'answered' && response.reroll !== undefined) {
      const faces: { good?: number; bad?: number } = {};
      if (response.reroll !== 'bad') faces.good = this.rng.die(roll.goodSides ?? GOOD_DIE_SIDES);
      if (response.reroll !== 'good') faces.bad = this.rng.die(BAD_DIE_SIDES);
      roll = withFaces(roll, faces);
      this.journal.push({ kind: 'dualityRerolled', which: response.reroll });
    }
    // A number put behind it - a trait for a Light - goes on before a named
    // total, which then only has to make up whatever is still short.
    if (response !== null && response.kind === 'answered' && response.raise !== undefined && response.raise > 0) {
      roll = withFaces({ ...roll, modifier: roll.modifier + response.raise }, {});
      this.journal.push({ kind: 'lifted', by: response.raise, total: roll.total });
    }
    // And the other thing that can be done to it: the total named rather than
    // the dice thrown again. The faces stand, so a roll with Shadow stays one.
    if (response !== null && response.kind === 'answered' && response.name === true && !roll.success) {
      roll = withFaces({ ...roll, modifier: roll.modifier + (roll.difficulty - roll.total) }, {});
      this.journal.push({ kind: 'rollNamed', total: roll.total });
    }
    const hit =
      check.difficulty === 'target'
        ? targets.filter((_, i) => roll.critical || roll.total >= difficulties[i]!)
        : roll.success
          ? targets
          : [];
    this.hit = hit;
    this.lastRoll = roll;
    this.rolled = true;
    this.spotlightToGm = this.spotlightToGm || roll.spotlightToGm;
    this.journal.push({ kind: 'check', outcome: roll.outcome, roll, targets, hit });

    // The core loop: a roll with Light hands the roller a Light, a roll with
    // Shadow hands the GM a Shadow, and a critical clears a Stress. Attacks
    // already did this; a chest and a conversation are rolls too.
    if (roll.goodGained > 0 && this.world.gainGood()) {
      this.journal.push({ kind: 'good', gained: roll.goodGained });
    }
    if (roll.badGained > 0 && this.world.gainBad()) {
      this.journal.push({ kind: 'bad', gained: roll.badGained });
    }
    // Read again rather than carried across the pause: whoever is acting when
    // the dice are settled is who the critical clears a Stress from.
    const roller = this.world.actorId();
    if (roll.stressCleared > 0 && roller !== null) {
      const cleared = this.world.clearStress(roller, roll.stressCleared);
      if (cleared > 0) this.journal.push({ kind: 'stress', id: roller, marked: 0, cleared, hitPoints: 0 });
    }

    // `always` runs after the outcome branch, so it is pushed first.
    if (check.always !== undefined) this.stack.push({ effects: check.always, index: 0, hit });
    this.stack.push({ effects: outcomeEffects(check, roll.outcome), index: 0, hit });
  }

  /**
   * Whether an effect can have put somebody on different ground.
   *
   * A zone is read from where creatures are standing, so anything that moves
   * one - a walk, a shove, a blink, something arriving or being replaced - has
   * to be followed by a look at who is in what. Listed here rather than at
   * each case so a new way to move somebody is one line, not a hunt.
   */
  private moves(effect: Effect): boolean {
    return (
      effect.kind === 'move' ||
      effect.kind === 'push' ||
      effect.kind === 'summon' ||
      effect.kind === 'replace' ||
      effect.kind === 'attack'
    );
  }

  private step(): RunStatus {
    while (this.stack.length > 0) {
      const frame = this.stack[this.stack.length - 1]!;
      if (frame.index >= frame.effects.length) {
        this.stack.pop();
        continue;
      }
      // A frame pushed with its own `hit` — a reaction's failures, an attack's
      // target — reads that list, however the roll after it went.
      if (frame.hit !== undefined) this.hit = frame.hit;
      const effect = frame.effects[frame.index++]!;
      const prompt = this.apply(effect);
      // What everybody bears has to match where they are standing: a blow that
      // knocked somebody out of a zone takes its light with them.
      if (this.moves(effect)) this.world.refreshZones();
      if (prompt !== null) {
        this.pending = { effect };
        return { status: 'waiting', prompt, journal: this.journal };
      }
    }
    return { status: 'done', journal: this.journal };
  }

  /** Run one effect. Returns a prompt when it needs the player, otherwise null. */
  private apply(effect: Effect): Prompt | null {
    const world = this.world;
    switch (effect.kind) {
      case 'none':
        return null;
      case 'log':
        this.journal.push({ kind: 'log', text: effect.text, tone: effect.tone ?? 'narration' });
        return null;
      case 'story':
        this.journal.push({
          kind: 'story',
          title: effect.title,
          paragraphs: effect.paragraphs,
          button: effect.button ?? 'Continue',
        });
        return null;
      case 'setFlag':
        world.setFlag(effect.flag);
        this.journal.push({ kind: 'flag', flag: effect.flag, set: true });
        return null;
      case 'clearFlag':
        world.clearFlag(effect.flag);
        this.journal.push({ kind: 'flag', flag: effect.flag, set: false });
        return null;
      case 'giveKey':
        // A key is an item you have one of; `giveKey` stays in the vocabulary
        // because content is written with it.
        world.giveKey(effect.key);
        this.journal.push({ kind: 'key', key: effect.key });
        return null;
      case 'levelUp': {
        const reached = world.grantLevel(effect.level);
        if (reached !== null) this.journal.push({ kind: 'levelUp', level: reached });
        return null;
      }
      case 'startQuest':
        if (world.startQuest(effect.quest)) {
          this.journal.push({ kind: 'quest', quest: effect.quest, change: 'started' });
        }
        return null;
      case 'completeObjective': {
        // Ticking a step off a quest nobody started starts it, so "the party
        // found the thing" is one effect rather than two.
        if (world.startQuest(effect.quest)) {
          this.journal.push({ kind: 'quest', quest: effect.quest, change: 'started' });
        }
        if (world.completeObjective(effect.quest, effect.objective)) {
          this.journal.push({ kind: 'objective', quest: effect.quest, objective: effect.objective });
        }
        return null;
      }
      case 'revealObjective':
        if (world.startQuest(effect.quest)) {
          this.journal.push({ kind: 'quest', quest: effect.quest, change: 'started' });
        }
        if (world.revealObjective(effect.quest, effect.objective)) {
          this.journal.push({ kind: 'revealed', quest: effect.quest, objective: effect.objective });
        }
        return null;
      case 'completeQuest':
        if (world.completeQuest(effect.quest)) {
          this.journal.push({ kind: 'quest', quest: effect.quest, change: 'completed' });
        }
        return null;
      case 'failQuest':
        if (world.failQuest(effect.quest)) {
          this.journal.push({ kind: 'quest', quest: effect.quest, change: 'failed' });
        }
        return null;
      case 'addItem': {
        const quantity = effect.quantity ?? 1;
        world.addItem(effect.item, quantity);
        this.journal.push({ kind: 'item', item: effect.item, change: quantity });
        return null;
      }
      case 'removeItem': {
        // Journal what actually went, not what was asked for — taking three of
        // something the party has one of takes one.
        const taken = world.removeItem(effect.item, effect.quantity ?? 1);
        this.journal.push({ kind: 'item', item: effect.item, change: -taken });
        return null;
      }
      case 'setVar':
        world.setVar(effect.name, effect.value);
        this.journal.push({ kind: 'var', name: effect.name, value: effect.value });
        return null;
      case 'addVar': {
        const current = world.getVar(effect.name);
        const next = (typeof current === 'number' ? current : 0) + effect.by;
        world.setVar(effect.name, next);
        this.journal.push({ kind: 'var', name: effect.name, value: next });
        return null;
      }
      case 'open': case 'close': case 'toggleOpen': case 'remove': case 'markUsed': case 'openContainer': case 'teleport':
        return applyThingEffect(effect, world, this.journal, this.subject);
      case 'loot': {
        // The legacy importer produces table-less `loot`s; those find nothing
        // rather than throwing.
        const found = world.rollLoot(effect.table, this.rng);
        for (const drop of found) world.addItem(drop.item, drop.quantity);
        this.journal.push(
          effect.table === undefined
            ? { kind: 'loot', found }
            : { kind: 'loot', table: effect.table, found },
        );
        return null;
      }
      case 'damage':
        return effect.dice === undefined ? this.applyFlatDamage(effect) : this.applyRolledDamage(effect);
      case 'heal': {
        // "Clear 1d4 Hit Points": rolled once, then the same number for each,
        // the way rolled damage lands the one total on every target.
        let amount = effect.amount === undefined ? undefined : this.amountOf(effect.amount);
        if (amount === undefined) {
          const expression = parseDice(effect.dice ?? '');
          if (expression === null) return this.refuse(`cannot read healing dice "${effect.dice}"`);
          amount = Math.max(1, rollDamage(this.rng, expression, { proficiency: 1, critical: false }).total);
        }
        // A count that came to nothing clears nothing, and says nothing: "clear
        // a number of Stress equal to the HP marked" with none marked is a
        // quiet zero, not a refusal.
        if (amount <= 0) return null;
        const healed = effect.target ?? { kind: 'actor' as const };
        const cleared =
          effect.spread === true
            ? world.healShared(healed, amount, this.bindings())
            : world.heal(healed, amount, this.bindings());
        this.journal.push({ kind: 'heal', amount, cleared, ids: this.resolve(healed), ...(effect.spread === true ? { spread: true } : {}) });
        return null;
      }
      case 'startEncounter':
        world.startEncounter(effect.encounter);
        this.journal.push({
          kind: 'encounter',
          id: effect.encounter,
          change: 'started',
          ...(effect.intro === undefined ? {} : { intro: effect.intro }),
        });
        return null;
      case 'endEncounter':
        world.endEncounter(effect.encounter);
        this.journal.push({ kind: 'encounter', id: effect.encounter, change: 'ended' });
        return null;
      case 'goto':
        this.journal.push({ kind: 'goto', scene: effect.scene });
        return null;
      case 'startDialogue':
        // A conversation is not something a script can run past. Like `choice`
        // and `check`, it stops here and hands the caller a prompt; the caller
        // plays the dialogue out and resumes with `continue`. Journalling it and
        // running on would leave the ordering of everything after it undefined.
        this.journal.push({ kind: 'dialogue', dialogue: effect.dialogue });
        return { kind: 'dialogue', dialogue: effect.dialogue };
      case 'branch': {
        const taken = evaluateOptional(effect.when, world, this.bindings(), this.dice()) ? effect.then : effect.otherwise;
        if (taken !== undefined && taken.length > 0) this.stack.push({ effects: taken, index: 0 });
        return null;
      }
      case 'choice': {
        const options = effect.options
          .map((option, index) => ({ option, index }))
          .filter(({ option }) => evaluateOptional(option.available, world, this.bindings(), this.dice()))
          .map(({ option, index }) => ({
            index,
            label: option.label,
            ...(option.detail === undefined ? {} : { detail: option.detail }),
          }));
        // A choice with nothing to choose is not a dead end; it is simply skipped.
        if (options.length === 0) return null;
        return {
          kind: 'choice',
          ...(effect.title === undefined ? {} : { title: effect.title }),
          ...(effect.body === undefined ? {} : { body: effect.body }),
          options,
        };
      }
      case 'check': {
        if (effect.check.roll === 'last') return this.reuseRoll(effect.check);
        const modifier = world.checkModifier(effect.check.trait, this.rollAs);
        // A roll the actor cannot make is refused here, before a prompt that
        // could only be declined.
        if (modifier === null) return this.refuse(`no ${effect.check.trait} trait to roll with`);
        return {
          kind: 'check',
          trait: effect.check.trait,
          difficulty: effect.check.difficulty,
          modifier,
          ...(effect.check.prompt === undefined ? {} : { prompt: effect.check.prompt }),
          targets: effect.check.targets === undefined ? [...this.targets] : this.resolve(effect.check.targets),
          experiences: world.experiences(),
        };
      }
      case 'markStress': {
        const amount = this.amountOf(effect.amount);
        if (amount <= 0) return null;
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const result = world.markStress(id, amount);
          this.journal.push({ kind: 'stress', id, marked: result.stressMarked, cleared: 0, hitPoints: result.hpMarked });
        }
        return null;
      }
      case 'clearStress': {
        const amount = this.amountOf(effect.amount);
        if (amount <= 0) return null;
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const cleared = world.clearStress(id, amount);
          if (cleared > 0) this.journal.push({ kind: 'stress', id, marked: 0, cleared, hitPoints: 0 });
        }
        return null;
      }
      case 'clearArmor': {
        const amount = effect.amount ?? 1;
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const cleared = world.clearArmor(id, amount);
          if (cleared > 0) this.journal.push({ kind: 'armor', id, cleared });
        }
        return null;
      }
      case 'gainGood': {
        const amount = this.amountOf(effect.amount);
        const actor = world.actorId();
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const gained = world.gainGoodFor(id, amount);
          if (gained > 0) this.journal.push(id === actor ? { kind: 'good', gained } : { kind: 'good', gained, id });
        }
        return null;
      }
      case 'loseGood': {
        const amount = this.amountOf(effect.amount);
        if (amount <= 0) return null;
        for (const id of this.resolve(effect.target ?? { kind: 'hit' })) {
          const lost = this.world.loseGood(id, amount);
          if (lost > 0) this.journal.push({ kind: 'goodLost', lost, id });
        }
        return null;
      }
      case 'spendGood': {
        const amount = this.amountOf(effect.amount);
        const actor = world.actorId();
        if (actor === null || !world.spendGood(actor, amount)) return this.refuse(`not enough Light to spend ${amount}`);
        this.journal.push({ kind: 'goodSpent', amount });
        return null;
      }
      case 'applyCondition':
        for (const id of this.resolve(effect.target ?? { kind: 'target' })) {
          if (world.applyCondition(id, effect.condition, effect.duration ?? 'temporary')) {
            this.journal.push({ kind: 'condition', id, condition: effect.condition, applied: true });
          }
        }
        return null;
      case 'slay': {
        const killed = world.slay(effect.target ?? { kind: 'hit' }, this.bindings());
        for (const id of killed) this.journal.push({ kind: 'slain', id });
        return null;
      }
      case 'setAttitude': {
        for (const id of this.resolve(effect.target ?? { kind: 'target' })) {
          if (world.setAttitude(id, effect.attitude)) this.journal.push({ kind: 'attitude', id, attitude: effect.attitude });
        }
        return null;
      }
      case 'revive': {
        const raised = world.revive(effect.target ?? { kind: 'target' }, this.bindings());
        for (const id of raised) this.journal.push({ kind: 'revived', id });
        return null;
      }
      case 'clearCondition':
        for (const id of this.resolve(effect.target ?? { kind: 'target' })) {
          if (world.clearCondition(id, effect.condition)) {
            this.journal.push({ kind: 'condition', id, condition: effect.condition, applied: false });
          }
        }
        return null;
      case 'attack':
        return this.applyAttack(effect);
      case 'summon': {
        const expression = parseDice(effect.count ?? '1');
        if (expression === null) return this.refuse(`cannot read a count of "${effect.count ?? ''}"`);
        // "A number equal to twice the number of PCs": the ones still fighting.
        const each = Math.max(0, rollDice(this.rng, expression).total);
        const wanted = effect.perPc === true ? each * this.world.countAlive('party') : each;
        if (wanted === 0) return this.refuse('nothing to summon');
        const arrived = this.world.summon(effect.adversary, wanted, effect.range ?? 'close');
        if (arrived.ids.length === 0) return this.refuse(arrived.refused ?? 'nobody arrived');
        this.journal.push({
          kind: 'summoned',
          adversary: effect.adversary,
          ids: arrived.ids,
          spotlight: effect.spotlight === true,
        });
        return null;
      }
      case 'replace': {
        const actor = world.actorId();
        if (actor === null) return this.refuse('nobody to replace');
        const expression = parseDice(effect.count ?? '1');
        if (expression === null) return this.refuse(`cannot read "${effect.count ?? ''}" of them`);
        const wanted = Math.max(0, rollDice(this.rng, expression).total);
        if (wanted === 0) return this.refuse('nothing to replace them with');
        const stood = world.replace(effect.adversary, wanted);
        if (stood.ids.length === 0) return this.refuse(stood.refused ?? 'nothing took their place');
        this.journal.push({
          kind: 'replaced',
          was: stood.was ?? actor,
          adversary: effect.adversary,
          ids: stood.ids,
          spotlight: effect.spotlight === true,
        });
        return null;
      }
      case 'spotlight': {
        const actor = world.actorId();
        // Never the one acting: it is already in the spotlight, and never one
        // that has already had this turn's - a Leader that could hand the same
        // ally the spotlight twice would be handing out turns for nothing.
        const standing = this.resolve(effect.targets ?? { kind: 'adversaries', range: 'far' }).filter(
          (id) => id !== actor && !world.spotlightSpent(id),
        );
        if (standing.length === 0) return this.refuse('nobody left to spotlight');
        let chosen = standing;
        if (effect.count !== undefined) {
          const expression = parseDice(effect.count);
          if (expression === null) return this.refuse(`cannot read "${effect.count}" allies`);
          const wanted = Math.max(0, rollDice(this.rng, expression).total);
          if (wanted === 0) return this.refuse('nobody to spotlight');
          // "Up to 2d4 allies": the nearest of them, which is the same rule
          // the GM's own targeting uses, so a seeded fight replays.
          chosen = (actor === null ? [...standing] : world.nearestFirst(actor, standing)).slice(0, wanted);
        }
        this.journal.push({ kind: 'spotlighted', ids: chosen, halfDamage: effect.halfDamage === true });
        return null;
      }
      case 'boostDamage': {
        // "Add the Turret's standard attack damage to the damage roll": the
        // block's own printed dice, the same `weapon` the damage effect reads.
        const actor = world.actorId();
        let by = effect.amount === undefined ? 0 : this.amountOf(effect.amount, 0);
        if (effect.dice !== undefined) {
          const expression =
            effect.dice === 'weapon' ? (actor === null ? null : world.weaponDamage(actor)) : parseDice(effect.dice);
          if (expression === null) return this.refuse(`cannot read damage dice "${effect.dice}"`);
          // "Roll the dice on this card": one roll for each of them, rolled
          // separately because that is what a handful of dice is.
          const times = effect.times === undefined ? 1 : this.amountOf(effect.times, 0);
          for (let n = 0; n < times; n++) {
            by += rollDamage(this.rng, expression, { proficiency: 1, critical: false }).total;
          }
        }
        // The blow's shape before its size: a card that doubles and retypes
        // says so whether or not it also adds anything.
        if (effect.double === true) this.journal.push({ kind: 'damageDoubled', id: actor });
        if (effect.type !== undefined) this.journal.push({ kind: 'damageRetyped', id: actor, types: [effect.type] });
        if (by <= 0) return null;
        this.journal.push({ kind: 'damageBoosted', id: actor, by });
        return null;
      }
      case 'diceCheck': {
        const times = effect.times === undefined ? 1 : this.amountOf(effect.times, 0);
        const expression = parseDice(effect.dice);
        if (expression === null) return this.refuse(`cannot read dice "${effect.dice}"`);
        if (times <= 0) {
          // Nothing was rolled, so nothing came up and nothing is said about
          // it: a card whose holder spent nothing has not failed a roll.
          if (effect.otherwise !== undefined && effect.otherwise.length > 0) {
            this.stack.push({ effects: effect.otherwise, index: 0 });
          }
          return null;
        }
        const results: number[] = [];
        for (let n = 0; n < times; n++) results.push(rollDice(this.rng, expression).total);
        const came = results.filter((result) => result >= effect.atLeast).length;
        const passed = came >= (effect.needed ?? 1);
        this.journal.push({ kind: 'diceChecked', id: world.actorId(), dice: effect.dice, results, passed });
        const taken = passed ? effect.then : effect.otherwise;
        if (taken !== undefined && taken.length > 0) this.stack.push({ effects: taken, index: 0 });
        return null;
      }
      case 'softenBlow': {
        let by = effect.amount === undefined ? 0 : this.amountOf(effect.amount, 0);
        if (effect.dice !== undefined) {
          const expression = parseDice(effect.dice);
          if (expression === null) return this.refuse(`cannot read damage dice "${effect.dice}"`);
          by += rollDice(this.rng, expression).total;
        }
        if (by <= 0) return null;
        // What the thorns rolled is what the thorns are worth, both ways: the
        // blow loses it, and a `damage` reading `same` deals it back.
        this.lastDamage = { total: by, dice: effect.dice ?? '', types: [] };
        this.journal.push({ kind: 'blowSoftened', id: world.actorId(), by });
        return null;
      }
      case 'avoidBlow': {
        this.journal.push({ kind: 'blowAvoided', id: world.actorId() });
        return null;
      }
      case 'stepSeverity': {
        this.journal.push({ kind: 'severityStepped', id: world.actorId(), steps: effect.steps ?? 1 });
        return null;
      }
      case 'dodgeBy': {
        let by = effect.amount === undefined ? 0 : this.amountOf(effect.amount, 0);
        if (effect.dice !== undefined) {
          const expression = parseDice(effect.dice);
          if (expression === null) return this.refuse(`cannot read dice "${effect.dice}"`);
          by += rollDice(this.rng, expression).total;
        }
        if (by <= 0) return null;
        this.journal.push({ kind: 'evasionRaised', id: world.actorId(), by });
        return null;
      }
      case 'forceSeverity': {
        // "Deal Severe damage instead of their standard damage": the band is
        // named, and the swing waiting to be counted is told which.
        this.journal.push({
          kind: 'severityForced',
          id: world.actorId(),
          severity: effect.severity,
          ...(effect.least === true ? { least: true } : {}),
        });
        return null;
      }
      case 'forceHitPoints': {
        // "Force the target to mark a number of Hit Points equal to the number
        // you have marked": journalled the way a boost is, and obeyed by the
        // swing that is waiting to be counted.
        const to = this.amountOf(effect.amount, 0);
        if (to <= 0) return null;
        this.journal.push({ kind: 'hitPointsForced', id: world.actorId(), to });
        return null;
      }
      case 'howMany': {
        // "Spend any number of Light to roll that many d6s": one option per
        // number they could give, each carrying its own copy of the effects.
        // Pushed as an ordinary choice rather than answered here, so the
        // prompt, the log line and the resume are the ones already written.
        const least = effect.least ?? 1;
        const most = Math.min(this.amountOf(effect.most, 0), HOW_MANY_LIMIT);
        if (most < Math.max(least, 1)) return this.refuse('there is none of it to spend');
        const options: ChoiceOption[] = [];
        for (let n = least; n <= most; n++) {
          options.push({ label: n === 0 ? 'None' : String(n), effects: this.answered(effect.each, n) });
        }
        const asking: Effect = {
          kind: 'choice',
          ...(effect.title === undefined ? {} : { title: effect.title }),
          ...(effect.body === undefined ? {} : { body: effect.body }),
          options,
        };
        this.stack.push({ effects: [asking], index: 0 });
        return null;
      }
      case 'rerollDamage': {
        // Journalled rather than rolled: the faces are the game layer's, and
        // it throws them again where it can see them.
        this.journal.push({ kind: 'damageRerolled', below: effect.below });
        return null;
      }
      case 'markSpot': {
        const actor = world.actorId();
        if (actor === null) return this.refuse('nobody to mark the ground');
        if (!world.markSpot(actor, effect.mark)) return this.refuse('no ground to mark');
        this.journal.push({ kind: 'marked', id: actor, mark: effect.mark });
        return null;
      }
      case 'forgetSpot': {
        const actor = world.actorId();
        if (actor !== null) world.forgetSpot(actor, effect.mark);
        return null;
      }
      case 'raiseRoll': {
        // Read here off the holder's sheet, applied where the roll is held.
        const by = this.amountOf(effect.amount, 0);
        if (by > 0) this.journal.push({ kind: 'rollRaised', by });
        return null;
      }
      case 'nameRoll': {
        // Named here, applied where the roll is held - the same bargain the
        // rerolls beside it make.
        this.journal.push({ kind: 'rollNamed' });
        return null;
      }
      case 'rerollDuality': {
        // The same bargain as `rerollDamage`: named here, thrown where the
        // faces can be seen and the blow rebuilt around them.
        this.journal.push({ kind: 'dualityRerolled', which: effect.which });
        return null;
      }
      case 'maxOneDie': {
        // Journalled and nothing else: the dice belong to the swing, and the
        // swing belongs to whoever stopped it here.
        this.journal.push({ kind: 'dieMaxed' });
        return null;
      }
      case 'vaultCard': {
        // Read off the runner by whoever ran the card, the way `spotlightToGm`
        // and `cancelled` are: the script does not know which card it is, and
        // the loadout is not the world's to write.
        this.vaulted = true;
        return null;
      }
      case 'spotlightAgain': {
        this.journal.push({ kind: 'spotlightedAgain', id: world.actorId() });
        return null;
      }
      case 'endSpotlight': {
        // Nothing here stops the script: the rest of the list still runs, and
        // it is the turn that reads this once the script is done.
        this.journal.push({ kind: 'spotlightEnded', id: world.actorId() });
        return null;
      }
      case 'zone': {
        const actor = world.actorId();
        // Where it stands: the tile aimed at, or the one the caster is on.
        // Nowhere to put it is nothing put there, the same quiet answer a run
        // with nothing aimed gives.
        const at = effect.at === 'point' ? this.point : actor === null ? NO_TILE : world.tileOf(actor);
        if (at === NO_TILE) return null;
        world.placeZone({
          id: effect.zone,
          name: effect.name,
          owner: actor,
          condition: effect.condition,
          anchor: at,
          band: effect.band,
          ...(effect.side === undefined ? {} : { side: effect.side }),
          onDeath: effect.onDeath ?? 'keep',
          ...(effect.value === undefined ? {} : { value: effect.value }),
          ...(effect.grows === undefined ? {} : { grows: effect.grows }),
        });
        this.journal.push({ kind: 'zone', id: effect.zone, name: effect.name, standing: true });
        return null;
      }
      case 'endZone': {
        if (world.endZone(effect.zone)) {
          this.journal.push({ kind: 'zone', id: effect.zone, name: effect.zone, standing: false });
        }
        return null;
      }
      case 'countdown': {
        const expression = parseDice(effect.start);
        if (expression === null) return this.refuse(`cannot read a countdown of "${effect.start}"`);
        // Rolled here rather than in the world, because the runner is what
        // holds the seeded rng: "Countdown (1d12)" is a different fight each
        // time, but the same fight every time for a given seed.
        const start = rollDice(this.rng, expression).total;
        if (start <= 0) return this.refuse(`a countdown of "${effect.start}" starts at ${start}`);
        world.startCountdown({
          id: effect.countdown,
          name: effect.name,
          owner: world.actorId(),
          dice: effect.start,
          value: start,
          start,
          advance: effect.advance ?? 'standard',
          onDeath: effect.onDeath ?? 'end',
          ...(effect.loop === undefined ? {} : { loop: effect.loop }),
          effects: effect.effects,
        });
        this.journal.push({ kind: 'countdown', countdown: effect.countdown, name: effect.name, value: start });
        return null;
      }
      case 'push': {
        const actor = world.actorId();
        if (actor === null) return this.refuse('nobody to push from');
        for (const id of this.resolve(effect.target ?? { kind: 'target' })) {
          const moved = world.pushBack(actor, id, effect.to);
          if (moved !== null) this.journal.push({ kind: 'moved', id, from: moved.from, to: moved.to });
        }
        return null;
      }
      case 'move': {
        const actor = world.actorId();
        // Whoever is moving: the one acting, or everybody a selector names -
        // a spell that takes the room with it moves all of them.
        const movers = effect.who === undefined ? (actor === null ? [] : [actor]) : this.resolve(effect.who);
        if (movers.length === 0) return effect.who === undefined ? this.refuse('nobody to move') : null;
        // A run at a place rather than at somebody: the tile aimed at, or the
        // one the actor marked earlier. Nothing aimed, or nothing marked, is
        // nobody moving, the same quiet answer a walk with nobody to close on
        // gives. A mark is anywhere in the room - a rift does not measure -
        // where a point is as far as the card said.
        if (effect.to === 'point' || effect.to === 'mark') {
          const at =
            effect.to === 'point' ? this.point : actor === null ? NO_TILE : world.recallSpot(actor, effect.mark ?? '');
          if (at === NO_TILE) return null;
          const budget = effect.budget ?? (effect.to === 'mark' ? 'outOfRange' : effect.teleport === true ? 'far' : 'close');
          for (const mover of movers) {
            const ran =
              effect.teleport === true
                ? world.blinkTo(mover, at, budget)
                : world.drawTo(mover, at, effect.range ?? 'melee', budget);
            if (ran !== null) {
              const crossed = (ran as { route?: readonly Spot[] }).route;
              const route = crossed === undefined ? {} : { route: crossed };
              this.journal.push({ kind: 'moved', id: mover, from: ran.from, to: ran.to, walked: effect.teleport !== true, ...route });
            }
          }
          return null;
        }
        if (actor === null) return this.refuse('nobody to move');
        // Whoever the walk is measured against. A reaction with nobody behind
        // the blow - a trap, a countdown - has nothing to close on or get away
        // from, and standing still is the honest answer rather than a refusal.
        const other = this.resolve(effect.of ?? { kind: 'target' })[0];
        if (other === undefined) return null;
        // Every mover walks it, not just the one acting: `who` said who moves,
        // and a spell that lifts somebody else and sets them down is a walk
        // measured from them. With no `who` the movers are the actor alone,
        // which is what every walk in the SRD means and what this used to
        // assume outright.
        for (const mover of movers) {
          if (mover === other) continue;
          const walked =
            effect.how === 'away'
              ? world.breakAway(mover, other, effect.budget ?? 'close')
              : world.drawIn(mover, other, effect.range ?? 'melee', effect.budget ?? 'close');
          if (walked !== null) {
            const route = walked.route === undefined ? {} : { route: walked.route };
            this.journal.push({ kind: 'moved', id: mover, from: walked.from, to: walked.to, walked: true, ...route });
          }
        }
        return null;
      }
      case 'run': {
        const fn = world.hook(effect.hook);
        if (fn === null) return this.refuse(`no hook named "${effect.hook}"`);
        const queued: Effect[] = [];
        const context: HookContext = {
          ...hookReads(world, this.bindings(), effect.args ?? {}),
          rng: this.rng,
          lastRoll:
            this.lastRoll === null
              ? null
              : { total: this.lastRoll.total, critical: this.lastRoll.critical, outcome: this.lastRoll.outcome },
          queue: (effects) => {
            queued.push(...effects);
          },
          log: (text, tone) => {
            queued.push({ kind: 'log', text, ...(tone === undefined ? {} : { tone }) });
          },
        };
        const result = runHook(fn, context);
        if (!result.ok) return this.refuse(`hook "${effect.hook}" failed: ${result.message}`);
        // Whatever it queued runs here, before the rest of the list it sits in.
        if (queued.length > 0) this.stack.push({ effects: queued, index: 0 });
        return null;
      }
      case 'markArmor': {
        const amount = effect.amount ?? 1;
        for (const id of this.resolve(effect.target ?? { kind: 'target' })) {
          const marked = world.markArmor(id, amount);
          if (marked > 0) this.journal.push({ kind: 'armor', id, cleared: -marked });
        }
        return null;
      }
      case 'gainBad': {
        // "You gain a Shadow for each target that failed": none failed, none gained.
        for (let i = 0; i < this.amountOf(effect.amount); i++) {
          if (world.gainBad()) this.journal.push({ kind: 'bad', gained: 1 });
        }
        return null;
      }
      case 'loseBad': {
        // "Up to the number of Shadow in the GM's pool": an empty pool is
        // nothing taken rather than a refusal.
        let taken = 0;
        for (let i = 0; i < this.amountOf(effect.amount); i++) {
          if (world.loseBad()) taken += 1;
        }
        if (taken > 0) this.journal.push({ kind: 'badLost', lost: taken });
        return null;
      }
      case 'addToken': {
        // No amount at all means the card's own count - "a number of tokens
        // equal to your Spellcast trait" - which is not the same as a count
        // that came to nothing.
        const amount = effect.amount === undefined ? undefined : this.amountOf(effect.amount);
        if (amount !== undefined && amount <= 0) return null;
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const before = world.tokensOn(id, effect.ability);
          const left = world.addTokens(id, effect.ability, amount);
          this.journal.push({ kind: 'tokens', id, ability: effect.ability, added: left - before, spent: 0, left });
        }
        return null;
      }
      case 'spendToken': {
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          // "Then clear all tokens": whatever is on the card, and an empty
          // card is not a refusal - there was nothing to clear.
          const amount = effect.all === true ? world.tokensOn(id, effect.ability) : this.amountOf(effect.amount);
          if (amount <= 0) continue;
          const spent = world.spendTokens(id, effect.ability, amount);
          if (spent < amount) {
            this.refuse(`not enough tokens on ${effect.ability}`);
            continue;
          }
          this.journal.push({ kind: 'tokens', id, ability: effect.ability, added: 0, spent, left: world.tokensOn(id, effect.ability) });
        }
        return null;
      }
      case 'reactionRoll': {
        // The damage is rolled first and once, however the rolls to avoid it
        // go: that is what "targets who succeed take half damage" means, and
        // it is the only way the halves are halves of the same number.
        if (effect.damage !== undefined) {
          const expression = parseDice(effect.damage.dice);
          if (expression === null) return this.refuse(`cannot read damage dice "${effect.damage.dice}"`);
          const rolled = rollDamage(this.rng, expression, { proficiency: 1, critical: false });
          const types = effect.damage.type === undefined ? (expression.types ?? []) : [effect.damage.type];
          this.lastDamage = { total: rolled.total, dice: formatDice(rolled.expression), types };
        }
        const difficulty = effect.difficulty === 'roll' ? (this.lastRoll?.total ?? 0) : effect.difficulty;
        const failed: string[] = [];
        const passed: string[] = [];
        for (const id of this.resolve(effect.targets ?? { kind: 'hit' })) {
          const result = world.rollReaction(id, difficulty, effect.trait ?? 'agility', this.rng);
          this.journal.push({
            kind: 'reaction',
            id,
            success: result.success,
            total: result.total,
            difficulty,
            ...(result.roll === undefined ? {} : { roll: result.roll }),
          });
          (result.success ? passed : failed).push(id);
        }
        // Failures resolve first, so `onSuccess` is pushed first.
        if (effect.onSuccess !== undefined) this.stack.push({ effects: effect.onSuccess, index: 0, hit: passed });
        if (effect.onFail !== undefined) this.stack.push({ effects: effect.onFail, index: 0, hit: failed });
        return null;
      }
    }
  }

  private applyFlatDamage(effect: Extract<Effect, { kind: 'damage' }>): null {
    const target = effect.target ?? { kind: 'actor' as const };
    const amount = this.amountOf(effect.amount);
    if (amount <= 0) return null;
    const marked = this.world.damage(target, amount, effect.source, this.bindings());
    this.counts.hitPointsDealt += marked;
    this.journal.push({
      kind: 'damage',
      amount,
      marked,
      ...(effect.source === undefined ? {} : { source: effect.source }),
    });
    return null;
  }

  /**
   * Rolled damage: once, then to everyone it lands on — "when your attack deals
   * damage to more than one target, roll damage once and apply the total to
   * each". The dice scale with Proficiency or the Spellcast trait when the
   * card says so, and a critical on the roll that bound `hit` adds the maximum.
   */
  private applyRolledDamage(effect: Extract<Effect, { kind: 'damage' }>): null {
    const world = this.world;
    const actor = world.actorId();

    // `same` is the damage already rolled in this script — Whirlwind's "all
    // additional adversaries take half damage", off the swing that started it,
    // not off a second roll of the same dice.
    if (effect.dice === 'same') {
      const last = this.lastDamage;
      if (last === null) return this.refuse('no damage to carry over');
      const targets = this.resolve(effect.target ?? { kind: 'hit' });
      if (targets.length === 0) return null;
      const amount = effect.half === true ? Math.ceil(last.total / 2) : last.total;
      // The same damage, so the same kind of damage: a card that carries a
      // sword's swing over carries physical, and armor that answers one
      // answers the other.
      return this.dealTo(targets, amount, effect, last.dice, last.types);
    }

    // `weapon` is whatever the actor swings; `theirs` is what the one bound as
    // the target swings, which is the blow being turned onto somebody else.
    const swinging = effect.dice === 'theirs' ? this.resolve({ kind: 'target' })[0] : actor;
    const expression =
      effect.dice === 'weapon' || effect.dice === 'theirs'
        ? (swinging === undefined || swinging === null ? null : world.weaponDamage(swinging))
        : parseDice(effect.dice ?? '');
    if (expression === null) {
      return this.refuse(
        effect.dice === 'weapon' || effect.dice === 'theirs'
          ? 'no weapon to roll damage with'
          : `cannot read damage dice "${effect.dice}"`,
      );
    }
    const targets = this.resolve(effect.target ?? { kind: 'hit' });
    if (targets.length === 0) return null;

    let multiplier = 1;
    if (effect.using === 'proficiency') multiplier = actor === null ? 1 : world.proficiencyOf(actor);
    if (effect.using === 'halfProficiency') {
      multiplier = actor === null ? 1 : Math.max(1, Math.ceil(world.proficiencyOf(actor) / 2));
    }
    if (effect.using === 'spellcast') {
      const value = actor === null ? null : world.spellcastValue(actor);
      if (value === null) return this.refuse('no Spellcast trait to deal damage with');
      multiplier = Math.max(0, value);
    }
    const roll = rollDamage(this.rng, expression, {
      proficiency: multiplier,
      critical: this.lastRoll?.critical ?? false,
    });
    const amount = effect.half === true ? Math.ceil(roll.total / 2) : roll.total;
    this.lastDamage = { total: roll.total, dice: formatDice(roll.expression), types: expression.types ?? [] };
    return this.dealTo(targets, amount, effect, formatDice(roll.expression), expression.types);
  }

  /** Hand the same number to each target, journalling the whole event once. */
  private dealTo(
    targets: readonly string[],
    amount: number,
    effect: Extract<Effect, { kind: 'damage' }>,
    dice: string,
    stated?: readonly DamageType[],
  ): null {
    const world = this.world;
    const types: readonly DamageType[] = effect.type === undefined ? (stated ?? []) : [effect.type];
    let marked = 0;
    let reduced = 0;
    const defended: JournalEntry[] = [];
    for (const id of targets) {
      const dealt = world.dealDamage(id, { amount, types, ...(effect.direct === undefined ? {} : { direct: effect.direct }) }, this.rng);
      marked += dealt.hpMarked;
      this.counts.hitPointsDealt += dealt.hpMarked;
      reduced += dealt.reduced;
      for (const r of dealt.reactions) {
        defended.push({ kind: 'defended', id, ability: r.name, goodSpent: r.goodSpent, stressMarked: r.stressMarked, ...(r.rolled === undefined ? {} : { rolled: r.rolled }) });
      }
    }
    this.journal.push({
      kind: 'damage',
      amount,
      marked,
      targets: [...targets],
      dice,
      ...(reduced === 0 ? {} : { reduced }),
      ...(effect.source === undefined ? {} : { source: effect.source }),
    });
    this.journal.push(...defended);
    return null;
  }

  /** A weapon attack from a script: one target, a full action roll. */
  /**
   * Dice written behind a swing: an expression, the whole of what somebody
   * swings, or one die of it.
   *
   * "Roll an additional damage die" is the SRD's own phrase and means one of
   * the weapon's, whatever the weapon turns out to be - a d12 in a greataxe
   * and a d6 in a dagger. A creature with nothing the engine can read has no
   * die to roll, which is a refusal rather than a silent zero.
   */
  private diceBehind(expression: string, actor: string | null): DiceExpression | null {
    if (expression !== 'weapon' && expression !== 'weaponDie') return parseDice(expression);
    const damage = actor === null ? null : this.world.weaponDamage(actor);
    if (damage === null) return null;
    if (expression === 'weapon') return { count: damage.count, sides: damage.sides, modifier: damage.modifier };
    return damage.count === 0 ? null : { count: 1, sides: damage.sides, modifier: 0 };
  }

  private applyAttack(effect: Extract<Effect, { kind: 'attack' }>): null {
    const world = this.world;
    // Whose swing it is: the one acting, or the one bound as the target when
    // the card is making somebody else swing. Nobody swings at themselves.
    const attacker = effect.by === 'target' ? (this.resolve({ kind: 'target' })[0] ?? null) : world.actorId();
    if (attacker === null) return this.refuse('nobody to attack with');
    const targets = this.resolve(effect.target ?? { kind: 'target' }).filter((id) => id !== attacker);
    if (targets.length === 0) return this.refuse('nothing to attack');
    // Read once, before the first swing: "all Giant Rats within Close range of
    // them" is about where everyone stands now, not after the first one moved.
    const joinedBy = effect.joinedBy === undefined ? undefined : this.resolve(effect.joinedBy);
    // "Add a d10 to the damage roll." Rolled here, once, and handed over as a
    // number: the attack rules take a bonus rather than an expression, and the
    // dice come off the same seeded stream as everything else.
    let extra = 0;
    if (effect.damageDice !== undefined) {
      const expression = this.diceBehind(effect.damageDice, attacker);
      if (expression === null) return this.refuse(`cannot read damage dice "${effect.damageDice}"`);
      extra = rollDamage(this.rng, expression, { proficiency: 1, critical: false }).total;
    }
    const behind = (effect.damageBonus ?? 0) + extra;

    const hit: string[] = [];
    let swung = false;
    for (const target of targets) {
      const summary = world.attack(
        {
          attacker,
          target,
          weapon: effect.weapon ?? 'primary',
          ...(effect.advantage === undefined ? {} : { advantage: effect.advantage }),
          ...(behind === 0 ? {} : { damageBonus: behind }),
          ...(effect.damage === undefined ? {} : { damage: effect.damage }),
          ...(effect.range === undefined ? {} : { range: effect.range }),
          ...(effect.direct === undefined ? {} : { direct: effect.direct }),
          ...(joinedBy === undefined ? {} : { joinedBy }),
        },
        this.rng,
      );
      if (summary.refused !== null) {
        this.refuse(summary.refused);
        continue;
      }
      swung = true;
      this.rolled = true;
      this.counts.hitPointsDealt += summary.hitPointsMarked;
      this.spotlightToGm = this.spotlightToGm || summary.spotlightToGm;
      if (summary.roll !== undefined) this.lastRoll = summary.roll;
      if (summary.damage !== undefined) {
        this.lastDamage = { total: summary.damage, dice: summary.damageDice ?? '', types: summary.damageTypes ?? [] };
      }
      this.journal.push({
        kind: 'attack',
        attacker,
        target,
        weapon: summary.weapon,
        hit: summary.hit,
        critical: summary.critical,
        hitPointsMarked: summary.hitPointsMarked,
        ...(summary.reduced === undefined || summary.reduced === 0 ? {} : { reduced: summary.reduced }),
        ...(summary.joined === undefined || summary.joined.length === 0 ? {} : { joined: [...summary.joined] }),
        ...(summary.roll === undefined ? {} : { roll: summary.roll }),
      });
      if (summary.goodGained > 0) this.journal.push({ kind: 'good', gained: summary.goodGained });
      if (summary.badGained > 0) this.journal.push({ kind: 'bad', gained: summary.badGained });
      if (summary.stressCleared > 0) {
        this.journal.push({ kind: 'stress', id: attacker, marked: 0, cleared: summary.stressCleared, hitPoints: 0 });
      }
      if (summary.hit) hit.push(target);
    }
    if (!swung) return null;

    this.hit = hit;
    const branch = hit.length > 0 ? effect.onHit : effect.onMiss;
    if (branch !== undefined) this.stack.push({ effects: branch, index: 0, hit });
    return null;
  }

}

/**
 * Run a script that needs no input, for the common case.
 * Throws if it turns out to need an answer, because a caller using this has
 * nowhere to put the prompt.
 */
export function runScript(
  effects: readonly Effect[],
  world: ScriptWorld,
  rng: Rng,
  options: ScriptRunnerOptions = {},
): readonly JournalEntry[] {
  const runner = new ScriptRunner(world, rng, options);
  const result = runner.run(effects);
  if (result.status === 'waiting') {
    throw new Error(`this script needs a ${result.prompt.kind}; use ScriptRunner directly`);
  }
  return result.journal;
}

/** A condition helper so callers do not have to import both modules. */
export type { Condition };
export { NO_BINDINGS };
