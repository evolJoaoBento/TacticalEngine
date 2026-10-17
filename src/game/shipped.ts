/**
 * The content the page ships with, as the Rust engine reads it (`server/engine/src/game/content.rs`'s
 * `Shipped`): the characters' pack - its gear with their numbers and its cards with their words - the stat
 * blocks, the starter abilities, the conditions and the items.
 *
 * What a project carries of its own is in the project; this is what every project is played over. The page
 * hands it to the replica it builds (`shadow.ts`), and the golden writers write the same shape into the
 * fixtures the Rust replays.
 */

import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import type { ContentPack } from '../engine/content/pack/import';
import { STARTER_ABILITIES, STARTER_CONDITIONS } from '../engine/content/pack/starter';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { DEMO_ADVERSARIES, DEMO_CHARACTERS } from './demo-rules';

/** A characters' pack as the Rust reads it: the fields it has, and none it does not. */
export function contentJson(pack: ContentPack) {
  return {
    weapons: [...pack.weapons.values()].map(({ id, name, tier, slot, trait, range, damage, burden, features }) => ({ id, name, tier, slot, trait, range, damage, burden, features })),
    armors: [...pack.armors.values()].map(({ id, name, tier, baseThresholds, baseScore, features }) => ({ id, name, tier, baseThresholds, baseScore, features })),
    classes: [...pack.classes.values()].map(({ id, name, domains, startingEvasion, startingHitPoints }) => ({ id, name, domains, startingEvasion, startingHitPoints })),
    ancestries: [...pack.ancestries.values()].map(({ id, name }) => ({ id, name })),
    communities: [...pack.communities.values()].map(({ id, name }) => ({ id, name })),
    subclasses: [...pack.subclasses.values()].map(({ id, name, classId, domains, spellcastTrait }) => ({ id, name, classId, domains, ...(spellcastTrait === undefined ? {} : { spellcastTrait }) })),
    cards: [...pack.cards.values()].map(({ id, name, grant, domain, type, level, recallCost, text, features }) => ({ id, name, grant, text, features, ...(domain === undefined ? {} : { domain }), ...(type === undefined ? {} : { type }), ...(level === undefined ? {} : { level }), ...(recallCost === undefined ? {} : { recallCost }) })),
  };
}

/** Everything a project is played over, as the Rust reads it. */
export function shippedContent() {
  return {
    characters: contentJson(DEMO_CHARACTERS),
    adversaries: [...DEMO_ADVERSARIES.values()],
    abilities: STARTER_ABILITIES,
    conditions: [...STARTER_CONDITIONS, ...SRD_CONDITIONS],
    items: EQUIPMENT.items,
  };
}
