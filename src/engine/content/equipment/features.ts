/**
 * What a weapon's or armour's feature does, where its text says it plainly.
 *
 * A good share of the equipment's features are nothing but a number against something on the
 * sheet: Reliable "+1 to attack rolls", Heavy "−1 to Evasion", Cumbersome "−1 to Finesse", Barrier
 * "+2 to Armor Score; −1 to Evasion". Those are read here, clause by clause, into the same
 * modifiers a card carries (`abilityModifierSchema`) - so they fold into the derived sheet the way
 * a passive card's do, and an attack or a spell reads its bonus the way it reads a card's - and
 * into trait changes, which a card cannot make and so go straight onto the derived traits.
 *
 * Only clauses of that exact shape: anything else in a feature ("on a successful attack, roll an
 * additional damage die…") is left as the text it is, as a text-only card is. A feature that is
 * part number and part something else gets its number and keeps the rest as words.
 *
 * Features apply while the piece is worn or wielded, whichever hand: an attack bonus on a weapon is
 * counted on every attack, which the engine's one swing - the primary's - makes near enough true.
 */

import { abilityModifierSchema, type AbilityModifier } from '../abilities';
import type { Trait } from '../../scene/schema';

const TRAITS: readonly Trait[] = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];

/** What a clause's object names, and which modifier stat that is. */
const STATS: Record<string, AbilityModifier['stat']> = {
  'attack rolls': 'attackRoll',
  'armor score': 'armorScore',
  evasion: 'evasion',
  'severe damage threshold': 'severeThreshold',
  'major damage threshold': 'majorThreshold',
  'damage thresholds': 'thresholds',
  'spellcast rolls': 'spellcastRoll',
  proficiency: 'proficiency',
};

/** "+1 to attack rolls", "−2 to Evasion": a signed whole number, "to", and what it is to. */
const CLAUSE = /^([+−-])(\d+) to (.+)$/;

export interface GearEffects {
  modifiers: AbilityModifier[];
  traits: Partial<Record<Trait, number>>;
}

/** What these features do that can be counted. Empty when none says anything plain. */
export function gearEffects(features: readonly { name: string; text: string }[]): GearEffects {
  const modifiers: AbilityModifier[] = [];
  const traits: Partial<Record<Trait, number>> = {};
  const toTrait = (trait: Trait, n: number): void => {
    traits[trait] = (traits[trait] ?? 0) + n;
  };
  for (const feature of features) {
    for (const raw of feature.text.split(/;|\.\s/)) {
      const match = CLAUSE.exec(raw.trim().replace(/\.$/, ''));
      if (match === null) continue;
      const n = (match[1] === '+' ? 1 : -1) * Number(match[2]);
      const what = match[3]!.toLowerCase();
      const trait = TRAITS.find((t) => t === what);
      if (trait !== undefined) toTrait(trait, n);
      else if (what === 'all character traits and evasion') {
        for (const t of TRAITS) toTrait(t, n);
        modifiers.push(abilityModifierSchema.parse({ stat: 'evasion', bonus: n }));
      } else if (STATS[what] !== undefined) modifiers.push(abilityModifierSchema.parse({ stat: STATS[what], bonus: n }));
    }
  }
  return { modifiers, traits };
}
