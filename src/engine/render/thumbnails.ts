/**
 * Pictures of models, for the editor's strip of things to put down.
 *
 * Each model is built once, framed by its bounds, lit from above and to one side, and drawn into a
 * small canvas of this module's own -- a second WebGL context, made on the first picture asked for,
 * so a session that never opens the editor never pays for one -- and kept as a data URL. A model the
 * library cannot supply gives no picture, and neither does a browser that will not give the canvas a
 * WebGL context: the strip falls back rather than this throwing.
 */

import { Box3, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderer, type Object3D } from 'three';
import { seatOnTile, type AssetLibrary } from './assets';
import { RING_ONLY } from './authoring-marks';
import { ModelResources, buildModel } from './procedural/build';
import type { ModelRegistry } from './procedural/registry';

/** Pixels on a side: the strip shows it at half that, so it stays sharp on a high-density screen. */
const SIZE = 152;

/** A three-quarter view from a little above, the angle the board is seen at. */
const VIEW = new Vector3(0.7, 0.55, 1).normalize();

export class ModelThumbnails {
  /** Made on the first picture; null once a browser has refused it a WebGL context. */
  private renderer: WebGLRenderer | null | undefined = undefined;
  private readonly resources = new ModelResources();
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(26, 1, 0.01, 200);
  private readonly pictures = new Map<string, string>();

  constructor(
    private readonly registry: ModelRegistry,
    private readonly assets: AssetLibrary | null = null,
  ) {
    this.scene.add(new HemisphereLight('#ffffff', '#44444f', 2.6));
    const sun = new DirectionalLight('#ffffff', 2.4);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);
  }

  /**
   * Which id would be drawn: the one asked for when the library can supply it, else `fallback` --
   * the stand-in a board draws in its place -- else none. An imported model still on its way is
   * asked for, and is not drawable until it arrives.
   */
  pick(modelId: string, fallback?: string): string | null {
    if (this.drawable(modelId)) return modelId;
    if (fallback !== undefined && this.drawable(fallback)) return fallback;
    return null;
  }

  /** The picture for a model, or its fallback's, as a data URL; null when nothing can be drawn. */
  url(modelId: string, fallback?: string): string | null {
    const id = this.pick(modelId, fallback);
    if (id === null) return null;
    const kept = this.pictures.get(this.key(id));
    if (kept !== undefined) return kept;
    const renderer = this.context();
    if (renderer === null) return null;
    const picture = this.draw(renderer, this.object(id));
    this.pictures.set(this.key(id), picture);
    return picture;
  }

  /** The picture, and whether it is of the stand-in rather than the model asked for. */
  picture(modelId: string, fallback?: string): Thumbnail | null {
    const url = this.url(modelId, fallback);
    return url === null ? null : { url, standIn: this.pick(modelId, fallback) !== modelId };
  }

  private drawable(id: string): boolean {
    if (this.assets !== null && this.assets.has(id)) {
      if (this.assets.template(id) !== undefined) return true;
      this.assets.request(id);
      return false;
    }
    return this.registry.has(id);
  }

  /**
   * What a picture is taken of.
   *
   * A procedural model is built for the occasion. An imported one is shown the way
   * the board will show it — seated on the tile, at the scale and facing and nudge
   * the asset asks for, standing on the same base ring a token carries — because
   * the whole point of the picture is to answer "what will this look like in the
   * room" before it is put in one.
   */
  private object(id: string): Object3D {
    const spec = this.assets?.spec(id);
    const template = this.assets?.template(id);
    if (spec === undefined || template === undefined) return buildModel(this.registry.get(id), this.resources).group;
    const shown = new Group();
    const body = template.clone();
    body.scale.setScalar(spec.scale);
    body.rotation.y = spec.rotationY;
    seatOnTile(body);
    body.position.x += spec.offsetX;
    body.position.z += spec.offsetY;
    body.position.y += spec.groundOffset;
    shown.add(body);
    // The adversary's red, the colour most of what is imported will stand in.
    shown.add(buildModel(RING_ONLY, this.resources, { palette: { ring: { color: '#e5483a' } } }).group);
    return shown;
  }

  /**
   * What a picture is kept under. An imported model's settings are part of it: tune
   * the scale and the picture is of the old one until the key says otherwise.
   */
  private key(id: string): string {
    const spec = this.assets?.spec(id);
    if (spec === undefined) return id;
    return `${id}|${spec.scale}|${spec.groundOffset}|${spec.rotationY}|${spec.offsetX}|${spec.offsetY}`;
  }

  private context(): WebGLRenderer | null {
    if (this.renderer !== undefined) return this.renderer;
    try {
      const canvas = document.createElement('canvas');
      const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(SIZE, SIZE, false);
      renderer.setClearColor(0x000000, 0);
      this.renderer = renderer;
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  private draw(renderer: WebGLRenderer, object: Object3D): string {
    this.scene.add(object);
    const sphere = new Box3().setFromObject(object).getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 0.01);
    const distance = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.02;
    this.camera.position.copy(sphere.center).addScaledVector(VIEW, distance);
    this.camera.near = distance / 50;
    this.camera.far = distance * 3;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(sphere.center);
    renderer.render(this.scene, this.camera);
    const picture = renderer.domElement.toDataURL('image/png');
    this.scene.remove(object);
    return picture;
  }
}

/** A model's picture, and whether it shows the stand-in drawn because the model is not there. */
export interface Thumbnail {
  url: string;
  standIn: boolean;
}

const byRegistry = new WeakMap<ModelRegistry, ModelThumbnails>();

/** The one set of pictures for a registry, made on first use: what `main.ts` asks through. */
export function thumbnailOf(registry: ModelRegistry, assets: AssetLibrary | null, modelId: string, fallback?: string): Thumbnail | null {
  let thumbnails = byRegistry.get(registry);
  if (thumbnails === undefined) {
    thumbnails = new ModelThumbnails(registry, assets);
    byRegistry.set(registry, thumbnails);
  }
  return thumbnails.picture(modelId, fallback);
}
