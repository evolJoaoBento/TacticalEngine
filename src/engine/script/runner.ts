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
 */

import type { Rng } from '../core/rng';
import { rollDuality, type DualityRoll } from '../rules/duality';
import { evaluateOptional, type Condition, type ConditionContext, type ScriptValue } from './conditions';
import {
  outcomeEffects,
  type CheckOutcome,
  type CheckRequest,
  type ChoiceOption,
  type Effect,
  type LogTone,
  type TargetSelector,
} from './effects';

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
  damage(target: TargetSelector, amount: number, source?: string): number;
  /** Returns HP actually cleared. */
  heal(target: TargetSelector, amount: number): number;
  /** The trait modifier for the acting character, for a check. */
  traitModifier(trait: CheckRequest['trait']): number;
  /**
   * Quest progress. Each returns whether anything changed, so the runner can
   * journal a real event and stay quiet about a `startQuest` that was already
   * started — scripts re-run, and the journal must not say "New quest" twice.
   */
  /** Raise the party's level to `level` (or by one). Returns the level reached, or null if nothing changed. */
  grantLevel(level?: number): number | null;
  startQuest(quest: string): boolean;
  completeObjective(quest: string, objective: string): boolean;
  completeQuest(quest: string): boolean;
  failQuest(quest: string): boolean;
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
  | { kind: 'damage'; amount: number; marked: number; source?: string }
  | { kind: 'heal'; amount: number; cleared: number }
  | { kind: 'encounter'; id: string; change: 'started' | 'ended'; intro?: string }
  | { kind: 'goto'; scene: string }
  | { kind: 'dialogue'; dialogue: string }
  | { kind: 'quest'; quest: string; change: 'started' | 'completed' | 'failed' }
  | { kind: 'levelUp'; level: number }
  | { kind: 'objective'; quest: string; objective: string }
  | { kind: 'chose'; label: string; index: number }
  | { kind: 'check'; outcome: CheckOutcome; roll: DualityRoll };

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
      trait: CheckRequest['trait'];
      difficulty: number;
      modifier: number;
      prompt?: string;
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
  /** Make the roll. `advantage`/`disadvantage`/`helpDice` come from the table. */
  | { kind: 'roll'; advantage?: number; disadvantage?: number; helpDice?: number }
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
}

export class ScriptRunner {
  private readonly world: ScriptWorld;
  private readonly rng: Rng;
  private readonly journal: JournalEntry[] = [];
  /** Stacked cursors into effect lists: [list, next index]. */
  private readonly stack: { effects: readonly Effect[]; index: number }[] = [];
  private pending: { effect: Effect } | null = null;

  /**
   * The interactable this script was started from, if any. `open`, `remove` and
   * `markUsed` with no id of their own mean "this one" — which is how an author
   * writes a chest's outcome without repeating the chest's id in every branch.
   */
  private readonly subject: string | null;

  constructor(world: ScriptWorld, rng: Rng, options: ScriptRunnerOptions = {}) {
    this.world = world;
    this.rng = rng;
    this.subject = options.subject ?? null;
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

  private applyChoice(options: readonly ChoiceOption[], response: Response): void {
    if (response.kind !== 'choose') return; // cancelling a choice does nothing
    const option = options[response.index];
    if (option === undefined || !evaluateOptional(option.available, this.world)) return;
    this.journal.push({ kind: 'chose', label: option.label, index: response.index });
    this.stack.push({ effects: option.effects, index: 0 });
  }

  private applyCheck(check: CheckRequest, response: Response): void {
    if (response.kind !== 'roll') return; // declining costs nothing, as the legacy dialog did

    const roll = rollDuality(this.rng, {
      difficulty: check.difficulty,
      modifier: this.world.traitModifier(check.trait),
      ...(response.advantage === undefined ? {} : { advantage: response.advantage }),
      ...(response.disadvantage === undefined ? {} : { disadvantage: response.disadvantage }),
      ...(response.helpDice === undefined ? {} : { helpDice: response.helpDice }),
    });
    this.journal.push({ kind: 'check', outcome: roll.outcome, roll });

    // `always` runs after the outcome branch, so it is pushed first.
    if (check.always !== undefined) this.stack.push({ effects: check.always, index: 0 });
    this.stack.push({ effects: outcomeEffects(check, roll.outcome), index: 0 });
  }

  private step(): RunStatus {
    while (this.stack.length > 0) {
      const frame = this.stack[this.stack.length - 1]!;
      if (frame.index >= frame.effects.length) {
        this.stack.pop();
        continue;
      }
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
      case 'damage': {
        const target = effect.target ?? { kind: 'actor' as const };
        const marked = world.damage(target, effect.amount, effect.source);
        this.journal.push({
          kind: 'damage',
          amount: effect.amount,
          marked,
          ...(effect.source === undefined ? {} : { source: effect.source }),
        });
        return null;
      }
      case 'heal': {
        const cleared = world.heal(effect.target ?? { kind: 'actor' }, effect.amount);
        this.journal.push({ kind: 'heal', amount: effect.amount, cleared });
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
        const taken = evaluateOptional(effect.when, world) ? effect.then : effect.otherwise;
        if (taken !== undefined && taken.length > 0) this.stack.push({ effects: taken, index: 0 });
        return null;
      }
      case 'choice': {
        const options = effect.options
          .map((option, index) => ({ option, index }))
          .filter(({ option }) => evaluateOptional(option.available, world))
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
      case 'check':
        return {
          kind: 'check',
          trait: effect.check.trait,
          difficulty: effect.check.difficulty,
          modifier: world.traitModifier(effect.check.trait),
          ...(effect.check.prompt === undefined ? {} : { prompt: effect.check.prompt }),
        };
    }
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
): readonly JournalEntry[] {
  const runner = new ScriptRunner(world, rng);
  const result = runner.run(effects);
  if (result.status === 'waiting') {
    throw new Error(`this script needs a ${result.prompt.kind}; use ScriptRunner directly`);
  }
  return result.journal;
}

/** A condition helper so callers do not have to import both modules. */
export type { Condition };
