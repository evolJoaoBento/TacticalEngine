/**
 * An imported material's shader (`tile-surface.ts`), with no WebGL: the chunks it replaces held to three's own shaders
 * - a three release that renamed one would leave the material quietly flat, so that is a failure here - and what the
 * patch writes, for the near material and the flat one.
 */

import { describe, expect, it } from 'vitest';
import { ShaderLib, Texture } from 'three';
import { REPLACED, makeSurfaceMaterial, patchShader, tuneSurface, type ShaderLike, type SurfaceUniforms } from './tile-surface';

const textures = () => ({ color: new Texture(), normalHeight: new Texture(), orm: new Texture() });
const tuning = { size: 1, depth: 0.06, normalScale: 1, roughness: 1 };

/** Three's standard shader, as `onBeforeCompile` is handed it. */
const standard = (): ShaderLike => ({ uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader });

describe('an imported material, drawn', () => {
  it("replaces only chunks three's standard shaders have, each once", () => {
    for (const chunk of REPLACED.vertex) expect(ShaderLib.standard.vertexShader.split(chunk).length - 1, chunk).toBe(1);
    for (const chunk of REPLACED.fragment) expect(ShaderLib.standard.fragmentShader.split(chunk).length - 1, chunk).toBe(1);
  });

  it('writes the world position and the face, the projected maps, the normal, roughness, metalness and occlusion', () => {
    const material = makeSurfaceMaterial(textures(), tuning, { parallax: true });
    const shader = standard();
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vTmWorld = tmWorld.xyz;');
    expect(shader.fragmentShader).toContain('#define TM_PARALLAX');
    expect(shader.fragmentShader).toContain('uniform sampler2D tNormalHeight;');
    for (const replaced of ['#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>', '#include <normal_fragment_maps>', '#include <aomap_fragment>']) {
      expect(shader.fragmentShader).not.toContain(replaced);
    }
    expect(shader.fragmentShader).toContain('textureGrad( tColor, tmUv, tmDx, tmDy )');
    // The derivatives taken before the loop, never inside it.
    expect(shader.fragmentShader.indexOf('vec2 tmDx = dFdx( tmUv );')).toBeLessThan(shader.fragmentShader.indexOf('for ( int i = 0; i < 32; i++ )'));
    expect(shader.uniforms['uDepth']).toBe(material.userData.surfaceUniforms.uDepth);
    expect(shader.uniforms['tColor']!.value).toBe(material.userData.surfaceUniforms.tColor.value);
  });

  it('keeps the flat material apart from the near one: no parallax, its own program', () => {
    const near = makeSurfaceMaterial(textures(), tuning, { parallax: true });
    const flat = makeSurfaceMaterial(textures(), tuning, { parallax: false });
    const shader = standard();
    flat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).not.toContain('#define TM_PARALLAX');
    expect(near.customProgramCacheKey()).not.toBe(flat.customProgramCacheKey());
  });

  it('is tuned in place: the uniforms the program was bound to change, nothing compiled again', () => {
    const material = makeSurfaceMaterial(textures(), tuning, { parallax: true });
    const uniforms: SurfaceUniforms = material.userData.surfaceUniforms;
    const shader = standard();
    patchShader(shader, uniforms, true);
    tuneSurface(uniforms, { size: 2, depth: 0.1, normalScale: 0.5, roughness: 1.5 });
    expect([shader.uniforms['uSize']!.value, shader.uniforms['uDepth']!.value, shader.uniforms['uNormalScale']!.value, shader.uniforms['uRoughness']!.value]).toEqual([2, 0.1, 0.5, 1.5]);
  });
});
