/**
 * The party, at a glance: who is selected, and how everyone is holding up.
 *
 * Damage is tracked as slots marked, not points lost, so the HUD shows
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
    minWidth: '156px',
    padding: '9px 11px',
    // The selected card is lit from within as well as edged, so it reads as
    // chosen from across the room and not only when the border is looked for.
    background: selected ? 'rgba(24,40,52,0.92)' : 'rgba(16,18,24,0.9)',
    border: `1px solid ${selected ? '#69d2ff' : '#39404d'}`,
    borderRadius: '8px',
    boxShadow: selected ? '0 0 0 1px rgba(105,210,255,0.25), 0 6px 18px rgba(0,0,0,0.5)' : '0 6px 18px rgba(0,0,0,0.45)',
    backdropFilter: 'blur(6px)',
    opacity: alive ? 1 : 0.45,
    cursor: 'pointer',
    transition: 'background 120ms, border-color 120ms',
  };
}

const rowStyle: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'center',
  gap: '3px',
  marginTop: '3px',
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
          width: '10px',
          height: '10px',
          border: `1px solid ${props.colour}`,
          background: filled ? props.colour : 'transparent',
          borderRadius: '2px',
          boxSizing: 'border-box',
          boxShadow: filled ? `0 0 4px ${props.colour}66` : 'none',
        }}
      />,
    );
  }
  return (
    <div style={rowStyle} data-testid={props.testId} data-marked={props.marked} data-max={props.max}>
      <span style={{ color: '#8ea3b0', width: '30px', fontSize: '10px', letterSpacing: '0.02em' }}>{props.label}</span>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
            <strong style={{ fontSize: '13px' }}>{member.name}</strong>
            <span style={{ color: '#8ea3b0', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{member.role}</span>
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
          {member.good !== undefined ? (
            <Pips label="Light" marked={member.good.value} max={member.good.max} colour="#7fd1ff" testId="good" />
          ) : null}
          <div style={{ color: '#8ea3b0', fontSize: '10px', marginTop: '4px' }} data-testid="gear">
            {member.gear}
          </div>
          {member.conditions.length > 0 ? (
            <div style={{ color: '#ffc861', fontSize: '10px', marginTop: '2px' }}>{member.conditions.join(' · ')}</div>
          ) : null}
        </div>
      ))}
      <div style={{ ...card(false, true), minWidth: '90px', cursor: 'default' }} data-testid="gm">
        <div style={{ color: '#8ea3b0', fontSize: '10px' }}>{props.round === null ? 'Exploring' : `Round ${props.round}`}</div>
        <Pips label="Shadow" marked={props.bad.value} max={props.bad.max} colour="#ff9d7a" testId="bad" />
      </div>
    </div>
  );
}
