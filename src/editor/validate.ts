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
} from '../engine/script/schema';
import { gridFromScene, paletteForProject, tileOf } from '../engine/scene/grid-from-scene';
import { deriveCharacter } from '../engine/character/sheet';
import { domainsOf, heldCards } from '../engine/character/progression';
import type { SrdCharacterContent } from '../engine/content/srd/daggersearch';
import { parseDice } from '../engine/rules/dice';
import { compileHooks } from '../engine/script/hooks';
import { projectSchema, type ProjectDoc, type SceneDoc } from '../engine/scene/schema';

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
  /**
   * The SRD content a sheet's ids are checked against. Omit to skip the party
   * check — a headless caller that has not loaded the content is not wrong.
   */
  characterContent?: SrdCharacterContent;
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
  checkParty(project, options, (severity, message, entity) => {
    problems.push({ severity, message, ...(entity === undefined ? {} : { entity }) });
  });
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
      const def = content.domainCards.get(card);
      if (def !== undefined && !domains.includes(def.domain)) {
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
  const conditionIds = new Set(project.conditionDefs.map((c) => c.id));
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
  for (const ability of project.abilities) {
    // Fear is the GM's pool. A card that asks its holder for one is a card
    // nobody can ever use — play refuses it — so say so while it is being
    // written rather than when someone reaches for it.
    if ((ability.cost.fear ?? 0) > 0 && ability.source.kind !== 'adversary') {
      add('warning', `"${ability.id}" costs Fear, which only the GM spends: nobody holding it can use it.`, ability.id);
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
    });
    // Handing the GM's turn to its own side is the GM's move: a card in a
    // player's hand has no turn to hand out, and play would refuse it.
    walkEffects(ability.effects, (effect) => {
      if (effect.kind !== 'spotlight') return;
      if (ability.source.kind !== 'adversary') {
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
      if (effect.advance === 'hpMarked' && ability.source.kind !== 'adversary') {
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
    if (ability.standardAttack !== undefined && ability.source.kind !== 'adversary') {
      add(
        'warning',
        `"${ability.id}" changes a standard attack, which only a stat block has.`,
        ability.id,
      );
    }
    if (
      (ability.trigger === 'dealtHit' || ability.trigger === 'dealtDamage') &&
      ability.source.kind !== 'adversary'
    ) {
      add(
        'warning',
        `"${ability.id}" answers its holder's own attack, which only a stat block's swing reports.`,
        ability.id,
      );
    }
    walkEffects(ability.effects, inspect(ability.id));
    walkConditionsIn(ability.effects, asked(ability.id));
    inspectCondition(ability.id, ability.available);
    for (const modifier of ability.modifiers) inspectCondition(ability.id, modifier.when);
  }
  for (const def of project.conditionDefs) {
    for (const modifier of def.modifiers) inspectCondition(def.id, modifier.when);
  }
  for (const entry of project.code) {
    if (!used.has(entry.id)) add('warning', `Code "${entry.id}" is never run by anything.`, entry.id);
  }
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
    for (const interactable of scene.interactables) {
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

  // --- spawns -------------------------------------------------------------
  for (const [i, spawn] of scene.spawns.entries()) {
    const tile = tileOf(grid, spawn);
    if (!grid.isPassable(tile)) {
      add('error', `Spawn ${i + 1} at (${spawn.x}, ${spawn.y}) is inside impassable terrain.`);
    }
  }

  // --- interactables ------------------------------------------------------
  const occupied = new Map<number, string>();
  for (const interactable of scene.interactables) {
    const tile = tileOf(grid, interactable.position);
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

  // --- decos --------------------------------------------------------------
  if (context.options.knownModels !== undefined) {
    const missing = new Set<string>();
    for (const deco of scene.decos) {
      if (!context.options.knownModels.has(deco.model)) missing.add(deco.model);
    }
    for (const model of [...missing].sort()) {
      add('warning', `No model named "${model}"; it will draw as a placeholder.`);
    }
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
      const tile = tileOf(grid, placement.position);
      if (!grid.isPassable(tile)) {
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
    for (const interactable of scene.interactables) {
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
