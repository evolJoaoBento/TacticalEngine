/**
 * Edit a roll: the trait, the difficulty, the prompt, and what each of the
 * five outcomes does.
 *
 * One component for the three places a roll can live — on an object, inside
 * an effect list, on a reply — so the outcome fallback rule is explained once
 * and the lists look the same everywhere. A dialogue's check also names the
 * nodes a success and a failure lead to; pass `nodeIds` and those appear.
 */

import type { CheckRequest, Effect } from '../../engine/script/schema';
import type { QuestDef } from '../../engine/content/quests';
import { EffectList } from './EffectList';
import { TargetEditor } from './TargetEditor';

export interface CheckEditorProps<T extends CheckRequest> {
  check: T;
  onChange: (check: T) => void;
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
  /** Hide the trait/difficulty row when the caller draws its own. */
  showHeader?: boolean;
  /**
   * Show who the roll is against and whether it reuses the last one. Off for a
   * dialogue's or an object's check, where there is nobody to roll against.
   */
  showTargets?: boolean;
  /** Hooks a `run` effect inside an outcome can name. */
  hookIds?: readonly string[];
  /** Cards a token effect inside an outcome can name. */
  abilityIds?: readonly string[];
  /** For a reply's check: the nodes a success or a failure can lead to. */
  nodeIds?: readonly string[];
}

export const TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] as const;

/**
 * The five outcomes, and the field each one's effects live in. Content rarely
 * writes all five: a missing outcome falls back to a less specific one at
 * runtime, which is why the hint says so rather than the editor filling them in.
 */
export const OUTCOMES = [
  ['onCriticalSuccess', 'Critical success'],
  ['onSuccessWithHope', 'Success with Hope'],
  ['onSuccessWithFear', 'Success with Fear'],
  ['onFailureWithHope', 'Failure with Hope'],
  ['onFailureWithFear', 'Failure with Fear'],
  ['always', 'Always, whichever way it went'],
] as const satisfies readonly (readonly [keyof CheckRequest, string])[];

const field: Record<string, string | number> = {
  flex: 1,
  minWidth: 0,
  padding: '3px 5px',
  background: 'var(--ph-field)',
  color: 'inherit',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  font: 'inherit',
};

export function CheckEditor<T extends CheckRequest>(props: CheckEditorProps<T>): preact.JSX.Element {
  const { check, onChange } = props;
  const listProps = {
    sceneIds: props.sceneIds,
    dialogueIds: props.dialogueIds,
    encounterIds: props.encounterIds,
    quests: props.quests,
    ...(props.hookIds === undefined ? {} : { hookIds: props.hookIds }),
    ...(props.abilityIds === undefined ? {} : { abilityIds: props.abilityIds }),
  };

  /** Set or delete one optional field, so nothing is written as `undefined`. */
  const setField = (key: keyof CheckRequest, value: unknown): void => {
    const next = { ...check } as Record<string, unknown>;
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next as T);
  };

  /** Replace one outcome's effects, dropping the field when it empties. */
  const setOutcome = (key: keyof CheckRequest, effects: Effect[]): void => {
    const next = { ...check } as Record<string, unknown>;
    if (effects.length === 0) delete next[key];
    else next[key] = effects;
    onChange(next as T);
  };

  const gotoSelect = (key: 'gotoOnSuccess' | 'gotoOnFailure', label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--ph-muted)' }}>
      {label}
      <select
        style={field}
        data-testid={key}
        value={((check as Record<string, unknown>)[key] as string | undefined) ?? ''}
        onChange={(e) => {
          const value = (e.target as HTMLSelectElement).value;
          const next = { ...check } as Record<string, unknown>;
          if (value === '') delete next[key];
          else next[key] = value;
          onChange(next as T);
        }}
      >
        <option value="">— stays here —</option>
        {(props.nodeIds ?? []).map((id) => (
          <option key={id} value={id}>
            → {id}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div data-testid="check-editor">
      {props.showHeader !== false ? (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
          <select
            style={field}
            data-testid="check-trait"
            value={check.trait}
            onChange={(e) => onChange({ ...check, trait: (e.target as HTMLSelectElement).value as CheckRequest['trait'] })}
          >
            {[...TRAITS, 'spellcast', 'weapon'].map((trait) => (
              <option key={trait} value={trait}>
                {trait}
              </option>
            ))}
          </select>
          {check.difficulty === 'target' ? (
            <span style={{ ...field, flex: 'none', color: 'var(--ph-muted)' }} data-testid="check-difficulty">
              vs target
            </span>
          ) : (
            <input
              type="number"
              min={1}
              style={{ ...field, flex: 'none', width: '56px' }}
              data-testid="check-difficulty"
              value={check.difficulty}
              onInput={(e) =>
                onChange({ ...check, difficulty: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })
              }
            />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--ph-muted)' }} title="Roll against each target's own Difficulty">
            <input
              type="checkbox"
              checked={check.difficulty === 'target'}
              onChange={(e) => onChange({ ...check, difficulty: (e.target as HTMLInputElement).checked ? 'target' : 12 })}
            />
            target
          </label>
          <input
            style={{ ...field, flex: 2 }}
            placeholder="Prompt shown with the roll (optional)"
            value={check.prompt ?? ''}
            onInput={(e) => {
              const prompt = (e.target as HTMLInputElement).value;
              const next = { ...check } as Record<string, unknown>;
              if (prompt === '') delete next['prompt'];
              else next['prompt'] = prompt;
              onChange(next as T);
            }}
          />
        </div>
      ) : null}

      {props.showTargets === true ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>against</span>
          <TargetEditor
            testId="check-targets"
            selector={check.targets}
            fallback="the chosen target"
            onChange={(targets) => setField('targets', targets)}
          />
          <label
            style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--ph-muted)' }}
            title="No new dice: the last roll made in this script stands against each target's Difficulty"
          >
            <input
              type="checkbox"
              data-testid="check-reuse"
              checked={check.roll === 'last'}
              onChange={(e) => setField('roll', (e.target as HTMLInputElement).checked ? 'last' : undefined)}
            />
            reuse the last roll
          </label>
        </div>
      ) : null}

      {props.nodeIds !== undefined ? (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
          {gotoSelect('gotoOnSuccess', 'on success')}
          {gotoSelect('gotoOnFailure', 'on failure')}
        </div>
      ) : null}

      <div style={{ color: 'var(--ph-muted)', fontSize: '11px', marginBottom: '4px' }}>
        An outcome left empty falls back to a less specific one, so writing a success and a failure
        covers all five.
      </div>

      {OUTCOMES.map(([key, title]) => (
        <div key={key} style={{ marginBottom: '6px' }} data-outcome={key}>
          <div style={{ color: 'var(--ph-label)', fontSize: '11px', marginBottom: '2px' }}>{title}</div>
          <EffectList
            effects={(check[key] as Effect[] | undefined) ?? []}
            onChange={(effects) => setOutcome(key, effects)}
            {...listProps}
          />
        </div>
      ))}
    </div>
  );
}
