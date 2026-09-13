/**
 * What the demo's chests hold.
 *
 * Authored as document data and parsed through the same schemas a project file
 * uses, so this is a worked example of items and loot tables rather than
 * anything the engine knows about.
 *
 * The Warden's word is an item like any other: the strongbox in the pit asks for
 * it by `requiresKey`, and the conversation hands it over with `giveKey`, which
 * is `addItem` underneath.
 */

import { itemSchema, lootTableSchema, type ItemDef, type LootTable } from '../engine/content/items';

export const GOLD = 'gold';
export const WARDENS_WORD = 'wardens-word';

export const DEMO_ITEMS: readonly ItemDef[] = [
  {
    id: GOLD,
    name: 'Gold',
    kind: 'trinket',
    description: 'Coins, mostly. Some of them are even coins from here.',
  },
  {
    id: WARDENS_WORD,
    name: "The Warden's word",
    kind: 'key',
    description: 'Not written down anywhere. The door knows it when it hears it.',
    stackable: false,
  },
  {
    id: 'brass-key',
    name: 'Brass key',
    kind: 'key',
    description: 'Small, and green with age.',
    stackable: false,
  },
  {
    id: 'healing-draught',
    name: 'Healing draught',
    kind: 'consumable',
    description: 'Tastes of iron and mint.',
    use: [
      { kind: 'heal', amount: 2, target: { kind: 'actor' } },
      { kind: 'log', text: 'Iron and mint. The cuts close.', tone: 'good' },
    ],
  },
  {
    id: 'husk-carapace',
    name: 'Husk carapace',
    kind: 'trinket',
    description: 'Light, and still faintly warm.',
  },
  // Gear points at SRD content, so equipping is a lookup rather than a copy.
  {
    id: 'longsword',
    name: 'Longsword',
    kind: 'weapon',
    contentId: 'longsword',
    description: 'Older than the vault, and better kept.',
    stackable: false,
  },
  {
    id: 'round-shield',
    name: 'Round shield',
    kind: 'weapon',
    contentId: 'round-shield',
    description: 'Dented on the rim where it did its job.',
    stackable: false,
  },
  // The party's own starting gear, so what a swap sets aside has somewhere to go.
  { id: 'hunting-bow', name: 'Hunting bow', kind: 'weapon', contentId: 'hunting-bow', stackable: false },
  { id: 'ember-staff', name: 'Ember staff', kind: 'weapon', contentId: 'ember-staff', stackable: false },
  { id: 'ringmail', name: 'Ringmail', kind: 'armor', contentId: 'ringmail', stackable: false },
  { id: 'padded-coat', name: 'Padded coat', kind: 'armor', contentId: 'padded-coat', stackable: false },
].map((item) => itemSchema.parse(item));

export const CHEST_LOOT = 'vault-chest';
export const STRONGBOX_LOOT = 'pit-strongbox';

export const DEMO_LOOT_TABLES: readonly LootTable[] = [
  {
    id: CHEST_LOOT,
    rolls: 2,
    entries: [
      // Weights are relative: coins are common, the draught less so, and the
      // brass key is the thing you were actually hoping for.
      { item: GOLD, quantity: { min: 4, max: 12 }, weight: 5 },
      { item: 'healing-draught', quantity: 1, weight: 2 },
      { item: 'brass-key', quantity: 1, weight: 1 },
    ],
  },
  {
    id: STRONGBOX_LOOT,
    rolls: 3,
    entries: [
      { item: GOLD, quantity: { min: 20, max: 40 }, weight: 4 },
      { item: 'healing-draught', quantity: 2, weight: 2 },
      { item: 'husk-carapace', quantity: 1, weight: 1 },
      { item: 'longsword', quantity: 1, weight: 2 },
      { item: 'round-shield', quantity: 1, weight: 1 },
    ],
  },
].map((table) => lootTableSchema.parse(table));
