/**
 * The minis seen from above in New Game's row (`mini-portraits.ts`), and the figures the table stands.
 * Drawing needs a browser, and the e2e test finds the chosen mini drawn in its box; what is driven here
 * is what decides the drawing - the figure built from a model's file as the board builds one, and how
 * high the camera hangs to hold it.
 */

import { describe, expect, it } from 'vitest';
import { AnimationClip, BoxGeometry, Group, Mesh } from 'three';
import { modelAssetSchema } from '../../engine/render/assets';
import { aboveFor, figureOf } from './mini-portraits';

/** A file's scene: a figure 2 tall, 0.6 across and 0.4 deep, its origin at its middle, with two clips. */
function file(): Group {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(0.6, 2, 0.4)));
  scene.animations = [new AnimationClip('Wave', 1, []), new AnimationClip('Breathe', 1, [])];
  return scene;
}

const spec = (changes: Record<string, unknown> = {}) => modelAssetSchema.parse({ id: 'faun-male', url: '/faun-male.glb', kind: 'gltf', ...changes });

describe('a figure on a card', () => {
  it('stands on its feet at its scale, and knows how tall it is and how far it reaches', () => {
    const figure = figureOf(file(), spec({ scale: 0.5 }));
    expect(figure.height).toBeCloseTo(1);
    expect(figure.reach).toBeCloseTo(Math.hypot(0.15, 0.1));
    expect(figure.root.children[0]!.position.y).toBeCloseTo(0.5);
  });

  it('plays the idle it is told to, or the first clip it has', () => {
    const named = figureOf(file(), spec({ clips: { idle: 'Breathe' } }));
    expect(named.mixer!.existingAction('Breathe')!.isRunning()).toBe(true);
    expect(named.mixer!.existingAction('Wave')).toBeNull();
    const first = figureOf(file(), spec());
    expect(first.mixer!.existingAction('Wave')!.isRunning()).toBe(true);
    const still = new Group();
    still.add(new Mesh(new BoxGeometry(1, 1, 1)));
    expect(figureOf(still, spec()).mixer).toBeNull();
  });

  it('is a clone, so two cards of one model do not share a body', () => {
    const template = file();
    const one = figureOf(template, spec());
    const two = figureOf(template, spec());
    expect(one.root.children[0]).not.toBe(two.root.children[0]);
    expect(template.parent).toBeNull();
  });
});

describe('how high the camera hangs over a mini in its box', () => {
  it('is higher for a wider figure, and higher still in a narrower box', () => {
    expect(aboveFor({ height: 1, reach: 0.3 }, 0.7)).toBeLessThan(aboveFor({ height: 1, reach: 0.9 }, 0.7));
    expect(aboveFor({ height: 1, reach: 0.9 }, 0.5)).toBeGreaterThan(aboveFor({ height: 1, reach: 0.9 }, 1));
  });

  it('holds its whole reach with room to spare, and is never down in its head', () => {
    const figure = { height: 2, reach: 0.8 };
    const seen = aboveFor(figure, 0.7) * Math.tan((14 * Math.PI) / 180) * 0.7;
    expect(seen).toBeGreaterThan(figure.reach);
    expect(seen).toBeLessThan(figure.reach * 1.3);
    expect(aboveFor({ height: 3, reach: 0.05 }, 0.7)).toBeGreaterThan(3);
  });
});
