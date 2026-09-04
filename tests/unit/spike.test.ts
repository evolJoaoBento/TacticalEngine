import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';

describe('toolchain spike', () => {
  it('resolves three.js as ESM under vitest', () => {
    const v = new Vector3(1, 2, 2);
    expect(v.length()).toBe(3);
  });
});
