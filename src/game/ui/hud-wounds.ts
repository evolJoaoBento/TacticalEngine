/**
 * Who on the party's sheets has just been hurt, and by how much: the difference between the Hit
 * Points marked the last time the sheets were drawn and now.
 *
 * Read off the sheets themselves rather than told to them, so anything that marks a Hit Point
 * shows - a blade, a fall, a trap, a spell's price - with nobody having to remember to say so.
 * Somebody seen for the first time has lost nothing: a party walking into a room already
 * wounded is not being wounded again. Healing is not a wound and is left alone.
 */

export interface Wounded {
  readonly id: string;
  readonly hitPoints: { readonly marked: number };
}

/** How long a wound shows on a sheet, in milliseconds: the shake is over sooner, the lost hearts fade across all of it. */
export const WOUND_MS = 900;

/** The Hit Points each member has marked since `before` was taken: only those who lost some. */
export function woundsSince(before: ReadonlyMap<string, number>, members: readonly Wounded[]): Map<string, number> {
  const wounds = new Map<string, number>();
  for (const member of members) {
    const had = before.get(member.id);
    if (had !== undefined && member.hitPoints.marked > had) wounds.set(member.id, member.hitPoints.marked - had);
  }
  return wounds;
}

/** What is marked on every sheet now, to measure the next wound against. */
export function markedNow(members: readonly Wounded[]): Map<string, number> {
  return new Map(members.map((member) => [member.id, member.hitPoints.marked]));
}
