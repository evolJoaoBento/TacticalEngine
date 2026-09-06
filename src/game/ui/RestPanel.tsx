/**
 * Taking a rest: short or long, and each character's two downtime moves.
 *
 * The SRD's four moves, as a pair of selects per character; the panel hands
 * a `RestPlan` back and `demo-abilities.ts` does the arithmetic and the log.
 */

import { useState } from 'preact/hooks';
import type { RestMove, RestPlan } from '../demo-abilities';

export interface RestPanelProps {
  party: readonly { id: string; name: string }[];
  onRest: (kind: 'short' | 'long', plan: RestPlan) => void;
  onClose: () => void;
}

const MOVES: readonly { kind: RestMove['kind']; label: string; targeted: boolean }[] = [
  { kind: 'tendWounds', label: 'Tend to wounds', targeted: true },
  { kind: 'clearStress', label: 'Clear Stress', targeted: false },
  { kind: 'repairArmor', label: 'Repair armor', targeted: true },
  { kind: 'prepare', label: 'Prepare (gain Hope)', targeted: false },
];

const box: Record<string, string | number> = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  width: '460px',
  background: 'rgba(16,18,24,0.97)',
  border: '1px solid #69d2ff',
  borderRadius: '8px',
  padding: '14px 16px',
  color: '#e8e6df',
  font: '13px/1.5 system-ui, sans-serif',
  pointerEvents: 'auto',
  boxSizing: 'border-box',
};

const field: Record<string, string | number> = {
  padding: '3px 6px',
  marginRight: '4px',
  border: '1px solid #39404d',
  borderRadius: '4px',
  background: 'rgba(0,0,0,0.3)',
  color: 'inherit',
  font: 'inherit',
};

function button(primary: boolean): Record<string, string | number> {
  return {
    padding: '4px 10px',
    marginRight: '6px',
    border: `1px solid ${primary ? '#69d2ff' : '#39404d'}`,
    borderRadius: '4px',
    background: primary ? 'rgba(105,210,255,0.18)' : 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  };
}

export function RestPanel(props: RestPanelProps): preact.JSX.Element {
  const [kind, setKind] = useState<'short' | 'long'>('short');
  const [moves, setMoves] = useState<Record<string, [RestMove, RestMove]>>(() =>
    Object.fromEntries(props.party.map((m) => [m.id, [{ kind: 'tendWounds' }, { kind: 'clearStress' }]])),
  );

  const set = (id: string, index: 0 | 1, move: RestMove): void => {
    const pair = moves[id] ?? [{ kind: 'tendWounds' }, { kind: 'clearStress' }];
    const next: [RestMove, RestMove] = index === 0 ? [move, pair[1]] : [pair[0], move];
    setMoves({ ...moves, [id]: next });
  };

  const pick = (id: string, index: 0 | 1) => {
    const move = (moves[id] ?? [{ kind: 'tendWounds' }, { kind: 'clearStress' }])[index];
    const spec = MOVES.find((m) => m.kind === move.kind)!;
    return (
      <span>
        <select
          style={field}
          value={move.kind}
          data-testid={`move-${index}`}
          onChange={(e) => set(id, index, { kind: (e.target as HTMLSelectElement).value as RestMove['kind'] })}
        >
          {MOVES.map((m) => (
            <option key={m.kind} value={m.kind}>
              {m.label}
            </option>
          ))}
        </select>
        {spec.targeted ? (
          <select
            style={field}
            value={'target' in move && move.target !== undefined ? move.target : id}
            data-testid={`target-${index}`}
            onChange={(e) => set(id, index, { kind: move.kind as 'tendWounds' | 'repairArmor', target: (e.target as HTMLSelectElement).value })}
          >
            {props.party.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === id ? 'themselves' : m.name}
              </option>
            ))}
          </select>
        ) : null}
      </span>
    );
  };

  return (
    <div style={box} data-testid="rest">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: '15px' }}>Rest</strong>
        <span>
          <label style={{ marginRight: '10px', cursor: 'pointer' }}>
            <input type="radio" name="rest-kind" checked={kind === 'short'} onChange={() => setKind('short')} data-testid="rest-short" /> Short (1d4 + tier)
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input type="radio" name="rest-kind" checked={kind === 'long'} onChange={() => setKind('long')} data-testid="rest-long" /> Long (everything)
          </label>
        </span>
      </div>
      <div style={{ color: '#8ea3b0', fontSize: '11px', margin: '4px 0 8px' }}>
        Two downtime moves each. Preparing together gives 2 Hope each. The GM gains {kind === 'short' ? '1d4' : `1d4 + ${props.party.length}`} Fear.
      </div>
      {props.party.map((member) => (
        <div key={member.id} style={{ marginBottom: '6px' }} data-rest-member={member.id}>
          <div style={{ fontWeight: 600, marginBottom: '2px' }}>{member.name}</div>
          <div>{pick(member.id, 0)}</div>
          <div style={{ marginTop: '2px' }}>{pick(member.id, 1)}</div>
        </div>
      ))}
      <div style={{ marginTop: '10px' }}>
        <button style={button(true)} data-testid="take-rest" onClick={() => props.onRest(kind, { moves })}>
          Rest
        </button>
        <button style={button(false)} onClick={props.onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}
