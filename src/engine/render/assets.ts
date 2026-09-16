/**
 * Imported models: glTF files a project brings with it.
 *
 * The procedural library was built spec-first partly so an imported asset
 * could slot in beside it behind one resolver. This is that resolver's other
 * half. A project declares assets — an id, a URL, how to scale and seat the
 * thing on a tile — and content refers to them by id exactly as it refers to a
 * procedural model. `SceneView` asks here first and falls back to the library.
 *
 * Loading is asynchronous and lives outside this module: the caller injects a
 * `load(url)` that returns a template `Object3D`, which in the browser is
 * three's `GLTFLoader` and in a test is whatever the test wants. Until a
 * template arrives the view draws the procedural placeholder, and when it does
 * the view is told which id changed so it can rebuild only that.
 */

import { z } from 'zod';
import { Box3, type Object3D } from 'three';

import { contentIdSchema } from '../scene/primitives';

export const modelAssetSchema = z.object({
  id: contentIdSchema,
  kind: z.literal('gltf').default('gltf'),
  /** Where the file is. Relative URLs resolve against the page. */
  url: z.string().min(1),
  /** Uniform scale applied to the loaded scene. Most sample models are metres; a tile is one unit. */
  scale: z.number().positive().default(1),
  /** Lift or sink the model so its feet sit on the tile surface. */
  groundOffset: z.number().default(0),
  /** Turn the model so it faces the way the procedural library does. Radians. */
  rotationY: z.number().default(0),
  /**
   * Which of the file's clips plays for each state, by the clip's own name.
   * Left out, the first clip in the file loops as the idle and nothing else
   * changes what plays - which is what every sample set does. A state with
   * no clip named keeps whatever is playing: a walk with no walk clip idles
   * along, a fall with no fall clip lies down on its rotation alone.
   */
  clips: z
    .object({
      idle: z.string().min(1).optional(),
      walk: z.string().min(1).optional(),
      hit: z.string().min(1).optional(),
      fallen: z.string().min(1).optional(),
    })
    .optional(),
});

export type ModelAsset = z.infer<typeof modelAssetSchema>;

/**
 * Seat a loaded model the way the procedural library seats its own: centred over
 * the tile, its feet at y = 0.
 *
 * A glTF is exported around whatever origin the artist worked to — the middle of
 * a crate, a character's hips, the corner of the room it was modelled in — so a
 * file dropped in as it comes hangs off its tile, and scaling it about that
 * origin slides it further off instead of growing it where it stands. Measuring
 * what actually arrived and moving it onto the tile is what makes the two
 * settings mean one thing each: `scale` sizes the model, `groundOffset` sinks or
 * floats it deliberately.
 *
 * Call it once the rotation and the scale are on, because it measures what it is
 * given. A model with nothing in it to measure is left where it is.
 */
export function seatOnTile(model: Object3D): void {
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) return;
  model.position.set(
    model.position.x - (box.min.x + box.max.x) / 2,
    model.position.y - box.min.y,
    model.position.z - (box.min.z + box.max.z) / 2,
  );
}

export type AssetLoader = (url: string) => Promise<Object3D>;

export type AssetStatus = 'unknown' | 'loading' | 'ready' | 'failed';

/**
 * The project's assets and what has been loaded of them.
 *
 * Templates are never handed out directly — `template(id)` returns the loaded
 * scene for the view to clone. Cloning is the view's business because a
 * skinned model needs `SkeletonUtils.clone`, which is a three concern.
 */
export class AssetLibrary {
  private readonly specs = new Map<string, ModelAsset>();
  private readonly templates = new Map<string, Object3D>();
  private readonly status = new Map<string, AssetStatus>();
  private readonly errors = new Map<string, string>();
  private readonly listeners = new Set<(id: string) => void>();
  private readonly load: AssetLoader;

  constructor(load: AssetLoader, assets: readonly ModelAsset[] = []) {
    this.load = load;
    for (const asset of assets) this.add(asset);
  }

  /** Declare an asset. Redeclaring replaces the spec and forgets what was loaded. */
  add(asset: ModelAsset): void {
    this.specs.set(asset.id, asset);
    this.templates.delete(asset.id);
    this.status.set(asset.id, 'unknown');
    this.errors.delete(asset.id);
  }

  /**
   * Replace a declaration's settings without throwing away the file.
   *
   * `add` forgets what was loaded, which is right when the file changes and
   * wrong when only the scale, the seating or the clip names do: a panel editing
   * those would blank its own clip lists and fetch the file again on every
   * change. When the url really has changed this falls back to `add`.
   *
   * An id the library was never given is ignored rather than invented: tuning
   * something that is not declared is a mistake, not a declaration.
   */
  retune(asset: ModelAsset): void {
    const current = this.specs.get(asset.id);
    if (current === undefined) return;
    if (current.url !== asset.url) {
      this.add(asset);
      this.notify(asset.id);
      return;
    }
    this.specs.set(asset.id, asset);
    this.notify(asset.id);
  }

  remove(id: string): void {
    this.specs.delete(id);
    this.templates.delete(id);
    this.status.delete(id);
    this.errors.delete(id);
  }

  has(id: string): boolean {
    return this.specs.has(id);
  }

  spec(id: string): ModelAsset | undefined {
    return this.specs.get(id);
  }

  ids(): string[] {
    return [...this.specs.keys()];
  }

  statusOf(id: string): AssetStatus {
    return this.status.get(id) ?? 'unknown';
  }

  errorOf(id: string): string | undefined {
    return this.errors.get(id);
  }

  /** The loaded scene for an id, or undefined while it is not here yet. */
  template(id: string): Object3D | undefined {
    return this.templates.get(id);
  }

  /** Called with an id whenever its template arrives or its load fails. */
  onChange(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * Start loading an asset if it is declared and not already on its way.
   * Returns whether a load was started. The view calls this the first time it
   * is asked to draw an id, so nothing loads that nothing shows.
   */
  request(id: string): boolean {
    const spec = this.specs.get(id);
    if (spec === undefined) return false;
    const current = this.status.get(id);
    if (current === 'loading' || current === 'ready') return false;
    this.status.set(id, 'loading');
    void this.load(spec.url).then(
      (template) => {
        // The spec may have been replaced or removed while the file was in flight.
        if (this.specs.get(id) !== spec) return;
        this.templates.set(id, template);
        this.status.set(id, 'ready');
        this.notify(id);
      },
      (error: unknown) => {
        if (this.specs.get(id) !== spec) return;
        this.status.set(id, 'failed');
        this.errors.set(id, error instanceof Error ? error.message : String(error));
        this.notify(id);
      },
    );
    return true;
  }

  /** Start every declared asset loading. */
  requestAll(): void {
    for (const id of this.specs.keys()) this.request(id);
  }

  private notify(id: string): void {
    for (const listener of this.listeners) listener(id);
  }
}
