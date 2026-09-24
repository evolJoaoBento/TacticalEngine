/**
 * Choosing what a prop does, and setting it up.
 *
 * A select of every function the engine knows - None first, and chosen until something else is -
 * and below it the settings of whichever is picked. Trapped's success and failure are functions of
 * their own, so this draws itself again for each of them: a trap whose success is a container of
 * potions and whose failure is a portal to the pit is set up in one place, all the way down.
 *
 * The component holds nothing but a portal's half-typed pair id. Everything else is the caller's -
 * it is handed a function and says what the function should become - which is what lets the same
 * panel edit the prop that is selected and the settings the next prop will be placed with.
 */

import { useState } from 'preact/hooks';
import { FUNCTION_KINDS, PROP_FUNCTIONS } from '../../engine/scene/prop-functions';
import type { PropFunction, PropFunctionKind } from '../../engine/scene/prop-function-schema';
import type { QuestDef } from '../../engine/content/quests';
import { CheckEditor } from './CheckEditor';
import { EffectList } from './EffectList';

type Of<K extends PropFunctionKind> = Extract<PropFunction, { kind: K }>;

/** The traits a trap can ask for: the six, and the two that stand for another. */
const TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge', 'spellcast', 'weapon'] as const;

export interface PropFunctionEditorProps {
  value: PropFunction | undefined;
  onChange: (next: PropFunction | undefined) => void;
  /** Tells the controls apart when a Trapped prop draws this again for its success and failure. */
  prefix?: string;
  /** What a container can hold: the project's items. */
  items: readonly { id: string; name: string }[];
  /** The props holding a pair id when it cannot be given to this one; empty when it can. */
  pairTakenBy: (pair: string) => readonly string[];
  /** The prop at the other end of a pair, when it has one yet. */
  partnerOf: (pair: string) => string | null;
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
}

export function PropFunctionEditor(props: PropFunctionEditorProps): preact.JSX.Element {
  const prefix = props.prefix ?? '';
  const value = props.value;
  return (
    <div class="ph-function" data-testid={`${prefix}function-editor`}>
      <select
        class="ph-select"
        data-testid={`${prefix}function`}
        aria-label={prefix === '' ? 'What this prop does' : `What happens on a ${prefix.replace(/-$/, '')}`}
        value={value?.kind ?? ''}
        onChange={(e) => {
          const kind = (e.target as HTMLSelectElement).value as PropFunctionKind | '';
          props.onChange(kind === '' ? undefined : PROP_FUNCTIONS[kind].fresh());
        }}
      >
        <option value="">None</option>
        {FUNCTION_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {PROP_FUNCTIONS[kind].label}
          </option>
        ))}
      </select>
      {value === undefined ? null : <div class="ph-note">{PROP_FUNCTIONS[value.kind].summary}</div>}
      {value?.kind === 'container' ? <ContainerSettings {...props} value={value} /> : null}
      {value?.kind === 'trapped' ? <TrappedSettings {...props} value={value} /> : null}
      {value?.kind === 'portal' ? <PortalSettings {...props} value={value} /> : null}
      {value?.kind === 'interaction' ? <InteractionSettings {...props} value={value} /> : null}
      {value?.kind === 'script' ? <ScriptSettings {...props} value={value} /> : null}
    </div>
  );
}

type Settings<K extends PropFunctionKind> = Omit<PropFunctionEditorProps, 'value'> & { value: Of<K> };

/** Things in a container, added one at a time. The same thing added again is one more of it. */
function ContainerSettings(props: Settings<'container'>): preact.JSX.Element {
  const prefix = props.prefix ?? '';
  const [adding, setAdding] = useState(props.items[0]?.id ?? '');
  const nameOf = (item: string): string => props.items.find((known) => known.id === item)?.name ?? item;
  const add = (): void => {
    if (adding === '') return;
    const has = props.value.items.find((line) => line.item === adding);
    props.onChange({
      ...props.value,
      items: has === undefined
        ? [...props.value.items, { item: adding, count: 1 }]
        : props.value.items.map((line) => (line.item === adding ? { ...line, count: line.count + 1 } : line)),
    });
  };
  const less = (item: string): void => props.onChange({
    ...props.value,
    items: props.value.items.flatMap((line) => (line.item !== item ? [line] : line.count > 1 ? [{ ...line, count: line.count - 1 }] : [])),
  });
  return (
    <div data-testid={`${prefix}container-items`}>
      {props.value.items.length === 0 ? <div class="ph-note">Empty. Add what it holds below, one at a time.</div> : null}
      {props.value.items.map((line) => (
        <div key={line.item} class="ph-row" data-item={line.item}>
          <span style={{ flex: 1 }}>{nameOf(line.item)}</span>
          <span class="ph-note" style={{ margin: 0 }}>×{line.count}</span>
          <button class="ph-chip" title="One fewer" data-testid={`${prefix}container-less`} onClick={() => less(line.item)}>
            −
          </button>
        </div>
      ))}
      <div class="ph-row">
        <select class="ph-select" data-testid={`${prefix}container-pick`} aria-label="Something to put in it" value={adding} onChange={(e) => setAdding((e.target as HTMLSelectElement).value)}>
          {props.items.length === 0 ? <option value="">The project has no items yet</option> : null}
          {props.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button class="ph-chip" data-testid={`${prefix}container-add`} disabled={adding === ''} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/** A roll, and a function for each way it can go. */
function TrappedSettings(props: Settings<'trapped'>): preact.JSX.Element {
  const prefix = props.prefix ?? '';
  const nested = (side: 'success' | 'failure'): preact.JSX.Element => (
    <PropFunctionEditor
      {...props}
      prefix={`${prefix}${side}-`}
      value={props.value[side]}
      onChange={(next) => {
        const { [side]: _gone, ...rest } = props.value;
        props.onChange(next === undefined ? rest : { ...rest, [side]: next });
      }}
    />
  );
  return (
    <div data-testid={`${prefix}trapped-settings`}>
      <div class="ph-row">
        <select class="ph-select" data-testid={`${prefix}trapped-trait`} aria-label="The trait the roll is made with" value={props.value.trait} onChange={(e) => props.onChange({ ...props.value, trait: (e.target as HTMLSelectElement).value as Of<'trapped'>['trait'] })}>
          {TRAITS.map((trait) => (
            <option key={trait} value={trait}>
              {trait[0]!.toUpperCase() + trait.slice(1)}
            </option>
          ))}
        </select>
        <input
          class="ph-input"
          type="number"
          min={1}
          max={40}
          style={{ width: '64px', flex: 'none' }}
          data-testid={`${prefix}trapped-difficulty`}
          aria-label="Difficulty"
          title="Difficulty"
          value={props.value.difficulty}
          onChange={(e) => {
            const difficulty = Math.round(Number((e.target as HTMLInputElement).value));
            if (Number.isFinite(difficulty) && difficulty >= 1 && difficulty <= 40) props.onChange({ ...props.value, difficulty });
          }}
        />
      </div>
      <label class="ph-row" style={{ gap: '6px' }}>
        <input type="checkbox" data-testid={`${prefix}trapped-repeatable`} checked={props.value.repeatable} onChange={(e) => props.onChange({ ...props.value, repeatable: (e.target as HTMLInputElement).checked })} />
        Repeatable - rolled again each time it is used
      </label>
      <div class="ph-note">On a success</div>
      {nested('success')}
      <div class="ph-note">On a failure</div>
      {nested('failure')}
    </div>
  );
}

/**
 * The pair id, and who it pairs with. A pair is two: an id two other portals already hold is
 * refused as it is typed, and the panel asks for another rather than quietly taking it.
 */
/** Which conversation using it opens. The conversation is written in Interaction mode. */
function InteractionSettings(props: Settings<'interaction'>): preact.JSX.Element {
  const prefix = props.prefix ?? '';
  const known = props.dialogueIds.includes(props.value.dialogue);
  return (
    <div data-testid={`${prefix}interaction-settings`}>
      <select
        class="ph-select"
        data-testid={`${prefix}interaction-dialogue`}
        aria-label="Conversation it opens"
        value={props.value.dialogue}
        onChange={(e) => props.onChange({ ...props.value, dialogue: (e.target as HTMLSelectElement).value })}
      >
        <option value="">Pick a conversation</option>
        {props.value.dialogue !== '' && !known ? <option value={props.value.dialogue}>{props.value.dialogue} (missing)</option> : null}
        {props.dialogueIds.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      {props.dialogueIds.length === 0 ? <div class="ph-note">No conversations yet: write one in Interaction mode, then pick it here.</div> : null}
    </div>
  );
}

function PortalSettings(props: Settings<'portal'>): preact.JSX.Element {
  const prefix = props.prefix ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? props.value.pair;
  const taken = shown.trim() === '' ? [] : props.pairTakenBy(shown.trim());
  const partner = props.value.pair === '' ? null : props.partnerOf(props.value.pair);
  return (
    <div data-testid={`${prefix}portal-settings`}>
      <input
        class="ph-input"
        data-testid={`${prefix}portal-pair`}
        aria-label="Pair id"
        placeholder="a pair id, shared with one other portal"
        value={shown}
        onInput={(e) => {
          const next = (e.target as HTMLInputElement).value;
          setDraft(next);
          if (props.pairTakenBy(next.trim()).length === 0) props.onChange({ ...props.value, pair: next.trim() });
        }}
        onBlur={() => setDraft(null)}
      />
      {taken.length > 0 ? (
        <div class="ph-note ph-bad" role="alert" data-testid={`${prefix}portal-taken`}>
          "{shown.trim()}" already pairs {taken.join(' and ')}. A pair is two - choose another id.
        </div>
      ) : shown.trim() === '' ? (
        <div class="ph-note" data-testid={`${prefix}portal-unpaired`}>No pair id yet: give it one, and the same id to its other end.</div>
      ) : (
        <div class="ph-note" data-testid={`${prefix}portal-partner`}>{partner === null ? 'Waiting for its other end: give another portal this id.' : `Paired with ${partner}.`}</div>
      )}
    </div>
  );
}

/** Everything an object could be told, for the prop that needs more than the others offer. */
function ScriptSettings(props: Settings<'script'>): preact.JSX.Element {
  const prefix = props.prefix ?? '';
  const fn = props.value;
  const set = (changes: Partial<Of<'script'>>): void => props.onChange({ ...fn, ...changes });
  const lists = { sceneIds: props.sceneIds, dialogueIds: props.dialogueIds, encounterIds: props.encounterIds, quests: props.quests };
  return (
    <div data-testid={`${prefix}script-settings`}>
      <div class="ph-note">Name and Flavour</div>
      <input class="ph-input" aria-label="Name" placeholder="name" value={fn.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
      <textarea class="ph-input" aria-label="Flavour" placeholder="read when the party uses it" value={fn.flavor} onInput={(e) => set({ flavor: (e.target as HTMLTextAreaElement).value })} />
      <label class="ph-row" style={{ gap: '6px' }}>
        <input type="checkbox" checked={fn.blocksMovement} onChange={(e) => set({ blocksMovement: (e.target as HTMLInputElement).checked })} />
        Stands in the way
      </label>
      <label class="ph-row" style={{ gap: '6px' }}>
        <input type="checkbox" checked={fn.repeatable} onChange={(e) => set({ repeatable: (e.target as HTMLInputElement).checked })} />
        Can be used again
      </label>
      <input class="ph-input" aria-label="Key it needs" placeholder="no key needed" value={fn.requiresKey ?? ''} onInput={(e) => {
        const key = (e.target as HTMLInputElement).value;
        const { requiresKey: _gone, ...rest } = fn;
        props.onChange(key === '' ? rest : { ...rest, requiresKey: key });
      }} />
      <input class="ph-input" aria-label="What it says when the key is missing" placeholder="when the party lacks the key" value={fn.lockedText} onInput={(e) => set({ lockedText: (e.target as HTMLInputElement).value })} />
      <div class="ph-note">Runs with no roll, before any check below.</div>
      <EffectList testId={prefix === '' ? 'object-effects' : `${prefix}script-effects`} effects={fn.effects} onChange={(effects) => set({ effects })} {...lists} />
      <div class="ph-note">The roll</div>
      {fn.check === undefined ? (
        <button class="ph-chip" onClick={() => set({ check: { trait: 'finesse', difficulty: 12 } })}>
          + Ask for a roll
        </button>
      ) : (
        <>
          <CheckEditor check={fn.check} onChange={(check) => set({ check })} {...lists} />
          <button class="ph-chip" onClick={() => {
            const { check: _gone, ...rest } = fn;
            props.onChange(rest);
          }}>
            ✕ No roll
          </button>
        </>
      )}
    </div>
  );
}
