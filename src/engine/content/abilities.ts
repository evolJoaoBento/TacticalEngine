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
import { contentIdSchema, traitSchema } from '../scene/primitives';
import { conditionSchema, effectSchema, rangeBandSchema, walkEffects, type Effect, type TargetSelector } from '../script/schema';

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
  /** A stat block's feature, by the adversary ids that have it. */
  z.object({ kind: z.literal('adversary'), adversaries: z.array(contentIdSchema) }),
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
 * A bonus the ability grants while held — "+1 to your Evasion", "+2 to your
 * damage thresholds while wearing armor", "add your Strength to damage with a
 * Melee weapon". `bonus` is flat; `plusTrait` adds a trait's value on top;
 * `requires` reads the sheet (armor on or off, the weapon's reach) and `when`
 * reads the scene (a condition on the holder, a fight on) — the first is
 * folded into the derived numbers, the second checked when the roll is made.
 *
 * `bareBones` is the one card that rewrites the base rather than adding to
 * it: unarmored, Armor Score 3 + Strength and thresholds by tier.
 */
/**
 * Tokens a card carries.
 *
 * A dozen SRD cards work this way: "place a number of tokens equal to your
 * Spellcast trait on this card", spent later for what the card does. The count
 * is a number or a trait, because the cards say both, and `refill` is when the
 * pile comes back.
 */
export const abilityTokensSchema = z.object({
  /** How many arrive: a number, or the trait to read off the sheet. */
  amount: z.union([z.number().int().min(0), traitSchema, z.literal('spellcast')]),
  /** At least this many, whatever the trait says — "(minimum 1)". */
  minimum: z.number().int().min(0).default(0),
  /**
   * When the pile is replenished. A `session` card refills on a long rest,
   * which is where a session boundary falls in play; `never` is placed once
   * and never again.
   */
  refill: z.enum(['session', 'longRest', 'rest', 'scene', 'never']).default('longRest'),
});

export const abilityModifierSchema = z.object({
  stat: z.enum([
    'evasion',
    'armorScore',
    'majorThreshold',
    'severeThreshold',
    'thresholds',
    'attackRoll',
    'damageRoll',
    'spellcastRoll',
    'proficiency',
    'hitPoints',
    'stress',
    'bareBones',
    /**
     * Advantage dice, as a signed count: `+1` is "they have advantage", `-1`
     * is "…disadvantage". They cancel one for one and never stack past a
     * single die, which the roll itself sees to; this only says which way the
     * scales tip.
     */
    'advantage',
  ]),
  bonus: z.number().int().default(0),
  plusTrait: traitSchema.optional(),
  /**
   * Add the holder's Proficiency as well - Rise Up's "gain a bonus to your
   * Severe threshold equal to your Proficiency". A stat block has none, and
   * reads it as one.
   */
  plusProficiency: z.boolean().optional(),
  /**
   * Multiply the whole bonus by the tokens sitting on a card - "gain a +5
   * bonus to your damage roll for each token on this card".
   *
   * Tokens are scene state rather than sheet state, so a modifier written this
   * way is never folded into a derived character: it is read where it is used,
   * every time, and reads zero the moment the card is empty. With a `when` as
   * well it is the bonus times the tokens while that holds, and nothing while
   * it does not: the two are read in that order.
   */
  perToken: contentIdSchema.optional(),
  requires: z.enum(['unarmored', 'armored', 'meleeWeapon']).optional(),
  when: conditionSchema.optional(),
  /**
   * Whether this reads on rolls made *against* the one holding it rather than
   * on their own: "creatures within Melee range of the Gaoler have
   * disadvantage on attack rolls against them".
   *
   * A two-party rule, and only that. "Disadvantage on attacks against targets
   * other than the Swarm" and "attacks against a creature this one stands next
   * to have advantage" are about a third creature, and stay text.
   */
  against: z.boolean().optional(),
})
  // The flag exists for the dice and nothing else. "+2 to their Difficulty" is
  // an `evasion` bonus on the creature itself; a modifier that tried to say
  // "attacks against me are made at +2" would otherwise be folded into the
  // holder's own numbers, where a derived character sums by stat.
  .refine((m) => m.against !== true || m.stat === 'advantage', {
    message: 'against reads only on advantage',
  });

/**
 * What a reaction to incoming damage does, once its cost is paid. Applied in
 * the order the holder lists them, automatically when they would lower the
 * Hit Points marked; `only` narrows it to a severity, as "when you take
 * Severe damage" asks.
 */
export const damageReactionSchema = z.discriminatedUnion('kind', [
  /** Step the severity down: Severe to Major, Major to Minor, Minor to none. */
  z.object({ kind: z.literal('reduceSeverity'), steps: z.number().int().positive().default(1), only: z.enum(['severe', 'major', 'minor']).optional() }),
  /** Roll dice off the damage before thresholds — Rune Ward's d8. */
  z.object({ kind: z.literal('reduceDamage'), dice: z.string().min(1) }),
  /** Mark more Armor Slots than the one — Iron Will's extra slot. */
  z.object({ kind: z.literal('extraArmor'), slots: z.number().int().positive().default(1), only: z.enum(['physical', 'magic']).optional() }),
  /**
   * Stand in the way: the attack lands on the holder instead of the ally it
   * was aimed at — I Am Your Shield. Never automatic; it is asked.
   */
  z.object({ kind: z.literal('redirect') }),
  /**
   * Make the attacker roll again — Not This Time's "force an adversary to
   * reroll an attack or damage roll". `what` says which rolls are on offer.
   */
  z.object({ kind: z.literal('reroll'), what: z.enum(['attack', 'damage', 'either']).default('either') }),
]);

/**
 * What holding this does to damage coming in: "the Warrior is resistant to
 * physical damage", "immune to magic while Dazed".
 *
 * Halving rounds up, and damage of two types is only halved by a creature that
 * resists both — which is what Arcane Steel ("considered both physical and
 * magic") exists to defeat. The rule is in `rules/damage.ts`; this is where a
 * creature says it has it.
 */
export const damageDefensesSchema = z.object({
  resistances: z.array(z.enum(['physical', 'magic'])).optional(),
  immunities: z.array(z.enum(['physical', 'magic'])).optional(),
  /**
   * What comes off the total before thresholds: "reduce it by 3", "reduce it
   * by 1d10". `only` names a damage type; without one it answers every kind.
   */
  reduce: z
    .array(z.object({ dice: z.string().min(1), only: z.enum(['physical', 'magic']).optional() }))
    .optional(),
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
  /**
   * What a reaction answers. The first four are things that happen *to* the
   * holder or near them; `dealtHit` and `dealtDamage` are the other side of
   * the table — what the holder's own standard attack did, which is how a
   * stat block says "targets who mark HP from the Zombie's attacks must also
   * mark a Stress". `dealtHit` fires on a hit however it is answered;
   * `dealtDamage` only when a Hit Point was actually marked. `spotlighted` is
   * the turn itself arriving: "when the Hunter is in the spotlight for the
   * first time", where "the first time" is a `uses` of one.
   *
   * `tookDamage`, `tookHitPoints` and `tookSevere` are the same blow read
   * three ways - "when the Knight takes damage from an attack", "when the
   * Zombies mark HP from an attack", "when the Burrower takes Severe damage" -
   * and all three run with whoever dealt it bound as the target, because most
   * of them hit back. `defeated` is the last of them: "when the Realm-Breaker
   * marks their last HP", which fires once, as they fall, before anybody says
   * the fight is over.
   */
  trigger: z
    .enum([
      'incomingDamage',
      'attackHit',
      'attackMissed',
      'tookDamage',
      'tookHitPoints',
      'tookSevere',
      'defeated',
      'dealtHit',
      'dealtDamage',
      /**
       * An attack was made at the holder, however it went. "This bonus lasts
       * until after the next attack made against you" - which a miss ends as
       * surely as a hit, so this is raised by both.
       */
      'attacked',
      /**
       * A party member made an action roll: "when a PC rolls a failure with
       * Fear while within Close range of the Demon". The one who rolled is
       * bound as the target, and what the roll was is a `rolled` condition.
       */
      'partyRolled',
      'spotlighted',
    ])
    .optional(),
  /**
   * What using it costs its holder. `fear` is the GM's pool, so it belongs to
   * a stat block's features — "Spend a Fear to…" is written on adversaries,
   * never on a card; a character ability that states one is refused, because
   * nobody at the player's end of the table has a Fear to spend.
   */
  cost: z
    .object({
      hope: z.number().int().min(0).optional(),
      stress: z.number().int().min(0).optional(),
      fear: z.number().int().min(0).optional(),
    })
    .default({}),
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
  /** For a `passive`: what holding it does to damage coming in. */
  defenses: damageDefensesSchema.optional(),
  /**
   * For a `passive`: what holding it does to the creature's own standard
   * attack — the swing its stat block prints, not a feature's. "The Ogre's
   * attacks deal direct damage", "if the Sniper is Hidden… they deal 1d10+4
   * physical damage instead of their standard damage", "the Demon deals
   * double damage to PCs with 0 Hope".
   *
   * `when` is read from the attacker's chair with the target bound, so a
   * condition on either of them is a plain `hasCondition`. Without one it
   * always applies, which is what the older `direct` passives meant.
   */
  standardAttack: z
    .object({
      direct: z.boolean().optional(),
      /** Dice instead of the block's printed damage: "1d10+4 physical damage instead". */
      damage: z.string().min(1).optional(),
      /** Twice whatever was rolled — "the Archer deals double damage to…". */
      double: z.boolean().optional(),
      when: conditionSchema.optional(),
    })
    .optional(),
  /** For a reaction to incoming damage: what it does. */
  reaction: damageReactionSchema.optional(),
  /** Tokens the card holds, if it is one of the cards that holds them. */
  tokens: abilityTokensSchema.optional(),
  /**
   * How a reaction is used: automatically whenever it helps, or never unless a
   * prompt asks. Automatic is the CRPG's default; a prompt is a later step.
   */
  auto: z.boolean().default(true),
});

/** Reactions the defence step may use on its own: it never spends an interrupt. */
export function isAutomatic(ability: AbilityDef): boolean {
  const reaction = ability.reaction;
  if (reaction === undefined || !ability.auto) return false;
  return reaction.kind !== 'redirect' && reaction.kind !== 'reroll';
}

export type AbilityDef = z.infer<typeof abilitySchema>;
export type AbilitySource = z.infer<typeof abilitySourceSchema>;
export type AbilityTarget = z.infer<typeof abilityTargetSchema>;
export type AbilityModifier = z.infer<typeof abilityModifierSchema>;
export type DamageReaction = z.infer<typeof damageReactionSchema>;
export type AbilityDefenses = z.infer<typeof damageDefensesSchema>;

/**
 * Whether anything in a script reads "the one that was picked".
 *
 * A card asks its holder for that pick; a stat block's feature is aimed by
 * whoever plays the block, which on this side is the GM's turn — so it has to
 * know whether a feature wants a creature named or simply goes off around the
 * adversary.
 */
export function readsATarget(effects: readonly Effect[]): boolean {
  let found = false;
  const reads = (selector: TargetSelector | undefined): void => {
    if (selector === undefined) return;
    if (selector.kind === 'target') found = true;
    if (selector.kind === 'adversaries' && (selector.around === 'target' || selector.except === 'target')) found = true;
  };
  // The effects whose `target` defaults to the pick when it is left out, so
  // "make an attack" with nothing said about who is still aimed at someone.
  const aimedByDefault = ['attack', 'applyCondition', 'clearCondition', 'push', 'markArmor'];
  walkEffects(effects, (effect) => {
    const withTarget = effect as { target?: TargetSelector; targets?: TargetSelector };
    reads(withTarget.target);
    reads(withTarget.targets);
    if (withTarget.target === undefined && aimedByDefault.includes(effect.kind)) found = true;
    if (effect.kind === 'check') {
      reads(effect.check.targets);
      // "Against each target's own Difficulty" with no list of its own is the
      // chosen target's, so the script has to be aimed at someone.
      if (effect.check.difficulty === 'target' && effect.check.targets === undefined) found = true;
    }
  });
  return found;
}

/** Whether an ability has a script the engine can run, or is text only. */
export function isScripted(ability: AbilityDef): boolean {
  return (
    ability.effects.length > 0 ||
    ability.modifiers.length > 0 ||
    ability.reaction !== undefined ||
    ability.defenses !== undefined
  );
}

/**
 * The domain cards a character has active: the sheet's `loadout` when it has
 * one, else the first five held. Cards no longer held are dropped, so a sheet
 * that traded a card away does not keep casting from it.
 */
export function loadoutOf(character: Pick<DerivedCharacter, 'sheet' | 'cards'>): string[] {
  const held = character.cards.map((card) => card.id);
  const chosen = character.sheet.loadout;
  if (chosen === undefined) return held.slice(0, LOADOUT_LIMIT);
  return chosen.filter((id) => held.includes(id)).slice(0, LOADOUT_LIMIT);
}

/** The held cards not in the loadout. */
export function vaultOf(character: Pick<DerivedCharacter, 'sheet' | 'cards'>): string[] {
  const active = new Set(loadoutOf(character));
  return character.cards.map((card) => card.id).filter((id) => !active.has(id));
}

/**
 * Every ability a character has right now, in the order a sheet would list
 * them: the class's, the subclass's up to the stage reached, then the active
 * domain cards in loadout order.
 */
export function abilitiesFor(character: Pick<DerivedCharacter, 'sheet' | 'cards'>, abilities: readonly AbilityDef[]): AbilityDef[] {
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
      // An adversary's feature is never a character's.
      case 'adversary':
        return false;
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
