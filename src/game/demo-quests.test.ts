import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { validateProject } from '../editor/validate';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { WARDENS_WORD_QUEST } from './demo-quests';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

describe('the demo quest', () => {
  it('ships in the project, and validates clean', () => {
    const demo = scene();
    expect(demo.project.quests.map((q) => q.id)).toEqual([WARDENS_WORD_QUEST]);
    expect(validateProject(demo.project).filter((p) => /quest|objective/i.test(p.message))).toEqual([]);
  });
});
