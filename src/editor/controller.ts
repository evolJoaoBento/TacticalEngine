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
import type { Deco, Encounter, Interactable, Point, SceneDoc } from '../engine/scene/schema';
import {
  EditorSession,
  addAdversary,
  addDeco,
  addEncounter,
  addInteractable,
  adjustHeight,
  brushTiles,
  paintTerrain,
  removeDecoAt,
  removeInteractable,
  rotateDeco,
  setSpawns,
  toggleTriggerCell,
} from './session';

export type EditorTool =
  /** Click things to inspect them; changes nothing. */
  | 'select'
  | 'paintTerrain'
  | 'raise'
  | 'lower'
  | 'prop'
  | 'spawn'
  | 'interactable'
  | 'adversary'
  | 'trigger'
  | 'erase';

/** Tools that act on every tile a drag crosses. */
const CONTINUOUS = new Set<EditorTool>(['paintTerrain', 'raise', 'lower', 'erase']);

export interface EditorToolState {
  tool: EditorTool;
  /** Terrain the brush paints. */
  terrainId: string;
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
  tool: 'paintTerrain',
  terrainId: 'floor',
  propModel: 'crate',
  interactableKind: 'chest',
  adversaryId: 'tangle-bramble',
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
export type EditorChange = 'terrain' | 'content' | 'none';

export class EditorController {
  readonly session: EditorSession;
  sceneId: string;
  state: EditorToolState;
  private readonly onChange: (change: EditorChange) => void;
  /** Tiles already painted in this drag, so one stroke does not re-edit them. */
  private readonly strokeTiles = new Set<number>();
  private dragging = false;
  /** The object the inspector is showing, if the select tool has hit one. */
  selected: string | null = null;

  constructor(options: EditorControllerOptions) {
    this.session = options.session;
    this.sceneId = options.sceneId;
    this.state = { ...DEFAULT_TOOL_STATE, ...options.state };
    this.onChange = options.onChange ?? ((): void => {});
  }

  get scene(): SceneDoc {
    return this.session.requireScene(this.sceneId);
  }

  /** Change tools, ending any drag in progress. */
  setTool(tool: EditorTool): void {
    this.end();
    this.state.tool = tool;
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
  }

  set<K extends keyof EditorToolState>(key: K, value: EditorToolState[K]): void {
    this.state[key] = value;
  }

  /** Press. Applies the tool once; a continuous tool then follows the pointer. */
  begin(point: Point): EditorChange {
    this.dragging = true;
    this.strokeTiles.clear();
    return this.apply(point, true);
  }

  /** Pointer moved to a new tile while pressed. */
  paint(point: Point): EditorChange {
    if (!this.dragging) return 'none';
    if (!CONTINUOUS.has(this.state.tool)) return 'none';
    return this.apply(point, false);
  }

  end(): void {
    this.dragging = false;
    this.strokeTiles.clear();
    // Releasing the pointer closes the undo step, so a second stroke of the same
    // brush is a second undo rather than joining the first.
    this.session.endGroup();
  }

  private apply(point: Point, pressed: boolean): EditorChange {
    const scene = this.scene;
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

  private run(point: Point, tiles: number[], pressed: boolean): EditorChange {
    const { session, sceneId, state } = this;
    switch (state.tool) {
      case 'select': {
        if (!pressed) return 'none';
        // Selecting is not an edit — nothing enters the undo history — but the
        // panel has to redraw, so it reports a change.
        const found = this.interactableAt(point);
        const next = found?.id ?? null;
        if (next === this.selected) return 'none';
        this.selected = next;
        return 'content';
      }

      // Each reports 'none' when the session discarded the edit as a no-op, so a
      // viewport does not rebuild for a brush painting what was already there.
      case 'paintTerrain':
        return session.run(paintTerrain(sceneId, tiles, state.terrainId)) ? 'terrain' : 'none';

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
          const deco: Deco = { model: state.propModel, position: { ...point }, rotation: 0 };
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
        const encounter = this.ensureEncounter();
        session.run(
          addAdversary(sceneId, encounter.id, {
            id: this.uniqueId(`${encounter.id}-${state.adversaryId}`, point),
            adversary: state.adversaryId,
            position: { ...point },
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

  /** The object the inspector should show, if it is still there. */
  selectedInteractable(): Interactable | null {
    if (this.selected === null) return null;
    return this.scene.interactables.find((i) => i.id === this.selected) ?? null;
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
      position: { ...point },
      name: '',
      flavor: '',
      model: null,
      blocksMovement: true,
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
