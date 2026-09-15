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
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  Vector2,
  type MeshToonMaterialParameters,
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

const inks = new Map<number, MeshBasicMaterial>();

/** The ink a hull is drawn in: back faces only, pushed `width` world units out along its normals. */
export function outlineMaterial(width: number): MeshBasicMaterial {
  let material = inks.get(width);
  if (material === undefined) {
    material = new MeshBasicMaterial({ color: new Color(INK), side: BackSide });
    const push = width.toFixed(4);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\ttransformed += normalize( normal ) * ${push};`,
      );
    };
    material.customProgramCacheKey = () => `ink:${push}`;
    inks.set(width, material);
  }
  return material;
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
