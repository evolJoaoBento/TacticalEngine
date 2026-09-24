/**
 * What a saved project carries of the models it declares: every file-backed one, every embedded one
 * something names, and no embedded one nothing names - which the browser still remembers
 * (`model-memory.ts`) and lays back under the project the next time it opens.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { withoutUnusedEmbedded } from './asset-edits';

const EMBEDDED = 'data:application/octet-stream;base64,AAAA';

function project() {
  return projectSchema.parse({
    id: 'p',
    name: 'P',
    scenes: [sceneSchema.parse({ ...blankScene('hall', 4, 4), decos: [{ model: 'placed', position: { x: 1, y: 1 }, rotation: 0 }] })],
    startScene: 'hall',
    assets: [
      { id: 'placed', url: EMBEDDED },
      { id: 'forgotten', url: EMBEDDED },
      { id: 'shipped', url: '/models/shipped.glb' },
      { id: 'quim', url: EMBEDDED },
    ],
  });
}

describe('a saved project', () => {
  it('leaves out an embedded model nothing names, and keeps every other', () => {
    const saved = withoutUnusedEmbedded(project(), ['quim']);
    // Placed, shipped as a file, or named by the game's own table of models.
    expect(saved.assets.map((a) => a.id)).toEqual(['placed', 'shipped', 'quim']);
  });

  it('leaves the project being edited as it was: the editor still offers what the file leaves out', () => {
    const open = project();
    withoutUnusedEmbedded(open);
    expect(open.assets.map((a) => a.id)).toEqual(['placed', 'forgotten', 'shipped', 'quim']);
  });

  it('writes the project unchanged when every embedded model is in use', () => {
    const open = project();
    open.assets = open.assets.filter((a) => a.id === 'placed' || a.id === 'shipped');
    expect(withoutUnusedEmbedded(open)).toBe(open);
  });
});
