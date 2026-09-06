/**
 * The party, at a glance: who is selected, and how everyone is holding up.
 *
 * Daggerheart tracks damage as slots marked, not points lost, so the HUD shows
 * pips — each Hit Point, Stress and Armor Slot as a box, filled when marked.
 * That is what the character sheet looks like, and it is what a player counts
 * when deciding whether to take the hit or spend the armor.
 */

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
  hope?: { value: number; max: number };
  conditions: readonly string[];
  /** A level-up is waiting for this character. */
  canLevel: boolean;
  /** "Broadsword · Chainmail". */
  gear: string;
}

export interface PartyHudProps {
  members: readonly HudMember[];
  /** The GM's Fear, shown so a player knows what the table is up against. */
  fear: { value: number; max: number };
  round: number | null;
  onSelect: (id: string) => void;
  onLevelUp: (id: string) => void;
}

const wrap: Record<string, string | number> = {
  position: 'absolute',
  left: 0,
  bottom: 0,
  display: 'flex',
  gap: '8px',
  padding: '12px',
  color: '#e8e6df',
  font: '12px/1.4 system-ui, sans-serif',
  pointerEvents: 'auto',
};

function card(selected: boolean, alive: boolean): Record<string, string | number> {
  return {
    minWidth: '150px',
    padding: '8px 10px',
    background: 'rgba(16,18,24,0.9)',
    border: `1px solid ${selected ? '#69d2ff' : '#39404d'}`,
    borderRadius: '6px',
    opacity: alive ? 1 : 0.45,
    cursor: 'pointer',
  };
}

const rowStyle: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  marginTop: '2px',
};

/** Boxes: `marked` of `max` filled. */
function Pips(props: { label: string; marked: number; max: number; colour: string; testId: string }) {
  const boxes = [];
  for (let i = 0; i < props.max; i++) {
    const filled = i < props.marked;
    boxes.push(
      <span
        key={i}
        style={{
          width: '9px',
          height: '9px',
          border: `1px solid ${props.colour}`,
          background: filled ? props.colour : 'transparent',
          borderRadius: '2px',
        }}
      />,
    );
  }
  return (
    <div style={rowStyle} data-testid={props.testId} data-marked={props.marked} data-max={props.max}>
      <span style={{ color: '#8ea3b0', width: '28px', fontSize: '10px' }}>{props.label}</span>
      {boxes}
    </div>
  );
}

export function PartyHud(props: PartyHudProps): preact.JSX.Element | null {
  if (props.members.length === 0) return null;
  return (
    <div style={wrap} data-testid="hud">
      {props.members.map((member) => (
        <div
          key={member.id}
          style={card(member.selected, member.alive)}
          data-member={member.id}
          data-selected={member.selected}
          onClick={() => props.onSelect(member.id)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{member.name}</strong>
            <span style={{ color: '#8ea3b0', fontSize: '10px' }}>{member.role}</span>
          </div>
          {member.canLevel ? (
            <button
              style={{
                display: 'block',
                width: '100%',
                margin: '2px 0 4px',
                padding: '2px 6px',
                border: '1px solid #ffe08a',
                borderRadius: '4px',
                background: 'rgba(255,224,138,0.15)',
                color: '#ffe08a',
                font: 'inherit',
                cursor: 'pointer',
              }}
              data-testid="level-up-button"
              onClick={(e) => {
                e.stopPropagation();
                props.onLevelUp(member.id);
              }}
            >
              Level up
            </button>
          ) : null}
          <Pips label="HP" marked={member.hitPoints.marked} max={member.hitPoints.max} colour="#ff7a7a" testId="hp" />
          <Pips label="Stress" marked={member.stress.marked} max={member.stress.max} colour="#c8a2ff" testId="stress" />
          <Pips label="Armor" marked={member.armorSlots.marked} max={member.armorSlots.max} colour="#9ab5c8" testId="armor" />
          {member.hope !== undefined ? (
            <Pips label="Hope" marked={member.hope.value} max={member.hope.max} colour="#7fd1ff" testId="hope" />
          ) : null}
          <div style={{ color: '#8ea3b0', fontSize: '10px' }} data-testid="gear">
            {member.gear}
          </div>
          {member.conditions.length > 0 ? (
            <div style={{ color: '#ffc861', fontSize: '10px', marginTop: '2px' }}>{member.conditions.join(' · ')}</div>
          ) : null}
        </div>
      ))}
      <div style={{ ...card(false, true), minWidth: '90px', cursor: 'default' }} data-testid="gm">
        <div style={{ color: '#8ea3b0', fontSize: '10px' }}>{props.round === null ? 'Exploring' : `Round ${props.round}`}</div>
        <Pips label="Fear" marked={props.fear.value} max={props.fear.max} colour="#ff9d7a" testId="fear" />
      </div>
    </div>
  );
}
