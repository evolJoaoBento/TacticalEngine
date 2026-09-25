/**
 * A feature's plain numbers (`features.ts`): read clause by clause into the modifiers and trait
 * changes a sheet folds in, and nothing read from a clause that says something else. What they do
 * to a sheet worn in play is `game/gear.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { EQUIPMENT } from './catalogue';
import { gearEffects } from './features';

const featureOf = (id: string) => [...EQUIPMENT.weapons, ...EQUIPMENT.armors].find((def) => def.id === id)!.features;
const stats = (id: string) => gearEffects(featureOf(id)).modifiers.map((m) => [m.stat, m.bonus]);

describe('a feature read for its numbers', () => {
  it('reads each plain clause, signed, whichever minus the card was printed with', () => {
    expect(stats('primary-broadsword')).toEqual([['attackRoll', 1]]);
    expect(stats('secondary-round-shield')).toEqual([['armorScore', 1]]);
    expect(stats('armor-chainmail-armor')).toEqual([['evasion', -1]]);
    expect(stats('armor-gambeson-armor')).toEqual([['evasion', 1]]);
    expect(gearEffects([{ name: 'Barrier', text: '+2 to Armor Score; −1 to Evasion.' }]).modifiers.map((m) => [m.stat, m.bonus])).toEqual([['armorScore', 2], ['evasion', -1]]);
    expect(gearEffects([{ name: 'Cumbersome', text: '-1 to Finesse.' }]).traits).toEqual({ finesse: -1 });
    const gilded = gearEffects([{ name: 'All', text: '+1 to all character traits and Evasion.' }]);
    expect(gilded.traits).toEqual({ agility: 1, strength: 1, finesse: 1, instinct: 1, presence: 1, knowledge: 1 });
    expect(gilded.modifiers.map((m) => [m.stat, m.bonus])).toEqual([['evasion', 1]]);
  });

  it('keeps the number of a feature that says more, and leaves the rest as words', () => {
    const massive = gearEffects([{ name: 'Massive', text: '−1 to Evasion; on a successful attack, roll an additional damage die and discard the lowest result.' }]);
    expect(massive.modifiers.map((m) => [m.stat, m.bonus])).toEqual([['evasion', -1]]);
    expect(gearEffects([{ name: 'Quick', text: 'When you make an attack, you can mark a Stress to target another creature within range.' }])).toEqual({ modifiers: [], traits: {} });
  });
});
