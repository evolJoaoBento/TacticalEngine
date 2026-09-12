/**
 * Importer for `tools/srd-sources/seansbox/adversaries.json` (129 SRD adversaries,
 * DPCGL). The source is stringly typed; this turns it into `AdversaryDef`s.
 *
 * Pure: it takes already-parsed JSON rather than reading the file, so it runs in
 * node, in the browser and in the editor's project importer alike. It never
 * throws — an entry it cannot read is skipped and reported in `issues`.
 */

import { parseThresholds } from '../../rules/damage';
import { parseDice } from '../../rules/dice';
import { parseRangeBand } from '../../rules/range';
import {
  toContentId,
  type AdversaryDef,
  type AdversaryFeature,
  type AdversaryRole,
  type ContentIssue,
  type Experience,
  type FeatureKind,
  type ImportResult,
  type Tier,
} from '../types';

/** One entry as it appears in the vendored JSON. Every field is a string. */
export interface RawAdversary {
  name?: unknown;
  type?: unknown;
  tier?: unknown;
  description?: unknown;
  motives_and_tactics?: unknown;
  difficulty?: unknown;
  thresholds?: unknown;
  hp?: unknown;
  stress?: unknown;
  atk?: unknown;
  attack?: unknown;
  range?: unknown;
  damage?: unknown;
  experience?: unknown;
  feature?: unknown;
}

const ROLES: Readonly<Record<string, AdversaryRole>> = {
  bruiser: 'bruiser',
  horde: 'horde',
  leader: 'leader',
  minion: 'minion',
  ranged: 'ranged',
  skulk: 'skulk',
  social: 'social',
  solo: 'solo',
  standard: 'standard',
  support: 'support',
};

const FEATURE_KINDS: Readonly<Record<string, FeatureKind>> = {
  passive: 'passive',
  action: 'action',
  reaction: 'reaction',
};

/**
 * Split a feature name like `"Relentless (3) - Passive"`,
 * `"Hallucinatory Breath - Reaction: Countdown (Loop 1d6)"`,
 * `"Casus Belli - Reaction: Long-Term Countdown (8)"`, or the source's one
 * unspaced `"Take Off- Action"`.
 *
 * The name group is greedy, so the split lands on the *rightmost* separator and a
 * hyphen inside the name ("All-Consuming Rage") does not break it early.
 */
const FEATURE_NAME_PATTERN =
  /^(.*)\s*-\s*(passive|action|reaction)\b(?:\s*:\s*(long-term\s+)?countdown\s*\(([^)]*)\))?\s*$/i;

export function parseFeatureName(
  input: string,
): Omit<AdversaryFeature, 'text' | 'costsGmResource'> | null {
  if (typeof input !== 'string') return null;
  const match = FEATURE_NAME_PATTERN.exec(input.trim());
  if (match === null) return null;

  const [, rawName, rawKind, longTerm, countdown] = match;
  const kind = FEATURE_KINDS[rawKind!.toLowerCase()];
  if (kind === undefined) return null;

  let name = rawName!.trim();
  // "Relentless (3)", "Minion (13)", "Horde (1d4+1)" — kept verbatim, because the
  // SRD gives the parenthetical a different meaning in each of those features.
  let parameter: string | undefined;
  const parameterMatch = /^(.*?)\s*\(([^)]*)\)$/.exec(name);
  if (parameterMatch !== null && parameterMatch[1]!.trim() !== '') {
    name = parameterMatch[1]!.trim();
    parameter = parameterMatch[2]!.trim();
  }
  if (name === '') return null;

  const feature: Omit<AdversaryFeature, 'text' | 'costsGmResource'> = { name, kind };
  if (parameter !== undefined && parameter !== '') feature.parameter = parameter;
  if (countdown !== undefined) {
    return {
      ...feature,
      countdown: countdown.trim(),
      ...(longTerm === undefined ? {} : { longTermCountdown: true }),
    };
  }
  return feature;
}

/**
 * "Ambusher +3, Keen Senses +2" -> two Experiences.
 *
 * A part that does not read as "<name> <+/-N>" comes back in `unreadable` rather
 * than being dropped, so the importer can report it instead of quietly losing an
 * Experience the GM is meant to be able to spend Fear on.
 */
export function parseExperiences(input: string | undefined): {
  experiences: Experience[];
  unreadable: string[];
} {
  if (typeof input !== 'string' || input.trim() === '') {
    return { experiences: [], unreadable: [] };
  }
  const experiences: Experience[] = [];
  const unreadable: string[] = [];
  for (const part of input.split(',')) {
    if (part.trim() === '') continue;
    const m = /^\s*(.+?)\s*([+-]\s*\d+)\s*$/.exec(part);
    if (m === null) {
      unreadable.push(part.trim());
      continue;
    }
    experiences.push({ name: m[1]!.trim(), modifier: Number(m[2]!.replace(/\s+/g, '')) });
  }
  return { experiences, unreadable };
}

/**
 * "Horde (3/HP)" -> role `horde` with 3 creatures per Hit Point.
 * Two stat blocks print "Horde (/HP)" with the number missing.
 */
export function parseRole(
  input: string,
): { role: AdversaryRole; hordeUnitsPerHp?: number } | null {
  if (typeof input !== 'string') return null;
  const m = /^\s*([a-z]+)\s*(?:\(\s*(\d*)\s*\/\s*hp\s*\))?\s*$/i.exec(input);
  if (m === null) return null;
  const role = ROLES[m[1]!.toLowerCase()];
  if (role === undefined) return null;
  if (m[2] !== undefined && m[2] !== '') return { role, hordeUnitsPerHp: Number(m[2]) };
  return { role };
}

/**
 * Whether a feature's text makes the GM pay Fear to use the feature itself.
 *
 * "Spend Fear as usual to spotlight them" is the ordinary spotlight cost every
 * adversary pays, not a cost of the feature, so it does not count. This is a hint
 * derived from prose — good enough to steer a GM AI, not a guarantee.
 */
export function costsFear(text: string): boolean {
  if (/\bspend\s+fear\s+as\s+usual\b/i.test(text)) return false;
  return /\bspend(?:ing|s)?\s+(?:a|an|\d+|one|two|three)?\s*fear\b/i.test(text);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asInteger(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : asString(value);
  if (text === null || !/^\s*[+-]?\d+\s*$/.test(text)) return null;
  return Number(text.trim());
}

/**
 * Import a parsed `adversaries.json` array.
 *
 * `source` is only used to label issues, so a project pack and the vendored SRD
 * can be told apart in an error list.
 */
export function importSeansboxAdversaries(
  raw: readonly RawAdversary[],
  source = 'seansbox/adversaries.json',
): ImportResult<AdversaryDef> {
  const defs: AdversaryDef[] = [];
  const issues: ContentIssue[] = [];
  const seenIds = new Set<string>();

  raw.forEach((entry, index) => {
    const name = asString(entry.name)?.trim() ?? '';
    const label = name === '' ? `#${index}` : name;
    const fail = (field: string, message: string): void => {
      issues.push({ source, entry: label, field, message });
    };

    if (name === '') {
      fail('name', 'missing or not a string');
      return;
    }

    const id = toContentId(name);
    if (seenIds.has(id)) {
      fail('name', `duplicate id "${id}"`);
      return;
    }

    const roleText = asString(entry.type) ?? '';
    const role = parseRole(roleText);
    if (role === null) {
      fail('type', `unrecognised role ${JSON.stringify(roleText)}`);
      return;
    }

    const tier = asInteger(entry.tier);
    if (tier === null || tier < 1 || tier > 4) {
      fail('tier', `expected 1-4, got ${JSON.stringify(entry.tier)}`);
      return;
    }

    const thresholdsText = asString(entry.thresholds) ?? '';
    const thresholds = parseThresholds(thresholdsText);
    if (thresholds === null) {
      fail('thresholds', `unreadable ${JSON.stringify(thresholdsText)}`);
      return;
    }

    const difficulty = asInteger(entry.difficulty);
    const hitPoints = asInteger(entry.hp);
    const stress = asInteger(entry.stress);
    if (difficulty === null || hitPoints === null || stress === null) {
      fail(
        'difficulty/hp/stress',
        `expected numbers, got ${JSON.stringify([entry.difficulty, entry.hp, entry.stress])}`,
      );
      return;
    }

    const atkText = asString(entry.atk) ?? '';
    const attackModifier = parseDice(atkText);
    if (attackModifier === null) {
      fail('atk', `unreadable ${JSON.stringify(atkText)}`);
      return;
    }

    const rangeText = asString(entry.range) ?? '';
    const attackRange = parseRangeBand(rangeText);
    if (attackRange === null || attackRange === 'outOfRange') {
      fail('range', `unrecognised band ${JSON.stringify(rangeText)}`);
      return;
    }

    const damageText = asString(entry.damage) ?? '';
    const attackDamage = parseDice(damageText);
    if (attackDamage === null) {
      fail('damage', `unreadable ${JSON.stringify(damageText)}`);
      return;
    }

    const features: AdversaryFeature[] = [];
    const rawFeatures = Array.isArray(entry.feature) ? entry.feature : [];
    for (const rawFeature of rawFeatures as { name?: unknown; text?: unknown }[]) {
      const featureName = asString(rawFeature.name) ?? '';
      const text = asString(rawFeature.text) ?? '';
      const parsed = parseFeatureName(featureName);
      if (parsed === null) {
        fail('feature', `unreadable feature name ${JSON.stringify(featureName)}`);
        continue;
      }
      // The field is named for what it does; the reader is named for the word it
      // looks for in this source's prose, and goes when the source does.
      features.push({ ...parsed, text, costsGmResource: costsFear(text) });
    }

    const { experiences, unreadable } = parseExperiences(asString(entry.experience) ?? undefined);
    for (const part of unreadable) {
      fail('experience', `unreadable Experience ${JSON.stringify(part)}`);
    }

    seenIds.add(id);
    defs.push({
      id,
      name,
      tier: tier as Tier,
      role: role.role,
      ...(role.hordeUnitsPerHp === undefined ? {} : { hordeUnitsPerHp: role.hordeUnitsPerHp }),
      description: asString(entry.description) ?? '',
      motivesAndTactics: asString(entry.motives_and_tactics) ?? '',
      difficulty,
      thresholds,
      hitPoints,
      stress,
      attackName: asString(entry.attack)?.trim() ?? '',
      attackModifier,
      attackRange,
      attackDamage,
      experiences,
      features,
    });
  });

  return { defs, issues };
}
