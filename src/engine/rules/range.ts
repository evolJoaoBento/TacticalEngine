/**
 * Range bands.
 *
 * SRD 2.0 reference: the SRD 2.0 text (no longer vendored — see `docs/CONTEXT.md`),
 * "MAPS, RANGE, AND MOVEMENT" — the bands are unchanged from 1.0. Note that the
 * terser `Range Bands` entry in the SRD's rules summary (no longer vendored)
 * omits Melee; the six bands here are the full list.
 */

/** Ordered from closest to furthest. `outOfRange` is "beyond a character's Very Far". */
export const RANGE_BANDS = ['melee', 'veryClose', 'close', 'far', 'veryFar', 'outOfRange'] as const;
export type RangeBand = (typeof RANGE_BANDS)[number];

/** Bands an effect can actually target. */
export type TargetableRangeBand = Exclude<RangeBand, 'outOfRange'>;

/** Position in the band order; larger is further away. */
export function bandIndex(band: RangeBand): number {
  return RANGE_BANDS.indexOf(band);
}

/**
 * Whether something at `band` is within a stated maximum range: "a weapon, spell,
 * ability, item, or other effect's stated range is a maximum range; unless
 * otherwise noted, it can be used at closer distances."
 */
export function reaches(band: RangeBand, maxRange: RangeBand): boolean {
  return band !== 'outOfRange' && bandIndex(band) <= bandIndex(maxRange);
}

/** The closer of two bands. */
export function nearerBand(a: RangeBand, b: RangeBand): RangeBand {
  return bandIndex(a) <= bandIndex(b) ? a : b;
}

/**
 * Upper bound in tiles for each band, used to turn a grid distance into a band.
 *
 * The default follows the SRD's own distances at the SRD's own scale — Melee is
 * "up to a few feet", Very Close 5-10 ft, Close 10-30 ft, Far 30-100 ft, Very Far
 * 100-300 ft — with a 5 ft tile. A project that wants a tighter tactical map can
 * pass its own table; nothing in the rules depends on these numbers.
 */
export const DEFAULT_BAND_TILES: Readonly<Record<TargetableRangeBand, number>> = {
  melee: 1,
  veryClose: 2,
  close: 6,
  far: 20,
  veryFar: 60,
};

export type BandTiles = Readonly<Record<TargetableRangeBand, number>>;

/** The band a tile distance falls into. Distances beyond Very Far are out of range. */
export function bandForDistance(tiles: number, table: BandTiles = DEFAULT_BAND_TILES): RangeBand {
  for (const band of RANGE_BANDS) {
    if (band === 'outOfRange') break;
    if (tiles <= table[band]) return band;
  }
  return 'outOfRange';
}

/** How far past a band's number a span still counts as inside it, in tiles: half a tile, which is what rounding gave. */
export const BAND_GRACE = 0.5;

/**
 * The band a straight-line span falls in. The game is not played on a grid:
 * distance is "as the crow flies", from where one creature stands to where the
 * other does, and nothing depends on which way a corridor runs.
 *
 * A band reaches half a tile past its number. That is what measuring "to the
 * nearest tile" always meant - `round(span) <= n` is `span < n + 0.5` - so a
 * diagonal neighbour (1.41 tiles away) is Melee like any other neighbour, and
 * every span between two tile centres falls where it always fell. What is new
 * is that a span need not be between centres: it is a real number, and a step
 * of a tenth of a tile can be the step that brings somebody into reach.
 *
 * Every measurement goes through here, so the rule cannot drift between the
 * attack, the area, the script and the picture.
 */
export function bandForSpan(span: number, table: BandTiles = DEFAULT_BAND_TILES): RangeBand {
  for (const band of RANGE_BANDS) {
    if (band === 'outOfRange') break;
    if (span < table[band] + BAND_GRACE) return band;
  }
  return 'outOfRange';
}

/** The furthest span still inside a band: the radius of the circle a band is, on the ground. */
export function maxSpanForBand(band: RangeBand, table: BandTiles = DEFAULT_BAND_TILES): number {
  return band === 'outOfRange' ? Infinity : table[band] + BAND_GRACE;
}

/** The next distance step out from a band - Close to Far, Far to Very Far - or null past the last. */
export function nextBand(band: RangeBand): TargetableRangeBand | null {
  const i = RANGE_BANDS.indexOf(band);
  const next = RANGE_BANDS[i + 1];
  return next === undefined || next === 'outOfRange' ? null : next;
}

/** Somebody on the map: the tile they are in (negative when they are off it) and where in it they stand. */
interface Standing {
  readonly tile: number;
  readonly at: { readonly x: number; readonly y: number };
}

/** The band between two creatures, from where one stands to where the other does; null when either is missing or off the map. */
export function bandBetweenStanding(a: Standing | undefined, b: Standing | undefined, table: BandTiles = DEFAULT_BAND_TILES): RangeBand | null {
  if (a === undefined || b === undefined || a.tile < 0 || b.tile < 0) return null;
  return bandForSpan(Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y), table);
}

/** Furthest tile distance still inside a band. */
export function maxTilesForBand(band: RangeBand, table: BandTiles = DEFAULT_BAND_TILES): number {
  return band === 'outOfRange' ? Infinity : table[band];
}

const BAND_LABELS: Readonly<Record<RangeBand, string>> = {
  melee: 'Melee',
  veryClose: 'Very Close',
  close: 'Close',
  far: 'Far',
  veryFar: 'Very Far',
  outOfRange: 'Out of Range',
};

/** The SRD's own spelling of a band, for logs and UI. */
export function bandLabel(band: RangeBand): string {
  return BAND_LABELS[band];
}

const BAND_BY_TEXT = new Map<string, RangeBand>(
  RANGE_BANDS.map((band) => [BAND_LABELS[band].toLowerCase().replace(/\s+/g, ''), band]),
);

/**
 * Read a band out of content text: "Very Close", "very close", "veryClose".
 * Returns `null` for anything else so an importer can name the bad stat block.
 */
export function parseRangeBand(input: string): RangeBand | null {
  if (typeof input !== 'string') return null;
  return BAND_BY_TEXT.get(input.trim().toLowerCase().replace(/[\s_-]+/g, '')) ?? null;
}
