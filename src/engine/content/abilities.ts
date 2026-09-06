/**
 * Abilities: what a character can *do*, as data.
 *
 * A domain card, a class's Hope feature, a subclass card's feature — each is a
 * name, some SRD text, and, when the engine can run it, a script in the one
 * effect vocabulary plus what it costs and who it can be aimed at. The text is
 * always shown; the script is what makes a button of it. A card with no script
 * is still a card: its holder reads it and the table adjudicates, as at a real
 * one.
 *
 * Abilities are project content, like items and quests, so a campaign can add
 * its own and an editor can list, validate and edit them. The engine ships a
 * library for the SRD's cards (`srd/abilities.ts`), which a project includes
 * as it includes the SRD's weapons.
 */

import { z } from 'zod';
import type { DerivedCharacter } from '../character/sheet';
import { subclassStage } from '../character/progression';
import { contentIdSchema } from '../scene/primitives';
import { conditionSchema, effectSchema, rangeBandSchema } from '../script/schema';

/** How many domain cards can be active at once. The rest wait in the vault. */
export const LOADOUT_LIMIT = 5;

/** "Each class has a unique Hope Feature … You can spend 3 Hope to activate." */
export const HOPE_FEATURE_COST = 3;

export const abilitySourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('domainCard'), card: contentIdSchema }),
  z.object({ kind: z.literal('classHope'), classId: contentIdSchema }),
  z.object({ kind: z.literal('classFeature'), classId: contentIdSchema }),
  z.object({
    kind: z.literal('subclass'),
    subclassId: contentIdSchema,
    stage: z.enum(['foundation', 'specialization', 'mastery']),
  }),
  /** A project's own, given to a character by id. */
  z.object({ kind: z.literal('granted'), characters: z.array(contentIdSchema) }),
]);

export const abilityTargetSchema = z.object({
  /**
   * What the player picks when using it. `none` needs no pick; `self` is the
   * actor; `creature` is anyone. A `group` is every adversary within Very
   * Close range of a chosen point — the SRD's group — picked as one of them.
   */
  kind: z.enum(['none', 'self', 'adversary', 'ally', 'creature', 'group']).default('none'),
  /** The furthest the pick may be from the actor. */
  range: rangeBandSchema.default('melee'),
});

export const abilityUsesSchema = z.object({
  count: z.number().int().positive().default(1),
  /** What refreshes it: a short rest, a long rest only, or the fight ending. */
  per: z.enum(['rest', 'longRest', 'scene']),
});

/**
 * A static bonus the ability grants while held — "+1 to your Evasion". `when`
 * gates it on a condition read against the holder, for "while wearing armor"
 * or "while Vulnerable"; `stat` names what it moves.
 */
export const abilityModifierSchema = z.object({
  stat: z.enum(['evasion', 'armorScore', 'majorThreshold', 'severeThreshold', 'attackRoll', 'damageRoll', 'spellcastRoll', 'proficiency']),
  bonus: z.number().int(),
  when: conditionSchema.optional(),
});

export const abilitySchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  source: abilitySourceSchema,
  /** The rules text, as printed. Shown whether or not there is a script. */
  text: z.string().default(''),
  /**
   * `action`: used on the character's turn. `reaction`: fires when its
   * `trigger` happens. `passive`: its `modifiers` apply while held.
   */
  kind: z.enum(['action', 'reaction', 'passive']).default('action'),
  /** What a reaction answers. */
  trigger: z.enum(['incomingDamage', 'attackHit', 'attackMissed']).optional(),
  cost: z.object({ hope: z.number().int().min(0).optional(), stress: z.number().int().min(0).optional() }).default({}),
  uses: abilityUsesSchema.optional(),
  target: abilityTargetSchema.default({ kind: 'none', range: 'melee' }),
  /** When it can be used at all, beyond cost and uses, read against the actor. */
  available: conditionSchema.optional(),
  /** Only in a fight. Off for anything that reads as a rest or a chat. */
  inCombatOnly: z.boolean().default(false),
  /**
   * Whether using it is the character's action in a fight. A Hope feature
   * like "clear 2 Armor Slots" is not; a spell that rolls is.
   */
  action: z.boolean().default(true),
  get effects() {
    return z.array(effectSchema).default([]);
  },
  modifiers: z.array(abilityModifierSchema).default([]),
});

export type AbilityDef = z.infer<typeof abilitySchema>;
export type AbilitySource = z.infer<typeof abilitySourceSchema>;
export type AbilityTarget = z.infer<typeof abilityTargetSchema>;
export type AbilityModifier = z.infer<typeof abilityModifierSchema>;

/** Whether an ability has a script the engine can run, or is text only. */
export function isScripted(ability: AbilityDef): boolean {
  return ability.effects.length > 0 || ability.modifiers.length > 0;
}

/**
 * The domain cards a character has active: the sheet's `loadout` when it has
 * one, else the first five held. Cards no longer held are dropped, so a sheet
 * that traded a card away does not keep casting from it.
 */
export function loadoutOf(character: DerivedCharacter): string[] {
  const held = character.cards.map((card) => card.id);
  const chosen = character.sheet.loadout;
  if (chosen === undefined) return held.slice(0, LOADOUT_LIMIT);
  return chosen.filter((id) => held.includes(id)).slice(0, LOADOUT_LIMIT);
}

/** The held cards not in the loadout. */
export function vaultOf(character: DerivedCharacter): string[] {
  const active = new Set(loadoutOf(character));
  return character.cards.map((card) => card.id).filter((id) => !active.has(id));
}

/**
 * Every ability a character has right now, in the order a sheet would list
 * them: the class's, the subclass's up to the stage reached, then the active
 * domain cards in loadout order.
 */
export function abilitiesFor(character: DerivedCharacter, abilities: readonly AbilityDef[]): AbilityDef[] {
  const sheet = character.sheet;
  const loadout = loadoutOf(character);
  const stages: Record<'foundation' | 'specialization' | 'mastery', number> = { foundation: 0, specialization: 1, mastery: 2 };
  const reached = stages[subclassStage(sheet)];

  const has = (ability: AbilityDef): boolean => {
    const source = ability.source;
    switch (source.kind) {
      case 'domainCard':
        return loadout.includes(source.card);
      case 'classHope':
      case 'classFeature':
        return source.classId === sheet.classId;
      case 'subclass':
        return source.subclassId === sheet.subclassId && stages[source.stage] <= reached;
      case 'granted':
        return source.characters.includes(sheet.id);
    }
  };
  const order = (ability: AbilityDef): number => {
    const source = ability.source;
    if (source.kind === 'classFeature') return 0;
    if (source.kind === 'classHope') return 1;
    if (source.kind === 'subclass') return 2 + stages[source.stage];
    if (source.kind === 'domainCard') return 10 + loadout.indexOf(source.card);
    return 100;
  };
  return abilities
    .filter(has)
    .map((ability, index) => ({ ability, index }))
    .sort((a, b) => order(a.ability) - order(b.ability) || a.index - b.index)
    .map(({ ability }) => ability);
}
