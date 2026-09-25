import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { attackProfile } from '../engine/character/sheet';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { startEncounter } from './movement';
import { equipItem, gearOf, unequipItem } from './equip';
import { gearCard, gearView } from './gear';
import { characterContentFor } from './room';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';

/**
 * The gear pages' side of equipping (`gear.ts`, `equip.ts`): the catalogue's cards worn like any
 * other gear, hands counted, a piece taken off back into the pack, and every carried thing read as
 * a card - numbers and all, whether or not the catalogue has a picture for it.
 */

const scene = (): DemoScene => buildDemoScene(hollowVaultMap(), 'gear');
const carried = (demo: DemoScene): string[] => [...demo.scenario.items].filter(([, n]) => n > 0).map(([id]) => id);

describe('a catalogue card worn', () => {
  it('is wielded the way its card says', () => {
    const demo = scene();
    demo.world.addItem('primary-broadsword', 1);
    expect(equipItem(demo, 'kara', 'primary-broadsword')).toEqual({ ok: true, slot: 'primary' });
    const swing = attackProfile(demo.characters.get('kara')!);
    expect(swing).toMatchObject({ name: 'Broadsword', trait: 'agility', range: 'melee' });
    expect(swing.damage).toMatchObject({ count: 1, sides: 8, modifier: 0 });
    // Her old longsword is back in the pack, where the drawn card will show it.
    expect(carried(demo)).toContain('longsword');
  });

  it('counts hands: a two-handed weapon sends the secondary back, and a secondary waits for a free hand', () => {
    const demo = scene();
    for (const id of ['secondary-round-shield', 'primary-longbow']) demo.world.addItem(id, 1);
    expect(equipItem(demo, 'kara', 'secondary-round-shield')).toEqual({ ok: true, slot: 'secondary' });
    expect(equipItem(demo, 'kara', 'primary-longbow')).toEqual({ ok: true, slot: 'primary' });
    expect(demo.sheets.get('kara')!.secondaryWeaponId).toBeUndefined();
    expect(carried(demo)).toContain('secondary-round-shield');
    const refused = equipItem(demo, 'kara', 'secondary-round-shield');
    expect(refused).toEqual({ ok: false, reason: `the Longbow takes both of ${demo.sheets.get('kara')!.name}'s hands` });
    expect(carried(demo)).toContain('secondary-round-shield');
  });
});

describe('taking a piece off', () => {
  it('puts it back in the pack and leaves the place empty', () => {
    const demo = scene();
    const score = demo.characters.get('kara')!.armorScore;
    expect(unequipItem(demo, 'kara', 'armor')).toEqual({ ok: true, slot: 'armor' });
    expect(demo.sheets.get('kara')!.armorId).toBeUndefined();
    expect(gearOf(demo, 'kara').armor).toBe('Unarmored');
    expect(carried(demo)).toContain('ringmail');
    expect(demo.characters.get('kara')!.armorScore).toBeLessThan(score);
    expect(demo.state.entity('kara')!.armorSlots.max).toBe(demo.characters.get('kara')!.armorScore);
    expect(demo.log.at(-1)!.text).toBe(`${demo.sheets.get('kara')!.name} takes off the Ringmail.`);
  });

  it('is refused for an empty place, for armour in a fight, and for a piece nothing in the pack stands for', () => {
    const demo = scene();
    expect(unequipItem(demo, 'kara', 'secondary')).toEqual({ ok: false, reason: `${demo.sheets.get('kara')!.name} has nothing there` });
    const fighting = scene();
    startEncounter(fighting, fighting.scene.encounters[0]!.id);
    expect(unequipItem(fighting, 'kara', 'armor')).toEqual({ ok: false, reason: 'armor cannot be changed in a fight' });
    // A weapon no item stands for would have nowhere to go.
    const odd = scene();
    odd.sheets.set('kara', { ...odd.sheets.get('kara')!, primaryWeaponId: 'hand-cannon' });
    expect(unequipItem(odd, 'kara', 'primary').ok).toBe(false);
  });
});

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

describe('a feature worn', () => {
  it('moves the sheet while the piece is on, and stops when it is changed', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'features');
    const kara = () => demo.characters.get('kara')!;
    const evasion = kara().evasion;
    const finesse = kara().traits.finesse;
    for (const id of ['armor-chainmail-armor', 'primary-broadsword', 'secondary-round-shield', 'primary-halberd']) demo.world.addItem(id, 1);

    equipItem(demo, 'kara', 'armor-chainmail-armor');
    expect(kara().evasion).toBe(evasion - 1);
    // Reliable: every swing is a point steadier, read where the attack reads its bonus.
    expect(demo.world.rollBonus('kara', 'attackRoll', { melee: true })).toBe(0);
    equipItem(demo, 'kara', 'primary-broadsword');
    expect(demo.world.rollBonus('kara', 'attackRoll', { melee: true })).toBe(1);
    const score = kara().armorScore;
    equipItem(demo, 'kara', 'secondary-round-shield');
    expect(kara().armorScore).toBe(score + 1);
    // A halberd is Cumbersome: Finesse falls while it is in hand.
    expect(EQUIPMENT.weapons.find((w) => w.id === 'primary-halberd')!.features).toEqual([{ name: 'Cumbersome', text: '−1 to Finesse.' }]);
    equipItem(demo, 'kara', 'primary-halberd');
    expect(kara().traits.finesse).toBe(finesse - 1);
    expect(demo.world.rollBonus('kara', 'attackRoll', { melee: true })).toBe(0);
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
