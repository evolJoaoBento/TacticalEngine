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
import { rollDuality, type DualityRoll } from '../rules/duality';
import { formatDice, parseDice, type DamageType, type ParsedDamage } from '../rules/dice';
import { hookReads } from './conditions';
import { runHook, type HookContext } from './hooks';
import { rollDamage, type IncomingDamage } from '../rules/damage';
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
import type { CheckTrait, ConditionDuration } from './schema';

/** What one damage event did to one creature. */
export interface DealtDamage {
  /** Damage after resistance and immunity. */
  incoming: number;
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
    },
    rng: Rng,
  ): AttackSummary;
  /** Knock a creature away from another to a band. Null when it could not move at all. */
  pushBack(from: string, target: string, band: RangeBand): { from: number; to: number } | null;
  /** A reaction roll: a d20 for an adversary, Duality Dice for a party member. */
  rollReaction(id: string, difficulty: number, trait: Trait, rng: Rng): { success: boolean; total: number };
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
  | { kind: 'damage'; amount: number; marked: number; source?: string; targets?: readonly string[]; dice?: string }
  | { kind: 'heal'; amount: number; cleared: number }
  | { kind: 'encounter'; id: string; change: 'started' | 'ended'; intro?: string }
  | { kind: 'goto'; scene: string }
  | { kind: 'dialogue'; dialogue: string }
  | { kind: 'quest'; quest: string; change: 'started' | 'completed' | 'failed' }
  | { kind: 'levelUp'; level: number }
  /** `id` is set when the Hope went to someone other than the actor. */
  | { kind: 'hope'; gained: number; id?: string }
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
      roll?: DualityRoll;
    }
  | { kind: 'moved'; id: string; from: number; to: number }
  | { kind: 'reaction'; id: string; success: boolean; total: number; difficulty: number }
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
   * Whose hand rolls a plain trait check. An object's check has always been
   * the party's best; an ability's is the actor's own.
   */
  rollAs?: 'party' | 'actor';
}

/** A list of effects part-way through, and what `hit` meant when it was pushed. */
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
    this.rollAs = options.rollAs ?? 'party';
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
    return { targets: this.targets, hit: this.hit };
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
        let amount = effect.amount;
        if (amount === undefined) {
          const expression = parseDice(effect.dice ?? '');
          if (expression === null) return this.refuse(`cannot read healing dice "${effect.dice}"`);
          amount = Math.max(1, rollDamage(this.rng, expression, { proficiency: 1, critical: false }).total);
        }
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
        const amount = effect.amount ?? 1;
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const result = world.markStress(id, amount);
          this.journal.push({ kind: 'stress', id, marked: result.stressMarked, cleared: 0, hitPoints: result.hpMarked });
        }
        return null;
      }
      case 'clearStress': {
        const amount = effect.amount ?? 1;
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
        const amount = effect.amount ?? 1;
        const actor = world.actorId();
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const gained = world.gainHopeFor(id, amount);
          if (gained > 0) this.journal.push(id === actor ? { kind: 'hope', gained } : { kind: 'hope', gained, id });
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
      case 'push': {
        const actor = world.actorId();
        if (actor === null) return this.refuse('nobody to push from');
        for (const id of this.resolve(effect.target ?? { kind: 'target' })) {
          const moved = world.pushBack(actor, id, effect.to);
          if (moved !== null) this.journal.push({ kind: 'moved', id, from: moved.from, to: moved.to });
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
        for (let i = 0; i < (effect.amount ?? 1); i++) {
          if (world.gainFear()) this.journal.push({ kind: 'fear', gained: 1 });
        }
        return null;
      }
      case 'addToken': {
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
          const before = world.tokensOn(id, effect.ability);
          const left = world.addTokens(id, effect.ability, effect.amount);
          this.journal.push({ kind: 'tokens', id, ability: effect.ability, added: left - before, spent: 0, left });
        }
        return null;
      }
      case 'spendToken': {
        const amount = effect.amount ?? 1;
        for (const id of this.resolve(effect.target ?? { kind: 'actor' })) {
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
        const difficulty = effect.difficulty === 'roll' ? (this.lastRoll?.total ?? 0) : effect.difficulty;
        const failed: string[] = [];
        const passed: string[] = [];
        for (const id of this.resolve(effect.targets ?? { kind: 'hit' })) {
          const result = world.rollReaction(id, difficulty, effect.trait ?? 'agility', this.rng);
          this.journal.push({ kind: 'reaction', id, success: result.success, total: result.total, difficulty });
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
    const amount = effect.amount ?? 1;
    const marked = this.world.damage(target, amount, effect.source, this.bindings());
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
    const defended: JournalEntry[] = [];
    for (const id of targets) {
      const dealt = world.dealDamage(id, { amount, types, ...(effect.direct === undefined ? {} : { direct: effect.direct }) }, this.rng);
      marked += dealt.hpMarked;
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
        },
        this.rng,
      );
      if (summary.refused !== null) {
        this.refuse(summary.refused);
        continue;
      }
      swung = true;
      this.rolled = true;
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
