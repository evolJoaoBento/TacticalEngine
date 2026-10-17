/**
 * The tests' material (`tests/fixtures/tile-surface/TestStone_1K-PNG.zip`): a small set of bricks drawn here, by this
 * script - our own work, so it carries no licence question - named the way an ambientCG download is, with every map
 * the importer reads and one file it does not.
 *
 *   node tools/make-tile-surface-fixture.mjs
 *
 * 64 pixels a side: the e2e suite runs on a software renderer, and a material's look needs no more to be checked.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';

const SIZE = 64;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../tests/fixtures/tile-surface/TestStone_1K-PNG.zip');

/** A PNG of RGB pixels: the least of the format that every browser reads. */
function png(pixel) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const rows = Buffer.alloc(SIZE * (SIZE * 3 + 1));
  for (let y = 0; y < SIZE; y++) {
    rows[y * (SIZE * 3 + 1)] = 0;
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = pixel(x, y);
      const at = y * (SIZE * 3 + 1) + 1 + x * 3;
      rows[at] = r;
      rows[at + 1] = g;
      rows[at + 2] = b;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** How high the bricks stand at a pixel, 0 to 1: four courses of two bricks, each course offset, mortar between. */
function height(x, y) {
  const course = Math.floor(y / 16);
  const shifted = (x + (course % 2) * 16) % SIZE;
  const inCourse = y % 16;
  const inBrick = shifted % 32;
  const mortar = Math.min(inCourse, 15 - inCourse, inBrick, 31 - inBrick);
  return Math.min(1, mortar / 3);
}

/** A little grain, the same every run. */
const grain = (x, y) => ((x * 73 + y * 151) % 17) / 17;

const grey = (v) => [v, v, v].map((c) => Math.round(Math.max(0, Math.min(255, c))));

const maps = {
  Color: (x, y) => {
    const h = height(x, y);
    const g = grain(x, y) * 20;
    return h < 1 ? grey(150 + g) : [140 + g, 72 + g / 2, 52 + g / 2].map(Math.round);
  },
  NormalGL: (x, y) => {
    const dx = height(Math.min(SIZE - 1, x + 1), y) - height(Math.max(0, x - 1), y);
    const dy = height(x, Math.max(0, y - 1)) - height(x, Math.min(SIZE - 1, y + 1));
    const nx = -dx * 2;
    const ny = -dy * 2;
    const nz = 1;
    const length = Math.hypot(nx, ny, nz);
    return [nx, ny, nz].map((n) => Math.round(((n / length) * 0.5 + 0.5) * 255));
  },
  Roughness: (x, y) => grey(height(x, y) < 1 ? 240 : 190 + grain(x, y) * 30),
  AmbientOcclusion: (x, y) => grey(120 + height(x, y) * 135),
  Displacement: (x, y) => grey(height(x, y) * 255),
};

const files = Object.fromEntries(Object.entries(maps).map(([name, pixel]) => [`TestStone_1K-PNG_${name}.png`, new Uint8Array(png(pixel))]));
// What an ambientCG download carries beside the maps, which the importer gives back as not read.
files['TestStone_1K-PNG.usdc'] = new TextEncoder().encode('#usda 1.0\n');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, zipSync(files, { level: 9 }));
console.log(`wrote ${OUT}`);
