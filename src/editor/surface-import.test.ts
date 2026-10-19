/**
 * A Poly Haven texture downloaded (`surface-import.ts`, `downloadPolyHaven`), Poly Haven played by a fake `fetch`: what
 * is asked for, the files that come of it, and what the author is told when it goes wrong. Decoding and packing need a
 * browser and are the e2e's (`tests/e2e/tile-surfaces.spec.ts`).
 */

import { describe, expect, it } from 'vitest';
import { downloadPolyHaven, isCompressedSurface, linkPolyHaven, linkedKey, linkedSurfaceResolver, type ImportedSurface, type ResolvedSurface, type SurfaceCache, type SurfaceImporter } from './surface-import';
import { tileSurfaceSchema, type TileSurface } from '../engine/scene/schema';
import type { SurfaceKind } from '../engine/content/tile-surface-kit';

const DL = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg';
const map = (res: string, name: string) => ({ jpg: { url: `${DL}/${res}/bricks/bricks_${name}_${res}.jpg` } });
const FILES = {
  Diffuse: { '1k': map('1k', 'diff'), '2k': map('2k', 'diff') },
  nor_gl: { '1k': map('1k', 'nor_gl'), '2k': map('2k', 'nor_gl') },
  Rough: { '1k': map('1k', 'rough'), '2k': map('2k', 'rough') },
  Displacement: { '1k': map('1k', 'disp'), '2k': map('2k', 'disp') },
  arm: { '1k': map('1k', 'arm') },
};

/** Poly Haven as a fake: the routes it answers, every other a 404; and every address asked. */
function polyHaven(routes: Record<string, unknown>): { fetcher: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const body = routes[url];
    if (body === undefined) return new Response('No asset', { status: 404 });
    if (body instanceof Response) return body;
    return typeof body === 'string' ? new Response(new Blob([body], { type: 'image/jpeg' })) : Response.json(body);
  }) as typeof fetch;
  return { fetcher, asked };
}

const API = 'https://api.polyhaven.com';
const images = (res: string) => Object.fromEntries(['diff', 'nor_gl', 'rough', 'disp'].map((name) => [`${DL}/${res}/bricks/bricks_${name}_${res}.jpg`, `${name} pixels`]));

describe('a Poly Haven texture downloaded', () => {
  it('is its maps as files named as Poly Haven names them, its name, and the tiles a repeat covers', async () => {
    const { fetcher, asked } = polyHaven({ [`${API}/info/bricks`]: { name: 'Bricks 01', dimensions: [2500, 2500] }, [`${API}/files/bricks`]: FILES, ...images('1k') });
    const download = await downloadPolyHaven('bricks', 1024, fetcher);
    expect(download.name).toBe('Bricks 01');
    expect(download.size).toBe(2.5);
    expect(download.files.map((f) => f.name)).toEqual(['bricks_diff_1k.jpg', 'bricks_nor_gl_1k.jpg', 'bricks_rough_1k.jpg', 'bricks_disp_1k.jpg']);
    expect(download.files[0]!.type).toBe('image/jpeg');
    expect(await download.files[2]!.text()).toBe('rough pixels');
    // Nothing asked that is not read: no packed copy.
    expect(asked.some((url) => url.includes('_arm_'))).toBe(false);
  });

  it('counts its maps in as they land', async () => {
    const { fetcher } = polyHaven({ [`${API}/info/bricks`]: { name: 'Bricks 01' }, [`${API}/files/bricks`]: FILES, ...images('1k') });
    const said: string[] = [];
    await downloadPolyHaven('bricks', 1024, fetcher, (words) => said.push(words));
    expect(said).toEqual(['downloading 0 of 4 maps', 'downloading 1 of 4 maps', 'downloading 2 of 4 maps', 'downloading 3 of 4 maps', 'downloading 4 of 4 maps']);
  });

  it('at 2K for a material kept at 2K', async () => {
    const { fetcher } = polyHaven({ [`${API}/info/bricks`]: { name: 'Bricks 01' }, [`${API}/files/bricks`]: FILES, ...images('2k') });
    const download = await downloadPolyHaven('bricks', 2048, fetcher);
    expect(download.files.map((f) => f.name)).toContain('bricks_diff_2k.jpg');
    expect(download.size).toBe(1);
  });

  it('says so when Poly Haven has no such texture, when it is not a texture, and when a file will not come', async () => {
    await expect(downloadPolyHaven('nothing', 1024, polyHaven({}).fetcher)).rejects.toThrow('Poly Haven has no "nothing"');
    const hdri = polyHaven({ [`${API}/info/sky`]: { name: 'Sky' }, [`${API}/files/sky`]: { hdri: { '1k': { hdr: { url: 'sky.hdr' } } } } });
    await expect(downloadPolyHaven('sky', 1024, hdri.fetcher)).rejects.toThrow('"sky" is not a texture on Poly Haven');
    const down = polyHaven({ [`${API}/info/bricks`]: new Response('', { status: 503 }), [`${API}/files/bricks`]: FILES });
    await expect(downloadPolyHaven('bricks', 1024, down.fetcher)).rejects.toThrow('Poly Haven did not answer (503)');
    const missing = polyHaven({ [`${API}/info/bricks`]: { name: 'Bricks 01' }, [`${API}/files/bricks`]: FILES, ...images('1k'), [`${DL}/1k/bricks/bricks_disp_1k.jpg`]: new Response('', { status: 500 }) });
    await expect(downloadPolyHaven('bricks', 1024, missing.fetcher)).rejects.toThrow('Could not download bricks_disp_1k.jpg from Poly Haven (500)');
  });
});

describe('a linked material, resolved', () => {
  /** A cache of the test's own: a Map. */
  const memory = (): SurfaceCache & { kept: Map<string, ResolvedSurface> } => {
    const kept = new Map<string, ResolvedSurface>();
    return { kept, get: async (key) => kept.get(key), put: async (key, value) => void kept.set(key, value) };
  };
  /** An import of the test's own, counting what it was asked for, and saying it is half done. */
  const importer = () => {
    const asked: string[] = [];
    let failing = false;
    const importing = async (id: string, size: number, _fetcher: typeof fetch, progress?: (said: string) => void): Promise<ImportedSurface> => {
      asked.push(`${id}@${size}`);
      progress?.('half done');
      await Promise.resolve();
      if (failing) throw new Error('offline');
      return { surface: { id, name: id, maps: { color: `${id}-c`, normalHeight: `${id}-n`, orm: `${id}-o` }, parallax: true, size: 1, depth: 0.06, normalScale: 1, roughness: 1, tint: 0 }, color: '#405060', ignored: [], compressed: true };
    };
    return { asked, importing, fail: (on: boolean) => void (failing = on) };
  };
  const linked = (pixels = 1024): TileSurface => ({ id: 'slate', name: 'Slate', polyHaven: { id: 'rock_wall_10', pixels }, parallax: true, size: 1.8, depth: 0.06, normalScale: 1, roughness: 1, tint: 0 });

  it('is imported once, kept, and read back from the cache after - by this browser, and by any other copy of the page', async () => {
    const cache = memory();
    const { asked, importing } = importer();
    const resolve = linkedSurfaceResolver(cache, fetch, importing);
    const first = await resolve(linked());
    expect(first).toEqual({ maps: { color: 'rock_wall_10-c', normalHeight: 'rock_wall_10-n', orm: 'rock_wall_10-o' }, color: '#405060' });
    expect([...cache.kept.keys()]).toEqual([linkedKey({ id: 'rock_wall_10', pixels: 1024 })]);
    expect(await resolve(linked())).toEqual(first);
    expect(await linkedSurfaceResolver(cache, fetch, importing)(linked())).toEqual(first);
    expect(asked).toEqual(['rock_wall_10@1024']);
  });

  it('is fetched once when asked for twice while on its way, at the largest size an import keeps that the link allows', async () => {
    const { asked, importing } = importer();
    const resolve = linkedSurfaceResolver(memory(), fetch, importing);
    await Promise.all([resolve(linked(700)), resolve(linked(700))]);
    expect(asked).toEqual(['rock_wall_10@512']);
  });

  it('tells everyone waiting on it how it is getting on, and says nothing when this browser has it', async () => {
    const cache = memory();
    const { importing } = importer();
    const resolve = linkedSurfaceResolver(cache, fetch, importing);
    const first: string[] = [];
    const second: string[] = [];
    const both = Promise.all([resolve(linked(), (said) => first.push(said)), resolve(linked(), (said) => second.push(said))]);
    await both;
    expect([first, second]).toEqual([['half done'], ['half done']]);
    const later: string[] = [];
    await linkedSurfaceResolver(cache, fetch, importing)(linked(), (said) => later.push(said));
    expect(later).toEqual([]);
  });

  it('keeps nothing when the fetch fails, and tries again the next time it is asked for', async () => {
    const cache = memory();
    const { asked, importing, fail } = importer();
    const resolve = linkedSurfaceResolver(cache, fetch, importing);
    fail(true);
    await expect(resolve(linked())).rejects.toThrow('offline');
    expect(cache.kept.size).toBe(0);
    fail(false);
    await expect(resolve(linked())).resolves.toMatchObject({ color: '#405060' });
    expect(asked).toEqual(['rock_wall_10@1024', 'rock_wall_10@1024']);
  });

  it('counts as compressed, so its page offers no Compress: it is compressed as it is fetched', () => {
    expect(isCompressedSurface({ maps: undefined })).toBe(true);
    expect(isCompressedSurface({ maps: { color: 'data:image/ktx2;base64,A', normalHeight: 'data:image/ktx2;base64,B', orm: 'data:image/ktx2;base64,C' } })).toBe(true);
    expect(isCompressedSurface({ maps: { color: 'data:image/ktx2;base64,A', normalHeight: 'data:image/png;base64,B', orm: 'data:image/ktx2;base64,C' } })).toBe(false);
  });

  it('refuses a material that is not linked', async () => {
    const { importing } = importer();
    const { polyHaven: _link, ...carried } = { ...linked(), maps: { color: 'c', normalHeight: 'n', orm: 'o' } };
    await expect(linkedSurfaceResolver(memory(), fetch, importing)(carried)).rejects.toThrow('"slate" is not linked to any texture');
  });
});

describe('a Poly Haven texture linked from the editor', () => {
  /** The editor, as far as an import goes: what it was given, and what it picked. */
  const editor = () => {
    const given: { surface: TileSurface; kinds: readonly SurfaceKind[] }[] = [];
    const picked: string[] = [];
    const importer: SurfaceImporter = {
      session: { project: { surfaces: [], terrainPalette: [] } },
      importSurface: (surface, kinds) => {
        given.push({ surface, kinds });
        return null;
      },
      openTerrainTab: () => undefined,
      setTool: () => undefined,
      set: (_key, value) => void picked.push(value),
    };
    return { importer, given, picked };
  };
  const cache = (): SurfaceCache & { kept: Map<string, ResolvedSurface> } => {
    const kept = new Map<string, ResolvedSurface>();
    return { kept, get: async (key) => kept.get(key), put: async (key, value) => void kept.set(key, value) };
  };
  const imported = (id: string): ImportedSurface => ({
    surface: { id: 'castle-brick', name: 'Castle Brick 07', source: `Poly Haven ${id} (CC0)`, maps: { color: 'k-c', normalHeight: 'k-n', orm: 'k-o' }, parallax: true, size: 2.5, depth: 0.06, normalScale: 1, roughness: 1, tint: 0, color: '#705040' },
    color: '#705040',
    ignored: [],
    compressed: true,
  });

  it('is named in the project with the size its maps are kept at, its maps kept in this browser where the page will look for them', async () => {
    const { importer, given, picked } = editor();
    const kept = cache();
    const said: string[] = [];
    const sizes: number[] = [];
    const result = await linkPolyHaven(importer, 'castle_brick_07', 2048, () => false, {
      cache: kept,
      progress: (words) => said.push(words),
      importing: async (id, size, _fetcher, progress) => {
        sizes.push(size);
        progress?.('packing its maps');
        return imported(id);
      },
    });
    expect(result).toEqual({ id: 'castle-brick', said: 'Linked Castle Brick 07, kept in this browser and named in the project: four tiles in the Terrain strip.' });
    expect(sizes).toEqual([2048]);
    expect(said).toEqual(['packing its maps']);
    const surface = given[0]!.surface;
    expect(surface.maps).toBeUndefined();
    expect(surface).toMatchObject({ name: 'Castle Brick 07', polyHaven: { id: 'castle_brick_07', pixels: 2048 }, size: 2.5, color: '#705040', source: 'Poly Haven castle_brick_07 (CC0)' });
    expect(tileSurfaceSchema.safeParse(surface).success).toBe(true);
    expect(given[0]!.kinds).toHaveLength(4);
    expect(picked).toEqual([given[0]!.kinds[0]!.id]);
    // Under the key the page's resolver asks for: drawn at once, never downloaded twice.
    expect([...kept.kept.entries()]).toEqual([[linkedKey(surface.polyHaven!), { maps: { color: 'k-c', normalHeight: 'k-n', orm: 'k-o' }, color: '#705040' }]]);
    const again: string[] = [];
    await linkedSurfaceResolver(kept, fetch, async () => {
      again.push('fetched');
      return imported('castle_brick_07');
    })(surface);
    expect(again).toEqual([]);
  });

  it('says why when Poly Haven will not give it, and adds and keeps nothing', async () => {
    const { importer, given } = editor();
    const kept = cache();
    const result = await linkPolyHaven(importer, 'no_such', 1024, () => false, {
      cache: kept,
      importing: async () => {
        throw new Error('Poly Haven has no "no_such"');
      },
    });
    expect(result).toEqual({ id: null, said: 'Poly Haven has no "no_such"' });
    expect([given, kept.kept.size]).toEqual([[], 0]);
  });
});
