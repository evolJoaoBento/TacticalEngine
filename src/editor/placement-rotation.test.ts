import { describe, expect, it } from 'vitest';
import { placementRotation } from './placement-rotation';

describe('Alt placement rotation', () => {
  it('ignores movement below the drag threshold', () => {
    expect(placementRotation(2, 100, 0, 11)).toBe(2);
  });

  it('points to the dominant cardinal direction on the build plane', () => {
    expect(placementRotation(2, 1, -4, 20)).toBe(0); // north
    expect(placementRotation(2, -4, 1, 20)).toBe(1); // west
    expect(placementRotation(0, -1, 4, 20)).toBe(2); // south
    expect(placementRotation(0, 4, -1, 20)).toBe(3); // east
  });

  it('keeps the previous facing if the pointer returns to the origin', () => {
    expect(placementRotation(1, 0, 0, 0)).toBe(1);
  });
});
