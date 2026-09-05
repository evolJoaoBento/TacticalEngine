/**
 * Minimal PDF text extractor with per-font ToUnicode mapping.
 *
 * The SRD PDF stores its objects in compressed object streams and uses subset
 * fonts whose codes differ per font, so a single global mapping produces text
 * with the digits missing. This resolves each page's font resources and decodes
 * every string with the font that was actually selected.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';

const file = fs.readFileSync(process.argv[2]);
const bytes = file.toString('latin1');

/** objNum -> { dict, streamData } for top-level "N 0 obj ... endobj" definitions. */
const objects = new Map();

const objRe = /(\d+)\s+0\s+obj\b/g;
let m;
while ((m = objRe.exec(bytes)) !== null) {
  const num = Number(m[1]);
  const start = m.index + m[0].length;
  const endObj = bytes.indexOf('endobj', start);
  if (endObj < 0) continue;
  const body = bytes.slice(start, endObj);
  const streamAt = body.indexOf('stream');
  let dict = body;
  let streamData = null;
  if (streamAt >= 0) {
    dict = body.slice(0, streamAt);
    let s = start + streamAt + 6;
    if (file[s] === 0x0d) s++;
    if (file[s] === 0x0a) s++;
    const endStream = bytes.indexOf('endstream', s);
    if (endStream > 0) {
      const raw = file.subarray(s, endStream);
      if (/\/FlateDecode/.test(dict)) {
        try {
          streamData = zlib.inflateSync(raw);
        } catch {
          streamData = null;
        }
      } else {
        streamData = raw;
      }
    }
  }
  objects.set(num, { dict, streamData });
}

/** Objects living inside compressed object streams. */
const inStream = new Map();
for (const [, obj] of objects) {
  if (!/\/Type\s*\/ObjStm/.test(obj.dict) || obj.streamData === null) continue;
  const n = Number(/\/N\s+(\d+)/.exec(obj.dict)?.[1] ?? 0);
  const first = Number(/\/First\s+(\d+)/.exec(obj.dict)?.[1] ?? 0);
  const text = obj.streamData.toString('latin1');
  const header = text.slice(0, first).trim().split(/\s+/).map(Number);
  for (let i = 0; i < n; i++) {
    const num = header[i * 2];
    const off = header[i * 2 + 1];
    const nextOff = i + 1 < n ? header[(i + 1) * 2 + 1] : text.length - first;
    if (num === undefined || off === undefined) continue;
    inStream.set(num, text.slice(first + off, first + nextOff));
  }
}

const dictOf = (num) => inStream.get(num) ?? objects.get(num)?.dict ?? '';
const streamOf = (num) => objects.get(num)?.streamData ?? null;

/** Parse a ToUnicode CMap into { bytesPerCode, map }. */
function parseCMap(text) {
  const map = new Map();
  // The codespace range in these files is boilerplate (<0000> <FFFF>) while the
  // real codes are single bytes, so the width comes from the entries themselves.
  let codeHexDigits = 2;
  const toStr = (hex) => {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  };
  for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const p of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      codeHexDigits = Math.max(codeHexDigits, p[1].length);
      map.set(parseInt(p[1], 16), toStr(p[2]));
    }
  }
  for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const p of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      codeHexDigits = Math.max(codeHexDigits, p[1].length);
      const lo = parseInt(p[1], 16);
      const hi = parseInt(p[2], 16);
      const base = parseInt(p[3], 16);
      for (let c = lo; c <= hi && c - lo < 1024; c++) map.set(c, String.fromCharCode(base + (c - lo)));
    }
  }
  return { bytesPerCode: Math.max(1, Math.ceil(codeHexDigits / 2)), map };
}

const cmapCache = new Map();
function cmapForFont(fontNum) {
  if (cmapCache.has(fontNum)) return cmapCache.get(fontNum);
  const dict = dictOf(fontNum);
  const ref = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(dict);
  let result = null;
  if (ref !== null) {
    const data = streamOf(Number(ref[1]));
    if (data !== null) result = parseCMap(data.toString('latin1'));
  }
  cmapCache.set(fontNum, result);
  return result;
}

/** Pages, in document order where the object numbers allow it. */
const pages = [];
for (const num of new Set([...objects.keys(), ...inStream.keys()])) {
  const dict = dictOf(num);
  if (!/\/Type\s*\/Page\b/.test(dict)) continue;
  pages.push({ num, dict });
}
pages.sort((a, b) => a.num - b.num);

function fontsFor(dict) {
  const fonts = new Map();
  const resRef = /\/Resources\s+(\d+)\s+0\s+R/.exec(dict);
  const resText = resRef !== null ? dictOf(Number(resRef[1])) : dict;
  const fontIdx = resText.indexOf('/Font');
  if (fontIdx < 0) return fonts;
  const tail = resText.slice(fontIdx);
  const inline = /\/Font\s*<<([\s\S]*?)>>/.exec(tail);
  const indirect = /\/Font\s+(\d+)\s+0\s+R/.exec(tail);
  const body = inline !== null ? inline[1] : indirect !== null ? dictOf(Number(indirect[1])) : '';
  for (const p of body.matchAll(/\/([A-Za-z0-9_+.-]+)\s+(\d+)\s+0\s+R/g)) {
    fonts.set(p[1], Number(p[2]));
  }
  return fonts;
}

function contentFor(dict) {
  const single = /\/Contents\s+(\d+)\s+0\s+R/.exec(dict);
  if (single !== null) return streamOf(Number(single[1]));
  const arr = /\/Contents\s*\[([^\]]*)\]/.exec(dict);
  if (arr === null) return null;
  const parts = [];
  for (const p of arr[1].matchAll(/(\d+)\s+0\s+R/g)) {
    const data = streamOf(Number(p[1]));
    if (data !== null) parts.push(data);
  }
  return parts.length > 0 ? Buffer.concat(parts) : null;
}

const decodeString = (literal, cmap) => {
  // Undo PDF string escapes into raw bytes first.
  const raw = [];
  for (let i = 0; i < literal.length; i++) {
    const c = literal[i];
    if (c !== '\\') {
      raw.push(literal.charCodeAt(i));
      continue;
    }
    const next = literal[++i];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let oct = next;
      while (oct.length < 3 && literal[i + 1] >= '0' && literal[i + 1] <= '7') oct += literal[++i];
      raw.push(parseInt(oct, 8));
      continue;
    }
    const named = { n: 10, r: 13, t: 9, b: 8, f: 12 }[next];
    raw.push(named ?? literal.charCodeAt(i));
  }
  if (cmap === null || cmap === undefined) return raw.map((b) => String.fromCharCode(b)).join('');
  let out = '';
  const step = cmap.bytesPerCode;
  for (let i = 0; i + step <= raw.length; i += step) {
    let code = 0;
    for (let k = 0; k < step; k++) code = (code << 8) | raw[i + k];
    out += cmap.map.get(code) ?? '';
  }
  return out;
};

const outPages = [];
for (const page of pages) {
  const content = contentFor(page.dict);
  if (content === null) continue;
  const fonts = fontsFor(page.dict);
  const text = content.toString('latin1');
  let cmap = null;
  const pieces = [];

  const re = /\/([A-Za-z0-9_+.-]+)\s+[\d.]+\s+Tf|\((?:[^()\\]|\\.)*\)\s*Tj|\[(?:[^\][\\]|\\.)*\]\s*TJ|T\*|ET/g;
  let tok;
  while ((tok = re.exec(text)) !== null) {
    const s = tok[0];
    if (s.endsWith('Tf')) {
      const fontNum = fonts.get(tok[1]);
      cmap = fontNum === undefined ? null : cmapForFont(fontNum);
      continue;
    }
    if (s === 'T*' || s === 'ET') {
      pieces.push('\n');
      continue;
    }
    if (s.endsWith('TJ')) {
      const inner = s.slice(s.indexOf('[') + 1, s.lastIndexOf(']'));
      for (const lit of inner.match(/\((?:[^()\\]|\\.)*\)/g) ?? []) {
        pieces.push(decodeString(lit.slice(1, -1), cmap));
      }
      continue;
    }
    pieces.push(decodeString(s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), cmap));
  }
  outPages.push(pieces.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'));
}

const doc = outPages.map((t, i) => `\n\n===== PAGE ${i + 1} =====\n${t}`).join('');
fs.writeFileSync(process.argv[3], doc);
console.log(
  'objects', objects.size,
  '| in objstm', inStream.size,
  '| pages', pages.length,
  '| fonts mapped', [...cmapCache.values()].filter(Boolean).length,
  '| chars', doc.length,
  '| digits', (doc.match(/[0-9]/g) ?? []).length,
);
