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
import { gridFromScene, paletteForProject, tileOf } from '../engine/scene/grid-from-scene';
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
  return problems;
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
  const check = interactable.check;
  if (check === undefined) return;
  const encounterIds = new Set(
    context.project.scenes.flatMap((s) => s.encounters.map((e) => e.id)),
  );

  for (const outcome of Object.values(check.outcomes)) {
    for (const effect of outcome?.effects ?? []) {
      if (effect.kind === 'goto' && !context.sceneIds.has(effect.scene)) {
        add('error', `"${interactable.id}" travels to scene "${effect.scene}", which does not exist.`, interactable.id);
      }
      if (effect.kind === 'startEncounter' && !encounterIds.has(effect.encounter)) {
        add('error', `"${interactable.id}" starts encounter "${effect.encounter}", which does not exist.`, interactable.id);
      }
    }
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
