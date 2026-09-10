/**
 * Turning a file a player chose into something small enough to keep.
 *
 * Imported art lives in `localStorage` beside the save slots, which is a few
 * megabytes for everything. A photo straight off a camera would fill it with
 * one card, so a picture is redrawn to at most `MAX_WIDTH` across and encoded
 * as JPEG before it is stored: a card's art slot is a couple of hundred pixels
 * wide on screen, so nothing visible is lost.
 *
 * Browser-only, because it is `Image` and `<canvas>` doing the work. The tiers
 * that decide *which* picture to show are in `card-art.ts` and are plain data.
 */

/** Wide enough for the enlarged reading view, small enough to keep many. */
export const MAX_WIDTH = 512;
const QUALITY = 0.82;

/** Files a player may choose. */
export const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

/**
 * Read a chosen file and give back a small JPEG data URL.
 *
 * Rejects with a sentence fit to show a player: a file that is not an image, or
 * one the browser cannot decode, is their mistake to see rather than a silent
 * no-op.
 */
export async function pictureFromFile(file: File, maxWidth = MAX_WIDTH): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name} is not an image.`);
  }
  const source = URL.createObjectURL(file);
  try {
    const image = await decode(source);
    const scale = Math.min(1, maxWidth / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This browser would not open a drawing surface.');
    // JPEG has no transparency; fill first so a PNG's clear background reads as
    // paper rather than black.
    context.fillStyle = '#1b1f2a';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', QUALITY);
  } finally {
    URL.revokeObjectURL(source);
  }
}

function decode(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file could not be read as a picture.'));
    image.src = source;
  });
}
