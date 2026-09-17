/**
 * Turning a `ProceduralModelSpec` into meshes, with everything shared that can be.
 *
 * The legacy library allocated a geometry and a material per part per build: 31
 * models, 129 distinct primitive signatures, 142 distinct materials, and none of
 * it reused — a scene with 55 spectators built 55 copies of the same six shapes.
 * Here a `PrimitiveCache` and a `MaterialLibrary` key on the spec, so the second
 * spectator costs a `Mesh` and nothing else.
 *
 * Geometries and materials are immutable once built and are never disposed by a
 * model; the caches own them for the lifetime of the renderer. A model's own
 * `dispose()` therefore has nothing to release, which is the point.
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import {
  matKey,
  primKey,
  type MatSpec,
  type PartSpec,
  type PrimSpec,
  type ProceduralModelSpec,
  type Vec3,
} from './spec';
import { smoothHull } from '../toon';

/** Geometries, shared by shape. */
export class PrimitiveCache {
  private readonly cache = new Map<string, BufferGeometry>();
  private readonly hulls = new Map<string, BufferGeometry>();

  get(prim: PrimSpec): BufferGeometry {
    const key = primKey(prim);
    let geometry = this.cache.get(key);
    if (geometry === undefined) {
      geometry = createGeometry(prim);
      this.cache.set(key, geometry);
    }
    return geometry;
  }

  /** The shape with its corners closed, for an ink rim that does not split at them (`toon.ts`). */
  hull(prim: PrimSpec): BufferGeometry {
    const key = primKey(prim);
    let hull = this.hulls.get(key);
    if (hull === undefined) {
      hull = smoothHull(this.get(prim));
      this.hulls.set(key, hull);
    }
    return hull;
  }

  get size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const geometry of [...this.cache.values(), ...this.hulls.values()]) geometry.dispose();
    this.cache.clear();
    this.hulls.clear();
  }
}

function createGeometry(prim: PrimSpec): BufferGeometry {
  switch (prim.kind) {
    case 'box':
      return new BoxGeometry(prim.w, prim.h, prim.d);
    case 'cylinder':
      return new CylinderGeometry(prim.rTop, prim.rBottom, prim.h, prim.seg, 1, prim.open === true);
    case 'cone':
      return new ConeGeometry(prim.r, prim.h, prim.seg);
    case 'sphere':
      return new SphereGeometry(prim.r, prim.wSeg, prim.hSeg);
    case 'icosahedron':
      return new IcosahedronGeometry(prim.r, prim.detail ?? 0);
    case 'octahedron':
      return new OctahedronGeometry(prim.r, prim.detail ?? 0);
    case 'tetrahedron':
      return new TetrahedronGeometry(prim.r, prim.detail ?? 0);
    case 'torus':
      return new TorusGeometry(prim.r, prim.tube, prim.radSeg, prim.tubSeg, prim.arc);
  }
}

/** Materials, shared by appearance. */
export class MaterialLibrary {
  private readonly cache = new Map<string, Material>();

  get(mat: MatSpec): Material {
    const key = matKey(mat);
    let material = this.cache.get(key);
    if (material === undefined) {
      material = createMaterial(mat);
      this.cache.set(key, material);
    }
    return material;
  }

  get size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }
}

function createMaterial(mat: MatSpec): Material {
  const transparent = mat.opacity !== undefined && mat.opacity < 1;
  // three warns on an explicitly undefined `side`, so the key is omitted rather
  // than passed as undefined.
  const side = mat.doubleSide === true ? { side: DoubleSide } : {};
  if (mat.unlit === true) {
    return new MeshBasicMaterial({
      color: new Color(mat.color),
      transparent,
      opacity: mat.opacity ?? 1,
      depthWrite: mat.depthWrite ?? true,
      ...side,
    });
  }
  // The legacy library was flat-shaded everywhere; keeping that is what makes a
  // ported model read the same. Light falls on it smoothly, so a spec's metalness
  // and roughness reach the material rather than only keying the cache.
  const material = new MeshStandardMaterial({
    color: new Color(mat.color),
    transparent,
    opacity: mat.opacity ?? 1,
    depthWrite: mat.depthWrite ?? true,
    metalness: mat.metalness ?? 0,
    roughness: mat.roughness ?? 1,
    flatShading: true,
    ...side,
  });
  if (mat.emissive !== undefined) {
    material.emissive = new Color(mat.emissive);
    material.emissiveIntensity = mat.emissiveIntensity ?? 1;
  }
  return material;
}

/** Both caches together — one set per renderer. */
export class ModelResources {
  readonly primitives = new PrimitiveCache();
  readonly materials = new MaterialLibrary();

  dispose(): void {
    this.primitives.dispose();
    this.materials.dispose();
  }
}

export interface BuildOptions {
  /**
   * Palette overrides, merged over the spec's own. This is how an entity's colour
   * reaches its base ring without the model knowing anything about entities.
   */
  palette?: Readonly<Record<string, MatSpec>>;
  /**
   * How big the thing stands, in tiles, overriding whatever size it was authored or
   * declared at. This is how a kind of tile says how much of its cell its model fills
   * without the model having to know it is being used as ground.
   *
   * Applied to the group, so it reaches a placeholder standing in for a file still on its
   * way as readily as the real thing — the ground does not change size when the file lands.
   */
  scale?: number;
}

export interface BuiltModel {
  readonly group: Group;
  readonly spec: ProceduralModelSpec;
  /** Parts the spec named, for runtime lookups like the spirit eyes. */
  readonly named: ReadonlyMap<string, Mesh>;
  /** Empty anchors declared by the spec, already positioned. */
  readonly hooks: ReadonlyMap<string, Object3D>;
}

/**
 * Build a model.
 *
 * The returned group's origin is the model's feet at y = 0, so a caller places it
 * at a tile's surface height and nothing else. `groundOffset` shifts a model that
 * deliberately sinks or floats.
 */
export function buildModel(
  spec: ProceduralModelSpec,
  resources: ModelResources,
  options: BuildOptions = {},
): BuiltModel {
  const group = new Group();
  group.name = `model:${spec.id}`;
  const palette = options.palette === undefined ? spec.palette : { ...spec.palette, ...options.palette };

  const named = new Map<string, Mesh>();
  for (const part of spec.parts) {
    const matSpec = palette[part.mat];
    if (matSpec === undefined) {
      throw new Error(`model "${spec.id}" uses material "${part.mat}", which its palette does not define`);
    }
    const mesh = new Mesh(resources.primitives.get(part.prim), resources.materials.get(matSpec));
    applyTransform(mesh, part);
    // Unlit fx parts never cast; everything else does, as the legacy P() did.
    mesh.castShadow = part.castShadow ?? matSpec.unlit !== true;
    mesh.receiveShadow = mesh.castShadow;
    if (part.hidden === true) mesh.visible = false;
    if (part.name !== undefined) {
      mesh.name = part.name;
      named.set(part.name, mesh);
    }
    group.add(mesh);
  }

  const hooks = new Map<string, Object3D>();
  for (const [name, hook] of Object.entries(spec.hooks ?? {})) {
    const anchor = new Object3D();
    anchor.name = `hook:${name}`;
    anchor.position.set(...hook.pos);
    if (hook.rot !== undefined) anchor.rotation.set(...hook.rot);
    group.add(anchor);
    hooks.set(name, anchor);
  }

  // Scale before the offset is read off it: `position` is applied after `scale` in a local
  // matrix, so a model told to sink a quarter tile sinks a quarter tile at any size.
  if (options.scale !== undefined) group.scale.setScalar(options.scale);
  if (spec.groundOffset !== undefined) group.position.y = spec.groundOffset;

  return { group, spec, named, hooks };
}

/** World units a model's ink rim stands out from it: two or three pixels at the play camera's distance. */
const OUTLINE_WIDTH = 0.022;

/** Whether a part gets a rim: lit, solid, and big enough that the rim is not all of it - an eye is not. */
function inked(mesh: Mesh, mat: MatSpec): boolean {
  if (mat.unlit === true || (mat.opacity ?? 1) < 1) return false;
  const geometry = mesh.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  return geometry.boundingSphere!.radius * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z) >= 0.06;
}

function applyTransform(mesh: Mesh, part: PartSpec): void {
  if (part.pos !== undefined) mesh.position.set(...part.pos);
  if (part.rot !== undefined) mesh.rotation.set(...part.rot);
  if (part.scale !== undefined) {
    if (typeof part.scale === 'number') mesh.scale.setScalar(part.scale);
    else mesh.scale.set(...(part.scale as Vec3));
  }
}

/**
 * Light 0, 1 or 2 spirit eyes — the legacy `setSpiritEyes`, expressed as a swap
 * between two shared materials rather than a fresh material per call.
 */
export const SPIRIT_EYE_MATERIALS: { readonly on: MatSpec; readonly off: MatSpec } = {
  on: { color: '#aef6ff', emissive: '#7be8ff', emissiveIntensity: 1.6 },
  off: { color: '#1a1a22' },
};

export function setSpiritEyes(model: BuiltModel, resources: ModelResources, count: number): void {
  ['eye0', 'eye1'].forEach((name, i) => {
    const eye = model.named.get(name);
    if (eye === undefined) return;
    const lit = i < count;
    eye.material = resources.materials.get(lit ? SPIRIT_EYE_MATERIALS.on : SPIRIT_EYE_MATERIALS.off);
    eye.scale.setScalar(lit ? 1.4 : 1);
  });
}
