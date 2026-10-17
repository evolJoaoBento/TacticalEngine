/** Bounded GPU residency over a sparse, potentially very wide construction layer. */
import {
  BoxGeometry,
  Color,
  Frustum,
  GridHelper,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Sphere,
  Vector3,
  type Camera,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BUILD_MATERIALS, buildingParts, type BuildingTile } from '../scene/building';
import type { SceneDoc } from '../scene/schema';
import type { TerrainPalette } from '../grid/terrain';
import { DEFAULT_LAYOUT } from './layout';
import type { SurfaceLibrary } from './surface-library';

/** Tiles per chunk on each axis. One chunk is one draw call, so it sets the grain. */
export const BUILD_CHUNK_SIZE = 16;

/** How far from the eye a chunk may be and still be drawn, in world units. */
export const BUILD_VIEW_DISTANCE = 128;

/** How many chunks may hold GPU buffers at once, whatever the world's extent. */
export const BUILD_RESIDENT_LIMIT = 96;

/** Half the diagonal of a chunk, plus a tile of slack for pieces that overhang it. */
const CHUNK_RADIUS = Math.sqrt(3) * BUILD_CHUNK_SIZE / 2 + 1;

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * One cube of the world, with whatever pieces fall inside it and its GPU buffers: a mesh for each look its pieces are
 * drawn in - the plain box, or each imported material (`looks`, a piece's own beside it).
 */
interface Chunk {
  key: string;
  x: number;
  y: number;
  z: number;
  tiles: BuildingTile[];
  /** Each piece's look: the imported material it is drawn in, or `null` for the plain box. */
  looks: (string | null)[];
  /** What the looks were drawn with when the chunk was built, so one whose materials changed is built again. */
  signature: string;
  radius: number;
  meshes?: InstancedMesh[];
  lod?: number;
}
/**
 * What the construction layer is actually costing, for a test or the driver to
 * assert on. Everything here is counted from the meshes that exist, never from
 * what the code meant to build.
 */
export interface BuildingStats {
  /** Pieces in the document. */
  tiles: number;
  /** Chunks the document fills, drawn or not. */
  chunks: number;
  /** Chunks holding GPU buffers right now. */
  residentChunks: number;
  /**
   * Chunks the last `update` found near enough and in frustum, up to the
   * residency budget. Resident chunks are a subset: a chunk is wanted before
   * its buffers are built, since only two are built per frame.
   */
  visibleChunks: number;
  /** Instances across every resident mesh. */
  instances: number;
  /** Triangles those instances draw. */
  triangles: number;
  /** How many resident chunks are at each level of detail, nearest first. */
  lods: number[];
  /** Instances drawn in an imported material rather than as plain boxes. */
  textured: number;
}

/**
 * The construction layer, drawn.
 *
 * Chunks are the unit of residency, so what is on the GPU is bounded by the
 * view rather than by how far the document reaches: a piece a million tiles
 * away costs a map entry and nothing else. Instance transforms are chunk-local,
 * because float32 has no precision left at ±1,000,000.
 */
export class BuildingView {
  /** Everything this view owns, for a caller to add to a scene of their own. */
  readonly root = new Group();
  /** The grid drawn at the level being built on, so an empty plane is still aimable. */
  readonly guide = new GridHelper(32, 32, '#8a8a8a', '#505050');
  /** The translucent piece under the pointer. */
  readonly preview = new Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly columns = new Map<string, Map<number, Chunk>>();
  private readonly resident = new Set<Chunk>();
  private readonly detailed = new RoundedBoxGeometry(1, 1, 1, 1, 0.035);
  private readonly simple = new BoxGeometry(1, 1, 1);
  private readonly material = new MeshStandardMaterial({ flatShading: true });
  private readonly ghostMaterial = new MeshBasicMaterial({
    color: '#5f8ad0',
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  private readonly scratch = new Object3D();
  private readonly color = new Color();
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private readonly lastMatrix = new Matrix4();
  private needsWork = true;
  private readonly sphere = new Sphere(new Vector3(), CHUNK_RADIUS);
  private offsetX = 0;
  private offsetZ = 0;
  private tileCount = 0;
  private visibleCount = 0;
  /** The imported materials kinds of tile are drawn in; none, and every piece is a plain box as it always was. */
  private readonly surfaces: SurfaceLibrary | undefined;
  /** What the last `sync` was given, to sync again when a material arrives. */
  private last: { scene: SceneDoc; palette: TerrainPalette | undefined } | null = null;
  private readonly unsubscribe: () => void = () => undefined;

  constructor(options: { surfaces?: SurfaceLibrary } = {}) {
    this.root.name = 'building-tiles';
    this.guide.visible = false;
    this.preview.visible = false;
    this.root.add(this.guide, this.preview);
    this.surfaces = options.surfaces;
    // A material that lands, or is let go, changes what the chunks drawn in it look like: synced again, and those
    // chunks - their signatures changed - built afresh.
    if (this.surfaces !== undefined) {
      this.unsubscribe = this.surfaces.onChange(() => {
        if (this.last !== null) this.sync(this.last.scene, this.last.palette);
      });
    }
  }

  /**
   * Reindex after edits; preserve GPU buffers for every unchanged chunk.
   *
   * A piece whose kind of tile is drawn with a model is skipped: `tile-models` stands the
   * file up instead, and drawing both would leave a grey box inside every crate. Without a
   * palette nothing can be skipped, which is what a caller that has none wants - the
   * thumbnails and the tests draw every piece as a box on purpose.
   *
   * A piece whose kind names an imported material (`TerrainType.surface`) is drawn in it, once the library has its
   * maps; until then it is the plain box in the kind's colour.
   */
  sync(scene: SceneDoc, palette?: TerrainPalette): void {
    this.last = { scene, palette };
    this.needsWork = true;
    const next = new Map<string, Chunk>();
    const offsetX = (scene.width - 1) / 2;
    const offsetZ = (scene.height - 1) / 2;
    const moved = offsetX !== this.offsetX || offsetZ !== this.offsetZ;
    this.offsetX = offsetX;
    this.offsetZ = offsetZ;
    this.tileCount = 0;
    for (const tile of Object.values(scene.buildingTiles ?? {})) {
      if (tile.tile !== undefined && palette !== undefined) {
        const index = palette.indexOf(tile.tile);
        if (index >= 0 && palette.at(index).model !== undefined) continue;
      }
      const x = Math.floor(tile.x / BUILD_CHUNK_SIZE);
      const y = Math.floor(tile.level / BUILD_CHUNK_SIZE);
      const z = Math.floor(tile.y / BUILD_CHUNK_SIZE);
      const key = keyOf(x, y, z);
      let chunk = next.get(key);
      if (!chunk) {
        chunk = { key, x, y, z, tiles: [], looks: [], signature: '', radius: CHUNK_RADIUS };
        next.set(key, chunk);
      }
      chunk.tiles.push(tile);
      chunk.looks.push(this.lookOf(tile, palette));
      chunk.radius = Math.max(chunk.radius, CHUNK_RADIUS + (tile.height ?? 1) - 1);
      this.tileCount++;
    }
    for (const chunk of next.values()) chunk.signature = this.signatureOf(chunk.looks);
    // A chunk whose pieces are the very same objects, drawn in the very same materials, still holds good buffers.
    // `BuildingEdit` writes new tile objects rather than mutating, so identity is a sound test - which is why it must
    // keep doing that.
    for (const [key, old] of this.chunks) {
      const fresh = next.get(key);
      if (!moved && sameTiles(fresh, old) && fresh!.signature === old.signature) next.set(key, old);
      else this.release(old);
    }
    this.chunks.clear();
    this.columns.clear();
    for (const [key, chunk] of next) {
      this.chunks.set(key, chunk);
      const columnKey = `${chunk.x},${chunk.z}`;
      let column = this.columns.get(columnKey);
      if (!column) {
        column = new Map();
        this.columns.set(columnKey, column);
      }
      column.set(chunk.y, chunk);
    }
  }

  /** Chunk lookup is bounded by view distance, independent of the world's extent. */
  update(camera: Camera): void {
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.needsWork && this.lastMatrix.equals(this.matrix)) return;
    this.lastMatrix.copy(this.matrix);
    this.needsWork = false;
    this.frustum.setFromProjectionMatrix(this.matrix);
    const eye = camera.position;
    const cx = Math.floor((eye.x + this.offsetX) / BUILD_CHUNK_SIZE);
    const cy = Math.floor((eye.y - DEFAULT_LAYOUT.baseHeight) / BUILD_CHUNK_SIZE);
    const cz = Math.floor((eye.z + this.offsetZ) / BUILD_CHUNK_SIZE);
    const radius = Math.ceil((BUILD_VIEW_DISTANCE + CHUNK_RADIUS + 15) / BUILD_CHUNK_SIZE);
    const candidates: { chunk: Chunk; distance: number }[] = [];
    // Empty documents take the fast path, including the original demo.
    if (this.chunks.size > 0) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        for (let z = cz - radius; z <= cz + radius; z++) {
          const column = this.columns.get(`${x},${z}`);
          if (!column) continue;
          for (let y = cy - radius; y <= cy + radius; y++) {
            const chunk = column.get(y);
            if (!chunk) continue;
            this.sphere.center.set(
              (x + 0.5) * BUILD_CHUNK_SIZE - this.offsetX - 0.5,
              (y + 0.5) * BUILD_CHUNK_SIZE + DEFAULT_LAYOUT.baseHeight,
              (z + 0.5) * BUILD_CHUNK_SIZE - this.offsetZ - 0.5,
            );
            this.sphere.radius = chunk.radius;
            const distance = Math.max(0, eye.distanceTo(this.sphere.center) - chunk.radius);
            if (distance > BUILD_VIEW_DISTANCE) continue;
            if (!this.frustum.intersectsSphere(this.sphere)) continue;
            candidates.push({ chunk, distance });
          }
        }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const wanted = new Set(candidates.slice(0, BUILD_RESIDENT_LIMIT).map((c) => c.chunk));
    // What the camera can see, as opposed to what has buffers yet.
    this.visibleCount = wanted.size;
    for (const chunk of this.resident) {
      if (!wanted.has(chunk)) this.release(chunk);
    }
    let builds = 0;
    for (const { chunk, distance } of candidates.slice(0, BUILD_RESIDENT_LIMIT)) {
      // Hysteresis prevents churn when the camera rests on a transition boundary.
      let lod = distance < 24 ? 0 : distance < 64 ? 1 : 2;
      if (chunk.lod === 0 && distance < 28) lod = 0;
      if (chunk.lod === 1 && distance >= 20 && distance < 68) lod = 1;
      if (chunk.lod === 2 && distance >= 60) lod = 2;
      if (chunk.lod !== lod && builds < 2) {
        this.release(chunk);
        this.build(chunk, lod);
        builds++;
      }
      if (chunk.lod !== lod) this.needsWork = true;
    }
  }

  /**
   * The look a piece is drawn in: the imported material its kind names - when the kind is drawn as a box, not with a
   * model, and the project has that material - else `null`, the plain box.
   */
  private lookOf(tile: BuildingTile, palette: TerrainPalette | undefined): string | null {
    if (this.surfaces === undefined || palette === undefined || tile.tile === undefined) return null;
    const index = palette.indexOf(tile.tile);
    const surface = index >= 0 ? palette.at(index).surface : undefined;
    return surface !== undefined && this.surfaces.has(surface) ? surface : null;
  }

  /** What a chunk's looks are drawn with now: each material, and whether - and which time - its maps are in. */
  private signatureOf(looks: readonly (string | null)[]): string {
    if (this.surfaces === undefined) return '';
    const ids = [...new Set(looks.filter((look): look is string => look !== null))].sort();
    return ids.map((id) => `${id}:${this.surfaces!.statusOf(id)}:${this.surfaces!.generationOf(id)}`).join('|');
  }

  private build(chunk: Chunk, lod: number): void {
    // One mesh for each look: the plain box tinted piece by piece, and each material its pieces share.
    const groups = new Map<string | null, number[]>();
    chunk.tiles.forEach((_, i) => {
      const look = chunk.looks[i] ?? null;
      // A material whose maps are not in yet draws as the plain box, in its kind's colour, until they are.
      const drawn = look !== null && this.surfaces?.materialFor(look, lod === 2) ? look : null;
      groups.set(drawn, [...(groups.get(drawn) ?? []), i]);
    });
    const meshes: InstancedMesh[] = [];
    for (const [look, indices] of groups) {
      const material = look === null ? this.material : this.surfaces!.materialFor(look, lod === 2)!;
      const count = indices.reduce((n, i) => n + buildingParts(chunk.tiles[i]!.shape, lod === 2).length, 0);
      const mesh = new InstancedMesh(lod === 0 ? this.detailed : this.simple, material, count);
      mesh.name = `building:${chunk.key}:lod${lod}${look === null ? '' : `:${look}`}`;
      // The mesh carries the chunk's world position, so every instance matrix
      // stays within one chunk of the origin and float32 keeps its precision.
      mesh.position.set(
        chunk.x * BUILD_CHUNK_SIZE - this.offsetX,
        chunk.y * BUILD_CHUNK_SIZE + DEFAULT_LAYOUT.baseHeight,
        chunk.z * BUILD_CHUNK_SIZE - this.offsetZ,
      );
      let n = 0;
      for (const i of indices) {
        const tile = chunk.tiles[i]!;
        const angle = tile.rotation * Math.PI / 2;
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const tall = tile.height ?? 1;
        // A material's own colour is in its maps: white under them. A plain box is its tint - or, waiting for its
        // material's maps, its kind's colour.
        const waiting = chunk.looks[i] !== null && look === null ? this.last?.palette?.at(this.last.palette.indexOf(tile.tile!)).color : undefined;
        this.color.set(look !== null ? '#ffffff' : waiting ?? BUILD_MATERIALS[tile.material]);
        for (const part of buildingParts(tile.shape, lod === 2)) {
          const [x, y, z, sx, sy, sz] = part;
          this.scratch.position.set(
            tile.x - chunk.x * BUILD_CHUNK_SIZE + x * cos + z * sin,
            tile.level - chunk.y * BUILD_CHUNK_SIZE + y * tall,
            tile.y - chunk.z * BUILD_CHUNK_SIZE - x * sin + z * cos,
          );
          this.scratch.rotation.set(0, angle, 0);
          this.scratch.scale.set(sx, sy * tall, sz);
          this.scratch.updateMatrix();
          mesh.setMatrixAt(n, this.scratch.matrix);
          mesh.setColorAt(n, this.color);
          n++;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = lod === 0;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      meshes.push(mesh);
    }
    chunk.meshes = meshes;
    chunk.lod = lod;
    this.resident.add(chunk);
  }

  private release(chunk: Chunk): void {
    // Each mesh's own buffers: never the shared geometry, nor the materials, which are the view's or the library's.
    for (const mesh of chunk.meshes ?? []) {
      this.root.remove(mesh);
      mesh.dispose();
    }
    delete chunk.meshes;
    delete chunk.lod;
    this.resident.delete(chunk);
  }

  /** The grid showing which level is being built on, centred on a cell. */
  showGuide(x: number, y: number, level: number, visible: boolean): void {
    this.guide.visible = visible;
    this.guide.position.set(
      Math.round(x) - this.offsetX + 0.5,
      // Just above the plane, so the grid does not fight the pieces on it.
      DEFAULT_LAYOUT.baseHeight + level + 0.002,
      Math.round(y) - this.offsetZ + 0.5,
    );
    if (!visible) this.preview.visible = false;
  }

  /**
   * The translucent piece under the pointer, or nothing.
   *
   * Always one piece at its own size, even for a 3x3 or 5x5 brush: scaling the
   * group to the brush stretched the parts with it, so a wall brush previewed
   * as one wall five tiles long rather than five walls.
   */
  showPreview(tile: BuildingTile | null, erase = false): void {
    this.preview.visible = tile !== null;
    if (!tile) return;
    const parts = buildingParts(tile.shape);
    // One ghost per box, reused as the pointer moves and grown when a structure needs
    // more than the last one did. A pool of four was right while stairs were the largest
    // thing there was; a structure put together from five atoms would have shown four.
    while (this.preview.children.length < parts.length) {
      this.preview.add(new Mesh(this.simple, this.ghostMaterial));
    }
    this.ghostMaterial.color.set(erase ? '#ff6a5c' : '#5f8ad0');
    this.preview.position.set(
      tile.x - this.offsetX,
      DEFAULT_LAYOUT.baseHeight + tile.level,
      tile.y - this.offsetZ,
    );
    this.preview.rotation.y = tile.rotation * Math.PI / 2;
    this.preview.scale.set(1, tile.height ?? 1, 1);
    this.preview.children.forEach((mesh, i) => {
      const part = parts[i];
      mesh.visible = part !== undefined;
      if (part === undefined) return;
      mesh.position.set(part[0], part[1], part[2]);
      mesh.scale.set(part[3], part[4], part[5]);
    });
  }

  /** What is on the GPU right now, counted from the meshes themselves. */
  stats(): BuildingStats {
    const stats: BuildingStats = {
      tiles: this.tileCount,
      chunks: this.chunks.size,
      residentChunks: this.resident.size,
      visibleChunks: this.visibleCount,
      instances: 0,
      triangles: 0,
      lods: [0, 0, 0],
      textured: 0,
    };
    for (const chunk of this.resident) {
      for (const mesh of chunk.meshes!) {
        const perInstance = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count;
        stats.instances += mesh.count;
        stats.triangles += perInstance / 3 * mesh.count;
        if (mesh.material !== this.material) stats.textured += mesh.count;
      }
      stats.lods[chunk.lod!]!++;
    }
    return stats;
  }

  /** Let every buffer and every shared geometry go; the view is finished with. */
  dispose(): void {
    this.unsubscribe();
    this.last = null;
    for (const chunk of this.resident) this.release(chunk);
    this.chunks.clear();
    this.columns.clear();
    this.root.clear();
    this.guide.dispose();
    this.detailed.dispose();
    this.simple.dispose();
    this.material.dispose();
    this.ghostMaterial.dispose();
  }
}

/** Whether a reindexed chunk holds the very same tile objects as the one on the GPU. */
function sameTiles(next: Chunk | undefined, old: Chunk): boolean {
  if (next === undefined) return false;
  if (next.tiles.length !== old.tiles.length) return false;
  return next.tiles.every((tile, i) => tile === old.tiles[i]);
}
