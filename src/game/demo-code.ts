/**
 * What a campaign's own code looks like.
 *
 * The demo carries one card the engine knows nothing about. Its mechanic —
 * "each ally clears the thing they most need cleared" — is a decision per
 * ally, which the effect vocabulary cannot write, so the project carries the
 * logic as code (`project.code[]`) and the ability runs it by id.
 *
 * This is the same door the editor's Code panel opens: nothing here is
 * special-cased by the engine. The body is a JavaScript function body run
 * against a hook context (`engine/script/hooks.ts`): it reads the world,
 * queues effects, and rolls off `ctx.rng` if it rolls at all.
 */

import type { z } from 'zod';
import type { abilitySchema } from '../engine/content/abilities';
import type { CodeDef } from '../engine/scene/schema';

/** Written as the project holds it: parsed by `projectSchema`, like everything else. */
export const DEMO_CODE: readonly CodeDef[] = [
  {
    id: 'rally-the-line',
    name: 'Rally the Line',
    notes: 'Each ally in Close range clears a Hit Point when badly hurt, a Stress otherwise.',
    source: `// ctx.select takes the same selectors content writes.
var allies = ctx.select({ kind: 'allies', range: 'close', includeSelf: true });
if (allies.length === 0) {
  ctx.log('Nobody stands close enough to rally.', 'system');
  return false;
}
var effects = [];
for (var i = 0; i < allies.length; i++) {
  var id = allies[i];
  var marked = ctx.pool(id, 'hitPoints', 'marked') || 0;
  var max = ctx.pool(id, 'hitPoints', 'max') || 1;
  var who = { kind: 'entity', id: id };
  // More than half their Hit Points marked: the wound is the urgent thing.
  effects.push(marked * 2 > max
    ? { kind: 'heal', amount: 1, target: who }
    : { kind: 'clearStress', amount: 1, target: who });
}
ctx.log('The line steadies.', 'hope');
ctx.queue(effects);
return true;`,
  },
];

/** Abilities the demo project adds on top of the SRD's, as `z.input` to parse. */
export const DEMO_PROJECT_ABILITIES: readonly z.input<typeof abilitySchema>[] = [
  {
    id: 'rally-the-line',
    name: 'Rally the Line',
    source: { kind: 'granted', characters: ['kara'] },
    text: 'Spend a Hope: every ally within Close range shakes something off — a Hit Point if they are badly hurt, a Stress if they are not.',
    cost: { hope: 1 },
    target: { kind: 'self', range: 'close' },
    effects: [{ kind: 'run', hook: 'rally-the-line' }],
  },
];
