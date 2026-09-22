/**
 * Editing the project's jump rules: the house rule for what a step is, who jumps how far, what
 * the roll is, and what a fall costs.
 *
 * A project that has said nothing has no `jump` at all and plays by the defaults, so the first
 * change writes the whole set down - there is nowhere to hang one number until the rules are
 * something the document holds - and undoing it puts the document back to saying nothing,
 * rather than leaving a block of defaults nobody asked for.
 */

import { DEFAULT_JUMP_RULES, type JumpRules } from '../engine/rules/jump';
import type { Edit } from './session';

/** The rules a project plays by: its own, or the defaults it has not overridden. */
export function jumpRulesOf(project: { jump?: JumpRules | undefined }): JumpRules {
  return project.jump ?? DEFAULT_JUMP_RULES;
}

/** Set one of the jump rules. Typing into one field is one undo step. */
export function setJumpRule<K extends keyof JumpRules>(key: K, value: JumpRules[K]): Edit {
  let before: JumpRules | undefined;
  let changed = false;
  return {
    label: 'Edit jump rules',
    mergeKey: `jump:${key}`,
    apply(project) {
      before = project.jump;
      changed = jumpRulesOf(project)[key] !== value;
      if (changed) project.jump = { ...jumpRulesOf(project), [key]: value };
    },
    undo(project) {
      if (before === undefined) delete project.jump;
      else project.jump = before;
    },
    // The later keystroke has already written its value; this one keeps what stood before both.
    absorb(other) {
      return other.mergeKey === `jump:${key}`;
    },
    isNoop() {
      return !changed;
    },
  };
}

/** Put the jump rules back to the engine's own, by saying nothing about them. */
export function resetJumpRules(): Edit {
  let before: JumpRules | undefined;
  return {
    label: 'Reset jump rules',
    apply(project) {
      before = project.jump;
      delete project.jump;
    },
    undo(project) {
      if (before !== undefined) project.jump = before;
    },
    isNoop() {
      return before === undefined;
    },
  };
}
