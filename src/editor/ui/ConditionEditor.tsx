/**
 * Edit a condition — the gate on a branch, a reply, an option.
 *
 * Conditions nest (`not`, `all`, `any`), so this renders itself for the inner
 * ones. Ids that are content — quests, objectives, encounters — are picked
 * from dropdowns; flags, items and variables are free strings because that is
 * what they are in the schema. Every change hands back a whole new condition;
 * the caller decides what edit that becomes.
 */

import type { Condition, CountName } from '../../engine/script/schema';
import { COUNT_NAMES } from '../../engine/script/schema';
import type { QuestDef } from '../../engine/content/quests';
import { TargetEditor } from './TargetEditor';

export interface ConditionEditorProps {
  condition: Condition;
  onChange: (condition: Condition) => void;
  quests: readonly QuestDef[];
  encounterIds: readonly string[];
  /** Objects in the scene, for the `interactable` condition. */
  interactableIds?: readonly string[];
  /** Hooks the project defines, for the `hook` condition. */
  hookIds?: readonly string[];
  /** How deep this editor is nested, to keep the indent honest. */
  depth?: number;
}

/**
 * The numbers a feature can read off the blow that called for it, in the words
 * a designer would use. Shared with the effect rows, which offer the same list
 * wherever an amount is written.
 */
export const COUNT_LABELS: Record<CountName, string> = {
  hitPointsTaken: 'HP it marked on me',
  hitPointsDealt: 'HP I have marked',
  targetsHit: 'how many it hit',
};

const KINDS: readonly { kind: Condition['kind']; label: string }[] = [
  { kind: 'always', label: 'always' },
  { kind: 'never', label: 'never' },
  { kind: 'flag', label: 'a flag is set' },
  { kind: 'hasItem', label: 'the party carries' },
  { kind: 'hasKey', label: 'the party has a key' },
  { kind: 'var', label: 'a variable compares' },
  { kind: 'quest', label: 'a quest is' },
  { kind: 'objectiveDone', label: 'an objective is done' },
  { kind: 'interactable', label: 'an object is' },
  { kind: 'encounter', label: 'a fight is' },
  { kind: 'partyAlive', label: 'party alive' },
  { kind: 'adversariesAlive', label: 'adversaries alive' },
  { kind: 'pool', label: 'a pool compares' },
  { kind: 'count', label: 'the blow compares' },
  { kind: 'rolled', label: 'the roll was' },
  { kind: 'rollTagged', label: 'the roll was for' },
  { kind: 'hasMark', label: 'has a spot marked' },
  { kind: 'inCombat', label: 'in a fight' },
  { kind: 'loadout', label: "a domain's cards in the loadout" },
  { kind: 'hasCondition', label: 'the target has a condition' },
  { kind: 'withinRange', label: 'the target is within' },
  { kind: 'side', label: 'the target is on the side of' },
  { kind: 'self', label: 'the target is the one asking' },
  { kind: 'tokens', label: "a card's tokens compare" },
  { kind: 'nearby', label: 'how many creatures are there' },
  { kind: 'hook', label: 'logic in code says' },
  { kind: 'not', label: 'not …' },
  { kind: 'all', label: 'all of …' },
  { kind: 'any', label: 'any of …' },
];

const field: Record<string, string | number> = {
  minWidth: 0,
  padding: '2px 4px',
  background: '#1b1f28',
  color: 'inherit',
  border: '1px solid #39404d',
  borderRadius: '3px',
  font: 'inherit',
  fontSize: '11px',
};

const small: Record<string, string | number> = {
  padding: '1px 5px',
  border: '1px solid #39404d',
  borderRadius: '3px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
};

/** A fresh condition of a kind, with the first sensible content id filled in. */
export function blankCondition(kind: Condition['kind'], props: Pick<ConditionEditorProps, 'quests' | 'encounterIds' | 'interactableIds' | 'hookIds'>): Condition {
  switch (kind) {
    case 'always':
    case 'never':
      return { kind };
    case 'flag':
      return { kind, flag: 'a-flag' };
    case 'hasItem':
      return { kind, item: 'an-item' };
    case 'hasKey':
      return { kind, key: 'a-key' };
    case 'var':
      return { kind, name: 'a-variable', op: '==', value: 1 };
    case 'quest':
      return { kind, quest: props.quests[0]?.id ?? '', status: 'active' };
    case 'objectiveDone':
      return { kind, quest: props.quests[0]?.id ?? '', objective: props.quests[0]?.objectives[0]?.id ?? '' };
    case 'interactable':
      return { kind, id: props.interactableIds?.[0] ?? 'an-object', state: 'used' };
    case 'encounter':
      return { kind, id: props.encounterIds[0] ?? 'a-fight', state: 'ended' };
    case 'partyAlive':
    case 'adversariesAlive':
      return { kind, op: '>', value: 0 };
    case 'pool':
      return { kind, pool: 'stress', op: '>=', value: 1 };
    case 'count':
      return { kind, of: 'hitPointsTaken', op: '>=', value: 2 };
    case 'rolled':
      return { kind, is: 'failure' };
    case 'rollTagged':
      return { kind, tag: 'social' };
    case 'hasMark':
      return { kind, mark: 'rift' };
    case 'inCombat':
      return { kind };
    case 'hasCondition':
      return { kind, condition: 'vulnerable' };
    case 'withinRange':
      return { kind, range: 'close' };
    case 'side':
      return { kind, is: 'ally' };
    case 'self':
      return { kind };
    case 'hook':
      return { kind, hook: props.hookIds?.[0] ?? 'a-hook' };
    case 'tokens':
      return { kind, ability: 'a-card', op: '>=', value: 1 };
    // "Another Dire Wolf within Melee range of the target": the shape this is
    // almost always reached for, with the one asking left out of its own count.
    case 'nearby':
      return { kind, of: { kind: 'adversaries', range: 'melee', around: 'target', except: 'actor' }, op: '>=', value: 1 };
    case 'loadout':
      return { kind, domain: 'blade', op: '>=', value: 4 };
    case 'not':
      return { kind, of: { kind: 'always' } };
    case 'all':
    case 'any':
      return { kind, of: [{ kind: 'always' }] };
  }
}

export function ConditionEditor(props: ConditionEditorProps): preact.JSX.Element {
  const { condition, onChange } = props;
  const depth = props.depth ?? 0;

  const select = <T extends string>(value: T, options: readonly { id: T; label?: string }[], set: (v: T) => void, testId?: string) => (
    <select style={field} value={value} data-testid={testId} onChange={(e) => set((e.target as HTMLSelectElement).value as T)}>
      {options.length === 0 ? <option value="">(none)</option> : null}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label ?? o.id}
        </option>
      ))}
    </select>
  );
  const text = (value: string, set: (v: string) => void, placeholder = '') => (
    <input style={{ ...field, width: '90px' }} value={value} placeholder={placeholder} onInput={(e) => set((e.target as HTMLInputElement).value)} />
  );
  const number = (value: number, set: (v: number) => void) => (
    <input type="number" style={{ ...field, width: '50px' }} value={value} onInput={(e) => set(Number((e.target as HTMLInputElement).value) || 0)} />
  );
  const ops = ['==', '!=', '<', '<=', '>', '>='] as const;

  const body = (): preact.JSX.Element | null => {
    switch (condition.kind) {
      case 'always':
      case 'never':
        return null;
      case 'flag':
        return text(condition.flag, (flag) => onChange({ ...condition, flag }), 'flag');
      case 'hasKey':
        return text(condition.key, (key) => onChange({ ...condition, key }), 'key');
      case 'hasItem':
        return (
          <>
            {text(condition.item, (item) => onChange({ ...condition, item }), 'item id')}
            ×{number(condition.quantity ?? 1, (quantity) => onChange({ ...condition, quantity: Math.max(1, quantity) }))}
          </>
        );
      case 'var':
        return (
          <>
            {text(condition.name, (name) => onChange({ ...condition, name }), 'variable')}
            {select(condition.op, ops.map((id) => ({ id })), (op) => onChange({ ...condition, op }))}
            {text(String(condition.value ?? ''), (raw) => {
              const asNumber = Number(raw);
              const value = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(asNumber) ? asNumber : raw;
              onChange({ ...condition, value });
            }, 'value')}
          </>
        );
      case 'quest':
        return (
          <>
            {select(condition.quest, props.quests.map((q) => ({ id: q.id, label: q.name })), (quest) => onChange({ ...condition, quest }), 'cond-quest')}
            {select(condition.status, (['inactive', 'active', 'completed', 'failed'] as const).map((id) => ({ id })), (status) => onChange({ ...condition, status }), 'cond-status')}
          </>
        );
      case 'objectiveDone': {
        const quest = props.quests.find((q) => q.id === condition.quest);
        return (
          <>
            {select(
              condition.quest,
              props.quests.map((q) => ({ id: q.id, label: q.name })),
              (id) => onChange({ ...condition, quest: id, objective: props.quests.find((q) => q.id === id)?.objectives[0]?.id ?? '' }),
              'cond-quest',
            )}
            {select(condition.objective, (quest?.objectives ?? []).map((o) => ({ id: o.id, label: o.text })), (objective) => onChange({ ...condition, objective }), 'cond-objective')}
          </>
        );
      }
      case 'interactable':
        return (
          <>
            {props.interactableIds !== undefined && props.interactableIds.length > 0
              ? select(condition.id, props.interactableIds.map((id) => ({ id })), (id) => onChange({ ...condition, id }))
              : text(condition.id, (id) => onChange({ ...condition, id }), 'object id')}
            {select(condition.state, (['used', 'open', 'removed'] as const).map((id) => ({ id })), (state) => onChange({ ...condition, state }))}
          </>
        );
      case 'encounter':
        return (
          <>
            {select(condition.id, props.encounterIds.map((id) => ({ id })), (id) => onChange({ ...condition, id }))}
            {select(condition.state, (['started', 'ended', 'triggered'] as const).map((id) => ({ id })), (state) => onChange({ ...condition, state }))}
          </>
        );
      case 'partyAlive':
      case 'adversariesAlive':
        return (
          <>
            {select(condition.op, ops.map((id) => ({ id })), (op) => onChange({ ...condition, op }))}
            {number(condition.value, (value) => onChange({ ...condition, value }))}
          </>
        );
      case 'rolled':
        return select(
          condition.is,
          (['failure', 'success', 'withFear', 'withHope', 'critical'] as const).map((id) => ({ id })),
          (is) => onChange({ ...condition, is }),
        );
      case 'rollTagged':
        // A word the check that made the roll put on itself: "social", "lock".
        return text(condition.tag, (tag) => onChange({ ...condition, tag }));
      case 'hasMark':
        // The name a card marks the ground under: "rift", "phantom".
        return text(condition.mark, (mark) => onChange({ ...condition, mark }));
      case 'count':
        return (
          <>
            {select(condition.of, COUNT_NAMES.map((id) => ({ id, label: COUNT_LABELS[id] })), (of) => onChange({ ...condition, of }))}
            {select(condition.op, ops.map((id) => ({ id })), (op) => onChange({ ...condition, op }))}
            {number(condition.value, (value) => onChange({ ...condition, value }))}
          </>
        );
      case 'pool':
        return (
          <>
            {select(condition.pool, (['hitPoints', 'stress', 'armorSlots', 'hope'] as const).map((id) => ({ id })), (pool) => onChange({ ...condition, pool }))}
            {select(condition.measure ?? 'available', (['available', 'marked', 'max'] as const).map((id) => ({ id })), (measure) => onChange({ ...condition, measure }))}
            {select(condition.op, ops.map((id) => ({ id })), (op) => onChange({ ...condition, op }))}
            {number(condition.value, (value) => onChange({ ...condition, value }))}
          </>
        );
      case 'inCombat':
      case 'self':
        return null;
      case 'hasCondition':
        return text(condition.condition, (name) => onChange({ ...condition, condition: name }), 'condition');
      case 'withinRange':
        return select(
          condition.range,
          (['melee', 'veryClose', 'close', 'far', 'veryFar'] as const).map((id) => ({ id })),
          (range) => onChange({ ...condition, range }),
        );
      case 'side':
        return select(
          condition.is,
          (['ally', 'adversary'] as const).map((id) => ({ id })),
          (is) => onChange({ ...condition, is }),
        );
      case 'loadout':
        return (
          <>
            {text(condition.domain, (domain) => onChange({ ...condition, domain }), 'domain')}
            {select(condition.op, ops.map((id) => ({ id })), (op) => onChange({ ...condition, op }))}
            {number(condition.value, (value) => onChange({ ...condition, value }))}
          </>
        );
      case 'tokens':
        return (
          <>
            {text(condition.ability, (ability) => onChange({ ...condition, ability }), 'card id')}
            {select(condition.op, ops.map((id) => ({ id })), (op) => onChange({ ...condition, op }))}
            {number(condition.value, (value) => onChange({ ...condition, value }))}
          </>
        );
      case 'nearby':
        return (
          <>
            <TargetEditor
              selector={condition.of}
              fallback="pick who"
              testId="cond-nearby"
              onChange={(of) =>
                onChange({ ...condition, of: of ?? { kind: 'adversaries', range: 'melee', around: 'target', except: 'actor' } })
              }
            />
            {select(condition.op, ops.map((id) => ({ id })), (op) => onChange({ ...condition, op }))}
            {/* A written number, or as many as somebody holds of a pool. */}
            {select(
              typeof condition.value === 'number' ? 'number' : condition.value.pool,
              [{ id: 'number' }, { id: 'hope' }, { id: 'stress' }, { id: 'hitPoints' }, { id: 'armorSlots' }],
              (pick) =>
                onChange({
                  ...condition,
                  value:
                    pick === 'number'
                      ? 1
                      : { pool: pick as 'hope' | 'stress' | 'hitPoints' | 'armorSlots', measure: 'available' },
                }),
              'cond-nearby-value',
            )}
            {typeof condition.value === 'number'
              ? number(condition.value, (value) => onChange({ ...condition, value }))
              : null}
          </>
        );
      case 'hook':
        return props.hookIds !== undefined && props.hookIds.length > 0
          ? select(condition.hook, props.hookIds.map((id) => ({ id })), (hook) => onChange({ ...condition, hook }), 'cond-hook')
          : text(condition.hook, (hook) => onChange({ ...condition, hook }), 'hook id');
      case 'not':
        return (
          <div style={{ marginLeft: '12px', marginTop: '2px' }}>
            <ConditionEditor {...props} condition={condition.of} depth={depth + 1} onChange={(of) => onChange({ ...condition, of })} />
          </div>
        );
      case 'all':
      case 'any':
        return (
          <div style={{ marginLeft: '12px', marginTop: '2px' }}>
            {condition.of.map((inner, i) => (
              <div key={i} style={{ display: 'flex', gap: '3px', alignItems: 'flex-start' }}>
                <ConditionEditor
                  {...props}
                  condition={inner}
                  depth={depth + 1}
                  onChange={(next) => onChange({ ...condition, of: condition.of.map((c, j) => (j === i ? next : c)) })}
                />
                <button style={small} title="Remove" onClick={() => onChange({ ...condition, of: condition.of.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <button style={small} onClick={() => onChange({ ...condition, of: [...condition.of, { kind: 'always' }] })}>
              + condition
            </button>
          </div>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center', marginBottom: '2px' }} data-testid="condition" data-depth={depth}>
      {select(condition.kind, KINDS.map((k) => ({ id: k.kind, label: k.label })), (kind) => onChange(blankCondition(kind, props)), 'cond-kind')}
      {body()}
    </div>
  );
}
