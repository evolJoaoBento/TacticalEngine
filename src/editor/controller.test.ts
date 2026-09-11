import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { EditorController, type EditorTool } from './controller';
import { EditorSession, addScene, removeInteractable } from './session';
import { TERRAIN_RAIL } from './modes';

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
  it('places with the chosen facing and preserves it through save and undo/redo', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('buildRotation', 3);
    editor.begin({ x: 2, y: 2 });
    editor.end();
    expect(projectSchema.parse(session.project).scenes[0]!.decos[0]!.rotation).toBeCloseTo(3 * Math.PI / 2);
    session.undo();
    expect(session.requireScene('room').decos).toHaveLength(0);
    session.redo();
    expect(session.requireScene('room').decos[0]!.rotation).toBeCloseTo(3 * Math.PI / 2);
  });

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

describe('editing a different scene', () => {
  it('drops the encounter it was adding to, which belonged to the other room', () => {
    const s = new EditorSession(
      projectSchema.parse({
        id: 'p',
        name: '',
        scenes: [
          sceneSchema.parse(blankScene('room', 6, 4)),
          sceneSchema.parse(blankScene('cellar', 6, 4)),
        ],
        startScene: 'room',
      }),
    );
    const controller = new EditorController({ session: s, sceneId: 'room' });

    controller.setTool('adversary');
    controller.begin({ x: 1, y: 1 });
    controller.end();
    expect(controller.state.encounterId).not.toBeNull();

    controller.switchScene('cellar');
    expect(controller.sceneId).toBe('cellar');
    // Carrying it would drop the next enemy into the other room's fight.
    expect(controller.state.encounterId).toBeNull();

    controller.begin({ x: 2, y: 2 });
    controller.end();
    expect(s.requireScene('cellar').encounters.length).toBe(1);
    expect(s.requireScene('room').encounters[0]!.adversaries.length).toBe(1);
  });
});

describe('selecting an object to edit', () => {
  const withObject = (): EditorController => {
    const s = new EditorSession(
      projectSchema.parse({
        id: 'p',
        name: '',
        scenes: [sceneSchema.parse(blankScene('room', 8, 6))],
        startScene: 'room',
      }),
    );
    const controller = new EditorController({ session: s, sceneId: 'room' });
    controller.setTool('interactable');
    controller.begin({ x: 2, y: 2 });
    controller.end();
    return controller;
  };

  it('selects the object under the pointer, and nothing on bare ground', () => {
    const controller = withObject();
    controller.setTool('select');

    expect(controller.begin({ x: 2, y: 2 })).toBe('content');
    expect(controller.selectedInteractable()?.position).toEqual({ x: 2, y: 2 });

    controller.end();
    expect(controller.begin({ x: 5, y: 5 })).toBe('content');
    expect(controller.selected).toBeNull();
  });

  it('does not put a selection in the undo history', () => {
    const controller = withObject();
    const label = controller.session.undoLabel;
    controller.setTool('select');
    controller.begin({ x: 2, y: 2 });
    controller.end();
    // Still the object placement, not a "select".
    expect(controller.session.undoLabel).toBe(label);
  });

  it('reports no change when the same object is clicked twice', () => {
    const controller = withObject();
    controller.setTool('select');
    controller.begin({ x: 2, y: 2 });
    controller.end();
    expect(controller.begin({ x: 2, y: 2 })).toBe('none');
  });

  it('forgets a selection that belonged to another room', () => {
    const controller = withObject();
    controller.setTool('select');
    controller.begin({ x: 2, y: 2 });
    controller.end();
    controller.session.run(addScene(sceneSchema.parse(blankScene('cellar', 4, 4))));

    controller.switchScene('cellar');
    expect(controller.selected).toBeNull();
    expect(controller.selectedInteractable()).toBeNull();
  });

  it('stops offering an object once it has been deleted', () => {
    const controller = withObject();
    controller.setTool('select');
    controller.begin({ x: 2, y: 2 });
    controller.end();
    const id = controller.selected!;

    controller.session.run(removeInteractable('room', id));
    // The id is still selected but the object is gone; the panel must not crash.
    expect(controller.selectedInteractable()).toBeNull();
  });
});

describe('modes', () => {
  it('starts in the mode that owns its tool', () => {
    const { editor } = setup();
    expect(editor.state.tool).toBe('paintTerrain');
    expect(editor.mode).toBe('terrain');
  });

  it('choosing a tool chooses its mode', () => {
    const { editor } = setup();
    editor.setTool('adversary');
    expect(editor.mode).toBe('combat');
    editor.setTool('select');
    expect(editor.mode).toBe('inspect');
  });

  it('choosing a mode picks its first tool, unless the current one is its own', () => {
    const { editor } = setup();
    editor.setMode('combat');
    expect(editor.state.tool).toBe('adversary');
    editor.setTool('erase');
    editor.setMode('terrain');
    expect(editor.state.tool).toBe('erase');
    editor.setMode('interaction');
    expect(editor.state.tool).toBe('select');
  });

  it('ends a drag when the mode changes', () => {
    const { editor, session } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    editor.begin({ x: 0, y: 0 });
    editor.setMode('combat');
    editor.paint({ x: 1, y: 0 });
    expect(session.requireScene('room').terrain[1]).toBe('floor');
  });
});

describe('erasing in combat', () => {
  /** A creature, a trigger cell and a spawn all on (2, 2), with Combat's eraser in hand. */
  function stacked(): ReturnType<typeof setup> {
    const made = setup();
    const { editor } = made;
    for (const tool of ['adversary', 'trigger', 'spawn'] as const) {
      editor.setTool(tool);
      editor.begin({ x: 2, y: 2 });
      editor.end();
    }
    editor.setTool('erase');
    return made;
  }

  const erase = (editor: EditorController): void => {
    editor.begin({ x: 2, y: 2 });
    editor.end();
  };

  it('takes the creature, then the trigger cell, then the spawn', () => {
    const { editor, session } = stacked();
    const scene = () => session.requireScene('room');
    expect(editor.mode).toBe('combat');

    erase(editor);
    expect(scene().encounters[0]!.adversaries).toHaveLength(0);
    expect(scene().encounters[0]!.triggerCells).toEqual([{ x: 2, y: 2 }]);

    erase(editor);
    expect(scene().encounters[0]!.triggerCells).toEqual([]);
    expect(scene().spawns).toContainEqual({ x: 2, y: 2 });

    erase(editor);
    expect(scene().spawns).toEqual([{ x: 0, y: 0 }]);
  });

  it('never takes the last spawn', () => {
    const { editor, session } = setup();
    editor.setMode('combat');
    editor.setTool('erase');
    expect(editor.begin({ x: 0, y: 0 })).toBe('none');
    editor.end();
    expect(session.requireScene('room').spawns).toEqual([{ x: 0, y: 0 }]);
  });

  it('is undone a step at a time', () => {
    const { editor, session } = stacked();
    erase(editor);
    erase(editor);
    session.undo();
    expect(session.requireScene('room').encounters[0]!.triggerCells).toEqual([{ x: 2, y: 2 }]);
    session.undo();
    expect(session.requireScene('room').encounters[0]!.adversaries).toHaveLength(1);
  });

  it('leaves props to Terrain', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.begin({ x: 3, y: 3 });
    editor.end();

    editor.setMode('combat');
    editor.setTool('erase');
    editor.begin({ x: 3, y: 3 });
    editor.end();
    expect(session.requireScene('room').decos).toHaveLength(1);

    // Erase is Terrain's too, so it stays in hand across the switch.
    editor.setMode('terrain');
    editor.begin({ x: 3, y: 3 });
    editor.end();
    expect(session.requireScene('room').decos).toHaveLength(0);
  });
});

describe("terrain's open tab", () => {
  it('follows the tool into hand, so the rail always shows it', () => {
    const { editor } = setup();
    editor.setMode('terrain');
    editor.openTerrainTab('tiles');
    expect(editor.state.tool).toBe('buildTile');
    expect(TERRAIN_RAIL[editor.terrainTab]).toEqual(['eraseTile']);

    // Erase belongs to Props and Objects, never to Tiles: picking it from the
    // Tiles tab must move the strip rather than leave the tool off the rail.
    editor.setTool('erase');
    expect(editor.terrainTab).toBe('props');
    expect(TERRAIN_RAIL[editor.terrainTab]).toContain('erase');

    editor.openTerrainTab('objects');
    expect(editor.state.tool).toBe('interactable');
    editor.setTool('erase');
    expect(editor.terrainTab).toBe('objects');
  });

  it('re-syncs when Terrain is entered holding one of its own tools', () => {
    const { editor } = setup();
    editor.setMode('terrain');
    editor.openTerrainTab('tiles');
    editor.setMode('combat');
    editor.setTool('erase');
    editor.setMode('terrain');
    expect(editor.state.tool).toBe('erase');
    expect(TERRAIN_RAIL[editor.terrainTab]).toContain('erase');
  });

  it('reopens the last tab when Terrain is entered holding somebody else’s tool', () => {
    const { editor } = setup();
    editor.setMode('terrain');
    editor.openTerrainTab('ground');
    editor.setMode('inspect');
    expect(editor.state.tool).toBe('select');
    editor.setMode('terrain');
    expect(editor.terrainTab).toBe('ground');
    expect(editor.state.tool).toBe('paintTerrain');
  });

  it('ends the drag when the build plane moves, so a stroke cannot span two storeys', () => {
    const { editor, session } = setup();
    editor.setTool('buildTile');
    editor.begin({ x: 0, y: 0 });
    editor.setBuildLevel(2.25);
    editor.begin({ x: 0, y: 0 });
    editor.end();
    expect(Object.keys(session.requireScene('room').buildingTiles ?? {})).toEqual(['0,0,0', '0,0,2.25']);
    session.undo();
    expect(Object.keys(session.requireScene('room').buildingTiles ?? {})).toEqual(['0,0,0']);
  });
});
