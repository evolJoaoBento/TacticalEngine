/**
 * Where an equipment card's picture is, if it has one.
 *
 * The pictures are the project's own art, published on Hugging Face and fetched by `npm run models`
 * into `public/equipment/` - so a clone that has not fetched them has none, and a card draws itself
 * from its numbers instead (`GearFace`, which falls back when the image does not load). A URL is
 * only ever built for a file `equipment.lock.json` names, the same promise `card-art.ts` keeps for
 * the domain cards: never a guess.
 */

import lock from '../../../equipment.lock.json';

const LISTED: ReadonlySet<string> = new Set(lock.files.map((file) => file.path));

/** The picture for a card's `card` file, or null when the list names no such file. */
export function equipmentArt(file: string | undefined): string | null {
  if (file === undefined) return null;
  const path = `equipment/${file}`;
  return LISTED.has(path) ? `/${path}` : null;
}
