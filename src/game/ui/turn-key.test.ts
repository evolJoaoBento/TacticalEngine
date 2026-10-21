import { describe, expect, it } from 'vitest';
import { turnKey } from './turn-key';

describe("the turn's key in a fight", () => {
  it("hands the party's spotlight over, asked something or not", () => {
    for (const asked of [false, true]) expect(turnKey('party', asked)).toEqual({ label: 'End Turn', title: 'Hand the spotlight to the GM (Space)', enabled: true });
  });

  it("plays the GM's turn a roll handed over, once nothing is asked", () => {
    expect(turnKey('gm', false)).toEqual({ label: "GM's Turn", title: 'Let the GM take the spotlight (Space)', enabled: true });
  });

  it("is shut while the GM's turn waits on somebody's answer", () => {
    expect(turnKey('gm', true).enabled).toBe(false);
    expect(turnKey('gm', true).label).toBe("GM's Turn");
  });

  it('is shut with no side to hand over from', () => {
    expect(turnKey(null, false).enabled).toBe(false);
  });
});
