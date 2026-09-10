/**
 * Quests, as a workspace: the list on the left, the open quest's form beside it.
 *
 * Moved out of the side panel, where one long quest pushed everything under it
 * off the screen. A click opens a quest rather than toggling it, so clicking
 * the open one again leaves it open.
 */

import { useState } from 'preact/hooks';
import { questSchema } from '../../engine/content/quests';
import { addQuest, removeQuest, type EditorSession } from '../session';
import { QuestEditor } from './QuestEditor';
import { Icon } from './icons';

export function QuestsWorkspace(props: {
  session: EditorSession;
  onChange: () => void;
  onClose: () => void;
}): preact.JSX.Element {
  const { session } = props;
  const [open, setOpen] = useState<string | null>(null);
  const quest = session.project.quests.find((q) => q.id === open) ?? null;

  return (
    <div class="ph-workspace-panel" data-testid="quests-panel">
      <div class="ph-workspace-list" data-testid="quest-list">
        <div class="ph-row">
          <strong style={{ flex: 1 }}>Quests</strong>
          <button class="ph-mini" data-testid="close-quests" aria-label="Close" onClick={props.onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {session.project.quests.map((q) => (
          <div key={q.id} class="ph-row">
            <button class={q.id === open ? 'ph-item ph-on' : 'ph-item'} data-quest={q.id} onClick={() => setOpen(q.id)}>
              {q.name} <small>{q.objectives.length} steps</small>
            </button>
            <button
              class="ph-mini"
              title="Delete this quest"
              onClick={() => {
                if (!confirm(`Delete "${q.name}"?`)) return;
                session.run(removeQuest(q.id));
                if (open === q.id) setOpen(null);
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          class="ph-item"
          data-testid="add-quest"
          onClick={() => {
            const name = prompt('Quest name', 'A quest');
            if (name === null || name.trim() === '') return;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (id === '' || session.project.quests.some((q) => q.id === id)) return;
            session.run(
              addQuest(
                questSchema.parse({
                  id,
                  name: name.trim(),
                  objectives: [{ id: 'first-step', text: 'Do the first thing.' }],
                }),
              ),
            );
            setOpen(id);
            props.onChange();
          }}
        >
          + Quest
        </button>
      </div>
      <div class="ph-workspace-body">
        {quest === null ? (
          <div class="ph-hint">Pick a quest to write its steps.</div>
        ) : (
          <QuestEditor session={session} quest={quest} onChange={props.onChange} />
        )}
      </div>
    </div>
  );
}
