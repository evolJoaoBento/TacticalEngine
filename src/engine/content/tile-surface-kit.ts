/**
 * Importing a material, the parts that need no browser (`docs/DEVELOPING.md`, "Importing a tile material"): which file
 * of a set is which map (`classifySurfaceFiles`), what the material is called (`surfaceIdentity`), the four kinds of
 * tile it gives a project (`kindsForSurface`), and its maps packed into the three textures it is drawn with
 * (`packMaps`). The editor decodes and encodes the images (`editor/surface-import.ts`); everything it decides is here.
 *
 * Built for ambientCG's downloads (`Bricks076_1K-JPG.zip`: `Bricks076_1K-JPG_Color.jpg`, `_NormalGL`, `_Roughness`,
 * `_AmbientOcclusion`, `_Displacement`), and as glad of Poly Haven's (`_diff_1k`, `_nor_gl_1k`, `_rough_1k`, `_disp_1k`)
 * or a set made by hand (`_basecolor`, `_albedo`, `_normal`, `_height`, `_metallic`). A colour map is the one thing a
 * set must have.
 */

import { toContentId } from './types';

/** What each map of a set is, by file name; and the files that are none of them. */
export interface SurfaceFiles {
  color?: string;
  normalGL?: string;
  normalDX?: string;
  roughness?: string;
  ao?: string;
  height?: string;
  metalness?: string;
  /** Every file that is no map this reads: an opacity map, a preview, a material file, a format no browser decodes. */
  ignored: string[];
}

type Role = Exclude<keyof SurfaceFiles, 'ignored'>;

const IMAGE = /\.(jpe?g|png|webp)$/i;

/** The words that name each map, as they come in a file name - split on `_`, `-`, `.` and spaces, any case. */
const WORDS: [Role, readonly string[]][] = [
  ['color', ['color', 'colour', 'basecolor', 'basecolour', 'albedo', 'diffuse', 'diff', 'col']],
  ['roughness', ['roughness', 'rough']],
  ['ao', ['ambientocclusion', 'ao', 'occlusion']],
  ['height', ['displacement', 'disp', 'height']],
  ['metalness', ['metalness', 'metallic', 'metal']],
];
const NORMAL = ['normal', 'nor', 'nrm'];

/** The file a path names, without its folders. */
const fileOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** What one file is, or nothing: its name's words read as a map's. */
function roleOf(name: string): Role | null {
  const words = fileOf(name)
    .replace(IMAGE, '')
    .toLowerCase()
    .split(/[_\-. ]+/)
    .filter((word) => word !== '');
  if (words.includes('opacity')) return null;
  if (words.includes('normalgl')) return 'normalGL';
  if (words.includes('normaldx')) return 'normalDX';
  if (words.some((word) => NORMAL.includes(word))) return words.includes('dx') ? 'normalDX' : 'normalGL';
  for (const [role, said] of WORDS) if (words.some((word) => said.includes(word))) return role;
  return null;
}

/** Each file of a set, as the map it is: the first of each, by name; anything else given back as ignored. */
export function classifySurfaceFiles(names: readonly string[]): SurfaceFiles {
  const found: SurfaceFiles = { ignored: [] };
  for (const name of names) {
    const role = IMAGE.test(name) ? roleOf(name) : null;
    if (role === null || found[role] !== undefined) found.ignored.push(fileOf(name));
    else found[role] = name;
  }
  return found;
}

/** Why a set cannot be imported, if it cannot: nothing to draw its colour from. */
export function refusalOf(files: SurfaceFiles): string | null {
  return files.color === undefined ? 'No colour map: a material needs at least its Color (or basecolor, albedo, diffuse) image.' : null;
}

/** Words run together in camel case, apart: `PavingStones` is `Paving Stones`. */
const spaced = (word: string): string => word.replace(/([a-z])([A-Z])/g, '$1 $2');

/** What a material is called, and its id, from the zip - or the colour map - it came in. */
export function surfaceIdentity(fileName: string): { id: string; name: string; source?: string } {
  const base = fileOf(fileName).replace(/\.(zip|jpe?g|png|webp)$/i, '');
  // ambientCG: a name, a number, and the resolution and format downloaded - `Bricks076_1K-JPG`.
  // A letter after the number is part of the name too: `Bricks075A`.
  const ambient = /^([A-Za-z]+)(\d+[A-Z]?)_\d+K-[A-Za-z]+(?:_|$)/.exec(base);
  if (ambient !== null) {
    const [, word = '', number = ''] = ambient;
    return { id: toContentId(`${word}${number}`), name: `${spaced(word)} ${number}`, source: `ambientCG ${word}${number}` };
  }
  // Anything else: its words, less the resolution and the map the file is.
  const words = base
    .split(/[_\-. ]+/)
    .filter((word) => word !== '' && !/^\d+k$/i.test(word) && !/^(jpe?g|png|webp)$/i.test(word) && roleOf(`x_${word}.png`) === null && !/^(gl|dx)$/i.test(word))
    .flatMap((word) => spaced(word).split(' '));
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Surface';
  return { id: toContentId(name) || 'surface', name };
}

/** A kind of tile, as a project declares it. */
export interface SurfaceKind {
  id: string;
  name: string;
  passable: boolean;
  cost: number;
  providesCover: boolean;
  blocksSight: boolean;
  color: string;
  structure: string;
  surface: string;
}

/** The four structures a material gives, in the order they are listed: what each is called, and its rules. */
const FOUR: readonly { structure: string; called: string; providesCover: boolean }[] = [
  { structure: 'block', called: 'Block', providesCover: false },
  { structure: 'wall', called: 'Wall', providesCover: true },
  { structure: 'floor', called: 'Floor', providesCover: false },
  { structure: 'stairs', called: 'Stairs', providesCover: false },
];

/** How many kinds of tile a material gives a project. */
export const KINDS_PER_SURFACE = FOUR.length;

/**
 * The four kinds of tile a material gives: a block, a wall, a floor slab and a staircase, drawn in it, with the rules
 * the engine's own stone ones have - a wall gives cover, nothing blocks sight, everything costs 1 to enter. Their
 * colour the material's mean colour, what the card shows and what stands in while its maps load. An id already taken
 * - the material's, or any of the four's - moves them all along to `<id>-2`, `-3`, ...
 */
export function kindsForSurface(identity: { id: string; name: string }, color: string, taken: (id: string) => boolean): { id: string; kinds: SurfaceKind[] } {
  const clashes = (id: string): boolean => taken(id) || FOUR.some((four) => taken(`${id}-${four.structure}`));
  let id = identity.id;
  for (let n = 2; clashes(id); n++) id = `${identity.id}-${n}`;
  const name = id === identity.id ? identity.name : `${identity.name} ${id.slice(identity.id.length + 1)}`;
  return {
    id,
    kinds: FOUR.map((four) => ({
      id: `${id}-${four.structure}`,
      name: `${name} ${four.called}`,
      passable: true,
      cost: 1,
      providesCover: four.providesCover,
      blocksSight: false,
      color,
      structure: four.structure,
      surface: id,
    })),
  };
}

/** One decoded image: RGBA, a row after another. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A set's maps, decoded, all at one size; `dx` when the normal map is DirectX's way up (green flipped). */
export interface DecodedMaps {
  color: Pixels;
  normal?: Pixels;
  dx?: boolean;
  height?: Pixels;
  roughness?: Pixels;
  ao?: Pixels;
  metalness?: Pixels;
}

/** What stands in for a map a set has not got: no occlusion, a fairly rough, wholly dielectric surface, flat. */
export const MISSING = { ao: 255, roughness: 217, metalness: 0, normal: 128, height: 255 } as const;

/** A pixel's brightness, for a grey map given in colour. */
const luminance = (data: Uint8ClampedArray, i: number): number => Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);

/**
 * The maps packed into the three textures the shader reads: the colour as it is; the normal's X and Y, OpenGL's way
 * up, with the height in blue; the occlusion, roughness and metalness. Alpha opaque throughout: a canvas keeps it
 * premultiplied, and anything put there would cost the colour. And whether there was a height to draw parallax from.
 */
export function packMaps(maps: DecodedMaps): { width: number; height: number; color: Uint8ClampedArray; normalHeight: Uint8ClampedArray; orm: Uint8ClampedArray; parallax: boolean } {
  const { width, height } = maps.color;
  for (const [role, pixels] of Object.entries(maps)) {
    if (typeof pixels === 'object' && pixels !== null && (pixels.width !== width || pixels.height !== height)) throw new RangeError(`the ${role} map is not the colour map's size`);
  }
  const size = width * height * 4;
  const color = new Uint8ClampedArray(size);
  const normalHeight = new Uint8ClampedArray(size);
  const orm = new Uint8ClampedArray(size);
  const grey = (pixels: Pixels | undefined, i: number, missing: number): number => (pixels === undefined ? missing : luminance(pixels.data, i));
  for (let i = 0; i < size; i += 4) {
    color[i] = maps.color.data[i]!;
    color[i + 1] = maps.color.data[i + 1]!;
    color[i + 2] = maps.color.data[i + 2]!;
    color[i + 3] = 255;
    normalHeight[i] = maps.normal === undefined ? MISSING.normal : maps.normal.data[i]!;
    normalHeight[i + 1] = maps.normal === undefined ? MISSING.normal : maps.dx === true ? 255 - maps.normal.data[i + 1]! : maps.normal.data[i + 1]!;
    normalHeight[i + 2] = grey(maps.height, i, MISSING.height);
    normalHeight[i + 3] = 255;
    orm[i] = grey(maps.ao, i, MISSING.ao);
    orm[i + 1] = grey(maps.roughness, i, MISSING.roughness);
    orm[i + 2] = grey(maps.metalness, i, MISSING.metalness);
    orm[i + 3] = 255;
  }
  return { width, height, color, normalHeight, orm, parallax: maps.height !== undefined };
}

/** A colour map's mean colour, as a kind of tile's colour: `#rrggbb`. */
export function meanColor(pixels: Pixels): string {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = Math.max(1, pixels.width * pixels.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    r += pixels.data[i]!;
    g += pixels.data[i + 1]!;
    b += pixels.data[i + 2]!;
  }
  const hex = (v: number): string => Math.round(v / count).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
