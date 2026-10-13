/**
 * Project plans in the editor (`project-plans.ts`, `validate.ts`): added, changed with keystrokes coalesced, deleted,
 * every step undone; and the validator's word on them - a plan nothing teaches, a plan taught that is not there, a
 * reward naming what the project has not got, the same id twice.
 */

import { describe, expect, it } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { projectPlanSchema } from '../engine/content/projects';
import { EditorSession } from './session';
import { addProjectPlan, removeProjectPlan, updateProjectPlan } from './project-plans';
import { validateProject } from './validate';

function build(extra: Record<string, unknown> = {}): ProjectDoc {
  return projectSchema.parse({ id: 'demo', name: 'Demo', scenes: [sceneSchema.parse(blankScene('room', 6, 4))], startScene: 'room', ...extra });
}

const plan = (id: string, reward: unknown[] = []) => projectPlanSchema.parse({ id, name: id, work: 2, reward });
const messages = (project: ProjectDoc): string[] => validateProject(project).map((p) => p.message);

describe('project plans in the editor', () => {
  it('are added, changed and deleted, and every step undone', () => {
    const session = new EditorSession(build());
    expect(session.project.projectPlans).toBeUndefined();
    session.run(addProjectPlan(plan('blade')));
    expect(session.project.projectPlans?.map((p) => p.id)).toEqual(['blade']);
    // Keystrokes into one field are one step.
    session.run(updateProjectPlan('blade', { name: 'B' }));
    session.run(updateProjectPlan('blade', { name: 'Bl' }));
    session.run(updateProjectPlan('blade', { name: 'Blade' }));
    session.endGroup();
    session.run(updateProjectPlan('blade', { work: 4 }));
    session.endGroup();
    session.run(updateProjectPlan('blade', { reward: [{ kind: 'setFlag', flag: 'forged' }] }));
    expect(session.project.projectPlans![0]).toMatchObject({ name: 'Blade', work: 4, reward: [{ kind: 'setFlag', flag: 'forged' }] });
    session.undo();
    session.undo();
    expect(session.project.projectPlans![0]).toMatchObject({ name: 'Blade', work: 2, reward: [] });
    session.undo();
    expect(session.project.projectPlans![0]!.name).toBe('blade');
    session.run(removeProjectPlan('blade'));
    expect(session.project.projectPlans).toBeUndefined();
    session.undo();
    expect(session.project.projectPlans?.map((p) => p.id)).toEqual(['blade']);
    session.undo();
    expect(session.project.projectPlans).toBeUndefined();
  });

  it('are validated: taught by something, there when taught, their rewards naming what is there', () => {
    // A plan nothing teaches: a warning.
    expect(messages(build({ projectPlans: [plan('blade')] }))).toContain('Project plan "blade" is never taught by anything: no "Teach a project plan" effect names it.');
    // Taught by a blueprint's use: no warning. A reward naming an item the project has not got: an error.
    const blueprint = { id: 'blueprint', name: 'Blueprint', kind: 'consumable', use: [{ kind: 'learnPlan', plan: 'blade' }] };
    const taught = messages(build({ items: [blueprint], projectPlans: [plan('blade', [{ kind: 'addItem', item: 'nothing-such' }])] }));
    expect(taught.some((m) => m.includes('never taught'))).toBe(false);
    expect(taught).toContain('Project plan "blade" refers to item "nothing-such", which does not exist.');
    // A plan taught that the project has not got: an error.
    expect(messages(build({ items: [blueprint] }))).toContain('A "Teach a project plan" effect names plan "blade", which does not exist.');
    // A quest a plan's reward starts is started.
    const quest = { id: 'after', name: 'After', objectives: [{ id: 'one', text: 'One' }] };
    const started = messages(build({ items: [blueprint], quests: [quest], projectPlans: [plan('blade', [{ kind: 'startQuest', quest: 'after' }])] }));
    expect(started.some((m) => m.includes('Quest "after" is never started'))).toBe(false);
  });

  it('are refused with the same id twice', () => {
    const parsed = projectSchema.safeParse({ id: 'demo', scenes: [sceneSchema.parse(blankScene('room', 6, 4))], startScene: 'room', projectPlans: [plan('blade'), plan('blade')] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.message)).toContain('duplicate project plan id "blade"');
  });
});
