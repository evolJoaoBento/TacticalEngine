/**
 * A form for one quest: its name, its summary, and its steps.
 *
 * A form rather than a graph, on purpose. A conversation branches and the
 * graph earns its place; a quest is a list, and a list is edited as a list.
 * Every keystroke is a session edit, coalesced by field, so undo works here the
 * way it works everywhere else in the editor.
 */

import type { QuestDef } from '../../engine/content/quests';
import type { EditorSession } from '../session';
import { addObjective, removeObjective, updateObjective, updateQuest } from '../session';

export interface QuestEditorProps {
  session: EditorSession;
  quest: QuestDef;
  onChange: () => void;
}

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

const small: Record<string, string | number> = {
  padding: '2px 8px',
  border: '1px solid var(--ph-line)',
  borderRadius: '4px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

/** A fresh objective id that no sibling already uses. */
function nextObjectiveId(quest: QuestDef): string {
  for (let n = quest.objectives.length + 1; ; n++) {
    const id = `step-${n}`;
    if (!quest.objectives.some((o) => o.id === id)) return id;
  }
}

export function QuestEditor(props: QuestEditorProps): preact.JSX.Element {
  const { session, quest } = props;
  const run = (edit: Parameters<EditorSession['run']>[0]): void => {
    session.run(edit);
    props.onChange();
  };

  return (
    <div style={{ marginTop: '6px', padding: '6px', borderLeft: '2px solid var(--ph-line)' }} data-testid="quest-editor">
      <input
        style={field}
        value={quest.name}
        placeholder="Name"
        data-field="name"
        onInput={(e) => run(updateQuest(quest.id, { name: (e.target as HTMLInputElement).value }))}
        onBlur={() => session.endGroup()}
      />
      <textarea
        style={{ ...field, minHeight: '48px', resize: 'vertical' }}
        value={quest.summary}
        placeholder="What the journal says about it"
        data-field="summary"
        onInput={(e) => run(updateQuest(quest.id, { summary: (e.target as HTMLTextAreaElement).value }))}
        onBlur={() => session.endGroup()}
      />
      {quest.objectives.map((objective, index) => (
        <div key={objective.id} style={{ marginBottom: '6px' }} data-objective={objective.id}>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '3px' }}>
          <span style={{ color: 'var(--ph-muted)', alignSelf: 'center', fontSize: '11px' }} title="Objective id">
            {objective.id}
          </span>
          <input
            style={{ ...field, flex: 1, margin: 0 }}
            value={objective.text}
            onInput={(e) =>
              run(updateObjective(quest.id, index, { text: (e.target as HTMLInputElement).value }))
            }
            onBlur={() => session.endGroup()}
          />
          <label style={{ fontSize: '11px', color: 'var(--ph-muted)', whiteSpace: 'nowrap', alignSelf: 'center' }} title="Kept out of the journal until revealed or done">
            <input
              type="checkbox"
              checked={objective.hidden}
              data-hidden={objective.id}
              onChange={(e) => run(updateObjective(quest.id, index, { hidden: (e.target as HTMLInputElement).checked }))}
            />{' '}
            hidden
          </label>
          <button
            style={small}
            title={quest.objectives.length <= 1 ? 'A quest keeps at least one step' : 'Delete this step'}
            disabled={quest.objectives.length <= 1}
            onClick={() => run(removeObjective(quest.id, index))}
          >
            ✕
          </button>
        </div>
        <textarea
          style={{ ...field, minHeight: '30px', resize: 'vertical', fontSize: '11px', marginBottom: 0 }}
          value={objective.summary}
          placeholder="Then the journal says… (blank: nothing changes)"
          title="What the journal's summary becomes once this step is done"
          data-field="step-summary"
          onInput={(e) => run(updateObjective(quest.id, index, { summary: (e.target as HTMLTextAreaElement).value }))}
          onBlur={() => session.endGroup()}
        />
        </div>
      ))}
      <button
        style={small}
        onClick={() => run(addObjective(quest.id, { id: nextObjectiveId(quest), text: 'Do the next thing.', hidden: false, summary: '' }))}
      >
        + Step
      </button>
    </div>
  );
}
