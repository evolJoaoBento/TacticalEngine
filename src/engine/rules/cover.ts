/**
 * Cover and line of sight.
 *
 * SRD 2.0 reference: `tools/srd-sources/official-2.0/srd-2.0.txt`,
 * "LINE OF SIGHT & COVER":
 *
 * > Unless stated otherwise, a ranged attacker must have line of sight to their
 * > intended target to make an attack roll. If a partial obstruction lies between
 * > the attacker and target, the target has cover. Attacks made through cover are
 * > rolled with disadvantage. If the obstruction is total, there is no line of sight.
 *
 * **This replaced the SRD 1.0 rule.** 1.0 had three graded levels — Light Cover
 * (+1 Evasion against ranged attacks), Full Cover (+2) and Total Cover (cannot be
 * targeted) — and the engine implemented those until the 2.0 diff pass. In 2.0 the
 * strings "Light Cover", "Full Cover" and "Total Cover" do not appear at all:
 * cover is binary, it costs the attacker a disadvantage die rather than raising
 * the target's Evasion, and being unreachable is a line-of-sight question instead
 * of a third cover level.
 *
 * The 2.0 rule is also simpler to apply evenly. Because it modifies the *attack
 * roll* rather than the target's Evasion — a PC stat that adversaries do not have —
 * it needs no house rule to work in both directions, which the 1.0 version did.
 */

/** Whether an obstruction stands between an attacker and their target. */
export type Cover = 'none' | 'cover';

/**
 * Cover costs the attacker a disadvantage die: "Attacks made through cover are
 * rolled with disadvantage." One die, never more — advantage and disadvantage do
 * not stack in 2.0 either.
 */
export function coverDisadvantage(cover: Cover, ranged = true): number {
  return ranged && cover === 'cover' ? 1 : 0;
}

/** Cover only applies to ranged attacks; a melee attacker is already past it. */
export function coverApplies(ranged: boolean): boolean {
  return ranged;
}

/** True when either source gives the target cover. Cover does not stack. */
export function combineCover(a: Cover, b: Cover): Cover {
  return a === 'cover' || b === 'cover' ? 'cover' : 'none';
}
