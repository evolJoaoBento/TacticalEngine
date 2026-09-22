/**
 * A save made before the room grew, loaded after: the file says which room its tiles were
 * counted in, so everybody comes back to the same places and not to the same numbers.
 */

import { describe, expect, it } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { EditorController } from '../editor/controller';
import { EditorSession } from '../editor/session';
import { buildDemoScene } from './demo-scene';
import { loadGameText, serialiseSave } from './save';

describe('a save from before the room grew', () => {
  it('puts everybody back where they stood, under the numbers those places have now', () => {
    const demo = buildDemoScene(hollowVaultMap(), 'grow-save');
    demo.state.placeEntity('kara', 4.3, 6.2);
    const text = serialiseSave(demo)!;
    expect(JSON.parse(text).scenes[demo.scene.id].room).toEqual({ width: demo.grid.width, x: 0, y: 0 });
    const stood = Object.fromEntries(demo.party.members().map((id) => [id, { ...demo.state.entity(id)!.at }]));

    // The designer lays a platform three tiles past the west edge and one past the north, and then the save is loaded.
    const editor = new EditorController({ session: new EditorSession(demo.project), sceneId: demo.scene.id });
    editor.setTool('placeTile');
    editor.set('tileId', 'platform');
    editor.begin({ x: -3, y: -1 });
    editor.end();
    expect(demo.project.scenes.find((scene) => scene.id === demo.scene.id)!.origin).toEqual({ x: 3, y: 1 });

    expect(loadGameText(demo, text)).toEqual({ ok: true });
    expect(demo.grid.origin).toEqual({ x: 3, y: 1 });
    for (const id of demo.party.members()) {
      const entity = demo.state.entity(id)!;
      expect(entity.at).toEqual({ x: stood[id]!.x + 3, y: stood[id]!.y + 1 });
      expect(entity.tile).toBe(demo.grid.tileAtSpot(entity.at.x, entity.at.y));
    }
  });
});
