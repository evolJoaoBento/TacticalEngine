/**
 * What a token does when a blow marks a Hit Point: it is knocked, it shudders, and the line
 * round it burns red for as long as that takes.
 *
 * The pose is a function of how far through the reaction is and touches only scale and lean,
 * never where the token stands - a wounded creature is often mid-walk, and the walk is the
 * glide's. The red is the faction line's own mesh wearing another colour, put back when the
 * reaction ends; a model's materials are shared with every other token of that model, so
 * tinting the body would wound the whole warband at once.
 *
 * Apart from `SceneView` because that file is at its readable limit.
 */

import type { Object3D } from 'three';

/** How long a token takes to be hurt, in seconds: long enough to read, short enough for a volley. */
export const HURT_SECONDS = 0.6;

/** The line round somebody being hurt. */
export const HURT_RIM = '#ff2a1c';

/**
 * The pose `t` of the way through, 0 to 1: a swell on the impact, a recoil that rocks three
 * times and dies away, and a dip as the knees take it. All of it is gone at 1.
 */
export function poseHurt(group: Object3D, t: number): void {
  const fade = (1 - t) * (1 - t);
  // The impact is the first fifth: a fast swell, then the body settling back through it.
  const hit = t < 0.2 ? Math.sin((Math.PI * t) / 0.4) : Math.cos((Math.PI * (t - 0.2)) / 1.6) * fade;
  const swell = 1 + 0.2 * Math.max(0, hit);
  group.scale.set(swell, 1 - 0.1 * Math.max(0, hit) + 0.04 * Math.sin(Math.PI * t), swell);
  group.rotation.z = 0.3 * Math.sin(6 * Math.PI * t) * fade;
}

/** Stood up straight again, at their own size. */
export function restFromHurt(group: Object3D): void {
  group.scale.set(1, 1, 1);
  group.rotation.z = 0;
}
