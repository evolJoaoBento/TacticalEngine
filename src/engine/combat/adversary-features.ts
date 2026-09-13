/**
 * The features printed on a stat block, read as rules.
 *
 * An adversary's features arrive from the content as name and text — the
 * importer deliberately does not guess what "Relentless (3)" means, because
 * the parenthetical means something different on every feature. This is where
 * the ones the engine actually runs are read out of that text.
 *
 * Only the features named here do anything; the rest are printed for the GM
 * and listed as inert in `docs/ADVERSARIES.md`. Adding one is a function here
 * plus the place that calls it — never a special case inside the fight.
 */

import type { AdversaryDef, AdversaryFeature } from '../content/types';
import { parseDice, type ParsedDamage } from '../rules/dice';

/** What a stat block's features add up to, for the code that has to obey them. */
export interface AdversaryTraits {
  /** How many times it can be spotlighted in one GM turn. One unless Relentless. */
  spotlights: number;
  /** Momentum: "when they make a successful attack against a PC, you gain a Shadow." */
  momentum: boolean;
  /** Terrifying: a successful attack costs every PC in Close range a Light, and gains a Shadow. */
  terrifying: boolean;
  /** Horde (X): the damage its standard attack deals once half its Hit Points are marked. */
  horde?: ParsedDamage;
  /** Minion (X): defeated by any damage, and one more per X damage dealt. */
  minion?: number;
}

/** The bit in brackets, from the parameter the importer kept or the name itself. */
function parameterOf(feature: AdversaryFeature): string | undefined {
  if (feature.parameter !== undefined && feature.parameter !== '') return feature.parameter;
  const inName = /\(([^)]+)\)/.exec(feature.name);
  return inName?.[1];
}

const baseName = (feature: AdversaryFeature): string => feature.name.split('(')[0]!.trim().toLowerCase();

/** The features this engine runs, by name. Everything else is the GM's to play. */
export const IMPLEMENTED_FEATURES: readonly string[] = ['relentless', 'momentum', 'terrifying', 'horde', 'minion'];

export function adversaryTraits(def: Pick<AdversaryDef, 'features'>): AdversaryTraits {
  const traits: AdversaryTraits = { spotlights: 1, momentum: false, terrifying: false };
  for (const feature of def.features) {
    const name = baseName(feature);
    const parameter = parameterOf(feature);
    if (name === 'relentless') {
      const times = Number(parameter);
      traits.spotlights = Number.isFinite(times) && times > 0 ? Math.floor(times) : 2;
    }
    if (name === 'momentum') traits.momentum = true;
    if (name === 'terrifying') traits.terrifying = true;
    if (name === 'horde') {
      const damage = parameter === undefined ? null : parseDice(parameter.replace(/\s*(phy|mag)\w*/i, '').trim());
      if (damage !== null) traits.horde = damage;
    }
    if (name === 'minion') {
      const per = Number(parameter);
      traits.minion = Number.isFinite(per) && per > 0 ? Math.floor(per) : 1;
    }
  }
  return traits;
}

/** Whether the engine runs this feature, for the doc that has to say so. */
export function isFeatureImplemented(feature: AdversaryFeature): boolean {
  return IMPLEMENTED_FEATURES.includes(baseName(feature));
}

/**
 * The damage its standard attack deals right now: the printed one, or a
 * Horde's second number once half its Hit Points are marked.
 */
export function attackDamageOf(
  def: Pick<AdversaryDef, 'features' | 'attackDamage'>,
  hitPoints: { max: number; marked: number },
): ParsedDamage {
  const traits = adversaryTraits(def);
  if (traits.horde === undefined || hitPoints.max === 0) return def.attackDamage;
  return hitPoints.marked * 2 >= hitPoints.max ? traits.horde : def.attackDamage;
}
