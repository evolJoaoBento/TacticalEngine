/**
 * The pure pieces of the effect list: reading a hook's arguments, the words for what moves a
 * countdown, and the one-line summary of an effect the list cannot edit. Out of `EffectList.tsx`,
 * which is pinned at a size.
 */

import type { Effect } from '../../engine/script/schema';

/**
 * `name=value` pairs for a hook's arguments. Numbers and booleans are read as
 * such — a hook that asks for `ctx.args.amount` wants a number, and typing one
 * should not hand it the string.
 */
export function parseArgs(raw: string): Record<string, string | number | boolean> | undefined {
  const args: Record<string, string | number | boolean> = {};
  for (const pair of raw.split(',')) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (name === '') continue;
    const asNumber = Number(value);
    args[name] = value === 'true' ? true : value === 'false' ? false : value !== '' && !Number.isNaN(asNumber) ? asNumber : value;
  }
  return Object.keys(args).length === 0 ? undefined : args;
}

/** What moves a countdown, in the words a designer would use for it. */
export const ADVANCES: readonly (readonly [string, string])[] = [
  ['standard', 'on any PC roll'],
  ['attackRoll', 'on a PC attack roll'],
  ['withBad', 'on a PC roll with Shadow'],
  ['hpMarked', 'by the HP they mark'],
  ['progress', 'progress (dynamic)'],
  ['consequence', 'consequence (dynamic)'],
];

/** A one-line summary of an effect this cannot edit. */
export function describe(effect: Effect): string {
  switch (effect.kind) {
    case 'branch':
      return `If ${effect.when.kind}: ${effect.then.length} effect(s), else ${effect.otherwise?.length ?? 0}`;
    case 'diceCheck':
      return `Roll ${effect.dice} for a ${effect.atLeast}: ${effect.then.length} effect(s), else ${effect.otherwise?.length ?? 0}`;
    case 'choice':
      return `Ask the player (${effect.options.length} options)`;
    case 'check':
      return `Roll ${effect.check.trait} ${effect.check.difficulty}`;
    case 'story':
      return `Story panel: ${effect.title}`;
    case 'setVar':
      return `Set ${effect.name} = ${String(effect.value)}`;
    case 'addVar':
      return `Add ${effect.by} to ${effect.name}`;
    default:
      return effect.kind;
  }
}
