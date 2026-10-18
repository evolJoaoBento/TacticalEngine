import { describe, expect, it, vi } from 'vitest';
import { Color, InstancedMesh, PerspectiveCamera, Texture } from 'three';
import { blankScene } from '../scene/grid-from-scene';
import { BUILD_MATERIALS, buildingKey, type BuildingTile } from '../scene/building';
import { TerrainPalette, terrain } from '../grid/terrain';
import { BuildingView, BUILD_RESIDENT_LIMIT } from './building-view';
import { SurfaceLibrary } from './surface-library';

/** A view over the given pieces, and a camera that can be put at a distance from them. */
function setup(tiles: BuildingTile[]) {
  const scene = blankScene('room', 1, 1);
  scene.buildingTiles = Object.fromEntries(tiles.map((tile) => [buildingKey(tile), tile]));
  const view = new BuildingView();
  view.sync(scene);
  const camera = new PerspectiveCamera(60, 1.5, 0.1, 500);
  const look = (distance: number, x = 0): void => {
    camera.position.set(x, distance * 0.6, distance * 0.8);
    camera.lookAt(x, 0, 0);
    view.update(camera);
  };
  return { view, scene, camera, look };
}

/** Stairs, because they are the one shape whose far LOD has fewer boxes. */
const tile = (x = 0, y = 0, level = 0): BuildingTile => ({
  x,
  y,
  level,
  shape: 'stairs',
  material: 'stone',
  rotation: 0,
});

describe('building chunk LOD', () => {
  it('reduces actual triangles and stair instances with distance, then unloads', () => {
    const { view, look } = setup([tile()]);
    look(10);
    const near = view.stats();
    expect(near.lods).toEqual([1, 0, 0]);
    expect(near.instances).toBe(4);
    look(60);
    const middle = view.stats();
    expect(middle.lods).toEqual([0, 1, 0]);
    expect(middle.triangles).toBeLessThan(near.triangles);
    look(105);
    const far = view.stats();
    expect(far.lods).toEqual([0, 0, 1]);
    expect(far.instances).toBe(1);
    expect(far.triangles).toBe(12);
    look(300);
    expect(view.stats().residentChunks).toBe(0);
    view.dispose();
  });
  it('keeps distant islands sparse and renders negative coordinates with local matrices', () => {
    const { view, look } = setup([tile(-999_999), tile(999_999)]);
    look(10, -999_999);
    expect(view.stats().chunks).toBe(2);
    expect(view.stats().residentChunks).toBe(1);
    const mesh = view.root.children.find((c) => c instanceof InstancedMesh) as InstancedMesh;
    expect(Math.max(...Array.from(mesh.instanceMatrix.array).map(Math.abs))).toBeLessThan(17);
    const release = vi.spyOn(mesh, 'dispose');
    look(10, 999_999);
    expect(release).toHaveBeenCalledOnce();
    expect(view.stats().residentChunks).toBe(1);
    view.dispose();
  });
  it('culls chunks behind the camera and preserves unchanged buffers on edits', () => {
    const { view, scene, camera, look } = setup([tile(), tile(0, 100)]);
    look(10);
    expect(view.stats().residentChunks).toBe(1);
    const mesh = view.root.children.find((c) => c instanceof InstancedMesh)!;
    scene.buildingTiles!['2000,0,0'] = tile(2000);
    view.sync(scene);
    view.update(camera);
    expect(view.root.children).toContain(mesh);
    view.dispose();
  });
  it('caps residency and builds at most two chunks per frame', () => {
    const tiles: BuildingTile[] = [];
    for (let x = -6; x <= 6; x++) {
      for (let y = -6; y <= 6; y++) tiles.push(tile(x * 16, y * 16));
    }
    const { view, look, camera } = setup(tiles);
    look(90);
    expect(view.stats().residentChunks).toBeLessThanOrEqual(2);
    for (let i = 0; i < 60; i++) view.update(camera);
    expect(view.stats().residentChunks).toBeGreaterThan(2);
    expect(view.stats().residentChunks).toBeLessThanOrEqual(BUILD_RESIDENT_LIMIT);
    view.dispose();
  });
});

describe('pieces drawn in an imported material', () => {
  const maps = { color: 'c', normalHeight: 'n', orm: 'o' };
  const bricks = { id: 'bricks', name: 'Bricks', maps, parallax: true, size: 1, depth: 0.06, normalScale: 1, roughness: 1, tint: 0 };
  const palette = new TerrainPalette([
    terrain('grass'),
    terrain('bricks-wall', { structure: 'wall', surface: 'bricks', color: '#884422' }),
    terrain('crate', { structure: 'block', model: 'crate', surface: 'bricks' }),
  ]);
  const piece = (x: number, kind?: string): BuildingTile => ({ x, y: 0, level: 0, shape: 'wall', material: 'stone', rotation: 0, ...(kind === undefined ? {} : { tile: kind }) });

  /** A library whose maps land when the test says. */
  function surfaces() {
    const waiting: (() => void)[] = [];
    const library = new SurfaceLibrary(() => new Promise<Texture>((done) => waiting.push(() => done(new Texture()))));
    library.add(bricks);
    const land = async (): Promise<void> => {
      for (const give of waiting.splice(0)) give();
      await new Promise((settle) => setTimeout(settle, 0));
    };
    return { library, land };
  }

  function drawn(tiles: BuildingTile[], library?: SurfaceLibrary) {
    const scene = blankScene('room', 1, 1);
    scene.buildingTiles = Object.fromEntries(tiles.map((t) => [buildingKey(t), t]));
    const view = new BuildingView(library === undefined ? {} : { surfaces: library });
    view.sync(scene, palette);
    const camera = new PerspectiveCamera(60, 1.5, 0.1, 500);
    const look = (distance: number): void => {
      camera.position.set(0, distance * 0.6, distance * 0.8);
      camera.lookAt(0, 0, 0);
      view.update(camera);
    };
    const meshes = (): InstancedMesh[] => view.root.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    return { view, scene, look, meshes };
  }

  const colourOf = (mesh: InstancedMesh, i: number): string => {
    const c = new Color();
    mesh.getColorAt(i, c);
    return `#${c.getHexString()}`;
  };

  it('draws a piece in its material once the maps are in - its kind\'s colour until then - beside a plain one, each mesh its own', async () => {
    const { library, land } = surfaces();
    const { view, look, meshes } = drawn([piece(0), piece(1, 'bricks-wall')], library);
    look(10);
    // Not in yet: both plain boxes, the textured one in its kind's colour.
    expect(meshes()).toHaveLength(1);
    expect(colourOf(meshes()[0]!, 1)).toBe('#884422');
    await land();
    look(10);
    const [plain, textured] = [meshes().find((m) => !m.name.endsWith(':bricks'))!, meshes().find((m) => m.name.endsWith(':bricks'))!];
    expect(plain.material).not.toBe(textured.material);
    expect(textured.material).toBe(library.materialFor('bricks'));
    // Its kind's colour, which the material takes as far as its tint says.
    expect(colourOf(textured, 0)).toBe('#884422');
    expect(colourOf(plain, 0)).toBe(`#${new Color(BUILD_MATERIALS.stone).getHexString()}`);
    // Far off, the flat material: the same maps, no parallax.
    look(105);
    expect(meshes().find((m) => m.name.endsWith(':bricks'))!.material).toBe(library.materialFor('bricks', true));
    view.dispose();
  });

  it('rebuilds only the chunks drawn in a material when it lands, and none when it is only tuned', async () => {
    const { library, land } = surfaces();
    const { view, look, meshes } = drawn([piece(0), piece(40, 'bricks-wall')], library);
    look(10);
    const before = meshes().find((m) => m.name.startsWith('building:0,0,0'))!;
    await land();
    look(10);
    expect(meshes()).toContain(before);
    const textured = meshes().find((m) => m.name.endsWith(':bricks'));
    library.add({ ...bricks, depth: 0.1 });
    look(10);
    expect(meshes().find((m) => m.name.endsWith(':bricks'))).toBe(textured);
    view.dispose();
  });

  it("draws a piece in its kind's new colour once the kind is recoloured, its chunk built again", async () => {
    const { library, land } = surfaces();
    const { view, scene, look, meshes } = drawn([piece(0, 'bricks-wall')], library);
    look(10);
    await land();
    look(10);
    const before = meshes().find((m) => m.name.endsWith(':bricks'))!;
    const recoloured = new TerrainPalette([terrain('grass'), terrain('bricks-wall', { structure: 'wall', surface: 'bricks', color: '#2266aa' })]);
    view.sync(scene, recoloured);
    look(10);
    const after = meshes().find((m) => m.name.endsWith(':bricks'))!;
    expect(after).not.toBe(before);
    expect(colourOf(after, 0)).toBe('#2266aa');
    view.dispose();
  });

  it('leaves a kind drawn with a model to the model, its material and all', async () => {
    const { library, land } = surfaces();
    const { view, look } = drawn([piece(0, 'crate')], library);
    await land();
    look(10);
    expect(view.stats().tiles).toBe(0);
    view.dispose();
  });

  it('with no library, draws every piece as it always did', () => {
    const { view, look, meshes } = drawn([piece(0), piece(1, 'bricks-wall')]);
    look(10);
    expect(meshes()).toHaveLength(1);
    expect(colourOf(meshes()[0]!, 1)).toBe(`#${new Color(BUILD_MATERIALS.stone).getHexString()}`);
    view.dispose();
  });
});
