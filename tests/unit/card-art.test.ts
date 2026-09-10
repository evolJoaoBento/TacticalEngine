import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SRD_CHARACTERS } from '../../src/game/demo-scene';

describe('local domain card illustrations', () => {
  it('has a real JPEG and a source record for every normalized card id', () => {
    const sources = JSON.parse(readFileSync('public/cards/sources.json', 'utf8'));
    expect(Object.keys(sources)).toHaveLength(SRD_CHARACTERS.domainCards.size);
    for (const card of SRD_CHARACTERS.domainCards.values()) {
      expect(sources[card.id]?.file, card.name).toBe(`/cards/${card.id}.jpg`);
      const bytes = readFileSync(`public/cards/${card.id}.jpg`);
      expect([...bytes.subarray(0, 3)], card.name).toEqual([255, 216, 255]);
    }
  });
});
