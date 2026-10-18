/**
 * The project's imported materials and what has been loaded of them (`tile-surface.ts`; the `AssetLibrary` of
 * textures, `assets.ts`).
 *
 * Each surface's three maps are loaded once, whatever the number of pieces drawn in it, and handed out as two shared
 * three.js materials: the **near** one, with parallax (when the surface has a height map and a depth), and the
 * **flat** one, the same maps without the loop, for what is far off. Until a surface's maps are in, `materialFor`
 * gives nothing and the piece is drawn as an untextured box in its kind's colour: a kind of tile is never invisible
 * because a load is slow.
 *
 * A tuning edit - size, depth, normal strength, roughness - changes the materials' uniforms in place; new maps (an
 * import again) load afresh. The loader is given, so the tests hand in their own.
 */

import { NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { makeSurfaceMaterial, tuneSurface, type SurfaceMaterial, type SurfaceTextures } from './tile-surface';
import type { TileSurface } from '../scene/schema';

/** Loads one texture from its URL. */
export type TextureLoad = (url: string) => Promise<Texture>;

export type SurfaceStatus = 'unknown' | 'loading' | 'ready' | 'failed';

interface Loaded {
  textures: SurfaceTextures;
  near: SurfaceMaterial;
  flat: SurfaceMaterial;
}

/** Whether a texture is a compressed one (`CompressedTexture`), the GPU's own format. */
const isCompressed = (texture: Texture): boolean => (texture as Texture & { isCompressedTexture?: boolean }).isCompressedTexture === true;

/** Whether two surfaces' maps are the same maps. */
const sameMaps = (a: TileSurface, b: TileSurface): boolean => a.maps.color === b.maps.color && a.maps.normalHeight === b.maps.normalHeight && a.maps.orm === b.maps.orm;

export class SurfaceLibrary {
  private readonly specs = new Map<string, TileSurface>();
  private readonly loaded = new Map<string, Loaded>();
  private readonly status = new Map<string, SurfaceStatus>();
  private readonly errors = new Map<string, string>();
  /** Bumped whenever what a surface draws with changes: its maps landing, or a tuning edit. */
  private readonly revisions = new Map<string, number>();
  /** Bumped only when a surface's materials are new objects - its maps landing, or let go - which a mesh must follow. */
  private readonly generations = new Map<string, number>();
  private readonly listeners = new Set<(id: string) => void>();

  constructor(
    private readonly load: TextureLoad,
    private readonly anisotropy: number = 1,
  ) {}

  /** Declare a surface, or redeclare it: tuned in place when its maps are the same, loaded afresh when they are not. */
  add(surface: TileSurface): void {
    const current = this.specs.get(surface.id);
    this.specs.set(surface.id, surface);
    if (current !== undefined && sameMaps(current, surface)) {
      const loaded = this.loaded.get(surface.id);
      if (loaded !== undefined && (current.parallax !== surface.parallax || current.depth !== surface.depth || current.size !== surface.size || current.normalScale !== surface.normalScale || current.roughness !== surface.roughness)) {
        tuneSurface(loaded.near.userData.surfaceUniforms, surface);
        tuneSurface(loaded.flat.userData.surfaceUniforms, surface);
        this.bump(surface.id);
      }
      return;
    }
    this.forget(surface.id);
    this.status.set(surface.id, 'unknown');
  }

  /** Every surface the project has now, and no others: the rest forgotten, their textures let go. */
  setAll(surfaces: readonly TileSurface[]): void {
    const keep = new Set(surfaces.map((surface) => surface.id));
    for (const id of [...this.specs.keys()]) if (!keep.has(id)) this.remove(id);
    for (const surface of surfaces) this.add(surface);
  }

  remove(id: string): void {
    this.specs.delete(id);
    this.forget(id);
    this.status.delete(id);
  }

  has(id: string): boolean {
    return this.specs.has(id);
  }

  statusOf(id: string): SurfaceStatus {
    return this.status.get(id) ?? 'unknown';
  }

  errorOf(id: string): string | undefined {
    return this.errors.get(id);
  }

  /** How many times what a surface draws with has changed, tuning too: a picture of it keeps it to know it is stale. */
  revisionOf(id: string): number {
    return this.revisions.get(id) ?? 0;
  }

  /**
   * How many times a surface's materials have been new objects: a mesh drawn with them keeps it, to know it must be
   * built again. A tuning edit changes the uniforms of the same materials, which every mesh already draws with.
   */
  generationOf(id: string): number {
    return this.generations.get(id) ?? 0;
  }

  /** Called with an id whenever its maps land, its load fails, or it is tuned. */
  onChange(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * The shared material a piece in this surface is drawn with - the near one (parallax) for what is close, the flat
   * one for what is far - or nothing while its maps are not in, which starts them loading.
   */
  materialFor(id: string, far = false): SurfaceMaterial | null {
    const loaded = this.loaded.get(id);
    if (loaded === undefined) {
      this.request(id);
      return null;
    }
    return far ? loaded.flat : loaded.near;
  }

  /** Start loading a surface's maps, if it is declared and not on its way already. Whether a load started. */
  request(id: string): boolean {
    const spec = this.specs.get(id);
    if (spec === undefined) return false;
    const current = this.status.get(id);
    if (current === 'loading' || current === 'ready' || current === 'failed') return false;
    this.status.set(id, 'loading');
    void Promise.all([this.load(spec.maps.color), this.load(spec.maps.normalHeight), this.load(spec.maps.orm)]).then(
      ([color, normalHeight, orm]) => {
        // Replaced or removed while the maps were on their way: theirs to let go.
        if (this.specs.get(id) !== spec && !(this.specs.has(id) && sameMaps(this.specs.get(id)!, spec))) {
          for (const texture of [color, normalHeight, orm]) texture.dispose();
          return;
        }
        const now = this.specs.get(id)!;
        color.colorSpace = SRGBColorSpace;
        normalHeight.colorSpace = NoColorSpace;
        orm.colorSpace = NoColorSpace;
        for (const texture of [color, normalHeight, orm]) {
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
          texture.anisotropy = this.anisotropy;
          // A compressed map brings its mipmaps with it: WebGL cannot make them for a compressed format, and asking is
          // an error. Any other has them made.
          if (!isCompressed(texture)) texture.generateMipmaps = true;
          texture.needsUpdate = true;
        }
        const textures = { color, normalHeight, orm };
        this.loaded.set(id, {
          textures,
          near: makeSurfaceMaterial(textures, now, { parallax: now.parallax }),
          flat: makeSurfaceMaterial(textures, now, { parallax: false }),
        });
        this.status.set(id, 'ready');
        this.generations.set(id, this.generationOf(id) + 1);
        this.bump(id);
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

  /** Every texture and material let go: the library is finished with. */
  dispose(): void {
    for (const id of [...this.loaded.keys()]) this.forget(id);
    this.specs.clear();
    this.status.clear();
    this.listeners.clear();
  }

  private forget(id: string): void {
    const loaded = this.loaded.get(id);
    if (loaded !== undefined) {
      for (const texture of Object.values(loaded.textures)) texture.dispose();
      loaded.near.dispose();
      loaded.flat.dispose();
      this.loaded.delete(id);
      this.generations.set(id, this.generationOf(id) + 1);
      this.bump(id);
    }
    this.errors.delete(id);
  }

  private bump(id: string): void {
    this.revisions.set(id, this.revisionOf(id) + 1);
    this.notify(id);
  }

  private notify(id: string): void {
    for (const listener of this.listeners) listener(id);
  }
}
