import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { validateProject } from '../editor/validate';
import { buildDemoScene, type DemoScene } from './demo-scene';

/**
 * Using what is carried.
 *
 * A draught is the whole story: it comes out of the pack, it heals whoever
 * drank it, it says so, and in a fight it costs the turn.
 */

const DRAUGHT = 'healing-draught';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

describe('using an item', () => {
  it('ships a draught whose use validates clean', () => {
    const demo = scene();
    expect(demo.project.items.find((i) => i.id === DRAUGHT)!.use.length).toBeGreaterThan(0);
    expect(validateProject(demo.project).filter((p) => p.entity === DRAUGHT)).toEqual([]);
  });
});
