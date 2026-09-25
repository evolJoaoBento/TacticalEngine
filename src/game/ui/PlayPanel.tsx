/**
 * The play-mode overlay: what just happened, and anything the game is waiting on.
 *
 * The legacy prototype's narrative pane is the part of it people actually read
 * (`docs/research/legacy-ui.md`), and until now the port had nowhere to put a
 * line of prose. This is deliberately small: a log, and a prompt when a script
 * stops for an answer.
 *
 * Text only. Lines are read, never spoken — CONTEXT.md rules out narration.
 * The look is `hud.css`: paper, brown ink, and Cinzel over Libre Baskerville.
 */

import { useState } from 'preact/hooks';
import type { Pending } from '../demo-scene';
import type { LogLine, RollShow } from '../log';
import type { Response } from '../../engine/script/runner';
import { RollStage, asked } from './RollStage';
import { SettingsModal } from './SettingsModal';
import { GearFace } from './GearBinder';
import type { GearCard } from '../gear';
import './hud.css';


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

/**
 * A container that has been opened: what it is called and what is still in it - or a shop, whose
 * lines have prices and whose Take is Buy, and which says what it is paid in and how much the party has.
 */
export interface OpenContainer {
  id: string;
  name: string;
  /** In a shop, each line is a card as well (`card`), and the window shows the cards. */
  lines: readonly { item: string; name: string; count: number; price?: number; card?: GearCard | null }[];
  paidIn?: { name: string; held: number };
  /** In a shop: what the party carries that the seller buys back, and for how much. */
  selling?: readonly { item: string; name: string; held: number; price: number; card?: GearCard | null }[];
  onSell?: (item: string) => void;
  onTake: (item: string) => void;
  onClose: () => void;
}

export interface PlayPanelProps {
  log: readonly LogLine[];
  /** A container whose contents are showing, until it is closed or walked away from. */
  container?: OpenContainer | null;
  /** What was right-clicked, until closed. */
  inspecting: Inspection | null;
  onCloseInspect: () => void;
  /** Quests the party has been given, active first. */
  journal: readonly JournalQuest[];
  /** Somebody named in the log is under the pointer, or nobody is. */
  onHoverEntity?: (id: string | null) => void;
  pending: Pending | null;
  /** Duality rolls waiting to be watched, oldest first. */
  rolls: readonly RollShow[];
  /** How long a roll tumbles. Zero lands it at once. */
  millis: number;
  /** This roll has been read; take it out of the queue. */
  onRollDone: (id: number) => void;
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
  /** A creature's name for the log, by id. */
  nameOf: (id: string) => string;
  /** The acting character's Light, for the Experience picker. */
  actorGood: number;
}

/**
 * The log's tones, and the floaters' over heads (`main.ts`): good is the Light die's gold and
 * bad the Shadow die's violet, so what the dice say and what the log says wear the same colours.
 *
 * Inks, since both grounds are now light -- the log is written on the panel's paper, and a floater
 * is the same ink carried on a cream halo (`hud.css`, `.floater`) so it reads over the lit board.
 */
export const TONE: Readonly<Record<LogLine['tone'], string>> = {
  narration: '#3b2e21',
  system: '#6a5f4d',
  good: '#8a6212',
  bad: '#54398c',
  combat: '#a8321f',
  success: '#2b6b30',
};

export function PlayPanel(props: PlayPanelProps): preact.JSX.Element | null {
  const { log, pending, within } = props;
  const [saves, setSaves] = useState(false);

  // A conversation raises its own prompts, so the panel reads the innermost
  // thing waiting rather than assuming the script is the one asking. A check is
  // not the panel's to draw: it is asked and thrown on a card over the room.
  const talking = pending !== null && pending.kind === 'script' ? pending.dialogue : null;
  const asking = asked(pending);
  const choice = asking !== null && asking.kind === 'choice' ? asking : null;

  return (
    <div className="play panel">
      <RollStage
        rolls={props.rolls}
        millis={props.millis}
        pending={pending}
        actorGood={props.actorGood}
        nameOf={props.nameOf}
        onAnswer={props.onAnswer}
        onDone={props.onRollDone}
      />
      <SettingsModal games={(close) => (
        <>
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
            <div className="settings-saves" data-testid="saves">
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
                      close();
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
        </>
      )} />

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

      {props.container ? <ContainerWindow container={props.container} /> : null}

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

      {/* What the party carries is in the loadout now, as cards (`GearBinder.tsx`). */}

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

      {/* The conversation itself is along the bottom, where the cards were (`Conversation`, `ActionBar`). */}

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

/**
 * An open container, in the panel stack - or a shop, in the middle of the screen over everything,
 * with the room dimmed behind it. A shop is closed - its x, or a click outside it - before anything
 * else goes on: the board cannot be clicked through it, and a conversation that opened it waits
 * (`answerPending`). The loadout's book is lifted above the dimming (`hud.css`), and its binder
 * opens over the shop, as the settings do.
 */
function ContainerWindow({ container }: { container: OpenContainer }): preact.JSX.Element {
  const shop = container.paidIn !== undefined;
  const paid = container.paidIn?.name.toLowerCase();
  const box = (
    <div className={`play-box panel-box ${shop ? 'shop-window' : 'is-fixed'}`} data-testid="container" data-container={container.id}>
      <div className="panel-head">
        <span className="play-name">{container.name}</span>
        <button type="button" className="play-btn is-ghost panel-x" title="Close" data-testid="container-close" onClick={container.onClose}>
          ✕
        </button>
      </div>
      {container.paidIn === undefined ? null : (
        <div className="panel-prose" data-testid="shop-purse">
          You have {container.paidIn.held} {paid}.
        </div>
      )}
      {container.lines.length === 0 ? (
        <div className="panel-prose" data-testid="container-empty">{shop ? 'Sold out.' : 'Nothing left in it.'}</div>
      ) : shop ? (
        // A merchant's wares are cards on his table: each with its price, and how many are left.
        <div className="shop-cards">
          {container.lines.map((line) => (
            <div key={line.item} className="shop-card" data-item={line.item}>
              {line.card === null || line.card === undefined ? <div className="shop-plain">{line.name}</div> : <GearFace card={line.card} />}
              <div className="shop-deal">
                {line.count > 1 && Number.isFinite(line.count) ? <span className="shop-left">×{line.count}</span> : null}
                <button
                  className="play-btn is-primary"
                  data-testid="shop-buy"
                  disabled={(line.price ?? 0) > (container.paidIn?.held ?? 0)}
                  title={(line.price ?? 0) > (container.paidIn?.held ?? 0) ? 'Not enough to pay for it' : undefined}
                  onClick={() => container.onTake(line.item)}
                >
                  Buy · {line.price} {paid}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        container.lines.map((line) => (
          <div key={line.item} className="panel-row" data-item={line.item}>
            <span>{line.name}</span>
            <span className="panel-detail">
              {line.count > 1 && Number.isFinite(line.count) ? `×${line.count}` : ''}
              <button className="play-btn is-primary" data-testid="container-take" onClick={() => container.onTake(line.item)}>
                Take
              </button>
            </span>
          </div>
        ))
      )}
      {container.selling === undefined || container.selling.length === 0 ? null : (
        <div data-testid="shop-selling">
          <div className="play-eyebrow panel-heading">Sell</div>
          <div className="shop-cards is-selling">
            {container.selling.map((line) => (
              <div key={line.item} className="shop-card" data-sell={line.item}>
                {line.card === null || line.card === undefined ? <div className="shop-plain">{line.name}</div> : <GearFace card={line.card} />}
                <div className="shop-deal">
                  {line.held > 1 ? <span className="shop-left">×{line.held}</span> : null}
                  <button className="play-btn" data-testid="shop-sell" onClick={() => container.onSell?.(line.item)}>
                    Sell · {line.price} {paid}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
  // A click outside the window closes it, as its x does.
  return shop ? <div className="shop-backdrop" data-testid="shop-backdrop" onClick={(e) => { if (e.target === e.currentTarget) container.onClose(); }}>{box}</div> : box;
}
