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

export interface PlayPanelProps {
  log: readonly LogLine[];
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

export function PlayPanel(props: PlayPanelProps): preact.JSX.Element | null {
  const { log, pending, within } = props;
  if (log.length === 0 && pending === null && within === null) return null;

  return (
    <div style={wrap}>
      {log.length > 0 ? (
        <div style={logBox} data-testid="log">
          {log.slice(-12).map((line, i) => (
            <div key={i} style={{ color: TONE[line.tone], marginBottom: '4px' }}>
              {line.text}
            </div>
          ))}
        </div>
      ) : null}

      {pending !== null && pending.prompt.kind === 'check' ? (
        <div style={{ ...logBox, background: 'rgba(20,26,34,0.95)' }}>
          <div style={{ marginBottom: '8px' }}>
            {pending.prompt.prompt ??
              `Roll ${pending.prompt.trait} against ${pending.prompt.difficulty}?`}
          </div>
          <button style={button(true)} onClick={() => props.onAnswer({ kind: 'roll' })}>
            Roll {pending.prompt.trait} +{pending.prompt.modifier}
          </button>
          <button style={button(false)} onClick={() => props.onAnswer({ kind: 'cancel' })}>
            Step back
          </button>
        </div>
      ) : null}

      {pending !== null && pending.prompt.kind === 'choice' ? (
        <div style={{ ...logBox, background: 'rgba(20,26,34,0.95)' }}>
          {pending.prompt.title !== undefined ? (
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{pending.prompt.title}</div>
          ) : null}
          {pending.prompt.options.map((option) => (
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
