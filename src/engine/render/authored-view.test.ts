import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, Raycaster, Vector3 } from 'three';
import { NO_TILE } from '../grid/grid';
import { blankScene, gridFromScene } from '../scene/grid-from-scene';
import { SceneView } from './scene-view';
import { createPartyEntity, sceneStateFromScene } from '../scene/state';
import { interactableSchema } from '../scene/schema';
import { AssetLibrary, modelAssetSchema } from './assets';

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
  // Play draws no party start — that is where the party arrives, not a thing in the
  // room — but a chest is content, and stands there whether or not anybody is editing.
  view.setAuthoring(null);
  expect(view.root.getObjectByName('spawn:0')).toBeUndefined();
  expect(view.root.getObjectByName('object:chest'), 'a chest is in the room in play').toBeDefined();
  view.dispose();
});

it('draws a party start as the character who begins there, in the look play gives them', () => {
  const scene = blankScene('room', 4, 4);
  scene.spawns = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 3 }];
  const grid = gridFromScene(scene).grid;
  const view = new SceneView(grid);
  // Kara wears a model of her own; Mira wears whatever her class is drawn with; start 3 has nobody.
  view.setAuthoring(scene, { wizard: 'wizard-model' }, [{ model: 'kara-model', definition: 'guardian' }, { definition: 'wizard' }]);
  const asked = view.registry.missing();
  expect(asked).toContain('kara-model');
  expect(asked).toContain('wizard-model');
  expect(asked, "the sheet's own look beats the class's").not.toContain('guardian');
  // Each still answers to its start, so a press takes hold of it and a drag carries it.
  const kara = view.root.getObjectByName('spawn:0')!;
  expect(kara.position.x).toBe(-1.5);
  const rest = kara.position.y;
  view.lift('spawn', '0');
  for (let i = 0; i < 30; i++) view.tick(1 / 60);
  expect(kara.position.y).toBeGreaterThan(rest + 0.3);
  view.drop();
  // A start nobody fills is still drawn - the pawn - so it can be seen and moved.
  expect(view.root.getObjectByName('spawn:2')).toBeDefined();
  expect(view.root.children.filter((c) => c.name.startsWith('spawn:'))).toHaveLength(3);
  view.setAuthoring(null);
  expect(view.root.getObjectByName('spawn:0')).toBeUndefined();
  view.dispose();
});

it('draws a party start again when its model lands after the room was drawn', async () => {
  const scene = blankScene('room', 4, 4);
  scene.spawns = [{ x: 0, y: 0 }];
  const grid = gridFromScene(scene).grid;
  let land: (template: Group) => void = () => {};
  const library = new AssetLibrary(() => new Promise<Group>((resolve) => { land = resolve; }), [modelAssetSchema.parse({ id: 'kara-model', url: '/kara.glb' })]);
  const view = new SceneView(grid, { assets: library });
  view.setAuthoring(scene, {}, [{ model: 'kara-model', definition: 'guardian' }]);
  const kara = new BoxGeometry(1, 2, 1);
  // A clone shares its geometry with the file it was cloned from, so this is how Kara is told apart.
  const isKara = (): boolean => {
    let found = false;
    view.root.getObjectByName('spawn:0')!.traverse((part) => { if ((part as Mesh).geometry === kara) found = true; });
    return found;
  };
  // On its way: a stand-in.
  expect(isKara()).toBe(false);
  const body = new Group();
  body.add(new Mesh(kara));
  land(body);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Landed: the start is Kara now, and still the start a press takes hold of.
  expect(isKara()).toBe(true);
  expect(view.root.children.filter((c) => c.name.startsWith('spawn:'))).toHaveLength(1);
  view.setAuthoring(null);
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

it('points at a door that is a prop by the tile it stands on, though it hangs from its hinge', () => {
  const scene = blankScene('room', 4, 4);
  scene.decos = [{ model: 'stone-block', position: { x: 2, y: 1 }, rotation: 0, id: 'gate', function: { kind: 'door' } }];
  const grid = gridFromScene(scene).grid;
  const view = new SceneView(grid);
  view.setDecos(scene.decos);
  view.scene.updateMatrixWorld(true);
  const down = new Vector3(0, -1, 0);
  // Its hinge is on its edge, off the tile; a press must still take the door where it stands.
  expect(view.authoredUnder(new Raycaster(new Vector3(0.5, 10, -0.5), down))).toEqual({ x: 2, y: 1 });
  // And play lights it as the thing it is, as it lit the door it was before it was a prop.
  expect(view.objectUnder(new Raycaster(new Vector3(0.5, 10, -0.5), down))).toBe('gate');
  expect(view.objectUnder(new Raycaster(new Vector3(-1.5, 10, 1.5), down))).toBeNull();
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
