import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { attackProfile } from '../engine/character/sheet';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { startEncounter } from './movement';
import { equipItem, gearOf } from './equip';
import { loadGameText, saveGame } from './save';

/**
 * Changing what a character wields and wears.
 *
 * The rule under test is that the sheet, the derived numbers, the live pools
 * and the pack all move together — a swap that changed one and not the others
 * is the kind of bug a player finds three fights later.
 */

const scene = (seed = 'demo'): DemoScene => buildDemoScene(demoMap(), seed);

describe('equipping', () => {
  it('starts with the sheet\'s own gear, by name', () => {
    expect(gearOf(scene(), 'kara')).toEqual({ weapon: 'Longsword', armor: 'Ringmail' });
  });

  it('refuses what the party is not carrying', () => {
    const result = equipItem(scene(), 'kara', 'hunting-bow');
    expect(result.ok).toBe(false);
  });

  it('swaps a weapon, and the swing changes', () => {
    const demo = scene();
    demo.world.addItem('hunting-bow', 1);
    const before = attackProfile(demo.characters.get('kara')!).name;
    expect(equipItem(demo, 'kara', 'hunting-bow')).toEqual({ ok: true, slot: 'primary' });
    expect(gearOf(demo, 'kara').weapon).toBe('Hunting Bow');
    expect(attackProfile(demo.characters.get('kara')!).name).toBe('Hunting Bow');
    expect(attackProfile(demo.characters.get('kara')!).name).not.toBe(before);
    expect(demo.sheets.get('kara')!.primaryWeaponId).toBe('hunting-bow');
  });

  it('takes the piece out of the pack and puts the old one in', () => {
    const demo = scene();
    demo.world.addItem('hunting-bow', 1);
    equipItem(demo, 'kara', 'hunting-bow');
    expect(demo.scenario.items.get('hunting-bow') ?? 0).toBe(0);
    expect(demo.scenario.items.get('longsword')).toBe(1);
    // And back again.
    equipItem(demo, 'kara', 'longsword');
    expect(demo.scenario.items.get('hunting-bow')).toBe(1);
    expect(gearOf(demo, 'kara').weapon).toBe('Longsword');
  });

  it('puts a shield in the secondary slot without touching the sword', () => {
    const demo = scene();
    demo.world.addItem('round-shield', 1);
    expect(equipItem(demo, 'kara', 'round-shield')).toEqual({ ok: true, slot: 'secondary' });
    expect(demo.sheets.get('kara')!.secondaryWeaponId).toBe('round-shield');
    expect(demo.sheets.get('kara')!.primaryWeaponId).toBe('longsword');
  });

  it('changes armor and the Armor Slots follow, keeping what was marked', () => {
    const demo = scene();
    const finn = demo.state.entity('finn')!;
    finn.armorSlots.marked = 1;
    const before = finn.armorSlots.max;
    demo.world.addItem('ringmail', 1);
    expect(equipItem(demo, 'finn', 'ringmail')).toEqual({ ok: true, slot: 'armor' });
    expect(gearOf(demo, 'finn').armor).toBe('Ringmail');
    expect(finn.armorSlots.max).toBe(demo.characters.get('finn')!.armorScore);
    expect(finn.armorSlots.max).toBeGreaterThan(before);
    expect(finn.armorSlots.marked).toBe(1);
    expect(demo.characters.get('finn')!.thresholds.major).toBeGreaterThan(0);
  });

  it('will not change armor in a fight, but will swap a weapon', () => {
    const demo = scene();
    demo.world.addItem('padded-coat', 1);
    demo.world.addItem('hunting-bow', 1);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    expect(equipItem(demo, 'kara', 'padded-coat').ok).toBe(false);
    expect(equipItem(demo, 'kara', 'hunting-bow').ok).toBe(true);
  });

  it('refuses to equip what is already in hand, and keeps the pack whole', () => {
    // Without this the piece left the pack and nothing came back.
    const demo = scene();
    demo.world.addItem('longsword', 1);
    const result = equipItem(demo, 'kara', 'longsword');
    expect(result.ok).toBe(false);
    expect(demo.scenario.items.get('longsword')).toBe(1);
    demo.world.addItem('ringmail', 1);
    expect(equipItem(demo, 'kara', 'ringmail').ok).toBe(false);
    expect(demo.scenario.items.get('ringmail')).toBe(1);
  });

  it('refuses a trinket', () => {
    const demo = scene();
    demo.world.addItem('husk-carapace', 1);
    expect(equipItem(demo, 'kara', 'husk-carapace').ok).toBe(false);
  });

  it('rides in the save', () => {
    const demo = scene();
    demo.world.addItem('hunting-bow', 1);
    equipItem(demo, 'kara', 'hunting-bow');
    const fresh = scene();
    expect(loadGameText(fresh, JSON.stringify(saveGame(demo))).ok).toBe(true);
    expect(gearOf(fresh, 'kara').weapon).toBe('Hunting Bow');
    expect(fresh.scenario.items.get('longsword')).toBe(1);
  });
});
