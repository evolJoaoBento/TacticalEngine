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
 * Edit: pick a tool and drag on the map. Ctrl+Z / Ctrl+Shift+Z undo and redo.
 */

import { Fragment, h, render } from 'preact';
import {
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Object3D,
} from 'three';
import { demoMap } from '../legacy/js/data.js';
import { EditorController } from './editor/controller';
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
import { EditorPanel } from './editor/ui/EditorPanel';
import { PlayPanel, type Inspection, type JournalQuest } from './game/ui/PlayPanel';
import { PartyHud, type HudMember } from './game/ui/PartyHud';
import { LevelUpPanel } from './game/ui/LevelUpPanel';
import type { LevelUpIssue, LevelUpPlan } from './engine/character/progression';
import { OrbitCamera } from './engine/render/camera';
import { AssetLibrary, modelAssetSchema, type ModelAsset } from './engine/render/assets';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NO_TILE, type TileGrid } from './engine/grid/grid';
import { mapExtent, tileAtWorld, tileCenter } from './engine/render/layout';
import { MODELS } from './engine/render/procedural/registry';
import { SceneView } from './engine/render/scene-view';
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
  note,
  playGmTurn,
  endTurn,
  reachableInteractable,
  travelTo,
  useSelectedOn,
  reachableTiles,
  DEMO_ADVERSARY_ID,
  DEMO_MODELS,
  SRD_ADVERSARIES,
  SRD_CHARACTERS,
} from './game/demo-scene';

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
      inCombat: () => boolean;
      round: () => number;
      adversaries: () => string[];
      hitPoints: (id: string) => { marked: number; max: number };
      moveTo: (tile: number) => boolean;
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
      wound: (id: string, marks: number) => void;
      gear: (id: string) => { weapon: string; armor: string };
      giveItem: (id: string, quantity?: number) => void;
      journal: () => { id: string; status: string; done: string[] }[];
      camera: () => { yaw: number; pitch: number; distance: number; target: { x: number; z: number } };
      grantLevel: (level?: number) => number;
      addAsset: (asset: unknown) => boolean;
      assetStatus: (id: string) => string;
      modelSource: (id: string) => string;
      placeProp: (tile: number, model: string) => void;
      awaitingLevel: () => string[];
      takeLevel: (id: string, plan: unknown) => boolean;
      characterLevel: (id: string) => number;
      cursorTile: () => number;
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
      setTool: (tool: string) => void;
      setTerrain: (id: string) => void;
      editAt: (tile: number) => boolean;
      terrainAt: (tile: number) => string;
      heightAt: (tile: number) => number;
      undo: () => boolean;
      redo: () => boolean;
      propCount: () => number;
      problems: () => number;
      exportProject: () => string;
    };
  }
}

const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const app = document.getElementById('app') as HTMLDivElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
const gl = renderer.getContext();
const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

// ---------------------------------------------------------------------------
// The scene, and an editable project over the same map
// ---------------------------------------------------------------------------

const demo = buildDemoScene(demoMap());

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

let view = new SceneView(demo.grid, {
  tints: demo.scene.tints,
  modelForEntity: (entity) => DEMO_MODELS[entity.definition] ?? entity.definition,
  assets,
});
view.setDecos(demo.scene.decos);
view.syncTokens(demo.state);

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
    if (change === 'terrain') rebuildTerrain();
    if (change === 'content') view.setDecos(editor.scene.decos);
  },
});

const KNOWN_MODELS = new Set(MODELS.map((m) => m.id));
const TERRAIN_IDS = demo.grid.palette.types.map((t) => t.id);
const PROP_MODELS = MODELS.filter((m) => m.category === 'prop').map((m) => m.id);
const ADVERSARY_IDS = [...SRD_ADVERSARIES.keys()].sort();

/** Redraw whichever panel the current mode owns. */
function refreshEditor(): void {
  rebuildTerrain();
  view.setDecos(editor.scene.decos);
  renderPanel();
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
}

let mode: 'play' | 'edit' = 'play';

function setMode(next: 'play' | 'edit'): void {
  mode = next;
  editor.end();
  // The editor may be pointed at a scene a load has since removed.
  if (!session.project.scenes.some((scene) => scene.id === editor.sceneId)) {
    editor.switchScene(demo.scene.id);
  }
  if (mode === 'play') {
    rebindScene();
    refreshPlay();
  } else {
    rebindScene();
    view.clearHighlights();
    view.syncTokens(demo.state);
    renderPanel();
  }
}

function renderPanel(): void {
  render(
    h(EditorPanel, {
      session,
      controller: editor,
      terrainIds: TERRAIN_IDS,
      propModels: PROP_MODELS,
      adversaryIds: ADVERSARY_IDS,
      knownModels: KNOWN_MODELS,
      knownAdversaries: new Set(SRD_ADVERSARIES.keys()),
      onPlay: () => setMode('play'),
      onSave: saveProject,
      onAssetsChanged: () => {
        for (const id of assets.ids()) assets.remove(id);
        for (const asset of session.project.assets) assets.add(asset);
        view.setDecos(editor.scene.decos);
      },
      onLoad: loadProject,
      playingScene: demo.scene.id,
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
  const parsed = projectSchema.safeParse(JSON.parse(await file.text()));
  if (!parsed.success) {
    errors.push(`Could not load ${file.name}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    renderPanel();
    return;
  }
  project = parsed.data;
  session = new EditorSession(project);
  editor = new EditorController({
    session,
    sceneId: project.startScene,
    onChange: (change) => {
      if (change === 'terrain') rebuildTerrain();
      if (change === 'content') view.setDecos(editor.scene.decos);
    },
  });
  // The loaded project is a different document; nothing on screen survives it.
  for (const id of assets.ids()) assets.remove(id);
  for (const asset of session.project.assets) assets.add(asset);
  boundScene = '';
  rebindScene();
  rebuildTerrain();
  view.setDecos(editor.scene.decos);
  renderPanel();
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

function tileUnderPointer(event: PointerEvent | MouseEvent): number {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits: Intersection<Object3D>[] = raycaster.intersectObjects(view.terrain.meshes, false);
  const hit = hits[0];
  if (hit === undefined) return NO_TILE;
  groundPoint.copy(hit.point);
  return tileAtWorld(activeGrid, groundPoint.x, groundPoint.z, view.layout);
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

  view.dispose();
  view = new SceneView(activeGrid, {
    tints: scene.tints,
    modelForEntity: (entity) => DEMO_MODELS[entity.definition] ?? entity.definition,
    assets,
  });
  view.setDecos(scene.decos);
  frameCamera();
}

function refreshPlay(): void {
  autosaveOnTravel();
  rebindScene();
  // Tokens belong to the played room. Drawing them over another room's grid puts
  // the party on whatever happens to share those tile indices.
  if (activeScene().id === demo.scene.id) {
    view.syncTokens(demo.state);
    view.showHighlights(demo.party.selected === null ? [] : reachableTiles(demo).tiles());
  } else {
    view.clearHighlights();
  }
  renderPlayPanel();
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
      summary: quest.summary,
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
      conditions: [...entity.conditions],
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
    }), levelling !== null && demo.sheets.has(levelling) && awaitingLevel(demo).includes(levelling)
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
    })),
    app,
  );
}
refreshPlay();

canvas.addEventListener('pointerdown', (event) => {
  if (mode === 'edit') {
    if (event.button !== 0) {
      drag = { button: event.button, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    const tile = tileUnderPointer(event);
    if (tile === NO_TILE) return;
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
          ...[...entity.conditions],
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
      facts: [...pools, ...(def === undefined ? [] : [`Difficulty ${def.difficulty}`]), ...[...entity.conditions]],
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
  const tile = tileUnderPointer(event);
  if (tile === NO_TILE) return;

  const occupant = entityOn(tile);
  if (occupant !== null) {
    const entity = demo.state.entity(occupant)!;
    if (entity.faction === 'party') demo.party.select(occupant);
    else attackWithSelected(demo, occupant);
  } else {
    // A click on a thing tries to use it; on bare ground, walk. Reach is checked
    // inside the verb, which reports "out of reach" rather than silently walking.
    const object = objectOn(tile);
    if (object !== null) useSelectedOn(demo, object);
    else moveSelectedTo(demo, tile);
  }
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
    if (event.buttons === 0) return;
    const tile = tileUnderPointer(event);
    if (tile !== NO_TILE) editor.paint(pointOf(tile));
    return;
  }
  // Hover: mark the tile under the pointer so a click has a visible target.
  view.showCursor(tileUnderPointer(event));
});

canvas.addEventListener('pointerleave', () => view.showCursor(NO_TILE));

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
      if (event.shiftKey) session.redo();
      else session.undo();
      rebuildTerrain();
      view.setDecos(editor.scene.decos);
      renderPanel();
    }
    return;
  }
  if (event.key === 'Escape' && inspecting !== null) {
    inspecting = null;
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

function steerCamera(dt: number): void {
  if (mode !== 'play') return;
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
  pendingKind: (): string | null => demo.pending?.prompt.kind ?? null,
  objects: (): string[] => demo.scene.interactables.map((i) => i.id),
  dialogueOptions: (): string[] =>
    demo.pending?.dialogue?.view?.options.map((o) => o.text) ?? [],
  hasDialogue: (): boolean => demo.pending?.dialogue != null,
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
  screenOf: (tile: number): { x: number; y: number } => {
    const centre = tileCenter(activeGrid, tile, view.layout);
    const v = new Vector3(centre.x, 0, centre.z).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  },
  journal: (): { id: string; status: string; done: string[] }[] =>
    journalEntries().map((q) => ({
      id: q.id,
      status: q.status,
      done: q.objectives.filter((o) => o.done).map((o) => o.id),
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
  setTool: (tool: string): void => {
    editor.setTool(tool as Parameters<EditorController['setTool']>[0]);
    if (mode === 'edit') renderPanel();
  },
  setTerrain: (id: string): void => editor.set('terrainId', id),
  editAt: (tile: number): boolean => {
    const change = editor.begin(pointOf(tile));
    editor.end();
    if (mode === 'edit') renderPanel();
    return change !== 'none';
  },
  terrainAt: (tile: number): string => editor.scene.terrain[tile] ?? '',
  heightAt: (tile: number): number => editor.scene.heights[tile] ?? 0,
  undo: (): boolean => {
    const ok = session.undo();
    rebuildTerrain();
    view.setDecos(editor.scene.decos);
    if (mode === 'edit') renderPanel();
    return ok;
  },
  redo: (): boolean => {
    const ok = session.redo();
    rebuildTerrain();
    view.setDecos(editor.scene.decos);
    if (mode === 'edit') renderPanel();
    return ok;
  },
  propCount: (): number => editor.scene.decos.length,
  problems: (): number => {
    // Imported from the legacy map, so its homebrew adversaries are expected.
    return editor.scene.encounters.length;
  },
  exportProject: (): string => JSON.stringify(session.project),
};
window.__polyheart = state;

let lastFrame = performance.now();
function frame(now = performance.now()): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  steerCamera(dt);
  view.tick(dt);
  if (orbit.update(dt)) applyCamera();
  renderer.render(view.scene, camera);
  state.frames++;
  requestAnimationFrame(frame);
}
frame();
