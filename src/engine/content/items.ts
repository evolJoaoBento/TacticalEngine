/**
 * Things the party can carry.
 *
 * One representation for all of it: the brass key a door wants, the gold in a
 * chest, a healing draught, and eventually the sword someone swings. The keys
 * the party held used to be a `Set<string>` of their own, which meant a designer
 * writing "the party has a thing" had to know which of two vocabularies applied
 * to which thing. `hasKey` is now `hasItem` with a quantity of one.
 *
 * Weapons and armour stay SRD *content*, not project items: an item points at
 * one through `contentId`, so equipping is a lookup rather than a copy, and the
 * 192 imported weapons do not have to be restated in every project that uses
 * them.
 */

import { z } from 'zod';
import type { Rng } from '../core/rng';
import { contentIdSchema } from '../scene/primitives';
import { effectSchema } from '../script/schema';

export const itemKindSchema = z.enum(['key', 'consumable', 'weapon', 'armor', 'trinket']);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: itemKindSchema.default('trinket'),
  description: z.string().default(''),
  /**
   * The SRD weapon or armour this stands for, when it is one. Left out for a
   * key, a coin, or anything a project invents.
   */
  contentId: z.string().optional(),
  /** Whether a second one adds to the count or sits beside the first. */
  stackable: z.boolean().default(true),
  /**
   * What one is worth, in the coin shops are paid in. A merchant buys any item with a value for half
   * of it, and his own lines for half his price; left out - a key, a quest's token, the coin itself -
   * no merchant will buy it.
   */
  value: z.number().int().min(0).optional(),
  /**
   * What using it does, in the one effect vocabulary — a draught heals the
   * `actor`, a scroll starts a conversation. Empty means it cannot be used.
   * A `consumable` is spent by the use; any other kind stays in the pack.
   */
  get use() {
    return z.array(effectSchema).default([]);
  },
});
export type ItemDef = z.infer<typeof itemSchema>;

/**
 * One thing a loot table can produce.
 *
 * `weight` is relative within its table, so an entry of 3 among entries of 1 is
 * three times as likely; it is not a percentage and does not have to sum to
 * anything.
 */
export const lootEntrySchema = z.object({
  item: contentIdSchema,
  /** A fixed count, or a range rolled per drop. */
  quantity: z
    .union([z.number().int().positive(), z.object({ min: z.number().int().positive(), max: z.number().int().positive() })])
    .default(1),
  weight: z.number().positive().default(1),
});
export type LootEntry = z.infer<typeof lootEntrySchema>;

export const lootTableSchema = z
  .object({
    id: contentIdSchema,
    /** How many times to draw from the table. */
    rolls: z.number().int().min(0).default(1),
    entries: z.array(lootEntrySchema).min(1),
  })
  .superRefine((table, ctx) => {
    table.entries.forEach((entry, i) => {
      if (typeof entry.quantity === 'object' && entry.quantity.max < entry.quantity.min) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', i, 'quantity'],
          message: `quantity max (${entry.quantity.max}) is below min (${entry.quantity.min})`,
        });
      }
    });
  });
export type LootTable = z.infer<typeof lootTableSchema>;

/** What a draw from a table produced. */
export interface LootDrop {
  item: string;
  quantity: number;
}

/**
 * Draw from a loot table.
 *
 * Weights are relative within the table rather than percentages, so an entry of
 * 3 among entries of 1 is three times as likely and nothing has to sum to
 * anything. Drops of the same item stack into one entry, so a table that can
 * roll gold twice reports one pile rather than two.
 *
 * Takes the scene's `Rng`, so what a chest holds is part of the same replayable
 * stream as the roll that opened it.
 */
export function rollLoot(table: LootTable, rng: Rng): LootDrop[] {
  const total = table.entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return [];

  const found = new Map<string, number>();
  for (let roll = 0; roll < table.rolls; roll++) {
    let ticket = rng.next() * total;
    // The last entry catches any float slop, so a draw always lands somewhere.
    let chosen = table.entries[table.entries.length - 1]!;
    for (const entry of table.entries) {
      ticket -= entry.weight;
      if (ticket <= 0) {
        chosen = entry;
        break;
      }
    }
    const quantity =
      typeof chosen.quantity === 'number'
        ? chosen.quantity
        : chosen.quantity.min +
          rng.nextInt(chosen.quantity.max - chosen.quantity.min + 1);
    found.set(chosen.item, (found.get(chosen.item) ?? 0) + quantity);
  }
  return [...found].map(([item, quantity]) => ({ item, quantity }));
}
