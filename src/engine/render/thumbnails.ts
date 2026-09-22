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
import { TILE_UNDER } from './authoring-marks';
import { ModelResources, buildModel } from './procedural/build';
import type { ModelRegistry } from './procedural/registry';

/** Pixels on a side: the strip shows it at half that, so it stays sharp on a high-density screen. */
const SIZE = 152;

/**
 * How much room round the tile a framed picture keeps, in tiles.
 *
 * A picture framed to what it contains cannot show where a thing stands: nudge the
 * model and the camera follows it, so nothing moves. Framing a fixed volume — the
 * tile, and a model's worth of height over it — is what makes an offset visible,
 * because the tile stays put while the model slides across it.
 */
const FRAMED = 0.78;

/** A three-quarter view from a little above, the angle the board is seen at. */
const VIEW = new Vector3(0.7, 0.55, 1).normalize();

/**
 * Where a portrait is taken from: nearly level with the face and only a little to one side. The
 * board's own angle looks down on the top of a head, which is right for a token and wrong for a
 * photograph of somebody.
 */
const FACE_VIEW = new Vector3(0.42, 0.1, 1).normalize();

/** How much of a figure's height a portrait takes in: head and shoulders, not the whole body. */
const FACE_SPAN = 0.22;

/** A rig's head joint, by the names rigs give it -- and not the marker at the crown beyond it. */
const HEAD_JOINT = /head(?!.*(top|end|nub|tip))/i;

/**
 * What a portrait frames: the face, rather than the whole of whoever it is.
 *
 * A rigged model says where its head is, and that is believed: the joint sits at the base of the
 * skull, so the centre goes a little above it. Anything else -- a scanned miniature, a procedural
 * token -- is taken to be standing up with its head at the top, which is where the head of nearly
 * everything that has one is. A figure holding something over its head is framed too high by that;
 * a head joint is how a model says otherwise.
 */
export function faceFraming(box: Box3, head: Vector3 | null): Sphere {
  const height = Math.max(box.max.y - box.min.y, 0.01);
  const radius = height * FACE_SPAN;
  if (head !== null) return new Sphere(new Vector3(head.x, head.y + height * 0.05, head.z), radius);
  const centre = box.getCenter(new Vector3());
  return new Sphere(new Vector3(centre.x, box.max.y - radius * 0.95, centre.z), radius);
}

/** The world position of a model's head joint, or null when it has none. */
export function headOf(object: Object3D): Vector3 | null {
  let found: Object3D | null = null;
  object.updateWorldMatrix(true, true);
  object.traverse((node) => {
    if (found === null && HEAD_JOINT.test(node.name)) found = node;
  });
  return found === null ? null : (found as Object3D).getWorldPosition(new Vector3());
}

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
    // An imported model is the one somebody is setting up, so its picture is framed.
    const picture = this.draw(renderer, this.object(id), this.assets?.spec(id) !== undefined ? 'tile' : 'bounds');
    this.pictures.set(this.key(id), picture);
    return picture;
  }

  /** The picture, and whether it is of the stand-in rather than the model asked for. */
  picture(modelId: string, fallback?: string): Thumbnail | null {
    const url = this.url(modelId, fallback);
    return url === null ? null : { url, standIn: this.pick(modelId, fallback) !== modelId };
  }

  /**
   * A portrait: the model on its own, as a data URL.
   *
   * Not the same picture as the strip's. That one answers "what will this look like in the room",
   * so it stands the model on a tile and draws the adversary's red round anything imported. A
   * portrait of a party member wants neither -- a character pinned to their own sheet standing on a
   * floor tile in an enemy's colours is a picture of the wrong thing. Kept apart in the same cache
   * under its own key, because the two are different pictures of one model.
   */
  portraitUrl(modelId: string): string | null {
    if (!this.drawable(modelId)) return null;
    const key = `portrait:${this.key(modelId)}`;
    const kept = this.pictures.get(key);
    if (kept !== undefined) return kept;
    const renderer = this.context();
    if (renderer === null) return null;
    // Framed on its own face, so it fills the frame however big the file draws the body under it.
    const picture = this.draw(renderer, this.bare(modelId), 'face');
    this.pictures.set(key, picture);
    return picture;
  }

  /** The model alone: what `object` builds, without the tile beneath it or the rim round it. */
  private bare(id: string): Object3D {
    const spec = this.assets?.spec(id);
    const template = this.assets?.template(id);
    if (spec === undefined || template === undefined) return buildModel(this.registry.get(id), this.resources).group;
    const body = template.clone();
    body.scale.setScalar(spec.scale);
    body.rotation.y = spec.rotationY;
    seatOnTile(body);
    return body;
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
    // No rim round it. A picture in the Models panel is there to answer how big the file is
    // and which way it faces, and a red silhouette drawn round the edge is the one thing in
    // the frame that is not the model -- it hides the very outline being judged.
    // The tile itself, so what the model is standing off is in the picture with it.
    shown.add(buildModel(TILE_UNDER, this.resources).group);
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
      // `stencil` for the same reason the board asks for one: a preview is outlined the
      // same way, and three no longer allocates a stencil buffer unless asked.
      const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, stencil: true });
      renderer.setPixelRatio(1);
      renderer.setSize(SIZE, SIZE, false);
      renderer.setClearColor(0x000000, 0);
      this.renderer = renderer;
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  private draw(renderer: WebGLRenderer, object: Object3D, frame: 'bounds' | 'tile' | 'face' = 'bounds'): string {
    this.scene.add(object);
    const box = new Box3().setFromObject(object);
    const framed = frame === 'tile';
    // Framed: the same volume every time, centred on the tile rather than on what is
    // standing there, so moving the model moves it in the picture.
    // Framed: the tile and a model's worth of height over it, centred on the tile and
    // not on what is standing there — so a model nudged across it is drawn across it,
    // which is the whole reason the picture is worth looking at while setting one up.
    const sphere = framed
      ? new Sphere(new Vector3(0, Math.min(Math.max(box.max.y, 0.4), 1.2) / 2, 0), FRAMED)
      : frame === 'face' ? faceFraming(box, headOf(object)) : box.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 0.01);
    const distance = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.02;
    this.camera.position.copy(sphere.center).addScaledVector(frame === 'face' ? FACE_VIEW : VIEW, distance);
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

/** The one set of pictures for a registry, made on first use. Both pictures come off this. */
function sharedFor(registry: ModelRegistry, assets: AssetLibrary | null): ModelThumbnails {
  let thumbnails = byRegistry.get(registry);
  if (thumbnails === undefined) {
    thumbnails = new ModelThumbnails(registry, assets);
    byRegistry.set(registry, thumbnails);
  }
  return thumbnails;
}

/** The strip's picture of a model: on its tile, rimmed. What `main.ts` asks through. */
export function thumbnailOf(registry: ModelRegistry, assets: AssetLibrary | null, modelId: string, fallback?: string): Thumbnail | null {
  return sharedFor(registry, assets).picture(modelId, fallback);
}

/** A portrait of a model -- the model alone -- as a data URL, or null when nothing can be drawn. */
export function portraitOf(registry: ModelRegistry, assets: AssetLibrary | null, modelId: string): string | null {
  return sharedFor(registry, assets).portraitUrl(modelId);
}
