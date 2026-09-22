import { describe, it, expect } from 'vitest';
import { DEFAULT_JUMP_RULES, arcHeight, arcLift, jumpRange, jumpReach, jumpRulesSchema, leapTerms, safeDrop } from './jump';

const traits = (over: Partial<Record<'agility' | 'strength' | 'finesse' | 'instinct' | 'presence' | 'knowledge', number>> = {}) => ({
  agility: 0,
  strength: 0,
  finesse: 0,
  instinct: 0,
  presence: 0,
  knowledge: 0,
  ...over,
});

describe('the jump rules a project has said nothing about', () => {
  const rules = DEFAULT_JUMP_RULES;

  it('reach a block at Strength 0 or less, and one more for each point above', () => {
    expect([-2, -1, 0, 1, 2, 3].map((strength) => jumpReach(rules, traits({ strength })))).toEqual([1, 1, 1, 2, 3, 4]);
    expect([-1, 0, 1, 2].map((agility) => safeDrop(rules, traits({ agility })))).toEqual([1, 1, 2, 3]);
  });

  it('ask for an Agility Roll at 12 going up, and refuse past what Strength reaches', () => {
    expect(rules).toMatchObject({ rollTrait: 'agility', difficulty: 12, stepHeight: 0.72, failCondition: 'prone' });
    expect(leapTerms(rules, 1, traits())).toEqual({ difficulty: 12, fallDice: 0 });
    expect(leapTerms(rules, 3, traits({ strength: 2 }))).toEqual({ difficulty: 12, fallDice: 0 });
    expect(leapTerms(rules, 1.25, traits())).toBeNull();
    expect(leapTerms(rules, 3.25, traits({ strength: 2 }))).toBeNull();
  });

  it('ask nothing of a drop the legs take', () => {
    expect(leapTerms(rules, -1, traits())).toEqual({ difficulty: null, fallDice: 0 });
    expect(leapTerms(rules, -3, traits({ agility: 2 }))).toEqual({ difficulty: null, fallDice: 0 });
  });

  it('roll one harder for every two blocks past safe, with a die for each of them', () => {
    expect(leapTerms(rules, -2, traits())).toEqual({ difficulty: 12, fallDice: 1 });
    expect(leapTerms(rules, -3, traits())).toEqual({ difficulty: 13, fallDice: 2 });
    expect(leapTerms(rules, -5, traits())).toEqual({ difficulty: 14, fallDice: 4 });
    expect(leapTerms(rules, -5, traits({ agility: 2 }))).toEqual({ difficulty: 13, fallDice: 2 });
  });
});

describe('the jump rules a project writes down', () => {
  it('carry a jump on any trait, from any base, by any step', () => {
    const rules = jumpRulesSchema.parse({ reachTrait: 'finesse', reachBase: 2, reachPerPoint: 0.5, dropTrait: 'instinct', dropBase: 0, dropPerPoint: 2 });
    expect(jumpReach(rules, traits({ finesse: 3, strength: 9 }))).toBe(3.5);
    expect(safeDrop(rules, traits({ instinct: 2, agility: 9 }))).toBe(4);
    expect(leapTerms(rules, 3.5, traits({ finesse: 3 }))).not.toBeNull();
    expect(leapTerms(rules, 3.75, traits({ finesse: 3 }))).toBeNull();
  });

  it('set the Difficulty, how fast a fall gets harder, and whether it hurts', () => {
    const rules = jumpRulesSchema.parse({ difficulty: 15, harderEvery: 1, fallDie: 0 });
    expect(leapTerms(rules, 1, traits())).toEqual({ difficulty: 15, fallDice: 0 });
    expect(leapTerms(rules, -4, traits())).toEqual({ difficulty: 18, fallDice: 0 });
    const flat = jumpRulesSchema.parse({ harderEvery: 0 });
    expect(leapTerms(flat, -9, traits())).toEqual({ difficulty: 12, fallDice: 8 });
  });

  it('turn jumping off altogether', () => {
    const rules = jumpRulesSchema.parse({ enabled: false });
    expect(leapTerms(rules, 1, traits({ strength: 5 }))).toBeNull();
    expect(leapTerms(rules, -1, traits())).toBeNull();
  });

  it('refuse a rule that is not one', () => {
    expect(jumpRulesSchema.safeParse({ reachTrait: 'luck' }).success).toBe(false);
    expect(jumpRulesSchema.safeParse({ difficulty: 0 }).success).toBe(false);
    expect(jumpRulesSchema.safeParse({ stepHeight: -1 }).success).toBe(false);
  });
});

describe('a jump as a trajectory', () => {
  it('carries three tiles at Strength 0 or less, and one more for each point above', () => {
    expect([-1, 0, 1, 2].map((strength) => jumpRange(DEFAULT_JUMP_RULES, traits({ strength })))).toEqual([3, 3, 4, 5]);
    const long = jumpRulesSchema.parse({ reachTrait: 'agility', rangeBase: 1.5, rangePerPoint: 2 });
    expect(jumpRange(long, traits({ agility: 2, strength: 9 }))).toBe(5.5);
  });

  it('asks nothing of a jump across level ground, unless the project says it does', () => {
    expect(leapTerms(DEFAULT_JUMP_RULES, 0, traits())).toEqual({ difficulty: null, fallDice: 0 });
    expect(leapTerms(DEFAULT_JUMP_RULES, 0.5, traits())).toEqual({ difficulty: null, fallDice: 0 });
    expect(leapTerms(jumpRulesSchema.parse({ flatRoll: true, difficulty: 14 }), -0.25, traits())).toEqual({ difficulty: 14, fallDice: 0 });
  });

  it('arcs three quarters of a block over a hop and higher over a long jump, ending where it is going', () => {
    expect(arcLift(1)).toBe(0.75);
    expect(arcLift(5)).toBeCloseTo(1.75, 6);
    // Between heights it goes up half the difference again, to clear the lip of the ledge.
    expect(arcLift(1, 2)).toBe(1.75);
    expect(arcLift(1, -2)).toBe(1.75);
    expect(arcHeight(0.25, 1.25, 1, 0)).toBe(0.25);
    expect(arcHeight(0.25, 1.25, 1, 1)).toBe(1.25);
    expect(arcHeight(0, 0, 1, 0.5)).toBe(1);
    expect(arcHeight(0, 2, 1, 0.5)).toBe(2);
  });
});
