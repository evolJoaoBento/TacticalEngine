/**
 * The rim round the thing under the pointer, and what it is drawn with.
 *
 * A rim is an inverted hull: a copy of a part, drawn back faces only and pushed out along its
 * normals, so all that shows of it is the edge past the part's own silhouette. The hull's normals
 * are averaged where faces meet (`smoothHull`), or a box's rim would split open at every corner.
 *
 * Rims live on `OUTLINE_LAYER`, which a camera has to ask for. Play asks; the editor does not. A
 * raycaster looks at layer 0 only, so no pick or ground hit ever lands on a rim, and a shadow
 * camera does not draw one either.
 *
 * This module used to hold the cartoon look as well - light stepped on a shared ramp, ink round
 * every part of the room, creases along the ground. That came off when it turned out imported
 * models could not carry it: half a room in ink and half out reads worse than neither. What is
 * left is the hover rim, which is a thing you need to see rather than a style.
 */

import { BackSide, BufferGeometry, Color, FrontSide, GreaterDepth, Mesh, MeshBasicMaterial } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The layer rims are drawn on. */
export const OUTLINE_LAYER = 1;

/** The ink: a warm near-black, like a brush line rather than a printer's. */
export const INK = '#1a120d';

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

