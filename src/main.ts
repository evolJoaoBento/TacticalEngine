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
import { PCFShadowMap, Plane, PerspectiveCamera, Raycaster, Vector2, Vector3, WebGLRenderer, type Intersection, type Mesh, type Object3D } from 'three';
import { demoMap } from '../legacy/js/data.js';
import { EditorController } from './editor/controller';
import { placementRotation } from './editor/placement-rotation';
import { EDITOR_MODES, type EditorMode } from './editor/modes';
import { EditorSession, addAsset, removeAsset, addScene, removeScene, renameScene, setStartScene, updateInteractable, importPack, packChanges } from './editor/session';
import { EditorShell } from './editor/ui/EditorShell';
import { PlayPanel, TONE, type Inspection, type JournalQuest } from './game/ui/PlayPanel';
import { PartyHud, type HudMember } from './game/ui/PartyHud';
import { LevelUpPanel } from './game/ui/LevelUpPanel';
import { deriveCharacter } from './engine/character/sheet';
import { ActionBar } from './game/ui/ActionBar';
import { LoadoutPanel } from './game/ui/LoadoutPanel';
import { CardPreview } from './game/ui/CardPreview';
import { RestPanel } from './game/ui/RestPanel';
import { abilityList, abilityTargets, abilitiesOf, loadoutView, pointTiles, rest, shapeAt, swapCard, useAbility, type RestPlan } from './game/demo-abilities';
import type { LevelUpIssue, LevelUpPlan } from './engine/character/progression';
import { OrbitCamera } from './engine/render/camera';
import { BuildingView, type BuildingStats } from './engine/render/building-view';
import { BUILD_LIMIT, isBuildCoordinate } from './engine/scene/building';
import { Z_STEP, roundToStep } from './editor/height-ladder';
import { AssetLibrary, modelAssetSchema, type ModelAsset } from './engine/render/assets';
import { thumbnailOf } from './engine/render/thumbnails';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NO_TILE, type Spot, type TileGrid } from './engine/grid/grid';
import { mapExtent, spotToWorld, tileAtWorld, tileCenter, worldToSpot } from './engine/render/layout';
import { MODELS } from './engine/render/procedural/registry';
import { SceneView, hueOf, OUTLINE_LAYER } from './engine/render/scene-view';
import { journalSummary } from './engine/content/quests';
import { blankScene, gridFromScene, paletteForProject } from './engine/scene/grid-from-scene';
import { importLegacyScene } from './engine/scene/legacy-import';
import { unfamiliarCode } from './engine/script/hooks';
import { projectSchema, type Interactable, type ProjectDoc, type SceneDoc } from './engine/scene/schema';
import type { Response } from './engine/script/runner';
import { loadGameText, saveBlockedBy, serialiseSave } from './game/save';
import { migrateDocument } from './engine/scene/migrate';
import { forgetFile, saveProjectFile } from './editor/project-file';
import { describePack, packOf, readPack } from './engine/content/pack/document';
import type { AdversaryDef } from './engine/content/types';
import { AUTO_SLOT, QUICK_SLOT, SaveSlots, browserStore } from './game/save-slots';
import { CardArtImports, loadCardArtIndex, useCardArtImports, useCardArtIndex } from './game/ui/card-art';
import { answerPending, attackWithSelected, buildDemoScene, moveSelectedTo, playGmTurn, endTurn, refreshWorld, syncPools, syncRoster, gatherParty, reachableInteractable, useSelectedOn, buildProjectScene, setSheet, type DemoScene } from './game/demo-scene';
import { inCombat, scriptPending } from './game/moment';
import { underPressureTiles, arrive, previewStrike, previewWalk, startEncounter, reachableTiles } from './game/movement';
import { DEMO_ADVERSARY_ID, DEMO_MODELS, DEMO_CHARACTERS } from './game/demo-rules';
import { travelTo, characterContentFor, adversaryDefsFor, syncAuthoredEncounters } from './game/room';
import { nameOf, note } from './game/log';
import { applyLevelUp, awaitingLevel } from './game/level-up';
import { equipItem, gearOf } from './game/equip';
import { useItem } from './game/use-item';
import { inspection } from './game/inspect';
import { STARTER_ABILITIES } from './engine/content/pack/starter';

declare global {
  interface Window {
    /** Test and debug handle. Nothing in the engine reads it. */
    __engine?: {
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
      /** Whether an Alt facing gesture is under way; blur and keyup must end it. */
      altRotating: () => boolean;
      problems: () => number;
      exportProject: () => string;
      loadProjectText: (text: string) => string;
      /** Import a pack file's text into the project being edited, as the Project menu does. */
      importPackText: (text: string, label?: string) => { imported: boolean; message: string };
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
 * the log's tone colour and needs no texture. `hud.css` has the look.
 */
const floaterLayer = document.createElement('div');
floaterLayer.id = 'floaters';
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
    el.className = 'floater';
    el.style.color = TONE[floater.tone];
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
renderer.shadowMap.type = PCFShadowMap;
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

/**
 * What each adversary type is drawn with, held here rather than read off the
 * session: the view below syncs its tokens while it is being set up, which is
 * before the session that owns the document exists. Edits mutate this very
 * record in place, so it stays current on its own; only a load, which swaps the
 * whole document, has to point it at the new one.
 */
let adversaryModels: Readonly<Record<string, string>> = demo.project.adversaryModels;

const view = new SceneView(demo.grid, {
  tints: demo.scene.tints,
  // This creature's own look first, then what the project draws its type with,
  // then the game's own mapping, and failing all three the adversary's id. The
  // project's map beats DEMO_MODELS deliberately: an author who re-skins a type
  // the demo already names would otherwise be quietly ignored.
  modelForEntity: (entity) =>
    entity.model
    ?? adversaryModels[entity.definition]
    ?? DEMO_MODELS[entity.definition]
    ?? entity.definition,
  // Almost none of the SRD's stat blocks have art of their own yet, and a board
  // of magenta markers cannot be read. A husk body stands in - and the view
  // still reports the real id as missing, so the models diagnostic and
  // `docs/CRPG-GAPS.md` keep saying what is still to be made.
  fallbackFor: (entity) => (entity.faction === 'adversary' ? 'husk' : null),
  assets,
});
view.setScenery(demo.scene);
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

// A file arriving changes what the Models panel can offer - a clip list it could
// not know until the file was here. The view already redraws itself on this;
// the panel has to be told too, or the dropdowns stay empty until something
// else happens to re-render them.
assets.onChange(() => { if (mode === 'edit') renderPanel(); });

// The library's own, plus whatever the project declares: a file in `public/models` is drawable.
const KNOWN_MODELS = new Set([...MODELS.map((m) => m.id), ...demo.project.assets.map((a) => a.id)]);
const TERRAIN_TYPES = demo.grid.palette.types;
const PROP_MODELS = MODELS.filter((m) => m.category === 'prop').map((m) => m.id);
/**
 * The Combat strip's creatures: the pack the app ships, and whatever the project carries or has
 * imported over it. Asked on every draw, because an import changes it.
 */
function adversaryLibrary(): AdversaryDef[] {
  return [...adversaryDefsFor(session.project).values()].sort((a, b) => a.name.localeCompare(b.name));
}

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
  view.setScenery(activeScene());
  // Same order the play path uses: the project's own re-skins win over the demo's.
  view.setAuthoring(mode === 'edit' ? editor.scene : null, {
    ...DEMO_MODELS,
    ...session.project.adversaryModels,
  });
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
  const { grid } = gridFromScene(scene, paletteForProject(session.project));
  activeGrid.adopt(grid);
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
  return stepEdit(() => session.undo());
}

function redoEdit(): boolean {
  return stepEdit(() => session.redo());
}

/**
 * One step back or forward, and whatever it touched redrawn.
 *
 * In play the running game is rebuilt over the document the step left, as an import in play is:
 * a card's passive is folded into the numbers a sheet is derived with, and the world copies the
 * project's stat blocks and conditions when it is built, so a step taken there would otherwise
 * stay in the game until the next trip through the editor. It is refused where the import is,
 * mid-prompt or mid-fight, since rebuilding the world there pulls the table out from under the
 * question.
 */
function stepEdit(step: () => boolean): boolean {
  if (mode === 'play' && saveBlockedBy(demo) !== null) return false;
  const ok = step();
  // `rebuildTerrain` ends in `syncEditorContent`, which is what redraws the
  // scenery; setting the decos again here drew every prop twice over.
  rebuildTerrain();
  if (mode === 'edit') {
    renderPanel();
  } else if (ok) {
    rederiveParty();
    refreshPlay();
  }
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
    demo.characters.set(
      id,
      deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character,
    );
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
      terrainTypes: TERRAIN_TYPES,
      propModels: PROP_MODELS,
      adversaries: adversaryLibrary(),
      knownModels: KNOWN_MODELS,
      knownAdversaries: new Set(adversaryDefsFor(session.project).keys()),
      libraryAbilities: STARTER_ABILITIES,
      characterContent: characterContentFor(demo.project),
      characterPack: characterContentFor(),
      preview: (card) => h(CardPreview, { card, content: characterContentFor(demo.project) }),
      thumbnail: (item) => item.tab.startsWith('tier-') ? thumbnailOf(view.registry, assets, adversaryModels[item.id] ?? DEMO_MODELS[item.id] ?? item.id, 'husk') : thumbnailOf(view.registry, assets, item.id),
      playingScene: demo.scene.id,
      onPlay: () => setMode('play'),
      onPlayHere: () => playAt(editor.sceneId, null),
      onUndo: () => void undoEdit(),
      onRedo: () => void redoEdit(),
      onSave: () => void saveProject(),
      onSaveAs: () => { forgetFile(); void saveProject(); },
      onLoad: loadProject,
      onImportPack: (files: readonly File[]) => void importPacks(files),
      onExportPack: exportPack,
      onAssetsChanged: () => {
        for (const id of assets.ids()) assets.remove(id);
        for (const asset of session.project.assets) assets.add(asset);
        view.setScenery(editor.scene);
      },
      // The Models panel offers the clips a file actually carries, so it needs
      // the loaded template rather than the declaration.
      assetClips: (id: string): readonly string[] =>
        (assets.template(id)?.animations ?? []).map((clip) => clip.name),
      assetStatus: (id: string): string => assets.statusOf(id),
      onRequestAssets: (id?: string) => (id === undefined ? assets.requestAll() : void assets.request(id)),
      assetPreview: (id: string) => thumbnailOf(view.registry, assets, id)?.url ?? null,
      onAssetTuned: (id: string) => {
        const tuned = session.project.assets.find((asset) => asset.id === id);
        if (tuned !== undefined) assets.retune(tuned);
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

async function saveProject(): Promise<void> {
  const outcome = await saveProjectFile(JSON.stringify(session.project, null, 2), `${session.project.id}.json`);
  // A closed dialog is not a save: the project stays dirty and the tab still warns.
  if (outcome !== 'cancelled') session.markSaved();
  renderPanel();
}
/**
 * Project > Export pack: the project's content -- classes, cards, creatures, the scripts on the cards
 * and the conditions they apply -- as a pack file, which Import pack reads back into this project or
 * another. Not a save: no scenes, no party, nothing marked saved.
 */
function exportPack(): void {
  const blob = new Blob([JSON.stringify(packOf(session.project), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${session.project.id}-pack.json`;
  link.click();
  URL.revokeObjectURL(url);
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
  // Migrate before validating, for the same reason a save is: a project written by an older
  // build is rewritten on the way in rather than refused.
  const parsed = projectSchema.safeParse(migrateDocument(JSON.parse(text)));
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
  // The question Import pack asks, for the same reason: a project file somebody hands you is their
  // code too. Only what this project does not already run is asked about, so reloading the
  // project you have open asks nothing.
  const strange = unfamiliarCode(parsed.data.code, session.project.code);
  if (strange.length > 0 && !confirm(codeQuestion(label, strange, 'Load'))) {
    const reason = `Could not load ${label}: it carries code, and it was not accepted`;
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
  // Edits mutate the record in place, so this only has to follow a whole new one.
  adversaryModels = project.adversaryModels;
  boundScene = '';
  rebindScene();
  rebuildTerrain();
  view.setScenery(editor.scene);
  refreshPlay();
  renderPanel();
  return '';
}

/** The files picked under Project > Import pack, one after another. */
async function importPacks(files: readonly File[]): Promise<void> {
  const said: string[] = [];
  for (const file of files) said.push(importPackText(await file.text(), file.name).message);
  // The picker is the one place a person is waiting on an answer, so they are told it. The
  // driver's handle hands back the same sentence instead.
  if (said.length > 0) alert(said.join('\n\n'));
}

/** What Import pack and Load ask before new code comes in: which scripts, and what code can do. */
function codeQuestion(label: string, code: readonly { id: string; name: string }[], verb: 'Import' | 'Load'): string {
  const named = code.map((entry) => (entry.name === '' ? entry.id : `${entry.name} (${entry.id})`));
  return [
    `${label} carries code: ${code.length === 1 ? 'one script' : `${code.length} scripts`} -- ${named.join(', ')}.`,
    'Code in a pack runs inside the game with everything the game can reach. It is not sandboxed.',
    `${verb} it only if you trust whoever made it. ${verb} it, code and all?`,
  ].join('\n\n');
}

/**
 * Lay a pack's content into the project being edited.
 *
 * Not a load. Nothing the game is running is replaced: the party stays where it stands and the
 * room stays as it is. What changes is what the project carries -- classes and cards the Party
 * panel can offer, stat blocks the Combat strip can place, the scripts and conditions play reads --
 * laid over what it had by id, as one step Undo takes back.
 *
 * Returns what it did or why it did nothing, as a sentence either way.
 */
function importPackText(text: string, label = 'the pack'): { imported: boolean; message: string } {
  const refuse = (why: string): { imported: boolean; message: string } => {
    const message = `Could not import ${label}: ${why}`;
    errors.push(message);
    if (mode === 'edit') renderPanel();
    return { imported: false, message };
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse('it is not JSON');
  }
  const reading = readPack(raw, label);
  if (reading.refused !== null) return refuse(reading.refused);
  // In play the world is rebuilt over the new content at once, and rebuilding it under a prompt or
  // a fight's turn order would pull the table out from under the question. The editor rebuilds it
  // on the way back to play, which is when every other content edit reaches it too.
  const blocked = mode === 'play' ? saveBlockedBy(demo) : null;
  if (blocked !== null) return refuse(blocked);
  // Code in a pack runs in this page with everything the game can reach -- the shadowing in
  // `script/hooks.ts` is a guard rail, not a sandbox -- so it comes in only when somebody says so.
  // All or nothing: a pack whose cards call its code is half a pack without it. Code the project
  // already runs, word for word, was accepted when it came in and is not asked about again.
  const strange = unfamiliarCode(reading.pack.code, session.project.code);
  if (strange.length > 0 && !confirm(codeQuestion(label, strange, 'Import'))) {
    return refuse('it carries code, and it was not accepted');
  }

  const { replaced } = packChanges(session.project, reading.pack);
  session.run(importPack(reading.pack));
  if (mode === 'play') {
    rederiveParty();
    refreshPlay();
  } else {
    renderPanel();
  }

  const parts = [`Imported ${label}: ${describePack(reading.pack)}.`];
  if (replaced > 0) parts.push(`${replaced} replaced what the project already had under the same id.`);
  if (reading.issues.length > 0) {
    const first = reading.issues[0]!;
    parts.push(
      `${reading.issues.length} could not be read and were left out; the first, ${first.entry} (${first.field}): ${first.message}.`,
    );
  }
  return { imported: true, message: parts.join(' ') };
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

// Drag on the board: a left drag orbits in play, a middle drag orbits in either mode, a
// right drag pans, and a press that moves less than a few pixels is a click. The prototype drew the
// same line at 6px with OrbitControls; here the threshold is ours to test.
const DRAG_THRESHOLD = 6;
let drag: { button: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null = null;

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    // Ctrl + wheel in the editor is the height ladder's wheel, wherever the pointer is.
    if (mode === 'edit' && (event.ctrlKey || event.metaKey) && placementTool()) {
      endAltRotation();
      editor.setBuildLevel(Math.max(-BUILD_LIMIT, Math.min(BUILD_LIMIT, roundToStep(editor.state.buildLevel + (event.deltaY < 0 ? Z_STEP : -Z_STEP)))));
      renderPanel();
      return;
    }
    orbit.zoom(Math.exp(event.deltaY * 0.0012));
  },
  { passive: false },
);

const raycaster = new Raycaster();
const pointer = new Vector2();
const groundPoint = new Vector3();
const buildPlane = new Plane(new Vector3(0, 1, 0), 0);
let lastBuildPointer: { clientX: number; clientY: number } | null = null;
let altRotation: {
  start: { clientX: number; clientY: number };
  world: { x: number; z: number };
  rotation: number;
  tool: string;
  pointer: { clientX: number; clientY: number };
} | null = null;

function rotatablePlacement(): boolean {
  return mode === 'edit' && (editor.carried === null ? editor.state.tool === 'buildTile' || editor.state.tool === 'prop' : editor.carriedFacing !== null);
}

function beginAltRotation(at: { clientX: number; clientY: number }): boolean {
  if (editor.carried === null) editor.end();
  drag = null;
  lastBuildPointer = { clientX: at.clientX, clientY: at.clientY };
  const world = pointOnBuildPlane(at);
  if (world === null) return false;
  altRotation = {
    start: { clientX: at.clientX, clientY: at.clientY },
    world,
    rotation: editor.carriedFacing === null ? editor.state.buildRotation : Math.round(editor.carriedFacing / (Math.PI / 2)),
    tool: editor.state.tool,
    pointer: at,
  };
  return true;
}

function endAltRotation(): void {
  if (altRotation !== null) lastBuildPointer = altRotation.pointer;
  altRotation = null;
}

/** Consume rotation gestures before either painting or camera dragging sees them. */
function rotatePlacement(event: PointerEvent): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || !rotatablePlacement()) {
    endAltRotation();
    return false;
  }
  event.preventDefault();
  if (altRotation === null || altRotation.tool !== editor.state.tool) {
    if (!beginAltRotation(lastBuildPointer ?? event)) return true;
  }
  const gesture = altRotation!;
  gesture.pointer = { clientX: event.clientX, clientY: event.clientY };
  const world = pointOnBuildPlane(event);
  if (world === null) return true;
  const rotation = placementRotation(
    gesture.rotation,
    world.x - gesture.world.x,
    world.z - gesture.world.z,
    Math.hypot(event.clientX - gesture.start.clientX, event.clientY - gesture.start.clientY),
  );
  const turned = editor.turnBy(rotation);
  if (turned === 'carried') view.carryTurn(editor.carriedFacing ?? 0);
  else if (turned === 'placed') renderPanel();
  return true;
}

/** The raycaster, pointed from the camera through the pointer. */
function aim(event: { clientX: number; clientY: number }): Raycaster {
  const rect = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster;
}

/** The cell the pointer crosses on the flat plane at the level being built on. */
function pointOnBuildPlane(event: { clientX: number; clientY: number }): { x: number; z: number } | null {
  aim(event);
  buildPlane.constant = -(view.layout.baseHeight + editor.state.buildLevel);
  if (!raycaster.ray.intersectPlane(buildPlane, groundPoint)) return null;
  return { x: groundPoint.x, z: groundPoint.z };
}

/** The cell the pointer crosses on the flat plane at the level being built on. */
function buildingUnderPointer(event: { clientX: number; clientY: number }): Spot | null {
  const world = pointOnBuildPlane(event);
  if (world === null) return null;
  const spot = worldToSpot(activeGrid, world.x, world.z, view.layout);
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
  const hits: Intersection<Object3D>[] = aim(event).intersectObjects(view.terrain.meshes, false);
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
  view.rebind(activeGrid, { tints: scene.tints, decos: scene.decos, objects: scene.interactables });
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
    const role = sheet === undefined ? '' : (characterContentFor(demo.project).classes.get(sheet.classId)?.name ?? sheet.classId);
    return {
      id: entity.id,
      name: sheet?.name ?? entity.id,
      role,
      selected: demo.party.selected === entity.id,
      alive: entity.alive,
      hitPoints: { ...entity.hitPoints },
      stress: { ...entity.stress },
      armorSlots: { ...entity.armorSlots },
      ...(entity.good === undefined ? {} : { good: { ...entity.good } }),
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
    h(Fragment, null, h(PartyHud, {
      members: hudMembers(),
      bad: { ...demo.state.bad },
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
      light: demo.party.selected === null ? null : (demo.state.entity(demo.party.selected)?.good ?? null),
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
          content: characterContentFor(demo.project),
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
      // One at a time, in the order they were rolled: a feature that catches the
      // whole party rolls several in one burst, and they queue.
      rolls: demo.rolls,
      millis: demo.diceMillis,
      onRollDone: (id: number) => {
        demo.rolls = demo.rolls.filter((waiting) => waiting.id !== id);
        refreshPlay();
      },
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
      actorGood: demo.scenario.actorId === null ? 0 : (demo.state.entity(demo.scenario.actorId)?.good?.value ?? 0),
    })),
    app,
  );
}
refreshPlay();

/** Press on the board in the editor. Whatever the press took hold of lifts off the ground, to be carried. */
function pressAt(event: PointerEvent, at: Spot): void {
  canvas.setPointerCapture(event.pointerId);
  editor.begin(at);
  const held = editor.carried;
  if (held !== null) view.lift(held.kind, held.key);
  canvas.style.cursor = held === null ? '' : 'grabbing';
  renderPanel();
}

/** Let go in the editor: the stroke ends, and whatever was carried falls onto where it now stands. */
function release(): void {
  const held = editor.carried;
  editor.end();
  view.drop(held?.kind, held?.key);
  canvas.style.cursor = '';
  renderPanel();
}

canvas.addEventListener('pointerdown', (event) => {
  if (rotatePlacement(event)) return;
  if (mode === 'edit') {
    if (event.button !== 0) {
      release();
      drag = { button: event.button, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    // Select and the place tool take the thing drawn under the pointer, not the ground behind it.
    const drawn = event.shiftKey || !['select', 'adversary'].includes(editor.state.tool) ? null : view.authoredUnder(aim(event));
    if (drawn !== null) return pressAt(event, drawn);
    if (placementTool() && !event.shiftKey) {
      const at = placementUnderPointer(event);
      if (at !== null) pressAt(event, at);
      return;
    }
    const tile = tileUnderPointer(event);
    if (tile === NO_TILE) return;
    // Shift-click on the ground: play from this tile.
    if (event.shiftKey) {
      playAt(editor.sceneId, tile);
      return;
    }
    pressAt(event, pointOf(tile));
    return;
  }

  // In play every button starts a possible drag; the click happens on release
  // if the pointer stayed put.
  drag = { button: event.button, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  canvas.setPointerCapture(event.pointerId);
});

/** Facts about whatever stands on a tile — a party member, an adversary, an object: `game/inspect.ts`. */
const inspectTile = (tile: number): Inspection | null => inspection(demo, entityOn(tile), objectOn(tile));

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
  if (rotatePlacement(event)) return;
  if (drag !== null) {
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (drag.moved) {
      if (drag.button === 0 || drag.button === 1) orbit.orbit(-dx * 0.006, -dy * 0.004);
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
    // The ghost only needs where the pointer is; working out the cell costs a
    // raycast against the terrain meshes, so a hover does not pay for one.
    if (placementTool()) lastBuildPointer = { clientX: event.clientX, clientY: event.clientY };
    if (event.buttons !== 1) return;
    const tile = placementTool() ? NO_TILE : tileUnderPointer(event);
    const at = placementTool() ? placementUnderPointer(event) : tile === NO_TILE ? null : pointOf(tile);
    if (at !== null) editor.paint(at);
    // Either raycast leaves where it struck in `groundPoint`: what is carried hangs over it.
    if (editor.carried !== null) view.carryTo(groundPoint.x, groundPoint.y, groundPoint.z);
    return;
  }
  // Hover: mark the spot under the pointer so a click has a visible target,
  // and draw the line a click there would walk.
  const ground = groundUnderPointer(event);
  const over = ground?.tile ?? NO_TILE;
  view.showCursor(over);
  view.spotlight(view.objectUnder(aim(event)));
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
  endAltRotation();
  lastBuildPointer = null;
  view.showCursor(NO_TILE);
  view.clearPath();
});

canvas.addEventListener('pointercancel', () => {
  endAltRotation();
  lastBuildPointer = null;
  drag = null;
  // Rendering the editor shell in play would paint it over the play UI.
  if (mode === 'edit') release();
  else editor.end();
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
  else view.showPath(preview.route, preview.beyond, preview.run);
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
  if (mode === 'edit') release();
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
  // Alt is a held editing gesture now, and on Chrome/Windows Alt+ArrowLeft/Right is
  // Back/Forward, which would navigate away and lose the whole unsaved project. Cancel
  // the arrows here; camera pan still works, since it runs off the separate held-set
  // listener and preventDefault does not stop another listener.
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (mode === 'edit' || mode === 'play')) event.preventDefault();
  if (event.key === 'Alt' && !event.ctrlKey && !event.metaKey && rotatablePlacement()) {
    event.preventDefault();
    if (altRotation === null && lastBuildPointer !== null) beginAltRotation(lastBuildPointer);
    return;
  }
  if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault(); // Before the browser's own Save Page.
    void saveProject();
    return;
  }
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
      // R remains a single-step alternative to Alt + mouse for tiles and props.
      if (!event.altKey && (buildingTool() || rotatablePlacement()) && event.key.toLowerCase() === 'r') {
        editor.end();
        editor.set('buildRotation', (editor.state.buildRotation + 1) % 4);
        renderPanel();
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        // Moving the build plane re-anchors an Alt gesture's captured world point, so the
        // facing would jump with no pointer motion; end the gesture before the plane moves.
        endAltRotation();
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
window.addEventListener('keyup', (event) => {
  held.delete(event.key.toLowerCase());
  if (event.key === 'Alt') endAltRotation();
});
window.addEventListener('blur', () => {
  held.clear();
  endAltRotation();
  lastBuildPointer = null;
  drag = null;
  editor.end();
});
window.addEventListener('beforeunload', (event) => {
  // A tab close or reload with unsaved edits should prompt: the project lives only in
  // memory until it is saved, so leaving by any route would throw the edits away.
  if (session.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

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
  if (altRotation !== null && rotatablePlacement()) return;
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
    if (result.moved || result.pending === true) refreshPlay();
    return result.moved;
  },
  walkTo: (x: number, y: number): boolean => {
    const result = moveSelectedTo(demo, activeGrid.tileAtSpot(x, y), { x, y });
    if (result.moved || result.pending === true) refreshPlay();
    return result.moved;
  },
  underPressure: (): number[] => underPressureTiles(demo),
  standingAt: (id: string): { x: number; y: number } | null => {
    const entity = demo.state.entity(id);
    return entity === undefined || entity.tile === NO_TILE ? null : { x: entity.at.x, y: entity.at.y };
  },
  /** Where a spot on the ground lands on screen, in CSS pixels from the page origin. */
  screenAt: (x: number, y: number): { x: number; y: number } => screenAt({ x, y }, 0),
  previewAt: (x: number, y: number): { route: { x: number; y: number }[]; beyond: { x: number; y: number }[]; run: boolean } | null => {
    const preview = previewWalk(demo, activeGrid.tileAtSpot(x, y), { x, y });
    if (preview === null) return null;
    return { route: preview.route.map((s) => ({ x: s.x, y: s.y })), beyond: preview.beyond.map((s) => ({ x: s.x, y: s.y })), run: preview.run };
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
  dice: (): { good: number; bad: number; total: number }[] =>
    demo.rolls.map((shown) => ({ good: shown.roll.good, bad: shown.roll.bad, total: shown.roll.total })),
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
  setGood: (id: string, value: number): void => {
    const entity = demo.state.entity(id);
    if (entity?.good === undefined) return;
    entity.good = { max: entity.good.max, value: Math.max(0, Math.min(entity.good.max, value)) };
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
    return { loadout: view.loadout.map((c) => c.id), vault: view.vault.map((c) => c.id), granted: view.granted.map((c) => c.id) };
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
  setCondition: (id: string, condition: string, on: boolean): boolean => {
    const changed = on ? demo.world.applyCondition(id, condition, 'scene') : demo.world.clearCondition(id, condition);
    refreshPlay();
    return changed;
  },
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
    view.setScenery(editor.scene);
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
  setTerrain: (id: string): void => editor.set('tileId', id),
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
  altRotating: (): boolean => altRotation !== null,
  problems: (): number => {
    // Imported from the legacy map, so its homebrew adversaries are expected.
    return editor.scene.encounters.length;
  },
  exportProject: (): string => JSON.stringify(session.project),
  loadProjectText: (text: string): string => loadProjectText(text),
  importPackText: (text: string, label?: string) => importPackText(text, label),
};
window.__engine = state;

let lastFrame = performance.now();
function frame(now = performance.now()): void {
  const dt = Math.min(0.5, (now - lastFrame) / 1000);
  lastFrame = now;
  steerCamera(dt);
  view.tick(dt);
  // The last token stops: the ambush the walk woke begins.
  if (demo.ambush !== null && view.glidingCount === 0 && arrive(demo)) refreshPlay();
  followSelected();
  driveFloaters(now);
  // The centre follows the storey, once each time it moves: held there every frame it left Home nothing to do.
  if (editor.takeLevelChange()) orbit.goal.target.y = view.layout.baseHeight + editor.state.buildLevel;
  if (orbit.update(dt)) applyCamera();
  updateBuildingPreview();
  buildings.update(camera);
  // The hover rim is play's; the editor points at things its own way (`render/toon.ts`).
  if (camera.layers.isEnabled(OUTLINE_LAYER) !== (mode === 'play')) camera.layers.toggle(OUTLINE_LAYER);
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
