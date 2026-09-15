import { expect, it } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { NO_TILE } from '../grid/grid';
import { blankScene, gridFromScene } from '../scene/grid-from-scene';
import { SceneView } from './scene-view';
import { createPartyEntity, sceneStateFromScene } from '../scene/state';
import { interactableSchema } from '../scene/schema';

it('renders authored creatures beyond the board at their Z and removes them on undo/rebind', () => {
  const scene = blankScene('room', 4, 4);
  scene.encounters = [{
    id: 'enc',
    name: '',
    startsOnTrigger: true,
    triggerCells: [],
    adversaries: [{ id: 'wolf', adversary: 'dire-wolf', position: { x: -100, y: 900, z: 3.25 } }],
  }];
  const grid = gridFromScene(scene).grid;
  // A body rather than the magenta marker, exactly as the editor draws it.
  const view = new SceneView(grid, { fallbackFor: () => 'husk' });
  view.setAuthoring(scene);
  expect(view.authoredCreatureCount).toBe(1);
  const model = view.root.getObjectByName('authored-creature:wolf')!;
  expect(model.position.x).toBe(-101.5);
  expect(model.position.y).toBe(3.5);
  // Drawn, but still unresolved: substituting a body must not silence the
  // diagnostic that says which creatures are waiting for art.
  expect(view.registry.missing()).toEqual(['dire-wolf']);
  expect(view.modelSource('dire-wolf')).toBe('fallback:husk');
  view.syncTokens(sceneStateFromScene(scene, grid).state);
  expect(model.visible).toBe(true);
  scene.encounters[0]!.adversaries = [];
  view.setAuthoring(scene);
  expect(view.authoredCreatureCount).toBe(0);
  expect(view.root.getObjectByName('authored-creature:wolf')).toBeUndefined();
  view.setAuthoring(null);
  view.dispose();
});

it('draws a creature by its own override, else its type default, else its id', () => {
  const scene = blankScene('room', 4, 4);
  scene.encounters = [{
    id: 'enc',
    name: '',
    startsOnTrigger: true,
    triggerCells: [],
    adversaries: [
      { id: 'own', adversary: 'dire-wolf', position: { x: 0, y: 0 }, model: 'own-model' },
      { id: 'typed', adversary: 'dire-wolf', position: { x: 1, y: 0 } },
      { id: 'bare', adversary: 'lone-stray', position: { x: 2, y: 0 } },
    ],
  }];
  const grid = gridFromScene(scene).grid;
  const view = new SceneView(grid, { fallbackFor: () => 'husk' });
  view.setAuthoring(scene, { 'dire-wolf': 'typed-model' });
  expect(view.authoredCreatureCount).toBe(3);
  // None of these ids exist, so the registry names each one the view actually
  // asked for - which is how we can see which model each creature chose.
  const asked = view.registry.missing();
  expect(asked).toContain('own-model');
  expect(asked).toContain('typed-model');
  expect(asked).toContain('lone-stray');
  // The override beat the type default, and the type default beat the id.
  expect(asked).not.toContain('dire-wolf');
  view.setAuthoring(null);
  view.dispose();
});

it('draws party starts and objects while authoring, and lifts and drops what the editor carries', () => {
  const scene = blankScene('room', 4, 4);
  scene.spawns = [{ x: 0, y: 0 }, { x: 3, y: 3 }];
  scene.interactables = [interactableSchema.parse({ id: 'chest', kind: 'chest', position: { x: 2, y: 1 } })];
  const grid = gridFromScene(scene).grid;
  const view = new SceneView(grid);
  view.setAuthoring(scene);
  expect(view.root.getObjectByName('spawn:0')).toBeDefined();
  expect(view.root.getObjectByName('spawn:1')!.position.x).toBe(1.5);
  const chest = view.root.getObjectByName('object:chest')!;
  expect([chest.position.x, chest.position.z]).toEqual([0.5, -0.5]);

  const rest = chest.position.y;
  view.lift('object', 'chest');
  for (let i = 0; i < 30; i++) view.tick(1 / 60);
  expect(chest.position.y).toBeGreaterThan(rest + 0.3);
  view.drop('object', 'chest');
  for (let i = 0; i < 60; i++) view.tick(1 / 60);
  expect(chest.position.y).toBe(rest);

  // Rebuilt for the next edit, the marks are drawn once, not again beside the old ones.
  view.setAuthoring(scene);
  expect(view.root.children.filter((c) => c.name.startsWith('spawn:'))).toHaveLength(2);
  // Play draws neither.
  view.setAuthoring(null);
  expect(view.root.getObjectByName('spawn:0')).toBeUndefined();
  expect(view.root.getObjectByName('object:chest')).toBeUndefined();
  view.dispose();
});

it('finds the authored thing drawn under a ray, by the tile it stands on', () => {
  const scene = blankScene('room', 4, 4);
  scene.interactables = [interactableSchema.parse({ id: 'chest', kind: 'chest', position: { x: 2, y: 1 } })];
  // A wall four levels high on the next row, between the object and anyone looking from +Z.
  scene.heights[2 * 4 + 2] = 4;
  const grid = gridFromScene(scene).grid;
  const view = new SceneView(grid);
  view.setAuthoring(scene);
  view.scene.updateMatrixWorld(true);
  const down = new Vector3(0, -1, 0);
  // Straight down onto the object's mark: that tile, whatever ground is under it.
  expect(view.authoredUnder(new Raycaster(new Vector3(0.5, 10, -0.5), down))).toEqual({ x: 2, y: 1 });
  // Bare ground: nothing drawn there to take.
  expect(view.authoredUnder(new Raycaster(new Vector3(-1.5, 10, 1.5), down))).toBeNull();
  // Low from +Z, the wall is in front of the mark and hides it: a press there means the wall.
  const low = new Vector3(0.5, 1, 5);
  expect(view.authoredUnder(new Raycaster(low, new Vector3(0.5, 0.3, -0.5).sub(low).normalize()))).toBeNull();
  view.setAuthoring(null);
  view.dispose();
});

it('hands the board back without showing a token whose creature stands nowhere', () => {
  const scene = blankScene('room', 4, 4);
  const grid = gridFromScene(scene).grid;
  const view = new SceneView(grid);
  const { state } = sceneStateFromScene(scene, grid, {
    party: [createPartyEntity('kara', 'knight', 0), createPartyEntity('finn', 'rogue', 0)],
  });
  view.syncTokens(state);
  // Off the board: `poseToken` hides it, and leaving the editor must not undo that.
  state.moveEntity('finn', NO_TILE);
  view.syncTokens(state);
  expect(view.tokenFor('finn')!.group.visible).toBe(false);
  view.setAuthoring(scene);
  expect(view.tokenFor('kara')!.group.visible).toBe(false);
  view.setAuthoring(null);
  expect(view.tokenFor('kara')!.group.visible).toBe(true);
  expect(view.tokenFor('finn')!.group.visible).toBe(false);
  view.dispose();
});
