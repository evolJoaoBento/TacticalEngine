/**
 * A peer game's host's saves (`table-saves.ts`): written with who plays whom at the table, and read back with it.
 */

import { describe, expect, it } from 'vitest';
import { SaveSlots, type SlotStore } from '../save-slots';
import { TableSaves, seatingOf } from './table-saves';

function memory(): SlotStore {
  const kept = new Map<string, string>();
  return { get: (key) => kept.get(key) ?? null, set: (key, value) => void kept.set(key, value), remove: (key) => void kept.delete(key) };
}

describe("a peer game's host's saves", () => {
  it('keep who plays whom with each save, and give it back with the text', () => {
    let seating: { seats: Record<string, string>; names: Record<string, string> } = { seats: { violet: 'g1', quim: 'h1' }, names: { g1: 'Gus', h1: 'Hana' } };
    const shelf = new TableSaves(new SaveSlots(memory(), () => 5), () => ({ seating: () => seating }));
    const slot = shelf.write('{"save":1}', 'Evening', 'The vault', 'slot-1', 'demo');
    expect(slot).toMatchObject({ id: 'slot-1', seats: { violet: 'g1', quim: 'h1' }, names: { g1: 'Gus', h1: 'Hana' } });
    expect(seatingOf(shelf, 'slot-1')).toEqual({ text: '{"save":1}', seats: { violet: 'g1', quim: 'h1' }, names: { g1: 'Gus', h1: 'Hana' } });
    // Nobody seated: nothing kept beside the save.
    seating = { seats: {}, names: {} };
    shelf.write('{"save":2}', 'Alone', 'The camp', 'slot-2');
    expect(seatingOf(shelf, 'slot-2')).toEqual({ text: '{"save":2}' });
    expect(seatingOf(shelf, 'none')).toBeNull();
  });

  it('keep nothing beside a save made with no table', () => {
    const shelf = new TableSaves(new SaveSlots(memory(), () => 5), () => null);
    expect(shelf.write('{}', 'x', 'y', 's')).toEqual({ id: 's', name: 'x', savedAt: 5, where: 'y' });
  });
});
