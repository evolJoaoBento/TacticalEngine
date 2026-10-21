/**
 * A character sheet, as a piece of paper: who they are and how they are holding up, their photograph,
 * the block of numbers a sheet is mostly made of, and their gear.
 *
 * The loadout's left leaf is this (`LoadoutPanel.tsx`), and so is New Game's last step, where the
 * character is named (`NewGame.tsx`): the sheet made at the table is the sheet carried in the game.
 * What differs is handed in - the name (text, or the field it is written in), the line over it, and
 * whatever the page adds at its foot (`children`).
 */

import type { ComponentChildren } from 'preact';
import type { SheetStats } from '../demo-abilities';
import { Pips, type HudMember } from './PartyHud';
import { artNoteHandlers } from './AiNote';
import './cards.css';
// The sheet draws the same pools the party sheets do, in the same ink.
import './hud.css';

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);
/** A threshold they do not have is `Infinity`, which is not a number anybody writes on a sheet. */
const threshold = (value: number): string => (Number.isFinite(value) ? `${value}` : '—');

/**
 * The block of numbers a paper sheet is mostly made of: what it takes to hit them, how hard a blow
 * must be to cost more than one Hit Point, and what they add to a roll.
 *
 * The thresholds are laid out the way the printed sheet does it -- the three bands in a line with
 * the two numbers between them -- because that is the shape a player reads damage against: find
 * where the number falls, read off how many Hit Points to mark.
 */
export function SheetNumbers({ stats }: { stats: SheetStats }) {
  return <div className="sheet-stats" data-testid="sheet-stats">
    <div className="sheet-defence">
      <div className="sheet-shield" data-testid="sheet-evasion"><b>{stats.evasion}</b><span>Evasion</span></div>
      <div className="sheet-shield" data-testid="sheet-proficiency"><b>{stats.proficiency}</b><span>Proficiency</span></div>
      <div className="sheet-bands" data-testid="sheet-thresholds" aria-label={`Damage thresholds: Major ${threshold(stats.thresholds.major)}, Severe ${threshold(stats.thresholds.severe)}`}>
        <span>Minor<small>mark 1 HP</small></span>
        <b>{threshold(stats.thresholds.major)}</b>
        <span>Major<small>mark 2 HP</small></span>
        <b>{threshold(stats.thresholds.severe)}</b>
        <span>Severe<small>mark 3 HP</small></span>
      </div>
    </div>
    <div className="sheet-traits">
      {stats.traits.map(trait => <div key={trait.id} className={`sheet-trait${trait.spellcast ? ' is-spellcast' : ''}`} data-testid={`sheet-trait-${trait.id}`}>
        <b>{signed(trait.value)}</b><span>{trait.id}</span>{trait.spellcast ? <small>Spellcast</small> : null}
      </div>)}
    </div>
    {stats.experiences.length === 0 ? null : <div className="sheet-experiences">
      <h3>Experiences</h3>
      {stats.experiences.map(experience => <p key={experience.name}><span>{experience.name}</span><b>{signed(experience.modifier)}</b></p>)}
    </div>}
  </div>;
}

/** The sheet: its name, the line over it, its pools, photograph, numbers and gear, and what the page adds. */
export function SheetPaper(props: {
  name: ComponentChildren;
  eyebrow: string;
  /** Who this is, for the pools and the gear line. */
  sheet?: HudMember;
  /** The photograph taped to the sheet, as a data URL. */
  portrait?: string | null;
  stats?: SheetStats;
  children?: ComponentChildren;
}): preact.JSX.Element {
  return (
    <div className="sheet-paper">
      {/* The head of the sheet: who they are and how they are holding up on the left, their
          photograph on the right. A row of its own, because a float does nothing inside a
          flex column -- which is how the photo first ended up stranded above the name. */}
      <div className="sheet-top">
        <div className="sheet-id">
          <div className="deck-eyebrow">{props.eyebrow}</div>
          <h2 className="sheet-name">{props.name}</h2>
          {props.sheet === undefined ? null : <>
            <Pips label="HP" marked={props.sheet.hitPoints.marked} max={props.sheet.hitPoints.max} colour="var(--play-hp)" icon="heart" left testId="sheet-hp" />
            <Pips label="Stress" marked={props.sheet.stress.marked} max={props.sheet.stress.max} colour="var(--play-stress)" icon="bolt" left testId="sheet-stress" />
            <Pips label="Armor" marked={props.sheet.armorSlots.marked} max={props.sheet.armorSlots.max} colour="var(--play-armor)" icon="shield" left testId="sheet-armor" />
            {props.sheet.good === undefined ? null
              : <Pips label="Light" marked={props.sheet.good.value} max={props.sheet.good.max} colour="var(--play-light)" icon="star" testId="sheet-light" />}
          </>}
        </div>
        {props.portrait === null || props.portrait === undefined ? null : (
          <span className="hud-shot sheet-shot" data-testid="sheet-portrait" {...artNoteHandlers(props.sheet?.model === undefined ? null : `model:${props.sheet.model}`)}>
            <img src={props.portrait} alt="" aria-hidden="true" />
          </span>
        )}
      </div>
      {props.stats === undefined ? null : <SheetNumbers stats={props.stats} />}
      {props.sheet === undefined ? null : <>
        <p className="sheet-line"><span>Gear</span><b>{props.sheet.gear}</b></p>
        {props.sheet.conditions.length > 0 ? <p className="sheet-line"><span>Conditions</span><b>{props.sheet.conditions.join(' · ')}</b></p> : null}
      </>}
      {props.children}
    </div>
  );
}
