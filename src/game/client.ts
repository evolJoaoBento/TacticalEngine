/**
 * The game as the page plays it: one seam between `main.ts` and the game (`docs/SERVER.md`, phase 3).
 *
 * Today the game runs in the page, a `DemoScene` the page could read and write anywhere; phase 3 moves it
 * behind a socket. Everything the page does to the game, and everything it reads of it, comes through
 * here, in four kinds:
 *
 * - **Intents** change the game - walk, attack, end the turn, use a card or a thing, answer, take, equip,
 *   recall, rest, take a level, travel, load, select. Over a socket each is a message and its answer.
 * - **Queries** ask without changing anything - the bar, the loadout, the gear, the HUD, the journal, what
 *   a container holds, whether a save may be made, and the questions the pointer asks on every move (the
 *   walk a click would make, the reach, the arc). Over a socket the second kind are answered in the page,
 *   by the engine built to WebAssembly, from the board.
 * - **The board** is what the renderer and those queries read: the room, its grid and state, the
 *   project, the scenario, the sheets, the fight, what is asked, the log and the dice. Read, never
 *   written: what the page changes it changes by an intent. Here it is the live game; over a socket it is
 *   the last view the server sent.
 * - **Local powers** are the page's alone: the test driver's hands on the game (`window.__engine` -
 *   wound somebody, fill their Light, stand them somewhere) and the editor changing the game it is
 *   playing (the ground grown under it, the party re-derived from an edited card). A socket does not
 *   offer them as they are; slice 3 settles which become privileged intents and which stay local.
 *
 * Every method here is the function the page called before, handed the game: nothing is decided in this
 * file, which is what lets the e2e suite say the seam changed nothing.
 */

import { deriveCharacter } from '../engine/character/sheet';
import type { SceneDoc } from '../engine/scene/schema';
import type { TileGrid } from '../engine/grid/grid';
import type { LogTone } from '../engine/script/schema';
import {
  answerPending,
  attackWithSelected,
  endTurn,
  gatherParty,
  moveSelectedTo,
  reachableInteractable,
  refreshWorld,
  setSheet,
  syncPools,
  syncRoster,
  useSelectedOn,
  type DemoScene,
} from './demo-scene';
import { inCombat, scriptPending } from './moment';
import { aimedArc, arrive, jumpAim, jumpOffered, jumpReaches, jumpTo, previewWalk, reachableTiles, startEncounter, underPressureTiles } from './movement';
import { approachThenUse, arrived, cancelApproach } from './arrival';
import { characterContentFor, syncAuthoredEncounters, takeGround, travelTo } from './room';
import { reachRings } from './circle';
import { nameOf, note } from './log';
import { applyLevelUp, awaitingLevel } from './level-up';
import { equipItem, gearOf, unequipItem } from './equip';
import { gearView } from './gear';
import { useItem } from './use-item';
import { inspection } from './inspect';
import { abilitiesOf, abilityList, abilityTargets, loadoutView, pointTiles, rest, shapeAt, swapCard, useAbility } from './demo-abilities';
import { loadGameText, saveBlockedBy, serialiseSave } from './save';
import { takeFromContainer, withinReach } from './prop-use';
import { syncTalks } from './talks';
import { hoverLine } from './hover';
import { steerStep } from './steer';
import { landWalkers } from './land';
import { dropCard, type Drop } from './party-drop';
import { carriedItems, containerView, hudMembers, journalEntries, talkingTo, talkingView } from './ui/play-views';

/** What the board is: the game's state as the page reads it, every frame. */
export type Board = Readonly<
  Pick<
    DemoScene,
    | 'scene'
    | 'grid'
    | 'state'
    | 'project'
    | 'scenario'
    | 'sheets'
    | 'characters'
    | 'pending'
    | 'encounter'
    | 'party'
    | 'world'
    | 'log'
    | 'rolls'
    | 'diceMillis'
    | 'ambush'
    | 'approaching'
  >
>;

/** A game function's arguments after the game itself. */
type After<F> = F extends (game: never, ...rest: infer A) => unknown ? A : never;
/** What a game function answers. */
type Answer<F> = F extends (...args: never[]) => infer R ? R : never;

/** The game as any page plays it - here, or over a socket. */
export interface GameClient {
  /** The game's state, to read. */
  readonly board: Board;

  // ---- intents ------------------------------------------------------------------------------------------
  moveSelectedTo(...args: After<typeof moveSelectedTo>): Answer<typeof moveSelectedTo>;
  attackWithSelected(...args: After<typeof attackWithSelected>): Answer<typeof attackWithSelected>;
  endTurn(): number;
  useAbility(...args: After<typeof useAbility>): Answer<typeof useAbility>;
  answerPending(...args: After<typeof answerPending>): Answer<typeof answerPending>;
  useSelectedOn(...args: After<typeof useSelectedOn>): Answer<typeof useSelectedOn>;
  approachThenUse(...args: After<typeof approachThenUse>): Answer<typeof approachThenUse>;
  /** The walk an interaction waited for has been drawn: do what it was for. */
  arrived(): boolean;
  cancelApproach(): boolean;
  /** The last token has stopped: the fight a walk woke begins. */
  arrive(): boolean;
  takeFromContainer(...args: After<typeof takeFromContainer>): boolean;
  equipItem(...args: After<typeof equipItem>): Answer<typeof equipItem>;
  unequipItem(...args: After<typeof unequipItem>): Answer<typeof unequipItem>;
  useItem(...args: After<typeof useItem>): Answer<typeof useItem>;
  swapCard(...args: After<typeof swapCard>): Answer<typeof swapCard>;
  rest(...args: After<typeof rest>): Answer<typeof rest>;
  applyLevelUp(...args: After<typeof applyLevelUp>): Answer<typeof applyLevelUp>;
  travelTo(...args: After<typeof travelTo>): boolean;
  loadGameText(...args: After<typeof loadGameText>): Answer<typeof loadGameText>;
  jumpTo(...args: After<typeof jumpTo>): Answer<typeof jumpTo>;
  startEncounter(...args: After<typeof startEncounter>): void;
  /** Put the conversations where the selection says. */
  syncTalks(): boolean;
  /** A line in the log, from the page: a save made, a card with nowhere to aim. */
  note(text: string, tone: LogTone): Answer<typeof note>;
  select(id: string): boolean;
  selectNext(): string | null;
  link(id: string, withId: string): boolean;
  unlink(id: string): boolean;
  /** A portrait dropped on another in the HUD: linked, or moved in the order. */
  dropCard(id: string, drop: Drop): boolean;
  /** A walk cut short: everyone still walking put down where they are drawn, and who was. */
  landWalkers(view: Parameters<typeof landWalkers>[1]): string[];
  /** How everybody got where they are since the page last looked, taken off the queue. */
  takeMotions(): DemoScene['motions'];
  /** The numbers to rise over heads since the page last looked, taken off the queue. */
  takeFloaters(): DemoScene['floaters'];
  /** The dice the page has finished showing. */
  rollShown(id: number): void;
  /** Every roll still to be shown, dropped. */
  clearRolls(): void;
  setDiceSpeed(millis: number): void;

  // ---- queries -----------------------------------------------------------------------------------------
  serialiseSave(): string | null;
  saveBlockedBy(): string | null;
  nameOf(id: string): string;
  inCombat(): boolean;
  scriptPending(): Answer<typeof scriptPending>;
  reachableInteractable(): string | null;
  containerView(...args: After<typeof containerView>): Answer<typeof containerView>;
  withinReach(...args: After<typeof withinReach>): boolean;
  abilitiesOf(...args: After<typeof abilitiesOf>): Answer<typeof abilitiesOf>;
  abilityList(...args: After<typeof abilityList>): Answer<typeof abilityList>;
  abilityTargets(...args: After<typeof abilityTargets>): string[];
  pointTiles(...args: After<typeof pointTiles>): number[];
  shapeAt(...args: After<typeof shapeAt>): string[];
  loadoutView(...args: After<typeof loadoutView>): Answer<typeof loadoutView>;
  gearView(...args: After<typeof gearView>): Answer<typeof gearView>;
  gearOf(...args: After<typeof gearOf>): Answer<typeof gearOf>;
  awaitingLevel(): string[];
  hudMembers(): Answer<typeof hudMembers>;
  journalEntries(): Answer<typeof journalEntries>;
  carriedItems(): Answer<typeof carriedItems>;
  talkingView(): Answer<typeof talkingView>;
  talkingTo(): Answer<typeof talkingTo>;
  inspection(...args: After<typeof inspection>): Answer<typeof inspection>;
  reachableTiles(...args: After<typeof reachableTiles>): Answer<typeof reachableTiles>;
  underPressureTiles(): number[];
  previewWalk(...args: After<typeof previewWalk>): Answer<typeof previewWalk>;
  hoverLine(...args: After<typeof hoverLine>): Answer<typeof hoverLine>;
  steerStep(...args: After<typeof steerStep>): Answer<typeof steerStep>;
  aimedArc(...args: After<typeof aimedArc>): Answer<typeof aimedArc>;
  reachRings(...args: After<typeof reachRings>): Answer<typeof reachRings>;
  jumpReaches(...args: After<typeof jumpReaches>): boolean;
  jumpOffered(): boolean;
  jumpAim(): Answer<typeof jumpAim>;
}

/** What only a page holding the game itself can do: the test driver's hands, and the editor's. */
export interface LocalPowers {
  /** Fold the project's edited sheets and cards back into the party (`main.ts`'s `rederiveParty`). */
  rederive(): void;
  /** The editor's ground taken into the game being played: whether the room is still the shape it was. */
  takeGround(...args: After<typeof takeGround>): boolean;
  syncAuthoredEncounters(): void;
  gatherParty(tile: number): void;
  /** Stand somebody on a tile, for a test. */
  placeAt(id: string, tile: number): void;
  /** Hand a character a set of domain cards, the loadout forgotten, for a test of the vault. */
  setCards(id: string, cards: string[]): void;
  setGood(id: string, value: number): void;
  wound(id: string, marks: number): void;
  markStress(id: string, marks: number): void;
  setCondition(id: string, condition: string, on: boolean): boolean;
  giveItem(id: string, quantity: number): void;
  grantLevel(level?: number): void;
}

/**
 * The game running in this page. Built over a `DemoScene` and seated at a table as the page plays it: the
 * defender asked how a hit lands, and the tokens walking, a fight a walk wakes starting when they arrive.
 */
export class LocalGame implements GameClient, LocalPowers {
  constructor(private readonly demo: DemoScene) {
    demo.askDefender = true;
    demo.animated = true;
  }

  get board(): Board {
    return this.demo;
  }

  moveSelectedTo(...args: After<typeof moveSelectedTo>) { return moveSelectedTo(this.demo, ...args); }
  attackWithSelected(...args: After<typeof attackWithSelected>) { return attackWithSelected(this.demo, ...args); }
  endTurn() { return endTurn(this.demo); }
  useAbility(...args: After<typeof useAbility>) { return useAbility(this.demo, ...args); }
  answerPending(...args: After<typeof answerPending>) { return answerPending(this.demo, ...args); }
  useSelectedOn(...args: After<typeof useSelectedOn>) { return useSelectedOn(this.demo, ...args); }
  approachThenUse(...args: After<typeof approachThenUse>) { return approachThenUse(this.demo, ...args); }
  arrived() { return arrived(this.demo); }
  cancelApproach() { return cancelApproach(this.demo); }
  arrive() { return arrive(this.demo); }
  takeFromContainer(...args: After<typeof takeFromContainer>) { return takeFromContainer(this.demo, ...args); }
  equipItem(...args: After<typeof equipItem>) { return equipItem(this.demo, ...args); }
  unequipItem(...args: After<typeof unequipItem>) { return unequipItem(this.demo, ...args); }
  useItem(...args: After<typeof useItem>) { return useItem(this.demo, ...args); }
  swapCard(...args: After<typeof swapCard>) { return swapCard(this.demo, ...args); }
  rest(...args: After<typeof rest>) { return rest(this.demo, ...args); }
  applyLevelUp(...args: After<typeof applyLevelUp>) { return applyLevelUp(this.demo, ...args); }
  travelTo(...args: After<typeof travelTo>) { return travelTo(this.demo, ...args); }
  loadGameText(...args: After<typeof loadGameText>) { return loadGameText(this.demo, ...args); }
  jumpTo(...args: After<typeof jumpTo>) { return jumpTo(this.demo, ...args); }
  startEncounter(...args: After<typeof startEncounter>): void { startEncounter(this.demo, ...args); }
  syncTalks() { return syncTalks(this.demo); }
  note(text: string, tone: LogTone) { return note(this.demo, text, tone); }
  select(id: string) { return this.demo.party.select(id); }
  selectNext() { return this.demo.party.selectNext(); }
  link(id: string, withId: string) { return this.demo.party.link(id, withId); }
  unlink(id: string) { return this.demo.party.unlink(id); }
  dropCard(id: string, drop: Drop) { return dropCard(this.demo.party, id, drop); }
  landWalkers(view: Parameters<typeof landWalkers>[1]) { return landWalkers(this.demo.party, view); }
  takeMotions() { return this.demo.motions.splice(0); }
  takeFloaters() { return this.demo.floaters.splice(0); }
  rollShown(id: number): void { this.demo.rolls = this.demo.rolls.filter((waiting) => waiting.id !== id); }
  clearRolls(): void { this.demo.rolls.length = 0; }
  setDiceSpeed(millis: number): void { this.demo.diceMillis = Math.max(0, millis); }

  serialiseSave() { return serialiseSave(this.demo); }
  saveBlockedBy() { return saveBlockedBy(this.demo); }
  nameOf(id: string) { return nameOf(this.demo, id); }
  inCombat() { return inCombat(this.demo); }
  scriptPending() { return scriptPending(this.demo); }
  reachableInteractable() { return reachableInteractable(this.demo); }
  containerView(...args: After<typeof containerView>) { return containerView(this.demo, ...args); }
  withinReach(...args: After<typeof withinReach>) { return withinReach(this.demo, ...args); }
  abilitiesOf(...args: After<typeof abilitiesOf>) { return abilitiesOf(this.demo, ...args); }
  abilityList(...args: After<typeof abilityList>) { return abilityList(this.demo, ...args); }
  abilityTargets(...args: After<typeof abilityTargets>) { return abilityTargets(this.demo, ...args); }
  pointTiles(...args: After<typeof pointTiles>) { return pointTiles(this.demo, ...args); }
  shapeAt(...args: After<typeof shapeAt>) { return shapeAt(this.demo, ...args); }
  loadoutView(...args: After<typeof loadoutView>) { return loadoutView(this.demo, ...args); }
  gearView(...args: After<typeof gearView>) { return gearView(this.demo, ...args); }
  gearOf(...args: After<typeof gearOf>) { return gearOf(this.demo, ...args); }
  awaitingLevel() { return awaitingLevel(this.demo); }
  hudMembers() { return hudMembers(this.demo); }
  journalEntries() { return journalEntries(this.demo); }
  carriedItems() { return carriedItems(this.demo); }
  talkingView() { return talkingView(this.demo); }
  talkingTo() { return talkingTo(this.demo); }
  inspection(...args: After<typeof inspection>) { return inspection(this.demo, ...args); }
  reachableTiles(...args: After<typeof reachableTiles>) { return reachableTiles(this.demo, ...args); }
  underPressureTiles() { return underPressureTiles(this.demo); }
  previewWalk(...args: After<typeof previewWalk>) { return previewWalk(this.demo, ...args); }
  hoverLine(...args: After<typeof hoverLine>) { return hoverLine(this.demo, ...args); }
  steerStep(...args: After<typeof steerStep>) { return steerStep(this.demo, ...args); }
  aimedArc(...args: After<typeof aimedArc>) { return aimedArc(this.demo, ...args); }
  reachRings(...args: After<typeof reachRings>) { return reachRings(this.demo, ...args); }
  jumpReaches(...args: After<typeof jumpReaches>) { return jumpReaches(this.demo, ...args); }
  jumpOffered() { return jumpOffered(this.demo); }
  jumpAim() { return jumpAim(this.demo); }

  rederive(): void {
    // Whoever the panel added since the last Play arrives now, and whoever it
    // removed leaves - before the world is rebuilt, so it is built over them.
    syncRoster(this.demo);
    // The document is the truth: an edit in the Party panel replaces the sheet
    // in `project.party`, so the game's copy is re-read rather than rederived
    // from what it happened to boot with.
    for (const sheet of this.demo.project.party) {
      if (this.demo.sheets.has(sheet.id)) this.demo.sheets.set(sheet.id, sheet);
    }
    for (const [id, sheet] of this.demo.sheets) {
      this.demo.characters.set(id, deriveCharacter(sheet, characterContentFor(this.demo.project), this.demo.project.abilities).character);
    }
    // The world first: `syncPools` reads the modifiers a card grants through it.
    refreshWorld(this.demo);
    syncPools(this.demo);
  }
  takeGround(scene: SceneDoc, old: TileGrid, grid: TileGrid) { return takeGround(this.demo, scene, old, grid); }
  syncAuthoredEncounters(): void { syncAuthoredEncounters(this.demo); }
  gatherParty(tile: number): void { gatherParty(this.demo, tile); }
  placeAt(id: string, tile: number): void { this.demo.state.moveEntity(id, tile); }
  setCards(id: string, cards: string[]): void {
    const sheet = this.demo.sheets.get(id);
    if (sheet === undefined) return;
    const grown = { ...sheet, domainCards: cards };
    delete (grown as { loadout?: readonly string[] }).loadout;
    setSheet(this.demo, grown);
    refreshWorld(this.demo);
  }
  setGood(id: string, value: number): void {
    const entity = this.demo.state.entity(id);
    if (entity?.good === undefined) return;
    entity.good = { max: entity.good.max, value: Math.max(0, Math.min(entity.good.max, value)) };
  }
  wound(id: string, marks: number): void {
    const entity = this.demo.state.entity(id);
    if (entity !== undefined) entity.hitPoints.marked = Math.min(entity.hitPoints.max, Math.max(0, marks));
  }
  markStress(id: string, marks: number): void {
    const entity = this.demo.state.entity(id);
    if (entity !== undefined) entity.stress = { ...entity.stress, marked: Math.min(entity.stress.max, Math.max(0, marks)) };
  }
  setCondition(id: string, condition: string, on: boolean): boolean {
    return on ? this.demo.world.applyCondition(id, condition, 'scene') : this.demo.world.clearCondition(id, condition);
  }
  giveItem(id: string, quantity: number): void { this.demo.world.addItem(id, quantity); }
  grantLevel(level?: number): void { this.demo.world.grantLevel(level); }
}
