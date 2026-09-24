/**
 * Give a portal model a living glow, inside the .glb.
 *
 *   node tools/add-portal-glow.mjs <in.glb> <out.glb> <centreX> <centreY> <radiusX> <radiusY> [<depth>]
 *
 * The numbers are the portal's opening in its first node's own frame, before that node's scale -
 * the sheet the swirl is painted on, facing along z. Over each face of it (at `depth`, 0.012 unless
 * said, in front of each) goes a disc of light: a spiral vortex, white at the core through blue to
 * violet, fading to nothing at its rim so the edge of the opening is the arch's and not a disc's.
 *
 * It glows: emissive, and pushed past 1 with KHR_materials_emissive_strength, so it is bright in a
 * dark room and lights nothing but itself. It moves: one clip, `portal-glow`, eight seconds long
 * and looping - the vortex turning a full circle, a fainter layer over it turning the other way at
 * a different speed, and the whole of it breathing, a few per cent larger and smaller every two
 * seconds. Each disc spins inside a frame that holds it to the opening's oval, so what turns is the
 * light and not the shape of the hole.
 *
 * A standard glTF animation - node rotation and scale - which any loader plays and which the engine
 * already loops on every model that has a clip (`SceneView.instantiate`). Animating the material
 * itself would need KHR_animation_pointer, which three reads only through a plugin. Everything the
 * file had is kept byte for byte; the glow's geometry, texture and animation are added after it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [input, output, ...numbers] = process.argv.slice(2);
const [cx, cy, rx, ry, depth = 0.012] = numbers.map(Number);
if (input === undefined || output === undefined || ![cx, cy, rx, ry, depth].every(Number.isFinite) || rx <= 0 || ry <= 0) {
  console.error('usage: node tools/add-portal-glow.mjs <in.glb> <out.glb> <centreX> <centreY> <radiusX> <radiusY> [<depth>]');
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
if ((json.animations ?? []).some((clip) => clip.name === 'portal-glow')) throw new Error(`${input} already glows`);

// The glow's texture: a vortex, drawn once.
const browser = await chromium.launch();
const page = await browser.newPage();
const png = Buffer.from(await page.evaluate(async () => {
  const size = 512;
  const canvas = new OffscreenCanvas(size, size);
  const c = canvas.getContext('2d');
  const image = c.createImageData(size, size);
  const p = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(dx, dy);
      const i = (y * size + x) * 4;
      if (r >= 1) { p[i + 3] = 0; continue; }
      const angle = Math.atan2(dy, dx);
      // Four arms wound into the middle: brightest along each arm, darker between.
      const arm = 0.5 + 0.5 * Math.cos(4 * angle + 9 * Math.log(r + 0.08));
      const core = Math.exp(-r * r * 9);
      const glow = Math.min(1, 0.25 + 0.55 * arm * (1 - r * 0.6) + 0.9 * core);
      // White at the heart, cyan and blue through the arms, violet out at the rim.
      const tone = Math.min(1, r * 1.25);
      const red = (1 - tone) * 0.85 + tone * 0.45;
      const green = (1 - tone) * 0.95 + tone * 0.25;
      const blue = 1;
      // Faded to nothing at the rim, so the arch is the edge and not the disc.
      const fade = Math.min(1, (1 - r) / 0.28);
      p[i] = 255 * Math.min(1, red * glow + core * 0.3);
      p[i + 1] = 255 * Math.min(1, green * glow + core * 0.3);
      p[i + 2] = 255 * Math.min(1, blue * glow);
      p[i + 3] = 255 * Math.min(1, fade * (0.35 + 0.65 * glow));
    }
  }
  c.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return [...new Uint8Array(await blob.arrayBuffer())];
}));
await browser.close();

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
  const view = append(floats(values), extra.target);
  const { target: _t, ...rest } = extra;
  return json.accessors.push({ bufferView: view, componentType: 5126, count: values.length / { SCALAR: 1, VEC3: 3, VEC4: 4, VEC2: 2 }[type], type, ...rest }) - 1;
}

// A unit disc facing +z, as a fan: its rim is the opening, once its frame has scaled it.
const SEGMENTS = 64;
const position = [0, 0, 0];
const normal = [0, 0, 1];
const uv = [0.5, 0.5];
for (let k = 0; k <= SEGMENTS; k++) {
  const a = (k / SEGMENTS) * Math.PI * 2;
  position.push(Math.cos(a), Math.sin(a), 0);
  normal.push(0, 0, 1);
  uv.push(0.5 + 0.5 * Math.cos(a), 0.5 - 0.5 * Math.sin(a));
}
const indices = [];
for (let k = 1; k <= SEGMENTS; k++) indices.push(0, k, k + 1);
const positionAccessor = accessor(position, 'VEC3', { target: 34962, min: [-1, -1, 0], max: [1, 1, 0] });
const normalAccessor = accessor(normal, 'VEC3', { target: 34962 });
const uvAccessor = accessor(uv, 'VEC2', { target: 34962 });
const indexView = append(Buffer.from(new Uint16Array(indices).buffer), 34963);
const indexAccessor = json.accessors.push({ bufferView: indexView, componentType: 5123, count: indices.length, type: 'SCALAR' }) - 1;

// The texture, and two materials of it: the vortex, and a fainter layer to turn against it.
json.images ??= [];
json.textures ??= [];
json.samplers ??= [];
const imageView = append(png);
const image = json.images.push({ name: 'portal-glow', mimeType: 'image/png', bufferView: imageView }) - 1;
const sampler = json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }) - 1;
const texture = json.textures.push({ source: image, sampler }) - 1;
const glowMaterial = (name, alpha, strength) => json.materials.push({
  name,
  alphaMode: 'BLEND',
  pbrMetallicRoughness: { baseColorTexture: { index: texture }, baseColorFactor: [0, 0, 0, alpha], metallicFactor: 0, roughnessFactor: 1 },
  emissiveTexture: { index: texture },
  emissiveFactor: [1, 1, 1],
  extensions: { KHR_materials_emissive_strength: { emissiveStrength: strength } },
}) - 1;
const vortex = glowMaterial('portal-glow', 0.95, 2.4);
const veil = glowMaterial('portal-glow-veil', 0.45, 1.6);
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_emissive_strength'])];
const primitive = (material) => ({ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor, TEXCOORD_0: uvAccessor }, indices: indexAccessor, material });
const vortexMesh = json.meshes.push({ name: 'portal-glow', primitives: [primitive(vortex)] }) - 1;
const veilMesh = json.meshes.push({ name: 'portal-glow-veil', primitives: [primitive(veil)] }) - 1;

// Under the model's own node, so its scale is theirs: a frame per face holding the oval, and in
// each frame the two spinning layers.
const host = json.scenes[json.scene ?? 0].nodes[0];
const hostNode = json.nodes[host];
const TURN_Y = [0, 1, 0, 0]; // half a turn about y: the back face looks the other way
const frames = [];
const spins = [];
for (const [side, z] of [['front', depth], ['back', -depth]]) {
  const vortexNode = json.nodes.push({ name: `portal-glow-${side}`, mesh: vortexMesh }) - 1;
  // The veil a hair nearer, so the two never fight over the same depth.
  const veilNode = json.nodes.push({ name: `portal-glow-veil-${side}`, mesh: veilMesh, translation: [0, 0, 0.002], scale: [0.92, 0.92, 1] }) - 1;
  const frame = json.nodes.push({
    name: `portal-glow-frame-${side}`,
    translation: [cx, cy, z],
    scale: [rx, ry, 1],
    ...(side === 'back' ? { rotation: TURN_Y } : {}),
    children: [vortexNode, veilNode],
  }) - 1;
  frames.push(frame);
  spins.push({ node: vortexNode, turns: 1 }, { node: veilNode, turns: -2 });
}
hostNode.children = [...(hostNode.children ?? []), ...frames];

// The clip: eight seconds, looping.
const SECONDS = 8;
const KEYS = 33;
const times = Array.from({ length: KEYS }, (_, k) => (k / (KEYS - 1)) * SECONDS);
const timeAccessor = accessor(times, 'SCALAR', { min: [0], max: [SECONDS] });
const channels = [];
const samplers = [];
const channel = (node, path, values, type) => {
  const sampler = samplers.push({ input: timeAccessor, output: accessor(values, type), interpolation: 'LINEAR' }) - 1;
  channels.push({ sampler, target: { node, path } });
};
for (const { node, turns } of spins) {
  // About the disc's own z, which is the way the face looks: a quarter-turn or less between keys.
  const quaternions = times.flatMap((t) => {
    const angle = (t / SECONDS) * Math.PI * 2 * turns;
    return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
  });
  channel(node, 'rotation', quaternions, 'VEC4');
}
for (const frame of frames) {
  // Breathing: four slow swells in the eight seconds, a few per cent either way.
  const scales = times.flatMap((t) => {
    const swell = 1 + 0.045 * Math.sin((t / 2) * Math.PI * 2);
    return [rx * swell, ry * swell, 1];
  });
  channel(frame, 'scale', scales, 'VEC3');
}
json.animations = [...(json.animations ?? []), { name: 'portal-glow', channels, samplers }];

// Written back: the old binary untouched at the front, the glow after it.
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
console.log(`${output}: a glow over (${cx}, ${cy}), ${rx} by ${ry}, front and back; clip portal-glow, ${SECONDS} s; ${(tail.length / 1e3).toFixed(0)} kB added`);
