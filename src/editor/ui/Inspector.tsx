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

export interface InspectorProps {
  interactable: Interactable;
  onChange: (changes: Partial<Interactable>) => void;
  onDelete: () => void;
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
}

const TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] as const;

/**
 * The five outcomes, and the field each one's effects live in.
 *
 * Content rarely writes all five: a missing outcome falls back to a less
 * specific one at runtime, which is why the hint below says so rather than the
 * editor filling them all in.
 */
const OUTCOMES = [
  ['onCriticalSuccess', 'Critical success'],
  ['onSuccessWithHope', 'Success with Hope'],
  ['onSuccessWithFear', 'Success with Fear'],
  ['onFailureWithHope', 'Failure with Hope'],
  ['onFailureWithFear', 'Failure with Fear'],
] as const satisfies readonly (readonly [keyof CheckRequest, string])[];

const heading: Record<string, string | number> = {
  margin: '12px 0 4px',
  font: '600 11px/1 system-ui, sans-serif',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#8ea3b0',
};

const label: Record<string, string | number> = {
  display: 'block',
  color: '#8ea3b0',
  fontSize: '11px',
  marginBottom: '2px',
};

const field: Record<string, string | number> = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  marginBottom: '6px',
  background: '#1b1f28',
  color: 'inherit',
  border: '1px solid #39404d',
  borderRadius: '3px',
  font: 'inherit',
};

const button: Record<string, string | number> = {
  padding: '4px 8px',
  border: '1px solid #39404d',
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

  /** Replace one outcome's effects, dropping the field when it empties. */
  const setOutcome = (key: keyof CheckRequest, effects: Effect[]): void => {
    if (check === undefined) return;
    const next: CheckRequest = { ...check };
    if (effects.length === 0) delete (next as Record<string, unknown>)[key];
    else (next as Record<string, unknown>)[key] = effects;
    props.onChange({ check: next });
  };

  return (
    <div style={{ borderTop: '1px solid #39404d', marginTop: '10px', paddingTop: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <strong style={{ fontSize: '13px' }}>{object.name || object.id}</strong>
        <span style={{ color: '#8ea3b0', fontSize: '11px' }}>
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
      <div style={{ color: '#8ea3b0', fontSize: '11px', marginBottom: '4px' }}>
        Runs with no roll, before any check below.
      </div>
      <EffectList
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
          <div style={{ display: 'flex', gap: '6px' }}>
            <select
              style={field}
              value={check.trait}
              onChange={(e) =>
                props.onChange({
                  check: { ...check, trait: (e.target as HTMLSelectElement).value as CheckRequest['trait'] },
                })
              }
            >
              {TRAITS.map((trait) => (
                <option key={trait} value={trait}>
                  {trait}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              style={field}
              value={check.difficulty}
              onInput={(e) =>
                props.onChange({
                  check: {
                    ...check,
                    difficulty: Math.max(1, Number((e.target as HTMLInputElement).value) || 1),
                  },
                })
              }
            />
            <button
              style={{ ...button, marginBottom: '6px' }}
              title="Remove the roll; the object just does what it does"
              onClick={() => props.onChange({ check: undefined })}
            >
              ✕
            </button>
          </div>

          <div style={{ color: '#8ea3b0', fontSize: '11px', marginBottom: '4px' }}>
            An outcome left empty falls back to a less specific one, so writing a success and a
            failure covers all five.
          </div>

          {OUTCOMES.map(([key, title]) => (
            <div key={key} style={{ marginBottom: '6px' }}>
              <div style={{ color: '#c8b88a', fontSize: '11px', marginBottom: '2px' }}>{title}</div>
              <EffectList
                effects={(check[key] as Effect[] | undefined) ?? []}
                onChange={(effects) => setOutcome(key, effects)}
                {...listProps}
              />
            </div>
          ))}
        </>
      )}

      <div style={heading}>Danger</div>
      <button style={{ ...button, color: '#ff8f7a' }} onClick={props.onDelete}>
        Delete this object
      </button>
    </div>
  );
}
