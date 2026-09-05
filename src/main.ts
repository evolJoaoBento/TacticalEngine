/**
 * The demo page.
 *
 * Everything that genuinely needs a browser — a WebGL renderer, a camera, pointer
 * and key events — and nothing else. The scene it drives is assembled by
 * `game/demo-scene.ts`, which runs anywhere; the engine underneath it has never
 * heard of any of this.
 *
 * Click a companion to take control of them, click the ground to walk (the rest
 * follow), Tab to cycle. Walk into the vault and the fight starts; then a click on
 * an adversary attacks, and Space plays the GM's turn.
 */

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
import { NO_TILE } from './engine/grid/grid';
import { mapExtent, tileAtWorld } from './engine/render/layout';
import { SceneView } from './engine/render/scene-view';
import {
  attackWithSelected,
  buildDemoScene,
  inCombat,
  moveSelectedTo,
  playGmTurn,
  reachableTiles,
  DEMO_MODELS,
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
    };
  }
}

const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
const gl = renderer.getContext();
const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

const demo = buildDemoScene(demoMap());
const view = new SceneView(demo.grid, {
  tints: demo.scene.tints,
  modelForEntity: (entity) => DEMO_MODELS[entity.definition] ?? entity.definition,
});
view.setDecos(demo.scene.decos);
view.syncTokens(demo.state);

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

/** The living entity standing on a tile — a click on a token, not the ground. */
function entityOn(tile: number): string | null {
  for (const id of demo.state.occupantsOf(tile)) {
    if (demo.state.entity(id)?.alive === true) return id;
  }
  return null;
}

function refresh(): void {
  view.syncTokens(demo.state);
  view.showHighlights(demo.party.selected === null ? [] : reachableTiles(demo).tiles());
}
refresh();

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const tile = tileUnderPointer(event);
  if (tile === NO_TILE) return;

  const occupant = entityOn(tile);
  if (occupant !== null) {
    const entity = demo.state.entity(occupant)!;
    if (entity.faction === 'party') demo.party.select(occupant);
    else attackWithSelected(demo, occupant);
  } else {
    moveSelectedTo(demo, tile);
  }
  refresh();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    demo.party.selectNext();
    refresh();
  } else if (event.key === ' ' || event.key === 'Enter') {
    playGmTurn(demo);
    refresh();
  }
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

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
    if (ok) refresh();
    return ok;
  },
  selectNext: (): string | null => {
    const id = demo.party.selectNext();
    refresh();
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
    if (result.moved) refresh();
    return result.moved;
  },
  attack: (id: string): boolean => {
    const result = attackWithSelected(demo, id);
    refresh();
    return result !== null && result.refused === null;
  },
  endGmTurn: (): number => {
    const acted = playGmTurn(demo);
    refresh();
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
};
window.__polyheart = state;

function frame(): void {
  renderer.render(view.scene, camera);
  state.frames++;
  requestAnimationFrame(frame);
}
frame();
