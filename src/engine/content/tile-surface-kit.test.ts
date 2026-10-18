/**
 * Importing a material, the parts that need no browser (`tile-surface-kit.ts`): which file is which map, what the
 * material is called, the four kinds of tile it gives, and its maps packed into the shader's three textures.
 */

import { describe, expect, it } from 'vitest';
import { MISSING, classifySurfaceFiles, kindsForSurface, meanColor, packMaps, refusalOf, surfaceIdentity, type Pixels } from './tile-surface-kit';

describe("a material's files", () => {
  it("reads every map of an ambientCG download, and gives back what it does not read", () => {
    const files = classifySurfaceFiles([
      'Bricks076_1K-JPG_Color.jpg',
      'Bricks076_1K-JPG_NormalGL.jpg',
      'Bricks076_1K-JPG_NormalDX.jpg',
      'Bricks076_1K-JPG_Roughness.jpg',
      'Bricks076_1K-JPG_AmbientOcclusion.jpg',
      'Bricks076_1K-JPG_Displacement.jpg',
      'Bricks076_1K-JPG_Metalness.jpg',
      'Bricks076_1K-JPG_Opacity.jpg',
      'Bricks076.png',
      'Bricks076_1K-JPG.usdc',
      'Bricks076_1K-JPG.mtlx',
      'Bricks076_1K-JPG.tres',
      'Bricks076_1K-JPG_Displacement.exr',
    ]);
    expect(files).toEqual({
      color: 'Bricks076_1K-JPG_Color.jpg',
      normalGL: 'Bricks076_1K-JPG_NormalGL.jpg',
      normalDX: 'Bricks076_1K-JPG_NormalDX.jpg',
      roughness: 'Bricks076_1K-JPG_Roughness.jpg',
      ao: 'Bricks076_1K-JPG_AmbientOcclusion.jpg',
      height: 'Bricks076_1K-JPG_Displacement.jpg',
      metalness: 'Bricks076_1K-JPG_Metalness.jpg',
      ignored: ['Bricks076_1K-JPG_Opacity.jpg', 'Bricks076.png', 'Bricks076_1K-JPG.usdc', 'Bricks076_1K-JPG.mtlx', 'Bricks076_1K-JPG.tres', 'Bricks076_1K-JPG_Displacement.exr'],
    });
  });

  it("reads Poly Haven's names and a set made by hand, in folders, in any case", () => {
    expect(classifySurfaceFiles(['textures/rock_wall_diff_1k.jpg', 'textures/rock_wall_nor_gl_1k.png', 'textures/rock_wall_nor_dx_1k.png', 'textures/rock_wall_rough_1k.jpg', 'textures/rock_wall_disp_1k.png', 'textures/rock_wall_ao_1k.jpg'])).toEqual({
      color: 'textures/rock_wall_diff_1k.jpg',
      normalGL: 'textures/rock_wall_nor_gl_1k.png',
      normalDX: 'textures/rock_wall_nor_dx_1k.png',
      roughness: 'textures/rock_wall_rough_1k.jpg',
      height: 'textures/rock_wall_disp_1k.png',
      ao: 'textures/rock_wall_ao_1k.jpg',
      ignored: [],
    });
    expect(classifySurfaceFiles(['Slate_BaseColor.PNG', 'Slate_Normal.png', 'Slate_Height.webp', 'Slate_Metallic.jpeg', 'slate-albedo.png'])).toEqual({
      color: 'Slate_BaseColor.PNG',
      normalGL: 'Slate_Normal.png',
      height: 'Slate_Height.webp',
      metalness: 'Slate_Metallic.jpeg',
      ignored: ['slate-albedo.png'],
    });
  });

  it('refuses a set with no colour map, and nothing else', () => {
    expect(refusalOf(classifySurfaceFiles(['x_Roughness.jpg']))).toMatch(/No colour map/);
    expect(refusalOf(classifySurfaceFiles(['x_Color.jpg']))).toBeNull();
  });
});

describe("a material's name", () => {
  it("is ambientCG's, the resolution and format left out, whichever download it is", () => {
    for (const file of ['Bricks076_1K-JPG.zip', 'Bricks076_2K-PNG.zip', 'downloads/Bricks076_1K-PNG.zip', 'Bricks076_1K-JPG_Color.jpg']) {
      expect(surfaceIdentity(file)).toEqual({ id: 'bricks076', name: 'Bricks 076', source: 'ambientCG Bricks076' });
    }
  });

  it("is anything else's own words, less the resolution and the map", () => {
    expect(surfaceIdentity('rock_wall_diff_1k.jpg')).toEqual({ id: 'rock-wall', name: 'Rock Wall' });
    expect(surfaceIdentity('Mossy Stone.zip')).toEqual({ id: 'mossy-stone', name: 'Mossy Stone' });
    expect(surfaceIdentity('TestStone_1K-PNG.zip')).toEqual({ id: 'test-stone', name: 'Test Stone' });
    expect(surfaceIdentity('PavingStones142_1K-JPG.zip')).toEqual({ id: 'pavingstones142', name: 'Paving Stones 142', source: 'ambientCG PavingStones142' });
    expect(surfaceIdentity('Bricks075A_1K-JPG.zip')).toEqual({ id: 'bricks075a', name: 'Bricks 075A', source: 'ambientCG Bricks075A' });
    expect(surfaceIdentity('_Color.png')).toEqual({ id: 'surface', name: 'Surface' });
  });
});

describe('the four kinds of tile a material gives', () => {
  it('are a block, a wall that gives cover, a floor slab and a staircase, drawn in it, with the stone ones’ rules', () => {
    const { id, kinds } = kindsForSurface({ id: 'bricks076', name: 'Bricks 076' }, '#8a5a44', () => false);
    expect(id).toBe('bricks076');
    expect(kinds).toEqual([
      { id: 'bricks076-block', name: 'Bricks 076 Block', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#8a5a44', structure: 'block', surface: 'bricks076' },
      { id: 'bricks076-wall', name: 'Bricks 076 Wall', passable: true, cost: 1, providesCover: true, blocksSight: false, color: '#8a5a44', structure: 'wall', surface: 'bricks076' },
      { id: 'bricks076-floor', name: 'Bricks 076 Floor', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#8a5a44', structure: 'floor', surface: 'bricks076' },
      { id: 'bricks076-stairs', name: 'Bricks 076 Stairs', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#8a5a44', structure: 'stairs', surface: 'bricks076' },
    ]);
  });

  it('move along to a free id when the material or any of the four is taken', () => {
    const taken = new Set(['bricks076', 'bricks076-2-wall']);
    const { id, kinds } = kindsForSurface({ id: 'bricks076', name: 'Bricks 076' }, '#000000', (x) => taken.has(x));
    expect(id).toBe('bricks076-3');
    expect(kinds.map((k) => [k.id, k.name, k.surface])[0]).toEqual(['bricks076-3-block', 'Bricks 076 3 Block', 'bricks076-3']);
  });
});

describe("a material's maps, packed", () => {
  const solid = (r: number, g: number, b: number, size = 2): Pixels => ({ width: size, height: size, data: new Uint8ClampedArray(Array.from({ length: size * size }, () => [r, g, b, 255]).flat()) });

  it('puts the normal and the height in one texture, the occlusion, roughness and metalness in another, every alpha opaque', () => {
    const packed = packMaps({ color: solid(200, 100, 50), normal: solid(140, 120, 255), height: solid(90, 90, 90), roughness: solid(60, 60, 60), ao: solid(30, 30, 30), metalness: solid(10, 10, 10) });
    expect(Array.from(packed.color.slice(0, 4))).toEqual([200, 100, 50, 255]);
    expect(Array.from(packed.normalHeight.slice(0, 4))).toEqual([140, 120, 90, 255]);
    expect(Array.from(packed.orm.slice(0, 4))).toEqual([30, 60, 10, 255]);
    expect(packed.parallax).toBe(true);
  });

  it("flips a DirectX normal's green, and stands in for every map a set has not got", () => {
    expect(Array.from(packMaps({ color: solid(1, 2, 3), normal: solid(140, 120, 255), dx: true }).normalHeight.slice(0, 4))).toEqual([140, 135, MISSING.height, 255]);
    const bare = packMaps({ color: solid(1, 2, 3) });
    expect(Array.from(bare.normalHeight.slice(0, 4))).toEqual([128, 128, 255, 255]);
    expect(Array.from(bare.orm.slice(0, 4))).toEqual([255, 217, 0, 255]);
    expect(bare.parallax).toBe(false);
  });

  it('refuses maps that are not all one size', () => {
    expect(() => packMaps({ color: solid(1, 2, 3, 2), height: solid(1, 1, 1, 4) })).toThrow(/height/);
  });

  it("gives a colour map's mean colour", () => {
    const half = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) };
    expect(meanColor(half)).toBe('#800080');
  });
});
