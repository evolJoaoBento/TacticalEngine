/**
 * The test driver's handle on the page (`main.ts` sets it): what the browser specs drive the game through, and nothing
 * in the engine reads. One declaration, which the specs see too, so there is no copy of it to keep in step.
 */

import type { BuildingStats } from '../engine/render/building-view';
import type { Response } from '../engine/script/runner';

export interface EngineDriver {
  webgl2: boolean;
  frames: number;
  errors: string[];
  tiles: number;
  entities: number;
  decos: number;
  missingModels: () => string[];
  party: () => string[];
  selected: () => string | null;
  select: (id: string) => boolean;
  selectNext: () => string | null;
  linked: (id: string) => string[];
  link: (id: string, withId: string) => boolean;
  unlink: (id: string) => boolean;
  tileOf: (id: string) => number;
  /** The zones standing on the board, and the tiles each one holds. */
  zones: () => { id: string; name: string; tiles: number[] }[];
  inCombat: () => boolean;
  round: () => number;
  adversaries: () => string[];
  hitPoints: (id: string) => { marked: number; max: number };
  moveTo: (tile: number) => boolean;
  /** Walk the selected member to a spot, in tile units: where a click on the ground lands. */
  walkTo: (x: number, y: number) => boolean;
  /** Where somebody stands, in tile units; null off the map or unknown. */
  standingAt: (id: string) => { x: number; y: number } | null;
  /** Where the figure is on the screen, which mid-walk is not where `standingAt` says. */
  standingNow: (id: string) => { x: number; y: number } | null;
  /** Where a spot on the ground lands on screen, in CSS pixels. */
  screenAt: (x: number, y: number) => { x: number; y: number };
  /** The line a click on a spot would walk, and what lies beyond one move of it; null for nowhere to go. */
  previewAt: (x: number, y: number) => { route: { x: number; y: number }[]; beyond: { x: number; y: number }[]; run: boolean } | null;
  /** How many points the hover path is drawn through on the board right now. */
  pathPoints: () => number;
  attack: (id: string) => boolean;
  endGmTurn: () => number;
  highlighted: () => number;
  reachable: () => number[];
  sample: (x: number, y: number) => number[];
  /** Editor handles. */
  use: (id: string) => string;
  /** What a click on a thing does: walks up to it when it is out of reach and this move gets there, then uses it. */
  approach: (id: string) => string;
  useInReach: () => string;
  answer: (response: Response) => string;
  log: () => { text: string; tone: string }[];
  /** How long the Duality Dice take to settle. Zero for a test in a hurry. */
  setDiceSpeed: (millis: number) => void;
  /** The Duality rolls still waiting to be watched. */
  dice: () => { good: number; bad: number; total: number }[];
  /** Forget the rolls still waiting to be shown. */
  clearDice: () => void;
  pendingKind: () => string | null;
  /** Whom the question open waits on, as the page's panel says it (`waitingOn`) - read from the game, not the page drawn. */
  waitingOn: () => string | null;
  /** How many lamps the room's fires and torches light (`render/room-light.ts`): none in daylight. */
  lamps: () => number;
  objects: () => string[];
  /** The container whose window is open, and what is left in it. */
  container: () => { id: string; lines: { item: string; count: number }[] } | null;
  take: (item: string) => boolean;
  /** How far a door is swung from its facing, in radians; null for a prop that is not a door. */
  doorAngle: (id: string) => number | null;
  dialogueOptions: () => string[];
  hasDialogue: () => boolean;
  within: () => string | null;
  standBeside: (id: string) => boolean;
  sceneId: () => string;
  sceneTiles: () => number;
  travelTo: (scene: string) => boolean;
  scenes: () => string[];
  editScene: () => string;
  /** Start playing in the room being edited, gathered round a tile, or on its spawns for null. */
  playAt: (tile: number | null) => boolean;
  switchScene: (id: string) => void;
  addScene: (name: string) => string;
  removeScene: (id: string) => boolean;
  selectObject: (id: string) => boolean;
  editObject: (changes: Record<string, unknown>) => void;
  objectField: (field: string) => unknown;
  nodePosition: (dialogue: string, node: string) => { x: number; y: number } | null;
  dialogueNodes: (dialogue: string) => string[];
  carried: () => { id: string; name: string; quantity: number }[];
  equip: (id: string) => string;
  useItem: (id: string) => string;
  objectState: (id: string) => { used: boolean; open: boolean; removed: boolean };
  objectTile: (id: string) => number;
  inspect: (tile: number) => { kind: string; id: string; name: string; facts: string[] } | null;
  animating: () => number;
  /** The clip playing on a creature's imported model, or null for a procedural one. */
  clipOf: (id: string) => string | null;
  wound: (id: string, marks: number) => void;
  markStress: (id: string, marks: number) => void;
  stressOf: (id: string) => { marked: number; max: number };
  gear: (id: string) => { weapon: string; armor: string };
  giveItem: (id: string, quantity?: number) => void;
  journal: () => { id: string; status: string; done: string[]; summary: string }[];
  camera: () => { yaw: number; pitch: number; distance: number; target: { x: number; z: number } };
  grantLevel: (level?: number) => number;
  addAsset: (asset: unknown) => boolean;
  assetStatus: (id: string) => string;
  modelSource: (id: string) => string;
  placeProp: (tile: number, model: string) => void;
  awaitingLevel: () => string[];
  abilities: (id: string) => { id: string; usable: boolean; reason: string | null; targets: string[] }[];
  useAbility: (id: string, ability: string, targets?: string[], point?: number) => string;
  /** Arm the bar the way clicking the card does, for a test that then clicks the board. */
  aim: (ability: string) => number[];
  /** The tiles the board is lighting up right now. */
  lit: () => number[];
  /** Who a card aimed at this tile would catch, without aiming it. */
  shape: (ability: string, tile: number) => string[];
  /** Fill somebody's Light, for a test about a card that costs some. */
  setGood: (id: string, value: number) => void;
  passToGm: () => number;
  loadout: (id: string) => { loadout: string[]; vault: string[]; granted: string[] };
  swapCard: (id: string, cardIn: string, cardOut?: string) => string | null;
  rest: (kind: 'short' | 'long', plan: unknown) => boolean;
  conditionsOf: (id: string) => string[];
  /** Where a click would ask the selected fighter for an Agility Roll: past one move, and a run away. */
  underPressure: () => number[];
  /** Put a condition on somebody, or take it off, for a test about what it does while it lasts. */
  setCondition: (id: string, condition: string, on: boolean) => boolean;
  targeting: () => string | null;
  standNear: (id: string) => boolean;
  setCards: (id: string, cards: string[]) => void;
  turnSide: () => string | null;
  startFight: () => boolean;
  takeLevel: (id: string, plan: unknown) => boolean;
  characterLevel: (id: string) => number;
  cursorTile: () => number;
  arc: () => 'ok' | 'blocked' | null;
  floaters: () => { id: string; text: string }[];
  /** How many tokens are still walking to where their creature already is. */
  gliding: () => number;
  ripples: () => number;
  /** Skip the walk: let the fight a move woke begin now. True when one did. */
  arrive: () => boolean;
  /** How many tokens are flinching, falling or getting up. */
  reacting: () => number;
  screenOf: (tile: number) => { x: number; y: number };
  save: () => boolean;
  load: () => boolean;
  saveAs: (name: string) => string | null;
  loadSlot: (id: string) => boolean;
  saves: () => { id: string; name: string; where: string; savedAt: number }[];
  saveBlocked: () => string | null;
  saveText: () => string | null;
  mode: () => 'play' | 'edit';
  setMode: (mode: 'play' | 'edit') => void;
  /** The top bar's mode: 'inspect', 'terrain', 'combat' or 'interaction'. */
  editorMode: () => string;
  /** Switch the top bar's mode, as pressing 1-4 would. */
  setEditorMode: (mode: string) => void;
  setTool: (tool: string) => void;
  /** The tool actually in hand, which a rail button's pressed state only implies. */
  editorTool: () => string;
  /** Which of Terrain's strips is open, and so which tools its rail offers. */
  editorTerrainTab: () => string;
  setTerrain: (id: string) => void;
  buildingStats: () => BuildingStats; groundSurfaces: () => string[]; // and the kinds of ground drawn in a material
  pieceModels: () => number;
  authoredCreatureCount: () => number;
  buildAt: (x: number, y: number) => boolean;
  buildScreenAt: (x: number, y: number) => { x: number; y: number };
  editAt: (tile: number) => boolean;
  /** The half-solid prop under the pointer, when the editor is showing one. */
  propGhost: () => { id: string; span: number } | null;
  terrainAt: (tile: number) => string;
  heightAt: (tile: number) => number;
  undo: () => boolean;
  redo: () => boolean;
  propCount: () => number;
  /** Whether an Alt facing gesture is under way; blur and keyup must end it. */
  altRotating: () => boolean;
  problems: () => number;
  exportProject: () => string;
  loadProjectText: (text: string) => string;
  /** Import a pack file's text into the project being edited, as the Project menu does. */
  importPackText: (text: string, label?: string) => { imported: boolean; message: string };
}

declare global {
  interface Window {
    /** Test and debug handle. Nothing in the engine reads it. */
    __engine?: EngineDriver;
  }
}
