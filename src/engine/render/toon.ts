/**
 * The cartoon look: light in flat steps, and dark ink round what stands in the room.
 *
 * Light falls on a `MeshToonMaterial` in three bands - shade, mid, lit - rather than rolling off
 * smoothly, the way a painted card is lit. Outlines are inverted hulls: a copy of each part, drawn
 * back faces only in near-black and pushed out along its normals, so all that shows of it is the rim
 * past the part's own edge. The hull's normals are averaged where faces meet, or a box's rim would
 * split open at every corner.
 *
 * Hulls live on `OUTLINE_LAYER`, which a camera has to ask for. Play asks; the editor does not, so
 * it draws the room plain, Blender-style. A raycaster looks at layer 0 only, so no pick or ground hit
 * ever lands on a rim, and a shadow camera does not draw one either.
 */

import {
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  EdgesGeometry,
  FrontSide,
  GreaterDepth,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  Vector2,
  type Material,
  type MeshToonMaterialParameters,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The layer rims are drawn on. */
export const OUTLINE_LAYER = 1;

/** The ink: a warm near-black, like a brush line rather than a printer's. */
export const INK = '#1a120d';

/** Shade, mid, lit: how bright each band of the ramp is. */
const STEPS = new Uint8Array([96, 178, 255]);

let ramp: DataTexture | null = null;

/** The one toon ramp, shared by every material that steps its light. */
export function toonGradient(): DataTexture {
  if (ramp === null) {
    ramp = new DataTexture(STEPS, STEPS.length, 1, RedFormat);
    ramp.minFilter = NearestFilter;
    ramp.magFilter = NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

/**
 * A material that steps its light on the shared ramp, faceted as the legacy models were. There is
 * no metalness or roughness in it: a painted thing is lit by its bands, not by a glint.
 */
export function toonMaterial(parameters: MeshToonMaterialParameters): MeshToonMaterial {
  const material = new MeshToonMaterial({ ...parameters, gradientMap: toonGradient() });
  // Not one of the toon material's own options, but the renderer reads it off any material.
  Object.assign(material, { flatShading: true });
  return material;
}

const inks = new Map<string, MeshBasicMaterial>();

/**
 * The ink a hull is drawn in: back faces only, pushed `width` world units out along
 * its normals. White is the same thing in another colour, for the rim on whatever
 * the pointer is over.
 */
export function outlineMaterial(width: number, color = INK): MeshBasicMaterial {
  const key = `${width}|${color}`;
  let material = inks.get(key);
  if (material === undefined) {
    material = new MeshBasicMaterial({ color: new Color(color), side: BackSide });
    const push = width.toFixed(4);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\ttransformed += normalize( normal ) * ${push};`,
      );
    };
    material.customProgramCacheKey = () => `ink:${push}`;
    inks.set(key, material);
  }
  return material;
}

/**
 * Light an imported model the way the room is lit.
 *
 * Every mesh under `object` trades its own material for one that steps its light on the shared
 * ramp, keeping what makes the model look like itself: the colour, the texture, the normal map,
 * and whether it draws both faces. A glTF carries physically-based materials, so without this a
 * creature imported into the game is the only thing in the room lit smoothly.
 *
 * Materials are made once per material met, not once per mesh, so a model whose parts share one
 * material compiles one shader. The caller owns `object`: a clone shares its materials with the
 * template it came from, and replacing them here leaves the template's own alone for whoever
 * clones it next.
 *
 * No rim is added. A rim is an inverted hull, and closing one means merging vertices across the
 * whole geometry - nothing for a library part of a few dozen, seconds for an imported mesh of two
 * hundred thousand. The stepped light is what makes it read as drawn.
 */
export function toonify(object: Object3D): void {
  const made = new Map<Material, MeshToonMaterial>();
  const asToon = (from: Material): MeshToonMaterial => {
    const already = made.get(from);
    if (already !== undefined) return already;
    const source = from as Material & {
      color?: Color;
      map?: Texture | null;
      normalMap?: Texture | null;
      transparent?: boolean;
      opacity?: number;
      alphaTest?: number;
      vertexColors?: boolean;
    };
    // three warns on a key handed an explicit undefined, so each optional one is spread or absent.
    // Not `toonMaterial`: that facets what it makes, which is the look a library part of a few
    // dozen vertices is built for and the wrong one for a sculpted mesh of two hundred thousand.
    // Faceting throws away the normals the model was authored with and derives one per fragment
    // instead - measured at half the frame rate, which the walk, advancing by dt, walks into.
    const toon = new MeshToonMaterial({
      gradientMap: toonGradient(),
      ...(source.color === undefined ? {} : { color: source.color.clone() }),
      ...(source.map == null ? {} : { map: source.map }),
      ...(source.normalMap == null ? {} : { normalMap: source.normalMap }),
      transparent: source.transparent ?? false,
      opacity: source.opacity ?? 1,
      alphaTest: source.alphaTest ?? 0,
      vertexColors: source.vertexColors ?? false,
      side: from.side,
    });
    toon.name = from.name;
    made.set(from, toon);
    return toon;
  };

  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(asToon) : asToon(mesh.material);
  });
}

/**
 * A copy of a geometry with its corners closed: vertices that share a place merged, and their normals
 * averaged, so a hull pushed out along them stays whole. Positions only; the caller owns the result.
 */
export function smoothHull(geometry: BufferGeometry): BufferGeometry {
  const bare = new BufferGeometry();
  bare.setAttribute('position', geometry.getAttribute('position'));
  if (geometry.index !== null) bare.setIndex(geometry.index);
  const hull = mergeVertices(bare);
  hull.computeVertexNormals();
  return hull;
}

const glows = new Map<string, MeshBasicMaterial>();

/**
 * The white a hull is drawn in when the pointer is on what it rims.
 *
 * The same pushed-out back faces as the ink, drawn whatever stands in front of
 * them and written into no depth of their own, so a thing half behind a wall is
 * still seen whole. Late in the frame, after the room it shows through.
 */
export function xrayMaterial(width: number, color = '#ffffff', opacity = 1, front = false): MeshBasicMaterial {
  const key = `${width}|${color}|${opacity}|${front}`;
  let material = glows.get(key);
  if (material === undefined) {
    // `GreaterDepth` draws it only where something nearer is already in the depth
    // buffer — which is to say only where a wall covers it. Where the thing itself
    // is in view the rim fails the test, so what shows there is an edge and not a
    // wash over it.
    material = new MeshBasicMaterial({ color: new Color(color), side: front ? FrontSide : BackSide, depthFunc: GreaterDepth, depthWrite: false, transparent: true, opacity });
    const push = width.toFixed(4);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\ttransformed += normalize( normal ) * ${push};`,
      );
    };
    material.customProgramCacheKey = () => `xray:${push}`;
    glows.set(key, material);
  }
  return material;
}

const brushes = new Map<number, LineMaterial>();
const bufferSize = new Vector2();

/**
 * Ink along every hard edge of a geometry - a step's lip, a wall's corner, the room's rim - as lines
 * `px` screen pixels wide. A hull only draws a silhouette, so the front edge of a raised slab, which
 * faces the camera, never got one; the ground wants its creases as well. Pulled a little toward the
 * camera so a line does not flicker in and out of the faces it lies along. The caller owns the
 * geometry, and hangs the lines where it likes; they are on `OUTLINE_LAYER` like a rim.
 */
export function inkEdges(geometry: BufferGeometry, px: number): LineSegments2 {
  let brush = brushes.get(px);
  if (brush === undefined) {
    brush = new LineMaterial({ color: new Color(INK).getHex(), linewidth: px, worldUnits: false });
    Object.assign(brush, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    brushes.set(px, brush);
  }
  const edges = new EdgesGeometry(geometry, 25);
  const lines = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(edges), brush);
  edges.dispose();
  lines.name = 'outline';
  lines.layers.set(OUTLINE_LAYER);
  // A width in pixels needs the size of what it is drawn into, which only the renderer knows.
  lines.onBeforeRender = (renderer: WebGLRenderer) => {
    renderer.getDrawingBufferSize(bufferSize);
    brush.resolution.copy(bufferSize);
  };
  return lines;
}

/** Hang an ink rim of `width` on a mesh, as a child so it moves, turns and hides with it. */
export function addOutline(mesh: Mesh, hull: BufferGeometry, width: number): Mesh {
  const rim = new Mesh(hull, outlineMaterial(width));
  rim.name = 'outline';
  rim.layers.set(OUTLINE_LAYER);
  rim.castShadow = false;
  rim.receiveShadow = false;
  mesh.add(rim);
  return rim;
}
