/**
 * Materials from Poly Haven (`poly-haven.ts`): the texture an author names, the files downloaded for it, and the tiles
 * one repeat of it covers - against the shape Poly Haven's API answers with (`rock_wall_08`, trimmed).
 */

import { describe, expect, it } from 'vitest';
import { POLY_HAVEN_STARTERS, polyHavenId, polyHavenMaps, polyHavenResolution, polyHavenSize, type PolyHavenFiles } from './poly-haven';
import { classifySurfaceFiles } from './tile-surface-kit';

const DL = 'https://dl.polyhaven.org/file/ph-assets/Textures';
const at = (res: string, map: string, ext = 'jpg') => ({ url: `${DL}/${ext}/${res}/rock_wall_08/rock_wall_08_${map}_${res}.${ext}` });
const sized = (map: string) => ({ '1k': { jpg: at('1k', map), png: at('1k', map, 'png') }, '2k': { jpg: at('2k', map), png: at('2k', map, 'png') } });
/** What `/files/rock_wall_08` gives, less the formats and resolutions nothing here asks for. */
const ROCK_WALL: PolyHavenFiles = {
  Diffuse: sized('diff'),
  nor_dx: sized('nor_dx'),
  nor_gl: sized('nor_gl'),
  Rough: sized('rough'),
  AO: sized('ao'),
  Displacement: sized('disp'),
  arm: sized('arm'),
  blend: { '1k': { blend: { url: `${DL}/rock_wall_08_1k.blend` } } },
  gltf: { '1k': { gltf: { url: `${DL}/rock_wall_08_1k.gltf` } } },
  mtlx: { '1k': { mtlx: { url: `${DL}/rock_wall_08_1k.mtlx` } } },
};

describe('the texture an author names', () => {
  it('is its id, or the id in a link to its page; nothing when there is none', () => {
    expect(polyHavenId('rock_wall_08')).toBe('rock_wall_08');
    expect(polyHavenId('  Rock_Wall_08 ')).toBe('rock_wall_08');
    expect(polyHavenId('https://polyhaven.com/a/rock_wall_08')).toBe('rock_wall_08');
    expect(polyHavenId('polyhaven.com/textures/castle_brick_07?x=1')).toBe('castle_brick_07');
    expect(polyHavenId('')).toBeNull();
    expect(polyHavenId('rock wall')).toBeNull();
    expect(polyHavenId('../files/x')).toBeNull();
    expect(polyHavenId('https://example.com/a/rock_wall_08/../x')).toBeNull();
  });
});

describe('the files downloaded for it', () => {
  it('are its colour, OpenGL normal, roughness, occlusion and height, as JPEGs at the resolution asked, named as Poly Haven names them', () => {
    const maps = polyHavenMaps(ROCK_WALL, '1k');
    expect(maps.map((m) => m.name)).toEqual(['rock_wall_08_diff_1k.jpg', 'rock_wall_08_nor_gl_1k.jpg', 'rock_wall_08_rough_1k.jpg', 'rock_wall_08_ao_1k.jpg', 'rock_wall_08_disp_1k.jpg']);
    expect(maps[0]!.url).toBe(`${DL}/jpg/1k/rock_wall_08/rock_wall_08_diff_1k.jpg`);
    expect(polyHavenMaps(ROCK_WALL, '2k').every((m) => m.name.endsWith('_2k.jpg'))).toBe(true);
    // And the importer knows every one by its name, none left over.
    const files = classifySurfaceFiles(maps.map((m) => m.name));
    expect(files).toMatchObject({ color: maps[0]!.name, normalGL: maps[1]!.name, roughness: maps[2]!.name, ao: maps[3]!.name, height: maps[4]!.name, ignored: [] });
  });

  it('take the DirectX normal without an OpenGL one, the other resolution or a PNG for a map lacking one, and leave out a map it has not', () => {
    const { nor_gl: _gl, AO: _ao, ...rest } = ROCK_WALL;
    const sparse: PolyHavenFiles = { ...rest, Rough: { '2k': { png: at('2k', 'rough', 'png') } } };
    expect(polyHavenMaps(sparse, '1k').map((m) => m.name)).toEqual(['rock_wall_08_diff_1k.jpg', 'rock_wall_08_nor_dx_1k.jpg', 'rock_wall_08_rough_2k.png', 'rock_wall_08_disp_1k.jpg']);
  });

  it('are none for an asset with no colour map: an HDRI, or a model', () => {
    expect(polyHavenMaps({ hdri: { '1k': { hdr: { url: 'x.hdr' } } }, tonemapped: {} }, '1k')).toEqual([]);
    expect(polyHavenMaps({}, '2k')).toEqual([]);
    // Nor is one with every map but its colour: there would be nothing to draw it from.
    const { Diffuse: _colour, ...colourless } = ROCK_WALL;
    expect(polyHavenMaps(colourless, '1k')).toEqual([]);
  });

  it('are at 2K only for a material kept larger than 1K', () => {
    expect([512, 1024, 2048].map(polyHavenResolution)).toEqual(['1k', '1k', '2k']);
  });
});

describe('the tiles one repeat covers', () => {
  it('are the patch the texture shows, in metres, a tile a metre, within what Size may be', () => {
    expect(polyHavenSize({ dimensions: [1799.9999523162842, 1799.9999523162842] })).toBe(1.8);
    expect(polyHavenSize({ dimensions: [2500, 1250] })).toBe(2.5);
    expect(polyHavenSize({ dimensions: [80_000, 80_000] })).toBe(16);
    expect(polyHavenSize({ dimensions: [10, 10] })).toBe(0.05);
    expect(polyHavenSize({})).toBe(1);
    expect(polyHavenSize({ dimensions: [0, Number.NaN] })).toBe(1);
  });
});

describe('the starters suggested', () => {
  it('are each a Poly Haven id, once, in a dungeon, a town or the wilds', () => {
    const ids = POLY_HAVEN_STARTERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(polyHavenId(id)).toBe(id);
    expect(new Set(POLY_HAVEN_STARTERS.map((s) => s.group))).toEqual(new Set(['Dungeon', 'Town', 'Wilds']));
  });
});
