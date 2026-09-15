import { describe, it, expect } from 'vitest';
import { ModelRegistry } from './procedural/registry';
import { ModelThumbnails } from './thumbnails';

/**
 * The drawing needs WebGL, which the browser suite exercises; what is decided here is which model a
 * picture is of, and that asking for one never throws or touches the models diagnostic.
 */
describe('model thumbnails', () => {
  it('draws the model asked for, the stand-in when there is none, and nothing when neither exists', () => {
    const thumbnails = new ModelThumbnails(new ModelRegistry());
    expect(thumbnails.pick('husk')).toBe('husk');
    // A creature with no model of its own is pictured as the body the board stands in for it.
    expect(thumbnails.pick('bandit-archer', 'husk')).toBe('husk');
    expect(thumbnails.pick('bandit-archer')).toBeNull();
    expect(thumbnails.pick('nonesuch', 'also-none')).toBeNull();
  });

  it('gives no picture rather than throwing where there is no WebGL, and records no missing model', () => {
    const registry = new ModelRegistry();
    const thumbnails = new ModelThumbnails(registry);
    expect(thumbnails.url('husk')).toBeNull();
    expect(thumbnails.url('bandit-archer', 'husk')).toBeNull();
    // Asking for a picture is not content asking for a model: `missing()` still names only those.
    expect(registry.missing()).toEqual([]);
  });
});
