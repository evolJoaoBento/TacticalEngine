import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { DEFAULT_TERRAIN_TYPES } from '../engine/grid/terrain';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { DEFAULT_TOOL_STATE, EditorController, type EditorTool } from './controller';
import { EditorSession, addScene, removeInteractable } from './session';
import { TERRAIN_RAIL } from './modes';
import type { Point } from '../engine/scene/schema';
import { addInteractable } from './session';

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

/**
 * A room whose palette has a kind of tile that is a structure.
 *
 * The engine's four are all ground - `wall` included, deliberately, so every cell painted
 * with it before the two halves were fused stays exactly what it was - so a test that
 * wants a piece stamped has to declare a kind that is one.
 */
function stacking(): { session: EditorSession; editor: EditorController; changes: string[] } {
  const project = projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', 8, 6))],
    startScene: 'room',
    terrainPalette: [
      { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false },
      { id: 'rampart', name: 'Rampart', passable: false, cost: 1, providesCover: true, blocksSight: true, structure: 'wall' },
    ],
  });
  const session = new EditorSession(project);
  const changes: string[] = [];
  const editor = new EditorController({ session, sceneId: 'room', onChange: (c) => changes.push(c) });
  return { session, editor, changes };
}

/** A press-drag-release across a row. */
function drag(editor: EditorController, y: number, from: number, to: number): void {
  editor.begin({ x: from, y });
  for (let x = from + 1; x <= to; x++) editor.paint({ x, y });
  editor.end();
}

/** The keys of the pieces a scene carries, in the order they were stamped. */
const stamped = (session: EditorSession): string[] =>
  Object.keys(session.requireScene('room').buildingTiles ?? {});

describe('placing tiles', () => {
  it('puts a piece down where it is clicked, and does not follow a drag', () => {
    const { editor, session } = stacking();
    editor.setTool('placeTile');
    editor.set('tileId', 'rampart');
    drag(editor, 0, 0, 3);

    // The press placed one; the drag across the next three did nothing. That is the
    // whole difference between a placer and the brush it replaced.
    expect(stamped(session)).toEqual(['0,0,0']);
  });

  it('places a square brush', () => {
    const { editor, session } = stacking();
    editor.setTool('placeTile');
    editor.set('tileId', 'rampart');
    editor.set('brushSize', 3);
    editor.begin({ x: 2, y: 2 });
    editor.end();

    expect(stamped(session)).toHaveLength(9);
    expect(stamped(session)).toContain('2,2,0');
  });

  it('places outside the room, because the building layer reaches past it', () => {
    // This asked the opposite question while the placer painted ground: a painted cell had
    // to be in the terrain array, so a click past the edge was ignored. A piece is not in
    // that array - it is keyed by its own coordinates and reaches a million tiles out - so
    // the click lands, and the room being 8 by 6 has nothing to do with it. (A thousand tiles
    // out it is scenery and stays so; within reach the room grows to it - `grow-scene.test.ts`.)
    const { editor, session, changes } = stacking();
    editor.setTool('placeTile');
    editor.set('tileId', 'rampart');
    expect(editor.begin({ x: 999, y: 0 })).toBe('terrain');
    editor.end();
    expect(stamped(session)).toEqual(['999,0,0']);
    expect(changes).toEqual(['terrain']);
  });

  it('does nothing at all when what is in hand is ground', () => {
    // Ground is still the substrate - every cell holds a kind, and it is still drawn - but
    // it stopped being something the placer puts down. A click with a kind of ground in
    // hand changes no document and asks for no redraw.
    const { editor, session, changes } = stacking();
    editor.setTool('placeTile');
    editor.set('tileId', 'floor');
    const before = session.requireScene('room').terrain.join(',');
    expect(editor.begin({ x: 1, y: 1 })).toBe('none');
    editor.end();
    expect(session.requireScene('room').terrain.join(',')).toBe(before);
    expect(stamped(session)).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('is one undo step per click, so two clicks are two', () => {
    const { editor, session } = stacking();
    editor.setTool('placeTile');
    editor.set('tileId', 'rampart');
    editor.begin({ x: 0, y: 0 });
    editor.end();
    editor.begin({ x: 1, y: 0 });
    editor.end();

    session.undo();
    expect(stamped(session)).toEqual(['0,0,0']);
  });
});

/**
 * The shape follows the kind in hand from the moment there is one.
 *
 * `set` has always derived it. The constructor did not, so the two halves of
 * `DEFAULT_TOOL_STATE` agreed only as long as somebody kept them agreeing by hand - and a
 * controller handed a kind at construction disagreed with itself from the start. The ghost
 * reads `buildShape` every frame, so that is a piece previewed wrong until the user picks
 * something, which is the moment they would have found out.
 */
describe('the shape of the kind in hand', () => {
  it('is derived for the kind the placer opens holding', () => {
    const { editor } = setup();
    expect(editor.state.tileId).toBe('platform');
    // A floor, not the `block` the constant beside it says.
    expect(editor.state.buildShape).toBe('floor');
  });

  it('is derived for a kind handed in at construction', () => {
    const project = projectSchema.parse({
      id: 'demo',
      name: 'Demo',
      scenes: [sceneSchema.parse(blankScene('room', 8, 6))],
      startScene: 'room',
      terrainPalette: [
        { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false },
        { id: 'rampart', name: 'Rampart', passable: false, cost: 1, providesCover: true, blocksSight: true, structure: 'wall' },
      ],
    });
    const editor = new EditorController({
      session: new EditorSession(project),
      sceneId: 'room',
      state: { tileId: 'rampart' },
    });
    expect(editor.state.buildShape).toBe('wall');
  });

  it('leaves the fallback alone for a kind this palette does not have', () => {
    // A project can declare a palette without the kind the engine opens on. Nothing
    // resolves, so there is nothing to derive, and the constant stands rather than the
    // shape becoming undefined under the ghost.
    const project = projectSchema.parse({
      id: 'demo',
      name: 'Demo',
      scenes: [sceneSchema.parse(blankScene('room', 8, 6))],
      startScene: 'room',
      terrainPalette: [
        { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false },
      ],
    });
    const editor = new EditorController({ session: new EditorSession(project), sceneId: 'room' });
    expect(editor.state.buildShape).toBe(DEFAULT_TOOL_STATE.buildShape);
  });
});

/**
 * The brush machinery a drag still uses.
 *
 * These were written against the ground painter, which dragged. The placer does not, so
 * they moved to Raise rather than being renamed: renamed, they would have passed because
 * `paint` returns early for a tool that is not continuous, which is green for the wrong
 * reason.
 */
describe('dragging a continuous tool', () => {
  it('acts on press and keeps acting through a drag', () => {
    const { editor, session } = setup();
    editor.setTool('raise');
    drag(editor, 0, 0, 3);
    expect(session.requireScene('room').heights.slice(0, 4)).toEqual([1, 1, 1, 1]);
  });

  it('steps back a tile at a time, because Raise does not coalesce a stroke', () => {
    const { editor, session } = setup();
    editor.setTool('raise');
    drag(editor, 0, 0, 5);
    expect(session.requireScene('room').heights.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1]);

    // `adjustHeight` carries no merge key, unlike the edit behind the placer, so six
    // tiles raised are six steps back rather than one. Asserting otherwise is what the
    // ground painter's tests used to do, and Raise never behaved that way.
    session.undo();
    expect(session.requireScene('room').heights[5]).toBe(0);
    expect(session.requireScene('room').heights[4]).toBe(1);
    expect(session.canUndo).toBe(true);
  });

  it('keeps the drag on one row off the row beside it', () => {
    const { editor, session } = setup();
    editor.setTool('raise');
    drag(editor, 0, 0, 2);
    drag(editor, 1, 0, 2);

    // Row 1 is tiles 8..10 on a width-8 scene; row 0 is 0..2. Undoing the last tile of
    // the second row leaves the first row alone.
    session.undo();
    expect(session.requireScene('room').heights[10]).toBe(0);
    expect(session.requireScene('room').heights[8]).toBe(1);
    expect(session.requireScene('room').heights[0]).toBe(1);
  });

  it('does not re-edit a tile the same stroke already crossed', () => {
    const { editor, changes } = setup();
    editor.setTool('raise');
    editor.begin({ x: 0, y: 0 });
    editor.paint({ x: 0, y: 0 });
    editor.paint({ x: 0, y: 0 });
    editor.end();
    expect(changes).toEqual(['terrain']);
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

describe('selecting a creature', () => {
  it('picks the placement under the pointer, and forgets it when the room changes', () => {
    const { editor } = setup();
    editor.setMode('combat');
    editor.set('adversaryId', 'bandit-cutter');
    editor.setTool('adversary');
    editor.begin({ x: 2, y: 2 });
    editor.end();

    editor.setTool('select');
    expect(editor.mode).toBe('combat');
    editor.begin({ x: 2, y: 2 });
    editor.end();
    expect(editor.selectedAdversary).not.toBeNull();
    expect(editor.selectedPlacement()?.adversary).toBe('bandit-cutter');

    editor.switchScene('room');
    expect(editor.selectedAdversary).toBeNull();
    expect(editor.selectedPlacement()).toBeNull();
  });

  it('clears the selection when the click lands on empty ground', () => {
    const { editor } = setup();
    editor.setMode('combat');
    editor.set('adversaryId', 'bandit-cutter');
    editor.setTool('adversary');
    editor.begin({ x: 2, y: 2 });
    editor.end();

    editor.setTool('select');
    editor.begin({ x: 2, y: 2 });
    editor.end();
    expect(editor.selectedAdversary).not.toBeNull();

    editor.begin({ x: 5, y: 5 });
    editor.end();
    expect(editor.selectedAdversary).toBeNull();
  });
});

describe('props', () => {
  it('turns the prop in hand, and puts it down facing that way in one step', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('buildRotation', 0);
    editor.begin({ x: 2, y: 2 });
    editor.end();

    // Picked up with Select, turned a quarter, and let go without moving it.
    editor.setMode('inspect');
    editor.setTool('select');
    editor.begin({ x: 2, y: 2 });
    expect(editor.carried).toMatchObject({ kind: 'prop', rotation: 0 });
    expect(editor.turnCarried(1), 'a quarter turn is a change').toBe(true);
    expect(editor.turnCarried(1), 'the same quarter twice is not').toBe(false);
    editor.end();

    const deco = session.requireScene('room').decos[0]!;
    expect(deco.rotation).toBeCloseTo(Math.PI / 2);
    expect(deco.position).toEqual({ x: 2, y: 2 });

    // The carry was one undo step, and the turn went with it.
    session.undo();
    expect(session.requireScene('room').decos[0]!.rotation).toBeCloseTo(0);
  });

  it('has nothing to turn with an empty hand', () => {
    const { editor } = setup();
    editor.setMode('inspect');
    editor.setTool('select');
    expect(editor.carriedFacing).toBeNull();
    expect(editor.turnCarried(1)).toBe(false);
  });

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

  it('places one across a block, and the whole block is then that one prop', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');
    editor.set('propSpan', 3);
    editor.begin({ x: 1, y: 1 });
    editor.end();

    const decos = () => session.requireScene('room').decos;
    expect(decos()).toHaveLength(1);
    expect(decos()[0]!.span).toBe(3);
    expect(decos()[0]!.position).toEqual({ x: 1, y: 1 });

    // A click on the far corner of the block is a click on the prop, so it turns rather than
    // dropping a second one on top of the first.
    editor.begin({ x: 3, y: 3 });
    editor.end();
    expect(decos()).toHaveLength(1);
    expect(decos()[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);

    // And a click one tile past the block is bare ground again.
    editor.begin({ x: 4, y: 3 });
    editor.end();
    expect(decos()).toHaveLength(2);
  });

  it('erases a block from anywhere inside it', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');
    editor.set('propSpan', 4);
    editor.begin({ x: 0, y: 0 });
    editor.end();

    editor.setTool('erase');
    editor.begin({ x: 2, y: 3 });
    editor.end();
    expect(session.requireScene('room').decos).toHaveLength(0);
  });

  it('says nothing about size for a prop of the ordinary size', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    // Absent, not one: a document should not carry a field for every prop that is normal.
    expect(Object.hasOwn(session.requireScene('room').decos[0]!, 'span')).toBe(false);
  });

  it('takes hold of a prop when it is placed, and turns it on the click after', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    // Placing takes hold of it, so the panel is aimed at what was just put down.
    expect(editor.selectedProp).toBe(0);
    expect(editor.selectedDeco?.model).toBe('crate');

    // A click on somebody else's prop takes hold rather than spinning it before it is looked at.
    editor.selectedProp = null;
    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(editor.selectedProp).toBe(0);
    expect(session.requireScene('room').decos[0]!.rotation).toBeCloseTo(0, 10);

    // The one after turns it, which is the rhythm the legacy editor had.
    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(session.requireScene('room').decos[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);
  });

  it('changes the prop it is holding, and lets go when that prop is erased', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');
    editor.begin({ x: 1, y: 1 });
    editor.end();

    expect(editor.resizeSelected(4)).toBe(true);
    expect(session.requireScene('room').decos[0]!.span).toBe(4);
    // Undoable like any other edit, and back to saying nothing rather than to saying one.
    session.undo();
    expect(Object.hasOwn(session.requireScene('room').decos[0]!, 'span')).toBe(false);

    editor.setTool('erase');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(editor.selectedProp).toBeNull();
    expect(editor.selectedDeco).toBeNull();
    // And nothing to change, so changing it is refused rather than throwing.
    expect(editor.resizeSelected(2)).toBe(false);
  });

  it('tells the board when the prop it is holding changes, so the room redraws at once', () => {
    const { editor, session, changes } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    changes.length = 0;

    // Running an edit off the session alone notifies the session's own subscribers, which redraw
    // the panels and nothing else: the prop went on being drawn at its old size until something
    // else happened to redraw the room, which in practice meant placing another prop.
    expect(editor.resizeSelected(3)).toBe(true);
    expect(session.requireScene('room').decos[0]!.span).toBe(3);
    expect(changes, 'the viewport was never told the prop changed').toContain('content');

    changes.length = 0;
    expect(editor.faceSelected(Math.PI)).toBe(true);
    expect(changes).toContain('content');

    // Nothing selected changes nothing, and says nothing.
    changes.length = 0;
    editor.selectedProp = null;
    expect(editor.resizeSelected(5)).toBe(false);
    expect(changes).toEqual([]);
  });

  it('saves the settings in hand as a remix, and takes it up again with them', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'barrel');
    editor.set('propSpan', 3);
    editor.set('buildRotation', 1);

    const id = editor.saveRemix()!;
    expect(id).not.toBeNull();
    expect(editor.propPresets).toHaveLength(1);
    expect(editor.propPresets[0]).toMatchObject({ id, model: 'barrel', span: 3 });
    expect(editor.propPresets[0]!.label).toBe('Barrel 3×3');

    // Set something else by hand, then take the remix up: the settings come back together.
    editor.set('propModel', 'crate');
    editor.set('propSpan', 1);
    editor.set('buildRotation', 0);
    editor.pickProp(id);
    expect(editor.state.propModel).toBe('barrel');
    expect(editor.state.propSpan).toBe(3);
    expect(editor.state.buildRotation).toBe(1);
    expect(editor.pickedPreset).toBe(id);

    // What it places is an ordinary prop: nothing on it remembers the remix.
    editor.begin({ x: 2, y: 1 });
    editor.end();
    const placed = session.requireScene('room').decos.at(-1)!;
    expect(placed).toEqual({ model: 'barrel', position: { x: 2, y: 1 }, rotation: Math.PI / 2, span: 3 });

    // Saving the same settings twice does not stack up duplicates.
    expect(editor.saveRemix()).toBe(id);
    expect(editor.propPresets).toHaveLength(1);

    // And forgetting it leaves what was placed from it alone.
    expect(editor.removeRemix(id)).toBe(true);
    expect(editor.propPresets).toHaveLength(0);
    expect(editor.pickedPreset).toBeNull();
    expect(session.requireScene('room').decos.at(-1)!.span).toBe(3);
  });

  it('marks a prop solid, keeps it out of the document when it is not, and undoes', () => {
    const { editor, session, changes } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'crate');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    const deco = () => session.requireScene('room').decos[0]!;
    // Scenery is what a prop has always been, so nothing is written for it.
    expect(Object.hasOwn(deco(), 'solid')).toBe(false);

    changes.length = 0;
    expect(editor.solidifySelected(true)).toBe(true);
    expect(deco().solid).toBe(true);
    // Not 'content': a solid prop bars the tiles it covers, the bars live on the grid, and only
    // a terrain change rebuilds the grid. Reported as content, the prop would look like an
    // obstacle and a walk would stroll straight through it until something else rebuilt the room.
    expect(changes, 'a prop that stops a walk is a change to the ground').toContain('terrain');

    session.undo();
    expect(Object.hasOwn(deco(), 'solid')).toBe(false);

    // And placed solid from the off when the tool is holding it - which is a ground change too.
    changes.length = 0;
    editor.set('propSolid', true);
    editor.begin({ x: 4, y: 1 });
    editor.end();
    expect(session.requireScene('room').decos.at(-1)!.solid).toBe(true);
    expect(changes).toContain('terrain');

    // Erasing one takes its bars away, so that is a ground change as well; erasing scenery is not.
    changes.length = 0;
    editor.setTool('erase');
    editor.begin({ x: 4, y: 1 });
    editor.end();
    expect(changes).toContain('terrain');
  });

  it('saves whether a prop is an obstacle in the remix, and says so in its name', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'rock');
    editor.set('propSpan', 3);
    editor.set('propSolid', true);
    const id = editor.saveRemix()!;
    expect(editor.propPresets[0]).toMatchObject({ model: 'rock', span: 3, solid: true });
    // Named apart from the scenery version, which is otherwise the same card twice.
    expect(editor.propPresets[0]!.label).toBe('Rock 3×3 · solid');

    editor.set('propSolid', false);
    editor.set('propSpan', 1);
    editor.pickProp(id);
    expect(editor.state.propSolid).toBe(true);
    expect(editor.state.propSpan).toBe(3);

    editor.begin({ x: 2, y: 2 });
    editor.end();
    expect(session.requireScene('room').decos.at(-1)).toMatchObject({ model: 'rock', span: 3, solid: true });

    // The scenery version of the same model and size is a remix of its own, not a clash.
    editor.set('propSolid', false);
    const plain = editor.saveRemix()!;
    expect(plain).not.toBe(id);
    expect(editor.propPresets).toHaveLength(2);
  });

  it('picks a bare model as a bare model, leaving the size alone', () => {
    const { editor } = setup();
    editor.setTool('prop');
    editor.set('propSpan', 5);
    editor.pickProp('rock');
    expect(editor.state.propModel).toBe('rock');
    // Not a remix, so it says nothing about size: what is in hand stays in hand.
    expect(editor.state.propSpan).toBe(5);
    expect(editor.pickedPreset).toBeNull();
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

/**
 * An object, as a document from before objects became props may still hold one. There is no tool to
 * place one any more, so a test that needs one puts it in the document.
 */
function anObject(id: string, at: { x: number; y: number }): Parameters<typeof addInteractable>[1] {
  return { id, kind: 'chest', position: at, name: '', flavor: '', model: null, rotation: 0, blocksMovement: true, repeatable: false, effects: [], lockedText: '', tags: [], data: {} };
}

describe('props that do something', () => {
  it('places one with a function under a positional id, the way objects were always named', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'door');
    editor.set('propFunction', { kind: 'door' });
    editor.begin({ x: 2, y: 3 });
    editor.end();
    const placed = session.requireScene('room').decos.at(-1)!;
    expect(placed).toMatchObject({ id: 'door-2-3', model: 'door', function: { kind: 'door' } });
    // Nothing is placed as an object any more.
    expect(session.requireScene('room').interactables).toHaveLength(0);
  });

  it('gives two on different tiles different ids, and never reuses one', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'chest');
    editor.set('propFunction', { kind: 'container', items: [] });
    for (const at of [{ x: 1, y: 1 }, { x: 2, y: 1 }]) {
      editor.begin(at);
      editor.end();
    }
    expect(session.requireScene('room').decos.map((deco) => deco.id)).toEqual(['chest-1-1', 'chest-2-1']);
  });

  it('places plain scenery with no id and no function, as it always did', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.begin({ x: 1, y: 1 });
    editor.end();
    const placed = session.requireScene('room').decos.at(-1)!;
    expect(Object.hasOwn(placed, 'id')).toBe(false);
    expect(Object.hasOwn(placed, 'function')).toBe(false);
  });

  it('gives a prop already down a function, and an id to be found by, and undoes both', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'barrel');
    editor.begin({ x: 3, y: 2 });
    editor.end();
    expect(editor.setSelectedFunction({ kind: 'trapped', trait: 'agility', difficulty: 11, repeatable: true, success: { kind: 'door' } })).toBe(true);
    const deco = () => session.requireScene('room').decos.at(-1)!;
    expect(deco()).toMatchObject({ id: 'barrel-3-2', function: { kind: 'trapped', success: { kind: 'door' } } });
    session.undo();
    expect(Object.hasOwn(deco(), 'function')).toBe(false);
    expect(Object.hasOwn(deco(), 'id')).toBe(false);
  });

  it('will not hand a third prop a pair two portals already hold, and empties it for choosing again', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'portal');
    editor.set('propFunction', { kind: 'portal', pair: 'gate' });
    for (const at of [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 1, y: 4 }]) {
      editor.begin(at);
      editor.end();
    }
    const pairs = session.requireScene('room').decos.map((deco) => (deco.function?.kind === 'portal' ? deco.function.pair : null));
    expect(pairs).toEqual(['gate', 'gate', '']);
    expect(editor.pairTakenBy('gate', 'someone-else')).toEqual(['portal-1-1', 'portal-4-1']);
  });

  it('remembers a function in a remix, and places it again from there', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.set('propModel', 'chest');
    editor.set('propFunction', { kind: 'container', items: [{ item: 'gold', count: 3 }] });
    const id = editor.saveRemix()!;
    expect(editor.propPresets[0]!.label).toBe('Chest · Container');
    editor.set('propFunction', undefined);
    editor.pickProp(id);
    editor.begin({ x: 5, y: 2 });
    editor.end();
    expect(session.requireScene('room').decos.at(-1)!.function).toEqual({ kind: 'container', items: [{ item: 'gold', count: 3 }] });
    // A different container is a different remix, not the same one saved twice.
    editor.set('propFunction', { kind: 'container', items: [{ item: 'gold', count: 1 }] });
    expect(editor.saveRemix()).not.toBe(id);
  });
});

describe('encounters', () => {
  it('creates one on the first adversary placed, rather than demanding a panel trip', () => {
    const { editor, session } = setup();
    editor.setTool('adversary');
    editor.set('adversaryId', 'bandit-cutter');

    editor.begin({ x: 4, y: 2 });
    editor.end();

    const scene = session.requireScene('room');
    expect(scene.encounters).toHaveLength(1);
    expect(scene.encounters[0]!.adversaries).toHaveLength(1);
    expect(scene.encounters[0]!.adversaries[0]!.adversary).toBe('bandit-cutter');
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
    session.run(addInteractable('room', anObject('chest-1-1', { x: 1, y: 1 })));
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
  it('changes nothing dragged across bare ground', () => {
    const { editor, session, changes } = setup();
    editor.setTool('select');
    // Row 2: the room's one party start is at 0,0, and a press there would carry it off.
    drag(editor, 2, 0, 4);
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
    expect(found.deco?.model).toBe('crate-prop');
    expect(found.encounters).toHaveLength(1);
    expect(found.isSpawn).toBe(false);
    expect(editor.inspect({ x: 0, y: 0 }).isSpawn).toBe(true);
  });
});

describe('change notifications', () => {
  it('says which half of the view needs rebuilding', () => {
    const { editor, changes } = stacking();
    editor.setTool('placeTile');
    editor.set('tileId', 'rampart');
    editor.begin({ x: 0, y: 0 });
    // Ground in hand: the click does nothing, so it asks for no rebuild. Said explicitly
    // because the old shape of this test passed either way - it opened holding the kind
    // every cell already was, so its first click was a no-op for a different reason.
    editor.set('tileId', 'floor');
    editor.begin({ x: 1, y: 0 });
    editor.end();

    editor.setTool('prop');
    editor.begin({ x: 2, y: 0 });
    editor.end();

    expect(changes).toEqual(['terrain', 'content']);
  });

  it('ends any drag when the tool changes', () => {
    const { editor, session } = setup();
    editor.setTool('raise');
    editor.begin({ x: 0, y: 0 });
    editor.setTool('lower');
    // The drag is over, so this move does nothing.
    editor.paint({ x: 1, y: 0 });
    expect(session.requireScene('room').heights[1]).toBe(0);
  });
});

describe('every tool is safe to use on an empty scene', () => {
  it('never throws, whatever is selected', () => {
    const tools: EditorTool[] = [
      'select',
      'placeTile',
      'raise',
      'lower',
      'prop',
      'spawn',
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
    s.run(addInteractable('room', anObject('chest-2-2', { x: 2, y: 2 })));
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
    expect(editor.state.tool).toBe('placeTile');
    expect(editor.mode).toBe('terrain');
  });

  it('choosing a tool chooses its mode', () => {
    const { editor } = setup();
    editor.setTool('adversary');
    expect(editor.mode).toBe('combat');
    editor.setTool('prop');
    expect(editor.mode).toBe('terrain');
  });

  it('keeps a tool two modes share in the one that already owns it', () => {
    const { editor } = setup();
    editor.setTool('adversary');
    expect(editor.mode).toBe('combat');
    // Combat owns select as well, now that a creature's panel is opened with it,
    // so picking it stays put rather than throwing the user to the Inspector.
    editor.setTool('select');
    expect(editor.mode).toBe('combat');
    // Terrain owns it too, so laying a room out and nudging what is already in it are one
    // mode: picking Select there stays there rather than throwing the user to the Inspector.
    // There is no mode left that does not own Select, which is why nothing here shows the
    // fall back to the Inspector any more - `modes.test.ts` shows it with another tool.
    editor.setTool('placeTile');
    expect(editor.mode).toBe('terrain');
    editor.setTool('select');
    expect(editor.mode).toBe('terrain');
    expect(editor.terrainTab).toBe('tiles');
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
    editor.setTool('raise');
    editor.begin({ x: 0, y: 0 });
    editor.setMode('combat');
    editor.paint({ x: 1, y: 0 });
    expect(session.requireScene('room').heights[1]).toBe(0);
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
    // One tab for the ground and for what stacks on it, so it hands over the placer.
    expect(editor.state.tool).toBe('placeTile');
    expect(TERRAIN_RAIL[editor.terrainTab]).toEqual(['eraseTile', 'raise', 'lower', 'select']);

    // Erase belongs to Props, never to Tiles: picking it from the
    // Tiles tab must move the strip rather than leave the tool off the rail.
    editor.setTool('erase');
    expect(editor.terrainTab).toBe('props');
    expect(TERRAIN_RAIL[editor.terrainTab]).toContain('erase');
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
    editor.openTerrainTab('props');
    editor.setMode('combat');
    expect(editor.state.tool).toBe('adversary');
    editor.setMode('terrain');
    expect(editor.terrainTab).toBe('props');
    expect(editor.state.tool).toBe('prop');
  });

  it('hands the placer back when Terrain is re-entered after a look at something', () => {
    // Terrain owns Select, so `setMode`'s rule about keeping one of its own tools would
    // have kept it - and that special case earns its keep. Nobody reaches for Select: the
    // Inspector hands it over on entry, so holding it on the way back means having glanced
    // at an object, not having chosen a tool. Keeping it took the placer out of the hand of
    // anyone who looked at anything, and broke the Z ladder with it, because the ladder
    // follows what is being placed.
    const { editor } = setup();
    editor.setMode('terrain');
    editor.openTerrainTab('props');
    editor.setMode('inspect');
    expect(editor.state.tool).toBe('select');
    editor.setMode('terrain');
    expect(editor.terrainTab).toBe('props');
    expect(editor.state.tool).toBe('prop');
  });

  it('keeps Select when it was picked in Terrain, rather than arrived with', () => {
    // Picking it off the rail is a choice, and it survives a tab change the way any tool
    // the open tab owns does.
    const { editor } = setup();
    editor.setMode('terrain');
    editor.setTool('select');
    expect(editor.mode).toBe('terrain');
    expect(editor.state.tool).toBe('select');
    expect(TERRAIN_RAIL[editor.terrainTab]).toContain('select');
  });

  it('says once that the plane moved, so a view follows the change and not the level', () => {
    const { editor } = setup();
    expect(editor.takeLevelChange()).toBe(false);

    editor.setBuildLevel(2);
    expect(editor.takeLevelChange()).toBe(true);
    // Asked twice, answered once: a camera held at the plane every frame is a camera
    // that cannot be moved off it, which is what this replaced.
    expect(editor.takeLevelChange()).toBe(false);

    // Setting the level it is already on is not a move.
    editor.setBuildLevel(2);
    expect(editor.takeLevelChange()).toBe(false);
    editor.setBuildLevel(-1.25);
    expect(editor.takeLevelChange()).toBe(true);
  });

  it('ends the drag when the build plane moves, so a stroke cannot span two storeys', () => {
    const { editor, session } = stacking();
    editor.setTool('placeTile');
    editor.set('tileId', 'rampart');
    editor.begin({ x: 0, y: 0 });
    editor.setBuildLevel(2.25);
    editor.begin({ x: 0, y: 0 });
    editor.end();
    expect(Object.keys(session.requireScene('room').buildingTiles ?? {})).toEqual(['0,0,0', '0,0,2.25']);
    session.undo();
    expect(Object.keys(session.requireScene('room').buildingTiles ?? {})).toEqual(['0,0,0']);
  });
});

describe('moving a creature', () => {
  const placed = (session: EditorSession) => session.requireScene('room').encounters[0]!.adversaries;

  it('picks it up with Select and drops it where the pointer lets go, as one undo step', () => {
    const { editor, session } = setup();
    editor.setMode('combat');
    editor.setTool('adversary');
    editor.begin({ x: 2, y: 2 });
    editor.end();

    editor.setTool('select');
    editor.begin({ x: 2, y: 2 });
    editor.paint({ x: 3, y: 2 });
    editor.paint({ x: 4, y: 3 });
    editor.end();
    expect(placed(session).map((p) => p.position)).toEqual([{ x: 4, y: 3 }]);
    expect(editor.selectedPlacement()?.position).toEqual({ x: 4, y: 3 });

    session.undo();
    expect(placed(session).map((p) => p.position)).toEqual([{ x: 2, y: 2 }]);
  });

  it('picks it up with the place tool too, rather than stacking a second creature on it', () => {
    const { editor, session } = setup();
    editor.setMode('combat');
    editor.setTool('adversary');
    editor.begin({ x: 2, y: 2 });
    editor.end();

    editor.begin({ x: 2, y: 2 });
    editor.paint({ x: 5, y: 4 });
    editor.end();
    expect(placed(session).map((p) => p.position)).toEqual([{ x: 5, y: 4 }]);
    // A press on bare ground still places a new one.
    editor.begin({ x: 1, y: 1 });
    editor.end();
    expect(placed(session)).toHaveLength(2);
  });

  it('never drops it onto another creature, and a press without a drag is no edit', () => {
    const { editor, session } = setup();
    editor.setMode('combat');
    editor.setTool('adversary');
    editor.begin({ x: 2, y: 2 });
    editor.end();
    editor.begin({ x: 4, y: 2 });
    editor.end();
    const label = session.undoLabel;

    editor.setTool('select');
    editor.begin({ x: 2, y: 2 });
    editor.end();
    expect(session.undoLabel).toBe(label);

    editor.begin({ x: 2, y: 2 });
    editor.paint({ x: 3, y: 2 });
    editor.paint({ x: 4, y: 2 });
    editor.end();
    // It waited on the last free tile rather than landing on the other one.
    expect(placed(session).map((p) => p.position)).toEqual([{ x: 3, y: 2 }, { x: 4, y: 2 }]);
  });
});

describe('carrying things in the Inspector', () => {
  /** A prop at 1,1, an object at 2,2 and a creature at 3,3, beside the room's party start at 0,0; the Inspector's Select in hand. */
  function furnished(): { editor: EditorController; session: EditorSession; scene: () => ReturnType<EditorSession['requireScene']> } {
    const { editor, session } = setup();
    for (const [tool, at] of [['prop', { x: 1, y: 1 }], ['adversary', { x: 3, y: 3 }]] as const) {
      editor.setTool(tool);
      editor.begin(at);
      editor.end();
    }
    // An object, as a document from before objects became props may still hold: there is no tool to place one now.
    session.run(addInteractable('room', anObject('chest-2-2', { x: 2, y: 2 })));
    editor.setMode('inspect');
    return { editor, session, scene: () => session.requireScene('room') };
  }

  const carry = (editor: EditorController, from: Point, to: Point): void => {
    editor.begin(from);
    editor.paint(to);
    editor.end();
  };

  it('carries a prop, an object, a creature and a party start, each one undo step', () => {
    const { editor, session, scene } = furnished();
    expect(editor.state.tool).toBe('select');
    carry(editor, { x: 1, y: 1 }, { x: 1, y: 4 });
    carry(editor, { x: 2, y: 2 }, { x: 2, y: 4 });
    carry(editor, { x: 3, y: 3 }, { x: 3, y: 4 });
    carry(editor, { x: 0, y: 0 }, { x: 0, y: 4 });
    expect(scene().decos[0]!.position).toEqual({ x: 1, y: 4 });
    expect(scene().interactables[0]!.position).toEqual({ x: 2, y: 4 });
    expect(scene().encounters[0]!.adversaries[0]!.position).toEqual({ x: 3, y: 4 });
    expect(scene().spawns).toEqual([{ x: 0, y: 4 }]);
    for (const label of ['Move party start', 'Move creature', 'Move object', 'Move prop']) {
      expect(session.undoLabel).toBe(label);
      session.undo();
    }
    expect(scene().decos[0]!.position).toEqual({ x: 1, y: 1 });
    expect(scene().interactables[0]!.position).toEqual({ x: 2, y: 2 });
    expect(scene().encounters[0]!.adversaries[0]!.position).toEqual({ x: 3, y: 3 });
    expect(scene().spawns).toEqual([{ x: 0, y: 0 }]);
  });

  it('says what it carries while the pointer is down, and selects an object it picks up', () => {
    const { editor, scene } = furnished();
    editor.begin({ x: 2, y: 2 });
    // An object reports the facing it will land with, as a prop does.
    expect(editor.carried).toEqual({ kind: 'object', key: scene().interactables[0]!.id, rotation: 0 });
    expect(editor.selected).toBe(scene().interactables[0]!.id);
    editor.end();
    expect(editor.carried).toBeNull();
    editor.begin({ x: 1, y: 1 });
    // A prop reports the facing it will land with; nothing else has one.
    expect(editor.carried).toEqual({ kind: 'prop', key: '0', rotation: 0 });
    // A prop has no panel of its own: the Inspector says what to click, as for bare ground.
    expect(editor.selected).toBeNull();
    editor.end();
  });

  it('turns an object in hand, as it turns a prop: a door hangs the way it is faced', () => {
    const { editor, scene } = furnished();
    const object = () => scene().interactables[0]!;
    const at = { ...object().position };
    editor.begin(at);
    expect(editor.carried).toMatchObject({ kind: 'object' });
    expect(editor.carriedFacing, 'an object has a facing to turn').toBe(0);
    expect(editor.turnCarried(1)).toBe(true);
    editor.end();

    expect(object().rotation).toBeCloseTo(Math.PI / 2);
    expect(object().position).toEqual(at);

    // A creature has none: the same gesture leaves it alone.
    editor.begin({ x: 3, y: 3 });
    expect(editor.carried).toMatchObject({ kind: 'creature' });
    expect(editor.carriedFacing).toBeNull();
    expect(editor.turnCarried(1)).toBe(false);
    editor.end();
  });

  it('moves nothing until the pointer lets go', () => {
    const { editor, scene } = furnished();
    editor.begin({ x: 3, y: 3 });
    editor.paint({ x: 5, y: 5 });
    expect(scene().encounters[0]!.adversaries[0]!.position).toEqual({ x: 3, y: 3 });
    editor.end();
    expect(scene().encounters[0]!.adversaries[0]!.position).toEqual({ x: 5, y: 5 });
  });

  it('never puts an object on another, nor a party start on another or outside the room', () => {
    const { editor, session, scene } = furnished();
    session.run(addInteractable('room', anObject('chest-5-2', { x: 5, y: 2 })));
    editor.setTool('spawn');
    editor.begin({ x: 0, y: 2 });
    editor.end();
    editor.setMode('inspect');
    const label = session.undoLabel;

    carry(editor, { x: 2, y: 2 }, { x: 5, y: 2 });
    carry(editor, { x: 0, y: 0 }, { x: 0, y: 2 });
    carry(editor, { x: 0, y: 0 }, { x: -1, y: 0 });
    expect(session.undoLabel).toBe(label);
    expect(scene().interactables.map((i) => i.position)).toEqual([{ x: 2, y: 2 }, { x: 5, y: 2 }]);
    expect(scene().spawns).toEqual([{ x: 0, y: 0 }, { x: 0, y: 2 }]);
  });

  it('carries a thing at its own height, whatever level the ladder was left on', () => {
    const { editor, session, scene } = furnished();
    editor.setTool('adversary');
    editor.setBuildLevel(2);
    editor.begin({ x: 5, y: 1 });
    editor.end();
    editor.setMode('inspect');
    const raised = () => scene().encounters[0]!.adversaries[1]!.position;
    expect(raised()).toEqual({ x: 5, y: 1, z: 2 });
    const label = session.undoLabel;

    // A jitter on the same tile is no move, and does not drop it to the ground.
    carry(editor, { x: 5, y: 1 }, { x: 5, y: 1 });
    expect(session.undoLabel).toBe(label);
    expect(raised()).toEqual({ x: 5, y: 1, z: 2 });
    carry(editor, { x: 5, y: 1 }, { x: 5, y: 3 });
    expect(raised()).toEqual({ x: 5, y: 3, z: 2 });
    // A prop on the ground stays there with the ladder still at 2.
    carry(editor, { x: 1, y: 1 }, { x: 1, y: 3 });
    expect(scene().decos[0]!.position).toEqual({ x: 1, y: 3 });
  });

  it('stacks a prop on another, as placing one does', () => {
    const { editor, scene } = furnished();
    editor.setTool('prop');
    editor.set('propModel', 'barrel');
    editor.begin({ x: 4, y: 1 });
    editor.end();
    editor.setMode('inspect');
    carry(editor, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(scene().decos.map((d) => d.position)).toEqual([{ x: 4, y: 1 }, { x: 4, y: 1 }]);
  });
});

describe('changing what kinds of tile a project has', () => {
  const bog = { id: 'bog', name: 'Bog', passable: true, cost: 2, providesCover: false, blocksSight: false };

  it('tells the board, because a kind of tile is the ground itself', () => {
    const { editor, session, changes } = setup();
    expect(editor.addTile(bog)).toBe(true);

    // Not just the panel: 'terrain' is what rebuilds the ground from the palette.
    expect(changes).toEqual(['terrain']);
    expect(session.project.terrainPalette!.map((t) => t.id)).toContain('bog');
  });

  it('says so for a change and for a removal too', () => {
    const { editor, changes } = setup();
    editor.addTile(bog);
    expect(editor.updateTile('bog', { cost: 3 })).toBe(true);
    expect(editor.removeTile('bog')).toBe(true);
    expect(changes).toEqual(['terrain', 'terrain', 'terrain']);
  });

  it('writes the engine kinds down first, so the others do not vanish', () => {
    const { editor, session } = setup();
    editor.addTile(bog);
    // A palette of one would say the project had one kind of ground, and every scene
    // painted on the rest would fall back to it. Taken from the engine's own list rather
    // than spelled out here: it grew when the stackable kinds arrived, and a copy of it in
    // a test is a copy that goes stale.
    expect(session.project.terrainPalette!.map((t) => t.id)).toEqual([
      ...DEFAULT_TERRAIN_TYPES.map((t) => t.id),
      'bog',
    ]);
  });

  it('is not a change, and tells nobody, when the id is already taken', () => {
    const { editor, changes } = setup();
    editor.addTile(bog);
    changes.length = 0;

    expect(editor.addTile({ ...bog, name: 'Other Bog' })).toBe(false);
    expect(changes).toEqual([]);
  });
});
