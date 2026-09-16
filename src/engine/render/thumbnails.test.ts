import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { AssetLibrary, modelAssetSchema } from './assets';
import { ModelThumbnails } from './thumbnails';
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
