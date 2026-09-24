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
  Line,
  LineBasicMaterial,
  LineSegments,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  type Raycaster,
  Scene,
} from 'three';
import { NO_TILE, type Spot, type TileGrid } from '../grid/grid';
import { advanceGlide, planGlide, type Glide } from './glide';
import { TrajectoryLine, type AimedArc } from './trajectory-line';
import { ReachRing } from './reach-ring';
import type { Deco, SceneDoc } from '../scene/schema';
import type { EntityState, SceneState } from '../scene/state';
import { DEFAULT_LAYOUT, mapExtent, placementCentre, spotToWorld, standHeight, tileCenter, worldToSpot, type TileLayout } from './layout';
import { bandedLine, type PathPoint } from './path-bands';
import { spanOf } from '../scene/deco-span';
import { outlineTiles } from './tile-outline';
import { PropGhost } from './prop-ghost';
import { buildOverlays, type OverlayParts } from './overlays';
import { DoorSwings } from './door-swing';
import { OBJECT_BODIES, definitionOf } from '../scene/prop-functions';
import { ModelResources, buildModel, type BuildOptions, type BuiltModel } from './procedural/build';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type AssetLibrary, seatOnTile } from './assets';
import type { ProceduralModelSpec } from './procedural/spec';
import { placeholder as placeholderSpec } from './procedural/registry';

/** One token on its way from one tile to another. */
/** Points the hover path has room for: a long walk cut at half a tile. */
const PATH_CAPACITY = 1024;
/** The walk's own blue, and the red of the way a fight's move does not cover. */
const PATH_BEYOND = '#ff6a5c';
/** The part past one move that a run would cover: Movement Under Pressure, an Agility Roll away. */
const PATH_RUN = '#ffc14d';

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

import { ModelRegistry } from './procedural/registry';
import { OBJECT_MARK, PARTY_START_MARK } from './authoring-marks';
import type { Interactable } from '../scene/schema';

/**
 * What each kind of object is drawn as when it names no model of its own.
 *
 * An object is content: a door with a lock on it should be a door in play, not
 * nothing at all. Naming a model overrides this; the editor's gold mark is only
 * for a `scripted` object, which has no shape anybody could guess.
 */
import { Spotlight } from './spotlight';
import { CarryMotion } from './carry';
export { OUTLINE_LAYER } from './toon';
import { DEFAULT_FACTION_COLORS, dim, forgetOutline, litOutlines, outline, outlineSide } from './faction-outline';
import { Reactions } from './reactions';
import { ClickRipples } from './click-ripple';
import { buildTerrainMesh, type TerrainMesh, type TerrainMeshOptions } from './terrain-mesh';
import { drawsTileModel, redrawTileModels } from './tile-models';

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

/** Fallback model per faction, when an entity's definition names none. */
const FALLBACK_MODEL: Readonly<Record<string, string>> = {
  party: 'knight',
  adversary: 'husk',
  neutral: 'husk',
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
  private readonly pendingLeaps = new Map<string, number>();
  private readonly waiting = new Set<string>();
  private readonly lateFlinch = new Set<string>();
  private readonly arc = new TrajectoryLine(DEFAULT_LAYOUT.tileSize);
  /** The ranges on the ground as the circles they are: `reach-ring.ts`. */
  private readonly reach = new ReachRing(DEFAULT_LAYOUT.tileSize);
  /** Whether each token was last drawn standing, so a fall is a change to animate. */
  private readonly tokenStanding = new Map<string, boolean>();
  /** Flinches and falls in progress, by entity. */
  private readonly reactions = new Reactions({
    play: (group, state) => this.playState(group, state),
    walking: (token) => [...this.glides.values()].some((glide) => glide.token === token && !glide.thrown),
    tileSize: () => this.layout.tileSize,
  });
  /** The ground answering a click to walk (`render/click-ripple.ts`). */
  private readonly ripples = new ClickRipples(() => this.layout.tileSize);
  /** Stepping through a portal on the next sync (`teleport`); and, once a walk up to it arrives, then. */
  private readonly pendingBlinks = new Set<string>();
  private readonly lateBlinks = new Set<string>();
  private readonly decos: Group[] = [];
  /** Doors hung on their hinges, and which of them are open. */
  private readonly swings = new DoorSwings();
  /** The half-solid prop under the pointer. Made on the first preview and kept after that. */
  private ghost: PropGhost | null = null;
  /** One model per tile whose terrain names one (`tile-models.ts`), rebuilt with the ground. */
  private tileModels: Group[] = [];
  /** Objects with a body of their own, drawn in both modes. */
  private readonly objects: Group[] = [];
  /** The white rim on whatever the pointer is over. */
  private readonly spot = new Spotlight();
  private litToken: string | null = null;
  /** The tile the pointer is over, or null when it is on an object or off the map. */
  private hoverTile: number | null = null;
  private lastObjects: readonly Interactable[] = [];
  private readonly authoredCreatures: Group[] = [];
  /**
   * What the editor last drew and the models it drew them with, so a model that lands after the
   * room was drawn - a party start or a creature stood in for by the placeholder - is drawn again.
   */
  private lastAuthoring: { args: Parameters<SceneView['setAuthoring']>; models: Set<string> } | null = null;
  /** Party starts and objects, drawn only while authoring (`authoring-marks.ts`). */
  private readonly marks: Group[] = [];
  /** What the editor's pointer carries: lifted, swinging, landing. */
  private readonly carry = new CarryMotion();
  private authoring = false;
  private readonly modelForEntity: (entity: EntityState) => string;
  private readonly fallbackFor: (entity: Pick<EntityState, 'definition' | 'faction'>) => string | null;
  /** What was drawn in place of each id nothing could supply, for `modelSource`. */
  private readonly fallbacks = new Map<string, string>();
  private readonly assets: AssetLibrary | null;
  private stopListening: (() => void) | null = null;
  /** Which model id each token and deco was drawn from, so a late asset can find them. */
  private readonly tokenModels = new Map<string, string>();
  /** The side each token's rim was drawn for: a creature talked round is drawn again in its new colour. */
  private readonly tokenFactions = new Map<string, string>();
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
  private cursorTile = NO_TILE;
  private selectionTile = NO_TILE;
  /** Whose line is blue: the one being played, wherever they stand or walk. */
  private selectionId: string | null = null;
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
          : (FALLBACK_MODEL[entity.faction] ?? 'husk'));
    // Nothing stands in by default: a caller that wants a body rather than the
    // placeholder says so, and takes the honest `missing()` entry with it.
    this.fallbackFor = options.fallbackFor ?? ((): string | null => null);

    this.scene.background = new Color('#1b1520');
    this.scene.add(this.root);

    this.terrainOptions = options;
    this.terrain = buildTerrainMesh(grid, options);
    for (const mesh of this.terrain.meshes) this.root.add(mesh);
    this.tileModels = redrawTileModels(this.root, this.tileModels, this.grid, this.layout, (id, at) => this.build(id, at === undefined ? {} : { scale: at }), (group) => this.clipSets.delete(group));

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
    } = buildOverlays(this.root, this.maxHighlights, this.overlayParts()));

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

    this.root.add(this.arc.group, this.reach.group);

    this.addLights();
  }

  /**
   * The overlay layers, sized for `capacity` tiles: the walk highlights, the
   * zone ground and the zone edges. Built once here and again by `rebind`
   * when a bigger room arrives; the materials and the quad geometry are the
   * view's own and outlive them.
   */

  /**
   * Draw the border of a set of tiles into an edge geometry, from segment
   * `from` on: a side with no tile of the same set beyond it is the edge.
   * Returns how many segments the geometry now holds. What makes a footprint
   * read as a shape rather than as loose squares.
   */
  private outline(held: ReadonlySet<number>, color: Color, geometry: BufferGeometry, from: number): number {
    return outlineTiles(this.grid, this.layout, held, color, geometry, from);
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
  rebind(grid: TileGrid, options: { tints?: readonly string[]; decos?: readonly Deco[]; objects?: readonly Interactable[] } = {}): void {
    this.settle();
    this.ripples.clear();
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
      } = buildOverlays(this.root, this.maxHighlights, this.overlayParts()));
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
    this.reach.hide();
    this.fitSun();

    this.tokenSpots.clear();
    this.tokenStanding.clear();
    this.setDecos(options.decos ?? []);
    this.setObjects(options.objects ?? []);
  }

  /**
   * The light rig: a sky over the room, a little ambient so nothing is black,
   * and a sun that casts. The shadow is the depth cue that makes a wall read
   * as standing on the floor rather than painted on it, and a token as
   * standing rather than floating; its camera is fitted to the map so the
   * whole room is inside it whatever the room's size.
   */
  private addLights(): void {
    // Warm, as a painted room is: a candle-coloured sky, a plum floor bounce, and an
    // afternoon sun, which the toon ramp turns into flat lit and shaded sides.
    this.scene.add(new AmbientLight(new Color('#fff1e0'), 0.42));
    this.scene.add(new HemisphereLight(new Color('#ffe6c4'), new Color('#3d2c48'), 0.6));

    const sun = new DirectionalLight(new Color('#ffe3b8'), 1.5);
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
   * The model id an entity is actually drawn from: the one it names, or the stand-in that took its
   * place. The raw choice is not enough -- a character whose file never arrived is drawn as the
   * stand-in, and a portrait taken from the raw id would be a picture of something not on the board.
   */
  drawnModelFor(entity: EntityState): string {
    return this.drawnModel(this.modelForEntity(entity), entity);
  }

  /**
   * Create, move and retire token meshes so they match the entities in `state`.
   *
   * Fallen entities stay on the map, lying flat, because the engine keeps their
   * bodies too — `SceneState.isOccupied` already treats them as not blocking.
   */
  syncTokens(state: SceneState, options: { snap?: boolean; reading?: boolean } = {}): void {
    const seen = new Set<string>();

    for (const entity of state.allEntities()) {
      seen.add(entity.id);
      // What an entity is drawn with can change under it — a creature re-skinned in
      // the editor — and the token standing there was built from the old id.
      const wanted = this.drawnModel(this.modelForEntity(entity), entity);
      if (this.tokens.has(entity.id) && (this.tokenModels.get(entity.id) !== wanted || this.tokenFactions.get(entity.id) !== outlineSide(entity))) this.dropToken(entity.id);
      let token = this.tokens.get(entity.id);
      // A move waiting on a roll that is still being read: the token stays put, what it was
      // handed stays queued, and it goes when the card is accepted.
      if (options.reading === true && token !== undefined && this.waiting.has(entity.id)) continue;
      this.waiting.delete(entity.id);
      const was = this.tokenSpots.get(entity.id);
      const path = this.pendingPaths.get(entity.id);
      this.pendingPaths.delete(entity.id);
      const route = this.pendingRoutes.get(entity.id);
      this.pendingRoutes.delete(entity.id);
      const thrown = this.pendingThrows.delete(entity.id);
      const leap = this.pendingLeaps.get(entity.id);
      this.pendingLeaps.delete(entity.id);
      if (token === undefined) {
        // Which side it is on, drawn round it and dimmed until the pointer finds it.
        token = this.build(wanted);
        outline(token.group, wanted, dim(this.factionColors[outlineSide(entity)] ?? DEFAULT_FACTION_COLORS['neutral']!));
        token.group.name = `token:${entity.id}`;
        this.tokens.set(entity.id, token);
        this.tokenModels.set(entity.id, wanted);
        this.tokenFactions.set(entity.id, outlineSide(entity));
        this.root.add(token.group);
        // Built dim, so whoever is already selected - or already under the pointer - has to
        // be given their colour back. A token is rebuilt when its file lands, too.
        this.repaint();
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
      const blink = this.pendingBlinks.delete(entity.id) && moved && options.snap !== true;
      if (blink && route !== undefined) this.lateBlinks.add(entity.id); // walked up to the portal first: through it on arrival
      if (moved && options.snap !== true && (!blink || route !== undefined)) {
        this.poseToken(token, entity);
        this.startGlide(entity.id, token, was, here, path, route, thrown, leap);
      } else if (options.snap === true || blink || !this.glides.has(entity.id)) {
        this.glides.delete(entity.id);
        if (blink) this.blinkThrough(entity.id, token, entity);
        else this.placeToken(token, entity);
      }
      // Else it is already on its way, and this sync has nothing new to say. `tokenSpots` is
      // set to `here` at the end of every sync, so a sync landing mid-walk reads as "not
      // moved" - and used to throw the journey away and snap the token to the end. The idle
      // is played when a glide arrives, and a glide deleted never arrives, so what that left
      // behind was the walk clip, playing over a token standing still.
      this.tokenSpots.set(entity.id, { x: here.x, y: here.y });
      // Standing to lying, or back, is a fall or a rise; a token first seen
      // lying is simply lying.
      const stood = this.tokenStanding.get(entity.id);
      if (stood !== undefined && stood !== entity.alive) {
        if (options.snap !== true && this.grid.isTile(entity.tile)) {
          this.reactions.start(entity.id, token, entity.alive ? 'rise' : 'fall');
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
      this.tokenFactions.delete(id);
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
    // Hurt by where they are going - a fall - they flinch when they get there, not while they wait or fly.
    if (this.waiting.has(id) || this.pendingRoutes.has(id) || this.glides.has(id)) return void this.lateFlinch.add(id);
    this.reactions.start(id, token, 'flinch');
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
    this.reactions.start(id, token, 'lunge', { x: dx / length, z: dz / length });
  }

  /** How many tokens are flinching, falling, getting up or lunging. */
  get reactingCount(): number {
    return this.reactions.size;
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
  walkAlong(id: string, route: readonly Spot[], leap?: number, wait = false): void {
    this.pendingRoutes.set(id, route);
    if (wait) this.waiting.add(id);
    if (leap !== undefined) this.pendingLeaps.set(id, leap); // the last leg is a jump, arcing this many blocks
  }

  /** A click on the ground at this spot sent somebody walking (`ok`), or sent nobody. */
  ripple(spot: Spot, ok: boolean): void {
    if (this.ripples.group.parent === null) this.root.add(this.ripples.group);
    this.ripples.add(spotToWorld(this.grid, spot, this.layout), ok ? 'go' : 'no');
  }

  /** How many click ripples are on the ground. */
  get rippleCount(): number {
    return this.ripples.count;
  }

  /** The entity is about to be found through a portal: blinked there, not walked (`render/blink.ts`). */
  teleport(id: string): void {
    this.pendingBlinks.add(id);
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
    this.reactions.settle();
    this.lateBlinks.clear(); // the next sync puts them where they came out
  }

  /** Whether this creature's token is walking, or has a walk handed to it that the next sync will start. */
  hasWalk(id: string): boolean {
    return this.glides.has(id) || this.pendingRoutes.has(id) || this.pendingPaths.has(id);
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
    leap?: number,
  ): void {
    this.glides.set(id, planGlide(this.grid, this.layout, token, from, to, path, route, thrown, leap));
    if (!thrown) this.playState(token.group, 'walk');
  }

  /** Move every glide on by `dt` seconds, and let go of the ones that have arrived. */
  private advanceGlides(dt: number): void {
    for (const [id, glide] of this.glides) {
      if (!advanceGlide(glide, dt)) continue;
      this.glides.delete(id);
      this.playState(glide.token.group, 'idle');
      if (this.lateFlinch.delete(id)) this.flinch(id);
      const entity = this.lateBlinks.delete(id) ? this.lastState?.entity(id) : undefined;
      if (entity !== undefined) this.blinkThrough(id, glide.token, entity);
    }
  }

  /** Put a token where its creature came out of a portal, blinking there from wherever it is drawn now. */
  private blinkThrough(id: string, token: BuiltModel, entity: EntityState): void {
    const from = { x: token.group.position.x, y: token.group.position.y, z: token.group.position.z };
    this.placeToken(token, entity);
    this.reactions.start(id, token, 'blink', undefined, from);
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
    clone.scale.setScalar(options.scale ?? spec.scale);
    clone.rotation.y = spec.rotationY;
    // Seated like everything else the room stands up: feet on the tile, centred over
    // it, and then nudged by however much the asset says it should stand off centre.
    if (spec.pivot !== 'file') seatOnTile(clone); // or held where the file's own origin is
    clone.position.x += spec.offsetX * this.layout.tileSize;
    clone.position.z += spec.offsetY * this.layout.tileSize;
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
    // No base ring: an imported model used to stand on a solid red plate here, and a rim is
    // drawn round it by `syncTokens` instead.
    return {
      group,
      spec: { ...placeholderSpec, id: modelId, groundOffset: spec.groundOffset, ...(spec.pivot === 'file' ? { pivot: 'file' as const } : {}) },
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

  /** Forget an entity's token, so the next sync builds it from whatever it is drawn with now. */
  private dropToken(entityId: string): void {
    const token = this.tokens.get(entityId);
    if (token !== undefined) {
      this.root.remove(token.group);
      this.clipSets.delete(token.group);
    }
    this.tokens.delete(entityId);
    this.tokenModels.delete(entityId);
    this.tokenFactions.delete(entityId);
    // No history, so the one that replaces it is put down rather than walking in.
    this.tokenSpots.delete(entityId);
    this.tokenStanding.delete(entityId);
    this.glides.delete(entityId);
  }

  /** Redraw whatever was drawn from an id whose asset just arrived or failed. */
  private assetChanged(id: string): void {
    // A rim merged from the placeholder is not the rim of what landed, and shares its id.
    forgetOutline(id);
    let redraw = false;
    for (const modelId of this.tokenModels.values()) if (modelId === id) redraw = true;
    if (this.lastDecos.some((deco) => deco.model === id)) redraw = true;
    if (this.lastObjects.some((object) => object.model === id)) redraw = true;
    if (drawsTileModel(this.grid, id)) redraw = true;
    // Not a redraw of the rest: the room's own drawing goes back up as it was, with the model in it.
    if (this.lastAuthoring?.models.has(id) === true) this.setAuthoring(...this.lastAuthoring.args);
    if (!redraw) return;
    for (const [entityId, modelId] of [...this.tokenModels]) {
      if (modelId === id) this.dropToken(entityId);
    }
    if (this.lastState !== null) this.syncTokens(this.lastState);
    if (this.lastDecos.some((deco) => deco.model === id)) this.setDecos(this.lastDecos);
    this.tileModels = redrawTileModels(this.root, this.tileModels, this.grid, this.layout, (id, at) => this.build(id, at === undefined ? {} : { scale: at }), (group) => this.clipSets.delete(group));
    if (this.lastObjects.some((object) => object.model === id)) this.setObjects(this.lastObjects);
  }

  /** Advance every playing clip and every moving token. `dt` in seconds. */
  tick(dt: number): void {
    this.advanceGlides(dt);
    this.reactions.advance(dt);
    this.ripples.tick(dt);
    this.carry.tick(dt);
    this.swings.tick(dt);
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
    this.tileModels = redrawTileModels(this.root, this.tileModels, this.grid, this.layout, (id, at) => this.build(id, at === undefined ? {} : { scale: at }), (group) => this.clipSets.delete(group));
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
    this.takeDown(this.decos);
    this.swings.clear();
    this.lastDecos = decos;
    for (const deco of decos) {
      const model = this.standAt(deco.model, deco.position, deco.rotation, spanOf(deco));
      // A prop that opens is hung on its hinge, and the hinge is what goes in the room (`render/door-swing.ts`).
      const drawn = deco.id !== undefined && deco.function !== undefined && definitionOf(deco.function).opens(deco.function) ? this.swings.hang(deco.id, model.group) : model.group;
      // A prop that does something is a thing to point at, named as an object is, so the rim finds it.
      if (deco.id !== undefined && deco.function !== undefined) drawn.name = `object:${deco.id}`;
      this.root.add(drawn);
      this.decos.push(drawn);
    }
  }

  /** Which doors are open, so the ones that changed swing (`render/door-swing.ts`). */
  setOpenings(ids: ReadonlySet<string>): void {
    this.swings.setOpen(ids);
  }

  /** How far a door is swung from its facing, in radians; null for a prop that is not a door. */
  doorAngle(id: string): number | null {
    return this.swings.angleOf(id);
  }

  /**
   * Take drawn things off the board and empty the lists that held them. The clip set is keyed by
   * the group and the group is going, and `setAuthoring` runs on every content edit, so a group
   * left in it would grow a map for the life of the session.
   */
  private takeDown(...sets: Group[][]): void {
    for (const set of sets) {
      for (const group of set) {
        this.root.remove(group);
        group.traverse((part) => this.clipSets.delete(part as Group));
      }
      set.length = 0;
    }
  }

  /**
   * Stand a model on the board: over its tile, facing where it was turned to, feet on the ground.
   * `span` tiles across means grown by the span and moved half a block south-east, so the middle
   * of the model sits over the middle of the block rather than over its north-west tile
   * (`scene/deco-span.ts`). What a model sinks or floats by is part of it, so that grows too.
   */
  private standAt(modelId: string, position: Deco['position'], rotation: number, span = 1): BuiltModel {
    const model = this.build(modelId);
    this.seat(model, position, rotation, span);
    return model;
  }

  /** Put an already-built model where a placement says, at the size a span says. */
  private seat(model: BuiltModel, position: Deco['position'], rotation: number, span: number): void {
    const centre = placementCentre(this.grid, this.layout, position);
    const off = ((span - 1) / 2) * this.layout.tileSize;
    model.group.scale.setScalar(span);
    model.group.position.set(centre.x + off, centre.y + (model.spec.groundOffset ?? 0) * span, centre.z + off);
    model.group.rotation.y = rotation;
  }

  /** What the overlay layers are made of. Private fields, so they are handed over by name. */
  private overlayParts(): OverlayParts {
    return {
      highlightGeometry: this.highlightGeometry,
      highlightMaterial: this.highlightMaterial,
      zoneMaterial: this.zoneMaterial,
      zoneEdgeMaterial: this.zoneEdgeMaterial,
      highlightEdgeMaterial: this.highlightEdgeMaterial,
    };
  }

  /** The prop that would be placed, where it would go, half see-through (`render/prop-ghost.ts`). */
  showPropGhost(modelId: string, position: Deco['position'], rotation: number, span = 1): void {
    this.ghosts().show(modelId, (model) => this.seat(model, position, rotation, span));
  }

  hidePropGhost(): void {
    this.ghost?.hide();
  }

  /** What the preview is showing, and how big: how a test sees it. */
  get propGhost(): { id: string; span: number } | null {
    return this.ghost?.shown ?? null;
  }

  /** Made on the first preview, so a view nobody is authoring in never builds one. */
  private ghosts(): PropGhost {
    return (this.ghost ??= new PropGhost(this.root, (id) => this.build(id), (group) => this.clipSets.delete(group)));
  }

  /**
   * The objects in the room that have a body: a door, a chest, a pillar.
   *
   * Drawn in both modes, which is what separates them from the marks. An object
   * is content — it stands in the room whether or not anybody is editing it —
   * and it used to be drawn only while authoring, so every door and chest in the
   * game was invisible the moment play began. An object with no model of its own
   * is still invisible here, deliberately: the editor marks it instead.
   */
  setObjects(objects: readonly Interactable[]): void {
    this.spot.hide();
    this.takeDown(this.objects);
    this.lastObjects = objects;
    for (const object of objects) {
      const wears = object.model ?? OBJECT_BODIES[object.kind] ?? null;
      if (wears === null) continue;
      const model = this.standAt(wears, object.position, object.rotation);
      model.group.name = `object:${object.id}`;
      this.root.add(model.group);
      this.objects.push(model.group);
    }
  }

  /** Everything a room stands up that is not a creature: its scenery and its objects. */
  setScenery(scene: { decos: readonly Deco[]; interactables: readonly Interactable[] }): void {
    this.setDecos(scene.decos);
    this.setObjects(scene.interactables);
  }

  /** Editor creatures come from authored placements, including ones outside the play grid. */
  setAuthoring(
    scene: SceneDoc | null,
    models: Readonly<Record<string, string>> = {},
    party: readonly { model?: string | undefined; definition: string }[] = [],
  ): void {
    this.takeDown(this.authoredCreatures, this.marks);
    this.authoring = scene !== null;
    this.lastAuthoring = scene === null ? null : { args: [scene, models, party], models: new Set() };
    // The editor's viewport wears Blender's grey, like the panels round it; play keeps its dark ground.
    (this.scene.background as Color).set(this.authoring ? '#393939' : '#1b1520');
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
      this.lastAuthoring!.models.add(modelId);
      const model = this.build(modelId);
      // The editor is where creatures are placed, so it is the mode that most needs to say
      // which side one is on. Layer 0, which is why it shows here at all.
      outline(model.group, modelId, (encounter.bystanders === true || placement.interaction?.kind === 'friendly' ? DEFAULT_FACTION_COLORS.neutral : DEFAULT_FACTION_COLORS.adversary)!);
      const centre = placementCentre(this.grid, this.layout, placement.position);
      model.group.position.set(centre.x, centre.y + (model.spec.groundOffset ?? 0), centre.z);
      model.group.name = `authored-creature:${placement.id}`;
      this.root.add(model.group);
      this.authoredCreatures.push(model.group);
    }
    // The bodies as well as the marks: an object drawn in play is drawn here too, or
    // the editor would show a room missing the very things a press takes hold of.
    this.setObjects(scene.interactables);
    // A party start is drawn as whoever begins on it - member `i` on start `i % starts`, the first
    // of them if the party outnumbers the starts - wearing the look play gives them. A start nobody
    // fills is the pawn, so it can still be seen and taken hold of.
    for (const [i, spawn] of scene.spawns.entries()) {
      const member = party[i];
      if (member === undefined) {
        this.mark(buildModel(PARTY_START_MARK, this.resources).group, `spawn:${i}`, spawn);
        continue;
      }
      const modelId = this.drawnModel(member.model ?? models[member.definition] ?? member.definition, { definition: member.definition, faction: 'party' });
      this.lastAuthoring!.models.add(modelId);
      const body = this.build(modelId);
      outline(body.group, modelId, DEFAULT_FACTION_COLORS.party!);
      this.mark(body.group, `spawn:${i}`, spawn);
      body.group.position.y += body.spec.groundOffset ?? 0;
    }
    // An object with a body draws itself in both modes (`setObjects`); this is the
    // mark for one that has none, so an author still has something to take hold of.
    for (const object of scene.interactables) {
      if (object.model !== null || OBJECT_BODIES[object.kind] !== undefined) continue;
      this.mark(buildModel(OBJECT_MARK, this.resources).group, `object:${object.id}`, object.position);
    }
  }

  /** How many creatures the editor is drawing from the document rather than from play. */
  get authoredCreatureCount(): number { return this.authoredCreatures.length; }

  /** Put down one of the editor's marks, named so a press can find it to lift. */
  private mark(group: Group, name: string, at: { x: number; y: number; z?: number }): void {
    const centre = placementCentre(this.grid, this.layout, at);
    group.position.set(centre.x, centre.y, centre.z);
    group.name = name;
    this.root.add(group);
    this.marks.push(group);
  }

  /** Lift what the editor's pointer took hold of - a placed creature, a prop, an object, a party start. */
  lift(kind: string, key: string): void {
    const held = this.drawnFor(kind, key);
    if (held !== null) this.carry.lift(held);
  }

  /** Where the pointer meets the ground while carrying: the thing hangs above it, trailing. */
  carryTo(x: number, y: number, z: number): void {
    this.carry.moveTo(x, y, z);
  }

  /** Turn what the pointer is carrying, in radians: it is put down facing that way. */
  carryTurn(radians: number): void {
    this.carry.turnTo(radians);
  }

  /** Let go: it falls onto wherever the document now has it, drawn afresh there or not; with no key, where it was. */
  drop(kind?: string, key?: string): void {
    this.carry.drop(kind === undefined || key === undefined ? null : this.drawnFor(kind, key));
  }

  /**
   * The object drawn under a ray, or null — and null as well when the ground is
   * in front of it, because pointing at a wall is not pointing at what is behind
   * it. The same rule the editor picks by, so what lights up is what a press
   * would reach.
   */
  objectUnder(ray: Raycaster): string | null {
    // Scenery too: a tree in front of a chest is pointed at, not the chest.
    const hit = ray.intersectObjects([...this.objects, ...this.decos], true).find((h) => h.object.visible);
    if (hit === undefined) return null;
    const ground = ray.intersectObjects(this.terrain.drawn, false)[0];
    if (ground !== undefined && ground.distance < hit.distance) return null;
    let drawn: Object3D = hit.object;
    while (drawn.parent !== null && drawn.parent !== this.root) drawn = drawn.parent;
    return drawn.name.startsWith('object:') ? drawn.name.slice('object:'.length) : null;
  }

  /** Rim what the pointer is on: an object in white, a creature by bringing its line up. */
  spotlight(ray: Raycaster | null, tile: number = NO_TILE): void {
    const objectId = ray === null ? null : this.objectUnder(ray);
    this.spot.show(objectId === null ? null : (this.root.getObjectByName(`object:${objectId}`) ?? null));
    this.hoverTile = objectId !== null || !this.grid.isTile(tile) ? null : tile;
    this.repaint();
  }

  /** Whoever stands on a tile, of the creatures drawn. */
  private tokenOn(tile: number): string | null {
    for (const id of this.tokens.keys()) if (this.lastState?.entity(id)?.tile === tile) return id;
    return null;
  }

  /** Every creature's line: blue for the selected, full for the pointed at, dim for the rest. */
  private repaint(): void {
    this.litToken = litOutlines(
      this.tokens,
      this.hoverTile,
      this.selectionId,
      (id) => ((entity) => (entity === undefined ? null : { tile: entity.tile, faction: outlineSide(entity) }))(this.lastState?.entity(id)),
      this.factionColors,
    );
  }

  /** The tile of the nearest authored thing drawn under a ray - a creature, a prop, a mark - unless ground hides it. */
  authoredUnder(ray: Raycaster): { x: number; y: number } | null {
    const hit = ray.intersectObjects([...this.authoredCreatures, ...this.decos, ...this.objects, ...this.marks], true).find((h) => h.object.visible);
    const ground = ray.intersectObjects(this.terrain.drawn, false)[0];
    if (hit === undefined || (ground !== undefined && ground.distance < hit.distance)) return null;
    let drawn: Object3D = hit.object;
    while (drawn.parent !== null && drawn.parent !== this.root) drawn = drawn.parent;
    const size = this.layout.tileSize;
    const at = (drawn.userData.stands as { x: number; z: number } | undefined) ?? drawn.position; // a door's hinge is off its tile
    return { x: Math.round(at.x / size + (this.grid.width - 1) / 2), y: Math.round(at.z / size + (this.grid.height - 1) / 2) };
  }

  /** The group drawn for an authored thing: a prop by its place in the list, the rest by name. */
  private drawnFor(kind: string, key: string): Object3D | null {
    if (kind === 'prop') return this.decos[Number(key)] ?? null;
    return this.root.getObjectByName(kind === 'creature' ? `authored-creature:${key}` : `${kind}:${key}`) ?? null;
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
    const held = new Set<number>();
    for (const tile of tiles) {
      if (i >= this.maxHighlights) break;
      if (!this.grid.isTile(tile) || held.has(tile)) continue;
      held.add(tile);
      const centre = tileCenter(this.grid, tile, this.layout);
      this.dummy.position.set(centre.x, standHeight(this.grid, tile, this.layout) + 0.02, centre.z);
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
        const top = standHeight(this.grid, tile, this.layout);
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
   * Draw the line a click would walk: `route` in range bands, a colour a band, so the line says
   * how far as well as where (`render/path-bands.ts`); `beyond` - the rest of the way a fight's
   * move does not cover - in amber where a run would reach it and red where nothing would. Legs
   * are cut at half a tile so the line lies on the ground it crosses. An empty route clears it.
   */
  showPath(route: readonly Spot[], beyond: readonly Spot[] = [], run = false): void {
    const positions = this.pathGeometry.getAttribute('position') as BufferAttribute;
    const colors = this.pathGeometry.getAttribute('color') as BufferAttribute;
    let n = 0;
    const put = (point: PathPoint): void => {
      if (n >= PATH_CAPACITY) return;
      const w = spotToWorld(this.grid, point.spot, this.layout);
      positions.setXYZ(n, w.x, w.y + 0.04, w.z);
      colors.setXYZ(n, point.r, point.g, point.b);
      n++;
    };
    if (route.length >= 2) {
      // The bands keep counting into `beyond`, but its colour is what it means, not how far it is.
      const walk = bandedLine(route);
      walk.points.forEach(put);
      if (beyond.length >= 2) bandedLine(beyond, { from: walk.walked, colour: run ? PATH_RUN : PATH_BEYOND, skipFirst: true }).points.forEach(put);
    }
    this.pathPoints = n;
    this.pathGeometry.setDrawRange(0, n);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    this.pathLine.visible = n >= 2;
  }

  /**
   * Stop a token where it stands: the walk it was on is over, and its character is here now.
   *
   * `tokenSpots` has to move with it. It holds where each token was last synced to, and a sync
   * that found the character somewhere the token had not been sent would start a second glide -
   * backwards, from the place the interrupted walk was aiming at.
   */
  land(id: string, at: Spot): boolean {
    if (!this.glides.delete(id)) return false;
    this.tokenSpots.set(id, { x: at.x, y: at.y });
    const token = this.tokens.get(id);
    if (token !== undefined) this.playState(token.group, 'idle');
    return true;
  }

  /** Where a token actually stands, which part-way through a walk is not where its character is. */
  spotOf(id: string): Spot | null {
    const token = this.tokens.get(id);
    if (token === undefined) return null;
    return worldToSpot(this.grid, token.group.position.x, token.group.position.z, this.layout);
  }

  clearPath(): void {
    this.showPath([]);
  }

  /** How many points the hover path is drawn through; none when it is hidden. */
  get pathPointCount(): number {
    return this.pathPoints;
  }

  /** The arc a jump is aimed along, or none; and what is showing, for whoever is reading the board. */
  readonly showArc = (arc: AimedArc | null): void => this.arc.show(this.grid, this.layout, arc);
  /** Circles on the ground, each centred on a spot: a fighter's free movement, the push a roll would open, a jump's reach. */
  showReach(rings: readonly { at: Spot; radius: number; kind: 'move' | 'push' | 'jump' }[]): void {
    this.reach.show(rings.map((ring) => ({ ...spotToWorld(this.grid, ring.at, this.layout), radius: ring.radius, kind: ring.kind })));
  }
  get reachShowing(): readonly { radius: number; kind: string }[] {
    return this.reach.showing;
  }
  get arcShowing(): 'ok' | 'blocked' | null {
    return this.arc.showing;
  }

  /**
   * The tile under the pointer, or `NO_TILE`. Nothing is drawn for it: the line a click would
   * walk, the arc a jump would fly and the light on a creature are what the pointer shows, and a
   * disc on the ground under all of them was one mark too many.
   */
  showCursor(tile: number): void {
    this.cursorTile = this.grid.isTile(tile) ? tile : NO_TILE;
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
    // Given an id, that is who; given only a tile, whoever stands on it. Nobody off the map.
    this.selectionId = !this.grid.isTile(tile) ? null : (id ?? this.tokenOn(tile));
    this.repaint();
  }

  /** The tile whoever is selected stands on, or `NO_TILE`. */
  get selectionAt(): number {
    return this.selectionTile;
  }

  dispose(): void {
    if (this.stopListening !== null) this.stopListening();
    this.ripples.dispose();
    for (const mixer of this.mixers.values()) mixer.stopAllAction();
    this.mixers.clear();
    this.clipSets.clear();
    this.terrain.dispose();
    this.highlightGeometry.dispose();
    this.highlightMaterial.dispose();
    this.highlight.dispose();
    this.highlightEdgeGeometry.dispose();
    this.highlightEdgeMaterial.dispose();
    this.pathGeometry.dispose();
    this.pathMaterial.dispose();
    this.zoneMaterial.dispose();
    this.zoneLayer.dispose();
    this.zoneEdgeGeometry.dispose();
    this.zoneEdgeMaterial.dispose();
    this.arc.dispose();
    this.reach.dispose();
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
    this.tileModels.length = 0;
    // Shared caches outlive a scene unless this view created them.
    if (this.ownsResources) this.resources.dispose();
  }
}
