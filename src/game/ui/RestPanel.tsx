/**
 * Taking a rest: short or long, and each character's two downtime moves (`rest-call.ts`).
 *
 * The SRD's four moves, as a pair of selects per character. With nobody called, the kind and the page's own
 * characters' moves, and the button that calls it - which, for a player alone, is the rest taken. With a rest
 * called, whoever has not agreed is asked to (Agree, or Not now, which calls it off); then each chooses their own
 * characters' moves (Ready), seeing what the others chose - so two can Prepare together - and whose are still to
 * come. It stays up while a rest is called: its buttons are the way out, not Escape.
 */

import { useState } from 'preact/hooks';
import type { RestMove } from '../demo-abilities';
import type { RestPanelProps } from '../rest-call';
import './hud.css';

export type { RestPanelProps };

const MOVES: readonly { kind: RestMove['kind']; label: string; targeted: boolean }[] = [
  { kind: 'tendWounds', label: 'Tend to wounds', targeted: true },
  { kind: 'clearStress', label: 'Clear Stress', targeted: false },
  { kind: 'repairArmor', label: 'Repair armor', targeted: true },
  { kind: 'prepare', label: 'Prepare (gain Light)', targeted: false },
];

const FIRST: [RestMove, RestMove] = [{ kind: 'tendWounds' }, { kind: 'clearStress' }];

/** Two moves as a line: "Prepare, Clear Stress". */
const said = (pair: readonly RestMove[]): string => pair.map((move) => MOVES.find((m) => m.kind === move.kind)?.label ?? move.kind).join(', ');

export function RestPanel(props: RestPanelProps): preact.JSX.Element {
  const call = props.call;
  const [kind, setKind] = useState<'short' | 'long'>('short');
  const mine = props.party.filter((member) => member.mine);
  const [moves, setMoves] = useState<Record<string, [RestMove, RestMove]>>(() =>
    Object.fromEntries(mine.map((m) => [m.id, (call?.moves[m.id] as [RestMove, RestMove] | undefined) ?? FIRST])),
  );
  const shownKind = call?.kind ?? kind;
  const own = (): Record<string, [RestMove, RestMove]> => Object.fromEntries(mine.map((m) => [m.id, moves[m.id] ?? FIRST]));

  const set = (id: string, index: 0 | 1, move: RestMove): void => {
    const pair = moves[id] ?? FIRST;
    const next: [RestMove, RestMove] = index === 0 ? [move, pair[1]] : [pair[0], move];
    setMoves({ ...moves, [id]: next });
  };

  const pick = (id: string, index: 0 | 1) => {
    const move = (moves[id] ?? FIRST)[index];
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

  // Whom the call still waits on to agree - the others: the page's own player is asked by the buttons above.
  const waitingOn = call === null ? [] : call.voters.filter((voter) => !call.agreed.includes(voter)).map(props.playerOf).filter((name) => name !== 'You');
  return (
    <div className="play rest" data-testid="rest">
      <div className="rest-head">
        <h2>Rest</h2>
        {call === null ? (
          <span className="rest-kind">
            <label>
              <input type="radio" name="rest-kind" checked={kind === 'short'} onChange={() => setKind('short')} data-testid="rest-short" /> Short (1d4 + tier)
            </label>
            <label>
              <input type="radio" name="rest-kind" checked={kind === 'long'} onChange={() => setKind('long')} data-testid="rest-long" /> Long (everything)
            </label>
          </span>
        ) : (
          <span className="rest-kind" data-testid="rest-called">
            {props.playerOf(call.by)} called a {call.kind} rest
          </span>
        )}
      </div>
      <div className="rest-note">
        Two downtime moves each. Preparing together gives 2 Light each. The GM gains {shownKind === 'short' ? '1d4' : `1d4 + ${props.party.length}`} Shadow.
        {props.alone ? null : ' Everybody who plays a character agrees to it, then chooses their own characters’ moves.'}
      </div>
      {call !== null && props.toVote ? (
        <div className="rest-actions" data-testid="rest-vote">
          <button className="play-btn is-primary" data-testid="rest-agree" onClick={() => props.onVote(true)}>
            Agree
          </button>
          <button className="play-btn" data-testid="rest-decline" onClick={() => props.onVote(false)}>
            Not now
          </button>
        </div>
      ) : (
        mine.map((member) => (
          <div key={member.id} className="rest-member" data-rest-member={member.id}>
            <div className="play-name">{member.name}</div>
            <div>{pick(member.id, 0)}</div>
            <div style={{ marginTop: '3px' }}>{pick(member.id, 1)}</div>
          </div>
        ))
      )}
      {call === null ? null : (
        <div className="rest-others" data-testid="rest-status">
          {props.party
            .filter((member) => !member.mine)
            .map((member) => {
              const chosen = call.moves[member.id];
              return (
                <div key={member.id} data-rest-status={member.id}>
                  <b>{member.name}</b>: {chosen === undefined ? 'choosing…' : said(chosen)}
                </div>
              );
            })}
          {waitingOn.length === 0 ? null : <div data-testid="rest-waiting">Waiting for {waitingOn.join(', ')} to agree.</div>}
        </div>
      )}
      <div className="rest-actions">
        {call === null ? (
          <button className="play-btn is-primary" data-testid="take-rest" onClick={() => props.onCall(kind, own())}>
            {props.alone ? 'Rest' : 'Call a rest'}
          </button>
        ) : props.toVote ? null : (
          <button className="play-btn is-primary" data-testid="rest-ready" disabled={mine.length === 0} onClick={() => props.onChoose(own())}>
            Ready
          </button>
        )}
        {call !== null && props.mayCancel ? (
          <button className="play-btn" data-testid="rest-cancel" onClick={props.onCancel}>
            Call it off
          </button>
        ) : null}
        {call === null ? (
          <button className="play-btn" onClick={props.onClose}>
            Not now
          </button>
        ) : null}
      </div>
    </div>
  );
}
