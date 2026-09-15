/**
 * The party, at a glance: who is selected, and how everyone is holding up.
 *
 * Damage is tracked as slots marked, not points lost, so the HUD shows
 * pips — each Hit Point, Stress and Armor Slot as a bar, lit when marked.
 * That is what the character sheet looks like, and it is what a player counts
 * when deciding whether to take the hit or spend the armor. The look is the
 * deck browser's (`hud.css`): gold for the one selected, Georgia for names.
 */

import './hud.css';

export interface HudMember {
  id: string;
  name: string;
  /** Class name, for the line under the name. */
  role: string;
  selected: boolean;
  alive: boolean;
  hitPoints: { marked: number; max: number };
  stress: { marked: number; max: number };
  armorSlots: { marked: number; max: number };
  good?: { value: number; max: number };
  conditions: readonly string[];
  /** A level-up is waiting for this character. */
  canLevel: boolean;
  /** "Broadsword · Chainmail". */
  gear: string;
}

export interface PartyHudProps {
  members: readonly HudMember[];
  /** The GM's Shadow, shown so a player knows what the table is up against. */
  bad: { value: number; max: number };
  round: number | null;
  onSelect: (id: string) => void;
  onLevelUp: (id: string) => void;
}

/** Bars: `marked` of `max` lit, in the colour the sheet and the dice give that pool. */
function Pips(props: { label: string; marked: number; max: number; colour: string; testId: string }) {
  const bars = [];
  for (let i = 0; i < props.max; i++) {
    bars.push(<span key={i} className={i < props.marked ? 'pip is-marked' : 'pip'} style={{ '--pip': props.colour }} />);
  }
  return (
    <div className="hud-pips" data-testid={props.testId} data-marked={props.marked} data-max={props.max}>
      <span>{props.label}</span>
      {bars}
    </div>
  );
}

export function PartyHud(props: PartyHudProps): preact.JSX.Element | null {
  if (props.members.length === 0) return null;
  return (
    <div className="play hud" data-testid="hud">
      {props.members.map((member) => (
        <div
          key={member.id}
          className={`play-box hud-card${member.selected ? ' is-selected' : ''}${member.alive ? '' : ' is-down'}`}
          data-member={member.id}
          data-selected={member.selected}
          onClick={() => props.onSelect(member.id)}
        >
          <div className="hud-head">
            <span className="play-name">{member.name}</span>
            <span className="play-eyebrow">{member.role}</span>
          </div>
          {member.canLevel ? (
            <button
              className="play-btn is-primary hud-level"
              data-testid="level-up-button"
              onClick={(e) => {
                e.stopPropagation();
                props.onLevelUp(member.id);
              }}
            >
              Level up
            </button>
          ) : null}
          <Pips label="HP" marked={member.hitPoints.marked} max={member.hitPoints.max} colour="var(--play-hp)" testId="hp" />
          <Pips label="Stress" marked={member.stress.marked} max={member.stress.max} colour="var(--play-stress)" testId="stress" />
          <Pips label="Armor" marked={member.armorSlots.marked} max={member.armorSlots.max} colour="var(--play-armor)" testId="armor" />
          {member.good !== undefined ? (
            <Pips label="Light" marked={member.good.value} max={member.good.max} colour="var(--play-light)" testId="good" />
          ) : null}
          <div className="hud-gear" data-testid="gear">
            {member.gear}
          </div>
          {member.conditions.length > 0 ? <div className="hud-conditions">{member.conditions.join(' · ')}</div> : null}
        </div>
      ))}
      <div className="play-box hud-card hud-gm" data-testid="gm">
        <span className="play-eyebrow">{props.round === null ? 'Exploring' : `Round ${props.round}`}</span>
        <Pips label="Shadow" marked={props.bad.value} max={props.bad.max} colour="var(--play-shadow)" testId="bad" />
      </div>
    </div>
  );
}
