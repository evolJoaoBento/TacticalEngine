/**
 * Carve a glowing rune into the top of a model, inside the .glb.
 *
 *   node tools/add-top-rune.mjs <in.glb> <out.glb> [<glyph>] [<share>] [--preview <rune.png>]
 *
 * The top is found from the model's own vertices: every vertex within a few millimetres of the
 * highest, whose extent is the face the rune is cut into. Over it, a hair above the highest point so
 * nothing on the face can cover it, goes a square decal `share` of the face across (0.6 unless
 * said) with the glyph on it (π unless said): a dark groove round the stroke, so it reads as cut
 * into the stone rather than painted on, and inside the groove the glyph itself, pale blue and
 * glowing - emissive, pushed past 1 with KHR_materials_emissive_strength so it shows in a dark room,
 * with a soft halo of the same light on the stone about it. It lights nothing but itself.
 *
 * Under the model's first node, so its scale and pivot are the model's. Everything the file had is
 * kept byte for byte; the decal's geometry, its two textures and its material are added after it.
 * `--preview` writes the colour texture as a PNG, to look at.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const previewAt = args.indexOf('--preview');
const previewPath = previewAt >= 0 ? args[previewAt + 1] : undefined;
if (previewAt >= 0) args.splice(previewAt, 2);
const [input, output, glyph = 'π', shareArg = '0.6'] = args;
const share = Number(shareArg);
if (input === undefined || output === undefined || !(share > 0 && share <= 1)) {
  console.error('usage: node tools/add-top-rune.mjs <in.glb> <out.glb> [<glyph>] [<share 0..1>] [--preview <rune.png>]');
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
if ((json.meshes ?? []).some((mesh) => mesh.name === 'top-rune')) throw new Error(`${input} already has a rune`);

// The top face, from the first node's mesh: the vertices within a few millimetres of the highest.
const host = json.scenes[json.scene ?? 0].nodes[0];
const hostNode = json.nodes[host];
if (hostNode.mesh === undefined) throw new Error(`${input}: its first node carries no mesh to find a top on`);
const points = [];
for (const primitive of json.meshes[hostNode.mesh].primitives) {
  const accessor = json.accessors[primitive.attributes.POSITION];
  if (accessor.componentType !== 5126) throw new Error(`${input}: positions are not plain floats`);
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride ?? 12;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  for (let i = 0; i < accessor.count; i++) {
    const o = start + i * stride;
    points.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
  }
}
const top = Math.max(...points.map((p) => p[1]));
const face = points.filter((p) => p[1] > top - 0.006);
const minX = Math.min(...face.map((p) => p[0]));
const maxX = Math.max(...face.map((p) => p[0]));
const minZ = Math.min(...face.map((p) => p[2]));
const maxZ = Math.max(...face.map((p) => p[2]));
const cx = (minX + maxX) / 2;
const cz = (minZ + maxZ) / 2;
const half = (Math.min(maxX - minX, maxZ - minZ) * share) / 2;
const lift = 0.002;

// The two textures: what the decal looks like, and what of it glows.
const browser = await chromium.launch();
const page = await browser.newPage();
const [colour, glow] = await page.evaluate(async (glyph) => {
  const size = 512;
  const draw = (withGroove, alphaOnly) => {
    const canvas = new OffscreenCanvas(size, size);
    const c = canvas.getContext('2d');
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    // Sized and placed by the ink the glyph actually lays down, not its font box: a π is all
    // x-height, and centred by its box it sat low and small on the stone.
    let px = size;
    c.font = `bold ${px}px "Times New Roman", "DejaVu Serif", serif`;
    let ink = c.measureText(glyph);
    px *= (size * 0.72) / Math.max(ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight, ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent);
    c.font = `bold ${px}px "Times New Roman", "DejaVu Serif", serif`;
    ink = c.measureText(glyph);
    const x = size / 2 + (ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2;
    const y = size / 2 + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2;
    if (!alphaOnly) {
      c.fillStyle = '#000';
      c.fillRect(0, 0, size, size);
    }
    // The light the carving throws on the stone about it: soft, and only near the stroke.
    c.save();
    c.shadowColor = 'rgba(80, 170, 255, 0.9)';
    c.shadowBlur = size * 0.07;
    c.fillStyle = 'rgba(80, 170, 255, 0.55)';
    c.fillText(glyph, x, y);
    c.restore();
    if (withGroove) {
      // The groove: a dark lip round the stroke, the cut the light sits in.
      c.lineJoin = 'round';
      c.lineWidth = size * 0.045;
      c.strokeStyle = 'rgba(14, 16, 22, 0.92)';
      c.strokeText(glyph, x, y);
    }
    // The glyph itself: pale at the heart, blue at the edge.
    c.save();
    c.shadowColor = '#5fb4ff';
    c.shadowBlur = size * 0.02;
    c.fillStyle = '#8fcbff';
    c.fillText(glyph, x, y);
    c.restore();
    return canvas;
  };
  const encode = async (canvas) => {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const u = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < u.length; i += 0x8000) text += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(text);
  };
  return [await encode(draw(true, true)), await encode(draw(false, false))];
}, glyph);
await browser.close();
const colourPng = Buffer.from(colour, 'base64');
const glowPng = Buffer.from(glow, 'base64');
if (previewPath !== undefined) writeFileSync(previewPath, colourPng);

// Everything new goes after what the file had, each piece four-byte aligned.
const added = [];
let length = bin.length;
function append(buffer, target) {
  const pad = (4 - (length % 4)) % 4;
  if (pad > 0) {
    added.push(Buffer.alloc(pad));
    length += pad;
  }
  const view = json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: buffer.length, ...(target === undefined ? {} : { target }) }) - 1;
  added.push(buffer);
  length += buffer.length;
  return view;
}
const floats = (values) => Buffer.from(new Float32Array(values).buffer);
function accessor(values, type, extra = {}) {
  const { target, ...rest } = extra;
  const view = append(floats(values), target);
  return json.accessors.push({ bufferView: view, componentType: 5126, count: values.length / { VEC3: 3, VEC2: 2 }[type], type, ...rest }) - 1;
}

// A square facing up, the glyph's top towards -z.
const y = top + lift;
const position = [cx - half, y, cz - half, cx + half, y, cz - half, cx + half, y, cz + half, cx - half, y, cz + half];
const positionAccessor = accessor(position, 'VEC3', { target: 34962, min: [cx - half, y, cz - half], max: [cx + half, y, cz + half] });
const normalAccessor = accessor([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 'VEC3', { target: 34962 });
const uvAccessor = accessor([0, 0, 1, 0, 1, 1, 0, 1], 'VEC2', { target: 34962 });
const indexView = append(Buffer.from(new Uint16Array([0, 2, 1, 0, 3, 2]).buffer), 34963);
const indexAccessor = json.accessors.push({ bufferView: indexView, componentType: 5123, count: 6, type: 'SCALAR' }) - 1;

json.images ??= [];
json.textures ??= [];
json.samplers ??= [];
json.materials ??= [];
const sampler = json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }) - 1;
const texture = (png, name) => json.textures.push({ source: json.images.push({ name, mimeType: 'image/png', bufferView: append(png) }) - 1, sampler }) - 1;
const colourTexture = texture(colourPng, 'top-rune');
const glowTexture = texture(glowPng, 'top-rune-glow');
const material = json.materials.push({
  name: 'top-rune',
  alphaMode: 'BLEND',
  pbrMetallicRoughness: { baseColorTexture: { index: colourTexture }, metallicFactor: 0, roughnessFactor: 1 },
  emissiveTexture: { index: glowTexture },
  emissiveFactor: [1, 1, 1],
  extensions: { KHR_materials_emissive_strength: { emissiveStrength: 1.6 } },
}) - 1;
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_emissive_strength'])];
const mesh = json.meshes.push({
  name: 'top-rune',
  primitives: [{ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor, TEXCOORD_0: uvAccessor }, indices: indexAccessor, material }],
}) - 1;
const runeNode = json.nodes.push({ name: 'top-rune', mesh }) - 1;
hostNode.children = [...(hostNode.children ?? []), runeNode];

// Written back: the old binary untouched at the front, the rune after it.
const tail = Buffer.concat(added);
let body = Buffer.concat([bin, tail]);
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
console.log(`${output}: "${glyph}" carved ${(half * 2).toFixed(3)} across into the top at y ${top.toFixed(3)}, centred on (${cx.toFixed(3)}, ${cz.toFixed(3)}); ${(tail.length / 1e3).toFixed(0)} kB added`);
