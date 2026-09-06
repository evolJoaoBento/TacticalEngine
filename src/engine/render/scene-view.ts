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
  DirectionalLight,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
} from 'three';
import { NO_TILE, type TileGrid } from '../grid/grid';
import type { Deco } from '../scene/schema';
import type { EntityState, SceneState } from '../scene/state';
import { DEFAULT_LAYOUT, surfaceHeight, tileCenter, type TileLayout } from './layout';
import { ModelResources, buildModel, type BuiltModel } from './procedural/build';
import { ModelRegistry } from './procedural/registry';
import { ringMaterial } from './procedural/spec';
import { buildTerrainMesh, type TerrainMesh, type TerrainMeshOptions } from './terrain-mesh';

export interface SceneViewOptions extends TerrainMeshOptions {
  layout?: TileLayout;
  /** Base-ring colour per faction, so a token reads as friend or foe at a glance. */
  factionColors?: Readonly<Record<string, string>>;
  /** Largest number of tiles the highlight layer can show at once. */
  maxHighlights?: number;
  /** Model library. Defaults to the shipped one. */
  registry?: ModelRegistry;
  /** Shared geometry and material caches. Pass one per renderer, not per scene. */
  resources?: ModelResources;
  /**
   * Which model an entity uses. Defaults to its `definition`, which is what the
   * legacy content's `model` strings import to.
   */
  modelForEntity?: (entity: EntityState) => string;
}

export const DEFAULT_FACTION_COLORS: Readonly<Record<string, string>> = {
  party: '#f6c453',
  adversary: '#c0524a',
  neutral: '#8ea3b0',
};

/** Fallback model per faction, when an entity's definition names none. */
const FALLBACK_MODEL: Readonly<Record<string, string>> = {
  party: 'knight',
  adversary: 'husk',
  neutral: 'dummy',
};

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
  terrain: TerrainMesh;
  private readonly terrainOptions: TerrainMeshOptions;

  readonly registry: ModelRegistry;
  readonly resources: ModelResources;
  /** True when this view created the resources and should dispose them. */
  private readonly ownsResources: boolean;

  private readonly tokens = new Map<string, BuiltModel>();
  private readonly decos: Group[] = [];
  private readonly modelForEntity: (entity: EntityState) => string;
  private readonly highlight: InstancedMesh;
  private readonly highlightGeometry: BoxGeometry;
  private readonly highlightMaterial: MeshBasicMaterial;
  /** The tile under the pointer: one quad, a different colour, or hidden. */
  private readonly cursor: Mesh;
  private readonly cursorMaterial: MeshBasicMaterial;
  private cursorTile = NO_TILE;
  private readonly maxHighlights: number;
  private highlightCount = 0;
  private readonly dummy = new Object3D();
  private readonly factionColors: Readonly<Record<string, string>>;

  constructor(grid: TileGrid, options: SceneViewOptions = {}) {
    this.grid = grid;
    this.layout = options.layout ?? DEFAULT_LAYOUT;
    this.factionColors = options.factionColors ?? DEFAULT_FACTION_COLORS;
    this.maxHighlights = options.maxHighlights ?? grid.size;

    this.registry = options.registry ?? new ModelRegistry();
    this.ownsResources = options.resources === undefined;
    this.resources = options.resources ?? new ModelResources();
    this.modelForEntity =
      options.modelForEntity ??
      ((entity) =>
        this.registry.has(entity.definition)
          ? entity.definition
          : (FALLBACK_MODEL[entity.faction] ?? 'dummy'));

    this.scene.background = new Color('#0d0f14');
    this.scene.add(this.root);

    this.terrainOptions = options;
    this.terrain = buildTerrainMesh(grid, options);
    for (const mesh of this.terrain.meshes) this.root.add(mesh);

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

    this.cursorMaterial = new MeshBasicMaterial({
      color: new Color('#ffe08a'),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.cursor = new Mesh(this.highlightGeometry, this.cursorMaterial);
    this.cursor.name = 'cursor';
    this.cursor.visible = false;
    this.root.add(this.cursor);

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
        // The base ring carries the faction colour, so one spec serves both sides.
        const ring = this.factionColors[entity.faction] ?? DEFAULT_FACTION_COLORS['neutral']!;
        token = buildModel(this.registry.get(this.modelForEntity(entity)), this.resources, {
          palette: { ring: ringMaterial(ring) },
        });
        token.group.name = `token:${entity.id}`;
        this.tokens.set(entity.id, token);
        this.root.add(token.group);
      }
      this.placeToken(token, entity);
    }

    for (const [id, token] of this.tokens) {
      if (seen.has(id)) continue;
      this.root.remove(token.group);
      this.tokens.delete(id);
    }
  }

  private placeToken(token: BuiltModel, entity: EntityState): void {
    const group = token.group;
    if (!this.grid.isTile(entity.tile)) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const centre = tileCenter(this.grid, entity.tile, this.layout);
    const lift = token.spec.groundOffset ?? 0;
    group.position.set(centre.x, centre.y + lift, centre.z);
    // A fallen creature lies down rather than vanishing; the engine keeps its body.
    group.rotation.set(entity.alive ? 0 : -Math.PI / 2, 0, 0);
  }

  /**
   * Rebuild the terrain after an edit.
   *
   * Instancing groups tiles by terrain type with a fixed count per group, so a
   * tile changing type changes group membership — cheaper and far less
   * error-prone to rebuild the whole thing than to shuffle instances between
   * meshes. A 22x16 map is 352 instances across four meshes; the cost is not the
   * problem the grouping would be.
   */
  rebuildTerrain(tints?: readonly string[]): void {
    for (const mesh of this.terrain.meshes) this.root.remove(mesh);
    this.terrain.dispose();
    this.terrain = buildTerrainMesh(this.grid, {
      ...this.terrainOptions,
      ...(tints === undefined ? {} : { tints }),
    });
    for (const mesh of this.terrain.meshes) this.root.add(mesh);
  }

  /** The model standing for an entity, if it has one. */
  tokenFor(id: string): BuiltModel | undefined {
    return this.tokens.get(id);
  }

  /**
   * Build the scenery. Decos never change during play, so this is called once;
   * calling it again replaces what was there.
   */
  setDecos(decos: readonly Deco[]): void {
    for (const group of this.decos) this.root.remove(group);
    this.decos.length = 0;

    for (const deco of decos) {
      const tile = this.grid.indexOf(deco.position.x, deco.position.y);
      if (!this.grid.isTile(tile)) continue;
      const model = buildModel(this.registry.get(deco.model), this.resources);
      const centre = tileCenter(this.grid, tile, this.layout);
      const lift = model.spec.groundOffset ?? 0;
      model.group.position.set(centre.x, centre.y + lift, centre.z);
      model.group.rotation.y = deco.rotation;
      this.root.add(model.group);
      this.decos.push(model.group);
    }
  }

  /** How many scenery models are in the scene. */
  get decoCount(): number {
    return this.decos.length;
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

  /** Mark the tile under the pointer, or nothing for `NO_TILE`. */
  showCursor(tile: number): void {
    if (tile === this.cursorTile) return;
    this.cursorTile = tile;
    if (!this.grid.isTile(tile)) {
      this.cursor.visible = false;
      return;
    }
    const centre = tileCenter(this.grid, tile, this.layout);
    this.cursor.position.set(centre.x, surfaceHeight(this.grid.heightAt(tile), this.layout) + 0.03, centre.z);
    this.cursor.visible = true;
  }

  /** The tile the cursor marks, or `NO_TILE`. */
  get cursorAt(): number {
    return this.cursorTile;
  }

  dispose(): void {
    this.terrain.dispose();
    this.highlightGeometry.dispose();
    this.highlightMaterial.dispose();
    this.highlight.dispose();
    this.cursorMaterial.dispose();
    this.tokens.clear();
    this.decos.length = 0;
    // Shared caches outlive a scene unless this view created them.
    if (this.ownsResources) this.resources.dispose();
  }
}
