/**
 * Change the colour of a .glb's textures, and nothing else.
 *
 *   node tools/recolour-model.mjs <in.glb> <out.glb> saturation <0..1>
 *   node tools/recolour-model.mjs <in.glb> <out.glb> green <0..1>
 *   node tools/recolour-model.mjs <in.glb> <out.glb> match <reference.glb>
 *   node tools/recolour-model.mjs <in.glb> <out.glb> match-all <reference.glb> [<reference.glb> ...]
 *   node tools/recolour-model.mjs <in.glb> <out.glb> lightness <factor>
 *
 * `saturation` keeps that much of the colour: 1 leaves it as it is, 0 is grey, 0.6 keeps sixty per
 * cent - towards the grey of the same brightness, so nothing gets lighter or darker.
 *
 * `green` turns the browns towards the texture's own green: that much of the way there, for a
 * pixel squarely brown, and less the nearer it already is to green or to purple. Hue alone moves.
 * Each pixel keeps its saturation and its lightness, which is what keeps a dark crack dark and a
 * dry patch as muted as it was - a brown becomes the moss of the same depth, not a paint green -
 * and the green it moves towards is measured from the grass already in the texture, a little past
 * its middle, so the new green is one that sits among the texture's own.
 *
 * `match` makes the browns of one texture the browns of another: it measures the plainly brown
 * pixels of both - their mean hue, saturation and lightness - and moves every pixel of the first by
 * the difference. Saturation and lightness are scaled, not shifted, so light and dark keep their
 * proportion and the texture's contrast survives; hue is turned by the gap between the two means.
 * For a tile that has to sit beside another, as the dirt road does beside grass with dirt in it.
 *
 * `match-all` does the same over every pixel rather than only the browns - hue weighted by how much
 * colour a pixel has, since a grey one has none to give - and takes the average of one or more
 * references: a wall made to look like the rest of the stone it stands among.
 *
 * `lightness` scales every pixel's lightness by the factor - 1.2 is a fifth lighter, 0.9 a tenth
 * darker - and leaves hue and saturation alone. Scaled, like `match`, so the contrast survives.
 *
 * Only the base-colour textures are touched - a normal map or a roughness map is data, not colour,
 * and recolouring one would bend the light on the surface - and everything else in the file is
 * carried across byte for byte: the meshes, the materials, the other maps, the node sizes. The
 * images are decoded and encoded by a headless Chromium (Playwright is a dev dependency already),
 * which reads every format a .glb carries; each is written back in the format it came in.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [input, output, operation, amount] = process.argv.slice(2);
const matching = operation === 'match' || operation === 'match-all';
const strength = matching ? 1 : Number(amount);
const ceiling = operation === 'lightness' ? 3 : 1;
if (input === undefined || output === undefined || !['saturation', 'green', 'match', 'match-all', 'lightness'].includes(operation) || !Number.isFinite(strength) || strength <= 0 && operation === 'lightness' || strength < 0 || strength > ceiling || (matching && amount === undefined)) {
  console.error('usage: node tools/recolour-model.mjs <in.glb> <out.glb> <saturation|green> <0..1>\n       node tools/recolour-model.mjs <in.glb> <out.glb> match <reference.glb>\n       node tools/recolour-model.mjs <in.glb> <out.glb> match-all <reference.glb> [<reference.glb> ...]\n       node tools/recolour-model.mjs <in.glb> <out.glb> lightness <factor, up to 3>');
  process.exit(1);
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** A .glb's JSON and its binary chunk. */
function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${input} is not a .glb`);
  let at = 12;
  let json = null;
  let bin = null;
  while (at < bytes.length) {
    const length = bytes.readUInt32LE(at);
    const type = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8'));
    else if (type === BIN_CHUNK) bin = body;
    at += 8 + length;
  }
  if (json === null || bin === null) throw new Error(`${input} has no JSON or no binary chunk`);
  return { json, bin };
}

/** Write it back, every buffer view where the new layout puts it. */
function writeGlb(json, bin) {
  const pad = (buffer, fill) => (buffer.length % 4 === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4), fill)]));
  const jsonBytes = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binBytes = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binBytes.length, 8);
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(body.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, body]);
  };
  return Buffer.concat([header, chunk(JSON_CHUNK, jsonBytes), chunk(BIN_CHUNK, binBytes)]);
}

/** The image a texture draws, wherever the file keeps it: plain, or behind a WebP or KTX extension. */
function sourceOf(texture) {
  if (texture === undefined) return undefined;
  const extensions = texture.extensions ?? {};
  return texture.source ?? extensions.EXT_texture_webp?.source ?? extensions.KHR_texture_basisu?.source ?? extensions.EXT_texture_avif?.source;
}

const { json, bin } = readGlb(readFileSync(input));

/** The first base-colour image of a .glb, as bytes and a type: what `match` measures a reference by. */
function colourImageOf(path) {
  const glb = readGlb(readFileSync(path));
  for (const material of glb.json.materials ?? []) {
    const texture = material.pbrMetallicRoughness?.baseColorTexture;
    const index = texture === undefined ? undefined : sourceOf(glb.json.textures[texture.index]);
    const image = index === undefined ? undefined : glb.json.images[index];
    if (image?.bufferView === undefined) continue;
    const view = glb.json.bufferViews[image.bufferView];
    return { data: Buffer.from(glb.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)).toString('base64'), mime: image.mimeType ?? 'image/jpeg' };
  }
  throw new Error(`${path}: no base-colour texture inside the file to match`);
}
const references = operation === 'match' ? [colourImageOf(amount)] : operation === 'match-all' ? process.argv.slice(5).map(colourImageOf) : [];

// The images a material reads its colour from, and only those.
const colour = new Set();
for (const material of json.materials ?? []) {
  const texture = material.pbrMetallicRoughness?.baseColorTexture;
  if (texture !== undefined) colour.add(sourceOf(json.textures[texture.index]));
  const diffuse = material.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture;
  if (diffuse !== undefined) colour.add(sourceOf(json.textures[diffuse.index]));
}
const targets = [...colour].filter((index) => index !== undefined && json.images[index]?.bufferView !== undefined);
if (targets.length === 0) {
  console.error(`${input}: no base-colour texture inside the file to change`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const replaced = new Map();
for (const index of targets) {
  const image = json.images[index];
  const view = json.bufferViews[image.bufferView];
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const out = await page.evaluate(async ({ data, mime, operation, strength, references }) => {
    const source = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([source], { type: mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const p = pixels.data;

    // HSL both ways, hue in degrees.
    const toHsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      if (max === min) return [0, 0, l];
      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return [h * 60, s, l];
    };
    const channel = (p1, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p1 + (q - p1) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p1 + (q - p1) * (2 / 3 - t) * 6;
      return p1;
    };
    const toRgb = (h, s, l) => {
      if (s === 0) return [l * 255, l * 255, l * 255];
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p1 = 2 * l - q;
      const hue = ((h % 360) + 360) % 360 / 360;
      return [channel(p1, q, hue + 1 / 3) * 255, channel(p1, q, hue) * 255, channel(p1, q, hue - 1 / 3) * 255];
    };

    /** The browns of an image's pixels: mean hue (circular, degrees), mean saturation, mean lightness. */
    const browns = (px) => {
      let n = 0, sx = 0, sy = 0, ss = 0, sl = 0;
      for (let i = 0; i < px.length; i += 4 * 3) {
        const [h, s, l] = toHsl(px[i], px[i + 1], px[i + 2]);
        const around = h > 180 ? h - 360 : h;
        // The black between a texture's islands is nothing, and a pixel with no colour has no hue.
        if (l < 0.04 || s < 0.06 || around < -25 || around > 50) continue;
        n++;
        sx += Math.cos((around * Math.PI) / 180);
        sy += Math.sin((around * Math.PI) / 180);
        ss += s;
        sl += l;
      }
      if (n === 0) throw new Error('no brown to measure');
      return { hue: (Math.atan2(sy, sx) * 180) / Math.PI, saturation: ss / n, lightness: sl / n };
    };
    /** Every pixel's colour: hue weighted by saturation, mean saturation, mean lightness. */
    const everything = (px) => {
      let n = 0, sx = 0, sy = 0, ss = 0, sl = 0;
      for (let i = 0; i < px.length; i += 4 * 3) {
        const [h, s, l] = toHsl(px[i], px[i + 1], px[i + 2]);
        if (l < 0.04) continue;
        n++;
        ss += s;
        sl += l;
        sx += s * Math.cos((h * Math.PI) / 180);
        sy += s * Math.sin((h * Math.PI) / 180);
      }
      return { hue: (Math.atan2(sy, sx) * 180) / Math.PI, saturation: ss / n, lightness: sl / n };
    };
    /** The references measured one way or the other, and averaged - hue round the circle. */
    const measureReferences = async (measure) => {
      const each = [];
      for (const reference of references) {
        const bytes = Uint8Array.from(atob(reference.data), (c) => c.charCodeAt(0));
        const other = await createImageBitmap(new Blob([bytes], { type: reference.mime }));
        const room = new OffscreenCanvas(other.width, other.height).getContext('2d');
        room.drawImage(other, 0, 0);
        each.push(measure(room.getImageData(0, 0, other.width, other.height).data));
      }
      const x = each.reduce((sum, c) => sum + Math.cos((c.hue * Math.PI) / 180), 0);
      const y = each.reduce((sum, c) => sum + Math.sin((c.hue * Math.PI) / 180), 0);
      return {
        hue: (Math.atan2(y, x) * 180) / Math.PI,
        saturation: each.reduce((sum, c) => sum + c.saturation, 0) / each.length,
        lightness: each.reduce((sum, c) => sum + c.lightness, 0) / each.length,
      };
    };

    if (operation === 'lightness') {
      for (let i = 0; i < p.length; i += 4) {
        const [h, s, l] = toHsl(p[i], p[i + 1], p[i + 2]);
        const [r, g, b] = toRgb(h, s, Math.min(1, l * strength));
        p[i] = r;
        p[i + 1] = g;
        p[i + 2] = b;
      }
    } else if (operation === 'match' || operation === 'match-all') {
      const measure = operation === 'match' ? browns : everything;
      const want = await measureReferences(measure);
      const have = measure(p);
      const turn = want.hue - have.hue;
      const saturate = want.saturation / have.saturation;
      const lighten = want.lightness / have.lightness;
      for (let i = 0; i < p.length; i += 4) {
        const [h, s, l] = toHsl(p[i], p[i + 1], p[i + 2]);
        const [r, g, b] = toRgb(h + turn, Math.min(1, s * saturate), Math.min(1, l * lighten));
        p[i] = r;
        p[i + 1] = g;
        p[i + 2] = b;
      }
      globalThis.matched = { want, have };
    } else if (operation === 'saturation') {
      for (let i = 0; i < p.length; i += 4) {
        const grey = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
        p[i] = grey + (p[i] - grey) * strength;
        p[i + 1] = grey + (p[i + 1] - grey) * strength;
        p[i + 2] = grey + (p[i + 2] - grey) * strength;
      }
    } else {
      // The texture's own green: the middle hue of what is plainly green in it already.
      const greens = [];
      for (let i = 0; i < p.length; i += 4 * 7) {
        const [h, s, l] = toHsl(p[i], p[i + 1], p[i + 2]);
        if (h >= 60 && h <= 150 && s > 0.2 && l > 0.15 && l < 0.85) greens.push(h);
      }
      greens.sort((a, b) => a - b);
      // A touch past its middle, into the blue: the grass in these files leans yellow, and a brown
      // taken only as far as the middle reads olive rather than green.
      const green = (greens.length > 0 ? greens[greens.length >> 1] : 90) + 15;
      // How brown a hue is: all of it from red through orange to the edge of yellow, none by the
      // time it is green, or past red into purple and pink, which are not the dirt.
      const brown = (h) => {
        const around = h > 180 ? h - 360 : h; // red either side of zero, as one run
        if (around >= -20 && around <= 45) return 1;
        if (around > 45 && around < green) return (green - around) / (green - 45);
        if (around < -20 && around > -60) return (around + 60) / 40;
        return 0;
      };
      for (let i = 0; i < p.length; i += 4) {
        const [h, s, l] = toHsl(p[i], p[i + 1], p[i + 2]);
        // Next to no colour, next to no hue: a grey stone stays a grey stone.
        const weight = brown(h) * Math.min(1, s / 0.12) * strength;
        if (weight <= 0) continue;
        const from = h > 180 ? h - 360 : h;
        const [r, g, b] = toRgb(from + (green - from) * weight, s, l);
        p[i] = r;
        p[i + 1] = g;
        p[i + 2] = b;
      }
    }
    context.putImageData(pixels, 0, 0);
    const type = mime === 'image/png' ? 'image/png' : mime === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await canvas.convertToBlob(type === 'image/png' ? { type } : { type, quality: 0.92 });
    const encoded = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < encoded.length; i += 0x8000) text += String.fromCharCode(...encoded.subarray(i, i + 0x8000));
    return { data: btoa(text), width: bitmap.width, height: bitmap.height, type: blob.type, matched: globalThis.matched ?? null };
  }, { data: Buffer.from(bytes).toString('base64'), mime: image.mimeType ?? 'image/jpeg', operation, strength, references });
  if (out.matched !== null) {
    const say = (c) => `hue ${c.hue.toFixed(1)}, saturation ${c.saturation.toFixed(3)}, lightness ${c.lightness.toFixed(3)}`;
    console.log(`${input}: ${operation === 'match' ? 'browns were' : 'colour was'} ${say(out.matched.have)}; matched to ${say(out.matched.want)}`);
  }
  if (out.type !== (image.mimeType ?? 'image/jpeg')) throw new Error(`${input}: image ${index} came back as ${out.type}, not ${image.mimeType}`);
  replaced.set(image.bufferView, Buffer.from(out.data, 'base64'));
  console.log(`${input}: image ${index} (${out.width}x${out.height}) ${(view.byteLength / 1e6).toFixed(2)} MB -> ${(replaced.get(image.bufferView).length / 1e6).toFixed(2)} MB`);
}
await browser.close();

// The binary chunk laid out again in the same order, four-byte aligned, with the new images in.
const order = json.bufferViews.map((view, i) => ({ view, i })).sort((a, b) => (a.view.byteOffset ?? 0) - (b.view.byteOffset ?? 0));
const parts = [];
let offset = 0;
for (const { view, i } of order) {
  const data = replaced.get(i) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const gap = (4 - (offset % 4)) % 4;
  if (gap > 0) parts.push(Buffer.alloc(gap));
  offset += gap;
  view.byteOffset = offset;
  view.byteLength = data.length;
  parts.push(Buffer.from(data));
  offset += data.length;
}
json.buffers[0].byteLength = offset;
writeFileSync(output, writeGlb(json, Buffer.concat(parts)));
console.log(`${output}: ${operation} ${matching ? process.argv.slice(5).join(' ') : strength}`);
