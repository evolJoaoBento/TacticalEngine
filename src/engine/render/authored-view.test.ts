import { expect, it } from 'vitest';
import { blankScene, gridFromScene } from '../scene/grid-from-scene';
import { SceneView } from './scene-view';
import { sceneStateFromScene } from '../scene/state';

it('renders authored creatures beyond the board at their Z and removes them on undo/rebind', () => {
  const scene = blankScene('room', 4, 4);
  scene.encounters = [{ id: 'enc', name: '', startsOnTrigger: true, triggerCells: [], adversaries: [
    { id: 'wolf', adversary: 'dire-wolf', position: { x: -100, y: 900, z: 3.25 } },
  ] }];
  const grid = gridFromScene(scene).grid;
  const view = new SceneView(grid);
  view.setAuthoring(scene);
  expect(view.authoredCreatureCount).toBe(1);
  const model = view.root.getObjectByName('authored-creature:wolf')!;
  expect(model.position.x).toBe(-101.5); expect(model.position.y).toBe(3.5);
  expect(view.registry.missing()).toEqual([]);
  view.syncTokens(sceneStateFromScene(scene, grid).state);
  expect(model.visible).toBe(true);
  scene.encounters[0]!.adversaries = [];
  view.setAuthoring(scene); expect(view.authoredCreatureCount).toBe(0);
  expect(view.root.getObjectByName('authored-creature:wolf')).toBeUndefined();
  view.setAuthoring(null); view.dispose();
});
