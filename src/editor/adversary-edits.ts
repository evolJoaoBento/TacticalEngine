/**
 * The project's own creatures: added, changed and taken out, each as one undo step.
 *
 * A project can bring creatures of its own (`ProjectDoc.adversaries`); they join the ones the build
 * ships (`adversaryDefsFor`), an id of the project's replacing one of the build's. The editor makes one
 * by copying a creature that is already there (`copyOfAdversary`) and then changing the copy, so a
 * creature is never half-written: every field is filled from the start, and a change that would not
 * make a whole creature is not made (`updateAdversaryDef` is only run with one that parses - see
 * `ModeSides.tsx`).
 */

import type { Edit } from './session';
import type { ProjectDoc } from '../engine/scene/schema';

export type ProjectAdversary = ProjectDoc['adversaries'][number];

/** A copy of a creature to make one's own of: a free id beside the original's, and "(copy)" on its name. */
export function copyOfAdversary(def: ProjectAdversary, taken: ReadonlySet<string>): ProjectAdversary {
  const base = `${def.id}-copy`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return structuredClone({ ...def, id, name: `${def.name} (copy)` });
}

/**
 * Add a creature to the project, and - when one is named - the model every one of it is drawn with, so
 * a copy looks like what it was copied from: one undo step for both.
 */
export function addAdversaryDef(def: ProjectAdversary, model?: string): Edit {
  return {
    label: `Add creature ${def.name}`,
    apply(project) {
      project.adversaries.push(def);
      if (model !== undefined) project.adversaryModels[def.id] = model;
    },
    undo(project) {
      const at = project.adversaries.lastIndexOf(def);
      if (at >= 0) project.adversaries.splice(at, 1);
      if (model !== undefined) delete project.adversaryModels[def.id];
    },
  };
}

/**
 * Change one of the project's creatures. Successive changes to the same fields merge into one undo
 * step, so typing a name is one step rather than one a letter.
 */
export function updateAdversaryDef(id: string, changes: Partial<Omit<ProjectAdversary, 'id'>>): Edit {
  let before: ProjectAdversary | null = null;
  const current: Partial<Omit<ProjectAdversary, 'id'>> = structuredClone(changes);
  const edit: Edit = {
    label: 'Edit creature',
    mergeKey: `creature:${id}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.adversaries.findIndex((def) => def.id === id);
      if (index < 0) return;
      before = project.adversaries[index]!;
      project.adversaries[index] = { ...before, ...structuredClone(current) };
    },
    undo(project) {
      if (before === null) return;
      const index = project.adversaries.findIndex((def) => def.id === id);
      if (index >= 0) project.adversaries[index] = before;
    },
    // Taken over by the one before it, which keeps its own `before`: undo puts back what was there first.
    absorb(other) {
      const next = (other as Edit & { __creature?: Partial<Omit<ProjectAdversary, 'id'>> }).__creature;
      if (next === undefined) return false;
      Object.assign(current, structuredClone(next));
      return true;
    },
  };
  (edit as Edit & { __creature: Partial<Omit<ProjectAdversary, 'id'>> }).__creature = current;
  return edit;
}

/** Take one of the project's creatures out. Where it was placed stays, as a creature with no stat block (Project → Check says so). */
export function removeAdversaryDef(id: string): Edit {
  let removed: { index: number; def: ProjectAdversary } | null = null;
  return {
    label: `Delete creature ${id}`,
    apply(project) {
      removed = null;
      const index = project.adversaries.findIndex((def) => def.id === id);
      if (index < 0) return;
      removed = { index, def: project.adversaries[index]! };
      project.adversaries.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.adversaries.splice(removed.index, 0, removed.def);
    },
  };
}
