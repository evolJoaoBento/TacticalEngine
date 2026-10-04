import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { PILLAR_DIALOGUE_ID } from './demo-dialogue';

const scene = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

describe('the pillar conversation', () => {
  it('ships as document data, not as engine code', () => {
    const demo = scene();
    // It parsed through `dialogueSchema`, so a project file could hold it.
    expect(demo.dialogues.get(PILLAR_DIALOGUE_ID)?.nodes.length).toBeGreaterThan(3);
  });
});
