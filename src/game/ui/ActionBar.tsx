/**
 * The hand: what the selected character can do right now, as cards.
 *
 * Fanned along the bottom of the screen the way a deck-builder holds them: the
 * weapon attack and every action or reaction as a card face, lifting under the
 * pointer, greyed with the reason when it cannot be played. Passives are not
 * cards to play, so they sit above the hand as small emblems -- relics -- with
 * their text on hover. The Light the character can spend is the orb at the
 * hand's left; the turn's own verbs -- pass the spotlight, rest, the loadout --
 * are at its right. An ability that wants a target arms the hand: the next
 * click on the board picks it, and Escape puts the card back.
 *
 * Nothing here decides anything; `demo-abilities.ts` says what is usable and
 * why, and this lays it out. The look is `hud.css`.
 */

import type { AbilityView } from '../demo-abilities';
import { CardArtwork } from './CardFace';
import { domainColor } from './card-sigil';
import './cards.css';
import './hud.css';

export interface ActionBarProps {
  /** The selected character, or null when nobody is. */
  characterId: string | null;
  name: string;
  weapon: string;
  abilities: readonly AbilityView[];
  /** What the selected character has to spend, for the orb. */
  light: { value: number; max: number } | null;
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
  if (view.ability.kind === 'reaction') parts.push('reaction');
  return parts.join(' · ');
}

/**
 * Where a card sits in the fan: tilted away from the middle, and dropped a little the further out
 * it is. The whole spread is held to about twelve degrees, so a big hand's end cards do not swing
 * out past the fan.
 */
function pose(index: number, count: number): Record<string, string> {
  const off = index - (count - 1) / 2;
  const step = count > 1 ? Math.min(4, 12 / (count - 1)) : 0;
  return { '--tilt': `${(off * step).toFixed(1)}deg`, '--drop': `${(off * off * 2.4).toFixed(1)}px` };
}

export function ActionBar(props: ActionBarProps): preact.JSX.Element | null {
  if (props.characterId === null) return null;
  const gmTurn = props.fighting && props.side === 'gm';
  const armed = props.targeting;
  const relics = props.abilities.filter((view) => view.ability.kind === 'passive');
  const hand = props.abilities.filter((view) => view.ability.kind !== 'passive');
  const count = hand.length + 1;

  return (
    <div className={`play bar${armed === null ? '' : ' is-armed'}`} data-testid="action-bar" {...(armed === null ? {} : { 'data-targeting': armed.abilityId })}>
      {relics.length === 0 ? null : (
        <div className="relics">
          {relics.map((view) => (
            <button
              key={view.ability.id}
              className="relic"
              title={`${view.ability.name}\n${view.text}\n\n(always on)`}
              data-ability={view.ability.id}
              data-usable={view.usable}
              disabled
            >
              <span className="ability-card-art" style={{ background: domainColor(view.card?.domain ?? 'granted') }}>
                <CardArtwork card={view.card ?? { id: view.ability.id, domain: 'granted' }} />
              </span>
            </button>
          ))}
        </div>
      )}

      {armed === null ? null : (
        <div className="play-box hand-armed">
          <span>
            {armed.name}: click {armed.spot === true ? 'a spot' : 'a target'} on the board
          </span>
          <button className="play-btn is-primary" data-testid="cancel-targeting" onClick={props.onCancelTargeting}>
            Cancel (Esc)
          </button>
        </div>
      )}

      <div className="hand-row">
        {props.light === null ? null : (
          <div className="hand-orb" title={`${props.name}'s Light`} data-testid="light-orb">
            <b>{props.light.value}</b>
            <small>/ {props.light.max}</small>
            <span>Light</span>
          </div>
        )}

        <div className="hand" style={{ '--n': String(count) }}>
          <span className={`hand-slot${gmTurn ? ' is-off' : ''}`} style={pose(0, count)} title="Click an adversary on the board to attack" data-testid="attack-chip">
            <span className="face hand-card" style={{ '--domain-color': domainColor('granted') }}>
              <span className="face-art ability-card-art">
                <CardArtwork card={{ id: `attack:${props.weapon}`, domain: 'granted' }} />
              </span>
              <span className="face-title">
                <h3>Attack</h3>
                <span>{props.weapon}</span>
              </span>
              <span className="face-rules">
                <p>Click an adversary on the board to swing with the {props.weapon}.</p>
              </span>
              <span className="face-footer">
                <span>{gmTurn ? "GM's turn" : 'weapon'}</span>
                <span>action</span>
              </span>
            </span>
          </span>
          {hand.map((view, i) => {
            const cost = view.ability.cost;
            return (
              <button
                key={view.ability.id}
                className={`hand-slot${view.usable ? '' : ' is-off'}${armed?.abilityId === view.ability.id ? ' is-picked' : ''}`}
                style={pose(i + 1, count)}
                disabled={!view.usable}
                title={`${view.text}${view.reason === null ? '' : `\n\n(${view.reason})`}`}
                data-ability={view.ability.id}
                data-usable={view.usable}
                onClick={() => props.onUse(view.ability.id)}
              >
                <span className="face hand-card" style={{ '--domain-color': domainColor(view.card?.domain ?? 'granted') }}>
                  <span className="face-art ability-card-art">
                    <CardArtwork card={view.card ?? { id: view.ability.id, domain: 'granted' }} />
                    {(cost.good ?? 0) > 0 ? <span className="hand-cost">{cost.good}</span> : null}
                    {(cost.stress ?? 0) > 0 ? <span className="hand-cost is-stress">{cost.stress}</span> : null}
                  </span>
                  <span className="face-title">
                    <h3>{view.ability.name}</h3>
                    <span>{view.ability.kind}</span>
                  </span>
                  <span className="face-rules">
                    <p>{view.text}</p>
                  </span>
                  <span className="face-footer">
                    <span>{view.reason ?? badges(view)}</span>
                    <span>{view.usesLeft === null ? '' : `${view.usesLeft} left`}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="hand-verbs">
          {props.fighting ? (
            <button
              className="play-btn is-primary is-turn"
              disabled={props.side !== 'party'}
              title="Hand the spotlight to the GM (Space)"
              data-testid="pass-to-gm"
              onClick={props.onPassToGm}
            >
              End Turn
            </button>
          ) : (
            <button className="play-btn is-turn" data-testid="open-rest" onClick={props.onRest}>
              Rest…
            </button>
          )}
          <button className="play-btn" data-testid="open-loadout" onClick={props.onLoadout}>
            Loadout…
          </button>
        </div>
      </div>
    </div>
  );
}
