/**
 * Card artwork drawn from the card itself.
 *
 * A domain card's face used to show a downloaded illustration. Those images are
 * Critical Role's artwork and no licence this project holds covers them, so the
 * art slot is generated here instead: a seeded emblem built from the card's own
 * id and domain, and nothing else. It needs no files, no network and no
 * `public/` directory, so a fresh clone draws a complete card.
 *
 * Deterministic, like everything else that rolls: `createRng(card.id)` means a
 * card wears the same emblem in the collection, in the enlarged view and on the
 * action bar, in this run and the next. Seeded from the id alone — not the
 * domain — so two cards of one domain still differ.
 *
 * The hard part is not drawing one emblem, it is drawing two hundred that a
 * player can tell apart. Radial designs all look alike, so the seed picks a
 * silhouette before it picks any numbers: how many arms, whether they alternate
 * long and short, what sits at the centre, whether a ring or a polygon frames
 * it. A hand of five Valor cards should not read as one shape five times.
 *
 * Pure data out; no DOM. `CardFace` turns the shapes into SVG and the tests
 * read them as numbers.
 */

import { createRng, type Rng } from '../../engine/core/rng';

/** The nine domains, and the colour each one wears. */
export const DOMAIN_COLORS: Readonly<Record<string, string>> = {
  // The starter pack's own domains, first because they are the ones that ship.
  bulwark: '#6b7f8c',
  shadow: '#4a4458',
  ember: '#b2552f',
  arcana: '#695cac',
  blade: '#973f45',
  bone: '#a99a78',
  codex: '#426baa',
  grace: '#b75d90',
  midnight: '#414a87',
  sage: '#507b4b',
  splendor: '#be993c',
  valor: '#b76b38',
  // Not a domain: the colour a card in play because of what its holder is wears.
  granted: '#7b8494',
};

/** The colour for a domain, however it was cased or spelled. */
export function domainColor(domain: string): string {
  return DOMAIN_COLORS[domain.toLowerCase()] ?? DOMAIN_COLORS['arcana']!;
}

/** The art slot's coordinate space. Landscape, matching the frame's window. */
export const SIGIL_WIDTH = 120;
export const SIGIL_HEIGHT = 78;

const CENTRE_X = SIGIL_WIDTH / 2;
const CENTRE_Y = SIGIL_HEIGHT / 2;
/** The slot is wider than it is tall; flatten anything radial to suit. */
const SQUASH = 0.72;

export type SigilShape =
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number; readonly opacity: number; readonly fill: boolean; readonly width: number }
  | { readonly kind: 'polygon'; readonly points: readonly number[]; readonly opacity: number; readonly fill: boolean; readonly width: number };

export interface Sigil {
  /** The domain's colour, for the caller that paints the ground behind this. */
  readonly color: string;
  /** Back to front. */
  readonly shapes: readonly SigilShape[];
}

/**
 * How a domain builds its emblem. The seed picks the counts and the angles; the
 * family decides what is being counted, so a Blade card reads as blades and a
 * Grace card as petals without either being a picture of anything.
 */
type Motif = 'rings' | 'spikes' | 'petals' | 'arcs';

const MOTIFS: Readonly<Record<string, Motif>> = {
  // Both of the pack's domains take the same motif, so the palette is the only
  // thing a domain changes between them.
  bulwark: 'spikes',
  ember: 'spikes',
  shadow: 'arcs',
  arcana: 'rings',
  codex: 'rings',
  blade: 'spikes',
  valor: 'spikes',
  splendor: 'spikes',
  grace: 'petals',
  sage: 'petals',
  bone: 'arcs',
  midnight: 'arcs',
};

const at = (angle: number, radius: number): [number, number] =>
  [CENTRE_X + Math.cos(angle) * radius, CENTRE_Y + Math.sin(angle) * radius * SQUASH];

/** A regular polygon, flattened to the slot. */
function ngon(radius: number, sides: number, rotation: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < sides; i++) points.push(...at(rotation + (i * Math.PI * 2) / sides, radius));
  return points;
}

/** A tapered spike from `inner` to `outer` along `angle`. */
function spike(angle: number, inner: number, outer: number, halfWidth: number): number[] {
  const across = angle + Math.PI / 2;
  const [ix, iy] = at(angle, inner);
  const ax = Math.cos(across) * halfWidth;
  const ay = Math.sin(across) * halfWidth * SQUASH;
  return [ix + ax, iy + ay, ...at(angle, outer), ix - ax, iy - ay];
}

/** A leaf along `angle`, bulging to either side of its spine. */
function petal(angle: number, inner: number, outer: number, halfWidth: number): number[] {
  const across = angle + Math.PI / 2;
  const [mx, my] = at(angle, (inner + outer) / 2);
  const ax = Math.cos(across) * halfWidth;
  const ay = Math.sin(across) * halfWidth * SQUASH;
  return [...at(angle, inner), mx + ax, my + ay, ...at(angle, outer), mx - ax, my - ay];
}

/** An open arc, as a run of points along a flattened circle. */
function arc(radius: number, from: number, to: number, steps: number): number[] {
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) points.push(...at(from + ((to - from) * i) / steps, radius));
  return points;
}

/** Whatever sits in the middle: a dot, a ring, or a small polygon. */
function core(rng: Rng, shapes: SigilShape[]): void {
  const pick = rng.nextInt(3);
  const r = 4 + rng.next() * 4;
  if (pick === 0) shapes.push({ kind: 'circle', cx: CENTRE_X, cy: CENTRE_Y, r, opacity: 0.62, fill: true, width: 0 });
  else if (pick === 1) shapes.push({ kind: 'circle', cx: CENTRE_X, cy: CENTRE_Y, r: r + 2, opacity: 0.6, fill: false, width: 1.5 });
  else shapes.push({ kind: 'polygon', points: ngon(r + 3, 3 + rng.nextInt(4), rng.next() * Math.PI), opacity: 0.5, fill: true, width: 0 });
}

/**
 * The emblem for one card. Same card, same emblem, every time.
 *
 * `domain` only chooses the palette and the motif family; the seed is the id, so
 * two Blade cards are both blades and still not the same drawing.
 */
export function sigilOf(card: { readonly id: string; readonly domain: string }): Sigil {
  const rng = createRng(card.id);
  const motif = MOTIFS[card.domain.toLowerCase()] ?? 'rings';
  const shapes: SigilShape[] = [];

  // The silhouette is chosen before any measurement, so cards differ in shape
  // rather than only in degree.
  const arms = 4 + rng.nextInt(8);
  const alternating = arms % 2 === 0 && rng.next() < 0.45;
  const turn = rng.next() * Math.PI * 2;
  const step = (Math.PI * 2) / arms;
  const reach = 23 + rng.nextInt(11);

  // Ground: a disc or a polygon, so the emblem sits on something.
  const backdrop = 27 + rng.nextInt(8);
  shapes.push(rng.next() < 0.35
    ? { kind: 'polygon', points: ngon(backdrop, 5 + rng.nextInt(4), rng.next() * Math.PI), opacity: 0.12, fill: true, width: 0 }
    : { kind: 'circle', cx: CENTRE_X, cy: CENTRE_Y, r: backdrop, opacity: 0.13, fill: true, width: 0 });

  if (motif === 'rings') {
    const bands = 2 + rng.nextInt(3);
    for (let i = 0; i < bands; i++) {
      shapes.push({ kind: 'circle', cx: CENTRE_X, cy: CENTRE_Y, r: 9 + i * (5 + rng.nextInt(4)), opacity: 0.34 - i * 0.05, fill: false, width: 0.9 + rng.next() * 0.8 });
    }
    for (let i = 0; i < arms; i++) {
      const [x, y] = at(turn + i * step, reach - (alternating && i % 2 === 1 ? 8 : 0));
      shapes.push({ kind: 'circle', cx: x, cy: y, r: 1.4 + rng.next() * 2, opacity: 0.5, fill: true, width: 0 });
    }
  } else if (motif === 'spikes') {
    for (let i = 0; i < arms; i++) {
      const outer = alternating && i % 2 === 1 ? reach * 0.55 : reach;
      shapes.push({ kind: 'polygon', points: spike(turn + i * step, 5, outer, 1.8 + rng.next() * 2.2), opacity: 0.44, fill: true, width: 0 });
    }
  } else if (motif === 'petals') {
    for (let i = 0; i < arms; i++) {
      const outer = alternating && i % 2 === 1 ? reach * 0.62 : reach;
      shapes.push({ kind: 'polygon', points: petal(turn + i * step, 3, outer, 3 + rng.next() * 3.5), opacity: 0.34, fill: true, width: 0 });
    }
  } else {
    const bands = 3 + rng.nextInt(3);
    for (let i = 0; i < bands; i++) {
      const from = turn + rng.next() * 1.4;
      shapes.push({ kind: 'polygon', points: arc(10 + i * (4 + rng.nextInt(4)), from, from + Math.PI * (0.7 + rng.next() * 0.7), 14), opacity: 0.42 - i * 0.05, fill: false, width: 1 + rng.next() * 0.7 });
    }
    for (let i = 0; i < arms; i++) {
      const [x, y] = at(turn + i * step, reach + 4);
      shapes.push({ kind: 'circle', cx: x, cy: y, r: 1.2 + rng.next() * 1.3, opacity: 0.45, fill: true, width: 0 });
    }
  }

  // A frame, on some cards only: the cheapest way to split the field in two.
  if (rng.next() < 0.4) {
    shapes.push({ kind: 'polygon', points: ngon(reach + 6 + rng.nextInt(4), 3 + rng.nextInt(5), rng.next() * Math.PI), opacity: 0.22, fill: false, width: 1 });
  }

  core(rng, shapes);
  return { color: domainColor(card.domain), shapes };
}
