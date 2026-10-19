/**
 * A material imported (`docs/DEVELOPING.md`, "Importing a tile material"): an ambientCG zip - or loose images - become
 * a `TileSurface`, its maps packed and carried in the project as data URLs. What each file is, what the material is
 * called and how the maps are packed is decided without a browser (`engine/content/tile-surface-kit.ts`); this is the
 * part that needs one - unzipping, decoding, downscaling and encoding.
 *
 * Two things are easy to get wrong here, and both bend the very detail the material is for:
 *
 * - **Decoding** must not colour-manage: a normal or a height map is data, not a colour (`colorSpaceConversion:
 *   'none'`, `premultiplyAlpha: 'none'`).
 * - **The normal and height texture must be lossless.** Lossy WebP always halves the resolution of two of a pixel's
 *   three channels, so the normal's X and Y and the height would come out blocky along every brick's edge. It is
 *   written as WebP only when the browser really wrote a lossless one (`VP8L`), else as PNG - never JPEG. The colour and
 *   the occlusion/roughness/metalness texture are lossy WebP, or JPEG where WebP cannot be written.
 *
 * But first each map is **compressed for the GPU** (`compress`): KTX2 with Basis Universal inside (`ktx2-encoder`, its
 * encoder's WebAssembly fetched only when a material is imported), which the page transcodes to whatever this GPU
 * draws and keeps at a quarter of the memory an RGBA texture takes (`engine/render/surface-textures.ts`). UASTC, its
 * mipmaps made here - a compressed texture cannot have them made later - and stored flipped, as an image is when the
 * GPU is handed it (`KTX2_ENCODING`). Only if compressing fails are the maps written as images, as above, and the author
 * told.
 */

import { unzip } from 'fflate';
import type { IEncodeOptions } from 'ktx2-encoder';
import { classifySurfaceFiles, kindsForSurface, meanColor, packMaps, refusalOf, surfaceIdentity, type DecodedMaps, type Pixels, type SurfaceKind } from '../engine/content/tile-surface-kit';
import { POLY_HAVEN_API, polyHavenMaps, polyHavenResolution, polyHavenSize, type PolyHavenFiles, type PolyHavenInfo } from '../engine/content/poly-haven';
import { toContentId } from '../engine/content/types';
import type { SurfaceMaps, TileSurface } from '../engine/scene/schema';

/** The largest side a material's maps are kept at: an import option. Never scaled up. */
export const SURFACE_SIZES = [512, 1024, 2048] as const;
export type SurfaceSize = (typeof SURFACE_SIZES)[number];

/** A material imported: what the project keeps, its colour, the files that were no map it reads, and whether its maps are compressed - or why not. */
export interface ImportedSurface {
  surface: TileSurface;
  color: string;
  ignored: string[];
  compressed: true | { why: string };
}

/** Which packed map is which: what each is compressed as. */
export type MapRole = 'color' | 'normalHeight' | 'orm';

/**
 * How each map is compressed (`compress`): all UASTC, with mipmaps and Zstandard, flipped as an image is on its way to
 * the GPU; the colour perceptual and sRGB, the other two linear data. No rate-distortion pass, and UASTC's quality level
 * 1 - 0 for the occlusion/roughness/metalness, which is soft by nature: measured on a 1K map, the pass took ten times
 * as long as the encoding it shrinks, and level 2 four times level 1 (`docs/DEVELOPING.md` §11). A 1K material is a few
 * seconds; a 2K one a few times that.
 */
export const KTX2_ENCODING: Readonly<Record<MapRole, Partial<IEncodeOptions>>> = {
  color: { isUASTC: true, generateMipmap: true, needSupercompression: true, isYFlip: true, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, enableRDO: false, uastcLDRQualityLevel: 1 },
  normalHeight: { isUASTC: true, generateMipmap: true, needSupercompression: true, isYFlip: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, enableRDO: false, uastcLDRQualityLevel: 1 },
  orm: { isUASTC: true, generateMipmap: true, needSupercompression: true, isYFlip: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, enableRDO: false, uastcLDRQualityLevel: 0 },
};

/** A packed map compressed for the GPU: KTX2 bytes. The encoder and its WebAssembly are fetched the first time. */
async function compress(pixels: Pixels, data: Uint8ClampedArray, role: MapRole): Promise<Uint8Array> {
  const [{ encodeToKTX2 }, { default: wasmUrl }] = await Promise.all([import('ktx2-encoder'), import('@ktx2-encoder-basis/basis_encoder.wasm?url')]);
  const raster = { width: pixels.width, height: pixels.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  // The pixels are packed already: handed to the encoder as they are, not encoded as an image to be decoded again.
  return encodeToKTX2(new Uint8Array(0), { ...KTX2_ENCODING[role], wasmUrl, imageDecoder: async () => raster });
}

/** Whether every one of a material's maps is compressed for the GPU already: KTX2. A linked one is compressed as it is fetched. */
export function isCompressedSurface(surface: Pick<TileSurface, 'maps'>): boolean {
  return surface.maps === undefined || Object.values(surface.maps).every((url) => url.startsWith('data:image/ktx2'));
}

/**
 * A material imported before its maps were compressed - or whose compressing failed - compressed now, in place: each
 * map decoded at its own size, untouched by colour management, and compressed as an import would (`compress`). The
 * maps, not the material: what the project keeps is changed by an edit (`replaceSurfaceMaps`). Throws, saying why,
 * when a map will not decode or compress.
 */
export async function compressMaps(surface: Pick<TileSurface, 'maps'>): Promise<SurfaceMaps> {
  const carried = surface.maps;
  if (carried === undefined) throw new Error('A linked material has no maps of its own to compress.');
  const out: Partial<SurfaceMaps> = {};
  for (const role of ['color', 'normalHeight', 'orm'] as const) {
    const url = carried[role];
    if (url.startsWith('data:image/ktx2')) {
      out[role] = url;
      continue;
    }
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const pixels = await decode(blob, bitmap.width, bitmap.height);
    bitmap.close();
    out[role] = ktx2Url(await compress(pixels, pixels.data, role));
  }
  return out as SurfaceMaps;
}

/** KTX2 bytes as a data URL. */
function ktx2Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/ktx2;base64,${btoa(binary)}`;
}

const IMAGE = /\.(jpe?g|png|webp)$/i;

/** The files a drop or a file input gave: each zip opened, every image kept, by name. */
export async function filesOf(files: readonly File[]): Promise<{ name: string; blob: Blob }[]> {
  const found: { name: string; blob: Blob }[] = [];
  for (const file of files) {
    if (!/\.zip$/i.test(file.name)) {
      found.push({ name: file.name, blob: file });
      continue;
    }
    const zipped = new Uint8Array(await file.arrayBuffer());
    const entries = await new Promise<Record<string, Uint8Array>>((done, fail) => unzip(zipped, (error, out) => (error ? fail(error) : done(out))));
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.endsWith('/')) continue;
      found.push({ name, blob: new Blob([bytes as BlobPart], { type: IMAGE.test(name) ? `image/${/\.png$/i.test(name) ? 'png' : /\.webp$/i.test(name) ? 'webp' : 'jpeg'}` : 'application/octet-stream' }) });
    }
  }
  return found;
}

/** One map decoded and drawn at the given size: its pixels, untouched by colour management. */
async function decode(blob: Blob, width: number, height: number): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** Whether WebP bytes are a lossless WebP: `RIFF....WEBPVP8L`. */
export function isLosslessWebp(bytes: Uint8Array): boolean {
  const tag = (at: number, text: string): boolean => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  return bytes.length > 16 && tag(0, 'RIFF') && tag(8, 'WEBP') && tag(12, 'VP8L');
}

/** Pixels written as an image: lossless (WebP only when it truly is, else PNG), or lossy (WebP, else JPEG). */
async function encode(pixels: Pixels, data: Uint8ClampedArray, lossless: boolean): Promise<Blob> {
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), pixels.width, pixels.height), 0, 0);
  if (lossless) {
    const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 1 });
    if (webp.type === 'image/webp' && isLosslessWebp(new Uint8Array(await webp.arrayBuffer()))) return webp;
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  return webp.type === 'image/webp' ? webp : canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

/** A blob as a data URL. */
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => fail(reader.error ?? new Error('could not read the image'));
    reader.readAsDataURL(blob);
  });
}

/** Told how a download or an import is getting on, in a few words: "downloading 2 of 5 maps", "packing its maps". */
export type Progress = (said: string) => void;

/**
 * A material from the files given - a zip, or its images loose - at most `size` pixels on a side: its maps found by
 * name, decoded, packed and encoded, saying so as it goes. Throws, with something to say, when there is no colour map
 * to draw it from.
 */
export async function importSurface(files: readonly File[], size: SurfaceSize = 1024, progress: Progress = () => undefined): Promise<ImportedSurface> {
  const found = await filesOf(files);
  const roles = classifySurfaceFiles(found.map((file) => file.name));
  const refusal = refusalOf(roles);
  if (refusal !== null) throw new Error(refusal);
  const blobOf = (name: string | undefined): Blob | undefined => found.find((file) => file.name === name)?.blob;
  progress('packing its maps');
  // Every map drawn at the colour map's size, scaled down to fit `size`, never up.
  const first = await createImageBitmap(blobOf(roles.color)!);
  const scale = Math.min(1, size / Math.max(first.width, first.height));
  const width = Math.max(1, Math.round(first.width * scale));
  const height = Math.max(1, Math.round(first.height * scale));
  first.close();
  const at = async (name: string | undefined): Promise<Pixels | undefined> => {
    const blob = blobOf(name);
    return blob === undefined ? undefined : decode(blob, width, height);
  };
  const normal = await at(roles.normalGL ?? roles.normalDX);
  const decoded: DecodedMaps = { color: (await at(roles.color))! };
  if (normal !== undefined) Object.assign(decoded, { normal, dx: roles.normalGL === undefined });
  for (const role of ['height', 'roughness', 'ao', 'metalness'] as const) {
    const pixels = await at(roles[role]);
    if (pixels !== undefined) decoded[role] = pixels;
  }
  const packed = packMaps(decoded);
  const average = meanColor(decoded.color);
  const shape = { width, height, data: packed.color };
  const zip = files.find((file) => /\.zip$/i.test(file.name));
  const identity = surfaceIdentity(zip?.name ?? roles.color!);
  // Compressed for the GPU; written as images only if that fails, all three alike.
  let maps: SurfaceMaps;
  let compressed: ImportedSurface['compressed'] = true;
  try {
    const squeezed = async (role: MapRole, nth: number): Promise<string> => {
      progress(`compressing ${nth} of 3 maps for the graphics card`);
      return ktx2Url(await compress(shape, packed[role], role));
    };
    maps = { color: await squeezed('color', 1), normalHeight: await squeezed('normalHeight', 2), orm: await squeezed('orm', 3) };
  } catch (failure) {
    compressed = { why: failure instanceof Error ? failure.message : String(failure) };
    maps = {
      color: await dataUrl(await encode(shape, packed.color, false)),
      normalHeight: await dataUrl(await encode(shape, packed.normalHeight, true)),
      orm: await dataUrl(await encode(shape, packed.orm, false)),
    };
  }
  return {
    surface: {
      id: identity.id,
      name: identity.name,
      ...(identity.source === undefined ? {} : { source: identity.source }),
      maps,
      parallax: packed.parallax,
      size: 1,
      depth: 0.06,
      normalScale: 1,
      roughness: 1,
      tint: 0,
      color: average,
    },
    color: average,
    ignored: roles.ignored,
    compressed,
  };
}

/** A texture's maps downloaded from Poly Haven, and what it says of itself: its name, and the tiles one repeat covers. */
export interface PolyHavenDownload {
  files: File[];
  name: string;
  size: number;
}

/**
 * A Poly Haven texture's maps, downloaded at the resolution a material kept at `size` pixels needs (`engine/content/
 * poly-haven.ts`), each a file named as Poly Haven names it. Throws, saying why, when there is no such texture, when it
 * is an HDRI or a model, or when the network fails.
 */
export async function downloadPolyHaven(id: string, size: SurfaceSize = 1024, fetcher: typeof fetch = fetch, progress: Progress = () => undefined): Promise<PolyHavenDownload> {
  const ask = async (path: string): Promise<unknown> => {
    const answer = await fetcher(`${POLY_HAVEN_API}/${path}/${encodeURIComponent(id)}`);
    if (answer.status === 404) throw new Error(`Poly Haven has no "${id}": copy the id from its page's address, polyhaven.com/a/<id>.`);
    if (!answer.ok) throw new Error(`Poly Haven did not answer (${answer.status}).`);
    return answer.json();
  };
  const [info, listed] = (await Promise.all([ask('info'), ask('files')])) as [PolyHavenInfo, PolyHavenFiles];
  const maps = polyHavenMaps(listed, polyHavenResolution(size));
  if (maps.length === 0) throw new Error(`"${id}" is not a texture on Poly Haven (an HDRI or a model has no maps to draw a tile in).`);
  let landed = 0;
  progress(`downloading 0 of ${maps.length} maps`);
  const files = await Promise.all(
    maps.map(async ({ name, url }) => {
      const answer = await fetcher(url);
      if (!answer.ok) throw new Error(`Could not download ${name} from Poly Haven (${answer.status}).`);
      const file = new File([await answer.blob()], name, { type: /\.png$/i.test(name) ? 'image/png' : 'image/jpeg' });
      progress(`downloading ${++landed} of ${maps.length} maps`);
      return file;
    }),
  );
  return { files, name: info.name ?? id, size: polyHavenSize(info) };
}

/** A Poly Haven texture imported: downloaded, then imported as its files would be, named and sized as Poly Haven says. */
export async function importPolyHaven(id: string, size: SurfaceSize = 1024, fetcher: typeof fetch = fetch, progress: Progress = () => undefined): Promise<ImportedSurface> {
  const download = await downloadPolyHaven(id, size, fetcher, progress);
  const imported = await importSurface(download.files, size, progress);
  return { ...imported, surface: { ...imported.surface, id: toContentId(download.name) || imported.surface.id, name: download.name, source: `Poly Haven ${id} (CC0)`, size: download.size } };
}

/** A linked material, resolved: its maps packed and compressed as an import makes them, and their average colour. */
export interface ResolvedSurface {
  maps: SurfaceMaps;
  color: string;
}

/** Where linked materials are kept once fetched, so each is downloaded and compressed once a browser. */
export interface SurfaceCache {
  get(key: string): Promise<ResolvedSurface | undefined>;
  put(key: string, value: ResolvedSurface): Promise<void>;
}

/** The key a linked material is kept under: the texture and how big its maps are kept. */
export const linkedKey = (link: { id: string; pixels: number }): string => `polyhaven:${link.id}@${link.pixels}`;

/** The largest size an import keeps that is no bigger than a link asks: what it is fetched and packed at. */
const keptAt = (pixels: number): SurfaceSize => [...SURFACE_SIZES].reverse().find((side) => side <= pixels) ?? SURFACE_SIZES[0];

/**
 * How the page resolves a linked material (`SurfaceLibrary`'s `SurfaceResolve`): from the cache when this browser has
 * fetched it before; else downloaded from Poly Haven and imported as its files would be - packed, compressed - and
 * kept. Asked for twice while on its way, it is fetched once, and both askers are told how it is getting on; a fetch
 * that fails is not kept, and is tried again the next time the material is asked for.
 */
export function linkedSurfaceResolver(
  cache: SurfaceCache,
  fetcher: typeof fetch = fetch,
  importing: PolyHavenImport = importPolyHaven,
): (surface: TileSurface, progress?: Progress) => Promise<ResolvedSurface> {
  const pending = new Map<string, { fetching: Promise<ResolvedSurface>; told: Set<Progress> }>();
  return (surface, progress) => {
    const link = surface.polyHaven;
    if (link === undefined) return Promise.reject(new Error(`"${surface.id}" is not linked to any texture`));
    const key = linkedKey(link);
    const going = pending.get(key);
    if (going !== undefined) {
      if (progress !== undefined) going.told.add(progress);
      return going.fetching;
    }
    const told = new Set<Progress>(progress === undefined ? [] : [progress]);
    const tell: Progress = (said) => {
      for (const listener of told) listener(said);
    };
    const fetching = (async (): Promise<ResolvedSurface> => {
      const kept = await cache.get(key).catch(() => undefined);
      if (kept !== undefined) return kept;
      const imported = await importing(link.id, keptAt(link.pixels), fetcher, tell);
      const resolved = { maps: imported.surface.maps!, color: imported.color };
      await cache.put(key, resolved).catch(() => undefined);
      return resolved;
    })();
    pending.set(key, { fetching, told });
    fetching.catch(() => pending.delete(key));
    return fetching;
  };
}

/** How a Poly Haven texture is imported: `importPolyHaven`, or a test's own. */
export type PolyHavenImport = (id: string, size: SurfaceSize, fetcher: typeof fetch, progress?: Progress) => Promise<ImportedSurface>;

/**
 * The browser's cache of linked materials: IndexedDB, which holds megabytes where the saves' storage holds a few. Every
 * touch is guarded: with storage turned off, nothing is kept, and each material is fetched again when it is drawn.
 */
export function browserSurfaceCache(): SurfaceCache {
  const STORE = 'linked';
  let opened: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> =>
    (opened ??= new Promise((done, fail) => {
      const request = indexedDB.open('tactical-surfaces', 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error ?? new Error('IndexedDB would not open'));
    }));
  const asked = <T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest): Promise<T> =>
    db().then(
      (base) =>
        new Promise<T>((done, fail) => {
          const request = ask(base.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => done(request.result as T);
          request.onerror = () => fail(request.error ?? new Error('IndexedDB refused'));
        }),
    );
  return {
    get: (key) => asked<ResolvedSurface | undefined>('readonly', (store) => store.get(key)).catch(() => undefined),
    put: (key, value) => asked<unknown>('readwrite', (store) => store.put(value, key)).then(() => undefined, () => undefined),
  };
}

/** What `addImported` needs of the editor: the project, the import, and picking the block it gave in the strip. */
export interface SurfaceImporter {
  readonly session: { readonly project: { readonly surfaces?: readonly { id: string }[] | undefined; readonly terrainPalette?: readonly { id: string }[] | undefined } };
  importSurface(surface: TileSurface, kinds: readonly SurfaceKind[]): string | null;
  openTerrainTab(tab: 'tiles'): void;
  setTool(tool: 'placeTile'): void;
  set(key: 'tileId', value: string): void;
}

/**
 * A material imported from files and added to the project with its four kinds, the block it gave picked in the Terrain
 * strip, so what came of it is in hand at once: what to tell the author, either way. The Tiles workspace's + Surface
 * and a drop on the workspace or on the strip all come here.
 */
export async function addImported(editor: SurfaceImporter, files: readonly File[], size: SurfaceSize = 1024, taken: (id: string) => boolean = () => false): Promise<{ id: string | null; said: string }> {
  return addSurface(editor, () => importSurface(files, size), taken);
}

/** A Poly Haven texture added as `addImported` adds files: downloaded, imported, its four kinds in the strip. */
export async function addPolyHaven(editor: SurfaceImporter, id: string, size: SurfaceSize = 1024, taken: (id: string) => boolean = () => false, fetcher: typeof fetch = fetch, progress?: Progress): Promise<{ id: string | null; said: string }> {
  return addSurface(editor, () => importPolyHaven(id, size, fetcher, progress), taken);
}

/**
 * A Poly Haven texture added **linked**, not carried: downloaded and imported as `addPolyHaven` does - so its name, its
 * Size, its average colour and its four kinds are Poly Haven's - but the project keeps only its name and the size its
 * maps are kept at (`polyHaven`), and the maps go into this browser's keeping (`cache`), under the key the page's
 * resolver looks for, so it is drawn at once here and fetched by any other browser the first time it is drawn there.
 */
export async function linkPolyHaven(
  editor: SurfaceImporter,
  id: string,
  size: SurfaceSize = 1024,
  taken: (id: string) => boolean = () => false,
  options: { cache?: SurfaceCache; progress?: Progress; importing?: PolyHavenImport; fetcher?: typeof fetch } = {},
): Promise<{ id: string | null; said: string }> {
  const { cache = browserSurfaceCache(), progress, importing = importPolyHaven, fetcher = fetch } = options;
  return addSurface(
    editor,
    async () => {
      const imported = await importing(id, size, fetcher, progress);
      const { maps, ...named } = imported.surface;
      await cache.put(linkedKey({ id, pixels: size }), { maps: maps!, color: imported.color });
      return { ...imported, surface: { ...named, polyHaven: { id, pixels: size } } };
    },
    taken,
  );
}

/** A material imported however it came, added with its four kinds and its block picked: what to tell the author. */
async function addSurface(editor: SurfaceImporter, importing: () => Promise<ImportedSurface>, taken: (id: string) => boolean): Promise<{ id: string | null; said: string }> {
  try {
    const project = editor.session.project;
    const clash = (id: string): boolean => taken(id) || (project.surfaces ?? []).some((s) => s.id === id) || (project.terrainPalette ?? []).some((t) => t.id === id);
    const imported = await importing();
    const { surface, kinds } = withKinds(imported, clash);
    const refused = editor.importSurface(surface, kinds);
    if (refused !== null) return { id: null, said: refused };
    editor.openTerrainTab('tiles');
    editor.setTool('placeTile');
    editor.set('tileId', kinds[0]!.id);
    const skipped = imported.ignored.length === 0 ? '' : ` Not read: ${imported.ignored.join(', ')}.`;
    const squeezed = imported.compressed === true ? '' : ` Not compressed for the GPU (${imported.compressed.why}), so it takes four times the memory.`;
    const done = surface.polyHaven === undefined ? `Imported ${surface.name}` : `Linked ${surface.name}, kept in this browser and named in the project`;
    return { id: surface.id, said: `${done}: four tiles in the Terrain strip.${skipped}${squeezed}` };
  } catch (failure) {
    return { id: null, said: failure instanceof Error ? failure.message : String(failure) };
  }
}

/** A material and its four kinds of tile, their ids moved along past any the project has taken. */
export function withKinds(imported: ImportedSurface, taken: (id: string) => boolean): { surface: TileSurface; kinds: SurfaceKind[] } {
  const { id, kinds } = kindsForSurface(imported.surface, imported.color, taken);
  const name = id === imported.surface.id ? imported.surface.name : kinds[0]!.name.replace(/ Block$/, '');
  return { surface: { ...imported.surface, id, name }, kinds };
}
