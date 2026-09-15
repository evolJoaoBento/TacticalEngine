import { describe, it, expect } from 'vitest';
import { BackSide, BoxGeometry, Mesh, MeshBasicMaterial, NearestFilter, Raycaster, Scene, Vector2, Vector3 } from 'three';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { blankScene, gridFromScene } from '../scene/grid-from-scene';
import { buildTerrainMesh } from './terrain-mesh';
import { OUTLINE_LAYER, addOutline, inkEdges, outlineMaterial, smoothHull, toonGradient, toonMaterial } from './toon';

describe('the toon ramp', () => {
  it('steps the light in three flat bands, shared by every material', () => {
    const ramp = toonGradient();
    expect(ramp.image.width).toBe(3);
    expect(ramp.magFilter).toBe(NearestFilter);
    expect(ramp.minFilter).toBe(NearestFilter);
    expect(ramp.generateMipmaps).toBe(false);
    expect(toonGradient()).toBe(ramp);
    const material = toonMaterial({ color: '#ff0000' });
    expect(material.gradientMap).toBe(ramp);
    expect((material as unknown as { flatShading: boolean }).flatShading).toBe(true);
  });
});

describe('ink outlines', () => {
  it('closes a hull at the corners, its normals pointing out', () => {
    const hull = smoothHull(new BoxGeometry(1, 1, 1));
    const positions = hull.getAttribute('position');
    const normals = hull.getAttribute('normal');
    expect(positions.count).toBe(8);
    for (let i = 0; i < positions.count; i++) {
      const out = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize();
      expect(new Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)).dot(out)).toBeGreaterThan(0.8);
    }
  });

  it('pushes the hull out along its normals and draws only its back faces, in ink', () => {
    const material = outlineMaterial(0.02);
    expect(material.side).toBe(BackSide);
    expect(outlineMaterial(0.02)).toBe(material);
    expect(outlineMaterial(0.03)).not.toBe(material);
    const shader = { vertexShader: 'void main() {\n#include <begin_vertex>\n}', fragmentShader: '', uniforms: {} };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('transformed += normalize( normal ) * 0.0200;');
  });

  it('hangs the rim on a layer the camera has to ask for, where no raycast finds it', () => {
    const scene = new Scene();
    const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    scene.add(box);
    const rim = addOutline(box, smoothHull(box.geometry), 0.05);
    expect(box.children).toContain(rim);
    expect(rim.layers.isEnabled(0)).toBe(false);
    expect(rim.layers.isEnabled(OUTLINE_LAYER)).toBe(true);
    expect(rim.castShadow).toBe(false);
    scene.updateMatrixWorld(true);
    // Off the top face's diagonal, where a ray would strike both of its triangles.
    const hits = new Raycaster(new Vector3(0.2, 5, -0.1), new Vector3(0, -1, 0)).intersectObject(scene, true);
    expect(hits.map((h) => h.object)).toEqual([box]);
  });

  it('inks a slab along its hard edges only, as wide as asked in the pixels it is drawn into', () => {
    const lines = inkEdges(new BoxGeometry(1, 1, 1), 2.5);
    // A box has twelve edges; the diagonals across its faces are not creases.
    expect(lines.geometry.getAttribute('instanceStart').count).toBe(12);
    expect(lines.layers.isEnabled(OUTLINE_LAYER)).toBe(true);
    expect(lines.layers.isEnabled(0)).toBe(false);
    expect(lines.material.linewidth).toBe(2.5);
    const renderer = { getDrawingBufferSize: (into: Vector2) => into.set(640, 480) };
    (lines.onBeforeRender as (r: unknown) => void)(renderer);
    expect(lines.material.resolution.toArray()).toEqual([640, 480]);
  });

  it('inks the ground once over all of it, where two kinds of ground on the level make no crease', () => {
    const inked = (scene: ReturnType<typeof blankScene>) => {
      const terrain = buildTerrainMesh(gridFromScene(scene).grid);
      const inks = terrain.meshes.flatMap((m) => m.children.filter((c) => c.name === 'outline'));
      const segments = inks.map((ink) => (ink as LineSegments2).geometry.getAttribute('instanceStart').count);
      const result = { meshes: terrain.meshes.length, inks: inks.length, segments, layered: inks.every((i) => i.layers.isEnabled(OUTLINE_LAYER)), apart: inks.every((i) => !terrain.meshes.includes(i as never)) };
      terrain.dispose();
      return result;
    };
    const plain = inked(blankScene('room', 3, 2));
    const mixed = blankScene('room', 3, 2);
    mixed.terrain[0] = 'difficult';
    const both = inked(mixed);
    expect(both.meshes).toBe(2);
    expect(both.inks).toBe(1);
    expect(both.layered && both.apart).toBe(true);
    // Only the room's rim and base: not one line more for the border between the two kinds.
    expect(both.segments).toEqual(plain.segments);
    expect(plain.segments[0]).toBeGreaterThan(0);
  });
});
