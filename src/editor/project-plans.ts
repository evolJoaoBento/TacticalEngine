/**
 * The editor's commands for project plans (`engine/content/projects.ts`): a plan added, deleted, or changed - its
 * name, its description, the work it takes, its reward. Each an `Edit`, so undo works here as it does everywhere,
 * and keystrokes into one field of one plan coalesce into one step. Beside `session.ts` rather than in it, which is
 * already as long as a reader can follow.
 */

import type { ProjectPlan } from '../engine/content/projects';
import type { ProjectDoc } from '../engine/scene/schema';
import type { Edit } from './session';

/** The plans a project has, made a list it can hold if it had none. */
function plansOf(project: ProjectDoc): ProjectPlan[] {
  project.projectPlans ??= [];
  return project.projectPlans;
}

export function addProjectPlan(plan: ProjectPlan): Edit {
  return {
    label: `Add project plan ${plan.id}`,
    apply(project) {
      plansOf(project).push(plan);
    },
    undo(project) {
      const plans = plansOf(project);
      const at = plans.lastIndexOf(plan);
      if (at >= 0) plans.splice(at, 1);
      if (plans.length === 0) delete project.projectPlans;
    },
  };
}

/** Delete a plan. Effects that teach it may still name it; the validator reports those. */
export function removeProjectPlan(planId: string): Edit {
  let removed: { index: number; plan: ProjectPlan } | null = null;
  return {
    label: 'Delete project plan',
    apply(project) {
      removed = null;
      const plans = plansOf(project);
      const index = plans.findIndex((p) => p.id === planId);
      if (index >= 0) {
        removed = { index, plan: plans[index]! };
        plans.splice(index, 1);
      }
      if (plans.length === 0) delete project.projectPlans;
    },
    undo(project) {
      if (removed !== null) plansOf(project).splice(removed.index, 0, removed.plan);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/** Change a plan's name, description, work or reward. Keystrokes into one field coalesce. */
export function updateProjectPlan(planId: string, changes: Partial<Omit<ProjectPlan, 'id'>>): Edit {
  let before: ProjectPlan | null = null;
  const current: Partial<ProjectPlan> = { ...changes };
  const edit: Edit & { __plan: Partial<ProjectPlan> } = {
    label: 'Edit project plan',
    mergeKey: `plan:${planId}:${Object.keys(changes).sort().join(',')}`,
    __plan: current,
    apply(project) {
      const plans = plansOf(project);
      const index = plans.findIndex((p) => p.id === planId);
      if (index < 0) return;
      before = plans[index]!;
      plans[index] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const plans = plansOf(project);
      const index = plans.findIndex((p) => p.id === planId);
      if (index >= 0) plans[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __plan?: Partial<ProjectPlan> }).__plan;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  return edit;
}
