/**
 * Range bands.
 *
 * SRD reference: `tools/srd-sources/seansbox/README.md`, "MAPS, RANGE, AND MOVEMENT".
 * Note that the terser `Range Bands` entry in
 * `tools/srd-sources/daggersearch/core/rules.json` omits Melee; the six bands here
 * are the full list.
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
