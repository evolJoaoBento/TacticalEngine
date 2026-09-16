import { describe, it, expect } from 'vitest';
import { BackSide, BoxGeometry, Vector3 } from 'three';
import { outlineMaterial, smoothHull } from './toon';

/**
 * What the hover rim is made of.
 *
 * The cartoon look this module used to hold came off; these are the two pieces the
 * white rim in `spotlight.ts` still stands on - a hull closed at its corners, and the
 * pushed-out back faces it is drawn with.
 */
describe('the makings of a rim', () => {
  it('closes a hull at the corners, its normals pointing out', () => {
    const hull = smoothHull(new BoxGeometry(1, 1, 1));
    const positions = hull.getAttribute('position');
    const normals = hull.getAttribute('normal');
    expect(positions.count).toBe(8);
    for (let i = 0; i < positions.count; i++) {
      const out = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize();
      expect(new Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)).dot(out)).toBeGreaterThan(0.8);
    }
  });

  it('pushes the hull out along its normals and draws only its back faces, in ink', () => {
    const material = outlineMaterial(0.02);
    expect(material.side).toBe(BackSide);
    expect(outlineMaterial(0.02)).toBe(material);
    expect(outlineMaterial(0.03)).not.toBe(material);
    const shader = { vertexShader: 'void main() {\n#include <begin_vertex>\n}', fragmentShader: '', uniforms: {} };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('transformed += normalize( normal ) * 0.0200;');
  });

});
