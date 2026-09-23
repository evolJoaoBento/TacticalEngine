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
    id: 'mark-the-page',
    name: 'Mark the Page',
    notes: 'The first use keeps the place; the second goes back to it and lets it go.',
    source: `// One card, two things, told apart by a flag: a hook can read one, and cannot read a mark.
if (!ctx.flag('the-page')) {
  ctx.log('The place is kept.', 'system');
  ctx.queue([{ kind: 'markSpot', mark: 'the-page' }, { kind: 'setFlag', flag: 'the-page' }]);
  return true;
}
ctx.log('Back to the place that was kept.', 'system');
ctx.queue([
  { kind: 'move', to: 'mark', mark: 'the-page', teleport: true },
  { kind: 'forgetSpot', mark: 'the-page' },
  { kind: 'clearFlag', flag: 'the-page' },
]);
return true;`,
  },
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
  // Chosen cards, in the domains their holders' classes draw from. Each is here to be played
  // against the rules rather than to round out a class: one knocks bodies about, one counts shot,
  // one puts dice back in the cup, one keeps a place on the floor, one buys a round with the GM's
  // own Shadow, and one walks through whoever is in the way.
  {
    id: 'grapeshot',
    name: 'Grapeshot',
    grant: { kind: 'chosen' },
    type: 'ability',
    domain: 'shadow',
    level: 1,
    recallCost: 1,
    text: 'Spend a shot: everything within Very Close takes 1d6 and is knocked back to Close range.',
  },
  {
    id: 'powder-and-shot',
    name: 'Powder and Shot',
    grant: { kind: 'chosen' },
    type: 'ability',
domain: 'shadow',
    level: 1,
    recallCost: 0,
    text: 'Load: put two shots on Grapeshot. It holds no more than four.',
  },
  {
    id: 'footnote',
    name: 'Footnote',
    grant: { kind: 'chosen' },
    type: 'ability',
domain: 'ember',
    level: 1,
    recallCost: 1,
    text: 'When a roll goes against you, mark a Stress to put both dice back in the cup.',
  },
  {
    id: 'mark-the-page',
    name: 'Mark the Page',
    grant: { kind: 'chosen' },
    type: 'ability',
    domain: 'ember',
    level: 1,
    recallCost: 1,
    text: 'Keep the place you are standing. Use it again to be back there, wherever you have got to.',
  },
  {
    id: 'another-round',
    name: 'Another Round',
    grant: { kind: 'chosen' },
    type: 'ability',
domain: 'bulwark',
    level: 1,
    recallCost: 1,
    text: 'A round for the house: every ally within Close range clears a Stress, and the GM gains a Shadow for it.',
  },
  {
    id: 'barrel-through',
    name: 'Barrel Through',
    grant: { kind: 'chosen' },
    type: 'ability',
domain: 'bulwark',
    level: 1,
    recallCost: 1,
    text: 'Shoulder through: adversaries within Melee range take 1d8 and are shoved out to Very Close.',
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
    id: 'grapeshot',
    name: 'Grapeshot',
    source: { card: 'grapeshot' },
    text: 'Spend a shot: everything within Very Close takes 1d6 and is knocked back to Close range.',
    inCombatOnly: true,
    target: { kind: 'self', range: 'veryClose' },
    // The magazine is the card's own tokens, so the cost is a token rather than Stress, and the
    // card simply cannot be played empty.
    available: { kind: 'tokens', ability: 'grapeshot', op: '>=', value: 1 },
    effects: [
      { kind: 'spendToken', ability: 'grapeshot', amount: 1 },
      { kind: 'damage', dice: '1d6', target: { kind: 'adversaries', range: 'veryClose' } },
      { kind: 'push', to: 'close', target: { kind: 'adversaries', range: 'veryClose' } },
    ],
  },
  {
    id: 'powder-and-shot',
    name: 'Powder and Shot',
    source: { card: 'powder-and-shot' },
    text: 'Load: put two shots on Grapeshot. It holds no more than four.',
    // Loading is something done on a turn rather than the turn itself.
    action: false,
    cost: { stress: 1 },
    effects: [{ kind: 'addToken', ability: 'grapeshot', amount: 2 }],
  },
  {
    id: 'footnote',
    name: 'Footnote',
    source: { card: 'footnote' },
    text: 'When a roll goes against you, mark a Stress to put both dice back in the cup.',
    kind: 'reaction',
    // The roll that can still be changed, rather than the one already settled, and only one that
    // went against them: a card offered on every throw in the party is a card nobody can read past.
    trigger: 'partyRolling',
    available: { kind: 'rolled', is: 'failure' },
    cost: { stress: 1 },
    action: false,
    effects: [
      { kind: 'log', text: 'A note in the margin: the dice go back in the cup.', tone: 'system' },
      { kind: 'rerollDuality', which: 'both' },
    ],
  },
  {
    id: 'mark-the-page',
    name: 'Mark the Page',
    source: { card: 'mark-the-page' },
    text: 'Keep the place you are standing. Use it again to be back there, wherever you have got to.',
    action: false,
    target: { kind: 'self', range: 'melee' },
    effects: [{ kind: 'run', hook: 'mark-the-page' }],
  },
  {
    id: 'another-round',
    name: 'Another Round',
    source: { card: 'another-round' },
    text: 'A round for the house: every ally within Close range clears a Stress, and the GM gains a Shadow for it.',
    cost: { stress: 1 },
    target: { kind: 'self', range: 'close' },
    effects: [
      { kind: 'clearStress', amount: 1, target: { kind: 'allies', range: 'close', includeSelf: true } },
      { kind: 'gainBad', amount: 1 },
    ],
  },
  {
    id: 'barrel-through',
    name: 'Barrel Through',
    source: { card: 'barrel-through' },
    text: 'Shoulder through: adversaries within Melee range take 1d8 and are shoved out to Very Close.',
    inCombatOnly: true,
    target: { kind: 'self', range: 'melee' },
    effects: [
      { kind: 'damage', dice: '1d8', target: { kind: 'adversaries', range: 'melee' } },
      { kind: 'push', to: 'veryClose', target: { kind: 'adversaries', range: 'melee' } },
    ],
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
