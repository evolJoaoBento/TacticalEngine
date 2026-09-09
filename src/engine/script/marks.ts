/**
 * A spot somebody marked to come back to.
 *
 * Rift Walker puts "an arcane marking on the ground where you currently
 * stand"; Phantom Retreat remembers "where you were standing when you
 * activated" it. Both are a tile, kept per creature under the card's own name,
 * and both are campaign state - a save carries them - so they live in the
 * scenario's variables under a prefix rather than in a structure of their own.
 *
 * A mark is a tile index, and a tile index means nothing in another room, so
 * travelling forgets every mark; so does a rest, which is the one expiry
 * Phantom Retreat prints and the one Rift Walker gets for the same reason.
 */

export const MARK_PREFIX = 'mark:';

/** The variable a creature's mark of that name lives under. */
export function markKey(mark: string, actor: string): string {
  return `${MARK_PREFIX}${mark}:${actor}`;
}

/** The mark and the creature a variable name is about, or nothing for any other variable. */
export function parseMarkKey(name: string): { mark: string; actor: string } | null {
  if (!name.startsWith(MARK_PREFIX)) return null;
  const rest = name.slice(MARK_PREFIX.length);
  const at = rest.indexOf(':');
  if (at <= 0 || at === rest.length - 1) return null;
  return { mark: rest.slice(0, at), actor: rest.slice(at + 1) };
}
