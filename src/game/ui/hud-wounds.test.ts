import { describe, expect, it } from 'vitest';
import { markedNow, woundsSince } from './hud-wounds';

const sheet = (id: string, marked: number) => ({ id, hitPoints: { marked } });

describe('who on the sheets has just been hurt', () => {
  it('is whoever has more Hit Points marked than the last time, and by how many', () => {
    const before = markedNow([sheet('kara', 1), sheet('finn', 0), sheet('mira', 2)]);
    const wounds = woundsSince(before, [sheet('kara', 3), sheet('finn', 0), sheet('mira', 2)]);
    expect([...wounds]).toEqual([['kara', 2]]);
  });

  it('is nobody when nothing changed, and nobody for a healing', () => {
    const before = markedNow([sheet('kara', 3), sheet('finn', 1)]);
    expect(woundsSince(before, [sheet('kara', 3), sheet('finn', 1)]).size).toBe(0);
    expect(woundsSince(before, [sheet('kara', 1), sheet('finn', 0)]).size).toBe(0);
  });

  it('does not wound somebody seen for the first time, however hurt they arrive', () => {
    expect(woundsSince(new Map(), [sheet('kara', 4)]).size).toBe(0);
    const before = markedNow([sheet('kara', 0)]);
    expect([...woundsSince(before, [sheet('kara', 1), sheet('tamsin', 5)])]).toEqual([['kara', 1]]);
  });

  it('measures each wound from the last, so two blows are two wounds', () => {
    let before = markedNow([sheet('kara', 0)]);
    const first = [sheet('kara', 1)];
    expect(woundsSince(before, first).get('kara')).toBe(1);
    before = markedNow(first);
    expect(woundsSince(before, [sheet('kara', 4)]).get('kara')).toBe(3);
  });
});
