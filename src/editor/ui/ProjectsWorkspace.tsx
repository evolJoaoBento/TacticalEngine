/**
 * Project plans, as a workspace: the list on the left, the open plan's form beside it (`engine/content/projects.ts`).
 *
 * A plan is whatever the designer wants it to be. The form asks for the two things the engine needs - how much work
 * it takes, counted in Work on a Project moves on long rests, and what finishing it does, in the same effect list
 * a chest or a conversation uses: an item to carry, a flag the story reads later, a quest begun, a page of story.
 * The party comes by a plan through a "Teach a project plan" effect, wherever effects are written.
 */

import { useState } from 'preact/hooks';
import { projectPlanSchema } from '../../engine/content/projects';
import type { EditorSession } from '../session';
import { addProjectPlan, removeProjectPlan, updateProjectPlan } from '../project-plans';
import { EffectList } from './EffectList';
import { Icon } from './icons';

const CLOSE_BUTTON: Record<string, string | number> = {
  padding: '3px 8px',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
};

const field: Record<string, string | number> = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  marginBottom: '4px',
  border: '1px solid var(--ph-line)',
  borderRadius: '4px',
  background: 'rgba(0,0,0,0.3)',
  color: 'inherit',
  font: 'inherit',
};

export function ProjectsWorkspace(props: { session: EditorSession; hookIds: readonly string[]; encounterIds: readonly string[]; onChange: () => void; onClose: () => void }): preact.JSX.Element {
  const { session } = props;
  const plans = session.project.projectPlans ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === open) ?? null;
  const run = (edit: Parameters<EditorSession['run']>[0]): void => {
    session.run(edit);
    props.onChange();
  };

  return (
    <div class="ph-workspace-panel" data-testid="projects-panel">
      <div class="ph-workspace-list" data-testid="project-list">
        <div class="ph-row">
          <button style={CLOSE_BUTTON} data-testid="close-projects" onClick={props.onClose} aria-label="Back" title="Back to the board">
            <Icon name="back" size={16} />
          </button>
          <strong style={{ flex: 1 }}>Project plans</strong>
        </div>
        {plans.map((p) => (
          <div key={p.id} class="ph-row">
            <button class={p.id === open ? 'ph-item ph-on' : 'ph-item'} data-plan={p.id} onClick={() => setOpen(p.id)}>
              {p.name} <small>{p.work} work</small>
            </button>
            <button
              class="ph-mini"
              title="Delete this plan"
              onClick={() => {
                if (!confirm(`Delete "${p.name}"?`)) return;
                run(removeProjectPlan(p.id));
                if (open === p.id) setOpen(null);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          class="ph-item"
          data-testid="add-plan"
          onClick={() => {
            const name = prompt('Project plan name', 'A project');
            if (name === null || name.trim() === '') return;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (id === '' || plans.some((p) => p.id === id)) return;
            run(addProjectPlan(projectPlanSchema.parse({ id, name: name.trim(), work: 2 })));
            setOpen(id);
          }}
        >
          + Project plan
        </button>
      </div>
      <div class="ph-workspace-body">
        {plan === null ? (
          <div class="ph-hint">Pick a project plan: how much work it takes, and what finishing it gives.</div>
        ) : (
          <div style={{ marginTop: '6px', padding: '6px', borderLeft: '2px solid var(--ph-line)' }} data-testid="plan-editor">
            <input style={field} value={plan.name} placeholder="Name" data-field="name" onInput={(e) => run(updateProjectPlan(plan.id, { name: (e.target as HTMLInputElement).value }))} onBlur={() => session.endGroup()} />
            <textarea
              style={{ ...field, minHeight: '48px', resize: 'vertical' }}
              value={plan.description}
              placeholder="What the journal says the project is"
              data-field="description"
              onInput={(e) => run(updateProjectPlan(plan.id, { description: (e.target as HTMLTextAreaElement).value }))}
              onBlur={() => session.endGroup()}
            />
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }} title="One unit for each Work on a Project move a character spends on it, over as many long rests as it takes">
              Work it takes
              <input
                type="number"
                min={1}
                step={1}
                style={{ ...field, width: '70px', margin: 0 }}
                value={plan.work}
                data-field="work"
                onInput={(e) => {
                  const work = Math.floor(Number((e.target as HTMLInputElement).value));
                  if (Number.isFinite(work) && work >= 1) run(updateProjectPlan(plan.id, { work }));
                }}
                onBlur={() => session.endGroup()}
              />
              <small style={{ color: 'var(--ph-muted)' }}>Work on a Project moves, on long rests</small>
            </label>
            <div style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>When it is finished (the one who finishes it acting)</div>
            <EffectList
              testId="plan-reward"
              effects={plan.reward}
              onChange={(reward) => run(updateProjectPlan(plan.id, { reward }))}
              sceneIds={session.project.scenes.map((s) => s.id)}
              dialogueIds={session.project.dialogues.map((d) => d.id)}
              encounterIds={props.encounterIds}
              quests={session.project.quests}
              hookIds={props.hookIds}
            />
          </div>
        )}
      </div>
    </div>
  );
}
