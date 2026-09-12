import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import {
  removeScene,
  setStartScene,
  EditorSession,
  addAdversary,
  addAsset,
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
  setAdversaryModel,
  setHeight,
  setSpawns,
  toggleTriggerCell,
  updateAdversary,
  updateAsset,
  updateInteractable,
} from './session';
import { modelAssetSchema } from '../engine/render/assets';

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
  /** A scene whose every tile carries a colour override, as the legacy importer leaves it. */
  const tinted = (): EditorSession => {
    const s = session();
    const scene = s.requireScene('room');
    scene.tints = scene.terrain.map(() => '#123456');
    return s;
  };

  // `buildTerrainMesh` lets a tint win over the terrain type's colour, so a paint
  // that left the tint behind changed the map for the pathfinder and not for the
  // eye. On an imported map that is every tile.
  it('drops the colour override so the new terrain is visible', () => {
    const s = tinted();
    s.run(paintTerrain('room', [0, 1], 'wall'));
    const scene = s.requireScene('room');
    expect(scene.terrain[0]).toBe('wall');
    expect(scene.tints?.[0]).toBe('');
    expect(scene.tints?.[1]).toBe('');
    // Untouched tiles keep theirs.
    expect(scene.tints?.[2]).toBe('#123456');
  });

  it('restores the colour override on undo', () => {
    const s = tinted();
    const before = snapshot(s);
    s.run(paintTerrain('room', [0, 1], 'wall'));
    expect(s.undo()).toBe(true);
    expect(snapshot(s)).toBe(before);
  });

  it('restores every tint across a coalesced drag, and clears them all again on redo', () => {
    const s = tinted();
    const scene = s.requireScene('room');
    const before = snapshot(s);

    for (let x = 0; x < 4; x++) s.run(paintTerrain('room', brushTiles(scene, { x, y: 0 }), 'wall'));
    expect(scene.tints?.slice(0, 4)).toEqual(['', '', '', '']);

    expect(s.undo()).toBe(true);
    expect(snapshot(s)).toBe(before);

    expect(s.redo()).toBe(true);
    // The whole drag comes back, colours included.
    expect(s.requireScene('room').tints?.slice(0, 4)).toEqual(['', '', '', '']);
    expect(s.requireScene('room').terrain.slice(0, 4)).toEqual(['wall', 'wall', 'wall', 'wall']);
  });

  it('repaints a tile that already holds the terrain but still carries an override', () => {
    const s = tinted();
    const scene = s.requireScene('room');
    scene.terrain[0] = 'wall';
    // The terrain matches, so the old no-op check would have skipped it and left
    // the tile looking like whatever it was tinted.
    expect(s.run(paintTerrain('room', [0], 'wall'))).toBe(true);
    expect(scene.tints?.[0]).toBe('');
  });

  it('paints scenes that carry no tints at all', () => {
    const s = session();
    expect(s.requireScene('room').tints).toBeUndefined();
    expect(s.run(paintTerrain('room', [0], 'wall'))).toBe(true);
    expect(s.requireScene('room').terrain[0]).toBe('wall');
    expect(s.undo()).toBe(true);
    expect(s.requireScene('room').terrain[0]).toBe('floor');
  });

  it('leaves elevation alone, because Raise is a separate tool', () => {
    const s = tinted();
    const scene = s.requireScene('room');
    scene.heights[0] = 3;
    s.run(paintTerrain('room', [0], 'wall'));
    expect(scene.heights[0]).toBe(3);
  });

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
    repeatable: false,
    effects: [],
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
      repeatable: false,
    });
    s.undo();
    expect(s.requireScene('room').interactables[0]).toMatchObject({
      name: 'Old Chest',
      blocksMovement: true,
      repeatable: false,
    effects: [],
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

  it('re-skins and renames one placed creature, and undo puts it back as it was', () => {
    const s = session();
    s.run(addEncounter('room', { ...encounter }));
    s.run(addAdversary('room', 'ambush', { ...bramble }));
    const placed = (): { model?: string; name?: string } =>
      s.requireScene('room').encounters[0]!.adversaries[0]!;

    s.run(updateAdversary('room', 'ambush', 'bramble-1', { model: 'knight', name: 'Gorehide' }));
    expect(placed().model).toBe('knight');
    expect(placed().name).toBe('Gorehide');

    s.undo();
    expect(placed().model).toBeUndefined();
    expect(placed().name).toBeUndefined();
  });

  it('drops a per-creature override when it is cleared, rather than storing nothing', () => {
    const s = session();
    s.run(addEncounter('room', { ...encounter }));
    s.run(addAdversary('room', 'ambush', { ...bramble, model: 'knight' }));
    s.run(updateAdversary('room', 'ambush', 'bramble-1', { model: null }));
    const placed = s.requireScene('room').encounters[0]!.adversaries[0]!;
    expect(placed.model).toBeUndefined();
    expect('model' in placed).toBe(false);
  });

  it('sets what a whole adversary type is drawn with, and undoes it', () => {
    const s = session();
    s.run(setAdversaryModel('tangle-bramble', 'knight'));
    expect(s.project.adversaryModels['tangle-bramble']).toBe('knight');
    s.undo();
    expect(s.project.adversaryModels['tangle-bramble']).toBeUndefined();
  });

  it('clears a type entry rather than leaving an empty model id behind', () => {
    const s = session();
    s.run(setAdversaryModel('tangle-bramble', 'knight'));
    s.run(setAdversaryModel('tangle-bramble', null));
    expect(s.project.adversaryModels['tangle-bramble']).toBeUndefined();
    expect('tangle-bramble' in s.project.adversaryModels).toBe(false);
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

describe('deleting and choosing scenes', () => {
  /** A project with two scenes, opening on the first. */
  const pair = (): EditorSession => {
    const s = session();
    s.run(addScene(sceneSchema.parse(blankScene('cellar', 4, 4))));
    return s;
  };

  it('deletes a scene and puts it back, in the same place', () => {
    const s = pair();
    s.run(addScene(sceneSchema.parse(blankScene('attic', 4, 4))));
    expect(s.project.scenes.map((x) => x.id)).toEqual(['room', 'cellar', 'attic']);

    expect(s.run(removeScene('cellar'))).toBe(true);
    expect(s.project.scenes.map((x) => x.id)).toEqual(['room', 'attic']);

    s.undo();
    // Back at index 1, not appended — an undo that reorders the list is a bad undo.
    expect(s.project.scenes.map((x) => x.id)).toEqual(['room', 'cellar', 'attic']);
  });

  it('refuses to delete the scene the project opens on', () => {
    const s = pair();
    const history = s.undoLabel;
    expect(s.run(removeScene('room'))).toBe(false);
    expect(s.project.scenes.length).toBe(2);
    // A refused edit is not history: the last undoable thing is still the add.
    expect(s.undoLabel).toBe(history);
  });

  it('refuses to delete the only scene there is', () => {
    const s = session();
    expect(s.run(removeScene('room'))).toBe(false);
    expect(s.project.scenes.length).toBe(1);
  });

  it('refuses to delete a scene that is not there', () => {
    const s = pair();
    expect(s.run(removeScene('nowhere'))).toBe(false);
  });

  it('chooses which scene the project opens on, reversibly', () => {
    const s = pair();
    expect(s.run(setStartScene('cellar'))).toBe(true);
    expect(s.project.startScene).toBe('cellar');
    s.undo();
    expect(s.project.startScene).toBe('room');
  });

  it('treats setting the opening scene to what it already is as nothing', () => {
    const s = pair();
    const history = s.undoLabel;
    expect(s.run(setStartScene('room'))).toBe(false);
    expect(s.undoLabel).toBe(history);
  });

  it('will not open on a scene the project does not have', () => {
    const s = pair();
    expect(s.run(setStartScene('nowhere'))).toBe(false);
    expect(s.project.startScene).toBe('room');
  });

  it('lets the previous opening scene be deleted once another one opens', () => {
    const s = pair();
    s.run(setStartScene('cellar'));
    expect(s.run(removeScene('room'))).toBe(true);
    expect(s.project.scenes.map((x) => x.id)).toEqual(['cellar']);
  });
});

describe('editing an object', () => {
  const withChest = (): EditorSession => {
    const s = session(8, 6);
    s.run(
      addInteractable('room', {
        id: 'chest-1',
        kind: 'chest',
        position: { x: 1, y: 1 },
        name: '',
        flavor: '',
        model: null,
        blocksMovement: true,
        repeatable: false,
        effects: [],
        lockedText: '',
        tags: [],
        data: {},
      }),
    );
    return s;
  };

  it('coalesces successive edits to the same field into one undo', () => {
    const s = withChest();
    for (const name of ['A', 'An', 'An o', 'An old chest']) {
      s.run(updateInteractable('room', 'chest-1', { name }));
    }
    expect(s.requireScene('room').interactables[0]!.name).toBe('An old chest');

    // One undo, not four — typing is not four undo steps.
    s.undo();
    expect(s.requireScene('room').interactables[0]!.name).toBe('');
  });

  it('redoes the whole of a coalesced edit, not its first keystroke', () => {
    const s = withChest();
    s.run(updateInteractable('room', 'chest-1', { name: 'A' }));
    s.run(updateInteractable('room', 'chest-1', { name: 'An old chest' }));
    s.undo();
    s.redo();
    expect(s.requireScene('room').interactables[0]!.name).toBe('An old chest');
  });

  it('keeps edits to different fields as separate undo steps', () => {
    const s = withChest();
    s.run(updateInteractable('room', 'chest-1', { name: 'An old chest' }));
    s.run(updateInteractable('room', 'chest-1', { lockedText: 'It will not budge.' }));

    s.undo();
    // Undoing the locked text must not silently undo the rename as well.
    expect(s.requireScene('room').interactables[0]!.lockedText).toBe('');
    expect(s.requireScene('room').interactables[0]!.name).toBe('An old chest');
  });

  it('writes a check and its outcomes, reversibly', () => {
    const s = withChest();
    s.run(
      updateInteractable('room', 'chest-1', {
        check: {
          trait: 'finesse',
          difficulty: 14,
          onSuccessWithHope: [{ kind: 'log', text: 'It opens.' }, { kind: 'open' }],
        },
      }),
    );
    const check = s.requireScene('room').interactables[0]!.check;
    expect(check?.difficulty).toBe(14);
    expect(check?.onSuccessWithHope?.length).toBe(2);

    s.undo();
    expect(s.requireScene('room').interactables[0]!.check).toBeUndefined();
  });
});

describe('imported models', () => {
  const fox = (): ReturnType<typeof modelAssetSchema.parse> =>
    modelAssetSchema.parse({ id: 'fox', url: '/tests/fixtures/models/Fox.glb', scale: 0.012 });

  it('edits one in place, and undo puts every field back as it was', () => {
    const s = session();
    s.run(addAsset(fox()));
    s.run(
      updateAsset('fox', {
        scale: 0.02,
        groundOffset: 0.5,
        rotationY: 1.5,
        clips: { idle: 'Survey', walk: 'Run' },
      }),
    );
    const edited = s.project.assets[0]!;
    expect(edited.scale).toBe(0.02);
    expect(edited.groundOffset).toBe(0.5);
    expect(edited.rotationY).toBe(1.5);
    expect(edited.clips).toEqual({ idle: 'Survey', walk: 'Run' });

    s.undo();
    const back = s.project.assets[0]!;
    expect(back.scale).toBe(0.012);
    expect(back.groundOffset).toBe(0);
    expect(back.rotationY).toBe(0);
    expect(back.clips).toBeUndefined();
  });

  it('drops the clip mapping entirely rather than storing empty names', () => {
    const s = session();
    s.run(addAsset(modelAssetSchema.parse({ ...fox(), clips: { idle: 'Survey' } })));
    s.run(updateAsset('fox', { clips: null }));
    const cleared = s.project.assets[0]!;
    expect(cleared.clips).toBeUndefined();
    expect('clips' in cleared).toBe(false);
  });

  it('leaves the url and id alone — replacing the file is a different act', () => {
    const s = session();
    s.run(addAsset(fox()));
    s.run(updateAsset('fox', { scale: 2 }));
    expect(s.project.assets[0]!.id).toBe('fox');
    expect(s.project.assets[0]!.url).toBe('/tests/fixtures/models/Fox.glb');
  });
});
