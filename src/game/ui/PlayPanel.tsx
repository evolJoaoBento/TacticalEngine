/**
 * The play-mode overlay: what just happened, and anything the game is waiting on.
 *
 * The legacy prototype's narrative pane is the part of it people actually read
 * (`docs/research/legacy-ui.md`), and until now the port had nowhere to put a
 * line of prose. This is deliberately small: a log, and a prompt when a script
 * stops for an answer.
 *
 * Text only. Lines are read, never spoken — CONTEXT.md rules out narration.
 * The look is `hud.css`: Slay the Spire's leather, ink and Kreon.
 */

import { useState } from 'preact/hooks';
import type { Pending } from '../demo-scene';
import type { LogLine } from '../log';
import type { Response } from '../../engine/script/runner';
import './hud.css';

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

/**
 * A log line cut into the creatures it names and the words between them.
 *
 * The names come from the line itself, which collected them where the board was
 * to hand; this only has to find them again in order. A line that named nobody
 * is one part and no work.
 */
function logParts(line: LogLine): { text: string; id: string | null }[] {
  const mentions = line.mentions ?? [];
  if (mentions.length === 0) return [{ text: line.text, id: null }];
  const parts: { text: string; id: string | null }[] = [];
  let rest = line.text;
  // Left to right through the sentence, whichever name comes next.
  for (;;) {
    let soonest: { id: string; name: string; at: number } | null = null;
    for (const one of mentions) {
      const at = rest.indexOf(one.name);
      if (at === -1) continue;
      if (soonest === null || at < soonest.at) soonest = { ...one, at };
    }
    if (soonest === null) break;
    if (soonest.at > 0) parts.push({ text: rest.slice(0, soonest.at), id: null });
    parts.push({ text: soonest.name, id: soonest.id });
    rest = rest.slice(soonest.at + soonest.name.length);
  }
  if (rest !== '') parts.push({ text: rest, id: null });
  return parts;
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
  /** For a creature, the cards its stat block prints: the GM's side of the table, face up. */
  cards?: readonly { id: string; name: string; text: string }[];
}

export interface PlayPanelProps {
  log: readonly LogLine[];
  /** What was right-clicked, until closed. */
  inspecting: Inspection | null;
  onCloseInspect: () => void;
  /** Quests the party has been given, active first. */
  journal: readonly JournalQuest[];
  /** Somebody named in the log is under the pointer, or nobody is. */
  onHoverEntity?: (id: string | null) => void;
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
  /** The acting character's Light, for the Experience picker. */
  actorGood: number;
}

/**
 * The log's tones, and the floaters' over heads (`main.ts`): good is the Light die's gold and
 * bad the Shadow die's violet, so what the dice say and what the log says wear the same colours.
 */
export const TONE: Readonly<Record<LogLine['tone'], string>> = {
  narration: '#d8d4c8',
  system: '#9ba5b4',
  good: '#e8bd63',
  bad: '#c9aef0',
  combat: '#ef8a7a',
  success: '#9ae08a',
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
    <div className="play panel">
      <div data-testid="save-row" className="panel-saves">
        <button
          type="button"
          className="play-btn is-ghost"
          disabled={props.saveBlocked !== null}
          title={props.saveBlocked ?? 'Quick save: one slot, overwritten'}
          data-testid="save"
          onClick={props.onSave}
        >
          Save
        </button>
        <button
          type="button"
          className="play-btn is-ghost"
          disabled={props.saveBlocked !== null}
          title={props.saveBlocked ?? 'Save into a new named slot'}
          data-testid="save-as"
          onClick={props.onSaveAs}
        >
          Save as…
        </button>
        <button
          type="button"
          className={`play-btn is-ghost${saves ? ' is-on' : ''}`}
          disabled={props.saves.length === 0}
          title={props.saves.length > 0 ? 'Saved games' : 'Nothing saved yet'}
          data-testid="load"
          onClick={() => setSaves(!saves)}
        >
          Load
        </button>
      </div>
      {saves && props.saves.length > 0 ? (
        <div className="play-box panel-box is-fixed" data-testid="saves">
          <div className="play-eyebrow panel-heading">Saved games</div>
          {props.saves.map((slot) => (
            <div key={slot.id} className="panel-row" style={{ marginBottom: '3px' }} data-save={slot.id}>
              <button
                type="button"
                className="play-btn"
                style={{ flex: 1, textAlign: 'left', margin: 0, padding: '4px 10px', fontSize: '12px' }}
                data-testid="load-slot"
                onClick={() => {
                  props.onLoad(slot.id);
                  setSaves(false);
                }}
              >
                {slot.name}
                <span className="panel-sub">
                  {' '}
                  · {slot.where} · {new Date(slot.savedAt).toLocaleString()}
                </span>
              </button>
              <button type="button" className="play-btn is-ghost" title="Delete this save" onClick={() => props.onDeleteSave(slot.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {props.inspecting !== null ? (
        <div className="play-box panel-box is-fixed" data-testid="inspect" data-inspect={props.inspecting.id}>
          <div className="panel-head">
            <span className="play-name">{props.inspecting.name}</span>
            <button type="button" className="play-btn is-ghost panel-x" title="Close" onClick={props.onCloseInspect}>
              ✕
            </button>
          </div>
          <div className="play-eyebrow">{props.inspecting.line}</div>
          {props.inspecting.text !== '' ? <div className="panel-prose" style={{ margin: '5px 0' }}>{props.inspecting.text}</div> : null}
          <div className="panel-facts">{props.inspecting.facts.join(' · ')}</div>
          {props.inspecting.cards !== undefined && props.inspecting.cards.length > 0 ? (
            <div data-testid="inspect-cards" style={{ marginTop: '4px' }}>
              {props.inspecting.cards.map((card) => (
                <div key={card.id} data-card={card.id} className="panel-card">
                  <b>{card.name}</b>
                  {card.text !== '' ? <div className="panel-prose">{card.text}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {props.journal.length > 0 ? (
        <div className="play-box panel-box is-fixed" data-testid="journal">
          <div className="play-eyebrow panel-heading">Journal</div>
          {props.journal.map((quest) => (
            <div key={quest.id} className="panel-quest" data-quest={quest.id}>
              <div className={quest.status === 'completed' ? 'is-done' : quest.status === 'failed' ? 'panel-detail' : ''} style={quest.status === 'completed' ? { color: 'var(--play-muted)', textDecoration: 'line-through' } : undefined}>
                {quest.name}
                {quest.status === 'failed' ? ' — failed' : ''}
              </div>
              {quest.status === 'active' ? (
                <div className="panel-detail" style={{ fontSize: '12px' }}>
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
        <div className="play-box panel-box is-fixed" data-testid="pack">
          <div className="play-eyebrow panel-heading">Carried</div>
          {props.carried.map((item) => (
            <div key={item.id} className="panel-row" data-item={item.id}>
              <span>{item.name}</span>
              <span className="panel-detail">
                {item.quantity > 1 ? `×${item.quantity}` : ''}
                {item.usable ? (
                  <button className="play-btn is-primary" data-testid="use-item" onClick={() => props.onUseItem(item.id)}>
                    Use
                  </button>
                ) : null}
                {item.wearable ? (
                  <button className="play-btn" data-testid="equip" onClick={() => props.onEquip(item.id)}>
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
          className="play-box panel-box is-log"
          data-testid="log"
          // The newest line is the one being read; keep it in view.
          ref={(el) => {
            if (el !== null) el.scrollTop = el.scrollHeight;
          }}
        >
          {log.slice(-12).map((line, i) => (
            <div key={i} className="panel-line" style={{ color: TONE[line.tone] }}>
              {logParts(line).map((part, j) =>
                part.id === null ? (
                  part.text
                ) : (
                  <span
                    key={j}
                    data-testid="log-entity"
                    data-entity={part.id}
                    onMouseEnter={() => props.onHoverEntity?.(part.id)}
                    onMouseLeave={() => props.onHoverEntity?.(null)}
                  >
                    {part.text}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
      ) : null}

      {talking !== null && talking.view !== null ? (
        <div className="play-box panel-box" data-testid="dialogue">
          {talking.view.lines.map((line, i) => (
            <div key={i} style={{ marginBottom: '6px' }}>
              {line.speaker !== undefined ? <span className="panel-speaker">{line.speaker}: </span> : null}
              <span className="panel-prose">{line.text}</span>
            </div>
          ))}
          {talking.view.options.map((option) => (
            <button
              key={option.index}
              disabled={!option.enabled}
              title={option.enabled ? undefined : 'Not available'}
              className="play-btn panel-option"
              onClick={() => props.onAnswer({ kind: 'choose', index: option.index })}
            >
              {option.text}
              {option.detail !== undefined ? <span className="panel-detail"> — {option.detail}</span> : null}
            </button>
          ))}
          {talking.view.options.length === 0 ? (
            <button className="play-btn is-primary" onClick={() => props.onAnswer({ kind: 'continue' })}>
              Continue
            </button>
          ) : null}
        </div>
      ) : null}

      {check !== null ? (
        <div className="play-box panel-box" data-testid="check-prompt">
          <div style={{ marginBottom: '8px' }}>
            {check.prompt ??
              (check.difficulty === 'target'
                ? `Roll ${check.trait} against ${check.targets.length === 0 ? 'nobody' : check.targets.map(props.nameOf).join(', ')}?`
                : `Roll ${check.trait} against ${check.difficulty}?`)}
            {check.prompt !== undefined && check.targets.length > 0 ? (
              <div className="panel-sub">Against {check.targets.map(props.nameOf).join(', ')}.</div>
            ) : null}
          </div>
          {check.experiences.length > 0 ? (
            <div style={{ marginBottom: '8px', fontSize: '12px' }}>
              <label className="panel-detail">Utilize an Experience (1 Light): </label>
              <select
                value={experience}
                disabled={props.actorGood < 1}
                title={props.actorGood < 1 ? 'No Light to spend' : undefined}
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
          <div className="panel-actions">
            <button
              className="play-btn is-primary"
              data-testid="roll"
              onClick={() => {
                const chosen = experience;
                setExperience('');
                props.onAnswer(chosen === '' || props.actorGood < 1 ? { kind: 'roll' } : { kind: 'roll', experience: chosen });
              }}
            >
              Roll {check.trait} {signed(check.modifier + (experience === '' ? 0 : (check.experiences.find((e) => e.name === experience)?.modifier ?? 0)))}
            </button>
            <button
              className="play-btn"
              onClick={() => {
                setExperience('');
                props.onAnswer({ kind: 'cancel' });
              }}
            >
              Step back
            </button>
          </div>
        </div>
      ) : null}

      {choice !== null ? (
        <div data-testid="choice-prompt" className="play-box panel-box">
          {choice.title !== undefined ? <div className="play-name" style={{ marginBottom: '6px' }}>{choice.title}</div> : null}
          {choice.body !== undefined ? <div className="panel-prose" style={{ marginBottom: '6px' }}>{choice.body}</div> : null}
          {choice.options.map((option) => (
            <button
              key={option.index}
              data-option={option.index}
              className="play-btn panel-option"
              onClick={() => props.onAnswer({ kind: 'choose', index: option.index })}
            >
              {option.label}
              {option.detail === undefined ? null : <span className="panel-detail"> — {option.detail}</span>}
            </button>
          ))}
        </div>
      ) : null}

      {pending === null && within !== null ? (
        <div>
          <button className="play-btn is-primary" onClick={() => props.onUse(within)} data-testid="use">
            Use what is in reach
          </button>
        </div>
      ) : null}
    </div>
  );
}
