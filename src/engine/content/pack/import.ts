/**
 * Importer for the SRD's structured data (no longer vendored) — the structured half
 * of the vendored SRD: classes, ancestries, communities, armor and weapons.
 *
 * These are the pieces a *character* is made of, as opposed to the adversaries
 * `seansbox-adversaries.ts` brings in. Equipment matters mechanically rather than
 * decoratively here: armor sets the damage thresholds and Armor Slots the rules
 * already use, and a weapon sets the trait rolled, the range band and the damage
 * dice Proficiency multiplies.
 *
 * Like the adversary importer, this is pure — it takes parsed JSON — and it never
 * throws: an entry it cannot read is skipped and reported in `issues`.
 *
 * Two quirks of the source, both handled rather than assumed away:
 * - Names are `{"en-US": "…"}` everywhere except classes, where the name is a
 *   bare upper-case string.
 * - A tier-1 weapon has no `damage.modifier` at all, which is correct: the SRD's
 *   tier-1 table really does read "d8 phy".
 */

import { parseDice, type DamageType, type ParsedDamage } from '../../rules/dice';
import type { DamageThresholds } from '../../rules/damage';
import { parseRangeBand, type RangeBand } from '../../rules/range';
import type { Trait } from '../../scene/schema';
import { toContentId, type ContentIssue, type ImportResult } from '../types';

// ---------------------------------------------------------------------------
// Normalized types
// ---------------------------------------------------------------------------

export interface PackFeature {
  name: string;
  text: string;
}

export type WeaponSlot = 'primaryPhysical' | 'primaryMagic' | 'secondary';
export type Burden = 'oneHanded' | 'twoHanded';

export interface WeaponDef {
  id: string;
  name: string;
  tier: number;
  slot: WeaponSlot;
  /** The trait an attack with this weapon rolls. */
  trait: Trait;
  range: RangeBand;
  /** Damage before Proficiency multiplies the dice. */
  damage: ParsedDamage;
  burden: Burden;
  features: PackFeature[];
}

export interface ArmorDef {
  id: string;
  name: string;
  tier: number;
  /** Before the wearer's level is added. */
  baseThresholds: DamageThresholds;
  baseScore: number;
  features: PackFeature[];
}

export interface ClassDef {
  id: string;
  name: string;
  domains: string[];
  startingEvasion: number;
  startingHitPoints: number;
  /**
   * The feature a class grants for its own resource. Named for what it is
   * rather than for the resource, so renaming that resource never reaches a
   * stored pack.
   */
  signatureFeature?: PackFeature;
  features: PackFeature[];
}

export interface AncestryDef {
  id: string;
  name: string;
  features: PackFeature[];
}

export interface CommunityDef {
  id: string;
  name: string;
  features: PackFeature[];
}

export interface SubclassDef {
  id: string;
  name: string;
  /** The class this belongs to, as a content id. */
  classId: string;
  domains: string[];
  spellcastTrait?: Trait;
  foundation: PackFeature[];
  specialization: PackFeature[];
  mastery: PackFeature[];
}

export interface DomainCardDef {
  id: string;
  name: string;
  domain: string;
  type: 'ability' | 'spell' | 'grimoire';
  /** Minimum character level to take it. */
  level: number;
  recallCost: number;
  text: string;
  /** The card's named features: a grimoire's spells. Most cards have one, unnamed. */
  features: readonly PackFeature[];
}

/** Everything a character can be built from. */
export interface ContentPack {
  weapons: ReadonlyMap<string, WeaponDef>;
  armors: ReadonlyMap<string, ArmorDef>;
  classes: ReadonlyMap<string, ClassDef>;
  ancestries: ReadonlyMap<string, AncestryDef>;
  communities: ReadonlyMap<string, CommunityDef>;
  subclasses: ReadonlyMap<string, SubclassDef>;
  cards: ReadonlyMap<string, DomainCardDef>;
}

// ---------------------------------------------------------------------------
// Readers for the source's shapes
// ---------------------------------------------------------------------------

/** `{"en-US": "Broadsword"}`, or a bare string as the class list uses. */
function localized(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const text = (value as Record<string, unknown>)['en-US'];
    if (typeof text === 'string') return text;
  }
  return null;
}

/** Descriptions are arrays of `{paragraph}` and `{list}` blocks. */
function describe(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const parts: string[] = [];
  for (const block of value as Record<string, unknown>[]) {
    const paragraph = localized(block['paragraph']);
    if (paragraph !== null) {
      parts.push(paragraph);
      continue;
    }
    if (Array.isArray(block['list'])) {
      for (const item of block['list'] as unknown[]) {
        const text = localized(item);
        if (text !== null) parts.push(`• ${text}`);
      }
    }
  }
  return parts.join('\n');
}

function readFeatures(value: unknown): PackFeature[] {
  if (!Array.isArray(value)) return [];
  const out: PackFeature[] = [];
  for (const raw of value as Record<string, unknown>[]) {
    out.push({ name: localized(raw['name']) ?? '', text: describe(raw['description']) });
  }
  return out;
}

/** "CORE_CLASS_BARD" / "core_weapon_broadsword" -> "broadsword". */
function shortId(id: string, prefix: string): string {
  const stripped = id.toLowerCase().replace(new RegExp(`^core_${prefix}_`), '');
  return toContentId(stripped);
}

const TRAITS: Readonly<Record<string, Trait>> = {
  AGILITY: 'agility',
  STRENGTH: 'strength',
  FINESSE: 'finesse',
  INSTINCT: 'instinct',
  PRESENCE: 'presence',
  KNOWLEDGE: 'knowledge',
};

const SLOTS: Readonly<Record<string, WeaponSlot>> = {
  PRIMARY_PHYSICAL: 'primaryPhysical',
  PRIMARY_MAGIC: 'primaryMagic',
  SECONDARY: 'secondary',
};

const BURDENS: Readonly<Record<string, Burden>> = {
  ONE_HANDED: 'oneHanded',
  TWO_HANDED: 'twoHanded',
};

const DAMAGE_TYPES: Readonly<Record<string, DamageType[]>> = {
  PHYSICAL: ['physical'],
  MAGICAL: ['magic'],
  // The source's "either" case; the wielder chooses, so both are carried.
  PHYSICAL_OR_MAGICAL: ['physical', 'magic'],
};

// ---------------------------------------------------------------------------
// Importers
// ---------------------------------------------------------------------------

const SOURCE = 'daggersearch/core';

function importList<T extends { id: string }>(
  raw: readonly unknown[],
  file: string,
  prefix: string,
  read: (
    entry: Record<string, unknown>,
    id: string,
    name: string,
    fail: (field: string, message: string) => void,
  ) => T | null,
): ImportResult<T> {
  const defs: T[] = [];
  const issues: ContentIssue[] = [];
  const seen = new Set<string>();

  (raw as Record<string, unknown>[]).forEach((entry, index) => {
    const rawId = typeof entry['id'] === 'string' ? entry['id'] : '';
    const name = localized(entry['name']) ?? '';
    const label = name === '' ? rawId || `#${index}` : name;
    const fail = (field: string, message: string): void => {
      issues.push({ source: `${SOURCE}/${file}`, entry: label, field, message });
    };

    if (rawId === '') {
      fail('id', 'missing');
      return;
    }
    const id = shortId(rawId, prefix);
    if (seen.has(id)) {
      fail('id', `duplicate id "${id}"`);
      return;
    }
    const def = read(entry, id, name, fail);
    if (def === null) return;
    seen.add(id);
    defs.push(def);
  });

  return { defs, issues };
}

export function importWeapons(raw: readonly unknown[]): ImportResult<WeaponDef> {
  return importList(raw, 'weapons.json', 'weapon', (entry, id, name, fail) => {
    const trait = TRAITS[String(entry['trait'])];
    const slot = SLOTS[String(entry['type'])];
    const burden = BURDENS[String(entry['burden'])];
    const range = parseRangeBand(String(entry['range']).replace(/_/g, ' '));
    if (trait === undefined || slot === undefined || burden === undefined) {
      fail('trait/type/burden', `unrecognised ${JSON.stringify([entry['trait'], entry['type'], entry['burden']])}`);
      return null;
    }
    if (range === null || range === 'outOfRange') {
      fail('range', `unrecognised band ${JSON.stringify(entry['range'])}`);
      return null;
    }

    const damageRaw = entry['damage'];
    if (typeof damageRaw !== 'object' || damageRaw === null) {
      fail('damage', 'missing');
      return null;
    }
    const damage = readDamage(damageRaw as Record<string, unknown>);
    if (damage === null) {
      fail('damage', `unreadable ${JSON.stringify(damageRaw)}`);
      return null;
    }

    return {
      id,
      name,
      tier: Number(entry['tier']) || 1,
      slot,
      trait,
      range,
      damage,
      burden,
      features: readFeatures(entry['features']),
    };
  });
}

/** `{dice: "D8", modifier: 3, type: "PHYSICAL"}` -> a parsed expression. */
function readDamage(raw: Record<string, unknown>): ParsedDamage | null {
  const dice = typeof raw['dice'] === 'string' ? raw['dice'].toLowerCase() : '';
  if (!/^d\d+$/.test(dice)) return null;
  const modifier = typeof raw['modifier'] === 'number' ? raw['modifier'] : 0;
  const parsed = parseDice(modifier === 0 ? dice : `${dice}+${modifier}`);
  if (parsed === null) return null;
  const types = DAMAGE_TYPES[String(raw['type'])];
  return types === undefined ? parsed : { ...parsed, types };
}

export function importArmors(raw: readonly unknown[]): ImportResult<ArmorDef> {
  return importList(raw, 'armors.json', 'armor', (entry, id, name, fail) => {
    const major = entry['baseMajorThreshold'];
    const severe = entry['baseSevereThreshold'];
    const score = entry['baseScore'];
    if (typeof major !== 'number' || typeof severe !== 'number' || typeof score !== 'number') {
      fail('thresholds/score', `expected numbers, got ${JSON.stringify([major, severe, score])}`);
      return null;
    }
    return {
      id,
      name,
      tier: Number(entry['tier']) || 1,
      baseThresholds: { major, severe },
      baseScore: score,
      features: readFeatures(entry['features']),
    };
  });
}

export function importClasses(raw: readonly unknown[]): ImportResult<ClassDef> {
  return importList(raw, 'classes.json', 'class', (entry, id, name, fail) => {
    const evasion = entry['startingEvasion'];
    const hitPoints = entry['startingHitPoints'];
    if (typeof evasion !== 'number' || typeof hitPoints !== 'number') {
      fail('startingEvasion/startingHitPoints', 'expected numbers');
      return null;
    }
    const good = entry['goodFeature'];
    const def: ClassDef = {
      id,
      // Class names are shouted in the source; title-case reads better in a UI.
      name: name.charAt(0) + name.slice(1).toLowerCase(),
      domains: Array.isArray(entry['domains'])
        ? (entry['domains'] as unknown[]).map((d) => String(d).toLowerCase())
        : [],
      startingEvasion: evasion,
      startingHitPoints: hitPoints,
      features: readFeatures(entry['classFeatures']),
    };
    if (typeof good === 'object' && good !== null) {
      const feature = good as Record<string, unknown>;
      def.signatureFeature = {
        name: localized(feature['name']) ?? '',
        text: describe(feature['description']),
      };
    }
    return def;
  });
}

export function importAncestries(raw: readonly unknown[]): ImportResult<AncestryDef> {
  return importList(raw, 'ancestries.json', 'ancestry', (entry, id, name) => ({
    id,
    name,
    features: readFeatures(entry['features']),
  }));
}

export function importCommunities(raw: readonly unknown[]): ImportResult<CommunityDef> {
  return importList(raw, 'communities.json', 'community', (entry, id, name) => ({
    id,
    name,
    features: readFeatures(entry['features']),
  }));
}

export function importSubclasses(raw: readonly unknown[]): ImportResult<SubclassDef> {
  return importList(raw, 'subclasses.json', 'subclass', (entry, id, name, fail) => {
    const klass = entry['class'];
    if (typeof klass !== 'string') {
      fail('class', 'expected a class name');
      return null;
    }
    const stage = (key: string): PackFeature[] => {
      const block = entry[key];
      return typeof block === 'object' && block !== null
        ? readFeatures((block as Record<string, unknown>)['features'])
        : [];
    };
    const trait = typeof entry['spellcastTrait'] === 'string' ? TRAITS[entry['spellcastTrait']] : undefined;
    return {
      id,
      name,
      classId: toContentId(klass.toLowerCase()),
      domains: Array.isArray(entry['domains'])
        ? (entry['domains'] as unknown[]).map((d) => String(d).toLowerCase())
        : [],
      ...(trait === undefined ? {} : { spellcastTrait: trait }),
      foundation: stage('foundation'),
      specialization: stage('specialization'),
      mastery: stage('mastery'),
    };
  });
}

const CARD_TYPES: Readonly<Record<string, DomainCardDef['type']>> = {
  ABILITY: 'ability',
  SPELL: 'spell',
  GRIMOIRE: 'grimoire',
};

export function importDomainCards(raw: readonly unknown[]): ImportResult<DomainCardDef> {
  return importList(raw, 'domain-cards.json', 'domain_card', (entry, id, name, fail) => {
    const domain = entry['domain'];
    const level = entry['level'];
    if (typeof domain !== 'string' || typeof level !== 'number') {
      fail('domain/level', 'expected a domain name and a level');
      return null;
    }
    const type = CARD_TYPES[String(entry['type'])];
    if (type === undefined) {
      fail('type', `unknown card type "${String(entry['type'])}"`);
      return null;
    }
    const features = readFeatures(entry['features']);
    return {
      id,
      name,
      domain: domain.toLowerCase(),
      type,
      level,
      recallCost: typeof entry['recallCost'] === 'number' ? entry['recallCost'] : 0,
      text: features.map((f) => f.text).join('\n'),
      features,
    };
  });
}

/**
 * What one of a pack's lists holds: `PackDef<'weapons'>` is a `WeaponDef`.
 *
 * Naming it keeps `mergePack` honest — a list of armours handed in under
 * `weapons` is a type error rather than a map with the wrong thing in it.
 */
type PackDef<K extends keyof ContentPack> =
  ContentPack[K] extends ReadonlyMap<string, infer T> ? T : never;

/**
 * A project's own content laid over a base pack.
 *
 * Content a document carries wins, id for id, so a campaign — or a test — can
 * bring the creature or the card it needs rather than borrowing one from
 * whatever pack the app happens to ship. A list the document leaves empty
 * changes nothing.
 */
export function mergePack(
  base: ContentPack,
  own: { readonly [K in keyof ContentPack]?: readonly PackDef<K>[] },
): ContentPack {
  const lay = <T extends { id: string }>(
    into: ReadonlyMap<string, T>,
    over: readonly T[] | undefined,
  ): ReadonlyMap<string, T> => {
    if (over === undefined || over.length === 0) return into;
    const merged = new Map(into);
    for (const def of over) merged.set(def.id, def);
    return merged;
  };
  return {
    weapons: lay(base.weapons, own.weapons),
    armors: lay(base.armors, own.armors),
    classes: lay(base.classes, own.classes),
    ancestries: lay(base.ancestries, own.ancestries),
    communities: lay(base.communities, own.communities),
    subclasses: lay(base.subclasses, own.subclasses),
    cards: lay(base.cards, own.cards),
  };
}

export interface RawCharacterSources {
  weapons: readonly unknown[];
  armors: readonly unknown[];
  classes: readonly unknown[];
  ancestries: readonly unknown[];
  communities: readonly unknown[];
  /** Optional, so a caller that only needs the level-1 numbers can leave them out. */
  subclasses?: readonly unknown[];
  domainCards?: readonly unknown[];
}

/** Import every character source at once. */
export function importContentPack(
  raw: RawCharacterSources,
): { content: ContentPack; issues: ContentIssue[] } {
  const weapons = importWeapons(raw.weapons);
  const armors = importArmors(raw.armors);
  const classes = importClasses(raw.classes);
  const ancestries = importAncestries(raw.ancestries);
  const communities = importCommunities(raw.communities);
  const subclasses = importSubclasses(raw.subclasses ?? []);
  const domainCards = importDomainCards(raw.domainCards ?? []);

  const index = <T extends { id: string }>(defs: readonly T[]): ReadonlyMap<string, T> =>
    new Map(defs.map((def) => [def.id, def]));

  return {
    content: {
      weapons: index(weapons.defs),
      armors: index(armors.defs),
      classes: index(classes.defs),
      ancestries: index(ancestries.defs),
      communities: index(communities.defs),
      subclasses: index(subclasses.defs),
      cards: index(domainCards.defs),
    },
    issues: [
      ...weapons.issues,
      ...armors.issues,
      ...classes.issues,
      ...ancestries.issues,
      ...communities.issues,
      ...subclasses.issues,
      ...domainCards.issues,
    ],
  };
}
