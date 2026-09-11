/**
 * The demo page: play mode and edit mode over one scene.
 *
 * Everything that genuinely needs a browser — a WebGL renderer, a camera, pointer
 * and key events, a file picker — and nothing else. What a click *means* lives in
 * `game/demo-scene.ts` and `editor/controller.ts`, both of which run anywhere, so
 * the interesting half is tested without a page.
 *
 * Play: click a companion to take control, click the ground to walk (the rest
 * follow), Tab to cycle, click an adversary to attack, Space for the GM's turn.
 * Edit: pick a mode in the top bar (1-4), a tool on its rail and a thing from
 * its strip, then click or drag on the map. Ctrl+Z / Ctrl+Shift+Z undo and redo.
 */

import { Fragment, h, render } from 'preact';
import {
  PCFSoftShadowMap,
  Plane,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Mesh,
  type Object3D,
} from 'three';
import { demoMap } from '../legacy/js/data.js';
import { EditorController } from './editor/controller';
import { EDITOR_MODES, type EditorMode } from './editor/modes';
import {
  EditorSession,
  addAsset,
  removeAsset,
  addScene,
  removeScene,
  renameScene,
  setStartScene,
  updateInteractable,
} from './editor/session';
import { EditorShell } from './editor/ui/EditorShell';
import { PlayPanel, TONE, type Inspection, type JournalQuest } from './game/ui/PlayPanel';
import { PartyHud, type HudMember } from './game/ui/PartyHud';
import { LevelUpPanel } from './game/ui/LevelUpPanel';
import { deriveCharacter } from './engine/character/sheet';
import { ActionBar } from './game/ui/ActionBar';
import { LoadoutPanel } from './game/ui/LoadoutPanel';
import { RestPanel } from './game/ui/RestPanel';
import { DiceTray } from './game/ui/DiceTray';
import {
  abilityList,
  abilityTargets,
  abilitiesOf,
  loadoutView,
  pointTiles,
  rest,
  shapeAt,
  swapCard,
  useAbility,
  type RestPlan,
} from './game/demo-abilities';
import type { LevelUpIssue, LevelUpPlan } from './engine/character/progression';
import { OrbitCamera } from './engine/render/camera';
import { BuildingView, type BuildingStats } from './engine/render/building-view';
import { syncAuthoredEncounters } from './game/authored-encounters';
import { BUILD_LIMIT, isBuildCoordinate } from './engine/scene/building';
import { AssetLibrary, modelAssetSchema, type ModelAsset } from './engine/render/assets';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NO_TILE, type Spot, type TileGrid } from './engine/grid/grid';
import { mapExtent, spotToWorld, tileAtWorld, tileCenter, worldToSpot } from './engine/render/layout';
import { MODELS } from './engine/render/procedural/registry';
import { SceneView, hueOf } from './engine/render/scene-view';
import { DEFAULT_TERRAIN_COLORS } from './engine/render/terrain-mesh';
import { journalSummary } from './engine/content/quests';
import { blankScene, gridFromScene } from './engine/scene/grid-from-scene';
import { importLegacyScene } from './engine/scene/legacy-import';
import {
  projectSchema,
  type Interactable,
  type ProjectDoc,
  type SceneDoc,
} from './engine/scene/schema';
import type { Response } from './engine/script/runner';
import { loadGameText, saveBlockedBy, serialiseSave } from './game/save';
import { AUTO_SLOT, QUICK_SLOT, SaveSlots, browserStore } from './game/save-slots';
import { CardArtImports, loadCardArtIndex, useCardArtImports, useCardArtIndex } from './game/ui/card-art';
import {
  answerPending,
  attackWithSelected,
  buildDemoScene,
  inCombat,
  applyLevelUp,
  awaitingLevel,
  equipItem,
  gearOf,
  useItem,
  moveSelectedTo,
  arrive,
  previewStrike,
  previewWalk,
  note,
  playGmTurn,
  endTurn,
  nameOf,
  startEncounter,
  refreshWorld,
  syncPools,
  syncRoster,
  gatherParty,
  scriptPending,
  reachableInteractable,
  travelTo,
  useSelectedOn,
  reachableTiles,
  DEMO_ADVERSARY_ID,
  DEMO_MODELS,
  SRD_ADVERSARIES,
  SRD_CHARACTERS,
  buildProjectScene,
  setSheet,
  type DemoScene,
} from './game/demo-scene';
import { SRD_HOOKS } from './engine/content/srd/hooks';
import { SRD_ABILITIES } from './engine/content/srd/abilities';

declare global {
  interface Window {
    /** Test and debug handle. Nothing in the engine reads it. */
    __polyheart?: {
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
      /** Where a spot on the ground lands on screen, in CSS pixels. */
      screenAt: (x: number, y: number) => { x: number; y: number };
      /** The line a click on a spot would walk, and what lies beyond one move of it; null for nowhere to go. */
      previewAt: (x: number, y: number) => { route: { x: number; y: number }[]; beyond: { x: number; y: number }[] } | null;
      /** How many points the hover path is drawn through on the board right now. */
      pathPoints: () => number;
      attack: (id: string) => boolean;
      endGmTurn: () => number;
      highlighted: () => number;
      reachable: () => number[];
      sample: (x: number, y: number) => number[];
      /** Editor handles. */
      use: (id: string) => string;
      useInReach: () => string;
      answer: (response: Response) => string;
      log: () => { text: string; tone: string }[];
      /** How long the Duality Dice take to settle. Zero for a test in a hurry. */
      setDiceSpeed: (millis: number) => void;
      /** The Duality rolls still waiting to be watched. */
      dice: () => { hope: number; fear: number; total: number }[];
      /** Forget the rolls still waiting to be shown. */
      clearDice: () => void;
      pendingKind: () => string | null;
      objects: () => string[];
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
      /** Fill somebody's Hope, for a test about a card that costs some. */
      setHope: (id: string, value: number) => void;
      passToGm: () => number;
      loadout: (id: string) => { loadout: string[]; vault: string[] };
      swapCard: (id: string, cardIn: string, cardOut?: string) => string | null;
      rest: (kind: 'short' | 'long', plan: unknown) => boolean;
      conditionsOf: (id: string) => string[];
      targeting: () => string | null;
      standNear: (id: string) => boolean;
      setCards: (id: string, cards: string[]) => void;
      turnSide: () => string | null;
      startFight: () => boolean;
      takeLevel: (id: string, plan: unknown) => boolean;
      characterLevel: (id: string) => number;
      cursorTile: () => number;
      floaters: () => { id: string; text: string }[];
      /** How many tokens are still walking to where their creature already is. */
      gliding: () => number;
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
      buildingStats: () => BuildingStats;
      authoredCreatureCount: () => number;
      buildAt: (x: number, y: number) => boolean;
      buildScreenAt: (x: number, y: number) => { x: number; y: number };
      editAt: (tile: number) => boolean;
      terrainAt: (tile: number) => string;
      heightAt: (tile: number) => number;
      undo: () => boolean;
      redo: () => boolean;
      propCount: () => number;
      problems: () => number;
      exportProject: () => string;
      loadProjectText: (text: string) => string;
    };
  }
}

const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const app = document.getElementById('app') as HTMLDivElement;

// ---------------------------------------------------------------------------
// Numbers over heads
// ---------------------------------------------------------------------------

/**
 * A layer of its own over the canvas, under the panels: a floater is a
 * positioned div rather than a sprite, so it is drawn with the page's font in
 * the log's tone colour and needs no texture.
 */
const floaterLayer = document.createElement('div');
floaterLayer.id = 'floaters';
Object.assign(floaterLayer.style, {
  position: 'absolute',
  inset: '0',
  overflow: 'hidden',
  pointerEvents: 'none',
  font: '600 15px/1 system-ui, sans-serif',
});
document.body.insertBefore(floaterLayer, app);

interface LiveFloater {
  el: HTMLDivElement;
  /** Whose head it rises over: it follows them, walking or thrown. */
  id: string;
  /** How many were already rising over them when this one was born. */
  stack: number;
  born: number;
}
const liveFloaters: LiveFloater[] = [];
const FLOATER_LIFE = 1.4;

/** Tell the view how everybody got where they are, before it looks. */
function drainMotions(): void {
  for (const motion of demo.motions) {
    if (motion.route !== undefined) view.walkAlong(motion.id, motion.route);
    else if (motion.path !== undefined) view.walk(motion.id, motion.path);
    else if (motion.thrown === true) view.throwBack(motion.id);
    else if (motion.struck === true) view.flinch(motion.id);
    else if (motion.lunge !== undefined) view.lunge(motion.id, motion.lunge.at);
  }
  demo.motions.length = 0;
}

/** Take what the game wrote since the last draw and start it rising. */
function drainFloaters(): void {
  if (demo.floaters.length === 0) return;
  const now = performance.now();
  for (const floater of demo.floaters) {
    const tile = demo.state.entity(floater.id)?.tile ?? NO_TILE;
    if (tile === NO_TILE) continue;
    const stack = liveFloaters.filter((f) => f.id === floater.id).length;
    const el = document.createElement('div');
    el.dataset['testid'] = 'floater';
    el.dataset['entity'] = floater.id;
    el.textContent = floater.text;
    Object.assign(el.style, {
      position: 'absolute',
      transform: 'translate(-50%, -100%)',
      color: TONE[floater.tone],
      textShadow: '0 1px 2px #000, 0 0 6px rgba(0,0,0,0.8)',
      whiteSpace: 'nowrap',
    });
    floaterLayer.appendChild(el);
    liveFloaters.push({ el, id: floater.id, stack, born: now });
  }
  demo.floaters.length = 0;
  driveFloaters(now);
}

/** Move every rising number, and let go of the ones that have risen. */
function driveFloaters(now: number): void {
  for (let i = liveFloaters.length - 1; i >= 0; i--) {
    const f = liveFloaters[i]!;
    const age = (now - f.born) / 1000;
    if (age > FLOATER_LIFE) {
      f.el.remove();
      liveFloaters.splice(i, 1);
      continue;
    }
    const over = demo.state.entity(f.id);
    if (over === undefined || over.tile === NO_TILE) {
      f.el.remove();
      liveFloaters.splice(i, 1);
      continue;
    }
    const at = screenAt(over.at, 1.3);
    f.el.style.left = `${at.x}px`;
    f.el.style.top = `${at.y - age * 36 - f.stack * 18}px`;
    f.el.style.opacity = `${Math.max(0, 1 - Math.max(0, age - 0.7) / (FLOATER_LIFE - 0.7))}`;
  }
}
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight, false);
const gl = renderer.getContext();
const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

// ---------------------------------------------------------------------------
// The scene, and an editable project over the same map
// ---------------------------------------------------------------------------

// `let`, because loading a project restarts the game on it: everything below
// reads this binding rather than capturing the object it happens to hold.
let demo = buildDemoScene(demoMap());
// At the table the defender decides how a hit lands: an Armor Slot, a card,
// or an ally stepping in. The engine decides for itself in tests and headless
// runs, where there is nobody to ask.
demo.askDefender = true;
// The tokens walk; a fight the walk wakes starts when they get there.
demo.animated = true;

/** glTF files the project declares, loaded on first use. */
const gltfLoader = new GLTFLoader();
const assets = new AssetLibrary(
  (url) =>
    gltfLoader.loadAsync(url).then((gltf) => {
      // Clips live beside the scene in a glTF; keep them on it so a clone can play them.
      gltf.scene.animations = gltf.animations;
      return gltf.scene;
    }),
  demo.project.assets,
);

const view = new SceneView(demo.grid, {
  tints: demo.scene.tints,
  modelForEntity: (entity) => DEMO_MODELS[entity.definition] ?? entity.definition,
  // Almost none of the SRD's stat blocks have art of their own yet, and a board
  // of magenta markers cannot be read. A husk body stands in - and the view
  // still reports the real id as missing, so the models diagnostic and
  // `docs/CRPG-GAPS.md` keep saying what is still to be made.
  fallbackFor: (entity) => (entity.faction === 'adversary' ? 'husk' : null),
  assets,
});
view.setDecos(demo.scene.decos);
view.syncTokens(demo.state);
const buildings = new BuildingView();
view.scene.add(buildings.root);
buildings.sync(demo.scene);

/**
 * One project, edited and played.
 *
 * Re-parsing `demo.project` here would hand the editor a copy: terrain edits
 * would still reach the screen (the grid is written in place) while a new scene,
 * a renamed one, or a deleted one would be invisible to the game. The demo's
 * project is already schema-parsed, so it is the document.
 */
let project: ProjectDoc = demo.project;
let session = new EditorSession(project);
let editor = new EditorController({
  session,
  sceneId: demo.scene.id,
  onChange: (change) => {
    if (change === 'building') buildings.sync(editor.scene);
    if (change === 'terrain') rebuildTerrain();
    if (change === 'content') syncEditorContent();
  },
});

// The editor opens on the Inspector, the first of the top bar's modes.
editor.setMode('inspect');

const KNOWN_MODELS = new Set(MODELS.map((m) => m.id));
const TERRAIN_IDS = demo.grid.palette.types.map((t) => t.id);
const PROP_MODELS = MODELS.filter((m) => m.category === 'prop').map((m) => m.id);
const ADVERSARY_DEFS = [...SRD_ADVERSARIES.values()].sort((a, b) => a.name.localeCompare(b.name));

/** Redraw whichever panel the current mode owns. */
function refreshEditor(): void {
  rebuildTerrain();
  syncEditorContent();
  renderPanel();
}

/**
 * Redraw everything that hangs off the document rather than off play: the
 * scenery, and, in edit mode, the creatures the room places.
 *
 * In play it is the other half of that switch - the authored creatures come
 * down and the runtime tokens go back to standing where the fight put them.
 */
function syncEditorContent(): void {
  view.setDecos(activeScene().decos);
  view.setAuthoring(mode === 'edit' ? editor.scene : null, DEMO_MODELS);
}

/** A kebab-case id from a name, made unique against the scenes already there. */
function newSceneId(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scene';
  const taken = new Set(session.project.scenes.map((scene) => scene.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * The scene on screen.
 *
 * Playing shows the room the party is in. Editing shows the room being edited,
 * which is not necessarily the same one — browsing scenes in the editor must not
 * move the party, abandon their fight, or throw away a prompt they were holding.
 */
function activeScene(): SceneDoc {
  return mode === 'edit' ? editor.scene : demo.scene;
}

/** The grid under `activeScene()`. Shared with the party's when they coincide. */
let activeGrid: TileGrid = demo.grid;

/** Rebuild the grid from the edited document, then the meshes over it. */
function rebuildTerrain(): void {
  const scene = activeScene();
  const { grid } = gridFromScene(scene, activeGrid.palette);
  activeGrid.terrain.set(grid.terrain);
  activeGrid.heights.set(grid.heights);
  view.rebuildTerrain(scene.tints);
  buildings.sync(scene);
  // The scenery hangs off the ground that was just replaced, in either mode:
  // this is the one place that redraws it, so undo and redo do not have to.
  syncEditorContent();
}

/**
 * Undo from anywhere - a key, the top bar, a test - and redraw what it touched.
 * The top bar's button used to call the session alone and left the board stale.
 */
function undoEdit(): boolean {
  const ok = session.undo();
  // `rebuildTerrain` ends in `syncEditorContent`, which is what redraws the
  // scenery; setting the decos again here drew every prop twice over.
  rebuildTerrain();
  if (mode === 'edit') renderPanel();
  return ok;
}

function redoEdit(): boolean {
  const ok = session.redo();
  rebuildTerrain();
  if (mode === 'edit') renderPanel();
  return ok;
}

let mode: 'play' | 'edit' = 'play';

/**
 * Fold the project's cards back into the party's derived numbers.
 *
 * A card's `effects` are read live when it is played, but its `modifiers` — a
 * passive's "+1 to your Evasion" — are folded in when a character is derived.
 * Editing one in the Cards panel has to rebuild them, or the sheet would keep
 * the old Evasion until something else happened to rederive it.
 */
function rederiveParty(): void {
  // Whoever the panel added since the last Play arrives now, and whoever it
  // removed leaves - before the world is rebuilt, so it is built over them.
  syncRoster(demo);
  // The document is the truth: an edit in the Party panel replaces the sheet
  // in `project.party`, so the game's copy is re-read rather than rederived
  // from what it happened to boot with.
  for (const sheet of demo.project.party) {
    if (demo.sheets.has(sheet.id)) demo.sheets.set(sheet.id, sheet);
  }
  for (const [id, sheet] of demo.sheets) {
    demo.characters.set(id, deriveCharacter(sheet, SRD_CHARACTERS, demo.project.abilities).character);
  }
  // The world first: `syncPools` reads the modifiers a card grants through it.
  refreshWorld(demo);
  syncPools(demo);
}

/**
 * Play from here: the room being edited, at a tile of the designer's choosing.
 *
 * A designer testing a room walked the party to it from the vault door every
 * time. This puts them in the room - through `travelTo`, so the room is
 * entered the way play enters it - and, given a tile, gathers them round it
 * before the mode switches. With no tile they arrive on the room's spawns.
 */
function playAt(sceneId: string, tile: number | null): boolean {
  if (sceneId !== demo.scene.id && !travelTo(demo, sceneId)) return false;
  if (tile !== null) gatherParty(demo, tile);
  boundScene = '';
  setMode('play');
  frameParty();
  return true;
}

function setMode(next: 'play' | 'edit'): void {
  // Going back to play is a scene entry like any other: whatever the editor did
  // to the room the party is standing in has to reach the room they walk back
  // into. `DemoScene` remembers what it last stood the scene up from, so no
  // bookkeeping is needed on this side.
  if (next === 'play' && mode === 'edit') syncAuthoredEncounters(demo);
  mode = next;
  editor.end();
  // The tray only lives in the play tree, so dice still tumbling when the
  // editor opens have nowhere to land. Drop them rather than showing a roll
  // from before the edit when play comes back.
  if (mode === 'edit') demo.rolls.length = 0;
  // The editor may be pointed at a scene a load has since removed.
  if (!session.project.scenes.some((scene) => scene.id === editor.sceneId)) {
    editor.switchScene(demo.scene.id);
  }
  if (mode === 'play') {
    view.setAuthoring(null);
    // The build guide and its ghost belong to the editor; nothing in play would
    // hide them, because the per-frame update no longer runs there.
    buildings.showGuide(0, 0, 0, false);
    rederiveParty();
    rebindScene();
    refreshPlay();
  } else {
    rebindScene();
    view.clearHighlights();
    view.clearZones();
    view.showSelection(NO_TILE);
    syncEditorContent();
    renderPanel();
  }
}

function renderPanel(): void {
  render(
    h(EditorShell, {
      session,
      controller: editor,
      onNavigateBuilding: navigateBuilding,
      terrainIds: TERRAIN_IDS,
      terrainColors: DEFAULT_TERRAIN_COLORS,
      propModels: PROP_MODELS,
      adversaries: ADVERSARY_DEFS,
      knownModels: KNOWN_MODELS,
      knownAdversaries: new Set(SRD_ADVERSARIES.keys()),
      nativeHooks: [...SRD_HOOKS.keys()],
      libraryAbilities: SRD_ABILITIES,
      characterContent: SRD_CHARACTERS,
      playingScene: demo.scene.id,
      onPlay: () => setMode('play'),
      onPlayHere: () => playAt(editor.sceneId, null),
      onUndo: () => void undoEdit(),
      onRedo: () => void redoEdit(),
      onSave: saveProject,
      onLoad: loadProject,
      onAssetsChanged: () => {
        for (const id of assets.ids()) assets.remove(id);
        for (const asset of session.project.assets) assets.add(asset);
        view.setDecos(editor.scene.decos);
      },
      onSwitchScene: (id: string) => {
        editor.switchScene(id);
        rebindScene();
        refreshEditor();
      },
      onAddScene: (name: string) => {
        const id = newSceneId(name);
        session.run(addScene(blankScene(id, 12, 10)));
        session.run(renameScene(id, name));
        editor.switchScene(id);
        rebindScene();
        refreshEditor();
      },
      onRenameScene: (id: string, name: string) => {
        session.run(renameScene(id, name));
        renderPanel();
      },
      onRemoveScene: (id: string) => {
        session.run(removeScene(id));
        if (editor.sceneId === id) editor.switchScene(session.project.scenes[0]!.id);
        rebindScene();
        refreshEditor();
      },
      onSetStartScene: (id: string) => {
        session.run(setStartScene(id));
        renderPanel();
      },
    }),
    app,
  );
}

function saveProject(): void {
  const blob = new Blob([JSON.stringify(session.project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${session.project.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
  session.markSaved();
  renderPanel();
}

async function loadProject(file: File): Promise<void> {
  loadProjectText(await file.text(), file.name);
}

/**
 * Load a project and restart the game on it.
 *
 * Split from the file handle so a test can hand it text, and because "load"
 * is one decision — parse, refuse if the moment is wrong, boot — rather than
 * a file operation with a game somewhere behind it. Returns the reason it
 * would not, or an empty string.
 */
function loadProjectText(text: string, label = 'the project'): string {
  const parsed = projectSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const reason = `Could not load ${label}: ${parsed.error.issues[0]?.message ?? 'invalid'}`;
    errors.push(reason);
    renderPanel();
    return reason;
  }
  // A loaded project is a campaign to play, not a document to look at. The one
  // moment it will not do that is mid-fight or mid-conversation: there is a
  // prompt or a turn order waiting on the game that is running, and throwing
  // that away under the player is not loading, it is losing.
  const blocked = saveBlockedBy(demo);
  if (blocked !== null) {
    const reason = `Could not load ${label}: ${blocked}`;
    errors.push(reason);
    renderPanel();
    return reason;
  }
  let fresh: DemoScene;
  try {
    fresh = buildProjectScene(parsed.data, parsed.data.id);
  } catch (failure) {
    // A project that parses can still be unplayable: an adversary with no stat
    // block, a start scene that is not there. Say so and keep the game running.
    const reason = `Could not play ${label}: ${failure instanceof Error ? failure.message : String(failure)}`;
    errors.push(reason);
    renderPanel();
    return reason;
  }
  demo = fresh;
  demo.askDefender = true;
  demo.animated = true;
  project = demo.project;
  session = new EditorSession(project);
  editor = new EditorController({
    session,
    sceneId: project.startScene,
    onChange: (change) => {
      if (change === 'building') buildings.sync(editor.scene);
      if (change === 'terrain') rebuildTerrain();
      if (change === 'content') syncEditorContent();
    },
  });
  editor.setMode('inspect');
  // The loaded project is a different document; nothing on screen survives it.
  for (const id of assets.ids()) assets.remove(id);
  for (const asset of session.project.assets) assets.add(asset);
  boundScene = '';
  rebindScene();
  rebuildTerrain();
  view.setDecos(editor.scene.decos);
  refreshPlay();
  renderPanel();
  return '';
}

// ---------------------------------------------------------------------------
// Camera and picking
// ---------------------------------------------------------------------------

const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);

/** Frame the whole of whichever map is loaded. */
/**
 * The camera model. `main.ts` owns the pointer and the keys; the numbers live
 * in `OrbitCamera`, which is what a test drives and what keeps this file to
 * event plumbing.
 */
const orbit = new OrbitCamera({ yaw: 0, pitch: 0.85 });

/** Put the camera over a coordinate the designer typed, at the level they are building on. */
function navigateBuilding(x: number, y: number): void {
  editor.end();
  orbit.lookAt({
    x: x - (activeGrid.width - 1) / 2,
    y: view.layout.baseHeight + editor.state.buildLevel,
    z: y - (activeGrid.height - 1) / 2,
  });
  orbit.snap();
  applyCamera();
}

/** Whether a click would stamp or remove construction. */
function buildingTool(): boolean {
  if (mode !== 'edit') return false;
  return editor.state.tool === 'buildTile' || editor.state.tool === 'eraseTile';
}

/** Whether a click would put something down at `buildLevel`: a piece, a prop, an object, a creature. */
function placementTool(): boolean {
  if (buildingTool()) return true;
  if (mode !== 'edit') return false;
  return ['prop', 'interactable', 'adversary'].includes(editor.state.tool);
}

/** Where a point `height` above a tile's surface lands on screen, in CSS pixels. */
function screenPoint(tile: number, height: number): { x: number; y: number } {
  const centre = tileCenter(activeGrid, tile, view.layout);
  return screenOfWorld(centre.x, centre.y + height, centre.z);
}

/** Where a spot on the ground, so high above it, lands on screen. */
function screenAt(spot: Spot, height: number): { x: number; y: number } {
  const at = spotToWorld(activeGrid, spot, view.layout);
  return screenOfWorld(at.x, at.y + height, at.z);
}

/** A world point in CSS pixels, which is what a test's mouse and the driver speak. */
function screenOfWorld(x: number, y: number, z: number): { x: number; y: number } {
  const v = new Vector3(x, y, z).project(camera);
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
}

/** Look at the whole room. */
function frameCamera(): void {
  const extent = mapExtent(activeGrid, view.layout);
  orbit.frame({ x: 0, y: 0, z: 0 }, extent.radius);
  orbit.snap();
  applyCamera();
}

/** Look at whoever is selected, keeping the angle and distance. */
function frameParty(): void {
  const id = demo.party.selected;
  if (id === null) return;
  const entity = demo.state.entity(id);
  if (entity === undefined || !activeGrid.isTile(entity.tile)) return;
  const centre = tileCenter(activeGrid, entity.tile, view.layout);
  orbit.lookAt({ x: centre.x, y: 0, z: centre.z });
}

function applyCamera(): void {
  const eye = orbit.position();
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(orbit.pose.target.x, orbit.pose.target.y, orbit.pose.target.z);
}
frameCamera();

// Drag on the board: a left drag orbits, a right (or middle) drag pans, and a
// press that moves less than a few pixels is a click. The prototype drew the
// same line at 6px with OrbitControls; here the threshold is ours to test.
const DRAG_THRESHOLD = 6;
let drag: { button: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null = null;

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    orbit.zoom(Math.exp(event.deltaY * 0.0012));
  },
  { passive: false },
);

const raycaster = new Raycaster();
const pointer = new Vector2();
const groundPoint = new Vector3();
const buildPlane = new Plane(new Vector3(0, 1, 0), 0);
let lastBuildPointer: { clientX: number; clientY: number } | null = null;

/** The cell the pointer crosses on the flat plane at the level being built on. */
function buildingUnderPointer(event: { clientX: number; clientY: number }): Spot | null {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  buildPlane.constant = -(view.layout.baseHeight + editor.state.buildLevel);
  if (!raycaster.ray.intersectPlane(buildPlane, groundPoint)) return null;
  const spot = worldToSpot(activeGrid, groundPoint.x, groundPoint.z, view.layout);
  const x = Math.round(spot.x);
  const y = Math.round(spot.y);
  if (!isBuildCoordinate(x) || !isBuildCoordinate(y)) return null;
  return { x, y };
}

/**
 * The cell a placement tool would act on, for the pointer where it is.
 *
 * Build tools work on a flat plane at the chosen Z: that is the only way to
 * reach space with no ground under it, and it is what the purple guide draws.
 * Props, objects and creatures placed at ground level want the ground itself.
 * The plane and the ground are not the same place on screen - at this camera
 * pitch a tile raised two levels projects about two thirds of a tile short of
 * where it stands - so aiming at the plateau used to drop the creature on the
 * flat tile behind it. Off the board, or above it, there is no ground to hit
 * and the plane is all there is.
 */
function placementUnderPointer(event: PointerEvent | MouseEvent): Spot | null {
  if (!buildingTool() && editor.state.buildLevel === 0) {
    const tile = tileUnderPointer(event);
    if (tile !== NO_TILE) return pointOf(tile);
  }
  return buildingUnderPointer(event);
}

function updateBuildingPreview(): void {
  if (mode !== 'edit') return;
  const active = placementTool();
  const target = worldToSpot(activeGrid, orbit.pose.target.x, orbit.pose.target.z, view.layout);
  buildings.showGuide(target.x, target.y, editor.state.buildLevel, active);
  const at = active && lastBuildPointer !== null ? buildingUnderPointer(lastBuildPointer) : null;
  const ghost = at !== null && buildingTool()
    ? {
      ...at,
      level: editor.state.buildLevel,
      shape: editor.state.buildShape,
      material: editor.state.buildMaterial,
      rotation: editor.state.buildRotation,
      height: editor.state.buildHeight,
    }
    : null;
  buildings.showPreview(ghost, editor.state.tool === 'eraseTile');
}

/** The ground under the pointer: the tile struck, and the exact spot on it. */
function groundUnderPointer(event: PointerEvent | MouseEvent): { tile: number; spot: Spot } | null {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits: Intersection<Object3D>[] = raycaster.intersectObjects(view.terrain.meshes, false);
  const hit = hits[0];
  if (hit === undefined) return null;
  groundPoint.copy(hit.point);
  const spot = worldToSpot(activeGrid, groundPoint.x, groundPoint.z, view.layout);
  // The face struck knows its tile, which a hit on a wall's side would
  // otherwise round to whichever tile the wall's edge is nearer.
  const faced = view.terrain.tileOf(hit.object as Mesh, hit.faceIndex ?? -1);
  const tile = faced >= 0 ? faced : tileAtWorld(activeGrid, groundPoint.x, groundPoint.z, view.layout);
  return { tile, spot };
}

function tileUnderPointer(event: PointerEvent | MouseEvent): number {
  return groundUnderPointer(event)?.tile ?? NO_TILE;
}

const pointOf = (tile: number) => ({ x: activeGrid.xOf(tile), y: activeGrid.yOf(tile) });

/** The interactable standing on a tile, if any. */
function objectOn(tile: number): string | null {
  const point = pointOf(tile);
  const found = demo.scene.interactables.find(
    (i) => i.position.x === point.x && i.position.y === point.y,
  );
  return found?.id ?? null;
}

/** The living entity standing on a tile — a click on a token, not the ground. */
function entityOn(tile: number): string | null {
  for (const id of demo.state.occupantsOf(tile)) {
    if (demo.state.entity(id)?.alive === true) return id;
  }
  return null;
}

/**
 * The living entity whose body is under a spot - a creature standing off its
 * centre reaches into the next tile, and a click on it is a click on it.
 */
function entityNear(spot: Spot): string | null {
  let best: string | null = null;
  let bestDistance = 0.5;
  for (const entity of demo.state.allEntities()) {
    if (!entity.alive || entity.tile === NO_TILE) continue;
    const distance = Math.hypot(entity.at.x - spot.x, entity.at.y - spot.y);
    if (distance < bestDistance) {
      best = entity.id;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The scene `view`, `camera` and `editor` are currently bound to.
 *
 * `SceneView` captures its grid at construction and `rebuildTerrain` writes into
 * that same grid in place, so travelling to a differently-sized room needs a new
 * view rather than a rebuild — without this the old room stays on screen while
 * every number underneath it changes.
 */
let boundScene = demo.scene.id;

function rebindScene(): void {
  const scene = activeScene();
  if (boundScene === scene.id) return;
  boundScene = scene.id;

  // The party's own grid when it is their room, so an edit reaches the
  // pathfinder; a grid of its own when the editor is looking somewhere else, so
  // editing one room cannot corrupt the one being played.
  activeGrid = scene.id === demo.scene.id ? demo.grid : gridFromScene(scene).grid;

  // The same view, pointed at the other room: its caches, its lights and the
  // party's own tokens carry over; the ground and the scenery do not.
  view.rebind(activeGrid, { tints: scene.tints, decos: scene.decos });
  buildings.sync(scene);
  frameCamera();
  if (mode === 'edit') syncEditorContent();
}

function refreshPlay(): void {
  autosaveOnTravel();
  rebindScene();
  // Tokens belong to the played room. Drawing them over another room's grid puts
  // the party on whatever happens to share those tile indices.
  if (activeScene().id === demo.scene.id) {
    drainMotions();
    view.syncTokens(demo.state);
    drainFloaters();
    view.showZones(paintedZones());
    view.showSelection(demo.party.selected === null ? NO_TILE : (demo.state.entity(demo.party.selected)?.tile ?? NO_TILE), demo.party.selected);
    // A target to pick lights the creatures it could be; otherwise, in a
    // fight, the Close-range walk round whoever is selected. Out of a fight a
    // walk goes anywhere the floor does, and the floor is not lit for it.
    view.showHighlights(
      targeting !== null
        ? aimingHighlights(targeting)
        : demo.party.selected === null || !inCombat(demo)
          ? []
          : reachableTiles(demo).tiles(),
    );
  } else {
    view.clearHighlights();
    view.clearZones();
    view.showSelection(NO_TILE);
  }
  renderPlayPanel();
}

/**
 * The ground each standing zone holds, in the colour its condition names -
 * or, for one that names none, a hue spun from the id, so a zone scripted
 * tomorrow still shows up.
 */
function paintedZones(): { tiles: number[]; color: string }[] {
  return [
    ...demo.world.zoneFootprints().map((zone) => ({
      tiles: zone.tiles,
      color: demo.world.conditionDef(zone.condition)?.color ?? hueOf(zone.condition),
    })),
    // A spot somebody marked to come back to: one tile, in the party's blue.
    ...demo.world.marks().map((mark) => ({ tiles: [mark.tile], color: '#7fd1ff' })),
  ];
}


/**
 * What lights up while the bar is armed.
 *
 * For a creature pick, the ones that could be chosen. For a point, the ground
 * it may be aimed at - and, once the pointer is over a legal tile, whoever the
 * shape would catch from there, so the player sees the line before they commit
 * to it rather than after.
 */
function aimingHighlights(armed: NonNullable<typeof targeting>): number[] {
  const tileOf = (id: string): number => demo.state.entity(id)?.tile ?? NO_TILE;
  if (armed.tiles === undefined) return armed.valid.map(tileOf).filter((t) => t !== NO_TILE);
  const ability = abilitiesOf(demo, armed.characterId).find((a) => a.id === armed.abilityId);
  const aimed = armed.aimed;
  if (ability === undefined || aimed === undefined || !armed.tiles.includes(aimed)) return armed.tiles;
  const caught = shapeAt(demo, armed.characterId, ability, aimed).map(tileOf).filter((t) => t !== NO_TILE);
  return [...armed.tiles, ...caught];
}

/** The party's pack, joined to the project's item names. */
function carriedItems(): { id: string; name: string; quantity: number; wearable: boolean; usable: boolean }[] {
  const items = new Map(demo.project.items.map((item) => [item.id, item]));
  return [...demo.scenario.items]
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => {
      const item = items.get(id);
      return {
        id,
        name: item?.name ?? id,
        quantity,
        wearable: (item?.kind === 'weapon' || item?.kind === 'armor') && item.contentId !== undefined,
        usable: (item?.use.length ?? 0) > 0,
      };
    });
}

/**
 * Where saves live: named slots over `localStorage`, guarded so a browser
 * that blocks site data reads as "no saves" rather than taking the page down.
 * The quick slot and the autosave slot are fixed and overwritten; "Save as…"
 * mints a new one every time.
 */
const slots = new SaveSlots(browserStore());

/** "The Husk Vault, level 2" — a line for the saves list. */
function whereWeAre(): string {
  const level = demo.scenario.partyLevel;
  return `${demo.scene.name || demo.scene.id}${level > 1 ? `, level ${level}` : ''}`;
}

/** Save into a slot, and say so in the log either way. */
function saveTo(id: string | undefined, name: string, quiet = false): boolean {
  const text = serialiseSave(demo);
  if (text === null) return false;
  const slot = slots.write(text, name, whereWeAre(), id);
  if (!quiet) note(demo, slot === null ? 'This browser will not let the game save.' : `Saved: ${name}.`, 'system');
  return slot !== null;
}

function saveNow(): boolean {
  return saveTo(QUICK_SLOT, 'Quick save');
}

/** Load a slot back into the game. */
function loadSlot(id: string): boolean {
  const text = slots.read(id);
  if (text === null) return false;
  const result = loadGameText(demo, text);
  if (!result.ok) {
    note(demo, `That save could not be opened: ${result.reason}.`, 'system');
    return false;
  }
  // The room may have changed under the renderer, so force a rebind the way
  // loading a project does.
  boundScene = '';
  // A load is not a doorway: the room changed, but the autosave from the
  // last real doorway must survive so a bad load can be undone.
  lastRoom = demo.scene.id;
  note(demo, 'Loaded.', 'system');
  return true;
}

/**
 * Autosave when the party changes rooms. Detected here rather than hooked
 * into `travelTo`, because a script's `goto` travels without going through
 * `main.ts` at all; every action ends in `refreshPlay`, which is enough.
 */
let lastRoom = demo.scene.id;
function autosaveOnTravel(): void {
  if (demo.scene.id === lastRoom) return;
  lastRoom = demo.scene.id;
  if (saveBlockedBy(demo) === null) saveTo(AUTO_SLOT, 'Autosave', true);
}

/** The journal: every quest the party has been given, joined to its words. */
function journalEntries(): JournalQuest[] {
  const entries: JournalQuest[] = [];
  for (const quest of demo.project.quests) {
    const progress = demo.scenario.quests.get(quest.id);
    if (progress === undefined) continue;
    entries.push({
      id: quest.id,
      name: quest.name,
      // As far into the story as the party has got, not the opening line.
      summary: journalSummary(quest, progress),
      status: progress.status,
      objectives: quest.objectives
        // A hidden step stays out of the journal until revealed or done.
        .filter((o) => !o.hidden || progress.revealed.has(o.id) || progress.done.has(o.id))
        .map((o) => ({ id: o.id, text: o.text, done: progress.done.has(o.id) })),
    });
  }
  // Active first; finished ones sink to the tail.
  return entries.sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'));
}

/** What the HUD shows for each party member. */
function hudMembers(): HudMember[] {
  const waiting = new Set(awaitingLevel(demo));
  return demo.state.entitiesOf('party').map((entity) => {
    const character = demo.characters.get(entity.id);
    const sheet = character?.sheet;
    const role = sheet === undefined ? '' : (SRD_CHARACTERS.classes.get(sheet.classId)?.name ?? sheet.classId);
    return {
      id: entity.id,
      name: sheet?.name ?? entity.id,
      role,
      selected: demo.party.selected === entity.id,
      alive: entity.alive,
      hitPoints: { ...entity.hitPoints },
      stress: { ...entity.stress },
      armorSlots: { ...entity.armorSlots },
      ...(entity.hope === undefined ? {} : { hope: { ...entity.hope } }),
      // What they are called rather than their ids: a HUD is read by a player.
      conditions: [...entity.conditions].map((c) => demo.world.conditionName(c)),
      canLevel: waiting.has(entity.id) && !inCombat(demo) && demo.pending === null,
      gear: `${gearOf(demo, entity.id).weapon} · ${gearOf(demo, entity.id).armor}`,
    };
  });
}

/** What is being looked at, until closed. */
let inspecting: Inspection | null = null;

/** Who is filling in a level-up sheet, and why the last attempt was refused. */
let levelling: string | null = null;
let levelIssues: LevelUpIssue[] = [];

/** An ability waiting for its target to be clicked on the board. */
/**
 * The ability the bar is armed with, and what the next click on the board is
 * for. `valid` is creature ids for a card that picks somebody; `tiles` is the
 * ground a card aimed at a point may be aimed at, and the two are never both
 * set. `aimed` is the tile under the pointer while a point is being chosen,
 * so the board can show what the shape would catch before it is committed.
 */
let targeting: {
  characterId: string;
  abilityId: string;
  name: string;
  valid: string[];
  tiles?: number[];
  aimed?: number;
} | null = null;
/** Whose loadout is open, and why the last swap was refused. */
let loadoutOpen: string | null = null;
let loadoutIssue: string | null = null;
let restOpen = false;

/** Start using an ability: run it, or arm the bar for a target first. */
function beginAbility(abilityId: string): void {
  const who = demo.party.selected;
  if (who === null) return;
  const ability = abilitiesOf(demo, who).find((a) => a.id === abilityId);
  if (ability === undefined) return;
  if (ability.target.kind === 'point') {
    const tiles = pointTiles(demo, who, ability);
    if (tiles.length === 0) note(demo, `${ability.name}: nowhere to aim it.`, 'system');
    else targeting = { characterId: who, abilityId, name: ability.name, valid: [], tiles };
    refreshPlay();
    return;
  }
  const wantsPick = ability.target.kind !== 'none' && ability.target.kind !== 'self';
  if (wantsPick) {
    const valid = abilityTargets(demo, who, ability);
    // One thing to pick is no pick at all.
    if (valid.length === 1) {
      useAbility(demo, who, abilityId, valid);
    } else if (valid.length === 0) {
      note(demo, `${ability.name}: nothing in range.`, 'system');
    } else {
      targeting = { characterId: who, abilityId, name: ability.name, valid };
    }
  } else {
    useAbility(demo, who, abilityId);
  }
  refreshPlay();
}

/** The board was clicked while an ability waits for a target. */
function pickTarget(tile: number): void {
  if (targeting === null) return;
  // A card aimed at the ground takes the tile itself, whoever is standing on
  // it: "a point within Far range" is a place in the room.
  if (targeting.tiles !== undefined) {
    if (!targeting.tiles.includes(tile)) {
      note(demo, `${targeting.name}: that is out of range.`, 'system');
      return;
    }
    const aimed = targeting;
    targeting = null;
    useAbility(demo, aimed.characterId, aimed.abilityId, [], { point: tile });
    return;
  }
  const occupant = entityOn(tile);
  if (occupant === null || !targeting.valid.includes(occupant)) {
    note(demo, `${targeting.name}: that is not a target it can reach.`, 'system');
    return;
  }
  const armed = targeting;
  targeting = null;
  useAbility(demo, armed.characterId, armed.abilityId, [occupant]);
}

function takeLevel(id: string, plan: LevelUpPlan): boolean {
  const result = applyLevelUp(demo, id, plan);
  if (result.ok) {
    levelling = null;
    levelIssues = [];
  } else {
    levelIssues = result.issues;
  }
  refreshPlay();
  return result.ok;
}

function renderPlayPanel(): void {
  render(
    h(Fragment, null, h(DiceTray, {
      // One at a time, in the order they were rolled: a feature that catches
      // the whole party rolls several in one burst, and they queue.
      roll: demo.rolls[0] ?? null,
      millis: demo.diceMillis,
      onDone: (id: number) => {
        demo.rolls = demo.rolls.filter((waiting) => waiting.id !== id);
        refreshPlay();
      },
    }), h(PartyHud, {
      members: hudMembers(),
      fear: { ...demo.state.fear },
      round: demo.encounter?.round ?? null,
      onSelect: (id: string) => {
        demo.party.select(id);
        refreshPlay();
      },
      onLevelUp: (id: string) => {
        levelling = id;
        levelIssues = [];
        refreshPlay();
      },
    }), h(ActionBar, {
      characterId: demo.party.selected,
      name: demo.party.selected === null ? '' : nameOf(demo, demo.party.selected),
      weapon: demo.party.selected === null ? '' : gearOf(demo, demo.party.selected).weapon,
      abilities: demo.party.selected === null ? [] : abilityList(demo, demo.party.selected),
      fighting: inCombat(demo),
      side: inCombat(demo) ? demo.encounter!.view().side : null,
      targeting:
        targeting === null
          ? null
          : { abilityId: targeting.abilityId, name: targeting.name, ...(targeting.tiles === undefined ? {} : { spot: true }) },
      onUse: beginAbility,
      onCancelTargeting: () => {
        targeting = null;
        refreshPlay();
      },
      onPassToGm: () => {
        endTurn(demo);
        refreshPlay();
      },
      onLoadout: () => {
        loadoutOpen = demo.party.selected;
        loadoutIssue = null;
        refreshPlay();
      },
      onRest: () => {
        restOpen = true;
        refreshPlay();
      },
    }), loadoutOpen !== null && demo.sheets.has(loadoutOpen)
      ? h(LoadoutPanel, {
          name: nameOf(demo, loadoutOpen),
          view: loadoutView(demo, loadoutOpen),
          resting: false,
          issue: loadoutIssue,
          onSwap: (cardIn: string, cardOut: string | undefined) => {
            const result = swapCard(demo, loadoutOpen!, cardIn, cardOut);
            loadoutIssue = result.ok ? null : result.reason;
            refreshPlay();
          },
          onClose: () => {
            loadoutOpen = null;
            loadoutIssue = null;
            refreshPlay();
          },
        })
      : null, restOpen
      ? h(RestPanel, {
          party: demo.party.members().map((id) => ({ id, name: nameOf(demo, id) })),
          onRest: (kind: 'short' | 'long', plan: RestPlan) => {
            const result = rest(demo, kind, plan);
            if (!result.ok) note(demo, `Cannot rest: ${result.reason}.`, 'system');
            restOpen = false;
            refreshPlay();
          },
          onClose: () => {
            restOpen = false;
            refreshPlay();
          },
        })
      : null, levelling !== null && demo.sheets.has(levelling) && awaitingLevel(demo).includes(levelling)
      ? h(LevelUpPanel, {
          sheet: demo.sheets.get(levelling)!,
          content: SRD_CHARACTERS,
          issues: levelIssues,
          onApply: (plan: LevelUpPlan) => void takeLevel(levelling!, plan),
          onClose: () => {
            levelling = null;
            levelIssues = [];
            refreshPlay();
          },
        })
      : null, h(PlayPanel, {
      log: demo.log,
      inspecting,
      onCloseInspect: () => {
        inspecting = null;
        refreshPlay();
      },
      journal: journalEntries(),
      // A name in the log points at somebody on the board: the same marker the
      // pointer leaves under a tile, put there by reading rather than aiming.
      onHoverEntity: (id: string | null) => {
        const tile = id === null ? NO_TILE : demo.state.entity(id)?.tile ?? NO_TILE;
        view.showCursor(tile);
      },
      carried: carriedItems(),
      pending: demo.pending,
      within: reachableInteractable(demo),
      saveBlocked: saveBlockedBy(demo),
      saves: slots.list(),
      onSave: () => {
        saveNow();
        refreshPlay();
      },
      onSaveAs: () => {
        const name = prompt('Name this save', whereWeAre());
        if (name === null || name.trim() === '') return;
        saveTo(undefined, name.trim());
        refreshPlay();
      },
      onLoad: (id: string) => {
        loadSlot(id);
        refreshPlay();
      },
      onDeleteSave: (id: string) => {
        slots.remove(id);
        refreshPlay();
      },
      onUseItem: (id: string) => {
        useItem(demo, id);
        refreshPlay();
      },
      onEquip: (id: string) => {
        const who = demo.party.selected;
        if (who === null) return;
        const result = equipItem(demo, who, id);
        if (!result.ok) note(demo, `Cannot equip that: ${result.reason}.`, 'system');
        refreshPlay();
      },
      onUse: (id: string) => {
        useSelectedOn(demo, id);
        refreshPlay();
      },
      onAnswer: (response: Response) => {
        answerPending(demo, response);
        refreshPlay();
      },
      nameOf: (id: string) => nameOf(demo, id),
      actorHope: demo.scenario.actorId === null ? 0 : (demo.state.entity(demo.scenario.actorId)?.hope?.value ?? 0),
    })),
    app,
  );
}
refreshPlay();

canvas.addEventListener('pointerdown', (event) => {
  if (mode === 'edit') {
    if (event.button !== 0) {
      editor.end();
      drag = { button: event.button, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (placementTool() && !event.shiftKey) {
      const at = placementUnderPointer(event);
      if (at === null) return;
      canvas.setPointerCapture(event.pointerId);
      editor.begin(at);
      renderPanel();
      return;
    }
    const tile = tileUnderPointer(event);
    if (tile === NO_TILE) return;
    // Shift-click on the ground: play from this tile.
    if (event.shiftKey) {
      playAt(editor.sceneId, tile);
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    editor.begin(pointOf(tile));
    renderPanel();
    return;
  }

  // In play every button starts a possible drag; the click happens on release
  // if the pointer stayed put.
  drag = { button: event.button, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  canvas.setPointerCapture(event.pointerId);
});

/** Facts about whatever stands on a tile — a party member, an adversary, an object. */
function inspectTile(tile: number): Inspection | null {
  const occupant = entityOn(tile);
  if (occupant !== null) {
    const entity = demo.state.entity(occupant)!;
    const pools = [
      `HP ${entity.hitPoints.marked}/${entity.hitPoints.max}`,
      `Stress ${entity.stress.marked}/${entity.stress.max}`,
      `Armor ${entity.armorSlots.marked}/${entity.armorSlots.max}`,
    ];
    if (entity.faction === 'party') {
      const character = demo.characters.get(entity.id);
      const sheet = character?.sheet;
      const klass = sheet === undefined ? undefined : SRD_CHARACTERS.classes.get(sheet.classId);
      const gear = gearOf(demo, entity.id);
      return {
        kind: 'character',
        id: entity.id,
        name: sheet?.name ?? entity.id,
        line: `${klass?.name ?? sheet?.classId ?? ''} · level ${sheet?.level ?? 1}`,
        text: `${gear.weapon} · ${gear.armor}`,
        facts: [
          ...pools,
          ...(entity.hope === undefined ? [] : [`Hope ${entity.hope.value}/${entity.hope.max}`]),
          `Evasion ${character?.evasion ?? '?'}`,
          // Named, not keyed: an inspect card is read by a player.
          ...[...entity.conditions].map((c) => demo.world.conditionName(c)),
        ],
      };
    }
    const def = SRD_ADVERSARIES.get(entity.definition) ?? SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID);
    return {
      kind: 'adversary',
      id: entity.id,
      name: def?.name ?? entity.definition,
      line: def === undefined ? entity.definition : `Tier ${def.tier} ${def.role}`,
      text: def?.description ?? '',
      facts: [
        ...pools,
        ...(def === undefined ? [] : [`Difficulty ${def.difficulty}`]),
        ...[...entity.conditions].map((c) => demo.world.conditionName(c)),
      ],
    };
  }
  const objectId = objectOn(tile);
  if (objectId !== null) {
    const object = demo.scene.interactables.find((i) => i.id === objectId)!;
    const state = demo.state.interactable(objectId);
    const facts: string[] = [];
    if (state.removed) facts.push('Gone');
    else if (state.open) facts.push('Open');
    else if (state.used) facts.push('Used');
    if (object.requiresKey !== undefined) facts.push('Needs a key');
    if (object.check !== undefined) facts.push(`${object.check.trait} ${object.check.difficulty}`);
    return { kind: 'object', id: objectId, name: object.name || objectId, line: object.kind, text: object.flavor, facts };
  }
  return null;
}

/** A click on the board in play mode. */
function clickAt(event: PointerEvent): void {
  const ground = groundUnderPointer(event);
  if (ground === null || ground.tile === NO_TILE) return;
  const { tile, spot } = ground;

  if (targeting !== null) {
    pickTarget(tile);
    refreshPlay();
    return;
  }

  const occupant = entityNear(spot) ?? entityOn(tile);
  if (occupant !== null) {
    const entity = demo.state.entity(occupant)!;
    if (entity.faction === 'party') demo.party.select(occupant);
    else attackWithSelected(demo, occupant);
  } else {
    // A click on a thing tries to use it; on bare ground, walk. Reach is checked
    // inside the verb, which reports "out of reach" rather than silently walking.
    const object = objectOn(tile);
    if (object !== null) useSelectedOn(demo, object);
    else moveSelectedTo(demo, tile, spot);
  }
  // The walk is under way; the line it was going to take is not needed on the ground now.
  view.clearPath();
  refreshPlay();
}

canvas.addEventListener('pointermove', (event) => {
  if (drag !== null) {
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (drag.moved) {
      if (drag.button === 0) orbit.orbit(-dx * 0.006, -dy * 0.004);
      else {
        // Pan at a rate that keeps the ground under the pointer, roughly:
        // farther away, a pixel is more world.
        const scale = orbit.goal.distance * 0.0016;
        orbit.pan(-dx * scale, dy * scale);
      }
    }
    return;
  }
  if (mode === 'edit') {
    if (placementTool()) {
      // The ghost only needs where the pointer is; working out the cell costs a
      // raycast against the terrain meshes, so a hover does not pay for one.
      lastBuildPointer = { clientX: event.clientX, clientY: event.clientY };
      if (event.buttons !== 1) return;
      const at = placementUnderPointer(event);
      if (at !== null) editor.paint(at);
      return;
    }
    if (event.buttons === 0) return;
    const tile = tileUnderPointer(event);
    if (tile !== NO_TILE) editor.paint(pointOf(tile));
    return;
  }
  // Hover: mark the spot under the pointer so a click has a visible target,
  // and draw the line a click there would walk.
  const ground = groundUnderPointer(event);
  const over = ground?.tile ?? NO_TILE;
  view.showCursor(over);
  hoverWalk(ground);
  // A card aimed at the ground redraws its shape as the pointer moves, so what
  // it would catch is on the board before the click rather than in the log
  // after it.
  if (targeting?.tiles !== undefined && targeting.aimed !== over) {
    targeting = { ...targeting, aimed: over };
    refreshPlay();
  }
});

canvas.addEventListener('pointerleave', () => {
  lastBuildPointer = null;
  view.showCursor(NO_TILE);
  view.clearPath();
});

/** The line a click on this ground would walk, on the ground; nothing while aiming a card, or with nowhere to go. */
function hoverWalk(ground: { tile: number; spot: Spot } | null): void {
  if (ground === null || mode !== 'play' || targeting !== null || activeScene().id !== demo.scene.id) {
    view.clearPath();
    return;
  }
  // A click on an enemy walks up to it before the swing: that line. A click
  // on anyone else, or on a thing, is not a walk.
  const near = entityNear(ground.spot) ?? entityOn(ground.tile);
  if (near !== null) {
    const route = demo.state.entity(near)?.faction === 'adversary' ? previewStrike(demo, near) : null;
    if (route === null) view.clearPath();
    else view.showPath(route);
    return;
  }
  if (objectOn(ground.tile) !== null) {
    view.clearPath();
    return;
  }
  const preview = previewWalk(demo, ground.tile, ground.spot);
  if (preview === null) view.clearPath();
  else view.showPath(preview.route, preview.beyond);
}

canvas.addEventListener('pointerup', (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (drag !== null) {
    const wasClick = !drag.moved && mode === 'play';
    const button = drag.button;
    drag = null;
    if (wasClick && button === 0) clickAt(event);
    if (wasClick && button === 2) {
      // A still right-click looks at what is there rather than acting on it.
      const tile = tileUnderPointer(event);
      inspecting = tile === NO_TILE ? null : inspectTile(tile);
      refreshPlay();
    }
    return;
  }
  if (mode !== 'edit') return;
  editor.end();
  renderPanel();
});

/** Typing into a field must not walk the party or undo the map. */
function typing(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

window.addEventListener('keydown', (event) => {
  if (typing(event)) return;
  if (event.key === 'e' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    setMode(mode === 'play' ? 'edit' : 'play');
    return;
  }
  if (mode === 'edit') {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoEdit();
      else undoEdit();
    }
    if (placementTool() && !event.ctrlKey && !event.metaKey) {
      // R turns the piece being stamped. Nothing on the prop, object or
      // creature paths reads `buildRotation`, so there it would be a key that
      // changed a number and nothing else; the spec gives R to the Inspector.
      if (buildingTool() && event.key.toLowerCase() === 'r') {
        editor.end();
        editor.set('buildRotation', (editor.state.buildRotation + 1) % 4);
        renderPanel();
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        const step = event.key === 'PageUp' ? 1 : -1;
        editor.setBuildLevel(Math.max(-BUILD_LIMIT, Math.min(BUILD_LIMIT, editor.state.buildLevel + step)));
        renderPanel();
      }
    }
    if (event.key === 'Home') frameCamera();
    return;
  }
  if (event.key === 'Escape' && (inspecting !== null || targeting !== null || loadoutOpen !== null || restOpen)) {
    inspecting = null;
    targeting = null;
    loadoutOpen = null;
    restOpen = false;
    refreshPlay();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    demo.party.selectNext();
    refreshPlay();
  } else if (event.key === ' ' || event.key === 'Enter') {
    endTurn(demo);
    refreshPlay();
  } else if (event.key === 'f' || event.key === 'F') {
    frameParty();
  } else if (event.key === 'Home') {
    const extent = mapExtent(activeGrid, view.layout);
    orbit.frame({ x: 0, y: 0, z: 0 }, extent.radius);
  }
});

// Held keys pan and turn every frame, the way a BG3 camera does: WASD and the
// arrows slide, Q and E turn. Read in `frame()` rather than on keydown so the
// motion is smooth and independent of key-repeat.
const held = new Set<string>();
window.addEventListener('keydown', (event) => {
  if (typing(event)) return;
  held.add(event.key.toLowerCase());
});
window.addEventListener('keyup', (event) => held.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

/**
 * Keep whoever is selected in frame while their token walks.
 *
 * Only while it walks: the camera does not chase a click on a card, and it
 * does not fight the player - a drag or a held key is theirs, and a walk that
 * ends within a third of the view's distance of the target moves nothing.
 */
function followSelected(): void {
  if (mode !== 'play' || drag !== null || held.size > 0) return;
  const id = demo.party.selected;
  if (id === null || !view.isGliding(id)) return;
  const token = view.tokenFor(id);
  if (token === undefined) return;
  orbit.follow(token.group.position, orbit.goal.distance * 0.35);
}

function steerCamera(dt: number): void {
  if (mode !== 'play' && mode !== 'edit') return;
  const speed = orbit.goal.distance * 0.9 * dt;
  let right = 0;
  let forward = 0;
  if (held.has('a') || held.has('arrowleft')) right -= 1;
  if (held.has('d') || held.has('arrowright')) right += 1;
  if (held.has('w') || held.has('arrowup')) forward += 1;
  if (held.has('s') || held.has('arrowdown')) forward -= 1;
  if (right !== 0 || forward !== 0) orbit.pan(right * speed, forward * speed);
  if (held.has('q')) orbit.orbit(1.6 * dt, 0);
  if (held.has('e')) orbit.orbit(-1.6 * dt, 0);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------------------

const pixel = new Uint8Array(4);
const state = {
  webgl2,
  frames: 0,
  errors,
  tiles: demo.grid.size,
  entities: demo.state.allEntities().length,
  decos: view.decoCount,
  missingModels: (): string[] => view.registry.missing(),
  party: (): string[] => demo.party.members(),
  selected: (): string | null => demo.party.selected,
  select: (id: string): boolean => {
    const ok = demo.party.select(id);
    if (ok) refreshPlay();
    return ok;
  },
  selectNext: (): string | null => {
    const id = demo.party.selectNext();
    refreshPlay();
    return id;
  },
  tileOf: (id: string): number => demo.state.entity(id)?.tile ?? NO_TILE,
  zones: (): { id: string; name: string; tiles: number[] }[] =>
    demo.world.zoneFootprints().map((z) => ({ id: z.id, name: z.name, tiles: z.tiles })),
  inCombat: (): boolean => inCombat(demo),
  round: (): number => demo.encounter?.round ?? 0,
  adversaries: (): string[] =>
    demo.state.entitiesOf('adversary').filter((e) => e.alive).map((e) => e.id),
  hitPoints: (id: string): { marked: number; max: number } => {
    const pool = demo.state.entity(id)?.hitPoints;
    return { marked: pool?.marked ?? 0, max: pool?.max ?? 0 };
  },
  moveTo: (tile: number): boolean => {
    const result = moveSelectedTo(demo, tile);
    if (result.moved) refreshPlay();
    return result.moved;
  },
  walkTo: (x: number, y: number): boolean => {
    const result = moveSelectedTo(demo, activeGrid.tileAtSpot(x, y), { x, y });
    if (result.moved) refreshPlay();
    return result.moved;
  },
  standingAt: (id: string): { x: number; y: number } | null => {
    const entity = demo.state.entity(id);
    return entity === undefined || entity.tile === NO_TILE ? null : { x: entity.at.x, y: entity.at.y };
  },
  /** Where a spot on the ground lands on screen, in CSS pixels from the page origin. */
  screenAt: (x: number, y: number): { x: number; y: number } => screenAt({ x, y }, 0),
  previewAt: (x: number, y: number): { route: { x: number; y: number }[]; beyond: { x: number; y: number }[] } | null => {
    const preview = previewWalk(demo, activeGrid.tileAtSpot(x, y), { x, y });
    if (preview === null) return null;
    return { route: preview.route.map((s) => ({ x: s.x, y: s.y })), beyond: preview.beyond.map((s) => ({ x: s.x, y: s.y })) };
  },
  pathPoints: (): number => view.pathPointCount,
  attack: (id: string): boolean => {
    const result = attackWithSelected(demo, id);
    refreshPlay();
    return result !== null && result.refused === null;
  },
  endGmTurn: (): number => {
    const acted = playGmTurn(demo);
    refreshPlay();
    return acted;
  },
  highlighted: (): number => view.highlightedCount,
  reachable: (): number[] => reachableTiles(demo).tiles(),
  sample: (x: number, y: number): number[] => {
    // The drawing buffer is not preserved between frames, so read it inside the
    // same task that drew it rather than whenever a caller happens to ask.
    renderer.render(view.scene, camera);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
  },

  use: (id: string): string => {
    const result = useSelectedOn(demo, id);
    refreshPlay();
    return result.status;
  },
  useInReach: (): string => {
    const id = reachableInteractable(demo);
    if (id === null) return 'none';
    const result = useSelectedOn(demo, id);
    refreshPlay();
    return result.status;
  },
  answer: (response: Response): string => {
    const result = answerPending(demo, response);
    refreshPlay();
    return result.status;
  },
  log: (): { text: string; tone: string }[] => demo.log.map((l) => ({ ...l })),
  setDiceSpeed: (millis: number): void => {
    demo.diceMillis = Math.max(0, millis);
    refreshPlay();
  },
  dice: (): { hope: number; fear: number; total: number }[] =>
    demo.rolls.map((shown) => ({ hope: shown.roll.hope, fear: shown.roll.fear, total: shown.roll.total })),
  clearDice: (): void => {
    demo.rolls.length = 0;
    refreshPlay();
  },
  /**
   * What is actually being asked, which is not always the outermost thing
   * waiting: a reply that calls for a roll raises the check *inside* the
   * conversation, and the panel reads it there. This read the outer prompt and
   * answered 'dialogue' while a player was being shown a roll to make.
   */
  pendingKind: (): string | null => {
    const pending = demo.pending;
    if (pending === null) return null;
    const talking = pending.kind === 'script' ? pending.dialogue : null;
    if (talking !== null) return talking.prompt?.kind ?? 'dialogue';
    return pending.prompt.kind;
  },
  objects: (): string[] => demo.scene.interactables.map((i) => i.id),
  dialogueOptions: (): string[] =>
    scriptPending(demo)?.dialogue?.view?.options.map((o) => o.text) ?? [],
  hasDialogue: (): boolean => scriptPending(demo)?.dialogue != null,
  within: (): string | null => reachableInteractable(demo),
  /** Put the selected member beside a thing, so a test can reach it. */
  standBeside: (id: string): boolean => {
    const object = demo.scene.interactables.find((i) => i.id === id);
    const actor = demo.party.selected;
    if (object === undefined || actor === null) return false;
    const tile = demo.grid.indexOf(object.position.x - 1, object.position.y);
    if (!demo.grid.isTile(tile)) return false;
    demo.state.moveEntity(actor, tile);
    refreshPlay();
    return true;
  },

  abilities: (id: string) =>
    abilityList(demo, id).map((v) => ({ id: v.ability.id, usable: v.usable, reason: v.reason, targets: v.targets })),
  useAbility: (id: string, ability: string, targets: string[] = [], point?: number): string => {
    const result = useAbility(demo, id, ability, targets, point === undefined ? {} : { point });
    refreshPlay();
    return result.status;
  },
  aim: (ability: string): number[] => {
    beginAbility(ability);
    return targeting?.tiles ?? [];
  },
  lit: (): number[] => (targeting === null ? [] : aimingHighlights(targeting)),
  setHope: (id: string, value: number): void => {
    const entity = demo.state.entity(id);
    if (entity?.hope === undefined) return;
    entity.hope = { max: entity.hope.max, value: Math.max(0, Math.min(entity.hope.max, value)) };
    refreshPlay();
  },
  shape: (ability: string, tile: number): string[] => {
    const who = demo.party.selected;
    const card = who === null ? undefined : abilitiesOf(demo, who).find((a) => a.id === ability);
    return who === null || card === undefined ? [] : shapeAt(demo, who, card, tile);
  },
  passToGm: (): number => {
    const acted = endTurn(demo);
    refreshPlay();
    return acted;
  },
  loadout: (id: string) => {
    const view = loadoutView(demo, id);
    return { loadout: view.loadout.map((c) => c.id), vault: view.vault.map((c) => c.id) };
  },
  swapCard: (id: string, cardIn: string, cardOut?: string): string | null => {
    const result = swapCard(demo, id, cardIn, cardOut);
    refreshPlay();
    return result.ok ? null : result.reason;
  },
  rest: (kind: 'short' | 'long', plan: unknown): boolean => {
    const result = rest(demo, kind, plan as RestPlan);
    refreshPlay();
    return result.ok;
  },
  conditionsOf: (id: string): string[] => [...(demo.state.entity(id)?.conditions ?? [])],
  targeting: (): string | null => targeting?.abilityId ?? null,
  turnSide: (): string | null => (inCombat(demo) ? demo.encounter!.view().side : null),
  /** Start the room's first encounter where the party stands, for a test. */
  startFight: (): boolean => {
    const encounter = demo.scene.encounters[0];
    if (encounter === undefined) return false;
    startEncounter(demo, encounter.id);
    refreshPlay();
    return true;
  },
  /** Put the selected member next to a creature, so a test can reach it. */
  standNear: (id: string): boolean => {
    const target = demo.state.entity(id);
    const actor = demo.party.selected;
    if (target === undefined || actor === null) return false;
    const blocked = demo.state.blockedFor(actor);
    let stand = NO_TILE;
    demo.grid.forEachNeighbor(target.tile, false, (tile) => {
      if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile)) stand = tile;
    });
    if (stand === NO_TILE) return false;
    demo.state.moveEntity(actor, stand);
    refreshPlay();
    return true;
  },
  /** Hand a character a set of domain cards, for a test of the vault. */
  setCards: (id: string, cards: string[]): void => {
    const sheet = demo.sheets.get(id);
    if (sheet === undefined) return;
    const grown = { ...sheet, domainCards: cards };
    delete (grown as { loadout?: readonly string[] }).loadout;
    setSheet(demo, grown);
    refreshWorld(demo);
    refreshPlay();
  },

  sceneId: (): string => demo.scene.id,
  // `tiles` is captured once at boot; this reads the room the party is in.
  sceneTiles: (): number => activeGrid.size,
  scenes: (): string[] => demo.project.scenes.map((s) => s.id),
  travelTo: (scene: string): boolean => {
    const moved = travelTo(demo, scene);
    refreshPlay();
    return moved;
  },

  editScene: (): string => editor.sceneId,
  playAt: (tile: number | null): boolean => playAt(editor.sceneId, tile),
  switchScene: (id: string): void => {
    editor.switchScene(id);
    rebindScene();
    refreshEditor();
  },
  addScene: (name: string): string => {
    const id = newSceneId(name);
    session.run(addScene(blankScene(id, 12, 10)));
    session.run(renameScene(id, name));
    editor.switchScene(id);
    rebindScene();
    refreshEditor();
    return id;
  },
  removeScene: (id: string): boolean => {
    const removed = session.run(removeScene(id));
    if (removed && editor.sceneId === id) editor.switchScene(session.project.scenes[0]!.id);
    rebindScene();
    refreshEditor();
    return removed;
  },

  selectObject: (id: string): boolean => {
    const found = editor.scene.interactables.find((i) => i.id === id);
    if (found === undefined) return false;
    editor.setTool('select');
    editor.selected = id;
    renderPanel();
    return true;
  },
  editObject: (changes: Record<string, unknown>): void => {
    if (editor.selected === null) return;
    session.run(
      updateInteractable(editor.sceneId, editor.selected, changes as Partial<Interactable>),
    );
    renderPanel();
  },
  objectField: (field: string): unknown => {
    const found = editor.selectedInteractable();
    return found === null ? null : (found as unknown as Record<string, unknown>)[field];
  },

  nodePosition: (dialogue: string, node: string): { x: number; y: number } | null => {
    const found = session.project.dialogues
      .find((d) => d.id === dialogue)
      ?.nodes.find((n) => n.id === node);
    return found?.position ?? null;
  },
  dialogueNodes: (dialogue: string): string[] =>
    session.project.dialogues.find((d) => d.id === dialogue)?.nodes.map((n) => n.id) ?? [],

  carried: (): { id: string; name: string; quantity: number }[] => carriedItems(),
  inspect: (tile: number): { kind: string; id: string; name: string; facts: string[] } | null => {
    inspecting = inspectTile(tile);
    refreshPlay();
    return inspecting === null ? null : { kind: inspecting.kind, id: inspecting.id, name: inspecting.name, facts: [...inspecting.facts] };
  },
  animating: (): number => view.animationCount,
  clipOf: (id: string): string | null => view.clipOf(id),
  objectTile: (id: string): number => demo.state.interactableTile(id),
  objectState: (id: string): { used: boolean; open: boolean; removed: boolean } => {
    const s = demo.state.interactable(id);
    return { used: s.used, open: s.open, removed: s.removed };
  },
  useItem: (id: string): string => {
    const result = useItem(demo, id);
    refreshPlay();
    return result.status;
  },
  wound: (id: string, marks: number): void => {
    const entity = demo.state.entity(id);
    if (entity !== undefined) entity.hitPoints.marked = Math.min(entity.hitPoints.max, Math.max(0, marks));
    refreshPlay();
  },
  markStress: (id: string, marks: number): void => {
    const entity = demo.state.entity(id);
    if (entity !== undefined) entity.stress = { ...entity.stress, marked: Math.min(entity.stress.max, Math.max(0, marks)) };
    refreshPlay();
  },
  stressOf: (id: string): { marked: number; max: number } => {
    const entity = demo.state.entity(id);
    return { marked: entity?.stress.marked ?? 0, max: entity?.stress.max ?? 0 };
  },
  equip: (id: string): string => {
    const who = demo.party.selected;
    const result = who === null ? { ok: false as const, reason: 'nobody selected' } : equipItem(demo, who, id);
    refreshPlay();
    return result.ok ? result.slot : `refused: ${result.reason}`;
  },
  gear: (id: string): { weapon: string; armor: string } => gearOf(demo, id),
  giveItem: (id: string, quantity = 1): void => {
    demo.world.addItem(id, quantity);
    refreshPlay();
  },

  camera: (): { yaw: number; pitch: number; distance: number; target: { x: number; z: number } } => ({
    yaw: orbit.goal.yaw,
    pitch: orbit.goal.pitch,
    distance: orbit.goal.distance,
    target: { x: orbit.goal.target.x, z: orbit.goal.target.z },
  }),
  addAsset: (asset: unknown): boolean => {
    const parsed = modelAssetSchema.safeParse(asset);
    if (!parsed.success) return false;
    session.run(addAsset(parsed.data));
    assets.add(parsed.data);
    if (mode === 'edit') renderPanel();
    return true;
  },
  assetStatus: (id: string): string => assets.statusOf(id),
  modelSource: (id: string): string => view.modelSource(id),
  placeProp: (tile: number, model: string): void => {
    editor.set('propModel', model);
    editor.setTool('prop');
    editor.begin(pointOf(tile));
    editor.end();
    view.setDecos(editor.scene.decos);
    if (mode === 'edit') renderPanel();
  },
  grantLevel: (level?: number): number => {
    demo.world.grantLevel(level);
    refreshPlay();
    return demo.scenario.partyLevel;
  },
  awaitingLevel: (): string[] => awaitingLevel(demo),
  takeLevel: (id: string, plan: unknown): boolean => takeLevel(id, plan as LevelUpPlan),
  characterLevel: (id: string): number => demo.sheets.get(id)?.level ?? 0,
  cursorTile: (): number => view.cursorAt,
  /** Where a tile's centre lands on screen, in CSS pixels from the page origin. */
  screenOf: (tile: number): { x: number; y: number } => screenPoint(tile, 0),
  gliding: (): number => view.glidingCount,
  arrive: (): boolean => {
    const began = arrive(demo);
    if (began) refreshPlay();
    return began;
  },
  reacting: (): number => view.reactingCount,
  /** The numbers rising over heads right now, and whose. */
  floaters: (): { id: string; text: string }[] =>
    liveFloaters.map((f) => ({ id: f.el.dataset['entity'] ?? '', text: f.el.textContent ?? '' })),
  journal: (): { id: string; status: string; done: string[]; summary: string }[] =>
    journalEntries().map((q) => ({
      id: q.id,
      status: q.status,
      done: q.objectives.filter((o) => o.done).map((o) => o.id),
      summary: q.summary,
    })),
  save: (): boolean => {
    const ok = saveNow();
    refreshPlay();
    return ok;
  },
  load: (): boolean => {
    const ok = loadSlot(QUICK_SLOT);
    refreshPlay();
    return ok;
  },
  saveAs: (name: string): string | null => {
    const text = serialiseSave(demo);
    const slot = text === null ? null : slots.write(text, name, whereWeAre());
    refreshPlay();
    return slot?.id ?? null;
  },
  loadSlot: (id: string): boolean => {
    const ok = loadSlot(id);
    refreshPlay();
    return ok;
  },
  saves: (): { id: string; name: string; where: string; savedAt: number }[] =>
    slots.list().map((slot) => ({ id: slot.id, name: slot.name, where: slot.where, savedAt: slot.savedAt })),
  saveBlocked: (): string | null => saveBlockedBy(demo),
  saveText: (): string | null => slots.read(QUICK_SLOT),

  mode: (): 'play' | 'edit' => mode,
  setMode,
  editorMode: (): string => editor.mode,
  setEditorMode: (next: string): void => {
    // A bad string must not reach the controller: setMode assigns `this.mode`
    // before it looks the tool up, so an unknown mode would leave it pointing
    // at tools that do not exist.
    if (!EDITOR_MODES.includes(next as EditorMode)) return;
    editor.setMode(next as EditorMode);
    if (mode === 'edit') renderPanel();
  },
  setTool: (tool: string): void => {
    editor.setTool(tool as Parameters<EditorController['setTool']>[0]);
    if (mode === 'edit') renderPanel();
  },
  editorTool: (): string => editor.state.tool,
  editorTerrainTab: (): string => editor.terrainTab,
  setTerrain: (id: string): void => editor.set('terrainId', id),
  buildingStats: (): BuildingStats => buildings.stats(),
  authoredCreatureCount: (): number => view.authoredCreatureCount,
  buildAt: (x: number, y: number): boolean => {
    const changed = editor.begin({ x, y }) !== 'none';
    editor.end();
    return changed;
  },
  buildScreenAt: (x: number, y: number): { x: number; y: number } => screenOfWorld(
    x - (activeGrid.width - 1) / 2,
    view.layout.baseHeight + editor.state.buildLevel,
    y - (activeGrid.height - 1) / 2,
  ),
  editAt: (tile: number): boolean => {
    const change = editor.begin(pointOf(tile));
    editor.end();
    if (mode === 'edit') renderPanel();
    return change !== 'none';
  },
  terrainAt: (tile: number): string => editor.scene.terrain[tile] ?? '',
  heightAt: (tile: number): number => editor.scene.heights[tile] ?? 0,
  undo: (): boolean => undoEdit(),
  redo: (): boolean => redoEdit(),
  propCount: (): number => editor.scene.decos.length,
  problems: (): number => {
    // Imported from the legacy map, so its homebrew adversaries are expected.
    return editor.scene.encounters.length;
  },
  exportProject: (): string => JSON.stringify(session.project),
  loadProjectText: (text: string): string => loadProjectText(text),
};
window.__polyheart = state;

let lastFrame = performance.now();
function frame(now = performance.now()): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  steerCamera(dt);
  view.tick(dt);
  // The last token stops: the ambush the walk woke begins.
  if (demo.ambush !== null && view.glidingCount === 0 && arrive(demo)) refreshPlay();
  followSelected();
  driveFloaters(now);
  // Only the build tools work on the level plane, so only they pin the camera
  // to it. Pinning it for a creature placed at Z 3.25 left Home unable to bring
  // the view back down to the room.
  if (buildingTool()) orbit.goal.target.y = view.layout.baseHeight + editor.state.buildLevel;
  if (orbit.update(dt)) applyCamera();
  updateBuildingPreview();
  buildings.update(camera);
  renderer.render(view.scene, camera);
  state.frames++;
  requestAnimationFrame(frame);
}
frame();

// Card art: whatever is in `public/cards/`, plus anything imported into this
// browser. One fetch, and a miss is silent - most machines have no directory at
// all, and every card can draw its own emblem instead.
useCardArtImports(new CardArtImports(browserStore()));
void loadCardArtIndex().then((index) => {
  useCardArtIndex(index);
  // The action bar was drawn before the index arrived, so redraw it - but only
  // the side that is on screen. `renderPanel` is the *editor*, and calling it
  // here replaces the play UI with the editor's, HUD and all.
  if (Object.keys(index).length > 0 && mode === 'play') refreshPlay();
});
