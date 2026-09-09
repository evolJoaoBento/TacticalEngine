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
  AnimationMixer,
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Scene,
} from 'three';
import { NO_TILE, type TileGrid } from '../grid/grid';
import type { Deco } from '../scene/schema';
import type { EntityState, SceneState } from '../scene/state';
import { DEFAULT_LAYOUT, mapExtent, surfaceHeight, tileCenter, type TileLayout } from './layout';
import { ModelResources, buildModel, type BuildOptions, type BuiltModel } from './procedural/build';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetLibrary } from './assets';
import type { ProceduralModelSpec } from './procedural/spec';
import { placeholder as placeholderSpec } from './procedural/registry';

/** Just the faction ring, to put under an imported model. */
const RING_ONLY: ProceduralModelSpec = {
  id: 'ring',
  category: 'prop',
  standHeight: 0,
  tags: [],
  info: { name: 'Ring', desc: '' },
  palette: { ring: { color: '#ffffff' } },
  parts: [{ prim: { kind: 'cylinder', rTop: 0.42, rBottom: 0.42, h: 0.05, seg: 24 }, mat: 'ring', pos: [0, 0.025, 0] }],
};
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
  /** Imported glTF models. Asked first for every id; the library is the fallback. */
  assets?: AssetLibrary;
}

/**
 * A colour that is always the same for the same word: the fallback for a zone
 * whose condition names none, so it is painted rather than skipped. Hex, not
 * an `hsl()` string - three's parser wants commas in one and the CSS of the
 * day writes spaces, and the mismatch is silently white.
 */
export function hueOf(word: string): string {
  let hash = 0;
  for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const colour = new Color().setHSL((hash % 360) / 360, 0.7, 0.6);
  return `#${colour.getHexString()}`;
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
  private readonly assets: AssetLibrary | null;
  private stopListening: (() => void) | null = null;
  /** Which model id each token and deco was drawn from, so a late asset can find them. */
  private readonly tokenModels = new Map<string, string>();
  private lastDecos: readonly Deco[] = [];
  private lastState: SceneState | null = null;
  /** One mixer per animated clone, advanced by `tick`. */
  private readonly mixers = new Map<Object3D, AnimationMixer>();
  private readonly highlight: InstancedMesh;
  private readonly highlightGeometry: BoxGeometry;
  private readonly highlightMaterial: MeshBasicMaterial;
  /** Ground a spell holds: one quad per tile, coloured per zone, under the highlights. */
  private readonly zoneLayer: InstancedMesh;
  private readonly zoneMaterial: MeshBasicMaterial;
  private zoneCount = 0;
  /** The tile under the pointer: one quad, a different colour, or hidden. */
  private readonly cursor: Mesh;
  private readonly cursorMaterial: MeshBasicMaterial;
  private cursorTile = NO_TILE;
  /** A ring round whoever is selected, breathing so the eye finds it. */
  private readonly selection: Mesh;
  private readonly selectionGeometry: RingGeometry;
  private readonly selectionMaterial: MeshBasicMaterial;
  private selectionTile = NO_TILE;
  private breath = 0;
  /** The sun, kept so its shadow map can be let go with the rest. */
  private sun: DirectionalLight | null = null;
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
    this.assets = options.assets ?? null;
    if (this.assets !== null) {
      // When a file lands, redraw only what was waiting for it.
      this.stopListening = this.assets.onChange((id) => this.assetChanged(id));
    }
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

    // A zone is painted below a highlight, so a walk previewed across a wall
    // of flame shows both: the ground it is, and the ground it could be.
    this.zoneMaterial = new MeshBasicMaterial({
      color: new Color('#ffffff'),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.zoneLayer = new InstancedMesh(this.highlightGeometry, this.zoneMaterial, Math.max(1, this.maxHighlights));
    this.zoneLayer.name = 'zones';
    this.zoneLayer.count = 0;
    this.zoneLayer.frustumCulled = false;
    this.root.add(this.zoneLayer);

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

    // The same blue the HUD card of whoever is selected is edged in, so the
    // board and the cards point at the same person.
    this.selectionGeometry = new RingGeometry(this.layout.tileSize * 0.44, this.layout.tileSize * 0.54, 36);
    this.selectionGeometry.rotateX(-Math.PI / 2);
    this.selectionMaterial = new MeshBasicMaterial({
      color: new Color('#69d2ff'),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.selection = new Mesh(this.selectionGeometry, this.selectionMaterial);
    this.selection.name = 'selection';
    this.selection.visible = false;
    this.root.add(this.selection);

    this.addLights();
  }

  /**
   * The light rig: a sky over the room, a little ambient so nothing is black,
   * and a sun that casts. The shadow is the depth cue that makes a wall read
   * as standing on the floor rather than painted on it, and a token as
   * standing rather than floating; its camera is fitted to the map so the
   * whole room is inside it whatever the room's size.
   */
  private addLights(): void {
    this.scene.add(new AmbientLight(0xffffff, 0.3));
    this.scene.add(new HemisphereLight(new Color('#b9c7e0'), new Color('#2b2a26'), 0.55));

    const sun = new DirectionalLight(0xffffff, 1.35);
    // Low enough that a wall throws a shadow you can see, high enough that
    // the shadow does not cover the tile beside it: about fifty degrees up.
    sun.position.set(
      this.grid.width * 0.55,
      Math.max(this.grid.width, this.grid.height) * 0.6,
      this.grid.height * 0.5,
    );
    sun.castShadow = true;
    const extent = mapExtent(this.grid, this.layout);
    const reach = extent.radius * 1.1;
    sun.shadow.camera.left = -reach;
    sun.shadow.camera.right = reach;
    sun.shadow.camera.top = reach;
    sun.shadow.camera.bottom = -reach;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = extent.radius * 6;
    // 1024 is soft enough on a 22-tile room, and half the cost of the next
    // size up on the software GL the browser suite runs on.
    sun.shadow.mapSize.set(1024, 1024);
    // Flat-shaded boxes lit at a low angle acne without a bias along the normal.
    sun.shadow.normalBias = 0.03;
    sun.shadow.bias = -0.0005;
    this.sun = sun;
    this.scene.add(sun);
    // The light aims at its target, which lives at the origin unless it is in the scene.
    this.scene.add(sun.target);
  }

  /** The sun, for a test of the rig or a caller that wants to move it. */
  get sunlight(): DirectionalLight | null {
    return this.sun;
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
        const modelId = this.modelForEntity(entity);
        token = this.build(modelId, { palette: { ring: ringMaterial(ring) } });
        token.group.name = `token:${entity.id}`;
        this.tokens.set(entity.id, token);
        this.tokenModels.set(entity.id, modelId);
        this.root.add(token.group);
      }
      this.placeToken(token, entity);
    }

    for (const [id, token] of this.tokens) {
      if (seen.has(id)) continue;
      this.root.remove(token.group);
      this.tokens.delete(id);
      this.tokenModels.delete(id);
    }
    this.lastState = state;
  }

  /**
   * A model for an id: the imported asset when it is here, the procedural spec
   * otherwise. An asset that is declared but not yet loaded is requested and
   * the placeholder stands in until it arrives.
   */
  private build(modelId: string, options: BuildOptions = {}): BuiltModel {
    if (this.assets !== null && this.assets.has(modelId)) {
      const template = this.assets.template(modelId);
      if (template !== undefined) return this.instantiate(modelId, template, options);
      this.assets.request(modelId);
      // Declared and on its way is not "missing": stand in without recording a miss.
      const spec = this.registry.has(modelId) ? this.registry.get(modelId) : placeholderSpec;
      return buildModel(spec, this.resources, options);
    }
    return buildModel(this.registry.get(modelId), this.resources, options);
  }

  /** Clone a loaded glTF scene, scaled and seated as its asset spec says. */
  private instantiate(modelId: string, template: Object3D, options: BuildOptions): BuiltModel {
    const spec = this.assets!.spec(modelId)!;
    const group = new Group();
    group.name = `model:${modelId}`;
    // SkeletonUtils handles skinned meshes; for a plain scene it is a deep clone.
    const clone = cloneSkeleton(template);
    clone.scale.setScalar(spec.scale);
    clone.rotation.y = spec.rotationY;
    // A file with clips plays its first one on a loop — an idle, in every
    // sample set worth the name. Choosing clips per state is content's job later.
    const clip = template.animations[0];
    if (clip !== undefined) {
      const mixer = new AnimationMixer(clone);
      mixer.clipAction(clip).play();
      this.mixers.set(clone, mixer);
    }
    clone.traverse((child) => {
      if ((child as Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    group.add(clone);
    // The base ring the procedural tokens carry, so a faction still reads.
    const ring = options.palette?.['ring'];
    if (ring !== undefined) {
      const base = buildModel(RING_ONLY, this.resources, { palette: { ring } });
      group.add(base.group);
    }
    return {
      group,
      spec: { ...placeholderSpec, id: modelId, groundOffset: spec.groundOffset },
      named: new Map(),
      hooks: new Map(),
    };
  }

  /** Redraw whatever was drawn from an id whose asset just arrived or failed. */
  private assetChanged(id: string): void {
    let redraw = false;
    for (const modelId of this.tokenModels.values()) if (modelId === id) redraw = true;
    if (this.lastDecos.some((deco) => deco.model === id)) redraw = true;
    if (!redraw) return;
    for (const [entityId, modelId] of this.tokenModels) {
      if (modelId !== id) continue;
      const token = this.tokens.get(entityId);
      if (token !== undefined) this.root.remove(token.group);
      this.tokens.delete(entityId);
      this.tokenModels.delete(entityId);
    }
    if (this.lastState !== null) this.syncTokens(this.lastState);
    if (this.lastDecos.some((deco) => deco.model === id)) this.setDecos(this.lastDecos);
  }

  /** Advance every playing clip, and the selection's breathing. `dt` in seconds. */
  tick(dt: number): void {
    if (this.selection.visible) {
      this.breath += dt;
      const swell = 1 + 0.06 * Math.sin(this.breath * 3.5);
      this.selection.scale.set(swell, 1, swell);
      this.selectionMaterial.opacity = 0.75 + 0.2 * Math.sin(this.breath * 3.5);
    }
    for (const [object, mixer] of this.mixers) {
      // A clone whose group left the scene stops being driven.
      if (object.parent === null || object.parent.parent === null) {
        this.mixers.delete(object);
        continue;
      }
      mixer.update(dt);
    }
  }

  /** How many imported models are being animated. */
  get animationCount(): number {
    return this.mixers.size;
  }

  /** Whether an id is currently drawn from an imported file, the library, or the placeholder. */
  modelSource(modelId: string): 'asset' | 'library' | 'placeholder' {
    if (this.assets !== null && this.assets.has(modelId) && this.assets.template(modelId) !== undefined) return 'asset';
    return this.registry.has(modelId) ? 'library' : 'placeholder';
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

    this.lastDecos = decos;
    for (const deco of decos) {
      const tile = this.grid.indexOf(deco.position.x, deco.position.y);
      if (!this.grid.isTile(tile)) continue;
      const model = this.build(deco.model);
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

  /**
   * Paint the ground every standing zone holds, each in its own colour. Passing
   * an empty list clears it. Like the highlights, this rewrites instances in
   * place and never allocates.
   */
  showZones(zones: Iterable<{ tiles: Iterable<number>; color: string }>): void {
    let i = 0;
    const color = new Color();
    outer: for (const zone of zones) {
      color.set(zone.color);
      for (const tile of zone.tiles) {
        if (i >= this.maxHighlights) break outer;
        if (!this.grid.isTile(tile)) continue;
        const centre = tileCenter(this.grid, tile, this.layout);
        this.dummy.position.set(centre.x, surfaceHeight(this.grid.heightAt(tile), this.layout) + 0.012, centre.z);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.zoneLayer.setMatrixAt(i, this.dummy.matrix);
        this.zoneLayer.setColorAt(i, color);
        i++;
      }
    }
    this.zoneCount = i;
    this.zoneLayer.count = i;
    this.zoneLayer.instanceMatrix.needsUpdate = true;
    if (this.zoneLayer.instanceColor !== null) this.zoneLayer.instanceColor.needsUpdate = true;
  }

  /** How many tiles the zone layer is currently drawing. */
  get zonedCount(): number {
    return this.zoneCount;
  }

  clearZones(): void {
    this.showZones([]);
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

  /** Ring the tile of whoever is selected, or nobody for `NO_TILE`. */
  showSelection(tile: number): void {
    if (tile === this.selectionTile) return;
    this.selectionTile = tile;
    if (!this.grid.isTile(tile)) {
      this.selection.visible = false;
      return;
    }
    const centre = tileCenter(this.grid, tile, this.layout);
    this.selection.position.set(centre.x, surfaceHeight(this.grid.heightAt(tile), this.layout) + 0.035, centre.z);
    this.selection.visible = true;
  }

  /** The tile the selection ring is on, or `NO_TILE`. */
  get selectionAt(): number {
    return this.selectionTile;
  }

  dispose(): void {
    if (this.stopListening !== null) this.stopListening();
    for (const mixer of this.mixers.values()) mixer.stopAllAction();
    this.mixers.clear();
    this.terrain.dispose();
    this.highlightGeometry.dispose();
    this.highlightMaterial.dispose();
    this.highlight.dispose();
    this.zoneMaterial.dispose();
    this.zoneLayer.dispose();
    this.cursorMaterial.dispose();
    this.selectionGeometry.dispose();
    this.selectionMaterial.dispose();
    // A view is rebuilt on every scene switch; the shadow map is a texture the
    // renderer holds until told otherwise.
    this.sun?.shadow.map?.dispose();
    this.sun?.shadow.dispose();
    this.tokens.clear();
    this.decos.length = 0;
    // Shared caches outlive a scene unless this view created them.
    if (this.ownsResources) this.resources.dispose();
  }
}
