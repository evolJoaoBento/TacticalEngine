/**
 * The Ashwell (`docs/ASHWELL.md`): a grim megadungeon of the engine's own, in five levels under the drowned town of
 * Hallowmere, built in code as a project document - the hub, the Lantern & Lye, and all five levels below it.
 *
 * What every level shares - the ids, the maps drawn as rows of characters (`sceneFromRows`), the stair paired across
 * two rooms, the chest that waits for a fight - is in `ashwell-kit.ts`; each level's rooms, people and quest are in a
 * file of their own, `ashwell-level1.ts` to `ashwell-level5.ts`. Here is what they pay out, and the project they make:
 * played by whichever party comes to it - SRD characters, made at New Game and asked along at the camp, their cards
 * from the SRD character pack the project lists - begun through the camp's portal (`adventure-portal.ts`), which keeps
 * each beginning as a game of its own.
 */

import { projectSchema, type ProjectDoc } from '../../engine/scene/schema';
import { SRD_CONDITIONS } from '../../engine/content/conditions';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../../engine/content/pack/starter';
import type { CharacterSheet } from '../../engine/character/sheet';
import { DEMO_ITEMS, GOLD } from '../demo-items';
import { SHIPPED_MODELS } from '../project-open';
import { COMPANIONS } from '../camp-company';
import { sheetFor } from '../new-character';
import { ASHWELL_ID, HUB_ID, SUMP_KEY, GUILD_MARK, BONE_KEY, KINDLING, YOUR_PAGE, PALETTE, LINKED_SURFACES } from './ashwell-kit';
import { hub, throat, kennel, sump, CISTERN_WARDEN, LAMP_MOTH, WARDEN_CARDS, WARDEN_ABILITIES, KETCH, NAILS, ANNICK, QUEST, LEVEL_ONE_ITEMS } from './ashwell-level1';
import { market, pit, countingHouse, PIT_GHOUL, BONE_BROKER, GRALE, SELA, MARKET_QUEST_DEF } from './ashwell-level2';
import { readingRoom, stacks, index, INK_WRAITH, UNDERTOW_INDEX, AUD, LIBRARY_QUEST_DEF } from './ashwell-level3';
import { nave, gallery, hall, IRON_STOKER, BELLOWS_SAINT, ILSE, FURNACE_QUEST_DEF } from './ashwell-level4';
import { throne, ORSOLDE_VANE, VANE, THRONE_QUEST_DEF } from './ashwell-level5';

export * from './ashwell-kit';

/** The adventure's few things of its own: the keys, and what its chests pay out. */
const ITEMS: ProjectDoc['items'] = [
  { id: SUMP_KEY, name: 'Sump Gate Key', kind: 'key', description: 'A heavy iron key on a loop of well-chain, black with handling.', stackable: false, use: [] },
  { id: GUILD_MARK, name: 'The Guild\u2019s Mark', kind: 'key', description: 'A grey thumbprint on the back of a hand, from Usher Grale. It does not wash off.', stackable: false, use: [] },
  { id: BONE_KEY, name: 'Bone Key', kind: 'key', description: 'A key carved from a single long bone, smooth as a joint: the Bone Door\u2019s.', stackable: false, use: [] },
  { id: KINDLING, name: 'Aud\u2019s Tinder', kind: 'trinket', description: 'A twist of oilcloth: a tinderbox, and a rag soaked in lamp oil. Enough to light one fire, if it is the right one.', stackable: false, use: [] },
  { id: YOUR_PAGE, name: 'Your Page', kind: 'key', description: 'A single page in Vane\u2019s small square hand, folded once. It is about all of you. You have not read it yet.', stackable: false, use: [] },
] as ProjectDoc['items'];

const LOOT: ProjectDoc['lootTables'] = [
  {
    id: 'wellrat-takings',
    rolls: 2,
    entries: [
      { item: GOLD, quantity: { min: 4, max: 12 }, weight: 4 },
      { item: 'consumable-minor-stamina-potion', quantity: 1, weight: 2 },
      { item: 'consumable-minor-health-potion', quantity: 1, weight: 2 },
    ],
  },
  {
    id: 'wardens-hoard',
    rolls: 2,
    entries: [
      { item: GOLD, quantity: { min: 15, max: 30 }, weight: 4 },
      { item: 'secondary-round-shield', quantity: 1, weight: 1 },
      { item: 'armor-chainmail-armor', quantity: 1, weight: 1 },
      { item: 'consumable-minor-health-potion', quantity: 1, weight: 2 },
    ],
  },
  {
    id: 'drowned-satchel',
    rolls: 2,
    entries: [
      { item: GOLD, quantity: { min: 15, max: 35 }, weight: 3 },
      { item: 'consumable-minor-health-potion', quantity: 2, weight: 3 },
      { item: 'consumable-minor-stamina-potion', quantity: 1, weight: 2 },
    ],
  },
  {
    id: 'brokers-box',
    rolls: 2,
    entries: [
      { item: GOLD, quantity: { min: 30, max: 60 }, weight: 4 },
      { item: 'armor-chainmail-armor', quantity: 1, weight: 1 },
      { item: 'consumable-minor-health-potion', quantity: 2, weight: 2 },
    ],
  },
] as ProjectDoc['lootTables'];

/** What it keeps of the demo's things: its gold and its draught - none of the vault's story, nor its party's arms. */
const KEPT_ITEMS = new Set([GOLD, 'healing-draught']);

/**
 * The party it is written with when none is brought: four of the camp's company - Quim, Violet, Scarlet and Arty - as
 * New Game makes them. Whoever comes through the portal goes down instead.
 */
export const ASHWELL_PARTY: readonly CharacterSheet[] = COMPANIONS.slice(0, 4).map((companion) => sheetFor(companion.creation));

/**
 * The Ashwell, as a project: the hub and its five levels, played by the party given - the Furnace takes one of their
 * names - with the SRD character pack their classes and cards come from.
 */
export function ashwellProject(party: readonly CharacterSheet[] = ASHWELL_PARTY): ProjectDoc {
  return projectSchema.parse({
    id: ASHWELL_ID,
    name: 'The Ashwell',
    terrainPalette: PALETTE,
    surfaces: LINKED_SURFACES,
    scenes: [hub(), throat(), kennel(), sump(), market(), pit(), countingHouse(), readingRoom(), stacks(), index(), nave(), gallery(), hall(party), throne()],
    dialogues: [KETCH, NAILS, ANNICK, GRALE, SELA, AUD, ILSE, VANE],
    items: [...DEMO_ITEMS.filter((item) => KEPT_ITEMS.has(item.id)), ...ITEMS, ...LEVEL_ONE_ITEMS],
    lootTables: LOOT,
    quests: [QUEST, MARKET_QUEST_DEF, LIBRARY_QUEST_DEF, FURNACE_QUEST_DEF, THRONE_QUEST_DEF],
    adversaries: [CISTERN_WARDEN, LAMP_MOTH, PIT_GHOUL, BONE_BROKER, INK_WRAITH, UNDERTOW_INDEX, IRON_STOKER, BELLOWS_SAINT, ORSOLDE_VANE],
    cards: [...WARDEN_CARDS],
    abilities: [...STARTER_ABILITIES, ...WARDEN_ABILITIES],
    conditionDefs: [...STARTER_CONDITIONS, ...SRD_CONDITIONS.filter((c) => !STARTER_CONDITIONS.some((s) => s.id === c.id))],
    party: [...party],
    packs: ['srd-characters'],
    assets: [...SHIPPED_MODELS],
    startScene: HUB_ID,
  });
}
