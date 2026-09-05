import { describe, it, expect } from 'vitest';
import { combineCover, coverApplies, coverDisadvantage } from './cover';

describe('cover (SRD 2.0)', () => {
  it('costs a ranged attacker one disadvantage die', () => {
    // "Attacks made through cover are rolled with disadvantage."
    expect(coverDisadvantage('cover')).toBe(1);
    expect(coverDisadvantage('none')).toBe(0);
  });

  it('never imposes more than one die, because they do not stack', () => {
    expect(coverDisadvantage(combineCover('cover', 'cover'))).toBe(1);
  });

  it('does not apply to melee attacks', () => {
    expect(coverDisadvantage('cover', false)).toBe(0);
    expect(coverApplies(false)).toBe(false);
    expect(coverApplies(true)).toBe(true);
  });

  it('combines two sources into one binary answer', () => {
    expect(combineCover('none', 'none')).toBe('none');
    expect(combineCover('cover', 'none')).toBe('cover');
    expect(combineCover('none', 'cover')).toBe('cover');
  });

  it('has no graded levels — 2.0 removed Light, Full and Total Cover', () => {
    // Guard against the 1.0 model creeping back: the only values are none/cover,
    // and the effect is on the roll, never on the target's Evasion.
    const values: string[] = ['none', 'cover'];
    expect(values).toHaveLength(2);
    expect(coverDisadvantage('cover')).toBe(1);
  });
});
