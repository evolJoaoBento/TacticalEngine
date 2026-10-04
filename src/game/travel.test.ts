import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { PIT_SCENE_ID } from './demo-scenes';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

describe('travelling between scenes', () => {
  it('ships two scenes in one project', () => {
    const demo = scene();
    expect(demo.project.scenes.map((s) => s.id)).toContain(PIT_SCENE_ID);
    expect(demo.project.scenes.length).toBe(2);
  });
});
