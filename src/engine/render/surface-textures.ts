/**
 * How an imported material's maps are loaded for the GPU (`surface-library.ts`): a map compressed at import - a
 * KTX2 data URL, Basis Universal inside (`editor/surface-import.ts`) - through three's `KTX2Loader`, which transcodes
 * it to whatever compressed format this GPU draws (BC7 on a desktop, ASTC or ETC on a phone) and so keeps it a quarter
 * of the memory an RGBA texture takes; any other - a material imported before the maps were compressed, or one whose
 * compressing failed - through the plain `TextureLoader`.
 *
 * The transcoder's two files come with three (`examples/jsm/libs/basis/`) and are served where the build puts them
 * (`?url`); `KTX2Loader` asks for them by name under a folder, so a loading manager points each name at its file.
 */

import { LoadingManager, TextureLoader, type Texture, type WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import transcoderJs from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import transcoderWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';
import type { TextureLoad } from './surface-library';

/** Whether a map is a compressed one: a KTX2 data URL. */
export const isKtx2 = (url: string): boolean => url.startsWith('data:image/ktx2');

/** The loader an imported material's maps are loaded with, for this renderer's GPU. */
export function surfaceTextureLoader(renderer: WebGLRenderer): TextureLoad {
  const files = new LoadingManager();
  files.setURLModifier((url) => (url.endsWith('basis_transcoder.js') ? transcoderJs : url.endsWith('basis_transcoder.wasm') ? transcoderWasm : url));
  let ktx2: KTX2Loader | null = null;
  const plain = new TextureLoader();
  return (url: string): Promise<Texture> => {
    if (!isKtx2(url)) return plain.loadAsync(url);
    // Made on first use: a project with no compressed maps never starts the transcoder's worker.
    ktx2 ??= new KTX2Loader(files).setTranscoderPath('/basis/').detectSupport(renderer);
    return ktx2.loadAsync(url);
  };
}
