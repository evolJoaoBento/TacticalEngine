/**
 * The project's imported materials and what has been loaded of them (`tile-surface.ts`; the `AssetLibrary` of
 * textures, `assets.ts`).
 *
 * Each surface's three maps are loaded once, whatever the number of pieces drawn in it, and handed out as shared
 * three.js materials: the **near** one, with parallax (when the surface has a height map and a depth), the **flat**
 * one, the same maps without the loop, for what is far off, and the **ground**'s, the near one reading the ground
 * mesh's vertex colours for its tint (`groundMaterialFor`). And each again for every repeat a kind of tile sets in
 * place of the surface's own (`TerrainType.surfaceSize`), the textures shared: a material is made the first time a
 * piece or a kind of ground asks for it. Until a surface's maps are in, `materialFor`
 * gives nothing and the piece is drawn as an untextured box in its kind's colour: a kind of tile is never invisible
 * because a load is slow.
 *
 * A tuning edit - size, depth, normal strength, roughness, tint - changes the materials' uniforms in place; new maps (an
 * import again) load afresh. The loader is given, so the tests hand in their own.
 *
 * A material linked rather than carried (`polyHaven`, no `maps`) has its maps resolved first, by whatever the page
 * hands in (`SurfaceResolve`: downloaded, packed and compressed, and kept in the browser), and its average colour with
 * them, which its Tint is measured against. With nothing to resolve it, or a resolve that fails, it is drawn in its
 * kind's colour, as any material is until its maps are in.
 */

import { NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { makeSurfaceMaterial, tuneSurface, type SurfaceMaterial, type SurfaceTextures } from './tile-surface';
import type { SurfaceMaps, TileSurface } from '../scene/schema';

/** Loads one texture from its URL. */
export type TextureLoad = (url: string) => Promise<Texture>;

/** A linked material's maps, and their average colour: where they are fetched from is the page's to say. */
export type SurfaceResolve = (surface: TileSurface) => Promise<{ maps: SurfaceMaps; color: string }>;

export type SurfaceStatus = 'unknown' | 'loading' | 'ready' | 'failed';

/** What a material is for: a near piece, a far one, or the ground. */
type Role = 'near' | 'flat' | 'ground';

interface Loaded {
  textures: SurfaceTextures;
  /** Each material made, by its role and the repeat a kind set (`near@2`), or the surface's own (`near@`). */
  materials: Map<string, { material: SurfaceMaterial; size: number | undefined }>;
}

/** A surface's tuning with a kind's repeat in place of its own. */
const sized = (spec: TileSurface, size: number | undefined): TileSurface => (size === undefined ? spec : { ...spec, size });

/** Whether two specs of a surface tune it differently. */
const retuned = (a: TileSurface, b: TileSurface): boolean =>
  a.parallax !== b.parallax || a.depth !== b.depth || a.size !== b.size || a.normalScale !== b.normalScale || a.roughness !== b.roughness || a.tint !== b.tint || a.color !== b.color;

/** Whether a texture is a compressed one (`CompressedTexture`), the GPU's own format. */
const isCompressed = (texture: Texture): boolean => (texture as Texture & { isCompressedTexture?: boolean }).isCompressedTexture === true;

/** Whether two surfaces' maps are the same maps: the same carried, or fetched from the same texture at the same size. */
const sameMaps = (a: TileSurface, b: TileSurface): boolean =>
  a.maps !== undefined && b.maps !== undefined
    ? a.maps.color === b.maps.color && a.maps.normalHeight === b.maps.normalHeight && a.maps.orm === b.maps.orm
    : a.maps === undefined && b.maps === undefined && a.polyHaven?.id === b.polyHaven?.id && a.polyHaven?.pixels === b.polyHaven?.pixels;

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
  /** A linked material's average colour, resolved with its maps: what its Tint is measured against. */
  private readonly means = new Map<string, string>();

  constructor(
    private readonly load: TextureLoad,
    private readonly anisotropy: number = 1,
    private readonly resolve?: SurfaceResolve,
  ) {}

  /** A surface's tuning, its average colour the resolved one when it carries none: a linked material has none of its own. */
  private tuned(spec: TileSurface, size: number | undefined): TileSurface {
    const mean = spec.color === undefined ? this.means.get(spec.id) : undefined;
    return sized(mean === undefined ? spec : { ...spec, color: mean }, size);
  }

  /** Declare a surface, or redeclare it: tuned in place when its maps are the same, loaded afresh when they are not. */
  add(surface: TileSurface): void {
    const current = this.specs.get(surface.id);
    this.specs.set(surface.id, surface);
    if (current !== undefined && sameMaps(current, surface)) {
      const loaded = this.loaded.get(surface.id);
      if (loaded !== undefined && retuned(current, surface)) {
        for (const { material, size } of loaded.materials.values()) tuneSurface(material.userData.surfaceUniforms, this.tuned(surface, size));
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
   * one for what is far - at a kind's repeat, or the surface's own; or nothing while its maps are not in, which starts
   * them loading.
   */
  materialFor(id: string, far = false, size?: number): SurfaceMaterial | null {
    return this.made(id, far ? 'flat' : 'near', size);
  }

  /**
   * The material the ground is drawn in, in this surface - the near one, its tint read off the ground mesh's vertex
   * colours, which a piece's box has none of - at a kind's repeat or the surface's own; or nothing while its maps are
   * not in, which starts them loading.
   */
  groundMaterialFor(id: string, size?: number): SurfaceMaterial | null {
    return this.made(id, 'ground', size);
  }

  /** How many materials a surface has made: one for each role and repeat asked for. */
  materialCount(id: string): number {
    return this.loaded.get(id)?.materials.size ?? 0;
  }

  private made(id: string, role: Role, size: number | undefined): SurfaceMaterial | null {
    const loaded = this.loaded.get(id);
    if (loaded === undefined) {
      this.request(id);
      return null;
    }
    const key = `${role}@${size ?? ''}`;
    const kept = loaded.materials.get(key);
    if (kept !== undefined) return kept.material;
    const spec = this.specs.get(id)!;
    const material = makeSurfaceMaterial(loaded.textures, this.tuned(spec, size), { parallax: role !== 'flat' && spec.parallax, vertexColors: role === 'ground' });
    loaded.materials.set(key, { material, size });
    return material;
  }

  /** Start loading a surface's maps, if it is declared and not on its way already. Whether a load started. */
  request(id: string): boolean {
    const spec = this.specs.get(id);
    if (spec === undefined) return false;
    const current = this.status.get(id);
    if (current === 'loading' || current === 'ready' || current === 'failed') return false;
    this.status.set(id, 'loading');
    // Carried, its maps load now; linked, they are resolved first - and the average colour with them.
    const loadAll = (maps: SurfaceMaps): Promise<Texture[]> => Promise.all([this.load(maps.color), this.load(maps.normalHeight), this.load(maps.orm)]);
    const textures: Promise<Texture[]> =
      spec.maps !== undefined
        ? loadAll(spec.maps)
        : this.resolve !== undefined
          ? this.resolve(spec).then((got) => {
              this.means.set(id, got.color);
              return loadAll(got.maps);
            })
          : Promise.reject(new Error(`"${id}" has no maps, and nothing here can fetch them`));
    void textures.then(
      ([color, normalHeight, orm]: Texture[]) => {
        // Replaced or removed while the maps were on their way: theirs to let go.
        if (this.specs.get(id) !== spec && !(this.specs.has(id) && sameMaps(this.specs.get(id)!, spec))) {
          for (const texture of [color, normalHeight, orm]) texture.dispose();
          return;
        }
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
        this.loaded.set(id, { textures: { color, normalHeight, orm }, materials: new Map() });
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
      for (const { material } of loaded.materials.values()) material.dispose();
      this.loaded.delete(id);
      this.generations.set(id, this.generationOf(id) + 1);
      this.bump(id);
    }
    this.errors.delete(id);
    this.means.delete(id);
  }

  private bump(id: string): void {
    this.revisions.set(id, this.revisionOf(id) + 1);
    this.notify(id);
  }

  private notify(id: string): void {
    for (const listener of this.listeners) listener(id);
  }
}
