/**
 * Taking a rest: short or long, and each character's two downtime moves.
 *
 * The SRD's four moves, as a pair of selects per character; the panel hands
 * a `RestPlan` back and `demo-abilities.ts` does the arithmetic and the log.
 */

import { useState } from 'preact/hooks';
import type { RestMove, RestPlan } from '../demo-abilities';
import './hud.css';

export interface RestPanelProps {
  party: readonly { id: string; name: string }[];
  onRest: (kind: 'short' | 'long', plan: RestPlan) => void;
  onClose: () => void;
}

const MOVES: readonly { kind: RestMove['kind']; label: string; targeted: boolean }[] = [
  { kind: 'tendWounds', label: 'Tend to wounds', targeted: true },
  { kind: 'clearStress', label: 'Clear Stress', targeted: false },
  { kind: 'repairArmor', label: 'Repair armor', targeted: true },
  { kind: 'prepare', label: 'Prepare (gain Light)', targeted: false },
];

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
    <div className="play rest" data-testid="rest">
      <div className="rest-head">
        <h2>Rest</h2>
        <span className="rest-kind">
          <label>
            <input type="radio" name="rest-kind" checked={kind === 'short'} onChange={() => setKind('short')} data-testid="rest-short" /> Short (1d4 + tier)
          </label>
          <label>
            <input type="radio" name="rest-kind" checked={kind === 'long'} onChange={() => setKind('long')} data-testid="rest-long" /> Long (everything)
          </label>
        </span>
      </div>
      <div className="rest-note">
        Two downtime moves each. Preparing together gives 2 Light each. The GM gains {kind === 'short' ? '1d4' : `1d4 + ${props.party.length}`} Shadow.
      </div>
      {props.party.map((member) => (
        <div key={member.id} className="rest-member" data-rest-member={member.id}>
          <div className="play-name">{member.name}</div>
          <div>{pick(member.id, 0)}</div>
          <div style={{ marginTop: '3px' }}>{pick(member.id, 1)}</div>
        </div>
      ))}
      <div className="rest-actions">
        <button className="play-btn is-primary" data-testid="take-rest" onClick={() => props.onRest(kind, { moves })}>
          Rest
        </button>
        <button className="play-btn" onClick={props.onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}
