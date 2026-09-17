import { describe, it, expect, beforeEach } from 'vitest';
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, NotEqualStencilFunc } from 'three';
import { OUTLINE_LAYER } from './toon';
import { MASK_NAME, OUTLINE_NAME, forgetOutline, forgetOutlines, outline } from './faction-outline';

const RED = '#c0524a';

/** A model of several parts, the way a creature is built. */
function creature(): Group {
  const group = new Group();
  // A box carries an index and a merged cylinder may not: the two together are what
  // `mergeGeometries` refuses unless they are flattened first.
  const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  const barrel = new Mesh(new CylinderGeometry(0.3, 0.3, 1, 8).toNonIndexed(), new MeshBasicMaterial());
  barrel.position.y = 1;
  group.add(box, barrel);
  return group;
}

const named = (group: Group, name: string): Mesh | undefined =>
  group.children.find((child) => child.name === name) as Mesh | undefined;
const rimOf = (group: Group): Mesh | undefined => named(group, OUTLINE_NAME);
const maskOf = (group: Group): Mesh | undefined => named(group, MASK_NAME);
const vertices = (mesh: Mesh): number => mesh.geometry.getAttribute('position').count;

beforeEach(() => forgetOutlines());

describe('the line round a creature', () => {
  it('draws the rim only where the model is not, whatever the geometry does', () => {
    // The whole reason this is not an inverted hull on its own. Pushing back faces along
    // their normals sends them in front of the model wherever the surface folds inward, and
    // a creature is nothing but folds: the first attempt flooded the model red. The stencil
    // makes that impossible rather than unlikely - the rim cannot be drawn where the mask
    // marked the model, however near the camera the pushed copy ends up.
    const group = creature();
    outline(group, 'creature', RED);
    const rim = rimOf(group)!;
    const material = rim.material as MeshBasicMaterial;
    expect(material.stencilWrite).toBe(true);
    expect(material.stencilFunc).toBe(NotEqualStencilFunc);
  });

  it('marks the model into the stencil and paints nothing doing it', () => {
    const group = creature();
    outline(group, 'creature', RED);
    const material = maskOf(group)!.material as MeshBasicMaterial;
    expect(material.stencilWrite).toBe(true);
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(false);
  });

  it('draws the mask, then the rim, then the model', () => {
    // The order is the technique: mark, rim what is outside the mark, and let the model
    // cover the rest. Both sit below the overlays, which start at 1.
    const group = creature();
    outline(group, 'creature', RED);
    expect(maskOf(group)!.renderOrder).toBe(-2);
    expect(rimOf(group)!.renderOrder).toBe(-1);
  });

  it('merges a model whose parts do not agree about being indexed', () => {
    // One part indexed, one not: `mergeGeometries` answers null for that, and the hull was
    // built from the null. It threw, and took 28 tests with it.
    const group = creature();
    expect(() => outline(group, 'creature', RED)).not.toThrow();
    expect(vertices(rimOf(group)!)).toBeGreaterThan(0);
  });

  it('draws nothing at all rather than throwing when there is nothing to rim', () => {
    const empty = new Group();
    expect(outline(empty, 'empty', RED)).toEqual([]);
    expect(rimOf(empty)).toBeUndefined();
    expect(maskOf(empty)).toBeUndefined();
  });

  it('is put on once, however many times it is asked for', () => {
    // `syncTokens` runs on every change, and a token that merely moved must not collect a
    // second rim each time.
    const group = creature();
    const first = outline(group, 'creature', RED);
    const second = outline(group, 'creature', RED);
    expect(second).toEqual(first);
    expect(group.children.filter((c) => c.name === OUTLINE_NAME || c.name === MASK_NAME)).toHaveLength(2);
  });

  it('shares one hull between two of the same model, and one material between one colour', () => {
    // A room of twenty husks merges one silhouette. `scene-view.test.ts` pins that two
    // tokens of a model share every part; a hull merged per token would quietly undo it.
    const a = creature();
    const b = creature();
    outline(a, 'husk', RED);
    outline(b, 'husk', RED);
    expect(rimOf(b)!.geometry).toBe(rimOf(a)!.geometry);
    expect(rimOf(b)!.material).toBe(rimOf(a)!.material);
    expect(maskOf(b)!.material).toBe(maskOf(a)!.material);
    // Mask and rim are the same shape: one is the model, the other the model pushed out.
    expect(maskOf(a)!.geometry).toBe(rimOf(a)!.geometry);
  });

  it('gives each side its own colour, from one shared hull', () => {
    const friend = creature();
    const foe = creature();
    outline(friend, 'knight', '#f6c453');
    outline(foe, 'knight', RED);
    expect(rimOf(foe)!.geometry).toBe(rimOf(friend)!.geometry);
    expect(rimOf(foe)!.material).not.toBe(rimOf(friend)!.material);
  });

  it('forgets a hull when the file it was merged from is replaced', () => {
    // An imported model is a placeholder until its file lands. The rim merged from the
    // placeholder is not the rim of what arrives, and it is cached under the same id.
    const placeholder = creature();
    outline(placeholder, 'fox', RED);
    const stale = rimOf(placeholder)!.geometry;

    forgetOutline('fox');
    const arrived = creature();
    outline(arrived, 'fox', RED);
    expect(rimOf(arrived)!.geometry).not.toBe(stale);
  });

  it('stays off the hover rim layer, so the editor draws it too', () => {
    // `OUTLINE_LAYER` is the pointer rim's, and the editor's camera is told not to draw that
    // layer - a faction rim there would be invisible in the one mode where creatures are
    // placed. Layer 0 is drawn by every camera, the thumbnail renderer included.
    const group = creature();
    outline(group, 'creature', RED);
    for (const mesh of [rimOf(group)!, maskOf(group)!]) {
      expect(mesh.layers.isEnabled(OUTLINE_LAYER)).toBe(false);
      expect(mesh.layers.isEnabled(0)).toBe(true);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
    }
  });

  it('never rims a rim, nor masks a mask', () => {
    // Both are meshes too, and merging them back in would push a rim off a rim, thickening
    // every time a model was rebuilt.
    //
    // Asked of a parent rather than of the outlined group itself: `outline` returns what a
    // group already carries, so outlining the same group twice proves nothing. One level up,
    // the pair are grandchildren - no early return - and the traversal must skip them.
    const rimmed = creature();
    outline(rimmed, 'inner', RED);
    const over = new Group();
    over.add(rimmed);

    const plain = new Group();
    plain.add(creature());

    outline(over, 'over', RED);
    outline(plain, 'plain', RED);
    // Same parts either way, so the same hull: the nested pair contributed nothing.
    expect(vertices(rimOf(over)!)).toBe(vertices(rimOf(plain)!));
  });
});
