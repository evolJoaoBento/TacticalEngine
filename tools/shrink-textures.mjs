/**
 * Make a .glb light by its textures alone.
 *
 *   node tools/shrink-textures.mjs <in.glb> <out.glb> [<colour px> <other px>]
 *
 * The models here are small in triangles - three to six thousand for a prop - and heavy in their
 * maps: 2048-pixel PNGs, or JPEGs at the highest quality, three to a file. So the maps are what is
 * made light, to the sizes `lighten-model.py` settled on: colour at 2048 across and everything else -
 * normal, roughness and metal - at 1024, each as WebP (EXT_texture_webp, which three reads). A map
 * already that small or smaller keeps its size; nothing is ever made larger.
 *
 * Everything that is not an image is carried across byte for byte: the meshes, a rig, the clips a
 * file plays, the portal's glow. That is what this has over the Blender pipeline for a file that
 * has already been through it, or that carries more than one mesh: nothing is re-exported, so
 * nothing can be lost on the way. The images are decoded, scaled and encoded by a headless Chromium.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [input, output, colourArg = '2048', otherArg = '1024'] = process.argv.slice(2);
const COLOUR = Number(colourArg);
const OTHER = Number(otherArg);
if (input === undefined || output === undefined || !(COLOUR > 0) || !(OTHER > 0)) {
  console.error('usage: node tools/shrink-textures.mjs <in.glb> <out.glb> [<colour px> <other px>]');
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
  else if (type === BIN_CHUNK) bin = body;
  at += 8 + length;
}
if (json === null || bin === null) throw new Error(`${input} has no JSON or no binary chunk`);

const sourceOf = (texture) => texture?.source ?? texture?.extensions?.EXT_texture_webp?.source ?? texture?.extensions?.EXT_texture_avif?.source;

// Which images are colour: what a material reads its colour or its glow from. The rest are data.
const colour = new Set();
for (const material of json.materials ?? []) {
  for (const ref of [material.pbrMetallicRoughness?.baseColorTexture, material.emissiveTexture, material.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture]) {
    if (ref !== undefined) colour.add(sourceOf(json.textures[ref.index]));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const replaced = new Map();
let before = 0;
let after = 0;
for (const [index, image] of (json.images ?? []).entries()) {
  if (image.bufferView === undefined) continue;
  const view = json.bufferViews[image.bufferView];
  const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const most = colour.has(index) ? COLOUR : OTHER;
  const out = await page.evaluate(async ({ data, mime, most }) => {
    const source = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    // Decoded as it is stored: no colour management and no premultiplying, since half of these are data.
    const bitmap = await createImageBitmap(new Blob([source], { type: mime }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const scale = Math.min(1, most / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
    const encoded = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < encoded.length; i += 0x8000) text += String.fromCharCode(...encoded.subarray(i, i + 0x8000));
    return { data: btoa(text), width, height, was: [bitmap.width, bitmap.height], type: blob.type };
  }, { data: Buffer.from(data).toString('base64'), mime: image.mimeType ?? 'image/png', most });
  if (out.type !== 'image/webp') throw new Error(`${input}: this browser would not write WebP`);
  const webp = Buffer.from(out.data, 'base64');
  before += data.length;
  // Only if it is lighter: a small map already well packed stays as it was.
  if (webp.length >= data.length) {
    after += data.length;
    console.log(`${input}: image ${index} kept (${out.was.join('x')} ${image.mimeType}, already ${(data.length / 1e6).toFixed(2)} MB)`);
    continue;
  }
  after += webp.length;
  replaced.set(image.bufferView, webp);
  image.mimeType = 'image/webp';
  console.log(`${input}: image ${index} ${colour.has(index) ? 'colour' : 'data'} ${out.was.join('x')} -> ${out.width}x${out.height} webp, ${(data.length / 1e6).toFixed(2)} -> ${(webp.length / 1e6).toFixed(2)} MB`);
}
await browser.close();

// A texture drawing a WebP names it through the extension, as the extension asks.
const webpImages = new Set([...replaced.keys()].map((viewIndex) => json.images.findIndex((image) => image.bufferView === viewIndex)));
for (const texture of json.textures ?? []) {
  if (texture.source !== undefined && webpImages.has(texture.source)) {
    texture.extensions = { ...(texture.extensions ?? {}), EXT_texture_webp: { source: texture.source } };
    delete texture.source;
  }
}
if (webpImages.size > 0) {
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_texture_webp'])];
}

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
let body = Buffer.concat(parts);
if (body.length % 4 !== 0) body = Buffer.concat([body, Buffer.alloc(4 - (body.length % 4))]);
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
console.log(`${output}: images ${(before / 1e6).toFixed(1)} -> ${(after / 1e6).toFixed(1)} MB; file ${(bytes.length / 1e6).toFixed(1)} -> ${((12 + 16 + text.length + body.length) / 1e6).toFixed(1)} MB`);
