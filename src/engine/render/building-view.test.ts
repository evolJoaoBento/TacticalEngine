import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, PerspectiveCamera } from 'three';
import { blankScene } from '../scene/grid-from-scene';
import { buildingKey, type BuildingTile } from '../scene/building';
import { BuildingView, BUILD_RESIDENT_LIMIT } from './building-view';

function setup(tiles: BuildingTile[]) {
  const scene = blankScene('room', 1, 1);
  scene.buildingTiles = Object.fromEntries(tiles.map((tile) => [buildingKey(tile), tile]));
  const view = new BuildingView(); view.sync(scene);
  const camera = new PerspectiveCamera(60, 1.5, 0.1, 500);
  const look = (distance: number, x = 0) => {
    camera.position.set(x, distance * 0.6, distance * 0.8);
    camera.lookAt(x, 0, 0);
    view.update(camera);
  };
  return { view, scene, camera, look };
}
const tile = (x = 0, y = 0, level = 0): BuildingTile => ({ x, y, level, shape: 'stairs', material: 'stone', rotation: 0 });

describe('building chunk LOD', () => {
  it('reduces actual triangles and stair instances with distance, then unloads', () => {
    const { view, look } = setup([tile()]);
    look(10); const near = view.stats();
    expect(near.lods).toEqual([1, 0, 0]);
    expect(near.instances).toBe(4);
    look(60); const middle = view.stats();
    expect(middle.lods).toEqual([0, 1, 0]);
    expect(middle.triangles).toBeLessThan(near.triangles);
    look(105); const far = view.stats();
    expect(far.lods).toEqual([0, 0, 1]);
    expect(far.instances).toBe(1);
    expect(far.triangles).toBe(12);
    look(300); expect(view.stats().residentChunks).toBe(0);
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
    view.sync(scene); view.update(camera);
    expect(view.root.children).toContain(mesh);
    view.dispose();
  });
  it('caps residency and builds at most two chunks per frame', () => {
    const tiles: BuildingTile[] = [];
    for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) tiles.push(tile(x * 16, y * 16));
    const { view, look, camera } = setup(tiles);
    look(90);
    expect(view.stats().residentChunks).toBeLessThanOrEqual(2);
    for (let i = 0; i < 60; i++) view.update(camera);
    expect(view.stats().residentChunks).toBeGreaterThan(2);
    expect(view.stats().residentChunks).toBeLessThanOrEqual(BUILD_RESIDENT_LIMIT);
    view.dispose();
  });
});
