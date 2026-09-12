import { describe, expect, it } from 'vitest';
import { DEMO_CHARACTERS } from '../../src/game/demo-scene';
import {
  DOMAIN_COLORS,
  SIGIL_HEIGHT,
  SIGIL_WIDTH,
  domainColor,
  sigilOf,
} from '../../src/game/ui/card-sigil';

/**
 * Card art is generated, not downloaded.
 *
 * This test used to read `public/cards/sources.json` and assert a JPEG per
 * card. Those files are Critical Role's artwork, fetched from a fan mirror and
 * now ignored by git, so that test could only pass on the one machine that had
 * run the downloader — a fresh clone failed it. What replaces it pins the
 * property that actually matters: every card draws a complete face from the
 * vendored SRD data alone, with nothing to fetch.
 */

const cards = [...DEMO_CHARACTERS.domainCards.values()];

describe('generated domain card art', () => {
  it('draws every card in the SRD library, with no files to load', () => {
    expect(cards.length).toBeGreaterThan(180);
    for (const card of cards) {
      const sigil = sigilOf(card);
      expect(sigil.shapes.length, card.name).toBeGreaterThan(3);
      expect(sigil.color, card.name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('puts every coordinate inside the art slot', () => {
    // Nothing may sail off the frame: the slot clips, and a stray NaN would
    // silently drop a shape rather than fail anywhere visible.
    for (const card of cards) {
      for (const shape of sigilOf(card).shapes) {
        const numbers = shape.kind === 'circle'
          ? [shape.cx, shape.cy, shape.r]
          : [...shape.points];
        for (const n of numbers) expect(Number.isFinite(n), `${card.name}: ${n}`).toBe(true);

        if (shape.kind === 'circle') {
          expect(shape.cx, card.name).toBeGreaterThanOrEqual(-SIGIL_WIDTH);
          expect(shape.cx, card.name).toBeLessThanOrEqual(SIGIL_WIDTH * 2);
          expect(shape.r, card.name).toBeGreaterThan(0);
        }
        for (let i = 0; i < numbers.length; i++) {
          expect(Math.abs(numbers[i]!), card.name).toBeLessThan(SIGIL_WIDTH * 2);
        }
      }
      expect(SIGIL_HEIGHT).toBeGreaterThan(0);
    }
  });

  it('gives a card the same emblem every time it is drawn', () => {
    // The collection, the enlarged view and the action bar each call this
    // independently; a card that shuffled between them would look like a bug.
    for (const card of cards.slice(0, 25)) {
      expect(sigilOf(card)).toEqual(sigilOf(card));
    }
  });

  it('gives different cards different emblems, including within one domain', () => {
    const blade = cards.filter((c) => c.domain.toLowerCase() === 'blade').slice(0, 6);
    expect(blade.length).toBeGreaterThan(1);
    const drawings = blade.map((c) => JSON.stringify(sigilOf(c).shapes));
    expect(new Set(drawings).size, 'two Blade cards drew the same emblem').toBe(blade.length);
  });

  it('seeds from the id alone, so the domain only chooses the palette', () => {
    const first = sigilOf({ id: 'a-soldiers-bond', domain: 'Blade' });
    const recoloured = sigilOf({ id: 'a-soldiers-bond', domain: 'Valor' });
    // Blade and Valor share the 'spikes' motif, so only the colour may differ.
    expect(recoloured.shapes).toEqual(first.shapes);
    expect(recoloured.color).not.toBe(first.color);
  });

  it('knows a colour for every domain the library uses', () => {
    for (const card of cards) {
      expect(Object.keys(DOMAIN_COLORS), card.domain).toContain(card.domain.toLowerCase());
    }
    expect(domainColor('NoSuchDomain')).toBe(DOMAIN_COLORS['arcana']);
  });
});
