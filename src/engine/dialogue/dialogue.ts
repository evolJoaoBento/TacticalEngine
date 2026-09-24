/**
 * Dialogue graphs.
 *
 * The conversation half of a CRPG: a speaker says something, the player picks a
 * reply, some replies are only available if you know a thing or hold a key, and
 * some cost a roll — talking someone down with Presence, spotting the lie with
 * Instinct. Choosing runs effects, and the conversation moves to another node or
 * ends.
 *
 * It is a thin layer over `script/`, on purpose. A dialogue *is* a script that
 * happens to be shaped like a graph, so conditions, effects and the check
 * machinery are exactly the ones the rest of the engine already uses, and a
 * conversation is as replayable from a seed as a fight is.
 */

import type { Rng } from '../core/rng';
import type { Condition } from '../script/conditions';
import { evaluateOptional } from '../script/conditions';
import type { CheckRequest, Effect } from '../script/effects';
import {
  ScriptRunner,
  type ScriptRunnerOptions,
  type JournalEntry,
  type Prompt,
  type Response,
  type ScriptWorld,
} from '../script/runner';

/**
 * The shapes live in `schema.ts` so a project can hold a conversation; this
 * module keeps the behaviour that runs one. Re-exported so existing importers
 * are unchanged.
 */
export type {
  Dialogue,
  DialogueCheck,
  DialogueChoice,
  DialogueLine,
  DialogueNode,
} from './schema';
export { dialogueSchema } from './schema';

import type {
  Dialogue,
  DialogueCheck,
  DialogueChoice,
  DialogueLine,
  DialogueNode,
} from './schema';

/** What the player is being shown right now. */
export interface DialogueView {
  node: DialogueNode;
  lines: readonly DialogueLine[];
  options: readonly {
    index: number;
    text: string;
    detail?: string;
    /** False when a visible option is locked. */
    enabled: boolean;
    /** Set when picking this needs a roll, so a UI can mark it. */
    check?: { trait: DialogueCheck['trait']; difficulty: number | 'target'; modifier: number };
  }[];
}

export type DialogueStatus =
  | { status: 'talking'; view: DialogueView; journal: readonly JournalEntry[] }
  /** An effect inside the dialogue needs an answer of its own. */
  | { status: 'script'; prompt: Prompt; journal: readonly JournalEntry[] }
  | { status: 'ended'; journal: readonly JournalEntry[] };

/**
 * A conversation in progress.
 *
 * Like `ScriptRunner`, nothing here is async: it advances when the caller answers.
 */
export class DialogueRunner {
  private readonly dialogue: Dialogue;
  private readonly world: ScriptWorld;
  private readonly rng: Rng;
  private readonly byId: ReadonlyMap<string, DialogueNode>;
  private readonly journal: JournalEntry[] = [];

  private current: DialogueNode | null = null;
  private script: ScriptRunner | null = null;
  /** Where to go once the running script finishes. */
  private pendingGoto: string | null = null;
  /** The choice whose check is being rolled, so its outcome can route. */
  private pendingCheck: DialogueChoice | null = null;
  private ended = false;
  /**
   * Who the conversation is with, handed to every script inside it: a creature talked to is the
   * `target` of its replies and consequences, so "turn them hostile" knows whom it means.
   */
  private readonly with: ScriptRunnerOptions;

  constructor(dialogue: Dialogue, world: ScriptWorld, rng: Rng, options: Pick<ScriptRunnerOptions, 'targets' | 'subject'> = {}) {
    this.dialogue = dialogue;
    this.world = world;
    this.rng = rng;
    this.with = options;
    const byId = new Map<string, DialogueNode>();
    for (const node of dialogue.nodes) {
      if (byId.has(node.id)) throw new Error(`dialogue "${dialogue.id}" repeats node "${node.id}"`);
      byId.set(node.id, node);
    }
    this.byId = byId;
  }

  /** Enter the first node. */
  start(): DialogueStatus {
    return this.enter(this.dialogue.start);
  }

  /** Pick a reply, by its index in the current view. */
  choose(index: number): DialogueStatus {
    const node = this.current;
    if (node === null || this.ended) return this.endedStatus();

    const choice = (node.choices ?? [])[index];
    if (choice === undefined) return this.talking(node);
    if (!evaluateOptional(choice.available, this.world)) return this.talking(node);
    if (!evaluateOptional(choice.enabled, this.world)) return this.talking(node);

    this.journal.push({ kind: 'chose', label: choice.text, index });

    if (choice.check !== undefined) {
      this.pendingCheck = choice;
      return this.runScript([{ kind: 'check', check: choice.check }], choice.goto ?? null);
    }
    return this.runScript(choice.effects ?? [], choice.goto ?? null);
  }

  /** Answer a prompt raised by an effect inside the dialogue. */
  resume(response: Response): DialogueStatus {
    const script = this.script;
    if (script === null) return this.current === null ? this.endedStatus() : this.talking(this.current);
    return this.afterScript(script.resume(response));
  }

  get entries(): readonly JournalEntry[] {
    return this.journal;
  }

  private enter(id: string): DialogueStatus {
    const node = this.byId.get(id);
    if (node === undefined) {
      // A dangling link ends the conversation rather than crashing it; the editor
      // is the right place to catch that, and `danglingLinks` below finds them.
      this.ended = true;
      return this.endedStatus();
    }
    this.current = node;
    if (node.onEnter !== undefined && node.onEnter.length > 0) {
      return this.runScript(node.onEnter, null, node);
    }
    return this.afterEnter(node);
  }

  /**
   * After a node's onEnter has run: show it, or walk straight on.
   *
   * A node with no replies and no `goto` is the last thing said, and it is still
   * *said* — it is shown, and `advance()` ends the conversation. Ending on entry
   * would silently swallow every closing line.
   */
  private afterEnter(node: DialogueNode): DialogueStatus {
    // A consequence is done, not said: on to what follows it, or the end.
    if (node.kind === 'consequence') return node.goto === undefined ? this.finish() : this.enter(node.goto);
    const options = this.visibleChoices(node);
    if (options.length === 0 && node.goto !== undefined) return this.enter(node.goto);
    return this.talking(node);
  }

  /**
   * Move on from a node with no replies — the caller's "continue" button.
   * On a node that does have replies, this changes nothing: one must be chosen.
   */
  advance(): DialogueStatus {
    const node = this.current;
    if (node === null || this.ended) return this.endedStatus();
    if (this.visibleChoices(node).length > 0) return this.talking(node);
    if (node.goto !== undefined) return this.enter(node.goto);
    return this.finish();
  }

  private runScript(
    effects: readonly Effect[],
    goto: string | null,
    enteringNode?: DialogueNode,
  ): DialogueStatus {
    this.pendingGoto = goto;
    this.enteringNode = enteringNode ?? null;
    this.script = new ScriptRunner(this.world, this.rng, this.with);
    return this.afterScript(this.script.run(effects));
  }

  private enteringNode: DialogueNode | null = null;

  private afterScript(result: ReturnType<ScriptRunner['run']>): DialogueStatus {
    for (const entry of result.journal.slice(this.consumed)) this.journal.push(entry);
    this.consumed = result.journal.length;

    if (result.status === 'waiting') {
      return { status: 'script', prompt: result.prompt, journal: this.journal };
    }

    this.script = null;
    this.consumed = 0;

    // A check inside a choice can route by outcome.
    const checked = this.pendingCheck;
    this.pendingCheck = null;
    if (checked?.check !== undefined) {
      const last = [...this.journal].reverse().find((e) => e.kind === 'check');
      const succeeded = last !== undefined && last.kind === 'check' && last.roll.success;
      const routed = succeeded ? checked.check.gotoOnSuccess : checked.check.gotoOnFailure;
      const target = routed ?? this.pendingGoto;
      this.pendingGoto = null;
      // A choice with a check may also carry plain effects; they run after it.
      if (checked.effects !== undefined && checked.effects.length > 0) {
        return this.runScript(checked.effects, target);
      }
      return target === null ? this.finish() : this.enter(target);
    }

    const entering = this.enteringNode;
    this.enteringNode = null;
    if (entering !== null) return this.afterEnter(entering);

    const goto = this.pendingGoto;
    this.pendingGoto = null;
    return goto === null ? this.finish() : this.enter(goto);
  }

  private consumed = 0;

  private finish(): DialogueStatus {
    this.ended = true;
    return this.endedStatus();
  }

  private endedStatus(): DialogueStatus {
    return { status: 'ended', journal: this.journal };
  }

  private visibleChoices(node: DialogueNode): DialogueView['options'] {
    return (node.choices ?? [])
      .map((choice, index) => ({ choice, index }))
      .filter(({ choice }) => evaluateOptional(choice.available, this.world))
      .map(({ choice, index }) => ({
        index,
        text: choice.text,
        ...(choice.detail === undefined ? {} : { detail: choice.detail }),
        enabled: evaluateOptional(choice.enabled, this.world),
        ...(choice.check === undefined
          ? {}
          : {
              check: {
                trait: choice.check.trait,
                difficulty: choice.check.difficulty,
                modifier: this.world.checkModifier(choice.check.trait, 'party') ?? 0,
              },
            }),
      }));
  }

  private talking(node: DialogueNode): DialogueStatus {
    return {
      status: 'talking',
      view: { node, lines: node.lines, options: this.visibleChoices(node) },
      journal: this.journal,
    };
  }
}

/**
 * Node ids a dialogue links to and does not define.
 *
 * A dangling link ends the conversation at runtime rather than throwing, so this
 * exists to catch them in an editor or a content test instead.
 */
export function danglingLinks(dialogue: Dialogue): string[] {
  const defined = new Set(dialogue.nodes.map((n) => n.id));
  const missing = new Set<string>();
  const check = (id: string | undefined): void => {
    if (id !== undefined && !defined.has(id)) missing.add(id);
  };
  check(dialogue.start);
  for (const node of dialogue.nodes) {
    check(node.goto);
    for (const choice of node.choices ?? []) {
      check(choice.goto);
      check(choice.check?.gotoOnSuccess);
      check(choice.check?.gotoOnFailure);
    }
  }
  return [...missing].sort();
}

/** Nodes no path can reach from the start, for the same reason. */
export function unreachableNodes(dialogue: Dialogue): string[] {
  const byId = new Map(dialogue.nodes.map((n) => [n.id, n] as const));
  const seen = new Set<string>();
  const queue = [dialogue.start];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    const node = byId.get(id)!;
    if (node.goto !== undefined) queue.push(node.goto);
    for (const choice of node.choices ?? []) {
      if (choice.goto !== undefined) queue.push(choice.goto);
      if (choice.check?.gotoOnSuccess !== undefined) queue.push(choice.check.gotoOnSuccess);
      if (choice.check?.gotoOnFailure !== undefined) queue.push(choice.check.gotoOnFailure);
    }
  }
  return dialogue.nodes.map((n) => n.id).filter((id) => !seen.has(id)).sort();
}
