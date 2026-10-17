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
 */

import { unzip } from 'fflate';
import { classifySurfaceFiles, kindsForSurface, meanColor, packMaps, refusalOf, surfaceIdentity, type DecodedMaps, type Pixels, type SurfaceKind } from '../engine/content/tile-surface-kit';
import type { TileSurface } from '../engine/scene/schema';

/** The largest side a material's maps are kept at: an import option. Never scaled up. */
export const SURFACE_SIZES = [512, 1024, 2048] as const;
export type SurfaceSize = (typeof SURFACE_SIZES)[number];

/** A material imported: what the project keeps, its colour, and the files that were no map it reads. */
export interface ImportedSurface {
  surface: TileSurface;
  color: string;
  ignored: string[];
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

/**
 * A material from the files given - a zip, or its images loose - at most `size` pixels on a side: its maps found by
 * name, decoded, packed and encoded. Throws, with something to say, when there is no colour map to draw it from.
 */
export async function importSurface(files: readonly File[], size: SurfaceSize = 1024): Promise<ImportedSurface> {
  const found = await filesOf(files);
  const roles = classifySurfaceFiles(found.map((file) => file.name));
  const refusal = refusalOf(roles);
  if (refusal !== null) throw new Error(refusal);
  const blobOf = (name: string | undefined): Blob | undefined => found.find((file) => file.name === name)?.blob;
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
  const maps: DecodedMaps = { color: (await at(roles.color))! };
  if (normal !== undefined) Object.assign(maps, { normal, dx: roles.normalGL === undefined });
  for (const role of ['height', 'roughness', 'ao', 'metalness'] as const) {
    const pixels = await at(roles[role]);
    if (pixels !== undefined) maps[role] = pixels;
  }
  const packed = packMaps(maps);
  const shape = { width, height, data: packed.color };
  const zip = files.find((file) => /\.zip$/i.test(file.name));
  const identity = surfaceIdentity(zip?.name ?? roles.color!);
  return {
    surface: {
      id: identity.id,
      name: identity.name,
      ...(identity.source === undefined ? {} : { source: identity.source }),
      maps: {
        color: await dataUrl(await encode(shape, packed.color, false)),
        normalHeight: await dataUrl(await encode(shape, packed.normalHeight, true)),
        orm: await dataUrl(await encode(shape, packed.orm, false)),
      },
      parallax: packed.parallax,
      size: 1,
      depth: 0.06,
      normalScale: 1,
      roughness: 1,
    },
    color: meanColor(maps.color),
    ignored: roles.ignored,
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
  try {
    const project = editor.session.project;
    const clash = (id: string): boolean => taken(id) || (project.surfaces ?? []).some((s) => s.id === id) || (project.terrainPalette ?? []).some((t) => t.id === id);
    const imported = await importSurface(files, size);
    const { surface, kinds } = withKinds(imported, clash);
    const refused = editor.importSurface(surface, kinds);
    if (refused !== null) return { id: null, said: refused };
    editor.openTerrainTab('tiles');
    editor.setTool('placeTile');
    editor.set('tileId', kinds[0]!.id);
    const skipped = imported.ignored.length === 0 ? '' : ` Not read: ${imported.ignored.join(', ')}.`;
    return { id: surface.id, said: `Imported ${surface.name}: four tiles in the Terrain strip.${skipped}` };
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
