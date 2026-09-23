/**
 * What is wrong with a project, in terms a designer can act on.
 *
 * The schema already rejects a malformed document, but "valid" and "playable" are
 * different questions. A scene can parse perfectly and still refer to an adversary
 * nobody defined, place a spawn inside a wall, or carry an encounter that nothing
 * can ever trigger. Those are the mistakes that cost an afternoon of playtesting,
 * and they are all findable statically.
 *
 * Everything here is a *report*, never a throw: the editor should show a list of
 * problems and let the work continue, not refuse to open the file.
 */

import { checkJumpRules } from './validate-jump';
import { NO_TILE } from '../engine/grid/grid';
import { Pathfinder } from '../engine/grid/pathfinding';
import { danglingLinks, unreachableNodes } from '../engine/dialogue/dialogue';
import {
  walkCheck,
  walkCondition,
  walkConditionsIn,
  walkConditionsInCheck,
  walkEffects,
  type Condition,
  type Effect,
  type TargetSelector,
} from '../engine/script/schema';
import { gridFromScene, paletteForProject, tileOf } from '../engine/scene/grid-from-scene';
import { deriveCharacter } from '../engine/character/sheet';
import { MAX_LEVEL, domainsOf, heldCards } from '../engine/character/progression';
import { isDomainCard, type CardDef, type ContentPack } from '../engine/content/pack/import';
import { cardOf, isStatBlockFeature, type AbilityDef } from '../engine/content/abilities';
import { parseDice } from '../engine/rules/dice';
import { compileHooks } from '../engine/script/hooks';
import { projectSchema, type ProjectDoc, type SceneDoc } from '../engine/scene/schema';
import { containerItems, findFunction, interactablesOf, pairsOf, portalsWith } from '../engine/scene/prop-functions';

export type ProblemSeverity =
  /** The project will not run, or something is unreachable at runtime. */
  | 'error'
  /** It will run, but almost certainly not as intended. */
  | 'warning';

export interface Problem {
  severity: ProblemSeverity;
  /** Scene the problem is in, when it belongs to one. */
  scene?: string;
  /** The content it concerns, for a click-to-select list. */
  entity?: string;
  message: string;
}

export interface ValidationOptions {
  /** Adversary ids the project can resolve. Omit to skip the check. */
  knownAdversaries?: ReadonlySet<string>;
  /** Model ids the renderer can resolve. Omit to skip the check. */
  knownModels?: ReadonlySet<string>;
  /** Hooks the engine registers natively, so content may name them without carrying code. */
  knownHooks?: ReadonlySet<string>;
  /** Conditions the engine ships, which a project inherits without writing them down. */
  knownConditions?: ReadonlySet<string>;
  /**
   * The SRD content a sheet's ids are checked against. Omit to skip the party
   * check — a headless caller that has not loaded the content is not wrong.
   */
  characterContent?: ContentPack;
}

/**
 * Check a project.
 *
 * The schema runs first: if the document does not parse, its issues are the only
 * ones worth reporting, because everything below assumes a well-formed scene.
 */
export function validateProject(
  project: ProjectDoc,
  options: ValidationOptions = {},
): Problem[] {
  const parsed = projectSchema.safeParse(project);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      severity: 'error' as const,
      message: `${issue.path.join('.') || 'project'}: ${issue.message}`,
    }));
  }

  const problems: Problem[] = [];
  const palette = paletteForProject(project);
  const sceneIds = new Set(project.scenes.map((s) => s.id));

  for (const scene of project.scenes) {
    validateScene(scene, { project, sceneIds, palette, options }, problems);
  }
  checkLootTables(project, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkDialogues(project, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkQuests(project, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkItemUses(project, options, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkAbilitiesAndCode(project, options, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkCardGrants(project, options, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkParty(project, options, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkAdversaryModels(project, options, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkEmbeddedAssets(project, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
  checkJumpRules(project, options.knownConditions, (severity, message) => problems.push({ severity, message }));
  return problems;
}

/** The SRD's starting spread, which a homebrew party may depart from. */
const STARTING_TRAITS = [-1, 0, 0, 1, 1, 2];

/**
 * The party.
 *
 * `deriveCharacter` already reports an id that does not resolve — it is the
 * same check the game makes when it builds a character — so this hands its
 * issues on rather than repeating them, and adds the two things a sheet can
 * get wrong that deriving does not mind: a loadout naming a card the character
 * does not hold, and a trait spread that is not the one the SRD deals.
 */
/**
 * What a project's own card says grants it. A grant naming a class, a subclass, an ancestry, a
 * community, a character or a stat block that nothing defines hands the card to nobody, and says
 * nothing while it does -- so Check says it instead.
 */
function checkCardGrants(
  project: ProjectDoc,
  options: ValidationOptions,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  const content = options.characterContent;
  // What a grant can name: the project's own, and the content it is checked against. Without that
  // content there is nothing to check a class against, and nothing is said.
  const defined = (own: readonly { id: string }[], packed: ReadonlyMap<string, unknown> | undefined) =>
    packed === undefined ? null : new Set([...own.map((entry) => entry.id), ...packed.keys()]);
  const named = {
    class: defined(project.classes, content?.classes),
    subclass: defined(project.subclasses, content?.subclasses),
    ancestry: defined(project.ancestries, content?.ancestries),
    community: defined(project.communities, content?.communities),
  };
  // A project with no party of its own plays somebody else's, which this cannot see.
  const party = project.party.length === 0 ? null : new Set(project.party.map((sheet) => sheet.id));
  // The conditions there are: the project's and the engine's, once the caller says what the engine's are.
  const conditions =
    options.knownConditions === undefined ? null : new Set([...project.conditionDefs.map((c) => c.id), ...options.knownConditions]);
  // What a chosen card has to be in for anybody to take it: a domain some class or subclass opens.
  const opened =
    content === undefined
      ? null
      : new Set(
          [...project.classes, ...content.classes.values(), ...project.subclasses, ...content.subclasses.values()].flatMap(
            (def) => def.domains,
          ),
        );
  for (const card of project.cards) {
    const grant = card.grant;
    const nothing = (what: keyof typeof named, id: string): void => {
      if (named[what] !== null && !named[what].has(id)) {
        add('warning', `Card "${card.id}" is granted by ${what} "${id}", which nothing defines: nobody holds it.`, card.id);
      }
    };
    switch (grant.kind) {
      case 'chosen':
        // A held card outside its holder's domains is the party's warning; this one is the card's own,
        // held or not.
        if (card.domain !== undefined && opened !== null && !opened.has(card.domain)) {
          add('warning', `Card "${card.id}" is a ${card.domain} card, a domain no class opens: nobody can take it.`, card.id);
        }
        if (card.level !== undefined && card.level > MAX_LEVEL) {
          add('warning', `Card "${card.id}" is level ${card.level}, past the last level there is (${MAX_LEVEL}): nobody reaches it.`, card.id);
        }
        break;
      case 'class':
        nothing('class', grant.classId);
        break;
      case 'subclass':
        nothing('subclass', grant.subclassId);
        break;
      case 'ancestry':
        nothing('ancestry', grant.ancestryId);
        break;
      case 'community':
        nothing('community', grant.communityId);
        break;
      case 'given':
        if (grant.characters.length === 0) add('warning', `Card "${card.id}" is given to nobody yet.`, card.id);
        for (const id of grant.characters) {
          if (party !== null && !party.has(id)) add('warning', `Card "${card.id}" is given to "${id}", who is not in the party.`, card.id);
        }
        break;
      case 'adversary':
        if (grant.adversaries.length === 0) add('warning', `Card "${card.id}" is printed on no stat block yet.`, card.id);
        for (const id of grant.adversaries) {
          if (options.knownAdversaries !== undefined && !options.knownAdversaries.has(id)) {
            add('warning', `Card "${card.id}" is printed on "${id}", which is not an adversary.`, card.id);
          }
        }
        break;
      case 'condition':
        if (grant.conditions.length === 0) add('warning', `Card "${card.id}" is lent by no condition yet.`, card.id);
        for (const id of grant.conditions) {
          if (conditions !== null && !conditions.has(id)) {
            add('warning', `Card "${card.id}" is lent by condition "${id}", which nothing defines: nobody holds it.`, card.id);
          }
        }
        break;
    }
  }
}

function checkParty(
  project: ProjectDoc,
  options: ValidationOptions,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  const content = options.characterContent;
  if (content === undefined) return;
  for (const sheet of project.party) {
    const who = sheet.name || sheet.id;
    for (const issue of deriveCharacter(sheet, content, project.abilities).issues) {
      add('error', `${who}: ${issue.field} — ${issue.message}`, sheet.id);
    }
    const held = new Set(heldCards(sheet));
    for (const card of sheet.loadout ?? []) {
      if (!held.has(card)) {
        add('warning', `${who} has "${card}" in their loadout but does not hold it.`, sheet.id);
      }
    }
    // A card from outside their domains: a hand-written sheet, or a class
    // changed in the panel before the cards were. The panel's list cannot
    // show it, so the validator has to.
    const domains = domainsOf(sheet, content);
    for (const card of held) {
      const def = content.cards.get(card);
      if (def !== undefined && isDomainCard(def) && !domains.includes(def.domain)) {
        add('warning', `${who} holds "${def.name}", a ${def.domain} card outside their domains.`, sheet.id);
      }
    }
    const spread = Object.values(sheet.traits).sort((a, b) => a - b);
    if (spread.join() !== STARTING_TRAITS.join() && (sheet.levels ?? []).length === 0) {
      add('warning', `${who}'s traits are not the SRD's starting spread (-1, 0, 0, +1, +1, +2).`, sheet.id);
    }
  }
}

/**
 * The project's own logic: cards, conditions and code.
 *
 * A card that names a hook nobody defines runs into a refusal at the table,
 * where it is far too late; the same goes for a condition it applies that has
 * no definition. Code that will not compile is reported with the message the
 * engine gave, because that is the only place a designer sees it.
 */
function checkAbilitiesAndCode(
  project: ProjectDoc,
  options: ValidationOptions,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  const hooks = new Set<string>([...(options.knownHooks ?? []), ...project.code.map((c) => c.id)]);
  // The engine's own conditions are there whether or not a project writes
  // them down, so applying Vulnerable is not a mistake.
  const conditionIds = new Set([
    ...project.conditionDefs.map((c) => c.id),
    ...(options.knownConditions ?? []),
  ]);
  for (const issue of compileHooks(project.code).issues) {
    add('error', `Code "${issue.id}" does not compile: ${issue.message}`, issue.id);
  }
  for (const entry of project.code) {
    if (entry.source.trim() === '') add('warning', `Code "${entry.id}" is empty.`, entry.id);
  }
  const used = new Set<string>();
  const inspect = (owner: string) => (effect: Effect): void => {
    if (effect.kind === 'run') {
      used.add(effect.hook);
      if (!hooks.has(effect.hook)) {
        add('error', `"${owner}" runs hook "${effect.hook}", which nothing defines.`, owner);
      }
    }
    if (effect.kind === 'applyCondition' && !conditionIds.has(effect.condition)) {
      add('warning', `"${owner}" applies condition "${effect.condition}", which the project does not define.`, owner);
    }
  };
  const asked = (owner: string) => (condition: Condition): void => {
    if (condition.kind !== 'hook') return;
    used.add(condition.hook);
    if (!hooks.has(condition.hook)) {
      add('error', `"${owner}" asks hook "${condition.hook}", which nothing defines.`, owner);
    }
  };
  const inspectCondition = (owner: string, condition: Condition | undefined): void => {
    if (condition !== undefined) walkCondition(condition, asked(owner));
  };
  // How a card came to be in play, from the pack the editor was given (which already has the
  // project's own cards laid over it) or else from the project alone. `undefined` when neither
  // knows the card: a validator handed no pack cannot tell, and says nothing rather than guess.
  const knownCards = new Map<string, Pick<CardDef, 'grant'>>([
    ...project.cards.map((card) => [card.id, card] as const),
    ...(options.characterContent?.cards ?? []),
  ]);
  const cardNamed = (id: string) => knownCards.get(id);
  const grantOf = (ability: AbilityDef): string | undefined => cardNamed(cardOf(ability))?.grant.kind;
  for (const ability of project.abilities) {
    // An ability is in play when its card is. One on a card nothing defines is never anybody's,
    // which is a silent way for a card to stop working -- say so while it is being written.
    const on = cardOf(ability);
    if (options.characterContent !== undefined && cardNamed(on) === undefined) {
      add('warning', `"${ability.id}" sits on card "${on}", which neither the project nor its pack defines: it is never in play.`, ability.id);
    }
    // Shadow is the GM's pool. A card that asks its holder for one is a card
    // nobody can ever use — play refuses it — so say so while it is being
    // written rather than when someone reaches for it.
    if ((ability.cost.bad ?? 0) > 0 && !isStatBlockFeature(ability, knownCards)) {
      add('warning', `"${ability.id}" costs Shadow, which only the GM spends: nobody holding it can use it.`, ability.id);
    }
    // A summons names a stat block; one nothing ships is a feature that does
    // nothing when the GM reaches for it.
    walkEffects(ability.effects, (effect) => {
      if (effect.kind !== 'summon') return;
      const known = options.knownAdversaries;
      if (known !== undefined && !known.has(effect.adversary)) {
        add('error', `"${ability.id}" summons "${effect.adversary}", which is not an adversary.`, ability.id);
      }
      if (effect.count !== undefined && parseDice(effect.count) === null) {
        add('error', `"${ability.id}" summons "${effect.count}" of them, which is not dice.`, ability.id);
      }
    });
    // A creature is replaced by another off a stat block; one nothing ships
    // takes the first off the map and puts nothing in its place.
    walkEffects(ability.effects, (effect) => {
      if (effect.kind !== 'replace') return;
      const known = options.knownAdversaries;
      if (known !== undefined && !known.has(effect.adversary)) {
        add('error', `"${ability.id}" replaces them with "${effect.adversary}", which is not an adversary.`, ability.id);
      }
      if (effect.count !== undefined && parseDice(effect.count) === null) {
        add('error', `"${ability.id}" replaces them with "${effect.count}" of them, which is not dice.`, ability.id);
      }
      if (!isStatBlockFeature(ability, knownCards)) {
        add('warning', `"${ability.id}" replaces the creature using it, which only the GM does.`, ability.id);
      }
    });
    // Handing the GM's turn to its own side is the GM's move: a card in a
    // player's hand has no turn to hand out, and play would refuse it.
    walkEffects(ability.effects, (effect) => {
      if (effect.kind !== 'spotlight') return;
      if (!isStatBlockFeature(ability, knownCards)) {
        add('warning', `"${ability.id}" spotlights allies, which only the GM does.`, ability.id);
      }
      if (effect.count !== undefined && parseDice(effect.count) === null) {
        add('error', `"${ability.id}" spotlights "${effect.count}" of them, which is not dice.`, ability.id);
      }
    });
    // A clock that cannot be read never starts, and one counting towards
    // nothing is a clock the table watches for no reason.
    walkEffects(ability.effects, (effect) => {
      if (effect.kind !== 'countdown') return;
      const expression = parseDice(effect.start);
      if (expression === null) {
        add('error', `"${ability.id}" starts a countdown at "${effect.start}", which is not dice.`, ability.id);
      } else if (expression.count === 0 && expression.modifier <= 0) {
        add('error', `"${ability.id}" starts a countdown at "${effect.start}", which has already run out.`, ability.id);
      }
      if (effect.effects.length === 0) {
        add('warning', `"${ability.id}" starts a countdown that does nothing when it triggers.`, ability.id);
      }
      // "When they mark HP, tick down this countdown by the number of HP
      // marked" is read against the creature that armed it, so a card in a
      // player's hand has nobody to read it against.
      if (effect.advance === 'hpMarked' && !isStatBlockFeature(ability, knownCards)) {
        add('warning', `"${ability.id}" counts the Hit Points its owner marks, which only a stat block has.`, ability.id);
      }
    });
    // "Reduce it by three" is not a number: the reduction is a dice expression
    // and an unreadable one silently reduces nothing.
    for (const entry of ability.defenses?.reduce ?? []) {
      const expression = parseDice(entry.dice);
      if (expression === null) {
        add('error', `"${ability.id}" reduces damage by "${entry.dice}", which is not dice.`, ability.id);
      } else if (expression.modifier < 0) {
        // "1d10-2" would hand the attacker two damage back.
        add('error', `"${ability.id}" reduces damage by "${entry.dice}", which adds damage.`, ability.id);
      }
    }
    // The swing a stat block prints, and the two triggers that answer it, are
    // read on the GM's turn alone. On a card they are quietly dead.
    if (ability.standardAttack !== undefined && !isStatBlockFeature(ability, knownCards)) {
      add(
        'warning',
        `"${ability.id}" changes a standard attack, which only a stat block has.`,
        ability.id,
      );
    }
    // Two of the triggers are raised on the GM's turn and nowhere else: a
    // creature taking the spotlight, and somebody else's blow stopping to be
    // counted. On a card they are quietly dead. `rollingDamage` is not one of
    // them any more: a card answers its holder's own swing at that moment too.
    if (
      !isStatBlockFeature(ability, knownCards) &&
      (ability.trigger === 'spotlighted' || ability.trigger === 'allyRollingDamage')
    ) {
      add(
        'warning',
        `"${ability.id}" answers ${ability.trigger === 'spotlighted' ? 'a spotlight' : "somebody else's blow being counted"}, which only a stat block is asked about.`,
        ability.id,
      );
    }
    // A number read off a blow needs a blow: an action nobody triggers is run
    // out of nowhere, and every count it asks for reads zero.
    if (ability.trigger === undefined && readsTheBlow(ability)) {
      add(
        'warning',
        `"${ability.id}" reads a number off the blow that called for it, but nothing triggers it.`,
        ability.id,
      );
    }
    // Taking another one is the same rule read the other way: a card has no
    // queue to go back to the head of.
    if (takesAnotherSpotlight(ability) && !isStatBlockFeature(ability, knownCards)) {
      add(
        'warning',
        `"${ability.id}" takes the spotlight again, which only a stat block has to take.`,
        ability.id,
      );
    }
    // A vault is something only a character has. A stat block's feature that
    // said this would spend nothing and go on working every turn.
    if (vaultsItself(ability) && grantOf(ability) !== undefined && grantOf(ability) !== 'chosen') {
      add(
        'warning',
        `"${ability.id}" places itself in the vault, which only a domain card has to go to.`,
        ability.id,
      );
    }
    // Ending a spotlight is something only a spotlight can do: it is read by
    // the GM's turn, on the creature whose turn it is, at the moment the turn
    // begins. Anywhere else it is a silent no-op.
    if (endsASpotlight(ability) && !(isStatBlockFeature(ability, knownCards) && ability.trigger === 'spotlighted')) {
      add(
        'warning',
        `"${ability.id}" ends a spotlight, which only a stat block's ‘when spotlighted’ reaction has.`,
        ability.id,
      );
    }
    // Adding to a blow needs a blow in the air. The two triggers that stop
    // mid-swing are the only place anything is listening.
    if (
      boostsABlow(ability) &&
      ability.trigger !== 'rollingDamage' &&
      ability.trigger !== 'allyRollingDamage'
    ) {
      add(
        'warning',
        `"${ability.id}" adds to a blow, which only a damage roll being counted has.`,
        ability.id,
      );
    }
    // Answering a blow in a script is read at the moment the defender is asked
    // about one, and nowhere else: a card that softens or avoids anywhere else
    // is talking to nobody.
    if (answersABlow(ability) && ability.trigger !== 'incomingDamage') {
      add(
        'warning',
        `"${ability.id}" answers a blow arriving, which only a card asked about incoming damage is.`,
        ability.id,
      );
    }
    // A band named for a blow is read at the same moment a boost is, and
    // nowhere else.
    if (
      namesABand(ability) &&
      ability.trigger !== 'rollingDamage' &&
      ability.trigger !== 'allyRollingDamage'
    ) {
      add(
        'warning',
        `"${ability.id}" names the band a blow lands in, which only a damage roll being counted has.`,
        ability.id,
      );
    }
    // Forcing the Hit Points is narrower still: the swing has to be the
    // holder's own, and the party's swing is the only one that stops to be
    // told what it does.
    if (forcesHitPoints(ability) && ability.trigger !== 'rollingDamage') {
      add(
        'warning',
        `"${ability.id}" forces the Hit Points marked, which only its holder's own damage roll being counted has.`,
        ability.id,
      );
    }
    // The same moment, and the same reason: the faces a blow came up are only
    // there to be read while the blow is being held.
    if (maxesADie(ability) && ability.trigger !== 'rollingDamage') {
      add(
        'warning',
        `"${ability.id}" takes a damage die at its highest, which only its holder's own damage roll being counted has.`,
        ability.id,
      );
    }
    if (namesABand(ability, true) && isStatBlockFeature(ability, knownCards)) {
      add(
        'warning',
        `"${ability.id}" puts a floor under a blow, which only the party's own swing obeys.`,
        ability.id,
      );
    }
    if (forcesHitPoints(ability) && isStatBlockFeature(ability, knownCards)) {
      add(
        'warning',
        `"${ability.id}" forces the Hit Points marked, which only the party's own swing obeys.`,
        ability.id,
      );
    }
    // The other half of the same rule: an ally taking a hit is something the
    // party hears about and a stat block does not.
    if (ability.trigger === 'allyTookDamage' && isStatBlockFeature(ability, knownCards)) {
      add(
        'warning',
        `"${ability.id}" answers somebody on its own side being hurt, which only a card is asked about.`,
        ability.id,
      );
    }
    // `spent` and `{n}` are words only a `howMany` writes into: outside one,
    // the amount reads as zero and the dice keep the braces.
    if (readsAnAnswer(ability.effects)) {
      add(
        'warning',
        `"${ability.id}" reads an answer nobody asked for: 'spent' and "{n}" only mean something inside a "how many" question.`,
        ability.id,
      );
    }
    // An amount reads one creature's pool - the first the selector names - so
    // pointing it at a crowd is asking which of them, and nothing answers.
    for (const crowd of amountsReadingACrowd(ability)) {
      add(
        'warning',
        `"${ability.id}" reads a pool off ${crowd}, which is more than one creature.`,
        ability.id,
      );
    }
    walkEffects(ability.effects, inspect(ability.id));
    walkConditionsIn(ability.effects, asked(ability.id));
    inspectCondition(ability.id, ability.available);
    // "A target with 3 or more bramble tokens" narrows a pick, so it needs a
    // pick to narrow: on a feature aimed at nobody it is read by neither the
    // player's list nor the GM's.
    if (ability.target.when !== undefined && (ability.target.kind === 'none' || ability.target.kind === 'self')) {
      add(
        'warning',
        `"${ability.id}" says what is worth aiming at, but it is aimed at ${ability.target.kind === 'self' ? 'itself' : 'nobody'}.`,
        ability.id,
      );
    }
    inspectCondition(ability.id, ability.target.when);
    for (const modifier of ability.modifiers) inspectCondition(ability.id, modifier.when);
  }
  for (const def of project.conditionDefs) {
    for (const modifier of def.modifiers) inspectCondition(def.id, modifier.when);
  }
  for (const entry of project.code) {
    if (!used.has(entry.id)) add('warning', `Code "${entry.id}" is never run by anything.`, entry.id);
  }
}

/**
 * Whether anything in an ability asks about the blow that called for it - an
 * amount written as `hitPointsTaken`, or a gate comparing it.
 *
 * The other counts are the script's own bookkeeping: how much its damage has
 * marked, how many creatures its last roll beat. An action is free to read
 * those, because it made them itself.
 */
function readsTheBlow(ability: AbilityDef): boolean {
  let reads = false;
  const amount = (effect: Effect): void => {
    if ('amount' in effect && effect.amount === 'hitPointsTaken') reads = true;
  };
  const compares = (condition: Condition): void => {
    if (condition.kind === 'count' && condition.of === 'hitPointsTaken') reads = true;
  };
  walkEffects(ability.effects, amount);
  walkConditionsIn(ability.effects, compares);
  if (ability.available !== undefined) walkCondition(ability.available, compares);
  return reads;
}

/**
 * Whether anything outside a `howMany` says `spent` or `{n}`.
 *
 * Asked of one effect at a time and of its own fields only: a `howMany` holds
 * the answers it wrote, and reading its children as its own would accuse every
 * question of the words it just handed out.
 */
function readsAnAnswer(effects: readonly Effect[]): boolean {
  const inside = new Set<Effect>();
  walkEffects(effects, (effect) => {
    if (effect.kind === 'howMany') walkEffects(effect.each, (child) => inside.add(child));
  });
  let reads = false;
  walkEffects(effects, (effect) => {
    if (effect.kind === 'howMany' || inside.has(effect)) return;
    const amount = (effect as { amount?: unknown }).amount;
    const own = Object.entries(effect).filter(([, v]) => typeof v === 'string');
    if (amount === 'spent' || own.some(([, v]) => (v as string).includes('{n}'))) reads = true;
  });
  return reads;
}

/** The selectors an ability reads a pool off that could name a crowd. */
function amountsReadingACrowd(ability: AbilityDef): string[] {
  const crowds: string[] = [];
  walkEffects(ability.effects, (effect) => {
    const amount = (effect as { amount?: unknown }).amount;
    if (typeof amount !== 'object' || amount === null) return;
    const of = (amount as { of?: TargetSelector }).of;
    if (of === undefined) return;
    const many = of.kind === 'party' || of.kind === 'hit' || of.kind === 'entities';
    const band = (of.kind === 'allies' || of.kind === 'adversaries') && of.nearest !== 1;
    if (many || band) crowds.push(of.kind);
  });
  return crowds;
}

/** Whether anything in an ability adds to a blow that has already landed. */
function boostsABlow(ability: AbilityDef): boolean {
  let boosts = false;
  walkEffects(ability.effects, (effect) => {
    if (effect.kind === 'boostDamage') boosts = true;
  });
  return boosts;
}

/** Whether anything in an ability softens or avoids a blow arriving. */
function answersABlow(ability: AbilityDef): boolean {
  let answers = false;
  walkEffects(ability.effects, (effect) => {
    if (
      effect.kind === 'softenBlow' ||
      effect.kind === 'avoidBlow' ||
      effect.kind === 'stepSeverity' ||
      effect.kind === 'dodgeBy'
    ) {
      answers = true;
    }
  });
  return answers;
}

/**
 * Whether anything in an ability names the band a blow lands in - or, with
 * `floorsOnly`, names it as a floor under a blow that is still counted, which
 * is the half of it the GM's swing does not read.
 */
function namesABand(ability: AbilityDef, floorsOnly = false): boolean {
  let names = false;
  walkEffects(ability.effects, (effect) => {
    if (effect.kind === 'forceSeverity' && (!floorsOnly || effect.least === true)) names = true;
  });
  return names;
}

/** Whether anything in an ability sets the Hit Points a blow marks outright. */
function forcesHitPoints(ability: AbilityDef): boolean {
  let forces = false;
  walkEffects(ability.effects, (effect) => {
    if (effect.kind === 'forceHitPoints') forces = true;
  });
  return forces;
}

/** Whether anything in an ability hands its creature another turn. */
function takesAnotherSpotlight(ability: AbilityDef): boolean {
  let again = false;
  walkEffects(ability.effects, (effect) => {
    if (effect.kind === 'spotlightAgain') again = true;
  });
  return again;
}

/** Whether anything in an ability lifts one of the blow's dice to its highest face. */
function maxesADie(ability: AbilityDef): boolean {
  let maxes = false;
  walkEffects(ability.effects, (effect) => {
    if (effect.kind === 'maxOneDie') maxes = true;
  });
  return maxes;
}

/** Whether anything in an ability sends its own card to the vault. */
function vaultsItself(ability: AbilityDef): boolean {
  let vaults = false;
  walkEffects(ability.effects, (effect) => {
    if (effect.kind === 'vaultCard') vaults = true;
  });
  return vaults;
}

/** Whether anything in an ability spends the turn it is running in. */
function endsASpotlight(ability: AbilityDef): boolean {
  let ends = false;
  walkEffects(ability.effects, (effect) => {
    if (effect.kind === 'endSpotlight') ends = true;
  });
  return ends;
}

/** What using an item can do names content too. */
function checkItemUses(
  project: ProjectDoc,
  options: ValidationOptions,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  // A weapon or armour points at SRD content rather than restating it, so an
  // id that does not resolve is an item nobody can equip.
  const content = options.characterContent;
  if (content !== undefined) {
    for (const item of project.items) {
      if (item.contentId === undefined) continue;
      const known = item.kind === 'weapon' ? content.weapons : item.kind === 'armor' ? content.armors : null;
      if (known !== null && !known.has(item.contentId)) {
        add('error', `Item "${item.id}" stands for ${item.kind} "${item.contentId}", which the SRD content does not have.`, item.id);
      }
    }
  }
  const sceneIds = new Set(project.scenes.map((s) => s.id));
  const dialogueIds = new Set(project.dialogues.map((d) => d.id));
  const tableIds = new Set(project.lootTables.map((t) => t.id));
  const itemIds = new Set(project.items.map((i) => i.id));
  for (const item of project.items) {
    const quests = questReferences(project, item.id, add);
    walkEffects(item.use, (effect) => {
      quests.effect(effect);
      if (effect.kind === 'goto' && !sceneIds.has(effect.scene)) {
        add('error', `Item "${item.id}" travels to scene "${effect.scene}", which does not exist.`, item.id);
      }
      if (effect.kind === 'startDialogue' && !dialogueIds.has(effect.dialogue)) {
        add('error', `Item "${item.id}" starts conversation "${effect.dialogue}", which does not exist.`, item.id);
      }
      if (effect.kind === 'loot' && effect.table !== undefined && !tableIds.has(effect.table)) {
        add('error', `Item "${item.id}" draws from loot table "${effect.table}", which does not exist.`, item.id);
      }
      if ((effect.kind === 'addItem' || effect.kind === 'removeItem') && !itemIds.has(effect.item)) {
        add('error', `Item "${item.id}" refers to item "${effect.item}", which does not exist.`, item.id);
      }
    });
    walkConditionsIn(item.use, quests.condition);
  }
}

/**
 * Every place a script can name a quest, so the quest checks are written once.
 *
 * `owner` is what the message blames — an interactable id, a conversation id.
 */
function questReferences(
  project: ProjectDoc,
  owner: string,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): { effect: (effect: Effect) => void; condition: (condition: Condition) => void } {
  const quests = new Map(project.quests.map((quest) => [quest.id, quest]));
  const missingQuest = (id: string): boolean => {
    if (quests.has(id)) return false;
    add('error', `"${owner}" refers to quest "${id}", which does not exist.`, owner);
    return true;
  };
  const checkObjective = (quest: string, objective: string): void => {
    if (missingQuest(quest)) return;
    if (!quests.get(quest)!.objectives.some((o) => o.id === objective)) {
      add('error', `"${owner}" refers to objective "${objective}" of quest "${quest}", which does not exist.`, owner);
    }
  };
  return {
    effect: (effect) => {
      if (effect.kind === 'startQuest' || effect.kind === 'completeQuest' || effect.kind === 'failQuest') {
        missingQuest(effect.quest);
      }
      if (effect.kind === 'completeObjective' || effect.kind === 'revealObjective') {
        checkObjective(effect.quest, effect.objective);
      }
    },
    condition: (condition) => {
      if (condition.kind === 'quest') missingQuest(condition.quest);
      if (condition.kind === 'objectiveDone') checkObjective(condition.quest, condition.objective);
    },
  };
}

/** A quest nothing starts, an objective nothing completes. */
function checkQuests(
  project: ProjectDoc,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  const started = new Set<string>();
  const completed = new Set<string>();
  const visit = (effect: Effect): void => {
    if (effect.kind === 'startQuest') started.add(effect.quest);
    if (effect.kind === 'completeObjective') {
      started.add(effect.quest);
      completed.add(`${effect.quest}/${effect.objective}`);
    }
    if (effect.kind === 'revealObjective') started.add(effect.quest);
  };
  for (const scene of project.scenes) {
    // Props with a function included: a quest step completed by a strongbox is completed.
    for (const interactable of interactablesOf(scene)) {
      walkEffects(interactable.effects, visit);
      if (interactable.check !== undefined) walkCheck(interactable.check, visit);
    }
  }
  for (const dialogue of project.dialogues) {
    for (const node of dialogue.nodes) {
      walkEffects(node.onEnter, visit);
      for (const choice of node.choices ?? []) {
        walkEffects(choice.effects, visit);
        if (choice.check !== undefined) walkCheck(choice.check, visit);
      }
    }
  }
  for (const item of project.items) walkEffects(item.use, visit);
  for (const quest of project.quests) {
    if (!started.has(quest.id)) {
      add('warning', `Quest "${quest.id}" is never started by anything.`, quest.id);
    }
    for (const objective of quest.objectives) {
      if (!completed.has(`${quest.id}/${objective.id}`)) {
        add('warning', `Objective "${objective.id}" of quest "${quest.id}" is never completed by anything.`, quest.id);
      }
    }
  }
}

interface Context {
  project: ProjectDoc;
  sceneIds: ReadonlySet<string>;
  palette: ReturnType<typeof paletteForProject>;
  options: ValidationOptions;
}

function validateScene(scene: SceneDoc, context: Context, problems: Problem[]): void {
  const add = (severity: ProblemSeverity, message: string, entity?: string): void => {
    problems.push({
      severity,
      scene: scene.id,
      ...(entity === undefined ? {} : { entity }),
      message,
    });
  };

  const { grid, issues } = gridFromScene(scene, context.palette);
  for (const issue of issues) add('error', issue.message);

  /**
   * Construction reaches a million tiles in every direction, and props, objects
   * and creatures may be authored out there with it. That is legal: it is how a
   * street is dressed around a room. It is not playable, though - the tactical
   * board is still the rectangle - so each such placement earns exactly one
   * warning and is then left out of the checks that reason about tiles. Calling
   * it "impassable terrain", as this used to, was both an error and untrue.
   */
  const offBoard = (position: { x: number; y: number }): boolean => tileOf(grid, position) === NO_TILE;
  const OUTSIDE = 'is authored outside the playable board and takes no part in play.';

  // --- spawns -------------------------------------------------------------
  for (const [i, spawn] of scene.spawns.entries()) {
    const tile = tileOf(grid, spawn);
    if (!grid.isPassable(tile)) {
      add('error', `Spawn ${i + 1} at (${spawn.x}, ${spawn.y}) is inside impassable terrain.`);
    }
  }

  // --- interactables ------------------------------------------------------
  const occupied = new Map<number, string>();
  for (const interactable of interactablesOf(scene)) {
    const tile = tileOf(grid, interactable.position);
    if (offBoard(interactable.position)) {
      add('warning', `"${interactable.id}" ${OUTSIDE}`, interactable.id);
    } else {
      if (!grid.isPassable(tile)) {
        add(
          'warning',
          `"${interactable.id}" stands on impassable terrain, so nothing can reach it.`,
          interactable.id,
        );
      }
      const already = occupied.get(tile);
      if (already !== undefined) {
        add('warning', `"${interactable.id}" shares a tile with "${already}".`, interactable.id);
      }
      occupied.set(tile, interactable.id);
    }

    if (interactable.goto !== undefined && !context.sceneIds.has(interactable.goto)) {
      add('error', `"${interactable.id}" travels to scene "${interactable.goto}", which does not exist.`, interactable.id);
    }
    if (interactable.model !== null && context.options.knownModels !== undefined) {
      if (!context.options.knownModels.has(interactable.model)) {
        add('warning', `"${interactable.id}" uses model "${interactable.model}", which the library does not have.`, interactable.id);
      }
    }
    validateEffects(interactable, context, add);
  }

  // --- what props do --------------------------------------------------------
  const itemIds = new Set(context.project.items.map((item) => item.id));
  for (const deco of scene.decos) {
    if (deco.function === undefined) continue;
    const name = deco.id ?? deco.model;
    for (const line of containerItems(deco.function)) {
      if (!itemIds.has(line.item)) add('error', `"${name}" holds item "${line.item}", which the project does not have.`, deco.id);
    }
    for (const pair of pairsOf(deco.function)) {
      const holders = portalsWith(context.project, pair);
      if (holders.length > 2) add('error', `Portal pair "${pair}" is held by ${holders.length} portals (${holders.map((h) => h.prop.id).join(', ')}); a pair is two.`, deco.id);
      else if (holders.length < 2) add('warning', `Portal "${name}" has no other end: no other portal has the pair id "${pair}".`, deco.id);
    }
    if (findFunction(deco.function, 'portal')?.pair === '') add('warning', `Portal "${name}" has no pair id, so it leads nowhere.`, deco.id);
  }

  // --- decos --------------------------------------------------------------
  for (const deco of scene.decos) {
    if (!offBoard(deco.position)) continue;
    add('warning', `The "${deco.model}" prop at (${deco.position.x}, ${deco.position.y}) ${OUTSIDE}`);
  }
  if (context.options.knownModels !== undefined) {
    const missing = new Set<string>();
    for (const deco of scene.decos) {
      if (!context.options.knownModels.has(deco.model)) missing.add(deco.model);
    }
    for (const model of [...missing].sort()) {
      add('warning', `No model named "${model}"; it will draw as a placeholder.`);
    }
  }

  // --- building tiles -----------------------------------------------------
  // Never looked at before, and only worth looking at since a piece began carrying the kind
  // of tile it is: one naming a kind the palette has lost is walked on as whatever comes
  // first in the palette, silently, which is an authored mistake with no other way of being
  // seen. The shape is not checked here - `buildingTilesSchema` refuses a structure nothing
  // declares before Check's own passes run, so a document cannot reach this carrying one.
  const unknownTiles = new Set<string>();
  for (const piece of Object.values(scene.buildingTiles ?? {})) {
    if (piece.tile !== undefined && !context.palette.has(piece.tile)) unknownTiles.add(piece.tile);
  }
  for (const tile of [...unknownTiles].sort()) {
    add('warning', `A building tile is of kind "${tile}", which the palette does not have; it falls back to the first kind.`);
  }

  // --- encounters ---------------------------------------------------------
  for (const encounter of scene.encounters) {
    if (encounter.adversaries.length === 0) {
      add('warning', `Encounter "${encounter.id}" has no adversaries in it.`, encounter.id);
    }
    if (encounter.startsOnTrigger && encounter.triggerCells.length === 0) {
      add(
        'warning',
        `Encounter "${encounter.id}" starts on a trigger but has no trigger cells, so nothing can start it.`,
        encounter.id,
      );
    }
    for (const cell of encounter.triggerCells) {
      if (!grid.isPassable(tileOf(grid, cell))) {
        add(
          'warning',
          `A trigger cell of "${encounter.id}" at (${cell.x}, ${cell.y}) is impassable, so it can never be stepped on.`,
          encounter.id,
        );
      }
    }
    for (const placement of encounter.adversaries) {
      if (offBoard(placement.position)) {
        add('warning', `"${placement.id}" ${OUTSIDE}`, placement.id);
      } else if (!grid.isPassable(tileOf(grid, placement.position))) {
        add('error', `"${placement.id}" stands in impassable terrain.`, placement.id);
      }
      if (
        context.options.knownAdversaries !== undefined &&
        !context.options.knownAdversaries.has(placement.adversary)
      ) {
        add('error', `"${placement.id}" uses adversary "${placement.adversary}", which has no stat block.`, placement.id);
      }
    }
  }

  // --- reachability -------------------------------------------------------
  // The expensive check last, and only when there is somewhere to start from.
  const start = tileOf(grid, scene.spawns[0]!);
  if (grid.isPassable(start)) {
    const field = new Pathfinder(grid).reachable(start, Infinity);
    for (const encounter of scene.encounters) {
      for (const cell of encounter.triggerCells) {
        const tile = tileOf(grid, cell);
        if (grid.isPassable(tile) && !field.canReach(tile)) {
          add(
            'warning',
            `A trigger cell of "${encounter.id}" at (${cell.x}, ${cell.y}) is walled off from the spawn.`,
            encounter.id,
          );
        }
      }
    }
    // An interactable nothing can walk up to is almost always a mistake, but a
    // blocking one is *itself* unreachable, so its neighbours are what matter.
    const pathfinder = new Pathfinder(grid);
    const reach = pathfinder.reachable(start, Infinity);
    for (const interactable of interactablesOf(scene)) {
      const tile = tileOf(grid, interactable.position);
      if (!grid.isPassable(tile)) continue;
      const approachable =
        reach.canReach(tile) || pathfinder.nearestReachableAdjacentTo(reach, tile) >= 0;
      if (!approachable) {
        add('warning', `"${interactable.id}" cannot be reached from the spawn.`, interactable.id);
      }
    }
  }
}

/** Effects that name something which has to exist. */
function validateEffects(
  interactable: SceneDoc['interactables'][number],
  context: Context,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  const encounterIds = new Set(
    context.project.scenes.flatMap((s) => s.encounters.map((e) => e.id)),
  );
  const dialogueIds = new Set(context.project.dialogues.map((d) => d.id));
  const tableIds = new Set(context.project.lootTables.map((t) => t.id));
  const itemIds = new Set(context.project.items.map((i) => i.id));

  // Every outcome, and everything nested inside a branch, a choice or a further
  // check — a walk that stops at the top level passes a broken file.
  const inspect = (effect: Parameters<Parameters<typeof walkCheck>[1]>[0]): void => {
    if (effect.kind === 'goto' && !context.sceneIds.has(effect.scene)) {
      add('error', `"${interactable.id}" travels to scene "${effect.scene}", which does not exist.`, interactable.id);
    }
    if (effect.kind === 'startEncounter' && !encounterIds.has(effect.encounter)) {
      add('error', `"${interactable.id}" starts encounter "${effect.encounter}", which does not exist.`, interactable.id);
    }
    if (effect.kind === 'startDialogue' && !dialogueIds.has(effect.dialogue)) {
      add('error', `"${interactable.id}" starts conversation "${effect.dialogue}", which does not exist.`, interactable.id);
    }
    if (effect.kind === 'loot' && effect.table !== undefined && !tableIds.has(effect.table)) {
      add('error', `"${interactable.id}" draws from loot table "${effect.table}", which does not exist.`, interactable.id);
    }
    if ((effect.kind === 'addItem' || effect.kind === 'removeItem') && !itemIds.has(effect.item)) {
      add('error', `"${interactable.id}" refers to item "${effect.item}", which does not exist.`, interactable.id);
    }
    // A key is an item with a quantity of one, so a key nobody can be given
    // is a door nobody can open.
    if (effect.kind === 'giveKey' && !itemIds.has(effect.key)) {
      add('error', `"${interactable.id}" gives key "${effect.key}", which is not an item in this project.`, interactable.id);
    }
  };

  if (interactable.requiresKey !== undefined && !itemIds.has(interactable.requiresKey)) {
    add('error', `"${interactable.id}" wants key "${interactable.requiresKey}", which is not an item in this project.`, interactable.id);
  }

  const quests = questReferences(context.project, interactable.id, add);
  const inspectAll = (effect: Effect): void => {
    inspect(effect);
    quests.effect(effect);
  };
  walkEffects(interactable.effects, inspectAll);
  walkConditionsIn(interactable.effects, quests.condition);
  if (interactable.check !== undefined) {
    walkCheck(interactable.check, inspectAll);
    walkConditionsInCheck(interactable.check, quests.condition);
  }
}

/** Only the problems that stop a project running. */
export function errorsOnly(problems: readonly Problem[]): Problem[] {
  return problems.filter((p) => p.severity === 'error');
}

/** A one-line summary for a status bar. */
export function summarise(problems: readonly Problem[]): string {
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;
  if (problems.length === 0) return 'No problems';
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/**
 * Conversations: the errors a schema cannot see.
 *
 * `dialogueSchema` catches a duplicate node id and a start that names nothing.
 * These are the ones that need the whole graph: a reply pointing at a node
 * nobody wrote, and a node no path can reach — the second is a warning, because
 * an author part-way through writing one is not making a mistake.
 */
/** Every loot table entry naming an item the project does not have. */
function checkLootTables(
  project: ProjectDoc,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  const itemIds = new Set(project.items.map((item) => item.id));
  for (const table of project.lootTables) {
    for (const entry of table.entries) {
      if (!itemIds.has(entry.item)) {
        add('error', `Loot table "${table.id}" can drop "${entry.item}", which is not an item.`, table.id);
      }
    }
  }
}

/**
 * Past this, one embedded file is heavy enough to be felt on every save and
 * load. Embedding is a deliberate choice — it makes a project self-contained —
 * so this says what it costs rather than refusing it.
 */
const EMBEDDED_WARN_BYTES = 8 * 1024 * 1024;

/**
 * Model files carried inside the project rather than referenced beside it.
 *
 * Unlike the other model checks this needs nothing from the renderer: the
 * weight of the document is visible in the document, so it always runs.
 */
function checkEmbeddedAssets(
  project: ProjectDoc,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  for (const asset of project.assets) {
    if (!asset.url.startsWith('data:')) continue;
    const base64 = asset.url.slice(asset.url.indexOf(',') + 1);
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes < EMBEDDED_WARN_BYTES) continue;
    add(
      'warning',
      `Model "${asset.id}" is carried inside the project at ${(bytes / 1_048_576).toFixed(1)} MB; saving and loading will feel it.`,
      asset.id,
    );
  }
}

/**
 * What creatures are drawn with, per type and per placement.
 *
 * Like the other model checks, this runs only when the caller says which ids the
 * renderer can resolve — a headless caller that never loaded the library is not
 * wrong. The project's own imported models count as resolvable on top of that
 * set: they are written down in the document, so this can see them without
 * knowing anything about the renderer.
 *
 * A wrong name is a warning rather than an error. The creature still draws, as
 * the stand-in body, and still plays; it simply does not look like what was
 * asked for.
 */
function checkAdversaryModels(
  project: ProjectDoc,
  options: ValidationOptions,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  const known = options.knownModels;
  if (known === undefined) return;
  const resolvable = (id: string): boolean =>
    known.has(id) || project.assets.some((asset) => asset.id === id);

  for (const [adversary, model] of Object.entries(project.adversaryModels)) {
    if (resolvable(model)) continue;
    add('warning', `Every "${adversary}" is drawn with "${model}", which nothing can supply.`, adversary);
  }

  for (const scene of project.scenes) {
    for (const encounter of scene.encounters) {
      for (const placement of encounter.adversaries) {
        if (placement.model === undefined || resolvable(placement.model)) continue;
        add(
          'warning',
          `Creature "${placement.id}" is drawn with "${placement.model}", which nothing can supply.`,
          placement.id,
        );
      }
    }
  }

  // A character picked out on the sheet, by the same rule: a party member drawn with
  // something nothing can supply stands as the magenta placeholder, which is the library's
  // honest answer and not one anybody means to ship.
  for (const sheet of project.party) {
    if (sheet.model === undefined || resolvable(sheet.model)) continue;
    add('warning', `"${sheet.name || sheet.id}" is drawn with "${sheet.model}", which nothing can supply.`, sheet.id);
  }
}

function checkDialogues(
  project: ProjectDoc,
  add: (severity: ProblemSeverity, message: string, entity?: string) => void,
): void {
  const sceneIds = new Set(project.scenes.map((s) => s.id));
  const dialogueIds = new Set(project.dialogues.map((d) => d.id));
  const encounterIds = new Set(
    project.scenes.flatMap((s) => s.encounters.map((e) => e.id)),
  );

  for (const dialogue of project.dialogues) {
    for (const missing of danglingLinks(dialogue)) {
      add('error', `Conversation "${dialogue.id}" goes to node "${missing}", which does not exist.`, dialogue.id);
    }
    for (const stranded of unreachableNodes(dialogue)) {
      add('warning', `Conversation "${dialogue.id}" has a node nothing reaches: "${stranded}".`, dialogue.id);
    }

    // Everything a reply or an entered node can do, including inside a branch,
    // a nested choice, or either half of a check.
    const inspect = (effect: Parameters<Parameters<typeof walkCheck>[1]>[0]): void => {
      if (effect.kind === 'goto' && !sceneIds.has(effect.scene)) {
        add('error', `Conversation "${dialogue.id}" travels to scene "${effect.scene}", which does not exist.`, dialogue.id);
      }
      if (effect.kind === 'startDialogue' && !dialogueIds.has(effect.dialogue)) {
        add('error', `Conversation "${dialogue.id}" starts "${effect.dialogue}", which does not exist.`, dialogue.id);
      }
      if (effect.kind === 'startEncounter' && !encounterIds.has(effect.encounter)) {
        add('error', `Conversation "${dialogue.id}" starts encounter "${effect.encounter}", which does not exist.`, dialogue.id);
      }
    };

    const quests = questReferences(project, dialogue.id, add);
    const inspectAll = (effect: Effect): void => {
      inspect(effect);
      quests.effect(effect);
    };
    for (const node of dialogue.nodes) {
      walkEffects(node.onEnter, inspectAll);
      walkConditionsIn(node.onEnter, quests.condition);
      for (const choice of node.choices ?? []) {
        if (choice.available !== undefined) walkCondition(choice.available, quests.condition);
        if (choice.enabled !== undefined) walkCondition(choice.enabled, quests.condition);
        walkEffects(choice.effects, inspectAll);
        walkConditionsIn(choice.effects, quests.condition);
        if (choice.check !== undefined) {
          walkCheck(choice.check, inspectAll);
          walkConditionsInCheck(choice.check, quests.condition);
        }
      }
    }
  }
}
