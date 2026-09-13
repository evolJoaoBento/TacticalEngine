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
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Line,
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
import { NO_TILE, type Spot, type TileGrid } from '../grid/grid';
import { lineLength } from '../grid/walk';
import type { Deco, SceneDoc } from '../scene/schema';
import type { EntityState, SceneState } from '../scene/state';
import { DEFAULT_LAYOUT, mapExtent, spotToWorld, surfaceHeight, tileCenter, type TileLayout } from './layout';
import { ModelResources, buildModel, type BuildOptions, type BuiltModel } from './procedural/build';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetLibrary } from './assets';
import type { ProceduralModelSpec } from './procedural/spec';
import { placeholder as placeholderSpec } from './procedural/registry';

/** One token on its way from one tile to another. */
/** Points the hover path has room for: a long walk cut at half a tile. */
const PATH_CAPACITY = 1024;
/** The walk's own blue, and the red of the way a fight's move does not cover. */
const PATH_WALK = new Color('#69d2ff');
const PATH_BEYOND = new Color('#ff6a5c');
/** The part past one move that a run would cover: Movement Under Pressure, an Agility Roll away. */
const PATH_RUN = new Color('#ffc14d');

interface Glide {
  token: BuiltModel;
  /** Where it goes through, first point where it is now. */
  points: { x: number; y: number; z: number }[];
  /** Distance along the line at each point, and the whole of it. */
  cumulative: number[];
  total: number;
  elapsed: number;
  duration: number;
  /** How high it lifts: once per tile of a walk, once over the whole of a throw. */
  hop: number;
  thrown: boolean;
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
  /**
   * A body to draw for a creature whose own model nothing can supply, or `null`
   * to let the magenta placeholder stand there instead.
   *
   * Most of the SRD's stat blocks have no art yet, and a board of magenta
   * markers is unreadable. Substituting is a *drawing* decision, though, not a
   * resolution: the registry is still asked for the real id, so `missing()`
   * lists it and `modelSource()` says `fallback:<what was drawn>`. The editor's
   * model diagnostic stays honest about what is still to be made.
   */
  fallbackFor?: (entity: Pick<EntityState, 'definition' | 'faction'>) => string | null;
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
  /** The spot each token was last drawn at, so a change is a move to animate. */
  private readonly tokenSpots = new Map<string, Spot>();
  /** Moves in flight, by entity. */
  private readonly glides = new Map<string, Glide>();
  /** Paths, lines and throws registered for the next `syncTokens`, by entity. */
  private readonly pendingPaths = new Map<string, readonly number[]>();
  private readonly pendingRoutes = new Map<string, readonly Spot[]>();
  private readonly pendingThrows = new Set<string>();
  /** Whether each token was last drawn standing, so a fall is a change to animate. */
  private readonly tokenStanding = new Map<string, boolean>();
  /** Flinches and falls in progress, by entity. */
  private readonly reactions = new Map<string, Reaction>();
  private readonly decos: Group[] = [];
  private readonly authoredCreatures: Group[] = [];
  private authoring = false;
  private readonly modelForEntity: (entity: EntityState) => string;
  private readonly fallbackFor: (entity: Pick<EntityState, 'definition' | 'faction'>) => string | null;
  /** What was drawn in place of each id nothing could supply, for `modelSource`. */
  private readonly fallbacks = new Map<string, string>();
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
  /** The edge of the lit ground, so a walk reads as an area with a border and not as tiles. */
  private highlightEdges: LineSegments;
  private highlightEdgeGeometry: BufferGeometry;
  private readonly highlightEdgeMaterial: LineBasicMaterial;
  private highlightEdgeCount = 0;
  /** Ground a spell holds: one quad per tile, coloured per zone, under the highlights. */
  private zoneLayer: InstancedMesh;
  private readonly zoneMaterial: MeshBasicMaterial;
  private zoneCount = 0;
  /** The edge of each zone, so a footprint reads as a shape and not as loose tiles. */
  private zoneEdges: LineSegments;
  private zoneEdgeGeometry: BufferGeometry;
  private readonly zoneEdgeMaterial: LineBasicMaterial;
  private zoneEdgeCount = 0;
  /** The line a click would walk, drawn on the ground as the pointer moves: what this move covers, then what lies beyond it. */
  private readonly pathLine: Line;
  private readonly pathGeometry: BufferGeometry;
  private readonly pathMaterial: LineBasicMaterial;
  private pathPoints = 0;
  /** The spot under the pointer: a soft disc, a different colour, or hidden. */
  private readonly cursor: Mesh;
  private readonly cursorGeometry: CircleGeometry;
  private readonly cursorMaterial: MeshBasicMaterial;
  private cursorTile = NO_TILE;
  /** A ring round whoever is selected, breathing so the eye finds it. */
  private readonly selection: Mesh;
  private readonly selectionGeometry: RingGeometry;
  private readonly selectionMaterial: MeshBasicMaterial;
  private selectionTile = NO_TILE;
  /** Whose token the ring stands under, when it is somebody's rather than a tile's. */
  private selectionId: string | null = null;
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
    // Nothing stands in by default: a caller that wants a body rather than the
    // placeholder says so, and takes the honest `missing()` entry with it.
    this.fallbackFor = options.fallbackFor ?? ((): string | null => null);

    this.scene.background = new Color('#0d0f14');
    this.scene.add(this.root);

    this.terrainOptions = options;
    this.terrain = buildTerrainMesh(grid, options);
    for (const mesh of this.terrain.meshes) this.root.add(mesh);

    // One flat quad per lit tile, hovering just above the surface, the full
    // width of the tile: the quads meet without a seam, so what is lit reads
    // as one piece of ground, and the edge drawn round it is the only line.
    this.highlightGeometry = new BoxGeometry(this.layout.tileSize, 0.02, this.layout.tileSize);
    this.highlightMaterial = new MeshBasicMaterial({
      color: new Color('#69d2ff'),
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    this.highlightEdgeMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
    // A zone is painted below a highlight, so a walk previewed across a wall
    // of flame shows both: the ground it is, and the ground it could be.
    this.zoneMaterial = new MeshBasicMaterial({
      color: new Color('#ffffff'),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.zoneEdgeMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    ({
      highlight: this.highlight,
      highlightEdges: this.highlightEdges,
      highlightEdgeGeometry: this.highlightEdgeGeometry,
      zoneLayer: this.zoneLayer,
      zoneEdges: this.zoneEdges,
      zoneEdgeGeometry: this.zoneEdgeGeometry,
    } = this.buildOverlays(this.maxHighlights));

    // The hover path: room for a long walk cut at half a tile, drawn once and
    // rewritten in place. Two colours along one line - the walk, then the
    // rest of the way a fight's move does not cover.
    this.pathGeometry = new BufferGeometry();
    this.pathGeometry.setAttribute('position', new BufferAttribute(new Float32Array(PATH_CAPACITY * 3), 3));
    this.pathGeometry.setAttribute('color', new BufferAttribute(new Float32Array(PATH_CAPACITY * 3), 3));
    this.pathGeometry.setDrawRange(0, 0);
    this.pathMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    this.pathLine = new Line(this.pathGeometry, this.pathMaterial);
    this.pathLine.name = 'path';
    this.pathLine.frustumCulled = false;
    this.pathLine.visible = false;
    this.pathLine.renderOrder = 5;
    this.root.add(this.pathLine);

    // A disc rather than a square: the pointer marks a spot on the ground,
    // not a cell of it.
    this.cursorGeometry = new CircleGeometry(this.layout.tileSize * 0.4, 32);
    this.cursorGeometry.rotateX(-Math.PI / 2);
    this.cursorMaterial = new MeshBasicMaterial({
      color: new Color('#ffe08a'),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.cursor = new Mesh(this.cursorGeometry, this.cursorMaterial);
    this.cursor.name = 'cursor';
    this.cursor.visible = false;
    this.cursor.renderOrder = 6;
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
    this.selection.renderOrder = 7;
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
    highlightEdges: LineSegments;
    highlightEdgeGeometry: BufferGeometry;
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

    // Room for four edges on every tile, allocated once; the painters write
    // into it and set the draw range, the way the instanced layers do.
    const edgeGeometry = (): BufferGeometry => {
      const edgeCapacity = room * 4 * 2;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(edgeCapacity * 3), 3));
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(edgeCapacity * 3), 3));
      geometry.setDrawRange(0, 0);
      return geometry;
    };
    const zoneEdgeGeometry = edgeGeometry();
    const zoneEdges = new LineSegments(zoneEdgeGeometry, this.zoneEdgeMaterial);
    zoneEdges.name = 'zone-edges';
    zoneEdges.frustumCulled = false;
    const highlightEdgeGeometry = edgeGeometry();
    const highlightEdges = new LineSegments(highlightEdgeGeometry, this.highlightEdgeMaterial);
    highlightEdges.name = 'highlight-edges';
    highlightEdges.frustumCulled = false;

    // The overlays are all transparent and none writes depth, so their order
    // is decided here rather than by whichever happens to be nearer the
    // camera: ground first, the edge over it, then the walk and its edge,
    // the pointer, and the ring round the selected on top of everything.
    zoneLayer.renderOrder = 1;
    zoneEdges.renderOrder = 2;
    highlight.renderOrder = 3;
    highlightEdges.renderOrder = 4;
    this.root.add(zoneLayer, zoneEdges, highlight, highlightEdges);
    return { highlight, highlightEdges, highlightEdgeGeometry, zoneLayer, zoneEdges, zoneEdgeGeometry };
  }

  /**
   * Draw the border of a set of tiles into an edge geometry, from segment
   * `from` on: a side with no tile of the same set beyond it is the edge.
   * Returns how many segments the geometry now holds. What makes a footprint
   * read as a shape rather than as loose squares.
   */
  private outline(held: ReadonlySet<number>, color: Color, geometry: BufferGeometry, from: number): number {
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const colors = geometry.getAttribute('color') as BufferAttribute;
    const half = this.layout.tileSize / 2;
    let edges = from;
    for (const tile of held) {
      const centre = tileCenter(this.grid, tile, this.layout);
      const top = surfaceHeight(this.grid.heightAt(tile), this.layout);
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
        if (edges * 2 + 1 >= positions.count) return edges;
        const v = edges * 2;
        positions.setXYZ(v, centre.x + a[0], top + 0.03, centre.z + a[1]);
        positions.setXYZ(v + 1, centre.x + b[0], top + 0.03, centre.z + b[1]);
        colors.setXYZ(v, color.r, color.g, color.b);
        colors.setXYZ(v + 1, color.r, color.g, color.b);
        edges++;
      }
    }
    return edges;
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
      this.root.remove(this.highlight, this.highlightEdges, this.zoneLayer, this.zoneEdges);
      this.highlight.dispose();
      this.highlightEdgeGeometry.dispose();
      this.zoneLayer.dispose();
      this.zoneEdgeGeometry.dispose();
      this.maxHighlights = grid.size;
      ({
        highlight: this.highlight,
        highlightEdges: this.highlightEdges,
        highlightEdgeGeometry: this.highlightEdgeGeometry,
        zoneLayer: this.zoneLayer,
        zoneEdges: this.zoneEdges,
        zoneEdgeGeometry: this.zoneEdgeGeometry,
      } = this.buildOverlays(this.maxHighlights));
      this.highlightCount = 0;
      this.highlightEdgeCount = 0;
      this.zoneCount = 0;
      this.zoneEdgeCount = 0;
    } else {
      this.clearHighlights();
      this.clearZones();
    }
    this.showCursor(NO_TILE);
    this.showSelection(NO_TILE);
    this.clearPath();
    this.fitSun();

    this.tokenSpots.clear();
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
      const was = this.tokenSpots.get(entity.id);
      const path = this.pendingPaths.get(entity.id);
      this.pendingPaths.delete(entity.id);
      const route = this.pendingRoutes.get(entity.id);
      this.pendingRoutes.delete(entity.id);
      const thrown = this.pendingThrows.delete(entity.id);
      if (token === undefined) {
        // The base ring carries the faction colour, so one spec serves both sides.
        const ring = this.factionColors[entity.faction] ?? DEFAULT_FACTION_COLORS['neutral']!;
        const modelId = this.drawnModel(this.modelForEntity(entity), entity);
        token = this.build(modelId, { palette: { ring: ringMaterial(ring) } });
        token.group.name = `token:${entity.id}`;
        this.tokens.set(entity.id, token);
        this.tokenModels.set(entity.id, modelId);
        this.root.add(token.group);
      }
      // A token already standing somewhere on the board that is now somewhere
      // else - another spot, however close - walks there; anything else - new,
      // off the board, told to snap - is simply put where it is.
      const here = entity.at;
      const moved =
        was !== undefined &&
        this.grid.isTile(this.grid.tileAtSpot(was.x, was.y)) &&
        this.grid.isTile(entity.tile) &&
        (Math.abs(was.x - here.x) > 1e-9 || Math.abs(was.y - here.y) > 1e-9);
      if (moved && options.snap !== true) {
        this.poseToken(token, entity);
        this.startGlide(entity.id, token, was, here, path, route, thrown);
      } else {
        this.glides.delete(entity.id);
        this.placeToken(token, entity);
      }
      this.tokenSpots.set(entity.id, { x: here.x, y: here.y });
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
      if (this.authoring) token.group.visible = false;
    }

    for (const [id, token] of this.tokens) {
      if (seen.has(id)) continue;
      this.root.remove(token.group);
      this.clipSets.delete(token.group);
      this.tokens.delete(id);
      this.tokenModels.delete(id);
      this.tokenSpots.delete(id);
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

  /** The entity is about to be found at the end of this line, having crossed it. */
  walkAlong(id: string, route: readonly Spot[]): void {
    this.pendingRoutes.set(id, route);
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
  private startGlide(
    id: string,
    token: BuiltModel,
    from: Spot,
    to: Spot,
    path: readonly number[] | undefined,
    route: readonly Spot[] | undefined,
    thrown: boolean,
  ): void {
    const lift = token.spec.groundOffset ?? 0;
    const fromTile = this.grid.tileAtSpot(from.x, from.y);
    const toTile = this.grid.tileAtSpot(to.x, to.y);
    // The line it crosses: the one it was handed, else the path's centres
    // from where it stood to where it stands, else straight.
    let spots: Spot[];
    if (route !== undefined && route.length >= 2) spots = [...route];
    else if (path !== undefined && path.length >= 2 && path[0] === fromTile && path[path.length - 1] === toTile) {
      spots = path.map((tile) => this.grid.spotOf(tile));
      spots[0] = from;
      spots[spots.length - 1] = to;
    } else spots = [from, to];
    // Every leg cut at most half a tile long, so the height follows the
    // ground under the line rather than jumping at each corner.
    const points: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i + 1 < spots.length; i++) {
      const a = spots[i]!;
      const b = spots[i + 1]!;
      const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
      for (let k = i === 0 ? 0 : 1; k <= pieces; k++) {
        const t = k / pieces;
        const w = spotToWorld(this.grid, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, this.layout);
        points.push({ x: w.x, y: w.y + lift, z: w.z });
      }
    }
    if (points.length < 2) {
      const w = spotToWorld(this.grid, to, this.layout);
      points.push({ x: w.x, y: w.y + lift, z: w.z });
    }
    // Continue from wherever the token is, so a second move mid-glide does not jump back.
    const start = token.group.position;
    points[0] = { x: start.x, y: start.y, z: start.z };
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const total = cumulative[cumulative.length - 1]!;
    // A fixed pace per tile of line, however long it is: a walk across the
    // room takes as long as a walk across the room, and a follower crossing
    // five tiles in one leg takes five tiles' worth. A walk keeps its feet on
    // the ground; only a throw arcs.
    const crossed = Math.max(1, lineLength(spots));
    const duration = thrown ? 0.25 : 0.16 * crossed;
    this.glides.set(id, { token, points, cumulative, total, elapsed: 0, duration, hop: thrown ? 0.35 : 0, thrown });
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
      // Steady along the line, wherever its corners fall.
      const distance = eased * glide.total;
      let i = 0;
      while (i < segments - 1 && glide.cumulative[i + 1]! < distance) i++;
      const legLength = glide.cumulative[i + 1]! - glide.cumulative[i]!;
      const frac = legLength <= 1e-9 ? 1 : (distance - glide.cumulative[i]!) / legLength;
      const a = glide.points[i]!;
      const b = glide.points[i + 1]!;
      // A throw is one arc; a walk stays on the ground and faces where it is going.
      const hop = glide.thrown ? glide.hop * Math.sin(Math.PI * t) : 0;
      glide.token.group.position.set(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac + hop, a.z + (b.z - a.z) * frac);
      if (!glide.thrown) {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        if (dx * dx + dz * dz > 1e-12) glide.token.group.rotation.y = Math.atan2(dx, dz);
      }
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
  /**
   * The id actually drawn for a creature, once the stand-in has had its say.
   *
   * It records the substitution rather than hiding it: the registry is asked
   * for the id nobody has, so `missing()` names it, and `fallbacks` remembers
   * what went in its place so `modelSource` can say so.
   */
  private drawnModel(modelId: string, entity: Pick<EntityState, 'definition' | 'faction'>): string {
    if (this.assets !== null && this.assets.has(modelId)) return modelId;
    if (this.registry.has(modelId)) return modelId;
    const fallback = this.fallbackFor(entity);
    if (fallback === null || fallback === modelId || !this.registry.has(fallback)) return modelId;
    this.registry.get(modelId);
    this.fallbacks.set(modelId, fallback);
    return fallback;
  }

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
      // The ring stands under the selected creature's token wherever it is,
      // walking with it; with only a tile to go on, under whoever is walking
      // to that tile, else at the tile's centre.
      const token = this.selectionId === null ? undefined : this.tokens.get(this.selectionId);
      const walking =
        token ??
        [...this.glides]
          .filter(([id]) => {
            const spot = this.tokenSpots.get(id);
            return spot !== undefined && this.grid.tileAtSpot(spot.x, spot.y) === this.selectionTile;
          })
          .map(([, glide]) => glide.token)[0];
      const centre = tileCenter(this.grid, this.selectionTile, this.layout);
      if (walking !== undefined && walking.group.visible) {
        this.selection.position.x = walking.group.position.x;
        this.selection.position.z = walking.group.position.z;
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

  /**
   * Where an id is currently drawn from: an imported file, the library, the
   * body that stood in for it (`fallback:husk`), or the magenta placeholder.
   */
  modelSource(modelId: string): 'asset' | 'library' | 'placeholder' | `fallback:${string}` {
    if (this.assets !== null && this.assets.has(modelId) && this.assets.template(modelId) !== undefined) return 'asset';
    if (this.registry.has(modelId)) return 'library';
    const fallback = this.fallbacks.get(modelId);
    return fallback === undefined ? 'placeholder' : `fallback:${fallback}`;
  }

  private placeToken(token: BuiltModel, entity: EntityState): void {
    if (!this.poseToken(token, entity)) return;
    const at = spotToWorld(this.grid, entity.at, this.layout);
    const lift = token.spec.groundOffset ?? 0;
    token.group.position.set(at.x, at.y + lift, at.z);
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
    for (const group of this.decos) {
      this.root.remove(group);
      // Same as `setAuthoring`: the group is gone, so its clips go with it.
      this.clipSets.delete(group);
    }
    this.decos.length = 0;

    this.lastDecos = decos;
    for (const deco of decos) {
      const model = this.build(deco.model);
      const centre = this.placementCentre(deco.position);
      const lift = model.spec.groundOffset ?? 0;
      model.group.position.set(centre.x, centre.y + lift, centre.z);
      model.group.rotation.y = deco.rotation;
      this.root.add(model.group);
      this.decos.push(model.group);
    }
  }

  private placementCentre(position: { x: number; y: number; z?: number }): { x: number; y: number; z: number } {
    const tile = this.grid.indexOf(position.x, position.y);
    return {
      x: (position.x - (this.grid.width - 1) / 2) * this.layout.tileSize,
      z: (position.y - (this.grid.height - 1) / 2) * this.layout.tileSize,
      y: position.z === undefined ? (tile < 0 ? this.layout.baseHeight : surfaceHeight(this.grid.heightAt(tile), this.layout)) :
        this.layout.baseHeight + position.z * this.layout.tileSize,
    };
  }

  /** Editor creatures come from authored placements, including ones outside the play grid. */
  setAuthoring(scene: SceneDoc | null, models: Readonly<Record<string, string>> = {}): void {
    for (const group of this.authoredCreatures) {
      this.root.remove(group);
      // The clip set is keyed by the group, and the group is being thrown away;
      // `setAuthoring` runs on every content edit, so leaving them would grow a
      // map for the life of the session.
      this.clipSets.delete(group);
    }
    this.authoredCreatures.length = 0;
    this.authoring = scene !== null;
    if (this.authoring) {
      for (const token of this.tokens.values()) token.group.visible = false;
    } else {
      // Not "everything is visible again": a token `poseToken` hid because its
      // creature stands nowhere must stay hidden. Re-pose against the state the
      // tokens were last drawn from.
      for (const [id, token] of this.tokens) {
        const entity = this.lastState?.entity(id);
        if (entity !== undefined) this.poseToken(token, entity);
      }
    }
    if (!scene) return;
    for (const encounter of scene.encounters) for (const placement of encounter.adversaries) {
      // This one creature's own look first, then whatever its type is drawn
      // with, and failing both the adversary's own id.
      const wanted = placement.model ?? models[placement.adversary] ?? placement.adversary;
      const modelId = this.drawnModel(wanted, { definition: placement.adversary, faction: 'adversary' });
      const model = this.build(modelId, { palette: { ring: ringMaterial(DEFAULT_FACTION_COLORS.adversary!) } });
      const centre = this.placementCentre(placement.position);
      model.group.position.set(centre.x, centre.y + (model.spec.groundOffset ?? 0), centre.z);
      model.group.name = `authored-creature:${placement.id}`;
      this.root.add(model.group);
      this.authoredCreatures.push(model.group);
    }
  }

  /** How many creatures the editor is drawing from the document rather than from play. */
  get authoredCreatureCount(): number { return this.authoredCreatures.length; }

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
    const held = new Set<number>();
    for (const tile of tiles) {
      if (i >= this.maxHighlights) break;
      if (!this.grid.isTile(tile) || held.has(tile)) continue;
      held.add(tile);
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
    // The lit ground gets one border, in its own colour: an area, not tiles.
    const edges = this.outline(held, this.highlightMaterial.color, this.highlightEdgeGeometry, 0);
    this.highlightEdgeCount = edges;
    this.highlightEdgeGeometry.setDrawRange(0, edges * 2);
    (this.highlightEdgeGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.highlightEdgeGeometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  /** How many tiles the highlight layer is currently drawing. */
  get highlightedCount(): number {
    return this.highlightCount;
  }

  /** How many edge segments border the lit ground. */
  get highlightEdgeSegments(): number {
    return this.highlightEdgeCount;
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
    outer: for (const zone of zones) {
      color.set(zone.color);
      const held = new Set<number>();
      for (const tile of zone.tiles) if (this.grid.isTile(tile)) held.add(tile);
      const painted = new Set<number>();
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
        painted.add(tile);
        i++;
      }
      // A side with no tile of the same zone beyond it is the zone's edge.
      edges = this.outline(painted, color, this.zoneEdgeGeometry, edges);
    }
    this.zoneCount = i;
    this.zoneLayer.count = i;
    this.zoneLayer.instanceMatrix.needsUpdate = true;
    if (this.zoneLayer.instanceColor !== null) this.zoneLayer.instanceColor.needsUpdate = true;
    this.zoneEdgeCount = edges;
    this.zoneEdgeGeometry.setDrawRange(0, edges * 2);
    (this.zoneEdgeGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.zoneEdgeGeometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
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

  /**
   * Draw the line a click would walk: `route` in the walk's blue, `beyond`
   * - the rest of the way a fight's move does not cover - in red. Legs are
   * cut at half a tile so the line lies on the ground it crosses. An empty
   * route clears it.
   */
  showPath(route: readonly Spot[], beyond: readonly Spot[] = [], run = false): void {
    const positions = this.pathGeometry.getAttribute('position') as BufferAttribute;
    const colors = this.pathGeometry.getAttribute('color') as BufferAttribute;
    let n = 0;
    const put = (spot: Spot, color: Color): void => {
      if (n >= PATH_CAPACITY) return;
      const w = spotToWorld(this.grid, spot, this.layout);
      positions.setXYZ(n, w.x, w.y + 0.04, w.z);
      colors.setXYZ(n, color.r, color.g, color.b);
      n++;
    };
    const lay = (line: readonly Spot[], color: Color, fromStart: boolean): void => {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]!;
        const b = line[i + 1]!;
        const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
        for (let k = i === 0 && fromStart ? 0 : 1; k <= pieces; k++) {
          const t = k / pieces;
          put({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, color);
        }
      }
    };
    if (route.length >= 2) {
      lay(route, PATH_WALK, true);
      // Amber where a run would get there on an Agility Roll; red where nothing one move does would.
      if (beyond.length >= 2) lay(beyond, run ? PATH_RUN : PATH_BEYOND, false);
    }
    this.pathPoints = n;
    this.pathGeometry.setDrawRange(0, n);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    this.pathLine.visible = n >= 2;
  }

  clearPath(): void {
    this.showPath([]);
  }

  /** How many points the hover path is drawn through; none when it is hidden. */
  get pathPointCount(): number {
    return this.pathPoints;
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

  /**
   * Ring whoever is selected: their token, wherever it stands or walks,
   * given their id; the tile's centre otherwise. Nobody for `NO_TILE`.
   */
  showSelection(tile: number, id: string | null = null): void {
    if (tile === this.selectionTile && id === this.selectionId) return;
    this.selectionTile = tile;
    this.selectionId = id;
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
    this.highlightEdgeGeometry.dispose();
    this.highlightEdgeMaterial.dispose();
    this.cursorGeometry.dispose();
    this.pathGeometry.dispose();
    this.pathMaterial.dispose();
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
    this.tokenSpots.clear();
    this.tokenStanding.clear();
    this.glides.clear();
    this.reactions.clear();
    this.decos.length = 0;
    // Shared caches outlive a scene unless this view created them.
    if (this.ownsResources) this.resources.dispose();
  }
}
