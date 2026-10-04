import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { gearCard, gearView } from './gear';
import { characterContentFor } from './room';

/**
 * The gear pages' side of equipping (`gear.ts`, `equip.ts`): the catalogue's cards worn like any
 * other gear, hands counted, a piece taken off back into the pack, and every carried thing read as
 * a card - numbers and all, whether or not the catalogue has a picture for it.
 */

const scene = (): DemoScene => buildDemoScene(hollowVaultMap(), 'gear');

describe('the gear pages', () => {
  it('show what is worn in each place, and the pack in the order it was filled', () => {
    const demo = scene();
    demo.world.addItem('consumable-minor-health-potion', 2);
    demo.world.addItem('primary-broadsword', 1);
    const view = gearView(demo, 'kara');
    expect(view.slots.map((slot) => [slot.slot, slot.label, slot.card?.name ?? null])).toEqual([
      ['primary', 'Primary weapon', 'Longsword'],
      ['secondary', 'Secondary weapon', null],
      ['armor', 'Armor', 'Ringmail'],
    ]);
    const potion = view.carried.find((card) => card.id === 'consumable-minor-health-potion')!;
    expect(potion).toMatchObject({ count: 2, banner: 'Consumable', fits: null, card: 'consumable-minor-health-potion.webp' });
    const sword = view.carried.find((card) => card.id === 'primary-broadsword')!;
    expect(sword).toMatchObject({ count: 1, worth: 10, fits: 'primary', feature: { name: 'Reliable', text: '+1 to attack rolls.' } });
    expect(view.carried.indexOf(potion)).toBeLessThan(view.carried.indexOf(sword));
  });

  it('draw a card from its numbers when there is no picture: the starter longsword and ringmail', () => {
    const demo = scene();
    expect(gearCard(demo, 'longsword')).toMatchObject({
      name: 'Longsword', banner: 'Weapon', fits: 'primary',
      stats: [{ text: 'Strength' }, { text: 'Melee' }, { text: 'd8+1', caption: 'PHY' }, { text: 'One-Handed' }],
    });
    expect(gearCard(demo, 'longsword')!.card).toBeUndefined();
    expect(gearCard(demo, 'ringmail')!.stats).toEqual([
      { text: '7 / 15', caption: 'Thresholds' },
      { text: '4', caption: 'Armor Score' },
      { text: '1', caption: 'Tier' },
    ]);
    expect(gearCard(demo, 'no-such-thing')).toBeNull();
  });
});

describe('the content a project is played with', () => {
  it('is merged once and kept, and merged again the moment one of its lists is edited in place', () => {
    const demo = scene();
    const first = characterContentFor(demo.project);
    expect(characterContentFor(demo.project)).toBe(first);
    expect(first.weapons.get('primary-broadsword')?.name).toBe('Broadsword');
    const bow = demo.project.weapons[0]!;
    demo.project.weapons[0] = { ...bow, name: 'Renamed' };
    const second = characterContentFor(demo.project);
    expect(second).not.toBe(first);
    expect(second.weapons.get(bow.id)!.name).toBe('Renamed');
    demo.project.weapons.push({ ...bow, id: 'another' });
    expect(characterContentFor(demo.project).weapons.has('another')).toBe(true);
  });
});
