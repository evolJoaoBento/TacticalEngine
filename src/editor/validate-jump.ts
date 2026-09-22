/**
 * Check, for a project's jump rules.
 *
 * The schema already refuses a number that is not one. What it cannot see is the rest of the
 * document: the condition a failed jump lands somebody with is a name, and a name nothing
 * defines is a landing that does nothing the player can read. Apart from `validate.ts`, which
 * is the size a file gets to be.
 */

import { SRD_CONDITIONS } from '../engine/content/conditions';
import { jumpRange, jumpReach, safeDrop } from '../engine/rules/jump';
import type { ProjectDoc } from '../engine/scene/schema';

type Report = (severity: 'error' | 'warning', message: string) => void;

export function checkJumpRules(project: ProjectDoc, knownConditions: ReadonlySet<string> | undefined, report: Report): void {
  const rules = project.jump;
  // A project that says nothing plays by the defaults, and those are the engine's to keep right.
  if (rules === undefined || !rules.enabled) return;
  if (rules.failCondition !== '') {
    const known = new Set([...SRD_CONDITIONS.map((def) => def.id), ...project.conditionDefs.map((def) => def.id), ...(knownConditions ?? [])]);
    if (!known.has(rules.failCondition)) {
      report('warning', `Jump rules: a failed jump lands them "${rules.failCondition}", which is not a condition this project has.`);
    }
  }
  const nobody = { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 };
  // Three quarters of a block is the least a jump can be - a block beside a floor tile - so a
  // reach short of the step is a rule under which nobody at 0 ever jumps anything.
  if (jumpReach(rules, nobody) <= rules.stepHeight) {
    report('warning', `Jump rules: a jump reaches ${jumpReach(rules, nobody)} blocks at ${rules.reachTrait} 0, which a step of ${rules.stepHeight} already covers - nobody without the trait can jump at all.`);
  }
  if (jumpRange(rules, nobody) < 1) {
    report('warning', `Jump rules: a jump carries ${jumpRange(rules, nobody)} tiles at ${rules.reachTrait} 0, short of the tile next door - nobody without the trait can jump anywhere.`);
  }
  if (rules.fallDie > 0 && safeDrop(rules, nobody) <= rules.stepHeight) {
    report('warning', `Jump rules: a drop is safe for ${safeDrop(rules, nobody)} blocks, no more than a step - every drop past a step is a fall that hurts.`);
  }
}
