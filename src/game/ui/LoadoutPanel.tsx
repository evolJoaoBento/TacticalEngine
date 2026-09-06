/**
 * The loadout and the vault, for one character.
 *
 * Five cards active, the rest waiting. Recalling a card from the vault costs
 * Stress equal to its Recall Cost unless the party is resting, and the button
 * says so; when the loadout is full the player picks which card makes room.
 */

import { useState } from 'preact/hooks';
import type { LoadoutView } from '../demo-abilities';

export interface LoadoutPanelProps {
  name: string;
  view: LoadoutView;
  /** Whether swapping is free right now. */
  resting: boolean;
  /** Why the last swap was refused, if it was. */
  issue: string | null;
  onSwap: (cardIn: string, cardOut: string | undefined) => void;
  onClose: () => void;
}

const box: Record<string, string | number> = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  width: '420px',
  maxHeight: '80vh',
  overflowY: 'auto',
  background: 'rgba(16,18,24,0.97)',
  border: '1px solid #69d2ff',
  borderRadius: '8px',
  padding: '14px 16px',
  color: '#e8e6df',
  font: '13px/1.5 system-ui, sans-serif',
  pointerEvents: 'auto',
  boxSizing: 'border-box',
};

const heading: Record<string, string | number> = {
  color: '#8ea3b0',
  margin: '8px 0 4px',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

function button(primary: boolean): Record<string, string | number> {
  return {
    padding: '3px 9px',
    marginLeft: '6px',
    border: `1px solid ${primary ? '#69d2ff' : '#39404d'}`,
    borderRadius: '4px',
    background: primary ? 'rgba(105,210,255,0.18)' : 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  };
}

export function LoadoutPanel(props: LoadoutPanelProps): preact.JSX.Element {
  const { view } = props;
  const full = view.loadout.length >= view.limit;
  /** The loadout card chosen to make room, when the loadout is full. */
  const [out, setOut] = useState<string | null>(null);

  return (
    <div style={box} data-testid="loadout">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: '15px' }}>{props.name} — loadout</strong>
        <span style={{ color: '#8ea3b0' }}>
          {view.loadout.length} / {view.limit}
        </span>
      </div>

      <div style={heading}>Active</div>
      {view.loadout.map((card) => (
        <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }} data-card={card.id}>
          <span>{card.name}</span>
          {full ? (
            <label style={{ color: '#8ea3b0', fontSize: '11px', cursor: 'pointer' }}>
              <input type="radio" name="vault-out" checked={out === card.id} onChange={() => setOut(card.id)} data-testid="pick-out" /> make room
            </label>
          ) : null}
        </div>
      ))}
      {view.loadout.length === 0 ? <div style={{ color: '#8ea3b0' }}>Nothing active.</div> : null}

      <div style={heading}>Vault</div>
      {view.vault.map((card) => {
        const cost = props.resting ? 0 : card.recallCost;
        const needsRoom = full && out === null;
        return (
          <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }} data-card={card.id}>
            <span>{card.name}</span>
            <button
              style={{ ...button(true), opacity: needsRoom ? 0.5 : 1 }}
              disabled={needsRoom}
              title={needsRoom ? 'The loadout is full: pick a card to make room' : cost > 0 ? `Mark ${cost} Stress to recall it now` : 'Recall it, free'}
              data-testid="recall"
              onClick={() => props.onSwap(card.id, full ? (out ?? undefined) : undefined)}
            >
              Recall{cost > 0 ? ` (${cost} Stress)` : ''}
            </button>
          </div>
        );
      })}
      {view.vault.length === 0 ? <div style={{ color: '#8ea3b0' }}>The vault is empty.</div> : null}

      {props.issue !== null ? (
        <div style={{ color: '#ff9d7a', margin: '8px 0' }} data-testid="loadout-issue">
          {props.issue}
        </div>
      ) : null}

      <div style={{ marginTop: '10px', textAlign: 'right' }}>
        <button style={button(false)} onClick={props.onClose} data-testid="close-loadout">
          Close
        </button>
      </div>
    </div>
  );
}
