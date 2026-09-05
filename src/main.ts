/**
 * The demo page.
 *
 * Everything that genuinely needs a browser — a WebGL renderer, a camera, pointer
 * events — and nothing else. The scene it draws is assembled by
 * `game/demo-scene.ts`, which runs anywhere; the engine underneath it has never
 * heard of any of this.
 *
 * Hover previews where the leader can walk, a click walks them there.
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
  buildDemoScene,
  moveLeaderTo,
  reachableTiles,
  DEMO_MODELS,
  DEMO_MOVE_BUDGET,
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
      leaderTile: () => number;
      highlighted: () => number;
      /** Move the leader to a tile, as a click would. Returns whether it moved. */
      moveTo: (tile: number) => boolean;
      /** Tiles the leader can currently reach. */
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

// Frame the whole map from a fixed three-quarter view.
const extent = mapExtent(demo.grid, view.layout);
const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, extent.radius * 1.35, extent.radius * 1.25);
camera.lookAt(0, 0, 0);

const raycaster = new Raycaster();
const pointer = new Vector2();
const groundPoint = new Vector3();

/** The tile under a pointer event, or NO_TILE. */
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

function refreshPreview(): void {
  view.showHighlights(reachableTiles(demo, DEMO_MOVE_BUDGET).tiles());
}
refreshPreview();

let hovered = NO_TILE;
canvas.addEventListener('pointermove', (event) => {
  const tile = tileUnderPointer(event);
  if (tile === hovered) return;
  hovered = tile;
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const tile = tileUnderPointer(event);
  if (tile === NO_TILE) return;
  if (moveLeaderTo(demo, tile, DEMO_MOVE_BUDGET).moved) {
    view.syncTokens(demo.state);
    refreshPreview();
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
  leaderTile: () => demo.state.entity(demo.leaderId)?.tile ?? NO_TILE,
  highlighted: () => view.highlightedCount,
  moveTo: (tile: number): boolean => {
    const result = moveLeaderTo(demo, tile, DEMO_MOVE_BUDGET);
    if (result.moved) {
      view.syncTokens(demo.state);
      refreshPreview();
    }
    return result.moved;
  },
  reachable: (): number[] => reachableTiles(demo, DEMO_MOVE_BUDGET).tiles(),
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
