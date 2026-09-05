import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BAND_TILES,
  RANGE_BANDS,
  bandForDistance,
  bandIndex,
  bandLabel,
  maxTilesForBand,
  nearerBand,
  parseRangeBand,
  reaches,
} from './range';

describe('range bands', () => {
  it('lists the SRD six, closest first', () => {
    expect([...RANGE_BANDS]).toEqual([
      'melee',
      'veryClose',
      'close',
      'far',
      'veryFar',
      'outOfRange',
    ]);
    expect(bandIndex('melee')).toBeLessThan(bandIndex('close'));
    expect(bandIndex('far')).toBeLessThan(bandIndex('veryFar'));
  });

  it('treats a stated range as a maximum, reachable from closer in', () => {
    expect(reaches('melee', 'far')).toBe(true);
    expect(reaches('close', 'close')).toBe(true);
    expect(reaches('far', 'close')).toBe(false);
    expect(reaches('outOfRange', 'veryFar')).toBe(false);
  });

  it('picks the nearer of two bands', () => {
    expect(nearerBand('close', 'melee')).toBe('melee');
    expect(nearerBand('far', 'veryFar')).toBe('far');
  });

  it('labels bands the way the SRD spells them', () => {
    expect(bandLabel('veryClose')).toBe('Very Close');
    expect(bandLabel('outOfRange')).toBe('Out of Range');
  });

  it('reads bands out of content text in any casing or spacing', () => {
    expect(parseRangeBand('Very Close')).toBe('veryClose');
    expect(parseRangeBand('very close')).toBe('veryClose');
    expect(parseRangeBand('veryClose')).toBe('veryClose');
    expect(parseRangeBand(' Melee ')).toBe('melee');
    expect(parseRangeBand('very-far')).toBe('veryFar');
    expect(parseRangeBand('point blank')).toBeNull();
    expect(parseRangeBand('')).toBeNull();
  });
});

describe('bandForDistance', () => {
  it('maps tile distances onto bands with the default table', () => {
    expect(bandForDistance(0)).toBe('melee');
    expect(bandForDistance(1)).toBe('melee');
    expect(bandForDistance(2)).toBe('veryClose');
    expect(bandForDistance(6)).toBe('close');
    expect(bandForDistance(7)).toBe('far');
    expect(bandForDistance(20)).toBe('far');
    expect(bandForDistance(60)).toBe('veryFar');
    expect(bandForDistance(61)).toBe('outOfRange');
  });

  it('accepts a project-specific table', () => {
    const tight = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };
    expect(bandForDistance(4, tight)).toBe('close');
    expect(bandForDistance(9, tight)).toBe('veryFar');
    expect(bandForDistance(13, tight)).toBe('outOfRange');
  });

  it('agrees with maxTilesForBand at every boundary', () => {
    for (const band of RANGE_BANDS) {
      if (band === 'outOfRange') continue;
      const max = maxTilesForBand(band);
      expect(bandForDistance(max)).toBe(band);
      expect(bandForDistance(max + 1)).not.toBe(band);
    }
    expect(maxTilesForBand('outOfRange')).toBe(Infinity);
  });

  it('keeps the default table strictly increasing', () => {
    const values = [
      DEFAULT_BAND_TILES.melee,
      DEFAULT_BAND_TILES.veryClose,
      DEFAULT_BAND_TILES.close,
      DEFAULT_BAND_TILES.far,
      DEFAULT_BAND_TILES.veryFar,
    ];
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!);
  });
});
