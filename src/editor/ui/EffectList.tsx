/**
 * Editing a list of effects.
 *
 * This is the piece that lets a designer write what an object or a card *does*
 * without opening a TypeScript file: a line of prose, a flag, loot, travel, a
 * conversation, and the combat vocabulary — an attack, damage, Stress, Hope,
 * conditions, tokens on a card, and a `run` that hands off to project code.
 * The recursive ones nest a list inside a list, so a whole card's script can be
 * written here; the rare ones it cannot build are shown rather than hidden,
 * because quietly dropping what it cannot represent would be worse.
 *
 * Ids that must resolve — a scene, a dialogue, an encounter, a hook — are chosen
 * from what the project actually holds rather than typed, so the commonest
 * authoring error cannot be made here at all.
 */

import type { Amount, CountName, Effect, PoolName, TargetSelector } from '../../engine/script/schema';
import { COUNT_NAMES } from '../../engine/script/schema';
import type { QuestDef } from '../../engine/content/quests';
import { RANGE_BANDS, type RangeBand } from '../../engine/rules/range';
import { ConditionEditor, COUNT_LABELS } from './ConditionEditor';
import { CheckEditor, TRAITS } from './CheckEditor';
import { TargetEditor } from './TargetEditor';

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
  /** What a `run` can name: the engine's own hooks plus the project's code. */
  hookIds?: readonly string[];
  /** What a token effect can name: the cards the project and the SRD carry. */
  abilityIds?: readonly string[];
  /** What a `summon` can name: every stat block the project can place. */
  adversaryIds?: readonly string[];
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
  // What a card does to a creature.
  'attack',
  'markStress',
  'clearStress',
  'markArmor',
  'clearArmor',
  'gainHope',
  'spendHope',
  'loseHope',
  'gainFear',
  'loseFear',
  'applyCondition',
  'clearCondition',
  'addToken',
  'spendToken',
  'push',
  'move',
  'summon',
  'replace',
  'spotlight',
  'endSpotlight',
  'spotlightAgain',
  'vaultCard',
  'maxOneDie',
  'boostDamage',
  'forceHitPoints',
  'forceSeverity',
  'softenBlow',
  'avoidBlow',
  'stepSeverity',
  'dodgeBy',
  'diceCheck',
  'howMany',
  'countdown',
  'reactionRoll',
  'run',
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
  attack: 'Make an attack',
  markStress: 'Mark Stress',
  clearStress: 'Clear Stress',
  markArmor: 'Mark Armor Slots',
  clearArmor: 'Clear Armor Slots',
  gainHope: 'Gain Hope',
  spendHope: 'Spend Hope',
  loseHope: 'Take their Hope',
  gainFear: 'GM gains Fear',
  loseFear: 'GM loses Fear',
  applyCondition: 'Apply a condition',
  clearCondition: 'Clear a condition',
  addToken: 'Put tokens on a card',
  spendToken: 'Spend tokens on a card',
  push: 'Push them back',
  move: 'Walk',
  summon: 'Summon adversaries',
  countdown: 'Start a countdown',
  replace: 'Replace with another',
  spotlight: 'Spotlight allies',
  endSpotlight: 'End this spotlight',
  spotlightAgain: 'Take the spotlight again',
  vaultCard: 'Place this card in the vault',
  maxOneDie: 'Take one damage die at its highest',
  boostDamage: 'Add to the blow landing',
  forceHitPoints: 'Force Hit Points marked',
  forceSeverity: 'Force the damage band',
  softenBlow: 'Take some off the blow',
  avoidBlow: 'Avoid the blow entirely',
  stepSeverity: 'Step the blow down a band',
  dodgeBy: 'Raise the Difficulty it was rolled against',
  diceCheck: 'Roll dice and see',
  howMany: 'Ask how many',
  reactionRoll: 'Ask for a reaction roll',
  run: 'Run code',
};

/** The bands a `push` can name. */
const BANDS = RANGE_BANDS.filter((band) => band !== 'outOfRange');

/** The pools an amount can be read off. */
const POOL_NAMES: readonly string[] = ['hitPoints', 'stress', 'armorSlots', 'hope'];

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
    case 'attack':
      return { kind };
    case 'markStress':
    case 'clearStress':
    case 'markArmor':
    case 'clearArmor':
    case 'gainHope':
    case 'spendHope':
    case 'loseHope':
    case 'gainFear':
    case 'loseFear':
      return { kind, amount: 1 };
    case 'applyCondition':
      return { kind, condition: 'vulnerable', duration: 'temporary' };
    case 'clearCondition':
      return { kind, condition: 'vulnerable' };
    case 'addToken':
    case 'spendToken':
      return { kind, ability: props.abilityIds?.[0] ?? '', amount: 1 };
    case 'push':
      return { kind, to: 'far' };
    case 'move':
      return { kind, how: 'toward', range: 'melee' };
    case 'summon':
      return { kind, adversary: props.adversaryIds?.[0] ?? '', range: 'close' };
    case 'replace':
      return { kind, adversary: props.adversaryIds?.[0] ?? '' };
    case 'spotlight':
      return { kind, targets: { kind: 'adversaries', range: 'far' } };
    case 'endSpotlight':
    case 'spotlightAgain':
    case 'vaultCard':
    case 'maxOneDie':
      return { kind };
    case 'boostDamage':
      return { kind, dice: '1d6' };
    case 'forceHitPoints':
      return { kind, amount: { pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked' } };
    case 'forceSeverity':
      return { kind, severity: 'severe' };
    case 'softenBlow':
      return { kind, dice: '1d6' };
    case 'diceCheck':
      return { kind, dice: '1d6', atLeast: 6, then: [] };
    case 'stepSeverity':
      return { kind, steps: 1 };
    case 'dodgeBy':
      return { kind, dice: '1d4' };
    case 'avoidBlow':
      return { kind };
    case 'howMany':
      return { kind, most: { pool: 'hope', measure: 'available' }, each: [] };
    case 'countdown':
      return { kind, countdown: 'countdown', name: 'Countdown', start: '4', effects: [] };
    case 'reactionRoll':
      return { kind, difficulty: 12, trait: 'agility' };
    case 'run':
      return { kind, hook: props.hookIds?.[0] ?? '' };
  }
}

/**
 * `name=value` pairs for a hook's arguments. Numbers and booleans are read as
 * such — a hook that asks for `ctx.args.amount` wants a number, and typing one
 * should not hand it the string.
 */
function parseArgs(raw: string): Record<string, string | number | boolean> | undefined {
  const args: Record<string, string | number | boolean> = {};
  for (const pair of raw.split(',')) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (name === '') continue;
    const asNumber = Number(value);
    args[name] = value === 'true' ? true : value === 'false' ? false : value !== '' && !Number.isNaN(asNumber) ? asNumber : value;
  }
  return Object.keys(args).length === 0 ? undefined : args;
}

/** What moves a countdown, in the words a designer would use for it. */
const ADVANCES: readonly (readonly [string, string])[] = [
  ['standard', 'on any PC roll'],
  ['attackRoll', 'on a PC attack roll'],
  ['withFear', 'on a PC roll with Fear'],
  ['hpMarked', 'by the HP they mark'],
  ['progress', 'progress (dynamic)'],
  ['consequence', 'consequence (dynamic)'],
];

/** A one-line summary of an effect this cannot edit. */
function describe(effect: Effect): string {
  switch (effect.kind) {
    case 'branch':
      return `If ${effect.when.kind}: ${effect.then.length} effect(s), else ${effect.otherwise?.length ?? 0}`;
    case 'diceCheck':
      return `Roll ${effect.dice} for a ${effect.atLeast}: ${effect.then.length} effect(s), else ${effect.otherwise?.length ?? 0}`;
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
  /** Who it lands on. Every combat effect takes the same one. */
  const who = (
    selector: TargetSelector | undefined,
    fallback: string,
    set: (s: TargetSelector | undefined) => Effect,
  ): preact.JSX.Element => <TargetEditor selector={selector} fallback={fallback} onChange={(s) => onChange(set(s))} />;

  /** A small whole number, defaulting to one when the field is emptied. */
  const count = (value: number, set: (n: number) => Effect, least = 1): preact.JSX.Element => (
    <input
      type="number"
      min={least}
      style={{ ...field, flex: 'none', width: '52px' }}
      value={value}
      onInput={(e) => onChange(set(Math.max(least, Number((e.target as HTMLInputElement).value) || least)))}
    />
  );

  /**
   * A written number, one read off the blow that called for the feature
   * ("cause the attacker to mark the same number of HP"), or one read off a
   * pool ("equal to the Demon's current number of marked HP"). Picking one
   * hides the others, because they are alternatives rather than a pair.
   */
  const amount = (value: Amount, set: (n: Amount) => Effect): preact.JSX.Element => {
    const read = typeof value === 'object' ? value : null;
    const source =
      typeof value === 'object' ? ('tokens' in value ? 'tokens' : 'pool') : typeof value === 'number' ? '' : value;
    return (
      <>
        <select
          style={{ ...field, flex: 'none', width: '124px' }}
          data-role="amount-source"
          value={source}
          onChange={(e) => {
            const picked = (e.target as HTMLSelectElement).value;
            if (picked === '') onChange(set(1));
            else if (picked === 'pool') onChange(set({ pool: 'hitPoints', measure: 'marked' }));
            else if (picked === 'tokens') onChange(set({ tokens: 'a-card' }));
            else if (picked === 'trait') onChange(set({ trait: 'strength' }));
            else onChange(set(picked as CountName));
          }}
        >
          <option value="">a number</option>
          {COUNT_NAMES.map((name) => (
            <option key={name} value={name}>
              {COUNT_LABELS[name]}
            </option>
          ))}
          <option value="pool">a pool of theirs</option>
          <option value="tokens">tokens on a card</option>
          <option value="trait">a trait of theirs</option>
        </select>
        {typeof value === 'number' ? count(value, set) : null}
        {read === null || !('pool' in read) ? null : (
          <>
            {pick(read.pool, POOL_NAMES, (pool) => set({ ...read, pool: pool as PoolName }))}
            {pick(read.measure ?? 'marked', ['marked', 'available', 'max'], (measure) =>
              set({ ...read, measure: measure as 'marked' | 'available' | 'max' }),
            )}
          </>
        )}
        {read === null || !('trait' in read) ? null : (
          <>
            {pick(read.trait, [...TRAITS, 'spellcast'], (trait) => set({ ...read, trait: trait as typeof read.trait }))}
            <span style={{ color: '#8ea3b0', fontSize: '11px' }} title="How many times over">
              &times;
            </span>
            {count(read.times ?? 1, (times) => set({ ...read, times: times === 1 ? undefined : times }))}
          </>
        )}
        {read === null || !('tokens' in read) ? null : (
          <input
            style={{ ...field, flex: 'none', width: '90px' }}
            data-role="amount-tokens"
            placeholder="card id"
            title="Tokens sitting on this card"
            value={read.tokens}
            onInput={(e) => onChange(set({ ...read, tokens: (e.target as HTMLInputElement).value }))}
          />
        )}
      </>
    );
  };

  const flag = (label: string, hint: string, on: boolean, set: (v: boolean) => Effect): preact.JSX.Element => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: '#8ea3b0' }} title={hint}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(set((e.target as HTMLInputElement).checked))} />
      {label}
    </label>
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
    case 'heal': {
      // Exactly one of a flat amount or dice, the same pairing damage has.
      const rolled = effect.dice !== undefined;
      return (
        <>
          <select
            style={{ ...field, flex: 'none', width: '84px' }}
            data-role="heal-mode"
            value={rolled ? 'dice' : 'amount'}
            onChange={(e) =>
              onChange(
                (e.target as HTMLSelectElement).value === 'dice'
                  ? { ...effect, amount: undefined, dice: '1d4' }
                  : { ...effect, dice: undefined, amount: 2 },
              )
            }
          >
            <option value="amount">flat</option>
            <option value="dice">rolled</option>
          </select>
          {rolled
            ? text(effect.dice ?? '', (dice) => ({ ...effect, dice }), '1d4')
            : amount(effect.amount ?? 1, (value) => ({ ...effect, amount: value }))}
          {who(effect.target, 'the actor', (target) => ({ ...effect, target }))}
        </>
      );
    }
    case 'damage': {
      // Exactly one of a flat amount or dice: switching sets one and drops the
      // other, so the pair can never both be written.
      const rolled = effect.dice !== undefined;
      return (
        <>
          <select
            style={{ ...field, flex: 'none', width: '84px' }}
            data-role="damage-mode"
            value={rolled ? 'dice' : 'amount'}
            onChange={(e) =>
              onChange(
                (e.target as HTMLSelectElement).value === 'dice'
                  ? { ...effect, amount: undefined, dice: 'd6' }
                  : { ...effect, dice: undefined, amount: 2 },
              )
            }
          >
            <option value="amount">flat</option>
            <option value="dice">rolled</option>
          </select>
          {rolled ? (
            <input
              style={{ ...field, flex: 'none', width: '84px' }}
              data-role="damage-dice"
              // `weapon` and `same` are words, not dice: the first is whatever
              // the actor swings, the second the damage this script already rolled.
              placeholder="2d6, weapon, same"
              list="damage-dice-words"
              value={effect.dice ?? ''}
              onInput={(e) => onChange({ ...effect, dice: (e.target as HTMLInputElement).value })}
            />
          ) : (
            amount(effect.amount ?? 1, (value) => ({ ...effect, amount: value }))
          )}
          {rolled ? (
            <select
              style={{ ...field, flex: 'none', width: '92px' }}
              data-role="damage-using"
              title="Multiply the dice by the actor's Proficiency, half of it, or their Spellcast trait"
              value={effect.using ?? ''}
              onChange={(e) => {
                const using = (e.target as HTMLSelectElement).value;
                onChange({
                  ...effect,
                  using: using === '' ? undefined : (using as NonNullable<typeof effect.using>),
                });
              }}
            >
              <option value="">×1</option>
              <option value="proficiency">× Proficiency</option>
              <option value="halfProficiency">× half Proficiency</option>
              <option value="spellcast">× Spellcast</option>
            </select>
          ) : null}
          {rolled ? flag('half', 'Half the total, rounded up', effect.half === true, (half) => ({ ...effect, half: half ? true : undefined })) : null}
          {flag('direct', 'Armor Slots cannot reduce it', effect.direct === true, (direct) => ({ ...effect, direct: direct ? true : undefined }))}
          {who(effect.target, rolled ? 'everyone the roll beat' : 'the actor', (target) => ({ ...effect, target }))}
          <datalist id="damage-dice-words">
            <option value="weapon" />
            <option value="same" />
          </datalist>
        </>
      );
    }
    case 'markStress':
    case 'clearStress':
    case 'loseHope':
      return (
        <>
          {amount(effect.amount ?? 1, (value) => ({ ...effect, amount: value }))}
          {who(effect.target, 'everyone it hit', (target) => ({ ...effect, target }))}
        </>
      );
    case 'gainHope':
      return (
        <>
          {amount(effect.amount ?? 1, (value) => ({ ...effect, amount: value }))}
          {who(effect.target, 'the actor', (target) => ({ ...effect, target }))}
        </>
      );
    // Armor Slots are always a plain number: nothing marks or clears "as many
    // as the blow took".
    case 'markArmor':
    case 'clearArmor':
      return (
        <>
          {count(effect.amount ?? 1, (value) => ({ ...effect, amount: value }))}
          {who(effect.target, 'everyone it hit', (target) => ({ ...effect, target }))}
        </>
      );
    case 'gainFear':
    case 'loseFear':
      return amount(effect.amount ?? 1, (value) => ({ ...effect, amount: value }));
    case 'spendHope':
      return amount(effect.amount ?? 1, (value) => ({ ...effect, amount: value }));
    case 'applyCondition':
      return (
        <>
          {text(effect.condition, (condition) => ({ ...effect, condition }), 'condition')}
          <select
            style={{ ...field, flex: 'none', width: '90px' }}
            data-role="condition-duration"
            value={effect.duration ?? 'temporary'}
            onChange={(e) =>
              onChange({ ...effect, duration: (e.target as HTMLSelectElement).value as 'temporary' | 'scene' | 'rest' | 'permanent' })
            }
          >
            <option value="temporary">until they act</option>
            <option value="scene">this scene</option>
            <option value="rest">until a rest</option>
            <option value="permanent">until cleared</option>
          </select>
          {who(effect.target, 'everyone the roll beat', (target) => ({ ...effect, target }))}
        </>
      );
    case 'clearCondition':
      return (
        <>
          {text(effect.condition, (condition) => ({ ...effect, condition }), 'condition')}
          {who(effect.target, 'the actor', (target) => ({ ...effect, target }))}
        </>
      );
    case 'addToken':
      return (
        <>
          {props.abilityIds === undefined || props.abilityIds.length === 0
            ? text(effect.ability, (ability) => ({ ...effect, ability }), 'card id')
            : pick(effect.ability, props.abilityIds, (ability) => ({ ...effect, ability }))}
          {amount(effect.amount ?? 1, (value) => ({ ...effect, amount: value }))}
          {who(effect.target, 'the actor', (target) => ({ ...effect, target }))}
        </>
      );
    case 'spendToken':
      return (
        <>
          {props.abilityIds === undefined || props.abilityIds.length === 0
            ? text(effect.ability, (ability) => ({ ...effect, ability }), 'card id')
            : pick(effect.ability, props.abilityIds, (ability) => ({ ...effect, ability }))}
          {effect.all === true ? null : amount(effect.amount ?? 1, (value) => ({ ...effect, amount: value }))}
          {flag('all', 'Every token on the card', effect.all === true, (all) => ({
            ...effect,
            all: all ? true : undefined,
            ...(all ? { amount: undefined } : {}),
          }))}
          {who(effect.target, 'the actor', (target) => ({ ...effect, target }))}
        </>
      );
    case 'move':
      return (
        <>
          <select
            style={{ ...field, flex: 'none', width: '92px' }}
            data-role="move-how"
            value={effect.to === 'point' ? 'point' : (effect.how ?? 'toward')}
            onChange={(e) => {
              const how = (e.target as HTMLSelectElement).value;
              if (how === 'point') onChange({ ...effect, to: 'point', how: undefined, of: undefined });
              else onChange({ ...effect, to: undefined, how: how as 'toward' | 'away' });
            }}
          >
            <option value="toward">towards</option>
            <option value="away">away from</option>
            <option value="point">to the spot aimed at</option>
          </select>
          {effect.to === 'point' ? null : who(effect.of, 'the chosen target', (of) => ({ ...effect, of }))}
          {effect.how === 'away' ? null : (
            <select
              style={{ ...field, flex: 'none', width: '92px' }}
              data-role="move-range"
              title="The band to end up within"
              value={effect.range ?? 'melee'}
              onChange={(e) => onChange({ ...effect, range: (e.target as HTMLSelectElement).value as RangeBand })}
            >
              {BANDS.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </select>
          )}
          <select
            style={{ ...field, flex: 'none', width: '96px' }}
            data-role="move-budget"
            title="How far it may walk"
            value={effect.budget ?? 'close'}
            onChange={(e) => onChange({ ...effect, budget: (e.target as HTMLSelectElement).value as RangeBand })}
          >
            {BANDS.map((band) => (
              <option key={band} value={band}>
                up to {band}
              </option>
            ))}
          </select>
        </>
      );
    case 'push':
      return (
        <>
          <select
            style={{ ...field, flex: 'none', width: '84px' }}
            data-role="push-to"
            value={effect.to}
            onChange={(e) => onChange({ ...effect, to: (e.target as HTMLSelectElement).value as RangeBand })}
          >
            {BANDS.map((band) => (
              <option key={band} value={band}>
                to {band}
              </option>
            ))}
          </select>
          {who(effect.target, 'the chosen target', (target) => ({ ...effect, target }))}
        </>
      );
    case 'summon':
      return (
        <>
          {props.adversaryIds === undefined || props.adversaryIds.length === 0
            ? text(effect.adversary, (adversary) => ({ ...effect, adversary }), 'adversary id')
            : pick(effect.adversary, props.adversaryIds, (adversary) => ({ ...effect, adversary }))}
          <input
            style={{ ...field, flex: 'none', width: '72px' }}
            data-role="summon-count"
            placeholder="1, 1d4"
            title="How many, as dice"
            value={effect.count ?? ''}
            onInput={(e) => {
              const count = (e.target as HTMLInputElement).value.trim();
              onChange({ ...effect, count: count === '' ? undefined : count });
            }}
          />
          <select
            style={{ ...field, flex: 'none', width: '96px' }}
            data-role="summon-range"
            value={effect.range ?? 'close'}
            onChange={(e) => onChange({ ...effect, range: (e.target as HTMLSelectElement).value as RangeBand })}
          >
            {BANDS.map((band) => (
              <option key={band} value={band}>
                at {band}
              </option>
            ))}
          </select>
          {/* "…and is immediately spotlighted": they act now, not next turn. */}
          {flag('acts at once', 'They take the spotlight as they arrive', effect.spotlight === true, (on) => ({
            ...effect,
            spotlight: on ? true : undefined,
          }))}
          {flag('per PC', 'Multiply the count by the party still standing', effect.perPc === true, (on) => ({
            ...effect,
            perPc: on ? true : undefined,
          }))}
        </>
      );
    case 'run':
      return (
        <>
          {props.hookIds === undefined || props.hookIds.length === 0
            ? text(effect.hook, (hook) => ({ ...effect, hook }), 'code id')
            : pick(effect.hook, props.hookIds, (hook) => ({ ...effect, hook }))}
          <input
            style={{ ...field, flex: 'none', width: '120px' }}
            data-role="run-args"
            placeholder="name=value, name=value"
            title="Handed to the code as ctx.args"
            value={Object.entries(effect.args ?? {})
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(', ')}
            onInput={(e) => onChange({ ...effect, args: parseArgs((e.target as HTMLInputElement).value) })}
          />
        </>
      );
    case 'attack':
      return (
        <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #39404d', paddingLeft: '6px' }} data-testid="attack">
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              style={{ ...field, flex: 'none', width: '86px' }}
              data-role="attack-weapon"
              value={effect.weapon ?? 'primary'}
              onChange={(e) =>
                onChange({ ...effect, weapon: (e.target as HTMLSelectElement).value as 'primary' | 'secondary' })
              }
            >
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
            </select>
            {who(effect.target, 'the chosen target', (target) => ({ ...effect, target }))}
            <input
              style={{ ...field, flex: 'none', width: '80px' }}
              data-role="attack-damage"
              placeholder="damage dice"
              title="Damage dice instead of the attacker's own"
              value={effect.damage ?? ''}
              onInput={(e) => {
                const damage = (e.target as HTMLInputElement).value;
                onChange({ ...effect, damage: damage === '' ? undefined : damage });
              }}
            />
            <input
              style={{ ...field, flex: 'none', width: '80px' }}
              data-role="attack-behind"
              placeholder="extra dice"
              title="Dice added to the damage roll, on top of the weapon's"
              value={effect.damageDice ?? ''}
              onInput={(e) => {
                const dice = (e.target as HTMLInputElement).value;
                onChange({ ...effect, damageDice: dice === '' ? undefined : dice });
              }}
            />
            <select
              style={{ ...field, flex: 'none', width: '96px' }}
              data-role="attack-range"
              title="Reach instead of the attacker's own"
              value={effect.range ?? ''}
              onChange={(e) => {
                const range = (e.target as HTMLSelectElement).value;
                onChange({ ...effect, range: range === '' ? undefined : (range as RangeBand) });
              }}
            >
              <option value="">its own reach</option>
              {BANDS.map((band) => (
                <option key={band} value={band}>
                  reaches {band}
                </option>
              ))}
            </select>
            {flag('direct', 'Damage no Armor Slot reduces', effect.direct === true, (on) => ({
              ...effect,
              direct: on ? true : undefined,
            }))}
            {/*
              "Spotlight all Giant Rats within Close range of them": the rest
              of its kind walk in and the damage counts once for each. One
              checkbox, because every block that prints this prints it the
              same way.
            */}
            {flag('the rest of its kind join', 'They walk into reach and swing with it', effect.joinedBy !== undefined, (on) => ({
              ...effect,
              joinedBy: on ? { kind: 'adversaries' as const, range: 'close' as const, around: 'target' as const, sameKind: true } : undefined,
            }))}
          </div>
          <div style={{ color: '#8ea3b0', fontSize: '11px' }}>on a hit</div>
          <EffectList {...props} testId={undefined} effects={effect.onHit ?? []} onChange={(onHit) => onChange({ ...effect, onHit: onHit.length === 0 ? undefined : onHit })} />
          <div style={{ color: '#8ea3b0', fontSize: '11px' }}>on a miss</div>
          <EffectList {...props} testId={undefined} effects={effect.onMiss ?? []} onChange={(onMiss) => onChange({ ...effect, onMiss: onMiss.length === 0 ? undefined : onMiss })} />
        </div>
      );
    case 'reactionRoll':
      return (
        <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #39404d', paddingLeft: '6px' }} data-testid="reaction-roll">
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              style={{ ...field, flex: 'none', width: '86px' }}
              data-role="reaction-trait"
              value={effect.trait ?? 'agility'}
              onChange={(e) => onChange({ ...effect, trait: (e.target as HTMLSelectElement).value as typeof effect.trait })}
            >
              {['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'].map((trait) => (
                <option key={trait} value={trait}>
                  {trait}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              style={{ ...field, flex: 'none', width: '52px' }}
              data-role="reaction-difficulty"
              value={effect.difficulty === 'roll' ? '' : effect.difficulty}
              disabled={effect.difficulty === 'roll'}
              onInput={(e) => onChange({ ...effect, difficulty: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })}
            />
            {flag('vs the last roll', "The actor's last roll is the Difficulty", effect.difficulty === 'roll', (on) => ({
              ...effect,
              difficulty: on ? 'roll' : 12,
            }))}
            {who(effect.targets, 'the chosen target', (targets) => ({ ...effect, targets }))}
            <input
              style={{ ...field, flex: 'none', width: '90px' }}
              data-role="reaction-damage"
              placeholder="damage dice"
              title="Rolled once, before anyone rolls to avoid it; both branches spend it with damage dice 'same'"
              value={effect.damage?.dice ?? ''}
              onInput={(e) => {
                const dice = (e.target as HTMLInputElement).value;
                onChange({ ...effect, damage: dice === '' ? undefined : { ...effect.damage, dice } });
              }}
            />
          </div>
          <div data-outcome="onFail">
            <div style={{ color: '#8ea3b0', fontSize: '11px' }}>those who fail</div>
            <EffectList {...props} testId={undefined} effects={effect.onFail ?? []} onChange={(onFail) => onChange({ ...effect, onFail: onFail.length === 0 ? undefined : onFail })} />
          </div>
          <div data-outcome="onSuccess">
            <div style={{ color: '#8ea3b0', fontSize: '11px' }}>those who succeed</div>
            <EffectList {...props} testId={undefined} effects={effect.onSuccess ?? []} onChange={(onSuccess) => onChange({ ...effect, onSuccess: onSuccess.length === 0 ? undefined : onSuccess })} />
          </div>
        </div>
      );
    case 'replace':
      return (
        <>
          {props.adversaryIds === undefined || props.adversaryIds.length === 0
            ? text(effect.adversary, (adversary) => ({ ...effect, adversary }), 'adversary id')
            : pick(effect.adversary, props.adversaryIds, (adversary) => ({ ...effect, adversary }))}
          <input
            style={{ ...field, flex: 'none', width: '72px' }}
            data-role="replace-count"
            placeholder="1, 2"
            title="How many stand up in its place, as dice"
            value={effect.count ?? ''}
            onInput={(e) => {
              const rolled = (e.target as HTMLInputElement).value.trim();
              onChange({ ...effect, count: rolled === '' ? undefined : rolled });
            }}
          />
          {flag('acts at once', 'They take the spotlight as they stand up', effect.spotlight === true, (on) => ({
            ...effect,
            spotlight: on ? true : undefined,
          }))}
        </>
      );
    case 'spotlight':
      return (
        <>
          {who(effect.targets, 'adversaries within Far', (targets) => ({ ...effect, targets }))}
          <input
            style={{ ...field, flex: 'none', width: '78px' }}
            data-role="spotlight-count"
            placeholder="all, 1d4+1"
            title="How many of them, as dice. Empty means every one of them."
            value={effect.count ?? ''}
            onInput={(e) => {
              const rolled = (e.target as HTMLInputElement).value.trim();
              onChange({ ...effect, count: rolled === '' ? undefined : rolled });
            }}
          />
          {/* "Attacks they make while spotlighted in this way deal half damage." */}
          {flag('for half', 'Their standard attack deals half damage this turn', effect.halfDamage === true, (on) => ({
            ...effect,
            halfDamage: on ? true : undefined,
          }))}
        </>
      );
    case 'endSpotlight':
      return (
        <span style={{ ...field, color: '#8ea3b0' }}>
          the creature acts no further this turn
        </span>
      );
    case 'howMany':
      return (
        <>
          <span style={{ color: '#8ea3b0', fontSize: '11px' }}>up to</span>
          {amount(effect.most, (most) => ({ ...effect, most }))}
          <span style={{ color: '#8ea3b0', fontSize: '11px' }} title="Zero lets them decline">
            from
          </span>
          {count(effect.least ?? 1, (least) => ({ ...effect, least }), 0)}
        </>
      );
    case 'boostDamage':
      return (
        <>
          <input
            style={{ ...field, flex: 'none', width: '86px' }}
            data-role="boost-dice"
            placeholder="1d6, weapon"
            title="Dice to roll and add, or 'weapon' for its own printed damage. Empty for a flat number."
            value={effect.dice ?? ''}
            onInput={(e) => {
              const dice = (e.target as HTMLInputElement).value.trim();
              onChange({ ...effect, dice: dice === '' ? undefined : dice });
            }}
          />
          {amount(effect.amount ?? 0, (value) => ({ ...effect, amount: value === 0 ? undefined : value }))}
          <span style={{ color: '#8ea3b0', fontSize: '11px' }} title="How many times to roll those dice">
            rolled
          </span>
          {amount(effect.times ?? 1, (times) => ({ ...effect, times: times === 1 ? undefined : times }))}
        </>
      );
    case 'stepSeverity':
      return (
        <>
          <span style={{ color: '#8ea3b0', fontSize: '11px' }} title="Bands down, after whatever the armor did">
            down
          </span>
          {count(effect.steps ?? 1, (steps) => ({ ...effect, steps }))}
        </>
      );
    case 'dodgeBy':
      return (
        <>
          <input
            style={{ ...field, flex: 'none', width: '72px' }}
            data-role="dodge-dice"
            placeholder="1d4"
            title="Dice to roll and add to the Difficulty the blow was rolled against"
            value={effect.dice ?? ''}
            onInput={(e) => {
              const dice = (e.target as HTMLInputElement).value.trim();
              onChange({ ...effect, dice: dice === '' ? undefined : dice });
            }}
          />
          {amount(effect.amount ?? 0, (value) => ({ ...effect, amount: value === 0 ? undefined : value }))}
        </>
      );
    case 'softenBlow':
      return (
        <>
          <input
            style={{ ...field, flex: 'none', width: '86px' }}
            data-role="soften-dice"
            placeholder="1d6"
            title="Dice to roll and take off the blow. Empty for a flat number."
            value={effect.dice ?? ''}
            onInput={(e) => {
              const dice = (e.target as HTMLInputElement).value.trim();
              onChange({ ...effect, dice: dice === '' ? undefined : dice });
            }}
          />
          {amount(effect.amount ?? 0, (value) => ({ ...effect, amount: value === 0 ? undefined : value }))}
        </>
      );
    case 'forceHitPoints':
      return (
        <>
          <span style={{ color: '#8ea3b0', fontSize: '11px' }} title="Marked outright, instead of rolling for damage">
            marks
          </span>
          {amount(effect.amount, (value) => ({ ...effect, amount: value }))}
        </>
      );
    case 'forceSeverity':
      return (
        <>
          <span style={{ color: '#8ea3b0', fontSize: '11px' }} title="The band it lands in, instead of rolling for damage">
            lands as
          </span>
          {pick(effect.severity, ['minor', 'major', 'severe', 'massive'], (severity) => ({
            ...effect,
            severity: severity as 'minor' | 'major' | 'severe' | 'massive',
          }))}
          {flag('at worst', 'A floor under a blow counted as usual, rather than instead of it', effect.least === true, (least) => ({
            ...effect,
            least: least ? true : undefined,
          }))}
        </>
      );
    case 'countdown':
      return (
        <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #39404d', paddingLeft: '6px' }} data-testid="countdown">
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            {text(effect.name, (name) => ({ ...effect, name }), 'what it is called')}
            {text(effect.countdown, (countdown) => ({ ...effect, countdown }), 'id')}
            <input
              style={{ ...field, flex: 'none', width: '72px' }}
              data-role="countdown-start"
              placeholder="6, 1d6"
              title="Where it starts, as dice"
              value={effect.start}
              onInput={(e) => onChange({ ...effect, start: (e.target as HTMLInputElement).value })}
            />
            <select
              style={{ ...field, flex: 'none', width: '116px' }}
              data-role="countdown-advance"
              value={effect.advance ?? 'standard'}
              onChange={(e) => onChange({ ...effect, advance: (e.target as HTMLSelectElement).value as typeof effect.advance })}
            >
              {ADVANCES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              style={{ ...field, flex: 'none', width: '104px' }}
              data-role="countdown-loop"
              value={effect.loop ?? 'once'}
              onChange={(e) => {
                const loop = (e.target as HTMLSelectElement).value;
                onChange({ ...effect, loop: loop === 'once' ? undefined : (loop as 'reset' | 'increasing' | 'decreasing') });
              }}
            >
              <option value="once">once, then gone</option>
              <option value="reset">loop</option>
              <option value="increasing">loop, +1 each time</option>
              <option value="decreasing">loop, -1 each time</option>
            </select>
            {/* "If the Tyrant is defeated while this countdown is active, trigger it immediately." */}
            {flag('goes off if they fall', 'Otherwise it ends with the one counting it', effect.onDeath === 'trigger', (on) => ({
              ...effect,
              onDeath: on ? 'trigger' : undefined,
            }))}
          </div>
          <div data-outcome="countdownEffects">
            <div style={{ color: '#8ea3b0', fontSize: '11px' }}>when it triggers</div>
            <EffectList {...props} testId={undefined} effects={effect.effects} onChange={(effects) => onChange({ ...effect, effects })} />
          </div>
        </div>
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
            showTargets={true}
            {...(props.hookIds === undefined ? {} : { hookIds: props.hookIds })}
            {...(props.abilityIds === undefined ? {} : { abilityIds: props.abilityIds })}
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
    case 'diceCheck':
      // A handful of dice under a gate of their own: what to roll, how many,
      // what counts as coming up, and what each answer runs.
      return (
        <div style={{ flex: 1, minWidth: 0, borderLeft: '2px solid #39404d', paddingLeft: '6px' }} data-testid="dice-check">
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              style={{ ...field, flex: 'none', width: '72px' }}
              data-role="check-dice"
              placeholder="1d6"
              title="The die to roll, once for each"
              value={effect.dice}
              onInput={(e) => onChange({ ...effect, dice: (e.target as HTMLInputElement).value })}
            />
            <span style={{ color: '#8ea3b0', fontSize: '11px' }} title="How many of them">
              &times;
            </span>
            {amount(effect.times ?? 1, (times) => ({ ...effect, times: times === 1 ? undefined : times }))}
            <span style={{ color: '#8ea3b0', fontSize: '11px' }}>needs</span>
            {count(effect.needed ?? 1, (needed) => ({ ...effect, needed: needed === 1 ? undefined : needed }))}
            <span style={{ color: '#8ea3b0', fontSize: '11px' }}>showing</span>
            {count(effect.atLeast, (atLeast) => ({ ...effect, atLeast }))}
            <span style={{ color: '#8ea3b0', fontSize: '11px' }}>or better</span>
          </div>
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
