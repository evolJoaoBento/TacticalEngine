/**
 * The ground a prop covers.
 *
 * Small arithmetic, but three different things read it - the editor's click, the erase, and the
 * drawing - and they have to agree, or a prop is turned by a click that does not select it, or is
 * drawn somewhere other than where it was put. So the rule lives in one place and is pinned here.
 */

import { describe, it, expect } from 'vitest';
import { DECO_SPAN_MAX, decoCentre, decoCovers, decoFootprint, spanOf } from './deco-span';
import { decoSchema } from './schema';

const at = (x: number, y: number, span?: number) => ({ position: { x, y }, ...(span === undefined ? {} : { span }) });

describe('how big a prop is', () => {
  it('is one tile when the document says nothing, which is nearly every prop', () => {
    expect(spanOf({})).toBe(1);
    expect(spanOf({ span: undefined })).toBe(1);
    expect(spanOf({ span: 1 })).toBe(1);
    expect(spanOf({ span: 6 })).toBe(6);
  });

  it('will not be talked into a size the board cannot draw', () => {
    // Nothing should ever hand these over - the schema refuses them - but a document can be
    // written by hand, and a prop drawn at zero or at minus three is a prop nobody can find.
    expect(spanOf({ span: 0 })).toBe(1);
    expect(spanOf({ span: -3 })).toBe(1);
    expect(spanOf({ span: 2.7 })).toBe(2);
    expect(spanOf({ span: 9999 })).toBe(DECO_SPAN_MAX);
    expect(spanOf({ span: Number.NaN })).toBe(1);
  });
});

describe('the block it covers', () => {
  it('runs south and east from the tile it was placed on', () => {
    const boulder = at(4, 4, 3);
    expect(decoCovers(boulder, { x: 4, y: 4 })).toBe(true);
    expect(decoCovers(boulder, { x: 6, y: 6 })).toBe(true);
    expect(decoCovers(boulder, { x: 5, y: 4 })).toBe(true);
    // Not north or west of the anchor, and not one past the far corner.
    expect(decoCovers(boulder, { x: 3, y: 4 })).toBe(false);
    expect(decoCovers(boulder, { x: 4, y: 3 })).toBe(false);
    expect(decoCovers(boulder, { x: 7, y: 6 })).toBe(false);
    expect(decoCovers(boulder, { x: 6, y: 7 })).toBe(false);
  });

  it('is the one tile it stands on when it is an ordinary prop', () => {
    expect(decoCovers(at(2, 2), { x: 2, y: 2 })).toBe(true);
    expect(decoCovers(at(2, 2), { x: 3, y: 2 })).toBe(false);
  });

  it('lists its tiles north-west first, span squared of them', () => {
    expect(decoFootprint(at(1, 1, 2))).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(decoFootprint(at(0, 0, 5)).length).toBe(25);
    expect(decoFootprint(at(9, 9))).toEqual([{ x: 9, y: 9 }]);
  });

  it('has its middle on a tile when the span is odd and on a corner when it is even', () => {
    expect(decoCentre(at(4, 4))).toEqual({ x: 4, y: 4 });
    expect(decoCentre(at(4, 4, 3))).toEqual({ x: 5, y: 5 });
    // A 2x2 has no middle tile: it is centred where its four tiles meet.
    expect(decoCentre(at(4, 4, 2))).toEqual({ x: 4.5, y: 4.5 });
    expect(decoCentre(at(0, 0, 6))).toEqual({ x: 2.5, y: 2.5 });
  });

  it('covers the same ground whichever way it is turned, which is why the block is square', () => {
    // A prop carries a rotation and the block does not turn with it. That is only safe because
    // every block is square: a 2x3 turned a quarter would cover ground the footprint denies.
    const turned = { ...at(3, 3, 4), rotation: Math.PI / 2 };
    for (const tile of decoFootprint(turned)) expect(decoCovers(turned, tile)).toBe(true);
  });
});

describe('what the document will hold', () => {
  it('takes a span from one to the most, and nothing outside that', () => {
    const base = { model: 'crate', position: { x: 1, y: 1 } };
    expect(decoSchema.parse({ ...base }).span).toBeUndefined();
    expect(decoSchema.parse({ ...base, span: 1 }).span).toBe(1);
    expect(decoSchema.parse({ ...base, span: DECO_SPAN_MAX }).span).toBe(DECO_SPAN_MAX);
    expect(decoSchema.safeParse({ ...base, span: 0 }).success).toBe(false);
    expect(decoSchema.safeParse({ ...base, span: DECO_SPAN_MAX + 1 }).success).toBe(false);
    expect(decoSchema.safeParse({ ...base, span: 2.5 }).success).toBe(false);
  });

  it('writes nothing for an ordinary prop, so a room full of them says nothing about size', () => {
    // Deliberately not `.default(1)`: a default would stamp `span: 1` onto every prop in every
    // project on the next save, for a field that means what its absence already meant.
    const parsed = decoSchema.parse({ model: 'crate', position: { x: 1, y: 1 } });
    expect(Object.hasOwn(parsed, 'span')).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain('span');
  });
});
