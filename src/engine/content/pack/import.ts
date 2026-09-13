/**
 * A content pack in memory: the types the rules read, and how a project's own content is laid over
 * a pack's.
 *
 * A pack *file* is read by `document.ts`. The readers that used to live here turned one retired
 * community data set's shapes into these types; nothing has called them since that data set left
 * the repository, and they wrote the printed features that are cards now, so they are gone.
 */

import type { ParsedDamage } from '../../rules/dice';
import type { DamageThresholds } from '../../rules/damage';
import type { RangeBand } from '../../rules/range';
import type { Trait } from '../../scene/schema';

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

/** A class's numbers and domains. What it prints is cards whose grant names it. */
export interface ClassDef {
  id: string;
  name: string;
  domains: string[];
  startingEvasion: number;
  startingHitPoints: number;
}

export interface AncestryDef {
  id: string;
  name: string;
}

export interface CommunityDef {
  id: string;
  name: string;
}

export interface SubclassDef {
  id: string;
  name: string;
  /** The class this belongs to, as a content id. */
  classId: string;
  domains: string[];
  spellcastTrait?: Trait;
}

export type SubclassStage = 'foundation' | 'specialization' | 'mastery';

/** How a card came to be in play: `cardGrantSchema`, as the rules read it. */
export type CardGrant =
  | { kind: 'chosen' }
  | { kind: 'class'; classId: string }
  | { kind: 'subclass'; subclassId: string; stage: SubclassStage }
  | { kind: 'ancestry'; ancestryId: string }
  | { kind: 'community'; communityId: string }
  | { kind: 'given'; characters: string[] }
  | { kind: 'adversary'; adversaries: string[] }
  | { kind: 'condition'; conditions: string[] };

/** A card, chosen or granted. Only a chosen one carries the loadout's numbers. */
export interface CardDef {
  id: string;
  name: string;
  grant: CardGrant;
  domain?: string;
  type?: 'ability' | 'spell' | 'grimoire';
  /** Minimum character level to take it. */
  level?: number;
  recallCost?: number;
  text: string;
  /** The card's named features: a grimoire's spells. Most cards have one, unnamed. */
  features: readonly PackFeature[];
}

/**
 * A card somebody picks into a loadout: the one kind with a domain, a level and a recall cost.
 * What a sheet's `domainCards` names, and what the loadout and the vault hold.
 */
export interface DomainCardDef extends CardDef {
  grant: { kind: 'chosen' };
  domain: string;
  type: 'ability' | 'spell' | 'grimoire';
  level: number;
  recallCost: number;
}

/** Whether a card is one a character chooses, with everything a chosen card must carry. */
export function isDomainCard(card: CardDef): card is DomainCardDef {
  return (
    card.grant.kind === 'chosen' &&
    card.domain !== undefined &&
    card.type !== undefined &&
    card.level !== undefined &&
    card.recallCost !== undefined
  );
}

/** Everything a character can be built from. */
export interface ContentPack {
  weapons: ReadonlyMap<string, WeaponDef>;
  armors: ReadonlyMap<string, ArmorDef>;
  classes: ReadonlyMap<string, ClassDef>;
  ancestries: ReadonlyMap<string, AncestryDef>;
  communities: ReadonlyMap<string, CommunityDef>;
  subclasses: ReadonlyMap<string, SubclassDef>;
  cards: ReadonlyMap<string, CardDef>;
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

