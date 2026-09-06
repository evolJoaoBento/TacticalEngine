/**
 * Stat-block features, scripted.
 *
 * An adversary's action and reaction features are abilities like any other —
 * same schema, same effect vocabulary — sourced to the adversaries that print
 * them rather than to a character. The GM's side uses them from
 * `demo-scene.ts`, exactly as a player's side uses a domain card.
 *
 * The role features that every third stat block shares (Relentless, Horde,
 * Minion, Momentum, Terrifying) are not here: they are rules about how a fight
 * runs, read straight off the block in `combat/adversary-features.ts`. What is
 * here is the features that *do* something on a spotlight.
 *
 * `docs/ADVERSARIES.md` lists which features the engine runs and which are
 * still the GM's to narrate.
 */

import { z } from 'zod';
import { abilitySchema, type AbilityDef } from '../abilities';

type Input = z.input<typeof abilitySchema>;

const from = (...adversaries: string[]): Input['source'] => ({ kind: 'adversary', adversaries });

const RAW: Input[] = [
  {
    id: 'acid-burrower-earth-eruption',
    name: 'Earth Eruption',
    source: from('acid-burrower'),
    text: 'Mark a Stress to burst out of the ground. All creatures within Very Close range must succeed on an Agility Reaction Roll or be knocked over, making them Vulnerable until they next act.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'The ground splits and heaves.', tone: 'combat' },
      {
        kind: 'reactionRoll',
        // The Burrower's own Difficulty is what a reaction to it has to beat.
        difficulty: 14,
        trait: 'agility',
        // From an adversary, `allies` reads as the party within that band —
        // the selector is relative to whoever is acting.
        targets: { kind: 'allies', range: 'veryClose' },
        onFail: [
          { kind: 'log', text: 'Knocked off their feet.', tone: 'fear' },
          { kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } },
        ],
      },
    ],
  },
  {
    id: 'acid-burrower-spit-acid',
    name: 'Spit Acid',
    source: from('acid-burrower'),
    text: 'Make an attack against all targets in front of the Burrower within Close range. Targets it succeeds against take 2d6 physical damage and must mark an Armor Slot without receiving its benefits. If they cannot, they mark an additional Hit Point and the GM gains a Fear.',
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Acid arcs out in a wide spray.', tone: 'combat' },
      {
        kind: 'attack',
        // Every party member in reach, each rolled for; "in front of" is the
        // table's line and the engine does not model facing.
        target: { kind: 'allies', range: 'close' },
        damage: '2d6',
        onHit: [{ kind: 'run', hook: 'spit-acid-armor' }],
      },
    ],
  },
  {
    id: 'acid-burrower-acid-bath',
    name: 'Acid Bath',
    source: from('acid-burrower'),
    text: 'When the Burrower takes Severe damage, all creatures within Close range are bathed in acidic blood, taking 1d10 physical damage.',
    kind: 'reaction',
    trigger: 'tookSevere',
    action: false,
    target: { kind: 'none', range: 'close' },
    effects: [
      { kind: 'log', text: 'Acid blood sprays from the wound.', tone: 'fear' },
      { kind: 'damage', dice: '1d10', type: 'physical', target: { kind: 'allies', range: 'close' } },
    ],
  },
];

export const SRD_ADVERSARY_ABILITIES: readonly AbilityDef[] = RAW.map((raw) => abilitySchema.parse(raw));
