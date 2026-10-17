/**
 * A mini seen from above, in its box: the chosen model in New Game's row of choices is the figure itself,
 * looked down on as it stood on the table, playing its idle.
 *
 * A WebGL context per box would run into the browser's limit of them, so there is one, off screen, and
 * each frame it draws every attached canvas's figure in turn and copies the drawing onto that canvas.
 * A figure is built the way the board builds one (`figureOf`): the glTF cloned with its skeleton,
 * scaled and turned as its asset says, seated on its feet, and its idle clip - the one named, or the
 * first - played on a loop. The same figures stand on the table (`mini-table.ts`).
 *
 * A canvas whose model has not loaded yet asks for it and stays blank until it has; it is marked
 * `data-drawn` once a figure is on it. Nothing is drawn while no canvas is attached, and the context
 * goes when this is disposed.
 */

import { AnimationMixer, Box3, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer, type Object3D } from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { seatOnTile, type AssetLibrary, type ModelAsset } from '../../engine/render/assets';

/** The camera's vertical field of view, in degrees. */
const FOV = 28;
/** The most pixels a canvas is drawn at on a side, whatever the screen's density. */
const MOST = 512;

export interface Figure {
  root: Group;
  mixer: AnimationMixer | null;
  height: number;
  /** How far from its axis it reaches, whichever way it faces. */
  reach: number;
}

/** A figure for a model, built the way the board builds one. */
export function figureOf(template: Object3D, spec: ModelAsset): Figure {
  const body = cloneSkeleton(template);
  body.scale.setScalar(spec.scale);
  body.rotation.y = spec.rotationY;
  if (spec.pivot !== 'file') seatOnTile(body);
  const root = new Group();
  root.add(body);
  let mixer: AnimationMixer | null = null;
  if (template.animations.length > 0) {
    mixer = new AnimationMixer(body);
    const idle = template.animations.find((clip) => clip.name === spec.clips?.idle) ?? template.animations[0]!;
    mixer.clipAction(idle).play();
  }
  const box = new Box3().setFromObject(root);
  const reach = Math.hypot(Math.max(-box.min.x, box.max.x), Math.max(-box.min.z, box.max.z));
  return { root, mixer, height: Math.max(box.max.y - box.min.y, 0.01), reach };
}

/**
 * How high above the table the camera hangs to see a figure whole from straight above, on a canvas
 * of this shape: its reach every way inside the view, with a little room, and never into its head.
 */
export function aboveFor(figure: Pick<Figure, 'height' | 'reach'>, aspect: number): number {
  const half = Math.tan(((FOV / 2) * Math.PI) / 180);
  return Math.max((figure.reach * 1.15) / (half * Math.min(1, aspect)), figure.height * 1.3);
}

interface View {
  canvas: HTMLCanvasElement;
  modelId: string;
  figure: Figure | null;
}

export class MiniPortraits {
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.01, 200);
  private readonly views = new Set<View>();
  private frame = 0;
  private last = 0;
  private disposed = false;

  constructor(private readonly assets: AssetLibrary) {
    this.scene.add(new HemisphereLight(0xfff4e0, 0x3a2a1a, 1.6));
    const lamp = new DirectionalLight(0xffffff, 2.2);
    lamp.position.set(-2, 6, 2);
    this.scene.add(lamp);
    this.camera.up.set(0, 0, -1);
  }

  /** Show a model on a canvas until the returned function is called. */
  attach(canvas: HTMLCanvasElement, modelId: string): () => void {
    const view: View = { canvas, modelId, figure: null };
    this.views.add(view);
    if (this.frame === 0 && !this.disposed) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.draw);
    }
    return () => {
      this.views.delete(view);
      delete canvas.dataset.drawn;
    };
  }

  /** Let the WebGL context go. */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    // A renderer's dispose frees what it made on the GPU, not the context: that goes only when
    // collected, and a few New Games before then would crowd out the board's.
    this.renderer?.forceContextLoss();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private context(): WebGLRenderer | null {
    if (this.renderer !== null) return this.renderer;
    try {
      this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setClearColor(0x000000, 0);
      return this.renderer;
    } catch {
      return null;
    }
  }

  /** A model's figure; null until its file has loaded. */
  private build(modelId: string): Figure | null {
    const template = this.assets.template(modelId);
    const spec = this.assets.spec(modelId);
    if (template === undefined || spec === undefined) {
      this.assets.request(modelId);
      return null;
    }
    return figureOf(template, spec);
  }

  private readonly draw = (): void => {
    this.frame = 0;
    if (this.disposed || this.views.size === 0) return;
    const now = performance.now();
    const delta = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const renderer = this.context();
    if (renderer !== null) {
      for (const view of this.views) this.drawOne(renderer, view, delta);
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  private drawOne(renderer: WebGLRenderer, view: View, delta: number): void {
    view.figure ??= this.build(view.modelId);
    const figure = view.figure;
    const { canvas } = view;
    if (figure === null || !canvas.isConnected || canvas.clientWidth === 0) return;
    const density = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    const width = Math.min(MOST, Math.round(canvas.clientWidth * density));
    const height = Math.min(MOST, Math.round(canvas.clientHeight * density));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const target = canvas.getContext('2d');
    if (target === null) return;

    figure.mixer?.update(delta);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.position.set(0, aboveFor(figure, aspect), 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    renderer.setSize(width, height, false);
    this.scene.add(figure.root);
    renderer.render(this.scene, this.camera);
    this.scene.remove(figure.root);
    target.clearRect(0, 0, width, height);
    target.drawImage(renderer.domElement as unknown as CanvasImageSource, 0, 0, width, height);
    canvas.dataset.drawn = '1';
  }
}
