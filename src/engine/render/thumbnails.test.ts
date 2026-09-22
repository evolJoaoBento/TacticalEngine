import { describe, expect, it } from 'vitest';
import { Box3, Group, Object3D, Sphere, Vector3 } from 'three';
import { AssetLibrary, modelAssetSchema } from './assets';
import { ModelThumbnails, faceFraming, headOf } from './thumbnails';
import { ModelRegistry } from './procedural/registry';

/**
 * The picture the Models panel shows while somebody is setting a model up.
 *
 * It is the only way to see where an imported file will stand before putting it in
 * a room, so the property that matters is that it follows the settings: change the
 * nudge and the picture is of the nudged model, not the one from a moment ago. The
 * renderer itself needs a browser, so what is driven here is what decides *whether*
 * to draw — the key a picture is kept under.
 */

const fox = (changes: Record<string, number> = {}) =>
  modelAssetSchema.parse({ id: 'fox', url: '/fox.glb', scale: 0.012, ...changes });

/** A library with the file already in it, so nothing waits on a load. */
function loaded(asset = fox()) {
  const library = new AssetLibrary(() => Promise.resolve(new Group()), [asset]);
  library.request('fox');
  return library;
}

describe('what a portrait frames', () => {
  const standing = new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 2, 0.2));

  it('is the top of a figure, not the whole of it', () => {
    const face = faceFraming(standing, null);
    const whole = standing.getBoundingSphere(new Sphere());
    expect(face.radius).toBeLessThan(whole.radius / 2);
    // Head and shoulders: the frame reaches the crown and stops well short of the waist.
    expect(face.center.y + face.radius).toBeGreaterThanOrEqual(standing.max.y - 0.05);
    expect(face.center.y - face.radius).toBeGreaterThan(1);
    expect(face.center.x).toBeCloseTo(0);
  });

  it('believes a rig about where its head is', () => {
    const rig = new Group();
    const spine = new Object3D();
    spine.name = 'mixamorigSpine';
    const head = new Object3D();
    head.name = 'mixamorigHead';
    head.position.set(0.4, 1.2, 0);
    // The marker beyond the crown is not the head, whichever comes first in the file.
    const crown = new Object3D();
    crown.name = 'mixamorigHeadTop_End';
    crown.position.set(0, 9, 0);
    rig.add(crown, spine);
    spine.add(head);

    const at = headOf(rig)!;
    expect([at.x, at.y]).toEqual([0.4, 1.2]);
    // Somebody stooped, or holding a banner: the joint wins over the top of the box.
    const face = faceFraming(standing, at);
    expect(face.center.x).toBeCloseTo(0.4);
    expect(face.center.y).toBeGreaterThan(1.2);
    expect(face.center.y).toBeLessThan(1.5);
  });

  it('finds no head on something that has none', () => {
    expect(headOf(new Group())).toBeNull();
  });
});

describe('what a preview is kept under', () => {
  it('is a different picture once the model is nudged across its tile', async () => {
    const library = loaded();
    await Promise.resolve();
    await Promise.resolve();
    const thumbnails = new ModelThumbnails(new ModelRegistry(), library);
    const keyOf = (id: string): string => (thumbnails as unknown as { key(id: string): string }).key(id);

    const before = keyOf('fox');
    library.retune(fox({ offsetX: 0.5 }));
    const nudged = keyOf('fox');
    expect(nudged, 'a nudge is a different picture').not.toBe(before);

    // Every setting the picture shows is in it, so none of them shows a stale one.
    library.retune(fox({ offsetX: 0.5, offsetY: -0.25 }));
    expect(keyOf('fox')).not.toBe(nudged);
    library.retune(fox({ offsetX: 0.5, offsetY: -0.25, scale: 0.02 }));
    const scaled = keyOf('fox');
    expect(scaled).not.toBe(keyOf('other'));
    library.retune(fox({ offsetX: 0.5, offsetY: -0.25, scale: 0.02, groundOffset: 0.3 }));
    expect(keyOf('fox')).not.toBe(scaled);
  });

  it('follows a spec the document edited in place, as the panel edits one', () => {
    // `updateAsset` mutates the asset inside the document, and the library was handed
    // that very object — so the picture must be keyed off what it reads at draw time,
    // not off what it read when the asset was declared.
    const asset = fox();
    const library = loaded(asset);
    const thumbnails = new ModelThumbnails(new ModelRegistry(), library);
    const keyOf = (id: string): string => (thumbnails as unknown as { key(id: string): string }).key(id);

    const before = keyOf('fox');
    (asset as { offsetX: number }).offsetX = 0.5;
    library.retune(asset);
    expect(keyOf('fox'), 'an edit in place is still an edit').not.toBe(before);
  });

  it('keeps a library model under its own id, which has no settings to follow', () => {
    const thumbnails = new ModelThumbnails(new ModelRegistry(), null);
    const keyOf = (id: string): string => (thumbnails as unknown as { key(id: string): string }).key(id);
    expect(keyOf('crate')).toBe('crate');
  });
});
