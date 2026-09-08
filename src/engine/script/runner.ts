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
import { rollDuality, type DualityRoll, type RollOutcome } from '../rules/duality';
import { formatDice, parseDice, rollDice, type DamageType, type ParsedDamage } from '../rules/dice';
import type { RunningCountdown } from './countdowns';
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
  reactions: readonly { name: string; hopeSpent: number; stressMarked: number; rolled?: number }[];
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
  hopeGained: number;
  fearGained: number;
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
  removeInteractable(id: string): void;
  markInteractableUsed(id: string): void;
  startEncounter(id: string): void;
  endEncounter(id: string): void;
  /** Bypasses the attack roll — a trap, a hidden thorn. Returns HP actually marked. */
  damage(target: TargetSelector, amount: number, source?: string, bindings?: TargetBindings): number;
  /** Returns HP actually cleared. */
  heal(target: TargetSelector, amount: number, bindings?: TargetBindings): number;
  /**
   * The modifier for a check. `party` is how an object's check has always been
   * rolled — the party's best hand at that trait — and `actor` is the acting
   * character's own, which is what a card demands. Null when the actor cannot
   * make that roll at all: a Spellcast Roll with no Spellcast trait.
   */
  checkModifier(trait: CheckTrait, as: 'party' | 'actor'): number | null;
  /** The acting character's Experiences, spendable for a Hope each. */
  experiences(): readonly { name: string; modifier: number }[];
  /** What a roll against this creature must meet: Evasion, or an adversary's Difficulty. */
  difficultyOf(id: string): number | null;
  /** Raise the party's level to `level` (or by one). Returns the level reached, or null if nothing changed. */
  grantLevel(level?: number): number | null;
  /** The acting character gains a Hope. Returns whether anyone was there to gain it. */
  gainHope(): boolean;
  /** The GM gains a Fear. Returns whether the pool had room. */
  gainFear(): boolean;
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
  /** Returns Hope actually gained (an adversary gains none). */
  gainHopeFor(id: string, amount: number): number;
  /** Returns whether the Hope was there to spend. */
  spendHope(id: string, amount: number): boolean;
  /** Take Hope away, as far as it goes. Returns how much was actually lost. */
  loseHope(id: string, amount: number): number;
  applyCondition(id: string, condition: string, duration: ConditionDuration): boolean;
  clearCondition(id: string, condition: string): boolean;
  proficiencyOf(id: string): number;
  /** Tokens sitting on a card this creature holds. */
  tokensOn(id: string, ability: string): number;
  /** Put tokens on a card; returns how many are there now. */
  addTokens(id: string, ability: string, amount?: number): number;
  /** Take tokens off a card. Returns how many were actually spent. */
  spendTokens(id: string, ability: string, amount: number): number;
  /** The value of the creature's Spellcast trait, or null when it has none. */
  spellcastValue(id: string): number | null;
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
  /** Walk towards a creature until within a band, as far as the budget allows. */
  drawIn(mover: string, toward: string, band: RangeBand, budget?: RangeBand): { from: number; to: number } | null;
  /** Walk away from a creature, as far as the budget allows. */
  breakAway(mover: string, from: string, budget?: RangeBand): { from: number; to: number } | null;
  /**
   * Put creatures off a stat block onto the map, in the band named, around the
   * one summoning them. Returns the ones that found somewhere to stand.
   */
  summon(definition: string, count: number, range: RangeBand): { ids: string[]; refused?: string };
  /** How many of a faction are still standing. */
  countAlive(faction: 'party' | 'adversary'): number;
  /** Arm a countdown, replacing one already running under the same id. */
  startCountdown(countdown: RunningCountdown): void;
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
  | { kind: 'interactable'; id: string; change: 'open' | 'removed' | 'used' }
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
  | { kind: 'heal'; amount: number; cleared: number }
  | { kind: 'encounter'; id: string; change: 'started' | 'ended'; intro?: string }
  | { kind: 'goto'; scene: string }
  | { kind: 'dialogue'; dialogue: string }
  | { kind: 'quest'; quest: string; change: 'started' | 'completed' | 'failed' }
  | { kind: 'levelUp'; level: number }
  /** `id` is set when the Hope went to someone other than the actor. */
  | { kind: 'hope'; gained: number; id?: string }
  | { kind: 'hopeLost'; lost: number; id: string }
  | { kind: 'hopeSpent'; amount: number }
  | { kind: 'fear'; gained: number }
  | { kind: 'objective'; quest: string; objective: string }
  | { kind: 'revealed'; quest: string; objective: string }
  | { kind: 'chose'; label: string; index: number }
  /** `targets` are who the roll was against, `hit` the ones it beat. */
  | { kind: 'check'; outcome: CheckOutcome; roll: DualityRoll; targets: readonly string[]; hit: readonly string[]; reused?: boolean }
  | { kind: 'experience'; name: string; modifier: number }
  /** An effect that could not happen: no Hope to spend, no Spellcast trait, no target. */
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
  /** `walked` is the creature crossing the ground itself; otherwise it was shoved. */
  | { kind: 'moved'; id: string; from: number; to: number; walked?: boolean }
  /** Creatures a feature put on the map, and whether they act at once. */
  | { kind: 'summoned'; adversary: string; ids: readonly string[]; spotlight: boolean }
  /** A clock armed. Advancing it is the game's job, not the runner's. */
  | { kind: 'countdown'; countdown: string; name: string; value: number }
  /** The GM's turn handed to its own side. Paid for by whatever said so. */
  | { kind: 'spotlighted'; ids: readonly string[]; halfDamage: boolean }
  /** The spotlight this script is running in ends without its creature acting. */
  | { kind: 'spotlightEnded'; id: string | null }
  /** Added to a blow that has landed and not yet been counted. */
  | { kind: 'damageBoosted'; id: string | null; by: number }
  /** That blow marks this many Hit Points instead of being rolled for. */
  | { kind: 'hitPointsForced'; id: string | null; to: number }
  /** That blow lands in this band instead of being rolled for. */
  | { kind: 'severityForced'; id: string | null; severity: DamageSeverity }
  /** One creature off the map and another in its place. `was` is its name. */
  | { kind: 'replaced'; was: string; adversary: string; ids: readonly string[]; spotlight: boolean }
  /** `roll` is set when a party member rolled it: an adversary's is a d20. */
  | { kind: 'reaction'; id: string; success: boolean; total: number; difficulty: number; roll?: DualityRoll }
  /** A defender's reaction to damage fired: Get Back Up, a Rune Ward. */
  | { kind: 'defended'; id: string; ability: string; hopeSpent: number; stressMarked: number; rolled?: number };

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
      /** The actor's Experiences, each spendable for a Hope with `roll.experience`. */
      experiences: readonly { name: string; modifier: number }[];
    }
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
   * `experience` names one of the actor's to Utilize — a Hope is spent and its
   * modifier added, as the SRD has it.
   */
  | { kind: 'roll'; advantage?: number; disadvantage?: number; helpDice?: number; experience?: string }
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
   * a PC rolls a failure with Fear". Read by a `rolled` condition, wherever one
   * is asked inside it.
   */
  roll?: { total: number; outcome: RollOutcome };
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
  private pending: { effect: Effect } | null = null;

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

  constructor(world: ScriptWorld, rng: Rng, options: ScriptRunnerOptions = {}) {
    this.world = world;
    this.rng = rng;
    this.subject = options.subject ?? null;
    this.targets = [...(options.targets ?? [])];
    this.hit = [...(options.hit ?? [])];
    this.rollAs = options.rollAs ?? 'party';
    this.answering = options.roll ?? null;
    for (const name of COUNT_NAMES) this.counts[name] = options.counts?.[name] ?? 0;
    if (options.lastDamage !== undefined) {
      this.lastDamage = { total: options.lastDamage.total, dice: '', types: options.lastDamage.types ?? [] };
    }
  }

  /**
   * A written amount, or the count it names. `targetsHit` is read when it is
   * asked for rather than kept, because the roll that bound `hit` may have
   * happened since this script started.
   */
  private amountOf(amount: Amount | undefined, fallback = 1): number {
    if (amount === undefined) return fallback;
    if (typeof amount === 'number') return amount;
    if (typeof amount === 'object') {
      // "Equal to the Demon's current number of marked HP": the actor's own
      // when nothing says otherwise, and nobody there is a quiet zero rather
      // than a refusal, the way an empty count is.
      const who = this.resolve(amount.of ?? { kind: 'actor' })[0];
      if (who === undefined) return 0;
      return 'tokens' in amount
        ? this.world.tokensOn(who, amount.tokens)
        : (this.world.poolValue(who, amount.pool, amount.measure ?? 'marked') ?? 0);
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
      if (typeof value === 'string') return key === 'amount' && value === 'spent' ? n : value.replaceAll('{n}', String(n));
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
      this.applyCheck(waiting.effect.check, response);
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
    if (option === undefined || !evaluateOptional(option.available, this.world, this.bindings())) return;
    this.journal.push({ kind: 'chose', label: option.label, index: response.index });
    this.stack.push({ effects: option.effects, index: 0 });
  }

  /**
   * The last roll stands against these targets too: the same total, the same
   * Hope or Fear, no dice. A target it does not reach is simply not hit; with
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
      hit.length > 0 || targets.length === 0 ? roll.outcome : roll.hope > roll.fear ? 'failureWithHope' : 'failureWithFear';
    this.hit = hit;
    this.journal.push({ kind: 'check', outcome, roll, targets, hit, reused: true });
    if (check.always !== undefined) this.stack.push({ effects: check.always, index: 0, hit });
    this.stack.push({ effects: outcomeEffects(check, outcome), index: 0, hit });
    return null;
  }

  private applyCheck(check: CheckRequest, response: Response): void {
    if (response.kind !== 'roll') {
      // Declining costs nothing, as the legacy dialog did; the caller may put the card back.
      if (response.kind === 'cancel') this.cancelled = true;
      return;
    }

    const base = this.world.checkModifier(check.trait, this.rollAs);
    if (base === null) {
      this.refuse(`no ${check.trait} trait to roll with`);
      return;
    }
    let modifier = base;

    // Utilize an Experience: a Hope for its modifier, before the dice.
    const actor = this.world.actorId();
    if (response.experience !== undefined) {
      const found = this.world.experiences().find((e) => e.name === response.experience);
      if (found !== undefined && actor !== null && this.world.spendHope(actor, 1)) {
        modifier += found.modifier;
        this.journal.push({ kind: 'hopeSpent', amount: 1 });
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

    const roll = rollDuality(this.rng, {
      difficulty,
      modifier,
      ...(response.advantage === undefined ? {} : { advantage: response.advantage }),
      ...(response.disadvantage === undefined ? {} : { disadvantage: response.disadvantage }),
      ...(response.helpDice === undefined ? {} : { helpDice: response.helpDice }),
    });
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

    // The core loop: a roll with Hope hands the roller a Hope, a roll with
    // Fear hands the GM a Fear, and a critical clears a Stress. Attacks
    // already did this; a chest and a conversation are rolls too.
    if (roll.hopeGained > 0 && this.world.gainHope()) {
      this.journal.push({ kind: 'hope', gained: roll.hopeGained });
    }
    if (roll.fearGained > 0 && this.world.gainFear()) {
      this.journal.push({ kind: 'fear', gained: roll.fearGained });
    }
    if (roll.stressCleared > 0 && actor !== null) {
      const cleared = this.world.clearStress(actor, roll.stressCleared);
      if (cleared > 0) this.journal.push({ kind: 'stress', id: actor, marked: 0, cleared, hitPoints: 0 });
    }

    // `always` runs after the outcome branch, so it is pushed first.
    if (check.always !== undefined) this.stack.push({ effects: check.always, index: 0, hit });
    this.stack.push({ effects: outcomeEffects(check, roll.outcome), index: 0, hit });
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
      case 'open':
      case 'remove':
      case 'markUsed':
        return this.applyInteractable(effect);
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
        const cleared = world.heal(effect.target ?? { kind: 'actor' }, amount, this.bindings());
        this.journal.push({ kind: 'heal', amount, cleared });
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
        const taken = evaluateOptional(effect.when, world, this.bindings()) ? effect.then : effect.otherwise;
        if (taken !== undefined && taken.length > 0) this.stack.push({ effects: taken, index: 0 });
        return null;
      }
      case 'choice': {
        const options = effect.options
          .map((option, index) => ({ option, index }))
          .filter(({ option }) => evaluateOptional(option.available, world, this.bindings()))
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
      case 'gainHope': {
        const amount = this.amountOf(effect.amount);
        const actor = world.actorId();
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const gained = world.gainHopeFor(id, amount);
          if (gained > 0) this.journal.push(id === actor ? { kind: 'hope', gained } : { kind: 'hope', gained, id });
        }
        return null;
      }
      case 'loseHope': {
        const amount = this.amountOf(effect.amount);
        if (amount <= 0) return null;
        for (const id of this.resolve(effect.target ?? { kind: 'hit' })) {
          const lost = this.world.loseHope(id, amount);
          if (lost > 0) this.journal.push({ kind: 'hopeLost', lost, id });
        }
        return null;
      }
      case 'spendHope': {
        const amount = effect.amount ?? 1;
        const actor = world.actorId();
        if (actor === null || !world.spendHope(actor, amount)) return this.refuse(`not enough Hope to spend ${amount}`);
        this.journal.push({ kind: 'hopeSpent', amount });
        return null;
      }
      case 'applyCondition':
        for (const id of this.resolve(effect.target ?? { kind: 'target' })) {
          if (world.applyCondition(id, effect.condition, effect.duration ?? 'temporary')) {
            this.journal.push({ kind: 'condition', id, condition: effect.condition, applied: true });
          }
        }
        return null;
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
        if (by <= 0) return null;
        this.journal.push({ kind: 'damageBoosted', id: actor, by });
        return null;
      }
      case 'forceSeverity': {
        // "Deal Severe damage instead of their standard damage": the band is
        // named, and the swing waiting to be counted is told which.
        this.journal.push({ kind: 'severityForced', id: world.actorId(), severity: effect.severity });
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
        // "Spend any number of Hope to roll that many d6s": one option per
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
      case 'endSpotlight': {
        // Nothing here stops the script: the rest of the list still runs, and
        // it is the turn that reads this once the script is done.
        this.journal.push({ kind: 'spotlightEnded', id: world.actorId() });
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
        if (actor === null) return this.refuse('nobody to move');
        // Whoever the walk is measured against. A reaction with nobody behind
        // the blow - a trap, a countdown - has nothing to close on or get away
        // from, and standing still is the honest answer rather than a refusal.
        const other = this.resolve(effect.of ?? { kind: 'target' })[0];
        if (other === undefined) return null;
        const walked =
          effect.how === 'away'
            ? world.breakAway(actor, other, effect.budget ?? 'close')
            : world.drawIn(actor, other, effect.range ?? 'melee', effect.budget ?? 'close');
        if (walked !== null) {
          this.journal.push({ kind: 'moved', id: actor, from: walked.from, to: walked.to, walked: true });
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
      case 'gainFear': {
        // "You gain a Fear for each target that failed": none failed, none gained.
        for (let i = 0; i < this.amountOf(effect.amount); i++) {
          if (world.gainFear()) this.journal.push({ kind: 'fear', gained: 1 });
        }
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

    // `weapon` is whatever the actor swings.
    const expression = effect.dice === 'weapon' ? (actor === null ? null : world.weaponDamage(actor)) : parseDice(effect.dice ?? '');
    if (expression === null) {
      return this.refuse(effect.dice === 'weapon' ? 'no weapon to roll damage with' : `cannot read damage dice "${effect.dice}"`);
    }
    const targets = this.resolve(effect.target ?? { kind: 'hit' });
    if (targets.length === 0) return null;

    let multiplier = 1;
    if (effect.using === 'proficiency') multiplier = actor === null ? 1 : world.proficiencyOf(actor);
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
        defended.push({ kind: 'defended', id, ability: r.name, hopeSpent: r.hopeSpent, stressMarked: r.stressMarked, ...(r.rolled === undefined ? {} : { rolled: r.rolled }) });
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
  private applyAttack(effect: Extract<Effect, { kind: 'attack' }>): null {
    const world = this.world;
    const attacker = world.actorId();
    if (attacker === null) return this.refuse('nobody to attack with');
    const targets = this.resolve(effect.target ?? { kind: 'target' });
    if (targets.length === 0) return this.refuse('nothing to attack');
    // Read once, before the first swing: "all Giant Rats within Close range of
    // them" is about where everyone stands now, not after the first one moved.
    const joinedBy = effect.joinedBy === undefined ? undefined : this.resolve(effect.joinedBy);

    const hit: string[] = [];
    let swung = false;
    for (const target of targets) {
      const summary = world.attack(
        {
          attacker,
          target,
          weapon: effect.weapon ?? 'primary',
          ...(effect.advantage === undefined ? {} : { advantage: effect.advantage }),
          ...(effect.damageBonus === undefined ? {} : { damageBonus: effect.damageBonus }),
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
      if (summary.hopeGained > 0) this.journal.push({ kind: 'hope', gained: summary.hopeGained });
      if (summary.fearGained > 0) this.journal.push({ kind: 'fear', gained: summary.fearGained });
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

  private applyInteractable(
    effect: Extract<Effect, { kind: 'open' | 'remove' | 'markUsed' }>,
  ): null {
    // An effect with no id targets whatever the script was started from; a caller
    // that has no such subject simply gets nothing, rather than a crash.
    const id = effect.interactable ?? this.subject;
    if (id === null || id === undefined) return null;
    if (effect.kind === 'open') {
      this.world.openInteractable(id);
      this.journal.push({ kind: 'interactable', id, change: 'open' });
    } else if (effect.kind === 'remove') {
      this.world.removeInteractable(id);
      this.journal.push({ kind: 'interactable', id, change: 'removed' });
    } else {
      this.world.markInteractableUsed(id);
      this.journal.push({ kind: 'interactable', id, change: 'used' });
    }
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
