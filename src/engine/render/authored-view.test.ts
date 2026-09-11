import { expect, it } from 'vitest';
import { NO_TILE } from '../grid/grid';
import { blankScene, gridFromScene } from '../scene/grid-from-scene';
import { SceneView } from './scene-view';
import { createPartyEntity, sceneStateFromScene } from '../scene/state';

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
