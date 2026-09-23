/**
 * What a token does in place of standing still: taking a blow, going down, getting up, lunging at
 * somebody, and blinking through a portal.
 *
 * Lifted out of `SceneView`, which is at its ceiling. It keeps one reaction per token and moves each
 * on with the clock; the view says when one starts, and hands over the two things it alone knows -
 * how a clip is played, and whether a token is still walking when its flinch ends.
 */

import type { Object3D } from 'three';
import type { BuiltModel } from './procedural/build';
import { flashOutline } from './faction-outline';
import { HURT_RIM, HURT_SECONDS, poseHurt, restFromHurt } from './hurt-reaction';
import { BLINK_SECONDS, poseBlink, restFromBlink, startBlink, type Blink } from './blink';

export type ReactionKind = 'flinch' | 'fall' | 'rise' | 'lunge' | 'blink';

interface Reaction {
  token: BuiltModel;
  kind: ReactionKind;
  elapsed: number;
  duration: number;
  /** A lunge: the way to the target, unit length, and how far along it the token is right now. */
  toward?: { x: number; z: number };
  offset?: number;
  /** A flinch: what puts the line round them back to the colour it was. */
  undo?: () => void;
  /** A blink: where from and where to. */
  blink?: Blink;
}

export interface ReactionHooks {
  play(group: Object3D, state: 'idle' | 'walk' | 'hit' | 'fallen'): void;
  /** Whether this token is walking still: a flinch ends in the walk rather than the idle. */
  walking(token: BuiltModel): boolean;
  tileSize(): number;
}

export class Reactions {
  private readonly live = new Map<string, Reaction>();

  constructor(private readonly hooks: ReactionHooks) {}

  get size(): number {
    return this.live.size;
  }

  has(id: string): boolean {
    return this.live.has(id);
  }

  /** Forget one without finishing it: the token is going, or has been put right by other means. */
  delete(id: string): boolean {
    return this.live.delete(id);
  }

  clear(): void {
    this.live.clear();
  }

  /**
   * Start one. A lunge needs the way to its target; a blink needs where the token was before it
   * was put where it comes out.
   */
  start(id: string, token: BuiltModel, kind: ReactionKind, toward?: { x: number; z: number }, from?: { x: number; y: number; z: number }): void {
    // A fall or a rise replaces anything, and nothing replaces it: the body going down is the thing to see.
    const current = this.live.get(id);
    if (current !== undefined) {
      if ((current.kind === 'fall' || current.kind === 'rise') && kind !== 'fall' && kind !== 'rise') return;
      this.finish(current);
    }
    const duration = kind === 'flinch' ? HURT_SECONDS : kind === 'lunge' ? 0.3 : kind === 'blink' ? BLINK_SECONDS : 0.45;
    this.live.get(id)?.undo?.(); // a blow on top of a blow: the first flash is put right before the second
    this.live.set(id, {
      token,
      kind,
      elapsed: 0,
      duration,
      ...(toward === undefined ? {} : { toward, offset: 0 }),
      ...(kind === 'flinch' ? { undo: flashOutline(token.group, HURT_RIM) } : {}),
      ...(kind === 'blink' && from !== undefined ? { blink: startBlink(token.group, from) } : {}),
    });
    if (kind === 'flinch') this.hooks.play(token.group, 'hit');
    else if (kind === 'fall') this.hooks.play(token.group, 'fallen');
    else if (kind === 'rise' || kind === 'blink') this.hooks.play(token.group, 'idle');
  }

  /** Move every reaction on by `dt` seconds. */
  advance(dt: number): void {
    for (const [id, reaction] of this.live) {
      reaction.elapsed += dt;
      const t = Math.min(1, reaction.elapsed / reaction.duration);
      const group = reaction.token.group;
      if (reaction.kind === 'flinch') {
        poseHurt(group, t); // knocked, shuddering, and the line round them burning red
      } else if (reaction.kind === 'lunge') {
        // Out fast, back slower, a third of a tile at the furthest. Applied as
        // the change since last tick, so a walk under it is left alone.
        const reach = this.hooks.tileSize() * 0.35 * Math.sin(Math.PI * Math.pow(t, 0.7));
        const delta = reach - (reaction.offset ?? 0);
        group.position.x += reaction.toward!.x * delta;
        group.position.z += reaction.toward!.z * delta;
        reaction.offset = reach;
      } else if (reaction.kind === 'blink') {
        if (reaction.blink !== undefined) poseBlink(group, reaction.blink, t);
      } else {
        // A body drops: slow to start, quick to land. Getting up is the reverse.
        const eased = t * t;
        group.rotation.x = reaction.kind === 'fall' ? -eased * (Math.PI / 2) : -(1 - eased) * (Math.PI / 2);
      }
      if (t >= 1) {
        this.finish(reaction);
        this.live.delete(id);
      }
    }
  }

  /** Every reaction at rest, now. */
  settle(): void {
    for (const [id, reaction] of this.live) {
      this.finish(reaction);
      this.live.delete(id);
    }
  }

  private finish(reaction: Reaction): void {
    const group = reaction.token.group;
    if (reaction.kind === 'flinch') {
      restFromHurt(group);
      reaction.undo?.();
      // Back to the idle, or to the walk if one is still under way.
      this.hooks.play(group, this.hooks.walking(reaction.token) ? 'walk' : 'idle');
    } else if (reaction.kind === 'lunge') {
      // Whatever is still leaned out comes back.
      group.position.x -= reaction.toward!.x * (reaction.offset ?? 0);
      group.position.z -= reaction.toward!.z * (reaction.offset ?? 0);
      reaction.offset = 0;
    } else if (reaction.kind === 'blink') {
      if (reaction.blink !== undefined) restFromBlink(group, reaction.blink);
    } else {
      group.rotation.x = reaction.kind === 'fall' ? -Math.PI / 2 : 0;
    }
  }
}
