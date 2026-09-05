import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import {
  EditorSession,
  addAdversary,
  addDeco,
  addEncounter,
  addInteractable,
  addScene,
  adjustHeight,
  brushTiles,
  paintTerrain,
  removeAdversary,
  removeDecoAt,
  removeInteractable,
  renameScene,
  resizeScene,
  rotateDeco,
  setHeight,
  setSpawns,
  toggleTriggerCell,
  updateInteractable,
} from './session';

function project(width = 6, height = 4): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', width, height))],
    startScene: 'room',
  });
}

const session = (width?: number, height?: number): EditorSession =>
  new EditorSession(project(width, height));

/** A JSON snapshot, for "nothing changed" assertions. */
const snapshot = (s: EditorSession): string => JSON.stringify(s.project);

describe('the session', () => {
  it('starts clean with nothing to undo', () => {
    const s = session();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.dirty).toBe(false);
    expect(s.undoLabel).toBeNull();
  });

  it('applies an edit, and reports it as undoable and dirty', () => {
    const s = session();
    s.run(paintTerrain('room', [0], 'wall'));
    expect(s.requireScene('room').terrain[0]).toBe('wall');
    expect(s.canUndo).toBe(true);
    expect(s.dirty).toBe(true);
    expect(s.undoLabel).toBe('Paint wall');
  });

  it('undoes and redoes exactly', () => {
    const s = session();
    const before = snapshot(s);
    s.run(paintTerrain('room', [0, 1, 2], 'wall'));
    const after = snapshot(s);

    expect(s.undo()).toBe(true);
    expect(snapshot(s)).toBe(before);
    expect(s.redo()).toBe(true);
    expect(snapshot(s)).toBe(after);
  });

  it('reports nothing to undo or redo at the ends', () => {
    const s = session();
    expect(s.undo()).toBe(false);
    s.run(paintTerrain('room', [0], 'wall'));
    s.undo();
    expect(s.undo()).toBe(false);
    s.redo();
    expect(s.redo()).toBe(false);
  });

  it('discards the redo branch once a new edit lands', () => {
    const s = session();
    s.run(paintTerrain('room', [0], 'wall'));
    s.undo();
    expect(s.canRedo).toBe(true);
    s.run(paintTerrain('room', [1], 'difficult'));
    expect(s.canRedo).toBe(false);
  });

  it('tracks saved state', () => {
    const s = session();
    s.run(paintTerrain('room', [0], 'wall'));
    expect(s.dirty).toBe(true);
    s.markSaved();
    expect(s.dirty).toBe(false);
    s.run(paintTerrain('room', [1], 'wall'));
    expect(s.dirty).toBe(true);
    s.undo();
    expect(s.dirty).toBe(false);
  });

  it('notifies subscribers, until they unsubscribe', () => {
    const s = session();
    let calls = 0;
    const stop = s.subscribe(() => calls++);
    s.run(paintTerrain('room', [0], 'wall'));
    s.undo();
    expect(calls).toBe(2);
    stop();
    s.redo();
    expect(calls).toBe(2);
  });

  it('drops the oldest edits past the history limit', () => {
    const s = new EditorSession(project(), { historyLimit: 2 });
    s.run(paintTerrain('room', [0], 'wall'));
    s.run(setHeight('room', [1], 1));
    s.run(setHeight('room', [2], 2));
    expect(s.undo()).toBe(true);
    expect(s.undo()).toBe(true);
    expect(s.undo()).toBe(false);
    // The first paint is beyond the window, so it stays applied.
    expect(s.requireScene('room').terrain[0]).toBe('wall');
  });

  it('throws for a scene that is not in the project', () => {
    const s = session();
    expect(() => s.run(paintTerrain('nowhere', [0], 'wall'))).toThrow(/no scene "nowhere"/);
    expect(s.scene('nowhere')).toBeUndefined();
  });
});

describe('painting terrain', () => {
  it('skips tiles that already hold the terrain', () => {
    const s = session();
    s.run(paintTerrain('room', [0, 1], 'wall'));
    const before = s.undoLabel;
    s.run(paintTerrain('room', [0, 1], 'wall'));
    // Nothing changed, so nothing new to undo beyond the merged first edit.
    s.undo();
    expect(s.requireScene('room').terrain[0]).toBe('floor');
    expect(before).toBe('Paint wall');
  });

  it('coalesces a brush drag into one undo step', () => {
    const s = session();
    const scene = s.requireScene('room');
    const before = snapshot(s);

    // Six separate edits, as a drag would produce.
    for (let x = 0; x < 6; x++) s.run(paintTerrain('room', brushTiles(scene, { x, y: 0 }), 'wall'));
    expect(scene.terrain.slice(0, 6).every((t) => t === 'wall')).toBe(true);

    expect(s.undo()).toBe(true);
    expect(snapshot(s)).toBe(before);
    expect(s.canUndo).toBe(false);
  });

  it('redoes a whole coalesced drag, not just its first stroke', () => {
    const s = session();
    const scene = s.requireScene('room');
    for (let x = 0; x < 6; x++) s.run(paintTerrain('room', brushTiles(scene, { x, y: 0 }), 'wall'));
    const painted = snapshot(s);

    s.undo();
    s.redo();
    expect(snapshot(s)).toBe(painted);
    expect(scene.terrain.slice(0, 6).every((t) => t === 'wall')).toBe(true);
  });

  it('restores the original terrain under a drag that crossed itself', () => {
    const s = session();
    const scene = s.requireScene('room');
    scene.terrain[1] = 'difficult';
    const before = snapshot(s);

    // Paint over tile 1 twice: the undo must restore 'difficult', not 'wall'.
    s.run(paintTerrain('room', [0, 1], 'wall'));
    s.run(paintTerrain('room', [1, 2], 'wall'));
    s.undo();
    expect(snapshot(s)).toBe(before);
    expect(scene.terrain[1]).toBe('difficult');
  });

  it('does not coalesce different terrains or different scenes', () => {
    const s = session();
    s.run(paintTerrain('room', [0], 'wall'));
    s.run(paintTerrain('room', [1], 'difficult'));
    s.undo();
    expect(s.requireScene('room').terrain[1]).toBe('floor');
    expect(s.requireScene('room').terrain[0]).toBe('wall');
  });

  it('does not coalesce across an undo', () => {
    const s = session();
    s.run(paintTerrain('room', [0], 'wall'));
    s.undo();
    s.run(paintTerrain('room', [1], 'wall'));
    expect(s.requireScene('room').terrain[0]).toBe('floor');
    expect(s.requireScene('room').terrain[1]).toBe('wall');
  });
});

describe('elevation', () => {
  it('sets an exact height and undoes it', () => {
    const s = session();
    s.run(setHeight('room', [0, 1], 3));
    expect(s.requireScene('room').heights.slice(0, 2)).toEqual([3, 3]);
    s.undo();
    expect(s.requireScene('room').heights.slice(0, 2)).toEqual([0, 0]);
  });

  it('raises and lowers relative to what a tile holds', () => {
    const s = session();
    s.run(setHeight('room', [0], 2));
    s.run(adjustHeight('room', [0], 1));
    expect(s.requireScene('room').heights[0]).toBe(3);
    s.undo();
    expect(s.requireScene('room').heights[0]).toBe(2);
  });

  it('coalesces a height drag but keeps it separate from a paint', () => {
    const s = session();
    s.run(setHeight('room', [0], 2));
    s.run(setHeight('room', [1], 2));
    s.run(paintTerrain('room', [2], 'wall'));
    expect(s.undoLabel).toBe('Paint wall');
    s.undo();
    s.undo();
    expect(s.requireScene('room').heights.slice(0, 2)).toEqual([0, 0]);
    expect(s.canUndo).toBe(false);
  });
});

describe('props', () => {
  const crate = { model: 'crate', position: { x: 2, y: 1 }, rotation: 0 };

  it('places and erases one', () => {
    const s = session();
    s.run(addDeco('room', { ...crate }));
    expect(s.requireScene('room').decos).toHaveLength(1);
    s.undo();
    expect(s.requireScene('room').decos).toHaveLength(0);

    s.redo();
    s.run(removeDecoAt('room', { x: 2, y: 1 }));
    expect(s.requireScene('room').decos).toHaveLength(0);
    s.undo();
    expect(s.requireScene('room').decos).toHaveLength(1);
  });

  it('erases the one on top and puts it back where it was', () => {
    const s = session();
    s.run(addDeco('room', { model: 'barrel', position: { x: 2, y: 1 }, rotation: 0 }));
    s.run(addDeco('room', { model: 'crate', position: { x: 2, y: 1 }, rotation: 0 }));
    s.run(addDeco('room', { model: 'pine', position: { x: 0, y: 0 }, rotation: 0 }));

    s.run(removeDecoAt('room', { x: 2, y: 1 }));
    expect(s.requireScene('room').decos.map((d) => d.model)).toEqual(['barrel', 'pine']);
    s.undo();
    expect(s.requireScene('room').decos.map((d) => d.model)).toEqual(['barrel', 'crate', 'pine']);
  });

  it('does nothing erasing empty ground', () => {
    const s = session();
    const before = snapshot(s);
    s.run(removeDecoAt('room', { x: 5, y: 3 }));
    expect(snapshot(s)).toBe(before);
    s.undo();
    expect(snapshot(s)).toBe(before);
  });

  it('rotates in place', () => {
    const s = session();
    s.run(addDeco('room', { ...crate }));
    s.run(rotateDeco('room', { x: 2, y: 1 }, Math.PI / 2));
    expect(s.requireScene('room').decos[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);
    s.undo();
    expect(s.requireScene('room').decos[0]!.rotation).toBeCloseTo(0, 10);
  });
});

describe('interactables', () => {
  const chest = {
    id: 'chest-1',
    kind: 'chest' as const,
    position: { x: 1, y: 1 },
    name: 'Old Chest',
    flavor: '',
    model: null,
    blocksMovement: true,
    lockedText: '',
    tags: [],
    data: {},
  };

  it('adds, edits and deletes one', () => {
    const s = session();
    s.run(addInteractable('room', { ...chest }));
    expect(s.requireScene('room').interactables[0]!.name).toBe('Old Chest');

    s.run(updateInteractable('room', 'chest-1', { name: 'Rotted Chest', blocksMovement: false }));
    expect(s.requireScene('room').interactables[0]).toMatchObject({
      name: 'Rotted Chest',
      blocksMovement: false,
    });
    s.undo();
    expect(s.requireScene('room').interactables[0]).toMatchObject({
      name: 'Old Chest',
      blocksMovement: true,
    });

    s.run(removeInteractable('room', 'chest-1'));
    expect(s.requireScene('room').interactables).toHaveLength(0);
    s.undo();
    expect(s.requireScene('room').interactables).toHaveLength(1);
  });

  it('puts a deleted interactable back in its original position in the list', () => {
    const s = session();
    s.run(addInteractable('room', { ...chest, id: 'a', position: { x: 0, y: 0 } }));
    s.run(addInteractable('room', { ...chest, id: 'b', position: { x: 1, y: 0 } }));
    s.run(addInteractable('room', { ...chest, id: 'c', position: { x: 2, y: 0 } }));

    s.run(removeInteractable('room', 'b'));
    s.undo();
    expect(s.requireScene('room').interactables.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores an edit to something that is not there', () => {
    const s = session();
    const before = snapshot(s);
    s.run(updateInteractable('room', 'nope', { name: 'x' }));
    s.run(removeInteractable('room', 'nope'));
    expect(snapshot(s)).toBe(before);
  });
});

describe('encounters', () => {
  const encounter = {
    id: 'ambush',
    name: 'Ambush',
    adversaries: [],
    triggerCells: [],
    startsOnTrigger: true,
  };
  const bramble = {
    id: 'bramble-1',
    adversary: 'tangle-bramble',
    position: { x: 4, y: 2 },
  };

  it('adds an encounter and places adversaries in it', () => {
    const s = session();
    s.run(addEncounter('room', { ...encounter }));
    s.run(addAdversary('room', 'ambush', { ...bramble }));
    expect(s.requireScene('room').encounters[0]!.adversaries).toHaveLength(1);

    s.run(removeAdversary('room', 'ambush', 'bramble-1'));
    expect(s.requireScene('room').encounters[0]!.adversaries).toHaveLength(0);
    s.undo();
    expect(s.requireScene('room').encounters[0]!.adversaries[0]!.id).toBe('bramble-1');
  });

  it('toggles trigger cells on and off, and undoes either way', () => {
    const s = session();
    s.run(addEncounter('room', { ...encounter }));

    s.run(toggleTriggerCell('room', 'ambush', { x: 1, y: 1 }));
    expect(s.requireScene('room').encounters[0]!.triggerCells).toEqual([{ x: 1, y: 1 }]);

    s.run(toggleTriggerCell('room', 'ambush', { x: 1, y: 1 }));
    expect(s.requireScene('room').encounters[0]!.triggerCells).toEqual([]);

    s.undo();
    expect(s.requireScene('room').encounters[0]!.triggerCells).toEqual([{ x: 1, y: 1 }]);
    s.undo();
    expect(s.requireScene('room').encounters[0]!.triggerCells).toEqual([]);
  });

  it('throws for an encounter that is not in the scene', () => {
    const s = session();
    expect(() => s.run(addAdversary('room', 'nope', { ...bramble }))).toThrow(/no encounter "nope"/);
  });
});

describe('spawns', () => {
  it('replaces them and undoes', () => {
    const s = session();
    s.run(setSpawns('room', [{ x: 3, y: 2 }, { x: 4, y: 2 }]));
    expect(s.requireScene('room').spawns).toEqual([{ x: 3, y: 2 }, { x: 4, y: 2 }]);
    s.undo();
    expect(s.requireScene('room').spawns).toEqual([{ x: 0, y: 0 }]);
  });

  it('refuses to leave a scene with nowhere to put the party', () => {
    const s = session();
    s.run(setSpawns('room', []));
    expect(s.requireScene('room').spawns).toHaveLength(1);
  });
});

describe('scenes', () => {
  it('adds and renames', () => {
    const s = session();
    s.run(addScene(sceneSchema.parse(blankScene('cellar', 4, 4))));
    expect(s.project.scenes.map((x) => x.id)).toEqual(['room', 'cellar']);

    s.run(renameScene('cellar', 'The Cellar'));
    expect(s.requireScene('cellar').name).toBe('The Cellar');
    s.undo();
    expect(s.requireScene('cellar').name).toBe('');
    s.undo();
    expect(s.project.scenes).toHaveLength(1);
  });

  describe('resizing', () => {
    function populated(): EditorSession {
      const s = session(6, 4);
      s.run(setHeight('room', [0], 3));
      s.run(paintTerrain('room', [1], 'wall'));
      s.run(addDeco('room', { model: 'crate', position: { x: 5, y: 3 }, rotation: 0 }));
      s.run(addDeco('room', { model: 'pine', position: { x: 0, y: 0 }, rotation: 0 }));
      s.run(setSpawns('room', [{ x: 5, y: 3 }, { x: 0, y: 0 }]));
      return s;
    }

    it('grows with default ground, keeping what was there', () => {
      const s = populated();
      s.run(resizeScene('room', 8, 6));
      const scene = s.requireScene('room');
      expect(scene.width).toBe(8);
      expect(scene.terrain).toHaveLength(48);
      expect(scene.heights[0]).toBe(3);
      expect(scene.terrain[1]).toBe('wall');
      expect(scene.terrain[47]).toBe('floor');
      // A tile that moved index keeps its content: (5,3) was 23, now 29.
      expect(scene.decos.some((d) => d.position.x === 5 && d.position.y === 3)).toBe(true);
    });

    it('crops, dropping what falls outside', () => {
      const s = populated();
      s.run(resizeScene('room', 3, 2));
      const scene = s.requireScene('room');
      expect(scene.terrain).toHaveLength(6);
      expect(scene.decos.map((d) => d.model)).toEqual(['pine']);
      expect(scene.spawns).toEqual([{ x: 0, y: 0 }]);
    });

    it('leaves a cropped scene at least one spawn', () => {
      const s = session(6, 4);
      s.run(setSpawns('room', [{ x: 5, y: 3 }]));
      s.run(resizeScene('room', 2, 2));
      expect(s.requireScene('room').spawns).toHaveLength(1);
    });

    it('restores everything it dropped on undo', () => {
      const s = populated();
      const before = snapshot(s);
      s.run(resizeScene('room', 2, 2));
      s.undo();
      expect(snapshot(s)).toBe(before);
    });
  });
});

describe('the document stays valid', () => {
  it('still parses against the schema after a run of edits', () => {
    const s = session(8, 6);
    const scene = s.requireScene('room');
    for (let x = 0; x < 8; x++) s.run(paintTerrain('room', brushTiles(scene, { x, y: 0 }), 'wall'));
    s.run(setHeight('room', [9, 10], 2));
    s.run(addDeco('room', { model: 'crate', position: { x: 3, y: 3 }, rotation: 0.5 }));
    s.run(addEncounter('room', { id: 'ambush', name: '', adversaries: [], triggerCells: [], startsOnTrigger: true }));
    s.run(addAdversary('room', 'ambush', { id: 'b1', adversary: 'tangle-bramble', position: { x: 4, y: 4 } }));
    s.run(toggleTriggerCell('room', 'ambush', { x: 2, y: 2 }));
    s.run(resizeScene('room', 10, 8));

    const parsed = projectSchema.safeParse(JSON.parse(JSON.stringify(s.project)));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('returns to a byte-identical document after undoing everything', () => {
    const s = session(8, 6);
    const before = snapshot(s);
    const scene = s.requireScene('room');

    s.run(paintTerrain('room', brushTiles(scene, { x: 1, y: 1 }, 3), 'difficult'));
    s.run(setHeight('room', [0], 4));
    s.run(addDeco('room', { model: 'rock', position: { x: 1, y: 1 }, rotation: 0 }));
    s.run(setSpawns('room', [{ x: 2, y: 2 }]));
    s.run(resizeScene('room', 4, 4));

    while (s.undo());
    expect(snapshot(s)).toBe(before);
  });
});
