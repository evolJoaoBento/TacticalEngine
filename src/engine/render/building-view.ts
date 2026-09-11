/** Bounded GPU residency over a sparse, potentially very wide construction layer. */
import {
  BoxGeometry, Color, Frustum, GridHelper, Group, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Sphere, Vector3, type Camera,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BUILD_MATERIALS, buildingParts, type BuildingTile } from '../scene/building';
import type { SceneDoc } from '../scene/schema';
import { DEFAULT_LAYOUT } from './layout';

export const BUILD_CHUNK_SIZE = 16;
export const BUILD_VIEW_DISTANCE = 128;
export const BUILD_RESIDENT_LIMIT = 96;
const CHUNK_RADIUS = Math.sqrt(3) * BUILD_CHUNK_SIZE / 2 + 1;
const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`;
interface Chunk {
  key: string;
  x: number;
  y: number;
  z: number;
  tiles: BuildingTile[];
  radius: number;
  mesh?: InstancedMesh;
  lod?: number;
}
export interface BuildingStats {
  tiles: number;
  chunks: number;
  residentChunks: number;
  visibleChunks: number;
  instances: number;
  triangles: number;
  lods: number[];
}

export class BuildingView {
  readonly root = new Group();
  readonly guide = new GridHelper(32, 32, '#b58cff', '#50455f');
  readonly preview = new Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly columns = new Map<string, Map<number, Chunk>>();
  private readonly resident = new Set<Chunk>();
  private readonly detailed = new RoundedBoxGeometry(1, 1, 1, 1, 0.035);
  private readonly simple = new BoxGeometry(1, 1, 1);
  private readonly material = new MeshStandardMaterial({ roughness: 0.9 });
  private readonly ghostMaterial = new MeshBasicMaterial({ color: '#b58cff', transparent: true, opacity: 0.45, depthWrite: false });
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

  constructor() {
    this.root.name = 'building-tiles';
    this.guide.visible = false;
    this.preview.visible = false;
    this.root.add(this.guide, this.preview);
  }

  /** Reindex after edits; preserve GPU buffers for every unchanged chunk. */
  sync(scene: SceneDoc): void {
    this.needsWork = true;
    const next = new Map<string, Chunk>();
    const offsetX = (scene.width - 1) / 2;
    const offsetZ = (scene.height - 1) / 2;
    const moved = offsetX !== this.offsetX || offsetZ !== this.offsetZ;
    this.offsetX = offsetX;
    this.offsetZ = offsetZ;
    this.tileCount = 0;
    for (const tile of Object.values(scene.buildingTiles ?? {})) {
      const x = Math.floor(tile.x / BUILD_CHUNK_SIZE);
      const y = Math.floor(tile.level / BUILD_CHUNK_SIZE);
      const z = Math.floor(tile.y / BUILD_CHUNK_SIZE);
      const key = keyOf(x, y, z);
      let chunk = next.get(key);
      if (!chunk) { chunk = { key, x, y, z, tiles: [], radius: CHUNK_RADIUS }; next.set(key, chunk); }
      chunk.tiles.push(tile);
      chunk.radius = Math.max(chunk.radius, CHUNK_RADIUS + (tile.height ?? 1) - 1);
      this.tileCount++;
    }
    for (const [key, old] of this.chunks) {
      const replacement = next.get(key);
      if (!moved && replacement && replacement.tiles.length === old.tiles.length && replacement.tiles.every((t, i) => t === old.tiles[i])) {
        next.set(key, old);
      } else this.release(old);
    }
    this.chunks.clear();
    this.columns.clear();
    for (const [key, chunk] of next) {
      this.chunks.set(key, chunk);
      const columnKey = `${chunk.x},${chunk.z}`;
      let column = this.columns.get(columnKey);
      if (!column) { column = new Map(); this.columns.set(columnKey, column); }
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
            this.sphere.center.set((x + 0.5) * BUILD_CHUNK_SIZE - this.offsetX - 0.5,
              (y + 0.5) * BUILD_CHUNK_SIZE + DEFAULT_LAYOUT.baseHeight,
              (z + 0.5) * BUILD_CHUNK_SIZE - this.offsetZ - 0.5);
            this.sphere.radius = chunk.radius;
            const distance = Math.max(0, eye.distanceTo(this.sphere.center) - chunk.radius);
            if (distance > BUILD_VIEW_DISTANCE || !this.frustum.intersectsSphere(this.sphere)) continue;
            candidates.push({ chunk, distance });
          }
        }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const wanted = new Set(candidates.slice(0, BUILD_RESIDENT_LIMIT).map((c) => c.chunk));
    for (const chunk of this.resident) if (!wanted.has(chunk)) this.release(chunk);
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

  private build(chunk: Chunk, lod: number): void {
    const count = chunk.tiles.reduce((n, t) => n + buildingParts(t.shape, lod === 2).length, 0);
    const mesh = new InstancedMesh(lod === 0 ? this.detailed : this.simple, this.material, count);
    mesh.name = `building:${chunk.key}:lod${lod}`;
    mesh.position.set(chunk.x * BUILD_CHUNK_SIZE - this.offsetX,
      chunk.y * BUILD_CHUNK_SIZE + DEFAULT_LAYOUT.baseHeight, chunk.z * BUILD_CHUNK_SIZE - this.offsetZ);
    let i = 0;
    for (const tile of chunk.tiles) {
      const angle = tile.rotation * Math.PI / 2;
      const sin = Math.sin(angle), cos = Math.cos(angle);
      for (const part of buildingParts(tile.shape, lod === 2)) {
        const [x, y, z, sx, sy, sz] = part as [number, number, number, number, number, number];
        this.scratch.position.set(tile.x - chunk.x * BUILD_CHUNK_SIZE + x * cos + z * sin,
          tile.level - chunk.y * BUILD_CHUNK_SIZE + y * (tile.height ?? 1), tile.y - chunk.z * BUILD_CHUNK_SIZE - x * sin + z * cos);
        this.scratch.rotation.set(0, angle, 0);
        this.scratch.scale.set(sx, sy * (tile.height ?? 1), sz);
        this.scratch.updateMatrix();
        mesh.setMatrixAt(i, this.scratch.matrix);
        mesh.setColorAt(i++, this.color.set(BUILD_MATERIALS[tile.material]));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = lod === 0;
    mesh.receiveShadow = true;
    chunk.mesh = mesh;
    chunk.lod = lod;
    this.root.add(mesh);
    this.resident.add(chunk);
  }

  private release(chunk: Chunk): void {
    if (chunk.mesh) { this.root.remove(chunk.mesh); chunk.mesh.dispose(); }
    delete chunk.mesh;
    delete chunk.lod;
    this.resident.delete(chunk);
  }

  showGuide(x: number, y: number, level: number, visible: boolean): void {
    this.guide.visible = visible;
    this.guide.position.set(Math.round(x) - this.offsetX + 0.5, DEFAULT_LAYOUT.baseHeight + level + 0.002,
      Math.round(y) - this.offsetZ + 0.5);
    if (!visible) this.preview.visible = false;
  }

  showPreview(tile: BuildingTile | null, erase = false, brushSize = 1): void {
    this.preview.visible = tile !== null;
    if (!tile) return;
    // At most four preview meshes, reused as the pointer moves.
    while (this.preview.children.length < 4) this.preview.add(new Mesh(this.simple, this.ghostMaterial));
    this.ghostMaterial.color.set(erase ? '#ff6a5c' : '#b58cff');
    const parts = buildingParts(tile.shape);
    this.preview.position.set(tile.x - this.offsetX, DEFAULT_LAYOUT.baseHeight + tile.level, tile.y - this.offsetZ);
    this.preview.rotation.y = tile.rotation * Math.PI / 2;
    this.preview.scale.set(brushSize, tile.height ?? 1, brushSize);
    this.preview.children.forEach((mesh, i) => {
      const part = parts[i];
      mesh.visible = part !== undefined;
      if (part) { mesh.position.set(part[0]!, part[1]!, part[2]!); mesh.scale.set(part[3]!, part[4]!, part[5]!); }
    });
  }

  stats(): BuildingStats {
    const stats: BuildingStats = { tiles: this.tileCount, chunks: this.chunks.size, residentChunks: this.resident.size,
      visibleChunks: this.resident.size, instances: 0, triangles: 0, lods: [0, 0, 0] };
    for (const chunk of this.resident) {
      const mesh = chunk.mesh!;
      stats.instances += mesh.count;
      stats.triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 * mesh.count;
      stats.lods[chunk.lod!]!++;
    }
    return stats;
  }

  dispose(): void {
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
