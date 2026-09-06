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

import { h, render } from 'preact';
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
import { EditorSession } from './editor/session';
import { EditorPanel } from './editor/ui/EditorPanel';
import { PlayPanel } from './game/ui/PlayPanel';
import { NO_TILE } from './engine/grid/grid';
import { mapExtent, tileAtWorld } from './engine/render/layout';
import { MODELS } from './engine/render/procedural/registry';
import { SceneView } from './engine/render/scene-view';
import { gridFromScene } from './engine/scene/grid-from-scene';
import { importLegacyScene } from './engine/scene/legacy-import';
import { projectSchema, type ProjectDoc } from './engine/scene/schema';
import type { Response } from './engine/script/runner';
import {
  answerPending,
  attackWithSelected,
  buildDemoScene,
  inCombat,
  moveSelectedTo,
  playGmTurn,
  reachableInteractable,
  useSelectedOn,
  reachableTiles,
  DEMO_MODELS,
  SRD_ADVERSARIES,
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
const view = new SceneView(demo.grid, {
  tints: demo.scene.tints,
  modelForEntity: (entity) => DEMO_MODELS[entity.definition] ?? entity.definition,
});
view.setDecos(demo.scene.decos);
view.syncTokens(demo.state);

let project: ProjectDoc = projectSchema.parse({
  id: 'demo',
  name: 'Demo Vault',
  scenes: [demo.scene],
  // The conversations travel with the project, so Save JSON writes the words as
  // well as the map — the whole point of putting dialogue in the document.
  dialogues: [...demo.dialogues.values()],
  startScene: demo.scene.id,
});
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

/** Rebuild the grid from the edited document, then the meshes over it. */
function rebuildTerrain(): void {
  const scene = editor.scene;
  const { grid } = gridFromScene(scene, demo.grid.palette);
  demo.grid.terrain.set(grid.terrain);
  demo.grid.heights.set(grid.heights);
  view.rebuildTerrain(scene.tints);
}

let mode: 'play' | 'edit' = 'play';

function setMode(next: 'play' | 'edit'): void {
  mode = next;
  editor.end();
  if (mode === 'play') {
    refreshPlay();
  } else {
    view.clearHighlights();
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
      onLoad: loadProject,
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
  rebuildTerrain();
  view.setDecos(editor.scene.decos);
  renderPanel();
}

// ---------------------------------------------------------------------------
// Camera and picking
// ---------------------------------------------------------------------------

const extent = mapExtent(demo.grid, view.layout);
const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, extent.radius * 1.35, extent.radius * 1.25);
camera.lookAt(0, 0, 0);

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
  return tileAtWorld(demo.grid, groundPoint.x, groundPoint.z, view.layout);
}

const pointOf = (tile: number) => ({ x: demo.grid.xOf(tile), y: demo.grid.yOf(tile) });

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

function refreshPlay(): void {
  view.syncTokens(demo.state);
  view.showHighlights(demo.party.selected === null ? [] : reachableTiles(demo).tiles());
  renderPlayPanel();
}

function renderPlayPanel(): void {
  render(
    h(PlayPanel, {
      log: demo.log,
      pending: demo.pending,
      within: reachableInteractable(demo),
      onUse: (id: string) => {
        useSelectedOn(demo, id);
        refreshPlay();
      },
      onAnswer: (response: Response) => {
        answerPending(demo, response);
        refreshPlay();
      },
    }),
    app,
  );
}
refreshPlay();

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const tile = tileUnderPointer(event);
  if (tile === NO_TILE) return;

  if (mode === 'edit') {
    canvas.setPointerCapture(event.pointerId);
    editor.begin(pointOf(tile));
    renderPanel();
    return;
  }

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
});

canvas.addEventListener('pointermove', (event) => {
  if (mode !== 'edit' || event.buttons === 0) return;
  const tile = tileUnderPointer(event);
  if (tile !== NO_TILE) editor.paint(pointOf(tile));
});

canvas.addEventListener('pointerup', (event) => {
  if (mode !== 'edit') return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  editor.end();
  renderPanel();
});

window.addEventListener('keydown', (event) => {
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
  if (event.key === 'Tab') {
    event.preventDefault();
    demo.party.selectNext();
    refreshPlay();
  } else if (event.key === ' ' || event.key === 'Enter') {
    playGmTurn(demo);
    refreshPlay();
  }
});

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

function frame(): void {
  renderer.render(view.scene, camera);
  state.frames++;
  requestAnimationFrame(frame);
}
frame();
