/**
 * A Poly Haven texture downloaded (`surface-import.ts`, `downloadPolyHaven`), Poly Haven played by a fake `fetch`: what
 * is asked for, the files that come of it, and what the author is told when it goes wrong. Decoding and packing need a
 * browser and are the e2e's (`tests/e2e/tile-surfaces.spec.ts`).
 */

import { describe, expect, it } from 'vitest';
import { downloadPolyHaven } from './surface-import';

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
