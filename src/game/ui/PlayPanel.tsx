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

import type { LogLine, PendingScript } from '../demo-scene';
import type { Response } from '../../engine/script/runner';

/** One line of the pack: what it is, and how many. */
export interface CarriedItem {
  id: string;
  name: string;
  quantity: number;
}

export interface PlayPanelProps {
  log: readonly LogLine[];
  /** What the party is carrying. */
  carried: readonly CarriedItem[];
  pending: PendingScript | null;
  /** Named when something is close enough to touch. */
  within: string | null;
  onUse: (id: string) => void;
  onAnswer: (response: Response) => void;
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
  maxHeight: '60vh',
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

/** A modifier reads as +2 or -1, never as +-1. */
const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

export function PlayPanel(props: PlayPanelProps): preact.JSX.Element | null {
  const { log, pending, within } = props;
  if (log.length === 0 && pending === null && within === null && props.carried.length === 0) {
    return null;
  }

  // A conversation raises its own prompts, so the panel reads the innermost
  // thing waiting rather than assuming the script is the one asking.
  const talking = pending?.dialogue ?? null;
  const asking = talking?.prompt ?? (talking === null ? (pending?.prompt ?? null) : null);
  const check = asking !== null && asking.kind === 'check' ? asking : null;
  const choice = asking !== null && asking.kind === 'choice' ? asking : null;

  return (
    <div style={wrap}>
      {props.carried.length > 0 ? (
        <div style={{ ...logBox, padding: '8px 12px' }} data-testid="pack">
          <div
            style={{
              color: '#8ea3b0',
              font: '600 10px/1 system-ui, sans-serif',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}
          >
            Carried
          </div>
          {props.carried.map((item) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{item.name}</span>
              <span style={{ color: '#8ea3b0' }}>{item.quantity > 1 ? `×${item.quantity}` : ''}</span>
            </div>
          ))}
        </div>
      ) : null}

      {log.length > 0 ? (
        <div style={logBox} data-testid="log">
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
        <div style={{ ...logBox, background: 'rgba(20,26,34,0.95)' }}>
          <div style={{ marginBottom: '8px' }}>
            {check.prompt ?? `Roll ${check.trait} against ${check.difficulty}?`}
          </div>
          <button style={button(true)} onClick={() => props.onAnswer({ kind: 'roll' })}>
            Roll {check.trait} {signed(check.modifier)}
          </button>
          <button style={button(false)} onClick={() => props.onAnswer({ kind: 'cancel' })}>
            Step back
          </button>
        </div>
      ) : null}

      {choice !== null ? (
        <div style={{ ...logBox, background: 'rgba(20,26,34,0.95)' }}>
          {choice.title !== undefined ? (
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{choice.title}</div>
          ) : null}
          {choice.options.map((option) => (
            <button
              key={option.index}
              style={{ ...button(false), display: 'block', marginBottom: '4px', width: '100%', textAlign: 'left' }}
              onClick={() => props.onAnswer({ kind: 'choose', index: option.index })}
            >
              {option.label}
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
