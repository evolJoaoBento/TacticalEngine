import { describe, it, expect } from 'vitest';
import { AUTO_SLOT, QUICK_SLOT, SaveSlots, memoryStore } from './save-slots';

/**
 * Where saves go. The store is a Map here and localStorage in the browser;
 * what matters is that the index and the slots stay in step, and that a
 * store that throws reads as "no saves" rather than an exception.
 */

function slots(map = new Map<string, string>()) {
  let tick = 1000;
  return { slots: new SaveSlots(memoryStore(map), () => (tick += 1)), map };
}

describe('save slots', () => {
  it('starts empty', () => {
    expect(slots().slots.list()).toEqual([]);
  });

  it('writes a named slot with a fresh id, and lists newest first', () => {
    const { slots: s } = slots();
    const first = s.write('{"a":1}', 'Before the door', 'The Husk Vault')!;
    const second = s.write('{"a":2}', 'After the door', 'The Husk Vault')!;
    expect(first.id).not.toBe(second.id);
    expect(s.list().map((slot) => slot.name)).toEqual(['After the door', 'Before the door']);
    expect(s.read(first.id)).toBe('{"a":1}');
    expect(s.read(second.id)).toBe('{"a":2}');
  });

  it('overwrites a fixed slot rather than adding one', () => {
    const { slots: s } = slots();
    s.write('1', 'Quick save', 'x', QUICK_SLOT);
    s.write('2', 'Quick save', 'y', QUICK_SLOT);
    s.write('3', 'Autosave', 'z', AUTO_SLOT);
    expect(s.list()).toHaveLength(2);
    expect(s.read(QUICK_SLOT)).toBe('2');
    expect(s.list()[0]!.where).toBe('z');
  });

  it('removes a slot and its text', () => {
    const { slots: s, map } = slots();
    const slot = s.write('text', 'Named', 'w')!;
    expect(s.remove(slot.id)).toBe(true);
    expect(s.list()).toEqual([]);
    expect(s.read(slot.id)).toBeNull();
    expect([...map.keys()].some((k) => k.endsWith(slot.id))).toBe(false);
    expect(s.remove(slot.id)).toBe(false);
  });

  it('ignores an index that is not one', () => {
    const map = new Map<string, string>([['polyheart:saves', 'not json']]);
    expect(slots(map).slots.list()).toEqual([]);
    map.set('polyheart:saves', JSON.stringify([{ id: 1 }, { id: 'ok', name: 'Ok', savedAt: 5 }]));
    expect(slots(map).slots.list().map((s) => s.id)).toEqual(['ok']);
  });

  it('reads a store that throws as empty, and a write that throws as refused', () => {
    const angry = new SaveSlots({
      get: () => {
        throw new Error('blocked');
      },
      set: () => {
        throw new Error('blocked');
      },
      remove: () => {
        throw new Error('blocked');
      },
    });
    expect(angry.list()).toEqual([]);
    expect(angry.read('x')).toBeNull();
    expect(angry.write('t', 'n', 'w')).toBeNull();
    expect(angry.remove('x')).toBe(false);
  });
});
