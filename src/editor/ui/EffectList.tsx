/**
 * Editing a list of effects.
 *
 * This is the piece that lets a designer write what an object *does* without
 * opening a TypeScript file. It covers the flat vocabulary — a line of prose, a
 * flag, a key, loot, damage, travel, a conversation — and shows the recursive
 * ones (`branch`, `choice`, a nested `check`) without pretending to edit them: a
 * tree editor is its own piece of work, and quietly dropping the parts it cannot
 * represent would be worse than saying so.
 *
 * Ids that must resolve — a scene, a dialogue, an encounter — are chosen from
 * what the project actually holds rather than typed, so the commonest authoring
 * error cannot be made here at all.
 */

import type { Effect } from '../../engine/script/schema';
import type { QuestDef } from '../../engine/content/quests';
import { ConditionEditor } from './ConditionEditor';
import { CheckEditor } from './CheckEditor';

export interface EffectListProps {
  /** A hook for tests to find one list among several. */
  testId?: string;
  effects: readonly Effect[];
  onChange: (effects: Effect[]) => void;
  /** What a `goto` can name. */
  sceneIds: readonly string[];
  /** What a `startDialogue` can name. */
  dialogueIds: readonly string[];
  /** What a `startEncounter` can name. */
  encounterIds: readonly string[];
  /** What the quest effects can name — the whole definition, for the objectives. */
  quests: readonly QuestDef[];
}

/** The kinds this can build. Anything else is shown, not offered. */
const ADDABLE = [
  'log',
  'setFlag',
  'clearFlag',
  'giveKey',
  'open',
  'remove',
  'markUsed',
  'loot',
  'damage',
  'heal',
  'startEncounter',
  'goto',
  'startDialogue',
  'startQuest',
  'completeObjective',
  'revealObjective',
  'completeQuest',
  'failQuest',
  'levelUp',
  'branch',
  'check',
  'choice',
  'story',
  'setVar',
  'addVar',
  'addItem',
  'removeItem',
  'endEncounter',
] as const;

type Addable = (typeof ADDABLE)[number];

const LABELS: Readonly<Record<Addable, string>> = {
  log: 'Say something',
  setFlag: 'Set a flag',
  clearFlag: 'Clear a flag',
  giveKey: 'Give a key',
  open: 'Open it',
  remove: 'Remove it',
  markUsed: 'Mark it used',
  loot: 'Give loot',
  damage: 'Deal damage',
  heal: 'Heal',
  startEncounter: 'Start a fight',
  goto: 'Travel to a scene',
  startDialogue: 'Start a conversation',
  startQuest: 'Start a quest',
  completeObjective: 'Complete an objective',
  revealObjective: 'Reveal an objective',
  completeQuest: 'Complete a quest',
  failQuest: 'Fail a quest',
  levelUp: 'Level the party up',
  branch: 'If … then',
  check: 'Ask for a roll',
  choice: 'Ask the player',
  story: 'Story panel',
  setVar: 'Set a variable',
  addVar: 'Add to a variable',
  addItem: 'Give an item',
  removeItem: 'Take an item',
  endEncounter: 'End a fight',
};

const row: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'center',
  // Nested under a branch the panel gets narrow; a field is better on its own
  // line than squeezed to two letters.
  flexWrap: 'wrap',
  gap: '4px',
  marginBottom: '3px',
};

const field: Record<string, string | number> = {
  flex: 1,
  minWidth: 0,
  padding: '3px 5px',
  background: '#1b1f28',
  color: 'inherit',
  border: '1px solid #39404d',
  borderRadius: '3px',
  font: 'inherit',
};

const small: Record<string, string | number> = {
  padding: '2px 6px',
  border: '1px solid #39404d',
  borderRadius: '3px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

/** A starting value for each kind this can add. */
function blank(kind: Addable, props: EffectListProps): Effect {
  switch (kind) {
    case 'log':
      return { kind: 'log', text: '', tone: 'narration' };
    case 'setFlag':
    case 'clearFlag':
      return { kind, flag: 'a-flag' };
    case 'giveKey':
      return { kind: 'giveKey', key: 'a-key' };
    case 'open':
    case 'remove':
    case 'markUsed':
      return { kind };
    case 'loot':
      return { kind: 'loot' };
    case 'damage':
      return { kind: 'damage', amount: 2 };
    case 'heal':
      return { kind: 'heal', amount: 2 };
    case 'startEncounter':
      return { kind: 'startEncounter', encounter: props.encounterIds[0] ?? 'encounter-1' };
    case 'goto':
      return { kind: 'goto', scene: props.sceneIds[0] ?? '' };
    case 'startDialogue':
      return { kind: 'startDialogue', dialogue: props.dialogueIds[0] ?? '' };
    case 'startQuest':
    case 'completeQuest':
    case 'failQuest':
      return { kind, quest: props.quests[0]?.id ?? '' };
    case 'completeObjective':
    case 'revealObjective':
      return {
        kind,
        quest: props.quests[0]?.id ?? '',
        objective: props.quests[0]?.objectives[0]?.id ?? '',
      };
    case 'levelUp':
      return { kind };
    case 'branch':
      return { kind, when: { kind: 'flag', flag: 'a-flag' }, then: [] };
    case 'check':
      return { kind, check: { trait: 'finesse', difficulty: 12 } };
    case 'choice':
      return { kind, title: 'What do you do?', options: [{ label: 'Go on', effects: [] }] };
    case 'story':
      return { kind, title: 'A title', paragraphs: ['What the party sees.'] };
    case 'setVar':
      return { kind, name: 'a-variable', value: 1 };
    case 'addVar':
      return { kind, name: 'a-variable', by: 1 };
    case 'addItem':
    case 'removeItem':
      return { kind, item: 'an-item', quantity: 1 };
    case 'endEncounter':
      return { kind, encounter: props.encounterIds[0] ?? 'encounter-1' };
  }
}

/** A one-line summary of an effect this cannot edit. */
function describe(effect: Effect): string {
  switch (effect.kind) {
    case 'branch':
      return `If ${effect.when.kind}: ${effect.then.length} effect(s), else ${effect.otherwise?.length ?? 0}`;
    case 'choice':
      return `Ask the player (${effect.options.length} options)`;
    case 'check':
      return `Roll ${effect.check.trait} ${effect.check.difficulty}`;
    case 'story':
      return `Story panel: ${effect.title}`;
    case 'setVar':
      return `Set ${effect.name} = ${String(effect.value)}`;
    case 'addVar':
      return `Add ${effect.by} to ${effect.name}`;
    default:
      return effect.kind;
  }
}

export function EffectList(props: EffectListProps): preact.JSX.Element {
  const { effects } = props;

  const replace = (index: number, effect: Effect): void => {
    const next = [...effects];
    next[index] = effect;
    props.onChange(next);
  };
  const remove = (index: number): void =>
    props.onChange(effects.filter((_, i) => i !== index));

  return (
    <div data-testid={props.testId}>
      {effects.map((effect, i) => (
        <div key={i} style={row} data-effect={i}>
          <span style={{ color: '#8ea3b0', width: '70px', flexShrink: 0, fontSize: '11px' }}>
            {effect.kind in LABELS ? LABELS[effect.kind as Addable] : effect.kind}
          </span>
          {renderBody(effect, (next) => replace(i, next), props)}
          <button style={small} title="Remove this effect" onClick={() => remove(i)}>
            ✕
          </button>
        </div>
      ))}

      <select
        value=""
        data-role="add-effect"
        style={{ ...field, flex: 'none', width: '100%', marginTop: '2px' }}
        onChange={(e) => {
          const kind = (e.target as HTMLSelectElement).value as Addable | '';
          if (kind === '') return;
          props.onChange([...effects, blank(kind, props)]);
          (e.target as HTMLSelectElement).value = '';
        }}
      >
        <option value="">+ Add an effect…</option>
        {ADDABLE.map((kind) => (
          <option key={kind} value={kind}>
            {LABELS[kind]}
          </option>
        ))}
      </select>
    </div>
  );
}

function renderBody(
  effect: Effect,
  onChange: (effect: Effect) => void,
  props: EffectListProps,
): preact.JSX.Element {
  const text = (value: string, set: (v: string) => Effect, placeholder = ''): preact.JSX.Element => (
    <input
      style={field}
      value={value}
      placeholder={placeholder}
      onInput={(e) => onChange(set((e.target as HTMLInputElement).value))}
    />
  );
  const pick = (
    value: string,
    options: readonly string[],
    set: (v: string) => Effect,
  ): preact.JSX.Element => (
    <select
      style={field}
      value={value}
      onChange={(e) => onChange(set((e.target as HTMLSelectElement).value))}
    >
      {options.length === 0 ? <option value="">(none in this project)</option> : null}
      {options.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
    </select>
  );

  switch (effect.kind) {
    case 'log':
      return text(effect.text, (text) => ({ ...effect, text }), 'What the player reads');
    case 'setFlag':
    case 'clearFlag':
      return text(effect.flag, (flag) => ({ ...effect, flag }));
    case 'giveKey':
      return text(effect.key, (key) => ({ ...effect, key }));
    case 'loot':
      return text(effect.table ?? '', (table) => ({ ...effect, table }), 'loot table (optional)');
    case 'damage':
    case 'heal':
      return (
        <input
          type="number"
          min={1}
          style={field}
          value={effect.amount}
          onInput={(e) =>
            onChange({ ...effect, amount: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })
          }
        />
      );
    case 'goto':
      return pick(effect.scene, props.sceneIds, (scene) => ({ ...effect, scene }));
    case 'startDialogue':
      return pick(effect.dialogue, props.dialogueIds, (dialogue) => ({ ...effect, dialogue }));
    case 'startEncounter':
      return pick(effect.encounter, props.encounterIds, (encounter) => ({ ...effect, encounter }));
    case 'startQuest':
    case 'completeQuest':
    case 'failQuest':
      return pick(effect.quest, props.quests.map((q) => q.id), (quest) => ({ ...effect, quest }));
    case 'completeObjective':
    case 'revealObjective': {
      // The objective list follows the chosen quest; switching quests resets
      // the objective to that quest's first, so the effect never names a step
      // of a different quest.
      const quest = props.quests.find((q) => q.id === effect.quest);
      return (
        <>
          {pick(effect.quest, props.quests.map((q) => q.id), (id) => ({
            ...effect,
            quest: id,
            objective: props.quests.find((q) => q.id === id)?.objectives[0]?.id ?? '',
          }))}
          {pick(effect.objective, quest?.objectives.map((o) => o.id) ?? [], (objective) => ({
            ...effect,
            objective,
          }))}
        </>
      );
    }
    case 'levelUp':
      return <span style={{ ...field, color: '#8ea3b0' }}>one level, whole party</span>;
    case 'endEncounter':
      return pick(effect.encounter, props.encounterIds, (encounter) => ({ ...effect, encounter }));
    case 'setVar':
      return (
        <>
          {text(effect.name, (name) => ({ ...effect, name }), 'variable')}
          {text(String(effect.value ?? ''), (raw) => {
            const asNumber = Number(raw);
            const value = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(asNumber) ? asNumber : raw;
            return { ...effect, value };
          }, 'value')}
        </>
      );
    case 'addVar':
      return (
        <>
          {text(effect.name, (name) => ({ ...effect, name }), 'variable')}
          <input
            type="number"
            style={{ ...field, flex: 'none', width: '60px' }}
            value={effect.by}
            onInput={(e) => onChange({ ...effect, by: Number((e.target as HTMLInputElement).value) || 0 })}
          />
        </>
      );
    case 'addItem':
    case 'removeItem':
      return (
        <>
          {text(effect.item, (item) => ({ ...effect, item }), 'item id')}
          ×
          <input
            type="number"
            min={1}
            style={{ ...field, flex: 'none', width: '50px' }}
            value={effect.quantity ?? 1}
            onInput={(e) =>
              onChange({ ...effect, quantity: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })
            }
          />
        </>
      );
    case 'story':
      return (
        <div style={{ flex: 1, minWidth: 0 }} data-testid="story">
          {text(effect.title, (title) => ({ ...effect, title }), 'title')}
          <textarea
            style={{ ...field, width: '100%', minHeight: '40px', marginTop: '2px', resize: 'vertical' }}
            placeholder="Paragraphs, one per line"
            value={effect.paragraphs.join('\n')}
            onInput={(e) =>
              onChange({ ...effect, paragraphs: (e.target as HTMLTextAreaElement).value.split('\n') })
            }
          />
        </div>
      );
    case 'check':
      return (
        <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #39404d', paddingLeft: '6px' }} data-testid="check-effect">
          <CheckEditor
            check={effect.check}
            onChange={(check) => onChange({ ...effect, check })}
            sceneIds={props.sceneIds}
            dialogueIds={props.dialogueIds}
            encounterIds={props.encounterIds}
            quests={props.quests}
          />
        </div>
      );
    case 'choice':
      return (
        <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #39404d', paddingLeft: '6px' }} data-testid="choice">
          {text(effect.title ?? '', (title) => ({ ...effect, ...(title === '' ? { title: undefined } : { title }) }), 'title')}
          {text(effect.body ?? '', (body) => ({ ...effect, ...(body === '' ? { body: undefined } : { body }) }), 'what the player is told')}
          {effect.options.map((option, i) => (
            <div key={i} style={{ marginTop: '4px', paddingLeft: '4px', borderLeft: '1px solid #2a303a' }} data-option={i}>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  style={field}
                  value={option.label}
                  placeholder="what the player can say or do"
                  onInput={(e) =>
                    onChange({
                      ...effect,
                      options: effect.options.map((o, j) => (j === i ? { ...o, label: (e.target as HTMLInputElement).value } : o)),
                    })
                  }
                />
                <button
                  style={small}
                  title="Remove this option"
                  onClick={() => onChange({ ...effect, options: effect.options.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
              {option.available === undefined ? (
                <button
                  style={{ ...small, marginTop: '2px' }}
                  data-role="gate-option"
                  onClick={() =>
                    onChange({
                      ...effect,
                      options: effect.options.map((o, j) => (j === i ? { ...o, available: { kind: 'flag', flag: 'a-flag' } } : o)),
                    })
                  }
                >
                  if…
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-start', marginTop: '2px' }}>
                  <span style={{ color: '#8ea3b0', fontSize: '11px', paddingTop: '3px' }}>shown if</span>
                  <ConditionEditor
                    condition={option.available}
                    quests={props.quests}
                    encounterIds={props.encounterIds}
                    onChange={(available) =>
                      onChange({ ...effect, options: effect.options.map((o, j) => (j === i ? { ...o, available } : o)) })
                    }
                  />
                  <button
                    style={small}
                    title="Remove the gate"
                    onClick={() =>
                      onChange({
                        ...effect,
                        options: effect.options.map((o, j) => {
                          if (j !== i) return o;
                          const { available: _dropped, ...rest } = o;
                          return rest;
                        }),
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              )}
              <EffectList
                {...props}
                testId={undefined}
                effects={option.effects}
                onChange={(effects) => onChange({ ...effect, options: effect.options.map((o, j) => (j === i ? { ...o, effects } : o)) })}
              />
            </div>
          ))}
          <button
            style={{ ...small, marginTop: '4px' }}
            data-role="add-option"
            onClick={() => onChange({ ...effect, options: [...effect.options, { label: 'Another option', effects: [] }] })}
          >
            + Option
          </button>
        </div>
      );
    case 'branch':
      // A whole little script under a gate: the condition, then the two lists.
      return (
        <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #39404d', paddingLeft: '6px' }} data-testid="branch">
          <ConditionEditor
            condition={effect.when}
            quests={props.quests}
            encounterIds={props.encounterIds}
            onChange={(when) => onChange({ ...effect, when })}
          />
          <div style={{ color: '#8ea3b0', fontSize: '11px' }}>then</div>
          <EffectList {...props} testId={undefined} effects={effect.then} onChange={(then) => onChange({ ...effect, then })} />
          <div style={{ color: '#8ea3b0', fontSize: '11px' }}>otherwise</div>
          <EffectList
            {...props}
            testId={undefined}
            effects={effect.otherwise ?? []}
            onChange={(otherwise) => onChange({ ...effect, ...(otherwise.length === 0 ? { otherwise: undefined } : { otherwise }) })}
          />
        </div>
      );
    case 'open':
    case 'remove':
    case 'markUsed':
    case 'none':
      return <span style={{ ...field, color: '#8ea3b0' }}>this object</span>;
    default:
      // Recursive and rarer effects: shown so nothing is hidden, and removable,
      // but not editable here.
      return (
        <span style={{ ...field, color: '#c8b88a' }} title="Edit this one in the project file">
          {describe(effect)}
        </span>
      );
  }
}
