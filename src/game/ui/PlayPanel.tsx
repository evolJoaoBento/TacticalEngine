/**
 * The play-mode overlay: what just happened, and anything the game is waiting on.
 *
 * The legacy prototype's narrative pane is the part of it people actually read
 * (`docs/research/legacy-ui.md`), and until now the port had nowhere to put a
 * line of prose. This is deliberately small: a log, and a prompt when a script
 * stops for an answer.
 *
 * Text only. Lines are read, never spoken — CONTEXT.md rules out narration.
 */

import { useState } from 'preact/hooks';
import type { LogLine, Pending } from '../demo-scene';
import type { Response } from '../../engine/script/runner';

/** One line of the pack: what it is, and how many. */
export interface CarriedItem {
  id: string;
  name: string;
  quantity: number;
  /** Something the selected character could wear or wield. */
  wearable: boolean;
  /** Something with a `use`. */
  usable: boolean;
}

/** One quest as the journal shows it: the words, and which steps are ticked. */
export interface JournalQuest {
  id: string;
  name: string;
  summary: string;
  status: 'active' | 'completed' | 'failed';
  objectives: readonly { id: string; text: string; done: boolean }[];
}

/** What a right-click found: a card's worth of facts, no verbs. */
export interface Inspection {
  kind: 'character' | 'adversary' | 'object';
  id: string;
  name: string;
  /** "Guardian · level 2", "Tier 1 Bruiser", "chest". */
  line: string;
  text: string;
  /** Short facts: "HP 2/6", "Difficulty 13", "Open". */
  facts: readonly string[];
}

export interface PlayPanelProps {
  log: readonly LogLine[];
  /** What was right-clicked, until closed. */
  inspecting: Inspection | null;
  onCloseInspect: () => void;
  /** Quests the party has been given, active first. */
  journal: readonly JournalQuest[];
  /** What the party is carrying. */
  carried: readonly CarriedItem[];
  pending: Pending | null;
  /** Named when something is close enough to touch. */
  within: string | null;
  onUse: (id: string) => void;
  onAnswer: (response: Response) => void;
  /** Why saving is refused right now, or `null` when it can go ahead. */
  saveBlocked: string | null;
  /** Every save, newest first. */
  saves: readonly { id: string; name: string; savedAt: number; where: string }[];
  /** Quick save: one fixed slot, overwritten. */
  onSave: () => void;
  /** A new named slot. */
  onSaveAs: () => void;
  onLoad: (id: string) => void;
  onDeleteSave: (id: string) => void;
  /** Equip a carried item on whoever is selected. */
  onEquip: (id: string) => void;
  /** Use a carried item, with whoever is selected. */
  onUseItem: (id: string) => void;
  /** A creature's name for the log, by id. */
  nameOf: (id: string) => string;
  /** The acting character's Hope, for the Experience picker. */
  actorHope: number;
}

const TONE: Readonly<Record<LogLine['tone'], string>> = {
  narration: '#d8d4c8',
  system: '#8ea3b0',
  hope: '#7fd1ff',
  fear: '#ff9d7a',
  combat: '#ffc861',
  success: '#9ae08a',
};

const wrap: Record<string, string | number> = {
  position: 'absolute',
  right: 0,
  bottom: 0,
  width: '340px',
  maxHeight: '75vh',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '12px',
  color: '#e8e6df',
  font: '13px/1.5 system-ui, sans-serif',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
};

const logBox: Record<string, string | number> = {
  overflowY: 'auto',
  background: 'rgba(16,18,24,0.9)',
  borderRadius: '6px',
  padding: '10px 12px',
};

function button(primary: boolean): Record<string, string | number> {
  return {
    padding: '6px 12px',
    marginRight: '6px',
    border: `1px solid ${primary ? '#69d2ff' : '#39404d'}`,
    borderRadius: '4px',
    background: primary ? 'rgba(105,210,255,0.18)' : 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  };
}

const heading: Record<string, string | number> = {
  color: '#8ea3b0',
  font: '600 10px/1 system-ui, sans-serif',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: '4px',
};

/** A modifier reads as +2 or -1, never as +-1. */
const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

export function PlayPanel(props: PlayPanelProps): preact.JSX.Element | null {
  const { log, pending, within } = props;
  const [saves, setSaves] = useState(false);
  /** The Experience to Utilize on the roll being asked for, if any. */
  const [experience, setExperience] = useState('');

  // A conversation raises its own prompts, so the panel reads the innermost
  // thing waiting rather than assuming the script is the one asking.
  const talking = pending !== null && pending.kind === 'script' ? pending.dialogue : null;
  const asking = talking?.prompt ?? (talking === null ? (pending?.prompt ?? null) : null);
  const check = asking !== null && asking.kind === 'check' ? asking : null;
  const choice = asking !== null && asking.kind === 'choice' ? asking : null;

  return (
    <div style={wrap}>
      <div data-testid="save-row" style={{ textAlign: 'right' }}>
        <button
          type="button"
          style={{ ...button(false), opacity: props.saveBlocked === null ? 1 : 0.4 }}
          disabled={props.saveBlocked !== null}
          title={props.saveBlocked ?? 'Quick save: one slot, overwritten'}
          data-testid="save"
          onClick={props.onSave}
        >
          Save
        </button>
        <button
          type="button"
          style={{ ...button(false), opacity: props.saveBlocked === null ? 1 : 0.4 }}
          disabled={props.saveBlocked !== null}
          title={props.saveBlocked ?? 'Save into a new named slot'}
          data-testid="save-as"
          onClick={props.onSaveAs}
        >
          Save as…
        </button>
        <button
          type="button"
          style={{ ...button(saves), marginRight: 0, opacity: props.saves.length > 0 ? 1 : 0.4 }}
          disabled={props.saves.length === 0}
          title={props.saves.length > 0 ? 'Saved games' : 'Nothing saved yet'}
          data-testid="load"
          onClick={() => setSaves(!saves)}
        >
          Load
        </button>
      </div>
      {saves && props.saves.length > 0 ? (
        <div style={{ ...logBox, padding: '8px 12px', flexShrink: 0 }} data-testid="saves">
          <div style={heading}>Saved games</div>
          {props.saves.map((slot) => (
            <div key={slot.id} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px' }} data-save={slot.id}>
              <button
                type="button"
                style={{ ...button(false), flex: 1, textAlign: 'left', margin: 0 }}
                data-testid="load-slot"
                onClick={() => {
                  props.onLoad(slot.id);
                  setSaves(false);
                }}
              >
                {slot.name}
                <span style={{ color: '#8ea3b0', fontSize: '11px' }}>
                  {' '}
                  · {slot.where} · {new Date(slot.savedAt).toLocaleString()}
                </span>
              </button>
              <button type="button" style={{ ...button(false), margin: 0 }} title="Delete this save" onClick={() => props.onDeleteSave(slot.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {props.inspecting !== null ? (
        <div style={{ ...logBox, padding: '8px 12px', flexShrink: 0, border: '1px solid #39404d' }} data-testid="inspect" data-inspect={props.inspecting.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{props.inspecting.name}</strong>
            <button type="button" style={{ ...button(false), padding: '1px 8px', marginRight: 0 }} title="Close" onClick={props.onCloseInspect}>
              ✕
            </button>
          </div>
          <div style={{ color: '#8ea3b0', fontSize: '11px' }}>{props.inspecting.line}</div>
          {props.inspecting.text !== '' ? <div style={{ margin: '4px 0', color: '#d8d4c8' }}>{props.inspecting.text}</div> : null}
          <div style={{ color: '#c8b88a', fontSize: '12px' }}>{props.inspecting.facts.join(' · ')}</div>
        </div>
      ) : null}

      {props.journal.length > 0 ? (
        <div style={{ ...logBox, padding: '8px 12px', flexShrink: 0 }} data-testid="journal">
          <div style={heading}>Journal</div>
          {props.journal.map((quest) => (
            <div key={quest.id} style={{ marginBottom: '6px' }} data-quest={quest.id}>
              <div
                style={{
                  color: quest.status === 'active' ? '#e8e6df' : '#8ea3b0',
                  textDecoration: quest.status === 'completed' ? 'line-through' : 'none',
                }}
              >
                {quest.name}
                {quest.status === 'failed' ? ' — failed' : ''}
              </div>
              {quest.status === 'active' ? (
                <div style={{ color: '#8ea3b0', fontSize: '12px' }}>
                  {quest.summary !== '' ? <div style={{ marginBottom: '2px' }}>{quest.summary}</div> : null}
                  {quest.objectives.map((objective) => (
                    <div key={objective.id} data-objective={objective.id} data-done={objective.done}>
                      {objective.done ? '☑' : '☐'} {objective.text}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {props.carried.length > 0 ? (
        <div style={{ ...logBox, padding: '8px 12px', flexShrink: 0 }} data-testid="pack">
          <div style={heading}>Carried</div>
          {props.carried.map((item) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} data-item={item.id}>
              <span>{item.name}</span>
              <span style={{ color: '#8ea3b0' }}>
                {item.quantity > 1 ? `×${item.quantity}` : ''}
                {item.usable ? (
                  <button
                    style={{ ...button(true), padding: '1px 8px', marginLeft: '6px', marginRight: 0, fontSize: '11px' }}
                    data-testid="use-item"
                    onClick={() => props.onUseItem(item.id)}
                  >
                    Use
                  </button>
                ) : null}
                {item.wearable ? (
                  <button
                    style={{ ...button(false), padding: '1px 8px', marginLeft: '6px', marginRight: 0, fontSize: '11px' }}
                    data-testid="equip"
                    onClick={() => props.onEquip(item.id)}
                  >
                    Equip
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {log.length > 0 ? (
        <div
          style={{ ...logBox, flex: '1 1 auto', minHeight: '80px' }}
          data-testid="log"
          // The newest line is the one being read; keep it in view.
          ref={(el) => {
            if (el !== null) el.scrollTop = el.scrollHeight;
          }}
        >
          {log.slice(-12).map((line, i) => (
            <div key={i} style={{ color: TONE[line.tone], marginBottom: '4px' }}>
              {line.text}
            </div>
          ))}
        </div>
      ) : null}

      {talking !== null && talking.view !== null ? (
        <div style={{ ...logBox, background: 'rgba(20,26,34,0.95)' }} data-testid="dialogue">
          {talking.view.lines.map((line, i) => (
            <div key={i} style={{ marginBottom: '6px' }}>
              {line.speaker !== undefined ? (
                <span style={{ color: '#c8b88a' }}>{line.speaker}: </span>
              ) : null}
              <span style={{ color: '#d8d4c8' }}>{line.text}</span>
            </div>
          ))}
          {talking.view.options.map((option) => (
            <button
              key={option.index}
              disabled={!option.enabled}
              title={option.enabled ? undefined : 'Not available'}
              style={{
                ...button(false),
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: '4px',
                opacity: option.enabled ? 1 : 0.5,
              }}
              onClick={() => props.onAnswer({ kind: 'choose', index: option.index })}
            >
              {option.text}
              {option.detail !== undefined ? (
                <span style={{ color: '#8ea3b0' }}> — {option.detail}</span>
              ) : null}
            </button>
          ))}
          {talking.view.options.length === 0 ? (
            <button style={button(true)} onClick={() => props.onAnswer({ kind: 'continue' })}>
              Continue
            </button>
          ) : null}
        </div>
      ) : null}

      {check !== null ? (
        <div style={{ ...logBox, background: 'rgba(20,26,34,0.95)' }} data-testid="check-prompt">
          <div style={{ marginBottom: '8px' }}>
            {check.prompt ??
              (check.difficulty === 'target'
                ? `Roll ${check.trait} against ${check.targets.length === 0 ? 'nobody' : check.targets.map(props.nameOf).join(', ')}?`
                : `Roll ${check.trait} against ${check.difficulty}?`)}
            {check.prompt !== undefined && check.targets.length > 0 ? (
              <div style={{ color: '#8ea3b0', fontSize: '11px' }}>Against {check.targets.map(props.nameOf).join(', ')}.</div>
            ) : null}
          </div>
          {check.experiences.length > 0 ? (
            <div style={{ marginBottom: '8px', fontSize: '12px' }}>
              <label style={{ color: '#8ea3b0' }}>Utilize an Experience (1 Hope): </label>
              <select
                style={{ padding: '2px 6px', border: '1px solid #39404d', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', color: 'inherit', font: 'inherit' }}
                value={experience}
                disabled={props.actorHope < 1}
                title={props.actorHope < 1 ? 'No Hope to spend' : undefined}
                data-testid="experience-pick"
                onChange={(e) => setExperience((e.target as HTMLSelectElement).value)}
              >
                <option value="">none</option>
                {check.experiences.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name} {signed(e.modifier)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button
            style={button(true)}
            data-testid="roll"
            onClick={() => {
              const chosen = experience;
              setExperience('');
              props.onAnswer(chosen === '' || props.actorHope < 1 ? { kind: 'roll' } : { kind: 'roll', experience: chosen });
            }}
          >
            Roll {check.trait} {signed(check.modifier + (experience === '' ? 0 : (check.experiences.find((e) => e.name === experience)?.modifier ?? 0)))}
          </button>
          <button
            style={button(false)}
            onClick={() => {
              setExperience('');
              props.onAnswer({ kind: 'cancel' });
            }}
          >
            Step back
          </button>
        </div>
      ) : null}

      {choice !== null ? (
        <div data-testid="choice-prompt" style={{ ...logBox, background: 'rgba(20,26,34,0.95)' }}>
          {choice.title !== undefined ? (
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{choice.title}</div>
          ) : null}
          {choice.body !== undefined ? (
            <div style={{ marginBottom: '6px', color: '#b9c6d0' }}>{choice.body}</div>
          ) : null}
          {choice.options.map((option) => (
            <button
              key={option.index}
              data-option={option.index}
              style={{ ...button(false), display: 'block', marginBottom: '4px', width: '100%', textAlign: 'left' }}
              onClick={() => props.onAnswer({ kind: 'choose', index: option.index })}
            >
              {option.label}
              {option.detail === undefined ? null : (
                <span style={{ color: '#8ea3b0' }}> — {option.detail}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {pending === null && within !== null ? (
        <div>
          <button style={button(true)} onClick={() => props.onUse(within)} data-testid="use">
            Use what is in reach
          </button>
        </div>
      ) : null}
    </div>
  );
}
