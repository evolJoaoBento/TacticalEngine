/**
 * The equipment catalogue (`catalogue.ts`): every card read back through the engine's own schemas,
 * a weapon and a suit of armour each an item pointing at its definition, and a project's own item
 * laid over the catalogue's.
 */

import { describe, it, expect } from 'vitest';
import { itemSchema } from '../items';
import { EQUIPMENT, itemOf, itemsFor } from './catalogue';

describe('the equipment catalogue', () => {
  it('holds every card, weapons and armour as items that point at what a sheet wields', () => {
    expect(EQUIPMENT.weapons.length).toBe(324);
    expect(EQUIPMENT.armors.length).toBe(69);
    expect(EQUIPMENT.items.length).toBe(633);
    const weapons = new Set(EQUIPMENT.weapons.map((weapon) => weapon.id));
    const armors = new Set(EQUIPMENT.armors.map((armor) => armor.id));
    for (const item of EQUIPMENT.items) {
      if (item.kind === 'weapon') expect(weapons.has(item.contentId!), item.id).toBe(true);
      else if (item.kind === 'armor') expect(armors.has(item.contentId!), item.id).toBe(true);
      else expect(item.contentId, item.id).toBeUndefined();
      expect(item.value, item.id).toBeGreaterThan(0);
      expect(item.card, item.id).toBe(`${item.id}.webp`);
    }
    expect(new Set(EQUIPMENT.items.map((item) => item.id)).size).toBe(633);
  });

  it('reads a card the way it is printed', () => {
    const longsword = EQUIPMENT.weapons.find((weapon) => weapon.id === 'primary-longsword')!;
    expect(longsword).toMatchObject({
      name: 'Longsword', tier: 1, slot: 'primaryPhysical', trait: 'agility', range: 'melee',
      damage: { count: 1, sides: 10, modifier: 3, types: ['physical'] }, burden: 'twoHanded',
    });
    expect(EQUIPMENT.weapons.find((weapon) => weapon.id === 'primary-broadsword')!.features).toEqual([{ name: 'Reliable', text: '+1 to attack rolls.' }]);
    expect(EQUIPMENT.weapons.find((weapon) => weapon.id === 'secondary-round-shield')!.slot).toBe('secondary');
    expect(EQUIPMENT.armors.find((armor) => armor.id === 'armor-leather-armor')).toMatchObject({ baseThresholds: { major: 6, severe: 13 }, baseScore: 3 });
    // A wheelchair's arcane frame swings with whatever its wielder casts with.
    expect(EQUIPMENT.weapons.find((weapon) => weapon.id === 'primary-arcane-frame-wheelchair')!.trait).toBe('spellcast');
    expect(itemOf({ items: [] }, 'consumable-minor-health-potion')).toMatchObject({ kind: 'consumable', stackable: true });
  });

  it('lets a project replace one of its items, and keeps the rest', () => {
    const own = itemSchema.parse({ id: 'primary-longsword', name: 'Grandfather\u2019s blade', kind: 'weapon', contentId: 'primary-longsword' });
    expect(itemOf({ items: [own] }, 'primary-longsword')!.name).toBe('Grandfather\u2019s blade');
    const all = itemsFor({ items: [own] });
    expect(all.length).toBe(633);
    expect(all[0]).toBe(own);
    expect(itemsFor({ items: [] })).toBe(EQUIPMENT.items);
  });
});
