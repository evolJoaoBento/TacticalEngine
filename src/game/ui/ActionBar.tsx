/**
 * The action bar: what the selected character can do right now.
 *
 * One button per ability, greyed with the reason when it cannot be used, a
 * weapon attack, and the turn's own verbs — pass the spotlight to the GM,
 * open the loadout, rest. An ability that wants a target arms the bar: the
 * next click on the board picks it, and Escape puts the bar down again.
 *
 * Nothing here decides anything; `demo-abilities.ts` says what is usable and
 * why, and this lays it out. The look is `hud.css`.
 */

import type { AbilityView } from '../demo-abilities';
import { CardArtwork } from './CardFace';
import { domainColor } from './card-sigil';
import './hud.css';

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

/** "1 Light · 2 Stress · 1 left" — what a card costs, at a glance. */
function badges(view: AbilityView): string {
  const parts: string[] = [];
  const cost = view.ability.cost;
  if ((cost.good ?? 0) > 0) parts.push(`${cost.good} Light`);
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
      <div className="play bar" data-testid="action-bar" data-targeting={props.targeting.abilityId}>
        <div className="play-box bar-row is-armed">
          <span className="bar-armed">
            {props.targeting.name}: click {props.targeting.spot === true ? 'a spot' : 'a target'} on the board
          </span>
          <button className="play-btn is-primary" data-testid="cancel-targeting" onClick={props.onCancelTargeting}>
            Cancel (Esc)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="play bar" data-testid="action-bar">
      <div className="play-box bar-row">
        <div className="bar-who">
          <span className="play-name">{props.name}</span>
          <span className="play-eyebrow">{props.fighting ? (props.side === 'party' ? 'Your turn' : "GM's turn") : 'Selected'}</span>
        </div>
        <div className="bar-chips">
        <span className={`chip is-attack${gmTurn ? ' is-off' : ''}`} title="Click an adversary on the board to attack" data-testid="attack-chip">
          <div>Attack</div>
          <div className="chip-sub">{props.weapon}</div>
        </span>
        {props.abilities.map((view) => (
          <button
            key={view.ability.id}
            className={`chip ability-card-chip${view.usable ? ' is-usable' : ''}`}
            disabled={!view.usable}
            title={`${view.text}${view.reason === null ? '' : `\n\n(${view.reason})`}`}
            data-ability={view.ability.id}
            data-usable={view.usable}
            onClick={() => props.onUse(view.ability.id)}
          >
            {view.card !== null ? (
              <span className="ability-card-art" style={{ background: domainColor(view.card.domain) }}>
                <CardArtwork card={view.card} />
              </span>
            ) : null}
            <div>{view.ability.name}</div>
            <div className="chip-sub">{view.reason ?? badges(view) ?? ''}</div>
          </button>
        ))}
        </div>
      </div>
      <div className="bar-verbs">
        {props.fighting ? (
          <button
            className="play-btn is-primary"
            disabled={props.side !== 'party'}
            title="Hand the spotlight to the GM (Space)"
            data-testid="pass-to-gm"
            onClick={props.onPassToGm}
          >
            Pass to GM
          </button>
        ) : (
          <button className="play-btn" data-testid="open-rest" onClick={props.onRest}>
            Rest…
          </button>
        )}
        <button className="play-btn" data-testid="open-loadout" onClick={props.onLoadout}>
          Loadout…
        </button>
      </div>
    </div>
  );
}
