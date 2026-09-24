import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { updateAsset } from './asset-edits';
import { EditorSession } from './session';

/** The Models panel's "Use the model's own pivot", as an edit (`render/model-pivot.test.ts` has what it draws). */
describe("a model's pivot, edited", () => {
  it('is one undoable edit, and turning it off takes it out of the document', () => {
    const project = projectSchema.parse({
      id: 'p', name: 'P', startScene: 'room',
      scenes: [sceneSchema.parse(blankScene('room', 2, 2))],
      assets: [{ id: 'fox', url: '/fox.glb' }],
    });
    const session = new EditorSession(project);
    session.run(updateAsset('fox', { pivot: 'file' }));
    expect(session.project.assets[0]!.pivot).toBe('file');
    session.run(updateAsset('fox', { pivot: undefined }));
    expect('pivot' in session.project.assets[0]!).toBe(false);
    session.undo();
    expect(session.project.assets[0]!.pivot).toBe('file');
  });
});
