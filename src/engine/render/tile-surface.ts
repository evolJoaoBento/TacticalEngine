/**
 * An imported material, drawn on the plain boxes a structure is built from (`docs/DEVELOPING.md`, "Importing a tile
 * material"; `surface-library.ts`, `building-view.ts`).
 *
 * The boxes stay boxes: every bit of the detail is the material's, and it has to read as 3D on a flat face. So the
 * material is three's `MeshStandardMaterial` with its map chunks replaced (`onBeforeCompile`):
 *
 * - **UVs projected from world position**, per face - the face picked by the dominant axis of its normal - so two
 *   blocks side by side run on as one surface, a wall half as tall shows half the texture rather than a squashed whole
 *   one, and a quarter-turned piece needs nothing. The tangent frame comes with the face for nothing.
 * - **Parallax occlusion** (`TM_PARALLAX`): the UV marched along the view ray through the height map before anything is
 *   sampled, so mortar sinks behind the bricks; faded out with distance (`uFade`), where it would only cost.
 * - Colour, normal (rebuilt from its X and Y; height rides in the blue channel), roughness, AO and metalness sampled
 *   once at the final UV - with `textureGrad`, its derivatives taken before the loop, since a derivative inside
 *   control flow that differs between pixels is undefined and sparkles at every seam.
 * - **A tint** (`uTint`, 0 to 1): the colour a piece or a cell is drawn in - an instance's colour, or the ground's
 *   vertex colours, three's `vColor` - divided by the material's own average (`uMean`), so at 1 the material's average
 *   becomes that colour and its detail stays; at 0 it is the material's own colour, whatever the colour says.
 *
 * Three's own `map`, `normalMap`, `roughnessMap` and `aoMap` are never set: their UV plumbing would fight the
 * projected UVs. The chunks replaced are named in `REPLACED`, and a test holds every one to three's shaders - a three
 * release that renames one would otherwise leave the material quietly flat.
 */

import { Color, MeshStandardMaterial, type Texture, Vector2 } from 'three';

/**
 * How the material's maps are tuned: tiles per repeat, depth in tiles, the normal's strength, roughness's scale, how
 * far it takes the colour it is drawn in; and the average of its colour map (sRGB hex), which the tint is measured
 * against - none, for a material imported before it was kept, and the tint is a plain multiply.
 */
export interface SurfaceTuning {
  size: number;
  depth: number;
  normalScale: number;
  roughness: number;
  tint: number;
  color?: string | undefined;
}

/** The three packed maps: colour (sRGB); normal X, Y and height (linear); AO, roughness, metalness (linear). */
export interface SurfaceTextures {
  color: Texture;
  normalHeight: Texture;
  orm: Texture;
}

/** Where the parallax starts to fade, and where it is gone, in world units from the eye. */
export const PARALLAX_FADE: readonly [number, number] = [30, 55];

/** The chunks this replaces or anchors on, in three's standard shaders: held to them by a test. */
export const REPLACED = {
  vertex: ['#include <common>', '#include <project_vertex>'],
  fragment: ['#include <common>', '#include <map_fragment>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>', '#include <normal_fragment_maps>', '#include <aomap_fragment>'],
} as const;

const VARYINGS = /* glsl */ `
varying vec3 vTmWorld;
varying vec3 vTmNormal;
`;

const VERTEX_WORLD = /* glsl */ `
vec4 tmWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  tmWorld = instanceMatrix * tmWorld;
#endif
tmWorld = modelMatrix * tmWorld;
vTmWorld = tmWorld.xyz;
vec3 tmN = objectNormal;
#ifdef USE_INSTANCING
  tmN = mat3( instanceMatrix ) * tmN;
#endif
// Only its dominant axis is read, so the scale in it does not matter.
vTmNormal = mat3( modelMatrix ) * tmN;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tNormalHeight;
uniform sampler2D tOrm;
uniform float uSize;
uniform float uDepth;
uniform float uNormalScale;
uniform float uRoughness;
uniform float uTint;
uniform vec3 uMean;
uniform vec2 uFade;
`;

/** The face, its UV, the parallax, and the three samples - before `map_fragment`, so every later chunk sees them. */
const FRAGMENT_PREAMBLE = /* glsl */ `
vec3 tmA = abs( vTmNormal );
vec3 tmT;
vec3 tmB;
vec3 tmN;
if ( tmA.x >= tmA.y && tmA.x >= tmA.z ) {
  float s = sign( vTmNormal.x );
  tmN = vec3( s, 0.0, 0.0 );
  tmT = vec3( 0.0, 0.0, -s );
  tmB = vec3( 0.0, 1.0, 0.0 );
} else if ( tmA.z >= tmA.y ) {
  float s = sign( vTmNormal.z );
  tmN = vec3( 0.0, 0.0, s );
  tmT = vec3( s, 0.0, 0.0 );
  tmB = vec3( 0.0, 1.0, 0.0 );
} else {
  float s = sign( vTmNormal.y );
  tmN = vec3( 0.0, s, 0.0 );
  tmT = vec3( 1.0, 0.0, 0.0 );
  tmB = vec3( 0.0, 0.0, -s );
}
vec2 tmUv = vec2( dot( vTmWorld, tmT ), dot( vTmWorld, tmB ) ) / uSize;
vec2 tmDx = dFdx( tmUv );
vec2 tmDy = dFdy( tmUv );
#ifdef TM_PARALLAX
{
  vec3 tmV = normalize( cameraPosition - vTmWorld );
  vec3 tmVt = vec3( dot( tmV, tmT ), dot( tmV, tmB ), dot( tmV, tmN ) );
  float tmFade = 1.0 - smoothstep( uFade.x, uFade.y, length( cameraPosition - vTmWorld ) );
  float tmDepth = uDepth / uSize * tmFade;
  if ( tmDepth > 0.0 && tmVt.z > 0.0 ) {
    float tmLayers = mix( 24.0, 8.0, clamp( tmVt.z, 0.0, 1.0 ) );
    float tmStep = 1.0 / tmLayers;
    vec2 tmDelta = tmVt.xy / max( tmVt.z, 0.2 ) * tmDepth / tmLayers;
    vec2 tmCur = tmUv;
    float tmD = 0.0;
    float tmH = 1.0 - textureGrad( tNormalHeight, tmCur, tmDx, tmDy ).b;
    for ( int i = 0; i < 32; i++ ) {
      if ( float( i ) >= tmLayers || tmD >= tmH ) break;
      tmCur -= tmDelta;
      tmD += tmStep;
      tmH = 1.0 - textureGrad( tNormalHeight, tmCur, tmDx, tmDy ).b;
    }
    vec2 tmPrev = tmCur + tmDelta;
    float tmAfter = tmH - tmD;
    float tmBefore = ( 1.0 - textureGrad( tNormalHeight, tmPrev, tmDx, tmDy ).b ) - ( tmD - tmStep );
    float tmW = tmAfter / ( tmAfter - tmBefore );
    tmUv = mix( tmCur, tmPrev, clamp( tmW, 0.0, 1.0 ) );
  }
}
#endif
vec4 tmNh = textureGrad( tNormalHeight, tmUv, tmDx, tmDy );
vec4 tmOrm = textureGrad( tOrm, tmUv, tmDx, tmDy );
diffuseColor.rgb *= textureGrad( tColor, tmUv, tmDx, tmDy ).rgb;
`;

/**
 * Three's `color_fragment`, the colour drawn in measured against the material's average and taken as far as the tint
 * says: white with no tint, so a plain piece's colour never darkens a material. Capped, so a pale colour over a dark
 * material brightens it rather than blowing it out.
 */
const COLOR = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= mix( vec3( 1.0 ), min( vColor.rgb / max( uMean, vec3( 0.02 ) ), vec3( 4.0 ) ), uTint );
#endif
`;

const ROUGHNESS = /* glsl */ `
float roughnessFactor = clamp( roughness * tmOrm.g * uRoughness, 0.04, 1.0 );
`;

const METALNESS = /* glsl */ `
float metalnessFactor = metalness * tmOrm.b;
`;

const NORMAL = /* glsl */ `
{
  vec2 tmXy = ( tmNh.rg * 2.0 - 1.0 ) * uNormalScale;
  vec3 tmTs = vec3( tmXy, sqrt( max( 0.0, 1.0 - dot( tmXy, tmXy ) ) ) );
  vec3 tmWorldN = normalize( tmTs.x * tmT + tmTs.y * tmB + tmTs.z * tmN );
  normal = normalize( ( viewMatrix * vec4( tmWorldN, 0.0 ) ).xyz );
}
`;

/** Three r185's `aomap_fragment`, the AO read off the packed map's red channel. */
const AO = /* glsl */ `
{
  float ambientOcclusion = tmOrm.r;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}
`;

/** What `onBeforeCompile` is handed, as much of it as this reads and writes. */
export interface ShaderLike {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
  defines?: Record<string, unknown>;
}

/** The uniforms a surface material keeps, bound into its program and changed in place by a tuning edit. */
export interface SurfaceUniforms {
  tColor: { value: Texture };
  tNormalHeight: { value: Texture };
  tOrm: { value: Texture };
  uSize: { value: number };
  uDepth: { value: number };
  uNormalScale: { value: number };
  uRoughness: { value: number };
  uTint: { value: number };
  uMean: { value: Color };
  uFade: { value: Vector2 };
}

/** A material drawn in a surface: its uniforms, to tune in place. */
export interface SurfaceMaterial extends MeshStandardMaterial {
  userData: { surfaceUniforms: SurfaceUniforms };
}

/** The shader text patched: every chunk replaced or anchored on, the parallax defined when asked. */
export function patchShader(shader: ShaderLike, uniforms: SurfaceUniforms, parallax: boolean): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VARYINGS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_WORLD}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${parallax ? '#define TM_PARALLAX\n' : ''}${VARYINGS}${FRAGMENT_PARS}`)
    .replace('#include <map_fragment>', FRAGMENT_PREAMBLE)
    .replace('#include <color_fragment>', COLOR)
    .replace('#include <roughnessmap_fragment>', ROUGHNESS)
    .replace('#include <metalnessmap_fragment>', METALNESS)
    .replace('#include <normal_fragment_maps>', NORMAL)
    .replace('#include <aomap_fragment>', AO);
}

/** Tune a surface material in place: its uniforms, no recompile, no textures reloaded. */
export function tuneSurface(uniforms: SurfaceUniforms, tuning: SurfaceTuning): void {
  uniforms.uSize.value = tuning.size;
  uniforms.uDepth.value = tuning.depth;
  uniforms.uNormalScale.value = tuning.normalScale;
  uniforms.uRoughness.value = tuning.roughness;
  uniforms.uTint.value = tuning.tint;
  meanOf(tuning, uniforms.uMean.value);
}

/** The average a tint is measured against: the material's own, or white when it was never kept. */
function meanOf(tuning: SurfaceTuning, into: Color): Color {
  return tuning.color === undefined ? into.setRGB(1, 1, 1) : into.set(tuning.color);
}

/**
 * A material drawn in a surface's maps: the near one, with parallax, or the flat one, without - each its own program
 * (`customProgramCacheKey`), the textures shared. The ground's takes its colours from the mesh's vertices
 * (`vertexColors`); a piece's from its instance, which an instanced mesh hands any material.
 */
export function makeSurfaceMaterial(textures: SurfaceTextures, tuning: SurfaceTuning, { parallax, vertexColors = false }: { parallax: boolean; vertexColors?: boolean }): SurfaceMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 1, vertexColors }) as SurfaceMaterial;
  const uniforms: SurfaceUniforms = {
    tColor: { value: textures.color },
    tNormalHeight: { value: textures.normalHeight },
    tOrm: { value: textures.orm },
    uSize: { value: tuning.size },
    uDepth: { value: tuning.depth },
    uNormalScale: { value: tuning.normalScale },
    uRoughness: { value: tuning.roughness },
    uTint: { value: tuning.tint },
    uMean: { value: meanOf(tuning, new Color()) },
    uFade: { value: new Vector2(PARALLAX_FADE[0], PARALLAX_FADE[1]) },
  };
  material.userData = { surfaceUniforms: uniforms };
  material.onBeforeCompile = (shader) => patchShader(shader as unknown as ShaderLike, uniforms, parallax);
  material.customProgramCacheKey = () => (parallax ? 'tile-surface:parallax' : 'tile-surface:flat');
  return material;
}
