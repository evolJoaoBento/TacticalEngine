import { describe, expect, it } from 'vitest';
import { BackSide, BoxGeometry, GreaterDepth, Group, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from 'three';
import { Spotlight } from './spotlight';
import { OUTLINE_LAYER } from './toon';

/**
 * What the pointer is on, rimmed in white through whatever is in front of it.
 *
 * The rim is the one thing in the room that ignores the depth of it, so these
 * are the properties that keep that from becoming a mess: it is on the layer
 * only play draws, no raycast can land on it, it is built once per thing, and
 * nothing is lit until something is pointed at.
 */

/** A door's worth of parts: a panel, and a band across it standing proud of the face. */
const thing = (): Group => {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  const band = new Mesh(new BoxGeometry(1.1, 0.2, 0.2), new MeshBasicMaterial());
  band.position.set(0, 0.2, 0.4);
  group.add(band);
  return group;
};

describe('the spotlight', () => {
  it('rims what is pointed at in white: an edge where it is in view, a ghost where it is not', () => {
    const target = thing();
    const spot = new Spotlight();
    expect(spot.lit).toBeNull();

    spot.show(target);
    const rims: Mesh[] = [];
    target.traverse((child) => {
      if (child.name === 'spotlight') rims.push(child as Mesh);
    });
    // Two for the thing, however many parts it has: the outline, and the same outline
    // where a wall hides it. Per part, a door's own bands would be edged too, and the
    // second rim would find them standing in front of its panel and fill it.
    expect(rims).toHaveLength(2);
    expect(rims[0]!.geometry).toBe(rims[1]!.geometry);
    for (const rim of rims) {
      expect((rim.material as MeshBasicMaterial).color.getHexString()).toBe('ffffff');
      expect(rim.visible).toBe(true);
    }
    const materials = rims.map((r) => r.material as MeshBasicMaterial);
    const edge = materials.find((m) => m.depthFunc !== GreaterDepth)!;
    const ghost = materials.find((m) => m.depthFunc === GreaterDepth)!;
    // The edge is the ink rim's twin: solid, and behind what stands in front of it.
    expect(edge.opacity).toBe(1);
    // The ghost is drawn only where something nearer already is — through a wall, and
    // never over the thing itself, which would wash it pale instead of rimming it.
    // It is an edge, like the other: pushed out, and drawn back faces only.
    expect(ghost.side).toBe(BackSide);
    expect(ghost.depthWrite).toBe(false);
    expect(ghost.transparent).toBe(true);
    expect(ghost.opacity).toBeLessThan(0.8);
    expect(ghost.opacity).toBeGreaterThan(0);
    expect(spot.lit).toBe(target);
  });

  it('hangs on the layer only play draws, where no raycast finds it', () => {
    const scene = new Scene();
    const target = thing();
    scene.add(target);
    const spot = new Spotlight();
    spot.show(target);
    scene.updateMatrixWorld(true);

    const rims: Mesh[] = [];
    target.traverse((child) => {
      if (child.name === 'spotlight') rims.push(child as Mesh);
    });
    for (const rim of rims) {
      expect(rim.layers.isEnabled(OUTLINE_LAYER)).toBe(true);
      expect(rim.layers.isEnabled(0)).toBe(false);
      expect(rim.castShadow).toBe(false);
    }
    // Off the box top's diagonal, where a ray would strike both of its triangles.
    const hits = new Raycaster(new Vector3(0.2, 5, -0.1), new Vector3(0, -1, 0)).intersectObject(scene, true);
    expect(hits.map((h) => h.object.name)).not.toContain('spotlight');
  });

  it('builds a rim once, however often the pointer crosses it', () => {
    const target = thing();
    const other = thing();
    const spot = new Spotlight();

    spot.show(target);
    const first = target.getObjectByName('spotlight');
    spot.show(other);
    spot.show(target);
    const again = target.getObjectByName('spotlight');
    expect(again).toBe(first);
    // The one it left is dark, the one it is on is lit.
    expect(other.getObjectByName('spotlight')!.visible).toBe(false);
    expect(again!.visible).toBe(true);
  });

  it('goes dark when nothing is pointed at', () => {
    const target = thing();
    const spot = new Spotlight();
    spot.show(target);
    spot.show(null);
    expect(spot.lit).toBeNull();
    expect(target.getObjectByName('spotlight')!.visible).toBe(false);
    // Hiding what is already hidden is not an error.
    spot.hide();
    expect(spot.lit).toBeNull();
  });
});
