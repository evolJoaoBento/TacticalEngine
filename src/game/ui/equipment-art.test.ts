import { describe, it, expect } from 'vitest';
import { equipmentArt } from './equipment-art';

describe('an equipment card\u2019s picture', () => {
  it('is a URL only for a file the lock names', () => {
    expect(equipmentArt('primary-longsword.webp')).toBe('/equipment/primary-longsword.webp');
    expect(equipmentArt('no-such-card.webp')).toBeNull();
    expect(equipmentArt(undefined)).toBeNull();
  });
});
