/**
 * The action bar: what the selected character can do right now.
 *
 * One button per ability, greyed with the reason when it cannot be used, a
 * weapon attack, and the turn's own verbs — pass the spotlight to the GM,
 * open the loadout, rest. An ability that wants a target arms the bar: the
 * next click on the board picks it, and Escape puts the bar down again.
 *
 * Nothing here decides anything; `demo-abilities.ts` says what is usable and
 * why, and this lays it out.
 */

import type { AbilityView } from '../demo-abilities';
import './cards.css';

export interface ActionBarProps {
  /** The selected character, or null when nobody is. */
  characterId: string | null;
  name: string;
  weapon: string;
  abilities: readonly AbilityView[];
  /** Whether a fight is on, and whose turn it is. */
  fighting: boolean;
  side: 'party' | 'gm' | null;
  /** The ability waiting for a target, if any. `spot` when it wants ground rather than a creature. */
  targeting: { abilityId: string; name: string; spot?: boolean } | null;
  onUse: (abilityId: string) => void;
  onCancelTargeting: () => void;
  onPassToGm: () => void;
  onLoadout: () => void;
  onRest: () => void;
}

const wrap: Record<string, string | number> = {
  position: 'absolute',
  left: '50%',
  // Along the top edge, where nothing else sits and the board is not.
  top: '12px',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '6px',
  color: '#e8e6df',
  font: '12px/1.4 system-ui, sans-serif',
  // The bar floats over the board: only its buttons take the pointer, so a
  // tile seen through the panel can still be hovered and clicked.
  pointerEvents: 'none',
  maxWidth: '60vw',
};

const row: Record<string, string | number> = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: '6px',
  padding: '8px 10px',
  background: 'rgba(16,18,24,0.9)',
  border: '1px solid #39404d',
  borderRadius: '8px',
};

function chip(kind: 'ability' | 'attack' | 'turn' | 'armed', usable: boolean): Record<string, string | number> {
  const border = kind === 'armed' ? '#ffe08a' : kind === 'attack' ? '#ffc861' : kind === 'turn' ? '#69d2ff' : '#7fd1ff';
  return {
    padding: '5px 10px',
    border: `1px solid ${usable ? border : '#39404d'}`,
    borderRadius: '5px',
    background: kind === 'armed' ? 'rgba(255,224,138,0.18)' : 'rgba(0,0,0,0.25)',
    color: usable ? 'inherit' : '#8ea3b0',
    font: 'inherit',
    cursor: usable ? 'pointer' : 'default',
    opacity: usable ? 1 : 0.6,
    textAlign: 'left',
    minWidth: '92px',
    pointerEvents: 'auto',
  };
}

const small: Record<string, string | number> = { fontSize: '10px', color: '#8ea3b0' };

/** "1 Hope · 2 Stress · 1 left" — what a card costs, at a glance. */
function badges(view: AbilityView): string {
  const parts: string[] = [];
  const cost = view.ability.cost;
  if ((cost.hope ?? 0) > 0) parts.push(`${cost.hope} Hope`);
  if ((cost.stress ?? 0) > 0) parts.push(`${cost.stress} Stress`);
  if (view.usesLeft !== null) parts.push(`${view.usesLeft} left`);
  if (view.ability.kind === 'passive') parts.push('passive');
  if (view.ability.kind === 'reaction') parts.push('reaction');
  return parts.join(' · ');
}

export function ActionBar(props: ActionBarProps): preact.JSX.Element | null {
  if (props.characterId === null) return null;
  const gmTurn = props.fighting && props.side === 'gm';

  if (props.targeting !== null) {
    return (
      <div style={wrap} data-testid="action-bar" data-targeting={props.targeting.abilityId}>
        <div style={{ ...row, border: '1px solid #ffe08a' }}>
          <span style={{ padding: '5px 4px' }}>
            {props.targeting.name}: click {props.targeting.spot === true ? 'a spot' : 'a target'} on the board
          </span>
          <button style={chip('armed', true)} data-testid="cancel-targeting" onClick={props.onCancelTargeting}>
            Cancel (Esc)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap} data-testid="action-bar">
      <div style={row}>
        <span style={{ ...small, alignSelf: 'center', marginRight: '4px' }}>{props.name}</span>
        <span style={chip('attack', !gmTurn)} title="Click an adversary on the board to attack" data-testid="attack-chip">
          <div>Attack</div>
          <div style={small}>{props.weapon}</div>
        </span>
        {props.abilities.map((view) => (
          <button
            key={view.ability.id}
            className="ability-card-chip"
            style={chip('ability', view.usable)}
            disabled={!view.usable}
            title={`${view.text}${view.reason === null ? '' : `\n\n(${view.reason})`}`}
            data-ability={view.ability.id}
            data-usable={view.usable}
            onClick={() => props.onUse(view.ability.id)}
          >
            {view.ability.source.kind === 'domainCard' ? <img className="ability-card-art" src={`/cards/${view.ability.source.card}.jpg`} alt="" /> : null}
            <div>{view.ability.name}</div>
            <div style={small}>{view.reason ?? badges(view) ?? ''}</div>
          </button>
        ))}
      </div>
      <div style={{ ...row, padding: '4px 8px' }}>
        {props.fighting ? (
          <button
            style={chip('turn', props.side === 'party')}
            disabled={props.side !== 'party'}
            title="Hand the spotlight to the GM (Space)"
            data-testid="pass-to-gm"
            onClick={props.onPassToGm}
          >
            Pass to GM
          </button>
        ) : (
          <button style={chip('turn', true)} data-testid="open-rest" onClick={props.onRest}>
            Rest…
          </button>
        )}
        <button style={chip('turn', true)} data-testid="open-loadout" onClick={props.onLoadout}>
          Loadout…
        </button>
      </div>
    </div>
  );
}
