import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { EditorController, type EditorTool } from './controller';
import { EditorSession } from './session';

function setup(width = 8, height = 6): { session: EditorSession; editor: EditorController; changes: string[] } {
  const project = projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', width, height))],
    startScene: 'room',
  });
  const session = new EditorSession(project);
  const changes: string[] = [];
  const editor = new EditorController({
    session,
    sceneId: 'room',
    onChange: (c) => changes.push(c),
  });
  return { session, editor, changes };
}

/** A press-drag-release across a row. */
function drag(editor: EditorController, y: number, from: number, to: number): void {
  editor.begin({ x: from, y });
  for (let x = from + 1; x <= to; x++) editor.paint({ x, y });
  editor.end();
}

describe('painting terrain', () => {
  it('paints on press and keeps painting through a drag', () => {
    const { editor, session } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    drag(editor, 0, 0, 3);

    expect(session.requireScene('room').terrain.slice(0, 4)).toEqual([
      'wall',
      'wall',
      'wall',
      'wall',
    ]);
  });

  it('makes a whole drag one undo step', () => {
    const { editor, session } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    drag(editor, 0, 0, 5);

    session.undo();
    expect(session.requireScene('room').terrain.every((t) => t === 'floor')).toBe(true);
    expect(session.canUndo).toBe(false);
  });

  it('separates two drags', () => {
    const { editor, session } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    drag(editor, 0, 0, 2);
    drag(editor, 1, 0, 2);

    session.undo();
    expect(session.requireScene('room').terrain[8]).toBe('floor');
    expect(session.requireScene('room').terrain[0]).toBe('wall');
  });

  it('does not re-edit a tile the same stroke already crossed', () => {
    const { editor, changes } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    editor.begin({ x: 0, y: 0 });
    editor.paint({ x: 0, y: 0 });
    editor.paint({ x: 0, y: 0 });
    editor.end();
    expect(changes).toEqual(['terrain']);
  });

  it('paints a square brush', () => {
    const { editor, session } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    editor.set('brushSize', 3);
    editor.begin({ x: 2, y: 2 });
    editor.end();

    const scene = session.requireScene('room');
    const painted = scene.terrain.filter((t) => t === 'wall').length;
    expect(painted).toBe(9);
    expect(scene.terrain[2 + 2 * 8]).toBe('wall');
  });

  it('clips a brush at the edge rather than wrapping', () => {
    const { editor, session } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    editor.set('brushSize', 3);
    editor.begin({ x: 0, y: 0 });
    editor.end();
    expect(session.requireScene('room').terrain.filter((t) => t === 'wall')).toHaveLength(4);
  });

  it('ignores a click outside the scene', () => {
    const { editor, changes } = setup();
    editor.setTool('paintTerrain');
    expect(editor.begin({ x: 99, y: 0 })).toBe('none');
    expect(changes).toEqual([]);
  });
});

describe('height', () => {
  it('raises and lowers along a drag', () => {
    const { editor, session } = setup();
    editor.setTool('raise');
    drag(editor, 0, 0, 2);
    expect(session.requireScene('room').heights.slice(0, 3)).toEqual([1, 1, 1]);

    editor.setTool('lower');
    drag(editor, 0, 0, 2);
    expect(session.requireScene('room').heights.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('raises repeatedly across separate strokes', () => {
    const { editor, session } = setup();
    editor.setTool('raise');
    editor.begin({ x: 0, y: 0 });
    editor.end();
    editor.begin({ x: 0, y: 0 });
    editor.end();
    expect(session.requireScene('room').heights[0]).toBe(2);
  });
});

describe('props', () => {
  it('places one, then turns it when clicked again', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');

    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(session.requireScene('room').decos).toHaveLength(1);

    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(session.requireScene('room').decos).toHaveLength(1);
    expect(session.requireScene('room').decos[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);
  });

  it('stacks a different prop rather than turning the first', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');
    editor.begin({ x: 1, y: 1 });
    editor.end();

    editor.set('propModel', 'barrel');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(session.requireScene('room').decos.map((d) => d.model)).toEqual(['crate', 'barrel']);
  });

  it('places only on press, not through a drag', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    drag(editor, 0, 0, 4);
    expect(session.requireScene('room').decos).toHaveLength(1);
  });
});

describe('spawns', () => {
  it('adds and removes one by clicking', () => {
    const { editor, session } = setup();
    editor.setTool('spawn');
    editor.begin({ x: 3, y: 3 });
    editor.end();
    expect(session.requireScene('room').spawns).toContainEqual({ x: 3, y: 3 });

    editor.begin({ x: 3, y: 3 });
    editor.end();
    expect(session.requireScene('room').spawns).not.toContainEqual({ x: 3, y: 3 });
  });

  it('refuses to remove the last one', () => {
    const { editor, session } = setup();
    editor.setTool('spawn');
    editor.begin({ x: 0, y: 0 }); // the only spawn
    editor.end();
    expect(session.requireScene('room').spawns).toHaveLength(1);
  });
});

describe('interactables', () => {
  it('places one with a positional id, and removes it on a second click', () => {
    const { editor, session } = setup();
    editor.setTool('interactable');
    editor.set('interactableKind', 'door');

    editor.begin({ x: 2, y: 3 });
    editor.end();
    const scene = session.requireScene('room');
    expect(scene.interactables).toHaveLength(1);
    expect(scene.interactables[0]).toMatchObject({ id: 'door-2-3', kind: 'door' });

    editor.begin({ x: 2, y: 3 });
    editor.end();
    expect(session.requireScene('room').interactables).toHaveLength(0);
  });

  it('gives two of a kind on different tiles different ids', () => {
    const { editor, session } = setup();
    editor.setTool('interactable');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    editor.begin({ x: 2, y: 1 });
    editor.end();
    expect(session.requireScene('room').interactables.map((i) => i.id)).toEqual([
      'chest-1-1',
      'chest-2-1',
    ]);
  });
});

describe('encounters', () => {
  it('creates one on the first adversary placed, rather than demanding a panel trip', () => {
    const { editor, session } = setup();
    editor.setTool('adversary');
    editor.set('adversaryId', 'tangle-bramble');

    editor.begin({ x: 4, y: 2 });
    editor.end();

    const scene = session.requireScene('room');
    expect(scene.encounters).toHaveLength(1);
    expect(scene.encounters[0]!.adversaries).toHaveLength(1);
    expect(scene.encounters[0]!.adversaries[0]!.adversary).toBe('tangle-bramble');
    expect(editor.state.encounterId).toBe(scene.encounters[0]!.id);
  });

  it('adds later adversaries to the same encounter', () => {
    const { editor, session } = setup();
    editor.setTool('adversary');
    editor.begin({ x: 4, y: 2 });
    editor.end();
    editor.begin({ x: 5, y: 2 });
    editor.end();

    const scene = session.requireScene('room');
    expect(scene.encounters).toHaveLength(1);
    expect(scene.encounters[0]!.adversaries).toHaveLength(2);
    expect(new Set(scene.encounters[0]!.adversaries.map((a) => a.id)).size).toBe(2);
  });

  it('toggles trigger cells on the selected encounter', () => {
    const { editor, session } = setup();
    editor.setTool('adversary');
    editor.begin({ x: 4, y: 2 });
    editor.end();

    editor.setTool('trigger');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(session.requireScene('room').encounters[0]!.triggerCells).toEqual([{ x: 1, y: 1 }]);

    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(session.requireScene('room').encounters[0]!.triggerCells).toEqual([]);
  });
});

describe('the eraser', () => {
  it('takes the prop first, then the interactable underneath', () => {
    const { editor, session } = setup();
    editor.setTool('interactable');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    editor.setTool('prop');
    editor.begin({ x: 1, y: 1 });
    editor.end();

    editor.setTool('erase');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(session.requireScene('room').decos).toHaveLength(0);
    expect(session.requireScene('room').interactables).toHaveLength(1);

    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(session.requireScene('room').interactables).toHaveLength(0);
  });

  it('reports nothing on empty ground', () => {
    const { editor, changes } = setup();
    editor.setTool('erase');
    editor.begin({ x: 5, y: 5 });
    editor.end();
    expect(changes).toEqual([]);
  });
});

describe('select and inspect', () => {
  it('changes nothing', () => {
    const { editor, session, changes } = setup();
    editor.setTool('select');
    drag(editor, 0, 0, 4);
    expect(session.canUndo).toBe(false);
    expect(changes).toEqual([]);
  });

  it('reports what is on a tile', () => {
    const { editor } = setup();
    editor.setTool('prop');
    editor.begin({ x: 2, y: 2 });
    editor.end();
    editor.setTool('raise');
    editor.begin({ x: 2, y: 2 });
    editor.end();
    editor.setTool('adversary');
    editor.begin({ x: 2, y: 2 });
    editor.end();

    const found = editor.inspect({ x: 2, y: 2 });
    expect(found.terrain).toBe('floor');
    expect(found.height).toBe(1);
    expect(found.deco?.model).toBe('crate');
    expect(found.encounters).toHaveLength(1);
    expect(found.isSpawn).toBe(false);
    expect(editor.inspect({ x: 0, y: 0 }).isSpawn).toBe(true);
  });
});

describe('change notifications', () => {
  it('says which half of the view needs rebuilding', () => {
    const { editor, changes } = setup();
    editor.setTool('paintTerrain');
    editor.begin({ x: 0, y: 0 });
    editor.set('terrainId', 'wall');
    editor.begin({ x: 1, y: 0 });
    editor.end();

    editor.setTool('prop');
    editor.begin({ x: 2, y: 0 });
    editor.end();

    expect(changes).toEqual(['terrain', 'content']);
  });

  it('ends any drag when the tool changes', () => {
    const { editor, session } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    editor.begin({ x: 0, y: 0 });
    editor.setTool('raise');
    // The drag is over, so this paint does nothing.
    editor.paint({ x: 1, y: 0 });
    expect(session.requireScene('room').terrain[1]).toBe('floor');
  });
});

describe('every tool is safe to use on an empty scene', () => {
  it('never throws, whatever is selected', () => {
    const tools: EditorTool[] = [
      'select',
      'paintTerrain',
      'raise',
      'lower',
      'prop',
      'spawn',
      'interactable',
      'adversary',
      'trigger',
      'erase',
    ];
    for (const tool of tools) {
      const { editor, session } = setup();
      editor.setTool(tool);
      expect(() => {
        editor.begin({ x: 1, y: 1 });
        editor.paint({ x: 2, y: 1 });
        editor.end();
      }).not.toThrow();
      // And whatever it did can be undone back to the start.
      while (session.undo());
      expect(session.canUndo).toBe(false);
    }
  });
});
