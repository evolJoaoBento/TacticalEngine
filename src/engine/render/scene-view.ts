/**
 * The adapter between engine state and a three.js scene.
 *
 * The engine core never knows this exists: it holds a `TileGrid` and a
 * `SceneState` and answers questions about them, and this reads those answers and
 * moves meshes. Traffic is strictly one-way, which is what keeps the core
 * testable in node and lets the same scene be driven by a replay, a test, or a
 * player.
 *
 * Nothing here allocates per frame. Tokens are created once per entity and then
 * only repositioned; the highlight layer reuses a single instanced mesh and only
 * rewrites the instances that changed.
 */

import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Scene,
  type Material,
} from 'three';
import type { TileGrid } from '../grid/grid';
import type { EntityState, SceneState } from '../scene/state';
import { DEFAULT_LAYOUT, surfaceHeight, tileCenter, type TileLayout } from './layout';
import { buildTerrainMesh, type TerrainMesh, type TerrainMeshOptions } from './terrain-mesh';

export interface SceneViewOptions extends TerrainMeshOptions {
  layout?: TileLayout;
  /** Token colour per faction. */
  factionColors?: Readonly<Record<string, string>>;
  /** Largest number of tiles the highlight layer can show at once. */
  maxHighlights?: number;
}

export const DEFAULT_FACTION_COLORS: Readonly<Record<string, string>> = {
  party: '#f6c453',
  adversary: '#c0524a',
  neutral: '#8ea3b0',
};

const TOKEN_RADIUS = 0.32;
const TOKEN_HEIGHT = 0.9;

/**
 * A three scene built from a grid, kept in step with a `SceneState`.
 *
 * Call `syncTokens()` after any engine change that moved, added, removed or
 * felled an entity; call `showHighlights()` to paint a movement or targeting
 * preview.
 */
export class SceneView {
  readonly scene = new Scene();
  readonly grid: TileGrid;
  readonly layout: TileLayout;
  /** Everything the view owns, so a caller can add it to a scene of their own. */
  readonly root = new Group();
  readonly terrain: TerrainMesh;

  private readonly tokens = new Map<string, Mesh>();
  private readonly tokenGeometry: CylinderGeometry;
  private readonly tokenMaterials = new Map<string, MeshStandardMaterial>();
  private readonly highlight: InstancedMesh;
  private readonly highlightGeometry: BoxGeometry;
  private readonly highlightMaterial: MeshBasicMaterial;
  private readonly maxHighlights: number;
  private highlightCount = 0;
  private readonly dummy = new Object3D();
  private readonly factionColors: Readonly<Record<string, string>>;

  constructor(grid: TileGrid, options: SceneViewOptions = {}) {
    this.grid = grid;
    this.layout = options.layout ?? DEFAULT_LAYOUT;
    this.factionColors = options.factionColors ?? DEFAULT_FACTION_COLORS;
    this.maxHighlights = options.maxHighlights ?? grid.size;

    this.scene.background = new Color('#0d0f14');
    this.scene.add(this.root);

    this.terrain = buildTerrainMesh(grid, options);
    for (const mesh of this.terrain.meshes) this.root.add(mesh);

    this.tokenGeometry = new CylinderGeometry(TOKEN_RADIUS, TOKEN_RADIUS, TOKEN_HEIGHT, 8);
    this.tokenGeometry.translate(0, TOKEN_HEIGHT / 2, 0);

    // One flat quad per highlighted tile, hovering just above the surface.
    this.highlightGeometry = new BoxGeometry(this.layout.tileSize * 0.92, 0.02, this.layout.tileSize * 0.92);
    this.highlightMaterial = new MeshBasicMaterial({
      color: new Color('#69d2ff'),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.highlight = new InstancedMesh(
      this.highlightGeometry,
      this.highlightMaterial,
      Math.max(1, this.maxHighlights),
    );
    this.highlight.name = 'highlights';
    this.highlight.count = 0;
    this.highlight.frustumCulled = false;
    this.root.add(this.highlight);

    this.addLights();
  }

  private addLights(): void {
    this.scene.add(new AmbientLight(0xffffff, 0.45));
    const sun = new DirectionalLight(0xffffff, 1.15);
    sun.position.set(
      this.grid.width * 0.4,
      Math.max(this.grid.width, this.grid.height) * 0.8,
      this.grid.height * 0.35,
    );
    this.scene.add(sun);
  }

  /**
   * Create, move and retire token meshes so they match the entities in `state`.
   *
   * Fallen entities stay on the map, lying flat, because the engine keeps their
   * bodies too — `SceneState.isOccupied` already treats them as not blocking.
   */
  syncTokens(state: SceneState): void {
    const seen = new Set<string>();

    for (const entity of state.allEntities()) {
      seen.add(entity.id);
      let token = this.tokens.get(entity.id);
      if (token === undefined) {
        token = new Mesh(this.tokenGeometry, this.materialFor(entity.faction));
        token.name = `token:${entity.id}`;
        token.castShadow = true;
        this.tokens.set(entity.id, token);
        this.root.add(token);
      }
      this.placeToken(token, entity);
    }

    for (const [id, token] of this.tokens) {
      if (seen.has(id)) continue;
      this.root.remove(token);
      this.tokens.delete(id);
    }
  }

  private placeToken(token: Mesh, entity: EntityState): void {
    if (!this.grid.isTile(entity.tile)) {
      token.visible = false;
      return;
    }
    token.visible = true;
    const centre = tileCenter(this.grid, entity.tile, this.layout);
    token.position.set(centre.x, centre.y, centre.z);
    // A fallen creature lies down rather than vanishing.
    token.rotation.set(entity.alive ? 0 : Math.PI / 2, 0, 0);
    token.position.y = entity.alive ? centre.y : centre.y + TOKEN_RADIUS;
  }

  private materialFor(faction: string): MeshStandardMaterial {
    let material = this.tokenMaterials.get(faction);
    if (material === undefined) {
      material = new MeshStandardMaterial({
        color: new Color(this.factionColors[faction] ?? DEFAULT_FACTION_COLORS['neutral']!),
        flatShading: true,
      });
      this.tokenMaterials.set(faction, material);
    }
    return material;
  }

  /** The mesh standing for an entity, if it has one. */
  tokenFor(id: string): Mesh | undefined {
    return this.tokens.get(id);
  }

  /**
   * Paint a set of tiles — a movement preview, an area of effect, a threat range.
   * Passing an empty list clears it. Never allocates: it rewrites instances in
   * place and adjusts the draw count.
   */
  showHighlights(tiles: Iterable<number>): void {
    let i = 0;
    for (const tile of tiles) {
      if (i >= this.maxHighlights) break;
      if (!this.grid.isTile(tile)) continue;
      const centre = tileCenter(this.grid, tile, this.layout);
      this.dummy.position.set(centre.x, surfaceHeight(this.grid.heightAt(tile), this.layout) + 0.02, centre.z);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.highlight.setMatrixAt(i, this.dummy.matrix);
      i++;
    }
    this.highlightCount = i;
    this.highlight.count = i;
    this.highlight.instanceMatrix.needsUpdate = true;
  }

  /** How many tiles the highlight layer is currently drawing. */
  get highlightedCount(): number {
    return this.highlightCount;
  }

  clearHighlights(): void {
    this.showHighlights([]);
  }

  dispose(): void {
    this.terrain.dispose();
    this.tokenGeometry.dispose();
    for (const material of this.tokenMaterials.values()) (material as Material).dispose();
    this.highlightGeometry.dispose();
    this.highlightMaterial.dispose();
    this.highlight.dispose();
    this.tokens.clear();
  }
}
