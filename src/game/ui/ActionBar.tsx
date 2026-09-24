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

import type { Response } from '../../engine/script/runner';
import { Conversation, type TalkingView } from './Conversation';
import { useState } from 'preact/hooks';
import type { AbilityView } from '../demo-abilities';
import { CardArtwork } from './CardFace';
import { Die, type DieColours } from './Die';
import { D6_FACES } from './d6';
import type { Face } from './d12';
import { domainColor } from './card-sigil';
import './cards.css';
import './hud.css';

export interface ActionBarProps {
  /** The selected character, or null when nobody is. */
  characterId: string | null;
  name: string;
  weapon: string;
  abilities: readonly AbilityView[];
  /** What the selected character has to spend, for the yellow die. */
  light: { value: number; max: number } | null;
  /** The GM's Shadow, on the black die beside it: what the table is up against, where the table can see it. */
  bad: { value: number; max: number };
  /** The round in a fight, or null out of one, said under the dice. */
  round: number | null;
  /** Whether a fight is on, and whose turn it is. */
  fighting: boolean;
  side: 'party' | 'gm' | null;
  /** The ability waiting for a target, if any. `spot` when it wants ground rather than a creature. */
  targeting: { abilityId: string; name: string; spot?: boolean } | null;
  /** Whether the selected character is offered a jump: somebody who can act, in a project that has jumping. */
  jump?: boolean;
  /**
   * The conversation being had, if one is: it takes the cards' place along the bottom, and the
   * Jump and Rest keys and the cards step aside for it. The Light, the Shadow and the Loadout stay.
   */
  talking?: TalkingView | null;
  onAnswer?: (response: Response) => void;
  onUse: (abilityId: string) => void;
  onCancelTargeting: () => void;
  onPassToGm: () => void;
  onLoadout: () => void;
  onRest: () => void;
}

/** What the jump button arms the bar with. The game's `JUMP_ID`, said again here so the bar asks nothing of the game. */
const JUMP_ID = 'jump:button';

/**
 * The jump, as a key beside the Light - the Rest key's twin, off the same keyboard: a figure
 * on the cap that gathers itself when the pointer comes near, and leaps - again and again -
 * while the board is waiting to be told where. Armed, the key stays down, the way a key held
 * does; a second press lets it up, as Escape does.
 */
function JumpButton(props: { armed: boolean; off: boolean; onJump: () => void }): preact.JSX.Element {
  return (
    <button
      type="button"
      className={`key-btn jump-key${props.armed ? ' is-armed' : ''}`}
      data-testid="jump-button"
      aria-label="Jump"
      aria-pressed={props.armed}
      disabled={props.off}
      title={props.armed ? 'Click a spot to jump there - or here again to stay put (Esc)' : 'Jump: aim an arc from where you stand'}
      onClick={props.onJump}
    >
      <span className="key-cap">
        <span className="key-top">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {/* Where they leave and the higher place they land, and whoever is in the air between. */}
            <path className="jump-ledge" d="M1.5 20.5h7.5v3h-7.5zM15 17.5h7.5v6H15z" />
            <g className="jump-figure">
              <circle cx="16.2" cy="3.9" r="2.2" />
              <path d="M14.4 7.4L10.4 12M14 8l4 1.8 2.4-1.6M14 8l-4.4-.8-1.8 1.9M10.4 12l4.3 1.1.6 3.3M10.4 12l-3.4 2-2.9-.9" />
            </g>
          </svg>
          <span className="key-legend">Jump</span>
        </span>
      </span>
    </button>
  );
}

/** The Rest key: one key off a mechanical keyboard, with a campfire on the cap. */
function RestKey(props: { onRest: () => void }): preact.JSX.Element {
  return (
    <button type="button" className="key-btn" data-testid="open-rest" title="Rest" aria-label="Rest" onClick={props.onRest}>
      <span className="key-cap">
        <span className="key-top">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.4c.7 2.7 3.8 4.4 3.8 7.8a3.8 3.8 0 0 1-7.6 0c0-1.6.8-2.6 1.5-3.4.3 1.1.8 1.6 1.5 1.8-.4-2 .1-4.2.8-6.2Z" />
            <path className="key-logs" d="M4.4 16.6l15.2 4.2M19.6 16.6L4.4 20.8" />
          </svg>
          <span className="key-legend">Rest</span>
        </span>
      </span>
    </button>
  );
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
 * it is. Both the spread and the drop are held to what a hand can be - about twelve degrees and ten
 * pixels end to end - so a hand of eight neither swings out past the fan nor hangs off the screen.
 */
const FAN_DEGREES = 12;
const FAN_DROP = 10;

function pose(index: number, count: number): Record<string, string> {
  const ends = (count - 1) / 2;
  const off = index - ends;
  const step = count > 1 ? Math.min(4, FAN_DEGREES / (count - 1)) : 0;
  const drop = ends > 0 ? Math.min(2.4, FAN_DROP / (ends * ends)) : 0;
  return { '--tilt': `${(off * step).toFixed(1)}deg`, '--drop': `${(off * off * drop).toFixed(1)}px` };
}

/** Whether a card is one that is simply true while it is held, rather than one that is played. */
function always(view: AbilityView): boolean {
  return view.ability.kind === 'passive';
}

/** The two pools, as the dice they are counted in: the Light a yellow six, the Shadow a black twelve. */
const LIGHT_POOL: DieColours = { lit: '#ffe9a4', mid: '#e8c14a', dark: '#a8842a', glow: '#ffdb8a' };
const SHADOW_POOL: DieColours = { lit: '#4a4550', mid: '#2b2732', dark: '#120f18', glow: '#6b6478' };

/** How wide a pool die is drawn, against the keys beside it. */
const POOL_SIZE = 72;

/**
 * A pool as a die at rest: the count on the face at the front, the most it holds written under it.
 *
 * Landed rather than thrown (`t` of 1), because this counts rather than rolls - but it is the same
 * solid the Duality Dice are turned from, so the two read as the same kind of object. Nothing says
 * which pool it is: the shape and the colour do, and hovering names it.
 */
function PoolDie(props: {
  pool: { value: number; max: number };
  title: string;
  testId: string;
  tone: string;
  colours: DieColours;
  seed: number;
  faces?: readonly Face[];
}): preact.JSX.Element {
  return (
    <span className={`pool-slot ${props.tone}`} title={props.title} data-testid={props.testId} data-value={props.pool.value}>
      {/* No die carries a nought, so an empty pool turns to its lowest face and overprints it. */}
      <Die value={Math.max(1, props.pool.value)} label={String(props.pool.value)} seed={props.seed} t={1} colours={props.colours} size={POOL_SIZE} {...(props.faces === undefined ? {} : { faces: props.faces })} />
      <small>max. {props.pool.max}</small>
    </span>
  );
}

/** How long the cover takes to swing right back: the length of `binder-open` in `cards.css`. */
const BOOK_OPENS_MS = 460;

/**
 * The way into the loadout: the binder itself, shut, lying by the hand.
 *
 * A black book with its name on the cover. Pointing at it lifts the cover a little, the way a thumb
 * does before opening one; clicking swings it right back. The binder over the table opens in the
 * same moment, on the same curve and for the same length of time, so the two are one movement --
 * the small book and the big one are the same book. Nothing waits on anything: the click opens the
 * loadout at once, and the swing here is only what is seen of it from the hand.
 */
function LoadoutBook(props: { onOpen: () => void }) {
  const [opening, setOpening] = useState(false);
  const open = (): void => {
    props.onOpen();
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || opening) return;
    setOpening(true);
    // The binder's backdrop is over it by the end of the swing; it is shut again for when that lifts.
    setTimeout(() => setOpening(false), BOOK_OPENS_MS + 700);
  };
  return (
    <button type="button" className={`book-btn${opening ? ' is-opening' : ''}`} data-testid="open-loadout" title="Open the loadout" onClick={open}>
      <span className="book-leaves" aria-hidden="true" />
      <span className="book-cover"><span className="book-title">Loadout</span></span>
    </button>
  );
}

export function ActionBar(props: ActionBarProps): preact.JSX.Element | null {
  if (props.characterId === null) return null;
  const gmTurn = props.fighting && props.side === 'gm';
  const armed = props.targeting;
  const relics = props.abilities.filter((view) => view.ability.kind === 'passive');
  // Every card the loadout shows is in the hand: the ones that are played, and the ones that are
  // simply true while they are held. A card that is always in play is not a button - there is
  // nothing to press - but it is one of the cards you are holding, so it is dealt with the rest.
  const hand = props.abilities.filter((view) => view.card !== null);
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
          <div className="hand-dice">
            <PoolDie pool={props.light} title={`${props.name}'s Light`} testId="light-orb" tone="is-light" faces={D6_FACES} colours={LIGHT_POOL} seed={1} />
            <PoolDie pool={props.bad} title="The GM's Shadow" testId="shadow-die" tone="is-shadow" colours={SHADOW_POOL} seed={2} />
            <em className="pool-round">{props.round === null ? 'Exploring' : `Round ${props.round}`}</em>
          </div>
        )}
        {props.talking !== undefined && props.talking !== null ? (
          <Conversation view={props.talking} onAnswer={(response) => props.onAnswer?.(response)} />
        ) : (<>
        {/* The keys, side by side next to the Light: what the body does, as the hand is what the cards do. */}
        <div className="hand-keys">
          {props.jump === true ? <JumpButton armed={armed?.abilityId === JUMP_ID} off={gmTurn} onJump={() => (armed?.abilityId === JUMP_ID ? props.onCancelTargeting() : props.onUse(JUMP_ID))} /> : null}
          {props.fighting ? null : <RestKey onRest={props.onRest} />}
        </div>

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
                className={`hand-slot${always(view) ? ' is-always' : view.usable ? '' : ' is-off'}${armed?.abilityId === view.ability.id ? ' is-picked' : ''}`}
                style={pose(i + 1, count)}
                disabled={!view.usable}
                aria-disabled={always(view)}
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
                    <span>{always(view) ? 'always in play' : (view.reason ?? badges(view))}</span>
                    <span>{view.usesLeft === null ? '' : `${view.usesLeft} left`}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        </>)}

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
          ) : null}
          {/* The two things done between fights, side by side: open the binder, and make camp. The
              book is nearer the hand, since its cards are what it holds; in a fight there is no
              resting, so the key is not there and the book has the row. */}
          <div className="hand-tools">
            <LoadoutBook onOpen={props.onLoadout} />
          </div>
        </div>
      </div>
    </div>
  );
}
