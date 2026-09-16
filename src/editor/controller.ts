/**
 * What a click means, given the tool in hand.
 *
 * The panel decides *which* tool is selected and the viewport decides *which tile*
 * was clicked; this decides what happens as a result, and it does so without
 * touching either. That keeps the interesting half — the half with the bugs —
 * testable in node.
 *
 * A drag is a sequence of `paint` calls between `begin` and `end`. Tools that
 * make sense continuously (terrain, height, erase) act on every tile the pointer
 * crosses and coalesce into one undo step; tools that place a single thing
 * (a prop, a spawn, an adversary) act once per press.
 */

import { toContentId } from '../engine/content/types';
import { isBuildCoordinate, isBuildZ, type BuildingTile } from '../engine/scene/building';
import { BuildingEdit } from './building';
import type { Deco, Encounter, Interactable, Point, SceneDoc } from '../engine/scene/schema';
import { setTerrainModel } from './terrain-edits';
import {
  MODE_TOOLS,
  TERRAIN_TAB_TOOL,
  defaultTool,
  modeOfTool,
  terrainTabOf,
  type EditorMode,
  type TerrainTab,
} from './modes';
import {
  EditorSession,
  addAdversary,
  addDeco,
  addEncounter,
  addInteractable,
  adjustHeight,
  brushTiles,
  placeTile,
  removeAdversary,
  removeDecoAt,
  removeInteractable,
  rotateDeco,
  setSpawns,
  toggleTriggerCell,
} from './session';
import { moveAdversary, moveDeco, moveInteractable, moveSpawn } from './move-edits';

export type EditorTool =
  /** Click things to inspect them; changes nothing. */
  | 'select'
  | 'buildTile'
  | 'eraseTile'
  | 'placeTile'
  | 'raise'
  | 'lower'
  | 'prop'
  | 'spawn'
  | 'interactable'
  | 'adversary'
  | 'trigger'
  | 'erase';

/**
 * Tools that act on every tile a drag crosses.
 *
 * `placeTile` is deliberately not one: a placer puts a tile where it is clicked, and
 * `paint` returns early for anything not named here, so leaving it out is what makes the
 * difference between placing and painting. Its brush still covers a square.
 */
const CONTINUOUS = new Set<EditorTool>(['raise', 'lower', 'erase', 'buildTile', 'eraseTile']);

export interface EditorToolState {
  /** Which construction piece the build tool stamps. */
  buildShape: BuildingTile['shape'];
  /** The colour a stamped piece is made of; presentation only. */
  buildMaterial: BuildingTile['material'];
  /**
   * The vertical plane everything is placed on, in tiles.
   *
   * Shared by the build tools and by props, objects and creatures, so raising
   * the plane once puts a whole storey's worth of content at the same height.
   */
  buildLevel: number;
  /** Quarter turns a stamped piece is rotated by: how a wall picks its edge, and the facing a prop is placed at. */
  buildRotation: number;
  /** How tall a stamped piece stands, in tiles, so one shape covers a step and a pillar. */
  buildHeight: number;
  tool: EditorTool;
  /** The kind of tile the placer puts down. */
  tileId: string;
  /** Prop the prop tool places. */
  propModel: string;
  /** Kind the interactable tool places. */
  interactableKind: Interactable['kind'];
  /** Adversary content id the adversary tool places. */
  adversaryId: string;
  /** Encounter that adversaries and triggers are added to. */
  encounterId: string | null;
  /** Odd numbers read as a square brush: 1, 3, 5. */
  brushSize: number;
  /** Radians a repeat click adds to a prop already on the tile. */
  rotationStep: number;
}

export const DEFAULT_TOOL_STATE: EditorToolState = {
  buildShape: 'block',
  buildMaterial: 'stone',
  buildLevel: 0,
  buildRotation: 0,
  buildHeight: 1,
  tool: 'placeTile',
  tileId: 'floor',
  propModel: 'crate',
  interactableKind: 'chest',
  adversaryId: 'bandit-cutter',
  encounterId: null,
  brushSize: 1,
  rotationStep: Math.PI / 2,
};

export interface EditorControllerOptions {
  session: EditorSession;
  sceneId: string;
  state?: Partial<EditorToolState>;
  /** Called after any edit, so a viewport can rebuild what changed. */
  onChange?: (change: EditorChange) => void;
}

/** What a viewport has to redraw. */
export type EditorChange = 'terrain' | 'content' | 'building' | 'none';

/** What a press can take hold of and carry off. */
export type CarryKind = 'creature' | 'prop' | 'object' | 'spawn';

type Position = Deco['position'];

/** A thing in hand, and where it will land if the pointer lets go now. */
interface Carry {
  kind: CarryKind;
  /** A creature's or an object's id; a prop's or a party start's place in its list, since they have none. */
  key: string;
  /** The encounter a creature is placed in. */
  encounterId?: string;
  from: Position;
  to: Position;
  /** The facing it will land with, in radians. Only a prop has one to change. */
  rotation?: number;
}

export class EditorController {
  readonly session: EditorSession;
  sceneId: string;
  state: EditorToolState;
  /** Which of the top bar's modes is in hand. It always owns `state.tool`. */
  mode: EditorMode;
  /**
   * Which of Terrain's strips is open. It always owns `state.tool` while Terrain
   * is the mode, so the rail beside it can never be missing the tool in hand.
   */
  terrainTab: TerrainTab = 'tiles';
  private readonly onChange: (change: EditorChange) => void;
  /** Tiles already painted in this drag, so one stroke does not re-edit them. */
  private readonly strokeTiles = new Set<number>();
  private readonly buildingStroke = new Set<string>();
  private dragging = false;
  private lastBuildingPoint: Point | null = null;
  /** The object the inspector is showing, if the select tool has hit one. */
  selected: string | null = null;
  /**
   * The placed creature Combat's panel is showing. Kept apart from `selected`
   * because the two modes pick different kinds of thing, and one field holding
   * either would leave every reader asking which it currently is.
   */
  selectedAdversary: string | null = null;
  /**
   * What a press took hold of, carried until the pointer lets go. Select picks up whatever it is
   * pressed on, and Combat's place tool a creature rather than stacking a second one on it. The
   * document waits for the release, which moves the thing once: one undo step.
   */
  private carrying: Carry | null = null;

  constructor(options: EditorControllerOptions) {
    this.session = options.session;
    this.sceneId = options.sceneId;
    this.state = { ...DEFAULT_TOOL_STATE, ...options.state };
    this.onChange = options.onChange ?? ((): void => {});
    this.mode = modeOfTool(this.state.tool, 'inspect');
  }

  get scene(): SceneDoc {
    return this.session.requireScene(this.sceneId);
  }

  /** Change tools, ending any drag in progress. The mode, and Terrain's tab, follow the tool. */
  setTool(tool: EditorTool): void {
    this.end();
    this.state.tool = tool;
    this.mode = modeOfTool(tool, this.mode);
    this.terrainTab = terrainTabOf(tool, this.terrainTab);
  }

  /** Open one of Terrain's strips, which is also how its placement tool is chosen. */
  openTerrainTab(tab: TerrainTab): void {
    this.terrainTab = tab;
    this.setTool(TERRAIN_TAB_TOOL[tab]);
  }

  /**
   * Change modes, ending any drag. The tool in hand stays when the new mode owns
   * it - Erase crossing from Terrain to Combat - and is otherwise the mode's first.
   *
   * Coming into Terrain holding one of its own tools re-syncs the tab to that
   * tool rather than the other way round; coming in holding somebody else's
   * reopens the tab that was last open, with the tool that tab places.
   */
  setMode(mode: EditorMode): void {
    this.end();
    this.mode = mode;
    if (mode === 'terrain') {
      if (MODE_TOOLS.terrain.includes(this.state.tool)) this.terrainTab = terrainTabOf(this.state.tool, this.terrainTab);
      else this.setTool(TERRAIN_TAB_TOOL[this.terrainTab]);
      return;
    }
    if (!MODE_TOOLS[mode].includes(this.state.tool)) this.state.tool = defaultTool(mode);
  }

  /**
   * Move the plane everything is placed on.
   *
   * It ends the drag first: a stroke that changed height halfway would leave
   * half its pieces on another storey and merge them into one undo step.
   */
  /** Set when the build plane moves, until a view has followed it. */
  private levelMoved = false;

  setBuildLevel(z: number): void {
    this.end();
    if (z !== this.state.buildLevel) this.levelMoved = true;
    this.state.buildLevel = z;
  }

  /**
   * Whether the build plane has moved since this was last asked, and forget it.
   *
   * A view follows the storey being worked on, and every way of changing it — the
   * ladder, Ctrl and the wheel, Page Up — comes through `setBuildLevel`, so this is
   * the one place that knows. Asked once a frame: a one-shot rather than a state to
   * hold the camera at, because a camera held at the plane every frame is a camera
   * that cannot be moved off it.
   */
  takeLevelChange(): boolean {
    const moved = this.levelMoved;
    this.levelMoved = false;
    return moved;
  }

  /**
   * Edit a different scene.
   *
   * The encounter goes with it: `encounterId` is scene-scoped, and carrying it
   * across would drop the next adversary into another room's fight.
   */
  switchScene(sceneId: string): void {
    this.end();
    this.sceneId = sceneId;
    this.state.encounterId = null;
    // The selection belonged to the room being left.
    this.selected = null;
    this.selectedAdversary = null;
  }

  set<K extends keyof EditorToolState>(key: K, value: EditorToolState[K]): void {
    this.state[key] = value;
  }

  /** Press. Applies the tool once; a continuous tool then follows the pointer. */
  begin(point: Point): EditorChange {
    this.dragging = true;
    this.lastBuildingPoint = { ...point };
    this.strokeTiles.clear();
    this.buildingStroke.clear();
    return this.apply(point, true);
  }

  /** Pointer moved to a new tile while pressed. */
  paint(point: Point): EditorChange {
    if (!this.dragging) return 'none';
    if (this.carrying !== null) return this.carry(point);
    if (!CONTINUOUS.has(this.state.tool)) return 'none';
    if ((this.state.tool === 'buildTile' || this.state.tool === 'eraseTile') && this.lastBuildingPoint) {
      const previous = this.lastBuildingPoint;
      this.lastBuildingPoint = { ...point };
      const steps = Math.max(Math.abs(point.x - previous.x), Math.abs(point.y - previous.y));
      // Fill skipped pointer samples, but never expand a teleport into a million-cell stroke.
      if (Number.isInteger(steps) && steps > 0 && steps <= 512) {
        let changed: EditorChange = 'none';
        for (let i = 1; i <= steps; i++) {
          const at = {
            x: Math.round(previous.x + (point.x - previous.x) * i / steps),
            y: Math.round(previous.y + (point.y - previous.y) * i / steps),
          };
          if (this.apply(at, false, false) !== 'none') changed = 'building';
        }
        if (changed !== 'none') this.onChange(changed);
        return changed;
      }
    }
    return this.apply(point, false);
  }

  end(): void {
    const held = this.carrying;
    this.dragging = false;
    this.carrying = null;
    if (held !== null) this.land(held);
    this.lastBuildingPoint = null;
    this.strokeTiles.clear();
    this.buildingStroke.clear();
    // Releasing the pointer closes the undo step, so a second stroke of the same
    // brush is a second undo rather than joining the first.
    this.session.endGroup();
  }

  private apply(point: Point, pressed: boolean, notify = true): EditorChange {
    if (this.state.tool === 'buildTile' || this.state.tool === 'eraseTile') {
      const { state } = this;
      if (!isBuildCoordinate(point.x)) return 'none';
      if (!isBuildCoordinate(point.y)) return 'none';
      if (!isBuildZ(state.buildLevel)) return 'none';
      const changed = this.session.run(
        new BuildingEdit(this.sceneId, this.brushPieces(point), state.tool === 'eraseTile'),
      );
      if (changed && notify) this.onChange('building');
      return changed ? 'building' : 'none';
    }
    const scene = this.scene;
    if (['prop', 'interactable', 'adversary'].includes(this.state.tool) || (this.mode === 'terrain' && this.state.tool === 'erase')) {
      if (!isBuildCoordinate(point.x) || !isBuildCoordinate(point.y)) return 'none';
      const changed = this.run(point, [], pressed);
      if (changed !== 'none') this.onChange(changed);
      return changed;
    }
    if (!inBounds(scene, point)) return 'none';

    const tiles = brushTiles(scene, point, this.state.brushSize).filter(
      (tile) => !this.strokeTiles.has(tile),
    );
    if (CONTINUOUS.has(this.state.tool)) {
      if (tiles.length === 0) return 'none';
      for (const tile of tiles) this.strokeTiles.add(tile);
    }

    const change = this.run(point, tiles, pressed);
    if (change !== 'none') this.onChange(change);
    return change;
  }

  /**
   * One piece per cell the brush covers, skipping any this stroke already
   * stamped: dragging back over a cell must not stack a second copy on it,
   * while a fresh click on the same cell may.
   */
  private brushPieces(point: Point): BuildingTile[] {
    const { state } = this;
    const pieces: BuildingTile[] = [];
    const radius = Math.floor(Math.min(15, Math.max(1, state.brushSize)) / 2);
    for (let y = point.y - radius; y <= point.y + radius; y++) {
      for (let x = point.x - radius; x <= point.x + radius; x++) {
        if (!isBuildCoordinate(x) || !isBuildCoordinate(y)) continue;
        const cell = `${x},${y},${state.buildLevel}`;
        if (this.buildingStroke.has(cell)) continue;
        this.buildingStroke.add(cell);
        pieces.push({
          x,
          y,
          level: state.buildLevel,
          shape: state.buildShape,
          material: state.buildMaterial,
          rotation: state.buildRotation,
          height: state.buildHeight,
        });
      }
    }
    return pieces;
  }

  private run(point: Point, tiles: number[], pressed: boolean): EditorChange {
    const { session, sceneId, state } = this;
    switch (state.tool) {
      case 'buildTile':
      case 'eraseTile': return 'none'; // Sparse tools are handled before rectangular bounds.
      case 'select': {
        if (!pressed) return 'none';
        // Selecting is not an edit — nothing enters the undo history — but the
        // panel has to redraw, so it reports a change.
        // Combat selects creatures, the Inspector selects objects: the same tool
        // picks whichever kind the mode is about. Either takes hold of what it is
        // pressed on, so a drag carries it off.
        if (this.mode === 'combat') {
          const held = this.pickUp(point, ['creature', 'spawn']);
          const creature = held?.kind === 'creature' ? held.key : null;
          if (creature === this.selectedAdversary) return 'none';
          this.selectedAdversary = creature;
          return 'content';
        }
        const held = this.pickUp(point, ['object', 'creature', 'prop', 'spawn']);
        const next = held?.kind === 'object' ? held.key : null;
        if (next === this.selected) return 'none';
        this.selected = next;
        return 'content';
      }

      // Each reports 'none' when the session discarded the edit as a no-op, so a
      // viewport does not rebuild for a brush painting what was already there.
      case 'placeTile':
        return session.run(placeTile(sceneId, tiles, state.tileId)) ? 'terrain' : 'none';

      case 'raise':
        return session.run(adjustHeight(sceneId, tiles, 1)) ? 'terrain' : 'none';

      case 'lower':
        return session.run(adjustHeight(sceneId, tiles, -1)) ? 'terrain' : 'none';

      case 'prop': {
        if (!pressed) return 'none';
        // Clicking a tile that already holds this prop turns it, which is how the
        // legacy editor let one palette entry cover four facings.
        const existing = this.decoAt(point);
        if (existing !== null && existing.model === state.propModel) {
          session.run(rotateDeco(sceneId, point, state.rotationStep));
        } else {
          const deco: Deco = {
            model: state.propModel,
            position: this.placementAt(point),
            rotation: state.buildRotation * Math.PI / 2,
          };
          session.run(addDeco(sceneId, deco));
        }
        return 'content';
      }

      case 'spawn': {
        if (!pressed) return 'none';
        const spawns = this.scene.spawns;
        const at = spawns.findIndex((s) => s.x === point.x && s.y === point.y);
        const next = at >= 0 ? spawns.filter((_, i) => i !== at) : [...spawns, { ...point }];
        session.run(setSpawns(sceneId, next));
        return 'content';
      }

      case 'interactable': {
        if (!pressed) return 'none';
        const existing = this.interactableAt(point);
        if (existing !== null) {
          session.run(removeInteractable(sceneId, existing.id));
          return 'content';
        }
        session.run(addInteractable(sceneId, this.newInteractable(point)));
        return 'content';
      }

      case 'adversary': {
        if (!pressed) return 'none';
        // Pressing on a creature picks it up, to be carried; only bare ground gets a new one.
        const standing = this.pickUp(point, ['creature']);
        if (standing !== null) {
          this.selectedAdversary = standing.key;
          return 'content';
        }
        const encounter = this.ensureEncounter();
        session.run(
          addAdversary(sceneId, encounter.id, {
            id: this.uniqueId(`${encounter.id}-${state.adversaryId}`, point),
            adversary: state.adversaryId,
            position: this.placementAt(point),
          }),
        );
        return 'content';
      }

      case 'trigger': {
        if (!pressed) return 'none';
        const encounter = this.ensureEncounter();
        session.run(toggleTriggerCell(sceneId, encounter.id, point));
        return 'content';
      }

      case 'erase': {
        if (this.mode === 'combat') return this.eraseForCombat(point);
        // Topmost content first, so one tool clears a stack a click at a time.
        const deco = this.decoAt(point);
        if (deco !== null) {
          session.run(removeDecoAt(sceneId, point));
          return 'content';
        }
        const interactable = this.interactableAt(point);
        if (interactable !== null) {
          session.run(removeInteractable(sceneId, interactable.id));
          return 'content';
        }
        return 'none';
      }
    }
  }

  /**
   * Combat's eraser: the creature on the tile, else the trigger cell, else a
   * party start - never the last one, since a room must have somewhere to put
   * the party.
   */
  private eraseForCombat(point: Point): EditorChange {
    const { session, sceneId } = this;
    const scene = this.scene;
    const here = (p: Point): boolean => p.x === point.x && p.y === point.y;
    for (const encounter of scene.encounters) {
      const placed = encounter.adversaries.find((a) => here(a.position));
      if (placed !== undefined) {
        session.run(removeAdversary(sceneId, encounter.id, placed.id));
        return 'content';
      }
    }
    for (const encounter of scene.encounters) {
      if (encounter.triggerCells.some(here)) {
        session.run(toggleTriggerCell(sceneId, encounter.id, point));
        return 'content';
      }
    }
    const at = scene.spawns.findIndex(here);
    if (at >= 0 && scene.spawns.length > 1) {
      session.run(setSpawns(sceneId, scene.spawns.filter((_, i) => i !== at)));
      return 'content';
    }
    return 'none';
  }

  /** What the pointer is carrying, for a viewport to lift: its kind, and its id or place in its list. */
  get carried(): { kind: CarryKind; key: string; rotation?: number } | null {
    if (this.carrying === null) return null;
    const { kind, key, rotation } = this.carrying;
    return { kind, key, ...(rotation === undefined ? {} : { rotation }) };
  }

  /**
   * Turn what is in hand to a quarter turn, the way Alt faces something being placed.
   *
   * A prop and an object both have a facing in the document; a creature and a party
   * start have none, so those are left alone. Answers whether the facing actually
   * moved, so a view redraws only when it did.
   */
  turnCarried(quarter: number): boolean {
    return this.turnCarriedTo(((((quarter % 4) + 4) % 4) * Math.PI) / 2);
  }

  /**
   * Take an Alt gesture's quarter turn, for whatever the gesture is about.
   *
   * A prop in hand turns where it hangs and answers `carried`, so a view can show it.
   * Otherwise it is the facing of the thing being placed, and `placed` says the strip
   * showing that facing wants redrawing. `null` is a turn that changed nothing.
   */
  turnBy(quarter: number): 'carried' | 'placed' | null {
    if (this.carriedFacing !== null) return this.turnCarried(quarter) ? 'carried' : null;
    if (quarter === this.state.buildRotation) return null;
    this.set('buildRotation', quarter);
    return 'placed';
  }

  /** Which kinds of thing have a facing to turn at all. */
  private static readonly TURNS: readonly CarryKind[] = ['prop', 'object'];

  /** The facing the thing in hand will land with, in radians, or null with nothing to turn. */
  get carriedFacing(): number | null {
    const held = this.carrying;
    return held === null || !EditorController.TURNS.includes(held.kind) ? null : (held.rotation ?? 0);
  }

  private turnCarriedTo(radians: number): boolean {
    const held = this.carrying;
    if (held === null || !EditorController.TURNS.includes(held.kind)) return false;
    if (held.rotation !== undefined && Math.abs(held.rotation - radians) < 1e-9) return false;
    held.rotation = radians;
    return true;
  }

  /** Take hold of the first of these kinds of thing on a tile, for the rest of this press, and say what it was. */
  private pickUp(point: Point, kinds: readonly CarryKind[]): Carry | null {
    this.carrying = null;
    for (const kind of kinds) {
      const found = this.thingAt(kind, point);
      if (found !== null) return (this.carrying = found);
    }
    return null;
  }

  /** The thing of one kind on a tile, as something to carry. */
  private thingAt(kind: CarryKind, point: Point): Carry | null {
    const scene = this.scene;
    const hold = (key: string, at: Position, encounterId?: string, rotation?: number): Carry =>
      ({
        kind,
        key,
        ...(encounterId === undefined ? {} : { encounterId }),
        ...(rotation === undefined ? {} : { rotation }),
        from: { ...at },
        to: { ...at },
      });
    switch (kind) {
      case 'creature': {
        const placed = this.adversaryAt(point);
        const encounter = placed === null ? undefined : scene.encounters.find((e) => e.adversaries.includes(placed));
        return placed === null || encounter === undefined ? null : hold(placed.id, placed.position, encounter.id);
      }
      case 'object': {
        const object = this.interactableAt(point);
        return object === null ? null : hold(object.id, object.position, undefined, object.rotation);
      }
      case 'prop': {
        const deco = this.decoAt(point);
        return deco === null ? null : hold(String(scene.decos.lastIndexOf(deco)), deco.position, undefined, deco.rotation);
      }
      case 'spawn': {
        const index = scene.spawns.findIndex((s) => s.x === point.x && s.y === point.y);
        return index < 0 ? null : hold(String(index), scene.spawns[index]!);
      }
    }
  }

  /**
   * Move where the thing in hand will land to the tile under the pointer; the document waits for the
   * release. The place tool puts it at the plane's Z, as a fresh placement would be, since its ladder
   * is on screen; Select keeps the thing's own height, since the Inspector shows no ladder and the
   * level last built on is nothing to do with it. It never lands on another of its kind - props
   * excepted, which stack - so it waits on the last free tile; and a party start stays in the room.
   */
  private carry(point: Point): EditorChange {
    const held = this.carrying!;
    if (!isBuildCoordinate(point.x) || !isBuildCoordinate(point.y)) return 'none';
    if (held.kind === 'spawn' && !inBounds(this.scene, point)) return 'none';
    const there = held.kind === 'prop' ? null : this.thingAt(held.kind, point);
    if (there !== null && there.key !== held.key) return 'none';
    held.to = held.kind === 'spawn' ? { ...point }
      : this.state.tool === 'adversary' ? this.placementAt(point)
      : { ...point, ...(held.from.z === undefined ? {} : { z: held.from.z }) };
    return 'none';
  }

  /** Put the thing in hand down where it was carried to: one edit, and none at all if it never moved. */
  private land(held: Carry): void {
    const { sceneId } = this;
    const edit =
      held.kind === 'creature' ? moveAdversary(sceneId, held.encounterId!, held.key, held.to)
      : held.kind === 'object' ? moveInteractable(sceneId, held.key, held.to, held.rotation)
      : held.kind === 'prop' ? moveDeco(sceneId, Number(held.key), held.to, held.rotation)
      : moveSpawn(sceneId, Number(held.key), held.to);
    if (this.session.run(edit)) this.onChange('content');
  }

  /**
   * Draw every tile of one kind of ground with a model, or put it back to its colour.
   *
   * Here rather than in the panel because the board has to be told: a document edit run
   * straight off the session notifies the session's subscribers, which redraws the panel
   * and nothing else. `'terrain'` is what rebuilds the ground.
   */
  setTerrainModel(terrainId: string, modelId: string | null): boolean {
    const changed = this.session.run(setTerrainModel(terrainId, modelId));
    if (changed) this.onChange('terrain');
    return changed;
  }

  /** The object the inspector should show, if it is still there. */
  selectedInteractable(): Interactable | null {
    if (this.selected === null) return null;
    return this.scene.interactables.find((i) => i.id === this.selected) ?? null;
  }

  /**
   * Where a placement tool puts something: the tile clicked, at the plane's Z.
   *
   * Z is left out at ground level so a document authored before construction
   * existed, and one authored on the ground since, are the same document.
   */
  private placementAt(point: Point): { x: number; y: number; z?: number } {
    if (this.state.buildLevel === 0) return { ...point };
    return { ...point, z: this.state.buildLevel };
  }

  /** The prop on a tile, topmost first. */
  decoAt(point: Point): Deco | null {
    const decos = this.scene.decos;
    for (let i = decos.length - 1; i >= 0; i--) {
      const deco = decos[i]!;
      if (deco.position.x === point.x && deco.position.y === point.y) return deco;
    }
    return null;
  }

  interactableAt(point: Point): Interactable | null {
    return (
      this.scene.interactables.find(
        (i) => i.position.x === point.x && i.position.y === point.y,
      ) ?? null
    );
  }

  /** The creature standing on a tile, most recently placed first. */
  adversaryAt(point: Point): Encounter['adversaries'][number] | null {
    for (const encounter of this.scene.encounters) {
      for (let i = encounter.adversaries.length - 1; i >= 0; i--) {
        const placement = encounter.adversaries[i]!;
        if (placement.position.x === point.x && placement.position.y === point.y) return placement;
      }
    }
    return null;
  }

  /** The creature Combat's panel should show, if it is still in the room. */
  selectedPlacement(): Encounter['adversaries'][number] | null {
    if (this.selectedAdversary === null) return null;
    for (const encounter of this.scene.encounters) {
      const found = encounter.adversaries.find((a) => a.id === this.selectedAdversary);
      if (found !== undefined) return found;
    }
    return null;
  }

  /** Which encounter holds the selected creature — what an edit to it needs. */
  selectedPlacementEncounter(): string | null {
    if (this.selectedAdversary === null) return null;
    for (const encounter of this.scene.encounters) {
      if (encounter.adversaries.some((a) => a.id === this.selectedAdversary)) return encounter.id;
    }
    return null;
  }

  /** Everything on a tile, for an inspector panel. */
  inspect(point: Point): {
    terrain: string;
    height: number;
    deco: Deco | null;
    interactable: Interactable | null;
    isSpawn: boolean;
    encounters: string[];
  } {
    const scene = this.scene;
    const tile = point.y * scene.width + point.x;
    return {
      terrain: scene.terrain[tile] ?? '',
      height: scene.heights[tile] ?? 0,
      deco: this.decoAt(point),
      interactable: this.interactableAt(point),
      isSpawn: scene.spawns.some((s) => s.x === point.x && s.y === point.y),
      encounters: scene.encounters
        .filter(
          (e) =>
            e.triggerCells.some((c) => c.x === point.x && c.y === point.y) ||
            e.adversaries.some((a) => a.position.x === point.x && a.position.y === point.y),
        )
        .map((e) => e.id),
    };
  }

  /**
   * The encounter adversaries and triggers go into, creating one if the scene has
   * none — placing an enemy should not first require a trip to another panel.
   */
  private ensureEncounter(): Encounter {
    const scene = this.scene;
    const selected =
      this.state.encounterId === null
        ? undefined
        : scene.encounters.find((e) => e.id === this.state.encounterId);
    if (selected !== undefined) return selected;

    const existing = scene.encounters[0];
    if (existing !== undefined) {
      this.state.encounterId = existing.id;
      return existing;
    }

    const created: Encounter = {
      id: this.uniqueEncounterId(),
      name: 'Encounter 1',
      adversaries: [],
      triggerCells: [],
      startsOnTrigger: true,
    };
    this.session.run(addEncounter(this.sceneId, created));
    this.state.encounterId = created.id;
    return created;
  }

  private uniqueEncounterId(): string {
    const taken = new Set(this.scene.encounters.map((e) => e.id));
    let n = 1;
    while (taken.has(`encounter-${n}`)) n++;
    return `encounter-${n}`;
  }

  private newInteractable(point: Point): Interactable {
    return {
      id: this.uniqueId(this.state.interactableKind, point),
      kind: this.state.interactableKind,
      position: this.placementAt(point),
      name: '',
      flavor: '',
      model: null,
      rotation: 0,
      blocksMovement: true,
      repeatable: false,
      effects: [],
      lockedText: '',
      tags: [],
      data: {},
    };
  }

  /**
   * A stable id from the thing and where it stands, with a counter only if that
   * collides. Positional ids match what the legacy importer produces, so hand-made
   * and imported content read the same.
   */
  private uniqueId(prefix: string, point: Point): string {
    const scene = this.scene;
    const taken = new Set<string>([
      ...scene.interactables.map((i) => i.id),
      ...scene.encounters.map((e) => e.id),
      ...scene.encounters.flatMap((e) => e.adversaries.map((a) => a.id)),
    ]);
    const base = toContentId(`${prefix}-${point.x}-${point.y}`);
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }
}

function inBounds(scene: SceneDoc, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < scene.width && point.y < scene.height;
}
