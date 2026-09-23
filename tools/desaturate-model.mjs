/**
 * Take colour out of a .glb's textures, and nothing else.
 *
 *   node tools/desaturate-model.mjs <in.glb> <out.glb> <saturation>
 *
 * `saturation` is how much colour is kept: 1 leaves it as it is, 0 is grey, 0.6 keeps sixty per
 * cent. Only the base-colour textures are touched - a normal map or a roughness map is data, not
 * colour, and greying one would bend the light on the surface - and everything else in the file is
 * carried across byte for byte: the meshes, the materials, the other maps, the node sizes.
 *
 * The images are decoded and encoded by a headless Chromium (Playwright is a dev dependency
 * already), which reads every format a .glb carries without another image library in the repo. A
 * JPEG is written back as a JPEG at high quality, a PNG as a PNG.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [input, output, amount] = process.argv.slice(2);
const saturation = Number(amount);
if (input === undefined || output === undefined || !Number.isFinite(saturation) || saturation < 0 || saturation > 1) {
  console.error('usage: node tools/desaturate-model.mjs <in.glb> <out.glb> <saturation 0..1>');
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

const { json, bin } = readGlb(readFileSync(input));

// The images a material reads its colour from, and only those.
const colour = new Set();
for (const material of json.materials ?? []) {
  const texture = material.pbrMetallicRoughness?.baseColorTexture;
  if (texture !== undefined) colour.add(json.textures[texture.index].source);
  const diffuse = material.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture;
  if (diffuse !== undefined) colour.add(json.textures[diffuse.index].source);
}
const targets = [...colour].filter((index) => json.images[index]?.bufferView !== undefined);
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
  const out = await page.evaluate(async ({ data, mime, keep }) => {
    const source = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([source], { type: mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const p = pixels.data;
    for (let i = 0; i < p.length; i += 4) {
      // Towards the grey of the same brightness, so nothing gets lighter or darker, only less coloured.
      const grey = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      p[i] = grey + (p[i] - grey) * keep;
      p[i + 1] = grey + (p[i + 1] - grey) * keep;
      p[i + 2] = grey + (p[i + 2] - grey) * keep;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await canvas.convertToBlob(mime === 'image/png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 });
    const encoded = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < encoded.length; i += 0x8000) text += String.fromCharCode(...encoded.subarray(i, i + 0x8000));
    return { data: btoa(text), width: bitmap.width, height: bitmap.height, type: blob.type };
  }, { data: Buffer.from(bytes).toString('base64'), mime: image.mimeType ?? 'image/jpeg', keep: saturation });
  replaced.set(image.bufferView, Buffer.from(out.data, 'base64'));
  image.mimeType = out.type;
  console.log(`${input}: image ${index} (${out.width}x${out.height}) ${(view.byteLength / 1e6).toFixed(1)} MB -> ${(replaced.get(image.bufferView).length / 1e6).toFixed(1)} MB`);
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
console.log(`${output}: saturation ${saturation}`);
