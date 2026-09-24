/**
 * Make the flames of a model glow, inside the .glb.
 *
 *   node tools/add-flame-glow.mjs <in.glb> <out.glb> [<strength>] [--mask <preview.png>]
 *
 * For a model painted in one texture, as the generated props are, where the fire is the part of
 * the picture that is fire-coloured: bright, strongly coloured, and between red-orange and yellow.
 * Each pixel is weighed by how plainly it is that - soft edges on brightness, colour and hue, so a
 * lick of flame fades into the wick rather than stopping at a line - and the weighed colour becomes
 * the material's emissive map. The wood and iron, darker or greyer, weigh nothing and stay lit only
 * by the room, and a texture with no fire in it at all - the stones of a campfire, a mesh of their
 * own - is given no map.
 *
 * Pushed past 1 with KHR_materials_emissive_strength (3 unless said), so a torch reads as alight
 * in a dark room. It lights nothing but itself: the light a torch throws on the room is the engine's
 * business, not the file's. `--mask` writes the emissive map as a PNG as well, to look at.
 *
 * Everything the file had is kept byte for byte; the map is added after it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const maskAt = args.indexOf('--mask');
const maskPath = maskAt >= 0 ? args[maskAt + 1] : undefined;
if (maskAt >= 0) args.splice(maskAt, 2);
const [input, output, amount = '3'] = args;
const strength = Number(amount);
if (input === undefined || output === undefined || !Number.isFinite(strength) || strength <= 0) {
  console.error('usage: node tools/add-flame-glow.mjs <in.glb> <out.glb> [<strength>] [--mask <preview.png>]');
  process.exit(1);
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const bytes = readFileSync(input);
if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${input} is not a .glb`);
let at = 12;
let json = null;
let bin = null;
while (at < bytes.length) {
  const length = bytes.readUInt32LE(at);
  const type = bytes.readUInt32LE(at + 4);
  const body = bytes.subarray(at + 8, at + 8 + length);
  if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8'));
  else if (type === BIN_CHUNK) bin = Buffer.from(body);
  at += 8 + length;
}
if (json === null || bin === null) throw new Error(`${input} has no JSON or no binary chunk`);

const sourceOf = (texture) => texture?.source ?? texture?.extensions?.EXT_texture_webp?.source;
const materials = (json.materials ?? []).filter((m) => m.pbrMetallicRoughness?.baseColorTexture !== undefined);
if (materials.length === 0) throw new Error(`${input}: no material with a colour texture`);
if (materials.some((m) => m.emissiveTexture !== undefined)) throw new Error(`${input} already has an emissive map`);

const browser = await chromium.launch();
const page = await browser.newPage();
// One emissive map per colour image, shared by every material that paints with it.
const made = new Map();
for (const material of materials) {
  const colourTexture = json.textures[material.pbrMetallicRoughness.baseColorTexture.index];
  const source = sourceOf(colourTexture);
  const image = json.images[source];
  if (image?.bufferView === undefined) throw new Error(`${input}: the colour image is not inside the file`);
  if (made.has(source)) continue;
  const view = json.bufferViews[image.bufferView];
  const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const out = await page.evaluate(async ({ data, mime, preview }) => {
    const source = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([source], { type: mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const p = pixels.data;
    const ramp = (lo, hi, x) => Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    let lit = 0;
    let touched = 0;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i] / 255;
      const g = p[i + 1] / 255;
      const b = p[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      let hue = 0;
      if (max !== min) {
        const d = max - min;
        hue = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
      }
      // Fire: red-orange to yellow, strongly coloured, and bright. Wood is darker, iron greyer.
      const weight = ramp(4, 14, hue) * (1 - ramp(52, 64, hue)) * ramp(0.45, 0.6, saturation) * ramp(0.68, 0.8, max);
      if (weight > 0.5) lit++;
      if (weight > 0.02) touched++;
      p[i] *= weight;
      p[i + 1] *= weight;
      p[i + 2] *= weight;
      p[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const encode = async (type) => {
      const blob = await canvas.convertToBlob(type === 'image/png' ? { type } : { type, quality: 0.9 });
      const u = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (let i = 0; i < u.length; i += 0x8000) text += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(text);
    };
    return { map: await encode('image/webp'), preview: preview ? await encode('image/png') : null, share: lit / (p.length / 4), touched };
  }, { data: Buffer.from(data).toString('base64'), mime: image.mimeType ?? 'image/png', preview: maskPath !== undefined });
  // A texture with no fire in it - the stones round a campfire - gets no map at all.
  if (out.touched === 0) {
    made.set(source, null);
    console.log(`${input}: image ${source} has no fire in it, and is left as it was`);
    continue;
  }
  if (out.preview !== null) writeFileSync(maskPath, Buffer.from(out.preview, 'base64'));
  made.set(source, { map: Buffer.from(out.map, 'base64'), share: out.share, sampler: colourTexture.sampler, name: image.name ?? 'colour' });
}
await browser.close();

// Appended after everything the file had, four-byte aligned.
const align = (buffer) => (buffer.length % 4 === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4))]));
let body = bin;
json.images ??= [];
json.textures ??= [];
const textureOf = new Map();
for (const [source, glow] of made) {
  if (glow === null) continue;
  const { map, sampler, name } = glow;
  body = align(body);
  const view = json.bufferViews.push({ buffer: 0, byteOffset: body.length, byteLength: map.length }) - 1;
  body = Buffer.concat([body, map]);
  const image = json.images.push({ name: `${name}-flame-glow`, mimeType: 'image/webp', bufferView: view }) - 1;
  textureOf.set(source, json.textures.push({ ...(sampler === undefined ? {} : { sampler }), extensions: { EXT_texture_webp: { source: image } } }) - 1);
}
let glowing = 0;
for (const material of materials) {
  const colour = material.pbrMetallicRoughness.baseColorTexture;
  if (!textureOf.has(sourceOf(json.textures[colour.index]))) continue;
  glowing++;
  material.emissiveTexture = { index: textureOf.get(sourceOf(json.textures[colour.index])), ...(colour.texCoord === undefined ? {} : { texCoord: colour.texCoord }) };
  material.emissiveFactor = [1, 1, 1];
  material.extensions = { ...(material.extensions ?? {}), KHR_materials_emissive_strength: { emissiveStrength: strength } };
}
if (glowing === 0) throw new Error(`${input}: nothing in it is fire-coloured, so nothing was made to glow`);
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_emissive_strength', 'EXT_texture_webp'])];
body = align(body);
json.buffers[0].byteLength = body.length;
let text = Buffer.from(JSON.stringify(json), 'utf8');
if (text.length % 4 !== 0) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(GLB_MAGIC, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
const chunk = (type, content) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(content.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, content]);
};
writeFileSync(output, Buffer.concat([header, chunk(JSON_CHUNK, text), chunk(BIN_CHUNK, body)]));
for (const glow of made.values()) {
  if (glow === null) continue;
  const { map, share } = glow;
  console.log(`${output}: flames glow at ${strength}; ${(share * 100).toFixed(1)}% of the texture is fire; ${(map.length / 1e3).toFixed(0)} kB added`);
}
