/**
 * Procedural models, described as data instead of built by code.
 *
 * The legacy `models.js` was 31 imperative builders: each one `new`-ed its own
 * geometries and materials, so a `knight` came out as 15 meshes with 15 distinct
 * material objects and nothing shared with the next knight. That is the single
 * biggest thing the port had to change (docs/research/legacy-models.md §10.3).
 *
 * The DSL still reads the same — a part is a primitive, a material, a position
 * and a rotation — but it is now a plain object. That buys several things at once:
 * the editor can list and preview a model without executing it, a project can
 * re-skin one by swapping its palette, the whole spec is hashable so a model can
 * be diffed and pinned in a test, and geometry and material sharing becomes a
 * lookup rather than a discipline.
 *
 * No three import: these are descriptions. `build.ts` turns them into meshes.
 */

/** Primitive shapes, matching the three.js geometries the legacy library used. */
export type PrimSpec =
  | { kind: 'box'; w: number; h: number; d: number }
  | { kind: 'cylinder'; rTop: number; rBottom: number; h: number; seg: number; open?: boolean }
  | { kind: 'cone'; r: number; h: number; seg: number }
  | { kind: 'sphere'; r: number; wSeg: number; hSeg: number }
  | { kind: 'icosahedron'; r: number; detail?: number }
  | { kind: 'octahedron'; r: number; detail?: number }
  | { kind: 'tetrahedron'; r: number; detail?: number }
  | { kind: 'torus'; r: number; tube: number; radSeg: number; tubSeg: number; arc?: number };

export interface MatSpec {
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
  /** three defaults: metalness 0, roughness 1. */
  metalness?: number;
  roughness?: number;
  opacity?: number;
  /** Unlit `MeshBasicMaterial` — the legacy beam and barrier shells. */
  unlit?: boolean;
  doubleSide?: boolean;
  depthWrite?: boolean;
}

export type Vec3 = readonly [number, number, number];

export interface PartSpec {
  prim: PrimSpec;
  /** Key into the model's palette. */
  mat: string;
  pos?: Vec3;
  /** Euler rotation in radians. */
  rot?: Vec3;
  scale?: number | Vec3;
  /**
   * Names this part so runtime code can find it — the legacy `eye0`, `eye1`,
   * `lens` and `beam`. Named parts are the only ones anything looks up.
   */
  name?: string;
  /** Starts hidden, like the spotlight beam before its pillar is lit. */
  hidden?: boolean;
  /** Defaults to true, except for unlit fx parts. */
  castShadow?: boolean;
}

/** An empty anchor: where a weapon, a light or a health bar hangs. */
export interface HookSpec {
  pos: Vec3;
  rot?: Vec3;
}

export type ModelCategory = 'hero' | 'monster' | 'prop' | 'node' | 'fx';

export interface ProceduralModelSpec {
  /** Stable content id — 'knight', 'pine'. */
  id: string;
  category: ModelCategory;
  /** Named materials. A project re-skins a model by replacing entries here. */
  palette: Readonly<Record<string, MatSpec>>;
  parts: readonly PartSpec[];
  hooks?: Readonly<Record<string, HookSpec>>;
  /**
   * Height of the top of the model, for hanging a label or a health bar.
   * Measured, not guessed — `model-metrics.test.ts` checks these against the
   * geometry actually built.
   */
  standHeight: number;
  /**
   * Deliberate offset from the ground: `rock` sinks, `archfey` floats. Anything
   * else should sit at 0.
   */
  groundOffset?: number;
  /** Idle animation the presentation layer may apply. */
  motion?: { idle: 'none' | 'hover'; amp?: number; hz?: number };
  /** Inspector text — the legacy DECO_INFO. */
  info?: { name: string; desc: string };
  tags?: readonly string[];
}

// ---------------------------------------------------------------------------
// Shared fragments: the legacy file's private helpers, as spec builders.
// ---------------------------------------------------------------------------

/** Material palette entries every token base needs. */
export const BASE_PALETTE: Readonly<Record<string, MatSpec>> = {
  base: { color: '#2b2e3c' },
};

/**
 * The round miniature base under every hero and most monsters.
 *
 * Legacy: a `CylinderGeometry(0.34, 0.38, 0.08, 18)` plinth and a flat torus ring in the
 * token's colour, glowing faintly. The ring is gone - which side a creature is on is drawn
 * round it now (`render/faction-outline.ts`) rather than lain under it, at the user's word:
 * a coloured disc on the ground reads as a thing in the room instead of a mark on one, and
 * a low camera loses it entirely.
 *
 * The plinth stays. It is the dark `#2b2e3c` the miniature stands on rather than anything
 * the faction coloured, and it is what puts every model's underside at y=0 - `build.test.ts`
 * measures that, and without it a husk would float a quarter tile off the floor.
 *
 * `ringMat` is kept and ignored, so the nine specs that pass a colour in still parse. It
 * goes when they are next touched.
 */
export function tokenBase(_ringMat = 'ring'): PartSpec[] {
  return [
    {
      prim: { kind: 'cylinder', rTop: 0.34, rBottom: 0.38, h: 0.08, seg: 18 },
      mat: 'base',
      pos: [0, 0.04, 0],
    },
  ];
}

/** A ring material at a given colour, glowing the way the legacy ones did. */
export function ringMaterial(color: string): MatSpec {
  return { color, emissive: color, emissiveIntensity: 0.35 };
}

/**
 * A head with two eyes, at `y`.
 *
 * The eyes sit on +z, which is why every model faces +z — the legacy grid
 * computed yaw as `atan2(dx, dz)` to match.
 */
export function head(skinMat: string, radius: number, y: number): PartSpec[] {
  return [
    { prim: { kind: 'icosahedron', r: radius }, mat: skinMat, pos: [0, y, 0] },
    {
      prim: { kind: 'sphere', r: 0.028, wSeg: 6, hSeg: 6 },
      mat: 'eye',
      pos: [-0.05, y + 0.01, radius * 0.85],
      name: 'eye0',
    },
    {
      prim: { kind: 'sphere', r: 0.028, wSeg: 6, hSeg: 6 },
      mat: 'eye',
      pos: [0.05, y + 0.01, radius * 0.85],
      name: 'eye1',
    },
  ];
}

/** Palette entries a head needs. */
export const EYE_PALETTE: Readonly<Record<string, MatSpec>> = {
  eye: { color: '#1a1a22' },
};

/**
 * A staff held on the model's right (+x). `tip` is placed just above the shaft.
 */
export function staff(
  length: number,
  at: Vec3,
  woodMat = 'wood',
  tip?: Omit<PartSpec, 'pos'>,
): PartSpec[] {
  const [x, y, z] = at;
  const parts: PartSpec[] = [
    {
      prim: { kind: 'cylinder', rTop: 0.025, rBottom: 0.03, h: length, seg: 5 },
      mat: woodMat,
      pos: [x, y + length / 2, z],
    },
  ];
  if (tip !== undefined) parts.push({ ...tip, pos: [x, y + length + 0.05, z] });
  return parts;
}

export const WOOD_PALETTE: Readonly<Record<string, MatSpec>> = {
  wood: { color: '#6b5236' },
};

/**
 * A canonical string for a primitive, for cache keys. Stable across property
 * order, so two identically shaped primitives always share one geometry.
 */
export function primKey(prim: PrimSpec): string {
  switch (prim.kind) {
    case 'box':
      return `box:${prim.w},${prim.h},${prim.d}`;
    case 'cylinder':
      return `cyl:${prim.rTop},${prim.rBottom},${prim.h},${prim.seg},${prim.open === true ? 1 : 0}`;
    case 'cone':
      return `cone:${prim.r},${prim.h},${prim.seg}`;
    case 'sphere':
      return `sph:${prim.r},${prim.wSeg},${prim.hSeg}`;
    case 'torus':
      return `tor:${prim.r},${prim.tube},${prim.radSeg},${prim.tubSeg},${prim.arc ?? Math.PI * 2}`;
    default:
      return `${prim.kind}:${prim.r},${prim.detail ?? 0}`;
  }
}

/** A canonical string for a material, for cache keys. */
export function matKey(mat: MatSpec): string {
  return [
    mat.color,
    mat.emissive ?? '',
    mat.emissiveIntensity ?? 1,
    mat.metalness ?? 0,
    mat.roughness ?? 1,
    mat.opacity ?? 1,
    mat.unlit === true ? 1 : 0,
    mat.doubleSide === true ? 1 : 0,
    mat.depthWrite === false ? 0 : 1,
  ].join('|');
}
