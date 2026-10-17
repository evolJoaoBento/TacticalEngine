/**
 * What a saved project carries of the models it declares: every file-backed one, every embedded one
 * something names, and no embedded one nothing names - which the browser still remembers
 * (`model-memory.ts`) and lays back under the project the next time it opens. A model from the player's
 * own folder (`game/your-models.ts`) is laid under every project the same way, and left out the same way.
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
      { id: 'golem', url: '/__models/u/bramble/imported/golem.glb' },
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
    expect(open.assets.map((a) => a.id)).toEqual(['placed', 'forgotten', 'shipped', 'quim', 'golem']);
  });

  it('leaves out a model from the player’s own folder nothing names, and keeps one something does', () => {
    const open = project();
    expect(withoutUnusedEmbedded(open).assets.map((a) => a.id)).not.toContain('golem');
    open.scenes[0]!.decos.push({ model: 'golem', position: { x: 2, y: 2 }, rotation: 0 });
    expect(withoutUnusedEmbedded(open).assets.map((a) => a.id)).toContain('golem');
  });

  it('writes the project unchanged when every embedded model is in use', () => {
    const open = project();
    open.assets = open.assets.filter((a) => a.id === 'placed' || a.id === 'shipped');
    expect(withoutUnusedEmbedded(open)).toBe(open);
  });
});
