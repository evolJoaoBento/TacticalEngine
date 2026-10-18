/**
 * The project's imported materials, loaded (`surface-library.ts`), over a loader of the test's own: each surface's maps
 * loaded once however often it is asked for, the near and flat materials shared, a tuning edit made in place, new maps
 * loaded afresh, and nothing drawn in a surface until it is in - nor in one removed while it was on its way.
 */

import { describe, expect, it } from 'vitest';
import { CompressedTexture, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { SurfaceLibrary, type TextureLoad } from './surface-library';
import type { TileSurface } from '../scene/schema';

const surface = (id = 'bricks', over: Partial<TileSurface> = {}): TileSurface => ({
  id,
  name: 'Bricks',
  maps: { color: `${id}-c`, normalHeight: `${id}-n`, orm: `${id}-o` },
  parallax: true,
  size: 1,
  depth: 0.06,
  normalScale: 1,
  roughness: 1,
  ...over,
});

/** A loader the test answers by hand: every url asked for, and its texture or failure given when the test says. */
function loader() {
  const asked: string[] = [];
  const pending = new Map<string, { done: (t: Texture) => void; fail: (e: Error) => void }>();
  const load: TextureLoad = (url) =>
    new Promise((done, fail) => {
      asked.push(url);
      pending.set(url, { done, fail });
    });
  const give = async (...urls: string[]) => {
    for (const url of urls) pending.get(url)!.done(new Texture());
    await new Promise((settle) => setTimeout(settle, 0));
  };
  const refuse = async (url: string) => {
    pending.get(url)!.fail(new Error('no such file'));
    await new Promise((settle) => setTimeout(settle, 0));
  };
  return { load, asked, give, refuse };
}

describe("the project's imported materials", () => {
  it('loads a surface once however often it is asked for, and draws nothing in it until it is in', async () => {
    const files = loader();
    const library = new SurfaceLibrary(files.load, 8);
    const heard: string[] = [];
    library.onChange((id) => heard.push(id));
    library.add(surface());
    expect(library.materialFor('bricks')).toBeNull();
    expect(library.materialFor('bricks', true)).toBeNull();
    expect(library.statusOf('bricks')).toBe('loading');
    expect(files.asked).toEqual(['bricks-c', 'bricks-n', 'bricks-o']);
    await files.give('bricks-c', 'bricks-n', 'bricks-o');
    expect(library.statusOf('bricks')).toBe('ready');
    expect(heard).toEqual(['bricks']);
    const near = library.materialFor('bricks')!;
    const flat = library.materialFor('bricks', true)!;
    expect(near).not.toBe(flat);
    expect(library.materialFor('bricks')).toBe(near);
    expect(files.asked).toHaveLength(3);
    // The maps set up as the shader reads them: the colour in sRGB, every one repeating, sharpened at a slant.
    const color = near.userData.surfaceUniforms.tColor.value;
    expect(color.colorSpace).toBe(SRGBColorSpace);
    expect([color.wrapS, color.wrapT, color.anisotropy]).toEqual([RepeatWrapping, RepeatWrapping, 8]);
    expect(flat.userData.surfaceUniforms.tColor.value).toBe(color);
    expect(library.materialFor('nothing')).toBeNull();
  });

  it('tunes a surface in place, the maps kept; loads it afresh when its maps change', async () => {
    const files = loader();
    const library = new SurfaceLibrary(files.load);
    library.add(surface());
    library.request('bricks');
    await files.give('bricks-c', 'bricks-n', 'bricks-o');
    const near = library.materialFor('bricks')!;
    const before = library.revisionOf('bricks');
    library.add(surface('bricks', { depth: 0.12, size: 2 }));
    expect(library.materialFor('bricks')).toBe(near);
    expect(near.userData.surfaceUniforms.uDepth.value).toBe(0.12);
    expect(near.userData.surfaceUniforms.uSize.value).toBe(2);
    expect(library.revisionOf('bricks')).toBeGreaterThan(before);
    expect(files.asked).toHaveLength(3);
    // The same again: nothing changed, nothing redrawn.
    const tuned = library.revisionOf('bricks');
    library.add(surface('bricks', { depth: 0.12, size: 2 }));
    expect(library.revisionOf('bricks')).toBe(tuned);
    // New maps: the old let go, the new loaded.
    library.add(surface('bricks', { maps: { color: 'b2-c', normalHeight: 'b2-n', orm: 'b2-o' } }));
    expect(library.materialFor('bricks')).toBeNull();
    expect(files.asked.slice(3)).toEqual(['b2-c', 'b2-n', 'b2-o']);
  });

  it('lets go of a surface removed while its maps were on their way, and of every one the project no longer has', async () => {
    const files = loader();
    const library = new SurfaceLibrary(files.load);
    library.setAll([surface('bricks'), surface('stone')]);
    library.request('bricks');
    library.remove('bricks');
    await files.give('bricks-c', 'bricks-n', 'bricks-o');
    expect(library.has('bricks')).toBe(false);
    expect(library.materialFor('bricks')).toBeNull();
    library.setAll([surface('stone')]);
    expect(library.has('stone')).toBe(true);
    library.setAll([]);
    expect(library.has('stone')).toBe(false);
  });

  it('leaves a compressed map its own mipmaps: WebGL cannot make them for a compressed format', async () => {
    const compressed = new CompressedTexture([], 4, 4);
    const library = new SurfaceLibrary((url) => Promise.resolve(url.endsWith('-c') ? compressed : new Texture()));
    library.add(surface());
    library.request('bricks');
    await new Promise((settle) => setTimeout(settle, 0));
    const uniforms = library.materialFor('bricks')!.userData.surfaceUniforms;
    expect(uniforms.tColor.value.generateMipmaps).toBe(false);
    expect(uniforms.tNormalHeight.value.generateMipmaps).toBe(true);
  });

  it('says a load that failed, and draws the plain box rather than asking again and again', async () => {
    const files = loader();
    const library = new SurfaceLibrary(files.load);
    library.add(surface());
    library.request('bricks');
    await files.refuse('bricks-n');
    expect(library.statusOf('bricks')).toBe('failed');
    expect(library.errorOf('bricks')).toBe('no such file');
    expect(library.materialFor('bricks')).toBeNull();
    expect(files.asked).toHaveLength(3);
  });
});
