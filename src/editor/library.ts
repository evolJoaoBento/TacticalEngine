/**
 * What the bottom strip offers, as data.
 *
 * The strip is the TaleSpire half of the editor: pick a thing, then put it
 * down. Which things, grouped how, and what a search matches are decisions, so
 * they live here and are tested in node; the strip itself only draws.
 */

import type { AdversaryDef, AdversaryRole } from '../engine/content/types';
import type { Interactable } from '../engine/scene/schema';
import { BUILD_SHAPES } from '../engine/scene/building';

/** One card in the strip: what it shows, and what picking it hands to the tool. */
export interface LibraryItem {
  /** Which tab it came from, so a pick found by searching still knows what it is. */
  readonly tab: string;
  /** What picking it sets on the tool: a terrain id, a model, a kind, an adversary. */
  readonly id: string;
  readonly label: string;
  /** A second line: "imported", "T1 · Solo". */
  readonly detail?: string;
  /** A flat colour shown instead of a picture, for ground. */
  readonly swatch?: string;
  /** Words a search matches besides the label and the id. */
  readonly keywords?: readonly string[];
}

/** One tab of the strip: a label over the cards it groups. */
export interface LibraryTab {
  readonly id: string;
  readonly label: string;
  readonly items: readonly LibraryItem[];
}

/** "deadTree" and "rot-hound" as a person would write them. */
export function titleCase(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter((word) => word !== '')
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

const FALLBACK_SWATCH = '#5d8a4a';

/**
 * Structures has no models and no ids of its own: one card per shape the build tool stamps.
 *
 * Named for what it holds rather than for the tab it sits in. These are stackable scenery at
 * any height, which movement ignores; the Tiles tab beside it is the ground a walk is costed
 * on. Both were called Tiles until the placer arrived and made the collision visible.
 *
 * The id stays `tiles`: the strip draws its icon off it, and the tab-id tests name it.
 */
export function buildingTab(): LibraryTab {
  return { id: 'tiles', label: 'Structures', items: BUILD_SHAPES.map((shape) => ({
    tab: 'tiles', id: `tile-${shape}`, label: titleCase(shape), detail: 'Stackable', keywords: ['building', shape],
  })) };
}

/** What the strip needs of a kind of ground: what to call it and what colour to show. */
export interface GroundType {
  readonly id: string;
  readonly name?: string;
  readonly color?: string;
}

/**
 * Ground has no model to show, so each kind is a colour swatch.
 *
 * Takes the types rather than a list of ids and a table of colours: a project can declare a
 * kind of ground, and a swatch looked up in a table the engine wrote would never have it.
 */
export function tilesTab(types: readonly GroundType[]): LibraryTab {
  return {
    id: 'ground',
    label: 'Tiles',
    items: types.map((type) => ({
      tab: 'ground',
      id: type.id,
      label: type.name !== undefined && type.name !== '' ? type.name : titleCase(type.id),
      swatch: type.color ?? FALLBACK_SWATCH,
    })),
  };
}

/** Built-in props come first, then the project's imported models, marked "imported" so a designer can tell which ship with the engine. */
export function propsTab(models: readonly string[], imported: readonly string[]): LibraryTab {
  return {
    id: 'props',
    label: 'Props',
    items: [
      ...models.map((id) => ({ tab: 'props', id, label: titleCase(id) })),
      ...imported.map((id) => ({ tab: 'props', id, label: titleCase(id), detail: 'imported' })),
    ],
  };
}

/** Every kind the schema allows, in the order a designer reaches for them. */
export const OBJECT_KINDS: readonly Interactable['kind'][] = ['chest', 'door', 'pillar', 'portal', 'scripted'];

/** One card per interactable kind, in OBJECT_KINDS order. */
export function objectsTab(): LibraryTab {
  return {
    id: 'objects',
    label: 'Objects',
    items: OBJECT_KINDS.map((kind) => ({ tab: 'objects', id: kind, label: titleCase(kind) })),
  };
}

const ROLE_LABELS: Readonly<Record<AdversaryRole, string>> = {
  bruiser: 'Bruiser',
  horde: 'Horde',
  leader: 'Leader',
  minion: 'Minion',
  ranged: 'Ranged',
  skulk: 'Skulk',
  social: 'Social',
  solo: 'Solo',
  standard: 'Standard',
  support: 'Support',
};

/** The SRD's creatures, a tab per tier, alphabetical within it. */
export function creatureTabs(
  adversaries: Iterable<Pick<AdversaryDef, 'id' | 'name' | 'tier' | 'role'>>,
): LibraryTab[] {
  const tiers = [1, 2, 3, 4] as const;
  const byTier = new Map<number, LibraryItem[]>(tiers.map((tier) => [tier, []]));
  for (const creature of adversaries) {
    byTier.get(creature.tier)?.push({
      tab: `tier-${creature.tier}`,
      id: creature.id,
      label: creature.name,
      detail: `T${creature.tier} · ${ROLE_LABELS[creature.role]}`,
      keywords: [creature.role, `tier ${creature.tier}`],
    });
  }
  return tiers.map((tier) => ({
    id: `tier-${tier}`,
    label: `Tier ${tier}`,
    items: byTier.get(tier)!.sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

/**
 * Items across every tab whose label, id or keywords hold every word of the
 * query, ignoring case. An empty query matches nothing: the strip then shows the
 * open tab rather than everything at once.
 */
export function filterLibrary(tabs: readonly LibraryTab[], query: string): LibraryItem[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];
  return tabs.flatMap((tab) =>
    tab.items.filter((item) => {
      const haystack = [item.label, item.id, ...(item.keywords ?? [])].join(' ').toLowerCase();
      return words.every((word) => haystack.includes(word));
    }),
  );
}
