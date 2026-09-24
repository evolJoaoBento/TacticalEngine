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
  /**
   * The model to draw its picture from, when that is not the id.
   *
   * A remix is named for itself - its id is the remix's, not a model's - so without this its
   * card would fall back to the first letter of its label and a strip of saved boulders would
   * be a row of Bs.
   */
  readonly model?: string;
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

/** What the strip needs of a kind of tile: what to call it, what it looks like, and whether it stacks. */
export interface GroundType {
  readonly id: string;
  readonly name?: string;
  readonly color?: string;
  /** The model it is drawn with, when it names one: its card is a picture of that. */
  readonly model?: string;
  /** The structure it is, if it is one. Marks the card as something that stacks. */
  readonly structure?: string;
}

/**
 * Every kind of tile the project has: each card a picture of the model it is drawn with, and its
 * colour for a kind that names none - which is also what shows while the picture is being drawn.
 *
 * One tab, where there were two. Structures used to be a tab of its own listing the four
 * shapes a build tool stamped, and picking one put a different tool in hand; a kind of tile
 * carries its own structure now, so what used to be the choice between two tabs is the
 * choice between two kinds of tile in one.
 *
 * Takes the types rather than a list of ids and a table of colours: a project can declare a
 * kind of tile, and a swatch looked up in a table the engine wrote would never have it.
 */
export function tilesTab(types: readonly GroundType[]): LibraryTab {
  return {
    id: 'tiles',
    label: 'Tiles',
    // Only the kinds that stack. The strip is what the placer picks from, and the placer
    // puts down structures and nothing else, so a card for a kind of ground would be a card
    // that does nothing when it is clicked. Ground is still every cell's substrate and is
    // still edited in the Tiles workspace - it is only not a thing you place.
    //
    // `flatMap` rather than a filter and a map, so the structure is narrowed where it is
    // read: after a `filter` it is still `string | undefined` to the compiler.
    items: types.flatMap((type) =>
      type.structure === undefined
        ? []
        : [
            {
              tab: 'tiles',
              id: type.id,
              label: type.name !== undefined && type.name !== '' ? type.name : titleCase(type.id),
              swatch: type.color ?? FALLBACK_SWATCH,
              ...(type.model === undefined ? {} : { model: type.model }),
              // No "Stackable" detail any more: everything here stacks, so it said nothing.
              keywords: ['building', 'structure', type.structure],
            },
          ],
    ),
  };
}

/** Built-in props come first, then the project's imported models, marked "imported" so a designer can tell which ship with the engine. */
export function propsTab(
  models: readonly string[],
  imported: readonly string[],
  /** Remixes the project has saved: a model with its size and facing, offered as one more prop. */
  presets: readonly { id: string; label: string; model: string; span?: number }[] = [],
): LibraryTab {
  return {
    id: 'props',
    label: 'Props',
    items: [
      // Remixes first: they are what this project has decided it wants, and a strip of forty
      // models is a long way to scroll past the six somebody actually saved.
      ...presets.map((preset) => ({
        tab: 'props',
        id: preset.id,
        label: preset.label,
        detail: preset.span === undefined || preset.span <= 1 ? 'remix' : `remix · ${preset.span}×${preset.span}`,
        model: preset.model,
      })),
      ...models.map((id) => ({ tab: 'props', id, label: titleCase(id) })),
      ...imported.map((id) => ({ tab: 'props', id, label: titleCase(id), detail: 'imported' })),
    ],
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
