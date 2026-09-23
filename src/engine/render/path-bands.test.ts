/**
 * The walk line's colours.
 *
 * What is being pinned is the thing a player is actually reading off the line: the colour changes
 * where the rules say the distance changes, and it changes along the *line walked*, not along the
 * gap between its ends. A path round a corner has to break colour later than a straight one to the
 * same place, because the walk costs what the line costs.
 */

import { describe, it, expect } from 'vitest';
import { Color } from 'three';
import { BAND_COLOURS, bandAt, bandEdges, bandedLine, rgbOf } from './path-bands';

const hex = (point: { r: number; g: number; b: number }): string =>
  new Color(point.r, point.g, point.b).getHexString();
const of = (colour: string): string => new Color(colour).getHexString();

describe('the bands a distance falls in', () => {
  it('steps at the rules own distances and runs out past the last of them', () => {
    // The SRD's table at the SRD's scale: Melee 1, Very Close 2, Close 6, Far 20, Very Far 60.
    expect(bandEdges()).toEqual([1, 2, 6, 20, 60]);
    expect(bandAt(0)).toBe('melee');
    expect(bandAt(1)).toBe('melee');
    expect(bandAt(1.01)).toBe('veryClose');
    expect(bandAt(2)).toBe('veryClose');
    expect(bandAt(5.9)).toBe('close');
    expect(bandAt(6.1)).toBe('far');
    expect(bandAt(20.1)).toBe('veryFar');
    expect(bandAt(61)).toBe('outOfRange');
  });

  it('honours a project that measures range its own way', () => {
    // Very Close reaches 3 here and 2 by the SRD's table, so 2.5 tiles is a different band
    // depending on whose scale the project is drawn to.
    const tight = { melee: 1, veryClose: 3, close: 5, far: 9, veryFar: 14 };
    expect(bandAt(2.5, tight)).toBe('veryClose');
    expect(bandAt(2.5)).toBe('close');
  });

  it('hands a colour over the way three would read it, not as raw sRGB', () => {
    // A buffer filled with the hex read apart draws washed out: three keeps colour linear.
    const colour = new Color('#8ef0c4');
    expect(rgbOf('#8ef0c4')).toEqual({ r: colour.r, g: colour.g, b: colour.b });
    expect(rgbOf('#8ef0c4').r).not.toBeCloseTo(0x8e / 255, 3);
  });
});

describe('a line cut into bands', () => {
  it('changes colour where the distance does, measured along the walk', () => {
    const { points, walked } = bandedLine([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
    expect(walked).toBeCloseTo(4, 9);
    // Cut every half tile from the start: 0, 0.5, 1 ... 4.
    expect(points.length).toBe(9);
    const at = (tiles: number) => hex(points[Math.round(tiles / 0.5)]!);
    expect(at(0)).toBe(of(BAND_COLOURS.melee));
    expect(at(1)).toBe(of(BAND_COLOURS.melee));
    expect(at(1.5)).toBe(of(BAND_COLOURS.veryClose));
    expect(at(2)).toBe(of(BAND_COLOURS.veryClose));
    expect(at(2.5)).toBe(of(BAND_COLOURS.close));
    expect(at(4)).toBe(of(BAND_COLOURS.close));
  });

  it('counts the way round a corner, so the same destination breaks colour later', () => {
    // Two tiles east then two north: the ends are 2.83 apart, the walk is 4 long. The point at
    // the corner is 2 tiles into the walk and Very Close; as the crow flies it would be Close.
    const bent = bandedLine([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]);
    expect(bent.walked).toBeCloseTo(4, 9);
    expect(hex(bent.points[4]!)).toBe(of(BAND_COLOURS.veryClose));
    expect(Math.hypot(2, 2)).toBeGreaterThan(2);
  });

  it('carries the count into a second line rather than starting the bands again', () => {
    // The part past one move continues the walk; its distance is not measured from its own start.
    const walk = bandedLine([{ x: 0, y: 0 }, { x: 3, y: 0 }]);
    const on = bandedLine([{ x: 3, y: 0 }, { x: 4, y: 0 }], { from: walk.walked, skipFirst: true });
    expect(on.walked).toBeCloseTo(4, 9);
    // Skipping the first keeps the join from being drawn twice.
    expect(on.points[0]!.spot.x).toBeCloseTo(3.5, 9);
    expect(hex(on.points[0]!)).toBe(of(BAND_COLOURS.close));
  });

  it('takes a colour that overrides the bands, for a line that means something else', () => {
    // Amber is not a distance. It says an Agility Roll stands between them and the spot.
    const { points } = bandedLine([{ x: 0, y: 0 }, { x: 9, y: 0 }], { colour: '#ffc14d' });
    expect(new Set(points.map(hex)).size).toBe(1);
    expect(hex(points[0]!)).toBe(of('#ffc14d'));
  });

  it('draws nothing for a line of one point or none', () => {
    expect(bandedLine([]).points).toEqual([]);
    expect(bandedLine([{ x: 1, y: 1 }]).points).toEqual([]);
  });
});
