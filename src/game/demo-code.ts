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
import type { cardDefSchema } from '../engine/content/pack/schema';
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
ctx.log('The line steadies.', 'good');
ctx.queue(effects);
return true;`,
  },
];

/**
 * The cards the demo project's own abilities sit on. Hold Fast is a class card, in play for every
 * sentinel; Rally the Line is Kara's alone, handed to her by the project rather than by a class.
 */
export const DEMO_PROJECT_CARDS: readonly z.input<typeof cardDefSchema>[] = [
  {
    id: 'sentinel-hold-fast',
    name: 'Hold Fast',
    grant: { kind: 'class', classId: 'sentinel' },
    text: 'Spend 3 Light to clear 2 Armor Slots.',
  },
  {
    id: 'rally-the-line',
    name: 'Rally the Line',
    grant: { kind: 'given', characters: ['kara'] },
    text: 'Spend a Light: every ally within Close range shakes something off — a Hit Point if they are badly hurt, a Stress if they are not.',
  },
];

/** Abilities the demo project adds on top of the pack's, as `z.input` to parse. */
export const DEMO_PROJECT_ABILITIES: readonly z.input<typeof abilitySchema>[] = [
  {
    // A class's Light feature. It lives here rather than in the pack because the
    // pack is written to spend nothing whose name is changing, and this spends
    // Light: the pack prices everything in Stress so that it needs no migration
    // when Light and Shadow are renamed.
    id: 'sentinel-hold-fast',
    name: 'Hold Fast',
    source: { card: 'sentinel-hold-fast' },
    text: 'Spend 3 Light to clear 2 Armor Slots.',
    cost: { good: 3 },
    // Not the turn: spending it is something done on a turn rather than the turn
    // itself, so it logs no `acted`.
    action: false,
    // Whole armour is refused rather than charged: there is nothing to fix.
    available: { kind: 'pool', pool: 'armorSlots', measure: 'marked', op: '>=', value: 1 },
    effects: [{ kind: 'clearArmor', amount: 2 }],
  },
  {
    id: 'rally-the-line',
    name: 'Rally the Line',
    source: { card: 'rally-the-line' },
    text: 'Spend a Light: every ally within Close range shakes something off — a Hit Point if they are badly hurt, a Stress if they are not.',
    cost: { good: 1 },
    target: { kind: 'self', range: 'close' },
    effects: [{ kind: 'run', hook: 'rally-the-line' }],
  },
];
