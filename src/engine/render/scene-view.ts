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
  AnimationAction,
  AnimationMixer,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  LoopOnce,
  LoopRepeat,
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

/** One token on its way from one tile to another. */
interface Glide {
  token: BuiltModel;
  /** Where it goes through, first point where it is now. */
  points: { x: number; y: number; z: number }[];
  elapsed: number;
  duration: number;
  /** How high it lifts between two points. */
  hop: number;
  thrown: boolean;
  /** The tile it ends on, so a ring can tell whose walk it is watching. */
  to: number;
}

/** What plays on a creature's imported model: the state each clip belongs to. */
type ClipState = 'idle' | 'walk' | 'hit' | 'fallen';

/** An imported model's clips, wired to the states the view moves it through. */
interface ClipSet {
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  /** The clip name for each state, where the asset named one. */
  states: Partial<Record<ClipState, string>>;
  /** The name of the clip playing now. */
  playing: string | null;
}

/** A token taking a blow, going down, getting up, or lunging at somebody. */
interface Reaction {
  token: BuiltModel;
  kind: 'flinch' | 'fall' | 'rise' | 'lunge';
  elapsed: number;
  duration: number;
  /** A lunge: the way to the target, unit length, and how far along it the token is right now. */
  toward?: { x: number; z: number };
  offset?: number;
}

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
  private _grid: TileGrid;
  /** The room being drawn. Replaced by `rebind`, never mutated here. */
  get grid(): TileGrid {
    return this._grid;
  }
  readonly layout: TileLayout;
  /** Everything the view owns, so a caller can add it to a scene of their own. */
  readonly root = new Group();
  terrain: TerrainMesh;
  private terrainOptions: TerrainMeshOptions;

  readonly registry: ModelRegistry;
  readonly resources: ModelResources;
  /** True when this view created the resources and should dispose them. */
  private readonly ownsResources: boolean;

  private readonly tokens = new Map<string, BuiltModel>();
  /** The tile each token was last drawn on, so a change is a move to animate. */
  private readonly tokenTiles = new Map<string, number>();
  /** Moves in flight, by entity. */
  private readonly glides = new Map<string, Glide>();
  /** Paths and throws registered for the next `syncTokens`, by entity. */
  private readonly pendingPaths = new Map<string, readonly number[]>();
  private readonly pendingThrows = new Set<string>();
  /** Whether each token was last drawn standing, so a fall is a change to animate. */
  private readonly tokenStanding = new Map<string, boolean>();
  /** Flinches and falls in progress, by entity. */
  private readonly reactions = new Map<string, Reaction>();
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
  /** The clips of each imported token, by its group, and what plays on it. */
  private readonly clipSets = new Map<Object3D, ClipSet>();
  private highlight: InstancedMesh;
  private readonly highlightGeometry: BoxGeometry;
  private readonly highlightMaterial: MeshBasicMaterial;
  /** Ground a spell holds: one quad per tile, coloured per zone, under the highlights. */
  private zoneLayer: InstancedMesh;
  private readonly zoneMaterial: MeshBasicMaterial;
  private zoneCount = 0;
  /** The edge of each zone, so a footprint reads as a shape and not as loose tiles. */
  private zoneEdges: LineSegments;
  private zoneEdgeGeometry: BufferGeometry;
  private readonly zoneEdgeMaterial: LineBasicMaterial;
  private zoneEdgeCount = 0;
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
  /** How many tiles the overlay layers have room for; grows with the biggest room seen. */
  private maxHighlights: number;
  private highlightCount = 0;
  private readonly dummy = new Object3D();
  private readonly factionColors: Readonly<Record<string, string>>;

  constructor(grid: TileGrid, options: SceneViewOptions = {}) {
    this._grid = grid;
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
    // A zone is painted below a highlight, so a walk previewed across a wall
    // of flame shows both: the ground it is, and the ground it could be.
    this.zoneMaterial = new MeshBasicMaterial({
      color: new Color('#ffffff'),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.zoneEdgeMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    ({ highlight: this.highlight, zoneLayer: this.zoneLayer, zoneEdges: this.zoneEdges, zoneEdgeGeometry: this.zoneEdgeGeometry } =
      this.buildOverlays(this.maxHighlights));

    this.cursorMaterial = new MeshBasicMaterial({
      color: new Color('#ffe08a'),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.cursor = new Mesh(this.highlightGeometry, this.cursorMaterial);
    this.cursor.name = 'cursor';
    this.cursor.visible = false;
    this.cursor.renderOrder = 4;
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
    this.selection.renderOrder = 5;
    this.root.add(this.selection);

    this.addLights();
  }

  /**
   * The overlay layers, sized for `capacity` tiles: the walk highlights, the
   * zone ground and the zone edges. Built once here and again by `rebind`
   * when a bigger room arrives; the materials and the quad geometry are the
   * view's own and outlive them.
   */
  private buildOverlays(capacity: number): {
    highlight: InstancedMesh;
    zoneLayer: InstancedMesh;
    zoneEdges: LineSegments;
    zoneEdgeGeometry: BufferGeometry;
  } {
    const room = Math.max(1, capacity);
    const highlight = new InstancedMesh(this.highlightGeometry, this.highlightMaterial, room);
    highlight.name = 'highlights';
    highlight.count = 0;
    highlight.frustumCulled = false;

    const zoneLayer = new InstancedMesh(this.highlightGeometry, this.zoneMaterial, room);
    zoneLayer.name = 'zones';
    zoneLayer.count = 0;
    zoneLayer.frustumCulled = false;

    // Room for four edges on every tile, allocated once; `showZones` writes
    // into it and sets the draw range, the way the instanced layers do.
    const edgeCapacity = room * 4 * 2;
    const zoneEdgeGeometry = new BufferGeometry();
    zoneEdgeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(edgeCapacity * 3), 3));
    zoneEdgeGeometry.setAttribute('color', new BufferAttribute(new Float32Array(edgeCapacity * 3), 3));
    zoneEdgeGeometry.setDrawRange(0, 0);
    const zoneEdges = new LineSegments(zoneEdgeGeometry, this.zoneEdgeMaterial);
    zoneEdges.name = 'zone-edges';
    zoneEdges.frustumCulled = false;

    // The overlays are all transparent and none writes depth, so their order
    // is decided here rather than by whichever happens to be nearer the
    // camera: ground first, the edge over it, then the walk, the pointer,
    // and the ring round the selected on top of everything.
    zoneLayer.renderOrder = 1;
    zoneEdges.renderOrder = 2;
    highlight.renderOrder = 3;
    this.root.add(zoneLayer, zoneEdges, highlight);
    return { highlight, zoneLayer, zoneEdges, zoneEdgeGeometry };
  }

  /**
   * Draw another room with this view.
   *
   * Travelling used to build a whole new view - lights, caches, every model
   * again - and let the old one go. What a room actually changes is the
   * ground, the scenery, and where the sun has to reach: the terrain is
   * rebuilt for the new grid, the decos replaced, the sun refitted, the
   * overlays cleared (and grown, if this room is the biggest yet). Tokens
   * are kept for whoever is still there - the party walked in - but forget
   * where they were drawn, so the next `syncTokens` puts them down outright
   * rather than gliding them in from the other room's coordinates.
   */
  rebind(grid: TileGrid, options: { tints?: readonly string[]; decos?: readonly Deco[] } = {}): void {
    this.settle();
    this._grid = grid;
    this.terrainOptions = { ...this.terrainOptions, ...(options.tints === undefined ? {} : { tints: options.tints }) };
    this.rebuildTerrain(options.tints);

    if (grid.size > this.maxHighlights) {
      this.root.remove(this.highlight, this.zoneLayer, this.zoneEdges);
      this.highlight.dispose();
      this.zoneLayer.dispose();
      this.zoneEdgeGeometry.dispose();
      this.maxHighlights = grid.size;
      ({ highlight: this.highlight, zoneLayer: this.zoneLayer, zoneEdges: this.zoneEdges, zoneEdgeGeometry: this.zoneEdgeGeometry } =
        this.buildOverlays(this.maxHighlights));
      this.highlightCount = 0;
      this.zoneCount = 0;
      this.zoneEdgeCount = 0;
    } else {
      this.clearHighlights();
      this.clearZones();
    }
    this.showCursor(NO_TILE);
    this.showSelection(NO_TILE);
    this.fitSun();

    this.tokenTiles.clear();
    this.tokenStanding.clear();
    this.setDecos(options.decos ?? []);
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
    sun.castShadow = true;
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
    this.fitSun();
  }

  /** Put the sun where this room wants it, with its shadow camera round the whole room. */
  private fitSun(): void {
    const sun = this.sun;
    if (sun === null) return;
    // Low enough that a wall throws a shadow you can see, high enough that
    // the shadow does not cover the tile beside it: about fifty degrees up.
    sun.position.set(
      this.grid.width * 0.55,
      Math.max(this.grid.width, this.grid.height) * 0.6,
      this.grid.height * 0.5,
    );
    const extent = mapExtent(this.grid, this.layout);
    const reach = extent.radius * 1.1;
    sun.shadow.camera.left = -reach;
    sun.shadow.camera.right = reach;
    sun.shadow.camera.top = reach;
    sun.shadow.camera.bottom = -reach;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = extent.radius * 6;
    sun.shadow.camera.updateProjectionMatrix();
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
  syncTokens(state: SceneState, options: { snap?: boolean } = {}): void {
    const seen = new Set<string>();

    for (const entity of state.allEntities()) {
      seen.add(entity.id);
      let token = this.tokens.get(entity.id);
      const was = this.tokenTiles.get(entity.id);
      const path = this.pendingPaths.get(entity.id);
      this.pendingPaths.delete(entity.id);
      const thrown = this.pendingThrows.delete(entity.id);
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
      // A token already standing somewhere on the board that is now somewhere
      // else walks there; anything else - new, off the board, told to snap -
      // is simply put where it is.
      const moved = was !== undefined && was !== entity.tile && this.grid.isTile(was) && this.grid.isTile(entity.tile);
      if (moved && options.snap !== true) {
        this.poseToken(token, entity);
        this.startGlide(entity.id, token, was, entity.tile, path, thrown);
      } else {
        this.glides.delete(entity.id);
        this.placeToken(token, entity);
      }
      this.tokenTiles.set(entity.id, entity.tile);
      // Standing to lying, or back, is a fall or a rise; a token first seen
      // lying is simply lying.
      const stood = this.tokenStanding.get(entity.id);
      if (stood !== undefined && stood !== entity.alive) {
        if (options.snap !== true && this.grid.isTile(entity.tile)) {
          this.startReaction(entity.id, token, entity.alive ? 'rise' : 'fall');
        } else {
          this.reactions.delete(entity.id);
          token.group.rotation.x = entity.alive ? 0 : -Math.PI / 2;
        }
      }
      this.tokenStanding.set(entity.id, entity.alive);
    }

    for (const [id, token] of this.tokens) {
      if (seen.has(id)) continue;
      this.root.remove(token.group);
      this.clipSets.delete(token.group);
      this.tokens.delete(id);
      this.tokenModels.delete(id);
      this.tokenTiles.delete(id);
      this.tokenStanding.delete(id);
      this.glides.delete(id);
      this.reactions.delete(id);
    }
    this.lastState = state;
  }

  /** A blow landed on this creature: its token takes it, now. */
  flinch(id: string): void {
    const token = this.tokens.get(id);
    if (token === undefined || !token.group.visible) return;
    this.startReaction(id, token, 'flinch');
  }

  /** This creature swung at that tile: its token lunges that way and back. */
  lunge(id: string, at: number): void {
    const token = this.tokens.get(id);
    if (token === undefined || !token.group.visible || !this.grid.isTile(at)) return;
    const there = tileCenter(this.grid, at, this.layout);
    const dx = there.x - token.group.position.x;
    const dz = there.z - token.group.position.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    this.startReaction(id, token, 'lunge', { x: dx / length, z: dz / length });
  }

  /** How many tokens are flinching, falling, getting up or lunging. */
  get reactingCount(): number {
    return this.reactions.size;
  }

  private startReaction(id: string, token: BuiltModel, kind: Reaction['kind'], toward?: { x: number; z: number }): void {
    // A fall or a rise replaces anything, and nothing replaces it: the body
    // going down is the thing to see.
    const current = this.reactions.get(id);
    if (current !== undefined) {
      if ((current.kind === 'fall' || current.kind === 'rise') && kind !== 'fall' && kind !== 'rise') return;
      this.finishReaction(current);
    }
    const duration = kind === 'flinch' ? 0.35 : kind === 'lunge' ? 0.3 : 0.45;
    this.reactions.set(id, { token, kind, elapsed: 0, duration, ...(toward === undefined ? {} : { toward, offset: 0 }) });
    if (kind === 'flinch') this.playState(token.group, 'hit');
    else if (kind === 'fall') this.playState(token.group, 'fallen');
    else if (kind === 'rise') this.playState(token.group, 'idle');
  }

  /** Move every reaction on by `dt` seconds. */
  private advanceReactions(dt: number): void {
    for (const [id, reaction] of this.reactions) {
      reaction.elapsed += dt;
      const t = Math.min(1, reaction.elapsed / reaction.duration);
      const group = reaction.token.group;
      if (reaction.kind === 'flinch') {
        // A quick swell and a lean, both gone by the end.
        const pulse = Math.sin(Math.PI * t);
        const swell = 1 + 0.18 * pulse;
        group.scale.set(swell, 1 + 0.08 * pulse, swell);
        group.rotation.z = 0.22 * Math.sin(2 * Math.PI * t) * (1 - t);
      } else if (reaction.kind === 'lunge') {
        // Out fast, back slower, a third of a tile at the furthest. Applied as
        // the change since last tick, so a walk under it is left alone.
        const reach = this.layout.tileSize * 0.35 * Math.sin(Math.PI * Math.pow(t, 0.7));
        const delta = reach - (reaction.offset ?? 0);
        group.position.x += reaction.toward!.x * delta;
        group.position.z += reaction.toward!.z * delta;
        reaction.offset = reach;
      } else {
        // A body drops: slow to start, quick to land. Getting up is the reverse.
        const eased = t * t;
        group.rotation.x = reaction.kind === 'fall' ? -eased * (Math.PI / 2) : -(1 - eased) * (Math.PI / 2);
      }
      if (t >= 1) {
        this.finishReaction(reaction);
        this.reactions.delete(id);
      }
    }
  }

  private finishReaction(reaction: Reaction): void {
    const group = reaction.token.group;
    if (reaction.kind === 'flinch') {
      group.scale.set(1, 1, 1);
      group.rotation.z = 0;
      // Back to the idle, or to the walk if one is still under way.
      const walking = [...this.glides.values()].some((glide) => glide.token === reaction.token && !glide.thrown);
      this.playState(group, walking ? 'walk' : 'idle');
    } else if (reaction.kind === 'lunge') {
      // Whatever is still leaned out comes back.
      group.position.x -= reaction.toward!.x * (reaction.offset ?? 0);
      group.position.z -= reaction.toward!.z * (reaction.offset ?? 0);
      reaction.offset = 0;
    } else {
      group.rotation.x = reaction.kind === 'fall' ? -Math.PI / 2 : 0;
    }
  }

  /**
   * The path an entity is about to be found to have walked, tile by tile
   * from the one it left. Read by the next `syncTokens`, which sends the
   * token along it; without one, a moved token glides straight there.
   */
  walk(id: string, path: readonly number[]): void {
    this.pendingPaths.set(id, path);
  }

  /** The entity is about to be found somewhere it was thrown, not somewhere it went. */
  throwBack(id: string): void {
    this.pendingThrows.add(id);
  }

  /** Put every moving token where it is going, and every reacting one at rest, now. */
  settle(): void {
    for (const [id, glide] of this.glides) {
      const end = glide.points[glide.points.length - 1]!;
      glide.token.group.position.set(end.x, end.y, end.z);
      this.glides.delete(id);
      this.playState(glide.token.group, 'idle');
    }
    for (const [id, reaction] of this.reactions) {
      this.finishReaction(reaction);
      this.reactions.delete(id);
    }
  }

  /** How many tokens are on their way somewhere. */
  get glidingCount(): number {
    return this.glides.size;
  }

  /** Whether this one is on its way somewhere. */
  isGliding(id: string): boolean {
    return this.glides.has(id);
  }

  /**
   * Send a token from one tile to another: along the path when there is one
   * and it joins the two, straight otherwise. A walk takes a fixed time per
   * tile and hops a little on each; a throw is one quick arc. The engine's
   * truth never waits on this - `state` already has the creature there.
   */
  private startGlide(id: string, token: BuiltModel, from: number, to: number, path: readonly number[] | undefined, thrown: boolean): void {
    const lift = token.spec.groundOffset ?? 0;
    const at = (tile: number): { x: number; y: number; z: number } => {
      const centre = tileCenter(this.grid, tile, this.layout);
      return { x: centre.x, y: centre.y + lift, z: centre.z };
    };
    const joins = path !== undefined && path.length >= 2 && path[0] === from && path[path.length - 1] === to;
    const tiles = joins ? path : [from, to];
    // Continue from wherever the token is, so a second move mid-glide does not jump back.
    const start = token.group.position;
    const points = tiles.map(at);
    points[0] = { x: start.x, y: start.y, z: start.z };
    // A fixed time per tile whether the walk is a path or a straight line:
    // a follower crossing five tiles in one segment takes five tiles' worth.
    const crossed = joins ? points.length - 1 : Math.max(1, this.grid.chebyshevDistance(from, to));
    const duration = thrown ? 0.25 : Math.min(1.2, 0.16 * crossed);
    this.glides.set(id, { token, points, elapsed: 0, duration, hop: thrown ? 0.35 : 0.12, thrown, to });
    if (!thrown) this.playState(token.group, 'walk');
  }

  /** Move every glide on by `dt` seconds. */
  private advanceGlides(dt: number): void {
    for (const [id, glide] of this.glides) {
      glide.elapsed += dt;
      const t = Math.min(1, glide.elapsed / glide.duration);
      // A throw slows into its landing; a walk keeps its pace.
      const eased = glide.thrown ? 1 - (1 - t) * (1 - t) : t;
      const segments = glide.points.length - 1;
      const along = eased * segments;
      const i = Math.min(segments - 1, Math.floor(along));
      const frac = along - i;
      const a = glide.points[i]!;
      const b = glide.points[i + 1]!;
      const hop = glide.hop * Math.sin(Math.PI * frac);
      glide.token.group.position.set(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac + hop, a.z + (b.z - a.z) * frac);
      if (t >= 1) {
        const end = glide.points[segments]!;
        glide.token.group.position.set(end.x, end.y, end.z);
        this.glides.delete(id);
        this.playState(glide.token.group, 'idle');
      }
    }
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
    // A file with clips plays one on a loop - the one the asset names as its
    // idle, or the first in the file, which is the idle in every sample set
    // worth the name. The others play where the view walks, hits or fells it.
    if (template.animations.length > 0) {
      const mixer = new AnimationMixer(clone);
      const actions = new Map<string, AnimationAction>();
      for (const clip of template.animations) actions.set(clip.name, mixer.clipAction(clip));
      const named = spec.clips ?? {};
      const idle = named.idle !== undefined && actions.has(named.idle) ? named.idle : template.animations[0]!.name;
      const set: ClipSet = {
        mixer,
        actions,
        states: {
          idle,
          ...(named.walk === undefined ? {} : { walk: named.walk }),
          ...(named.hit === undefined ? {} : { hit: named.hit }),
          ...(named.fallen === undefined ? {} : { fallen: named.fallen }),
        },
        playing: null,
      };
      this.mixers.set(clone, mixer);
      this.clipSets.set(group, set);
      this.playClip(set, 'idle');
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

  /**
   * Put an imported model into a state: its clip for that state, if it named
   * one, faded in over whatever was playing. A hit plays once and hands back
   * to the idle when the flinch ends; a fall plays once and stays on its last
   * frame. A state with no clip keeps what is playing.
   */
  private playState(group: Object3D, state: ClipState): void {
    const set = this.clipSets.get(group);
    if (set !== undefined) this.playClip(set, state);
  }

  private playClip(set: ClipSet, state: ClipState): void {
    const name = set.states[state];
    if (name === undefined) return;
    const next = set.actions.get(name);
    if (next === undefined) return;
    if (set.playing === name && state !== 'hit') return;
    const current = set.playing === null ? undefined : set.actions.get(set.playing);
    if (current !== undefined && current !== next) current.fadeOut(0.15);
    next.reset();
    if (state === 'hit' || state === 'fallen') {
      next.setLoop(LoopOnce, 1);
      next.clampWhenFinished = state === 'fallen';
    } else {
      next.setLoop(LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.fadeIn(0.15).play();
    set.playing = name;
  }

  /** The clip playing on a creature's imported model, or nothing for a procedural one. */
  clipOf(entityId: string): string | null {
    const token = this.tokens.get(entityId);
    if (token === undefined) return null;
    return this.clipSets.get(token.group)?.playing ?? null;
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
      if (token !== undefined) {
        this.root.remove(token.group);
        this.clipSets.delete(token.group);
      }
      this.tokens.delete(entityId);
      this.tokenModels.delete(entityId);
    }
    if (this.lastState !== null) this.syncTokens(this.lastState);
    if (this.lastDecos.some((deco) => deco.model === id)) this.setDecos(this.lastDecos);
  }

  /** Advance every playing clip, every moving token, and the selection's breathing. `dt` in seconds. */
  tick(dt: number): void {
    this.advanceGlides(dt);
    this.advanceReactions(dt);
    if (this.selection.visible) {
      // The ring marks the selected creature's tile, and while their token is
      // still walking there it walks with the token rather than waiting ahead.
      const walking = [...this.glides.values()].find((glide) => glide.to === this.selectionTile);
      const centre = tileCenter(this.grid, this.selectionTile, this.layout);
      if (walking !== undefined) {
        this.selection.position.x = walking.token.group.position.x;
        this.selection.position.z = walking.token.group.position.z;
      } else {
        this.selection.position.x = centre.x;
        this.selection.position.z = centre.z;
      }
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
    if (!this.poseToken(token, entity)) return;
    const centre = tileCenter(this.grid, entity.tile, this.layout);
    const lift = token.spec.groundOffset ?? 0;
    token.group.position.set(centre.x, centre.y + lift, centre.z);
  }

  /** Everything about a token but where it is: shown or not, standing or lying. */
  private poseToken(token: BuiltModel, entity: EntityState): boolean {
    const group = token.group;
    if (!this.grid.isTile(entity.tile)) {
      group.visible = false;
      return false;
    }
    group.visible = true;
    // A fallen creature lies down rather than vanishing; the engine keeps its
    // body. A change from what was drawn is animated by `syncTokens`, which
    // reads the standing map after this; here only a token with no history,
    // or one whose fall is not in progress, is posed outright.
    if (!this.reactions.has(entity.id) && this.tokenStanding.get(entity.id) === undefined) {
      group.rotation.set(entity.alive ? 0 : -Math.PI / 2, 0, 0);
    }
    return true;
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
    let edges = 0;
    const color = new Color();
    const positions = this.zoneEdgeGeometry.getAttribute('position') as BufferAttribute;
    const colors = this.zoneEdgeGeometry.getAttribute('color') as BufferAttribute;
    const half = this.layout.tileSize / 2;
    outer: for (const zone of zones) {
      color.set(zone.color);
      const held = new Set<number>();
      for (const tile of zone.tiles) if (this.grid.isTile(tile)) held.add(tile);
      for (const tile of held) {
        if (i >= this.maxHighlights) break outer;
        const centre = tileCenter(this.grid, tile, this.layout);
        const top = surfaceHeight(this.grid.heightAt(tile), this.layout);
        this.dummy.position.set(centre.x, top + 0.012, centre.z);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.zoneLayer.setMatrixAt(i, this.dummy.matrix);
        this.zoneLayer.setColorAt(i, color);
        i++;
        // A side with no tile of the same zone beyond it is the zone's edge.
        const x = this.grid.xOf(tile);
        const y = this.grid.yOf(tile);
        const sides: [number, number, [number, number], [number, number]][] = [
          [x, y - 1, [-half, -half], [half, -half]],
          [x + 1, y, [half, -half], [half, half]],
          [x, y + 1, [half, half], [-half, half]],
          [x - 1, y, [-half, half], [-half, -half]],
        ];
        for (const [nx, ny, a, b] of sides) {
          if (this.grid.inBounds(nx, ny) && held.has(this.grid.indexOf(nx, ny))) continue;
          if (edges * 2 + 1 >= positions.count) break;
          const v = edges * 2;
          positions.setXYZ(v, centre.x + a[0], top + 0.02, centre.z + a[1]);
          positions.setXYZ(v + 1, centre.x + b[0], top + 0.02, centre.z + b[1]);
          colors.setXYZ(v, color.r, color.g, color.b);
          colors.setXYZ(v + 1, color.r, color.g, color.b);
          edges++;
        }
      }
    }
    this.zoneCount = i;
    this.zoneLayer.count = i;
    this.zoneLayer.instanceMatrix.needsUpdate = true;
    if (this.zoneLayer.instanceColor !== null) this.zoneLayer.instanceColor.needsUpdate = true;
    this.zoneEdgeCount = edges;
    this.zoneEdgeGeometry.setDrawRange(0, edges * 2);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  /** How many edge segments the zone outlines are currently drawing. */
  get zoneEdgeSegments(): number {
    return this.zoneEdgeCount;
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
    this.clipSets.clear();
    this.terrain.dispose();
    this.highlightGeometry.dispose();
    this.highlightMaterial.dispose();
    this.highlight.dispose();
    this.zoneMaterial.dispose();
    this.zoneLayer.dispose();
    this.zoneEdgeGeometry.dispose();
    this.zoneEdgeMaterial.dispose();
    this.cursorMaterial.dispose();
    this.selectionGeometry.dispose();
    this.selectionMaterial.dispose();
    // A view is rebuilt on every scene switch; the shadow map is a texture the
    // renderer holds until told otherwise.
    this.sun?.shadow.map?.dispose();
    this.sun?.shadow.dispose();
    this.tokens.clear();
    this.tokenTiles.clear();
    this.tokenStanding.clear();
    this.glides.clear();
    this.reactions.clear();
    this.decos.length = 0;
    // Shared caches outlive a scene unless this view created them.
    if (this.ownsResources) this.resources.dispose();
  }
}
