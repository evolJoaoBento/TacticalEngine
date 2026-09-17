import { describe, expect, it } from 'vitest';
import { BackSide, BoxGeometry, Group, Mesh, MeshBasicMaterial, NotEqualStencilFunc, Raycaster, Scene, Vector3 } from 'three';
import { Spotlight } from './spotlight';
import { MASK_NAME, OUTLINE_NAME, forgetOutlines } from './faction-outline';

/**
 * What the pointer is on, rimmed in white.
 *
 * The rim is `faction-outline`'s silhouette: the thing masked into the stencil buffer and
 * the line drawn only outside it, so it cannot leak across a shape however it folds. It is
 * seen through whatever stands in front of it, which is the whole point - a door at the back
 * of a room is half behind a wall, and a player needs to know what they are about to reach
 * for. The ghost that used to do that job separately is gone: one pair does both now.
 */

/** A door's worth of parts: a panel, and a band across it standing proud of the face. */
const thing = (name = 'object:door'): Group => {
  const group = new Group();
  group.name = name;
  group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  const band = new Mesh(new BoxGeometry(1.1, 0.2, 0.2), new MeshBasicMaterial());
  band.position.set(0, 0.2, 0.4);
  group.add(band);
  return group;
};

const pair = (group: Group): Mesh[] =>
  group.children.filter((c) => c.name === OUTLINE_NAME || c.name === MASK_NAME) as Mesh[];

describe('the spotlight', () => {
  it('rims what is pointed at in white, and only outside it', () => {
    forgetOutlines();
    const target = thing();
    const spot = new Spotlight();
    expect(spot.lit).toBeNull();

    spot.show(target);
    const rims = pair(target);
    // One pair for the thing entire, not one per part: a door's own bands would each be
    // edged, and the seams between them drawn.
    expect(rims).toHaveLength(2);
    const rim = target.children.find((c) => c.name === OUTLINE_NAME) as Mesh;
    const mask = target.children.find((c) => c.name === MASK_NAME) as Mesh;
    // Both are the same shape: one is the thing, the other the thing pushed out.
    expect(mask.geometry).toBe(rim.geometry);

    const line = rim.material as MeshBasicMaterial;
    expect(line.color.getHexString()).toBe('ffffff');
    expect(line.side).toBe(BackSide);
    // The stencil is what keeps it off the thing's own face. Without it the pushed hull
    // comes out in front of the model wherever the surface folds inward.
    expect(line.stencilWrite).toBe(true);
    expect(line.stencilFunc).toBe(NotEqualStencilFunc);
    // Seen through a wall: no depth test, and drawn after the room rather than before it.
    expect(line.depthTest).toBe(false);
    expect(rim.renderOrder).toBeGreaterThan(0);
    // The mask paints nothing; it exists to say where the thing is.
    expect((mask.material as MeshBasicMaterial).colorWrite).toBe(false);
    for (const mesh of rims) expect(mesh.visible).toBe(true);
    expect(spot.lit).toBe(target);
  });

  it('is drawn with the room rather than on the hover layer, and casts nothing', () => {
    forgetOutlines();
    const scene = new Scene();
    const target = thing();
    scene.add(target);
    const spot = new Spotlight();
    spot.show(target);
    scene.updateMatrixWorld(true);

    for (const mesh of pair(target)) {
      // Layer 0, unlike the rim this replaced: the silhouette is the same one a creature
      // wears, and the editor's camera is told not to draw the hover layer.
      expect(mesh.layers.isEnabled(0)).toBe(true);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
    }
    // Off the box top's diagonal, where a ray would strike both of its triangles. A press
    // finds what it finds by looking, and must never land on a rim.
    const hits = new Raycaster(new Vector3(0.2, 5, -0.1), new Vector3(0, -1, 0)).intersectObject(scene, true);
    expect(hits.map((h) => h.object.name)).not.toContain(OUTLINE_NAME);
    expect(hits.map((h) => h.object.name)).not.toContain(MASK_NAME);
  });

  it('builds a rim once, however often the pointer crosses it', () => {
    forgetOutlines();
    const target = thing('object:door');
    const other = thing('object:chest');
    const spot = new Spotlight();

    spot.show(target);
    const first = target.children.find((c) => c.name === OUTLINE_NAME);
    spot.show(other);
    spot.show(target);
    expect(target.children.find((c) => c.name === OUTLINE_NAME)).toBe(first);
    expect(pair(target)).toHaveLength(2);
    // The one it left is dark, the one it is on is lit.
    expect(pair(other).every((m) => !m.visible)).toBe(true);
    expect(pair(target).every((m) => m.visible)).toBe(true);
  });

  it('goes dark when nothing is pointed at', () => {
    forgetOutlines();
    const target = thing();
    const spot = new Spotlight();
    spot.show(target);
    spot.show(null);
    expect(spot.lit).toBeNull();
    expect(pair(target).every((m) => !m.visible)).toBe(true);
    // Hiding what is already hidden is not an error.
    spot.hide();
    expect(spot.lit).toBeNull();
  });
});
