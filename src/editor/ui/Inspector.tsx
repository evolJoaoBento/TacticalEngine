/**
 * The properties of one object.
 *
 * The last thing a designer had to open a TypeScript file for: a chest's name
 * and flavour, the key it wants, the line it gives when it refuses, and the roll
 * it asks for with a different outcome down each of the five branches.
 *
 * Every change goes through `updateInteractable`, so all of it is undoable and
 * typing a name is one undo step rather than one per keystroke.
 */

import type { CheckRequest, Effect } from '../../engine/script/schema';
import type { QuestDef } from '../../engine/content/quests';
import type { Interactable } from '../../engine/scene/schema';
import { EffectList } from './EffectList';
import { CheckEditor } from './CheckEditor';

export interface InspectorProps {
  interactable: Interactable;
  onChange: (changes: Partial<Interactable>) => void;
  onDelete: () => void;
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
  /**
   * Every model an object can be drawn with: the library's, plus everything the project
   * imported or ships. Passed in rather than read here, because this component is handed
   * its subject and never the session - the same reason it takes `quests` and the id lists.
   */
  models: readonly string[];
}



const heading: Record<string, string | number> = {
  margin: '12px 0 4px',
  font: '600 11px/1 system-ui, sans-serif',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ph-muted)',
};

const label: Record<string, string | number> = {
  display: 'block',
  color: 'var(--ph-muted)',
  fontSize: '11px',
  marginBottom: '2px',
};

const field: Record<string, string | number> = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  marginBottom: '6px',
  background: 'var(--ph-field)',
  color: 'inherit',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  font: 'inherit',
};

const button: Record<string, string | number> = {
  padding: '4px 8px',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

export function Inspector(props: InspectorProps): preact.JSX.Element {
  const object = props.interactable;
  const check = object.check;

  const listProps = {
    sceneIds: props.sceneIds,
    dialogueIds: props.dialogueIds,
    encounterIds: props.encounterIds,
    quests: props.quests,
  };

  return (
    <div style={{ borderTop: '1px solid var(--ph-line)', marginTop: '10px', paddingTop: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <strong style={{ fontSize: '13px' }}>{object.name || object.id}</strong>
        <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>
          {object.kind} · {object.position.x},{object.position.y}
        </span>
      </div>

      <div style={heading}>What it is</div>
      <label style={label}>Name</label>
      <input
        style={field}
        value={object.name}
        onInput={(e) => props.onChange({ name: (e.target as HTMLInputElement).value })}
      />

      <label style={label}>Flavour — read when the party uses it</label>
      <textarea
        style={{ ...field, minHeight: '48px', resize: 'vertical' }}
        value={object.flavor}
        onInput={(e) => props.onChange({ flavor: (e.target as HTMLTextAreaElement).value })}
      />

      <label style={label}>Kind</label>
      <select
        style={field}
        value={object.kind}
        onChange={(e) =>
          props.onChange({ kind: (e.target as HTMLSelectElement).value as Interactable['kind'] })
        }
      >
        {(['chest', 'door', 'pillar', 'portal', 'scripted'] as const).map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>

      <label style={label}>Drawn with</label>
      <select
        style={field}
        data-testid="object-model"
        aria-label={`What ${object.id} is drawn with`}
        value={object.model ?? ''}
        onChange={(e) => {
          const picked = (e.target as HTMLSelectElement).value;
          // Unset is `null`, not '': the schema's "no model of its own" is null, and an
          // empty string would be a model id nothing can resolve.
          props.onChange({ model: picked === '' ? null : picked });
        }}
      >
        {/* The kind's own body is what `scene-view` falls back to. A `scripted` object has
            none, so for that one the fallback is the editor's gold mark and nothing in play,
            which is why the label says what it does rather than naming a shape. */}
        <option value="">The kind's own body</option>
        {props.models.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>

      <label style={{ ...label, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input
          type="checkbox"
          checked={object.blocksMovement}
          onChange={(e) =>
            props.onChange({ blocksMovement: (e.target as HTMLInputElement).checked })
          }
        />
        Blocks movement
      </label>
      <label style={{ ...label, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input
          type="checkbox"
          checked={object.repeatable}
          data-field="repeatable"
          onChange={(e) => props.onChange({ repeatable: (e.target as HTMLInputElement).checked })}
        />
        Can be used again
      </label>

      <div style={heading}>Getting in</div>
      <label style={label}>Key it needs — blank for none</label>
      <input
        style={field}
        value={object.requiresKey ?? ''}
        placeholder="no key needed"
        onInput={(e) => {
          const key = (e.target as HTMLInputElement).value;
          props.onChange({ requiresKey: key === '' ? undefined : key });
        }}
      />
      <label style={label}>What it says when the party lacks it</label>
      <input
        style={field}
        value={object.lockedText}
        onInput={(e) => props.onChange({ lockedText: (e.target as HTMLInputElement).value })}
      />

      <div style={heading}>What it does</div>
      <div style={{ color: 'var(--ph-muted)', fontSize: '11px', marginBottom: '4px' }}>
        Runs with no roll, before any check below.
      </div>
      <EffectList
        testId="object-effects"
        effects={object.effects}
        onChange={(effects) => props.onChange({ effects })}
        {...listProps}
      />

      <div style={heading}>The roll</div>
      {check === undefined ? (
        <button
          style={button}
          onClick={() =>
            props.onChange({ check: { trait: 'finesse', difficulty: 12 } })
          }
        >
          + Ask for a roll
        </button>
      ) : (
        <>
          <CheckEditor check={check} onChange={(next) => props.onChange({ check: next })} {...listProps} />
          <button
            style={{ ...button, marginBottom: '6px' }}
            title="Remove the roll; the object just does what it does"
            onClick={() => props.onChange({ check: undefined })}
          >
            ✕ No roll
          </button>
        </>
      )}

      <div style={heading}>Danger</div>
      <button style={{ ...button, color: 'var(--ph-bad)' }} onClick={props.onDelete}>
        Delete this object
      </button>
    </div>
  );
}
