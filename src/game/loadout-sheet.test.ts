import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { loadoutView } from './demo-abilities';
import { buildDemoScene } from './demo-scene';

/**
 * The numbers on the binder's left leaf. They are read for the player in the middle of a fight, so
 * what matters is that they are the numbers the fight is actually using -- not the ones the sheet
 * was written with.
 */
describe('the sheet beside the cards', () => {
  it('prints the six traits in sheet order, with what the character has grown into', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'sheet');
    const kara = demo.characters.get('kara')!;
    const stats = loadoutView(demo, 'kara').stats!;

    expect(stats.traits.map((t) => t.id)).toEqual(['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge']);
    for (const trait of stats.traits) expect(trait.value).toBe(kara.traits[trait.id]);
    expect(stats.traits.filter((t) => t.spellcast).map((t) => t.id)).toEqual(kara.spellcastTrait === undefined ? [] : [kara.spellcastTrait]);
    expect(stats.level).toBe(kara.sheet.level);
    expect(stats.proficiency).toBe(kara.proficiency);
  });

  it('shows the Evasion and thresholds an attack would be rolled against', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'sheet');
    const kara = demo.characters.get('kara')!;
    const before = loadoutView(demo, 'kara').stats!;
    expect(before.evasion).toBe(kara.evasion);
    expect(before.thresholds).toEqual(kara.thresholds);

    // Somebody's shield is between her and the room: the sheet says so, because the dice will.
    demo.world.applyCondition('kara', 'behind-the-shield', 'scene');
    const after = loadoutView(demo, 'kara').stats!;
    expect(after.evasion).toBe(kara.evasion + 1);
    expect(after.evasion).toBe(demo.world.defenderOf(demo.state.entity('kara')!).difficulty);
  });

  it('has no numbers for somebody who is not a character', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'sheet');
    expect(loadoutView(demo, 'nobody').stats).toBeUndefined();
  });
});
