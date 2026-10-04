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
 * file, which is what lets the e2e suite say the seam changed nothing. Where the page is served for
 * development, the questions the pointer asks are also put to a replica of the game in the engine built to
 * WebAssembly, and where the two part is counted (`shadow.ts`); the game's answer is the one given.
 */

import { deriveCharacter } from '../engine/character/sheet';
import type { SceneDoc } from '../engine/scene/schema';
import type { TileGrid } from '../engine/grid/grid';
import type { LogTone } from '../engine/script/schema';
import type { Spot } from '../engine/grid/grid';
import type { LevelUpPlan } from '../engine/character/progression';
import type { Response } from '../engine/script/runner';
import { gatherParty, reachableInteractable, refreshWorld, setSheet, syncPools, syncRoster, type DemoScene, type UseOutcome } from './demo-scene';
import { inCombat, scriptPending } from './moment';
import { aimedArc, jumpAim, jumpOffered, jumpReaches, previewWalk, reachableTiles, underPressureTiles, type MoveResult } from './movement';
import { characterContentFor, syncAuthoredEncounters, takeGround } from './room';
import { reachRings } from './circle';
import { nameOf, type LogLine } from './log';
import { awaitingLevel, type LevelUpResult } from './level-up';
import { gearOf, type EquipResult, type GearSlot } from './equip';
import { gearView } from './gear';
import { inspection } from './inspect';
import { abilitiesOf, abilityList, abilityTargets, loadoutView, pointTiles, shapeAt, type RestPlan, type RestResult, type SwapResult } from './demo-abilities';
import { saveBlockedBy, serialiseSave, type LoadResult } from './save';
import { openContainer, withinReach } from './prop-use';
import { hoverLine } from './hover';
import { steerStep } from './steer';
import type { Walking } from './land';
import type { Drop } from './party-drop';
import { carriedItems, containerView, hudMembers, journalEntries, talkingTo, talkingView } from './ui/play-views';
import type { OpenContainer } from './ui/PlayPanel';
import type { Wire } from './wire';
import type { WasmEngine } from './wasm-engine';

import { userSettings } from './user-settings';

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
/** An intent's arguments, as the game is asked it: the engine's dispatcher (`dispatch.rs`) reads them so. */
type Args<K extends keyof GameClient> = GameClient[K] extends (...args: infer A) => unknown ? A : never;

/** What a swing at somebody comes to: hit or not, why it was refused, the Hit Points it marked, or a question asked. */
export type SwingResult = { hit: boolean; refused: string | null; hitPointsMarked: number; waiting?: boolean } | null;

/** The game as any page plays it - here, or over a socket. */
export interface GameClient {
  /** The game's state, to read. */
  readonly board: Board;

  // ---- intents ------------------------------------------------------------------------------------------
  moveSelectedTo(destination: number, aimed?: Spot): MoveResult;
  attackWithSelected(targetId: string): SwingResult;
  endTurn(): number;
  /** A card used: by whom, which, at whom - and, aimed at the ground, the tile it was aimed at. */
  useAbility(characterId: string, abilityId: string, targets?: readonly string[], options?: { point?: number }): UseOutcome;
  answerPending(response: Response): UseOutcome;
  useSelectedOn(interactableId: string): UseOutcome;
  /** Walk up to a thing and use it once there - the walk drawn first, when it is drawn - or use it now. */
  approachThenUse(id: string): string;
  /** The walk an interaction waited for has been drawn: do what it was for. */
  arrived(): boolean;
  cancelApproach(): boolean;
  /** The last token has stopped: the fight a walk woke begins. */
  arrive(): boolean;
  takeFromContainer(id: string, item: string): boolean;
  equipItem(characterId: string, itemId: string): EquipResult;
  unequipItem(characterId: string, slot: GearSlot): EquipResult;
  useItem(itemId: string): UseOutcome;
  /** A card into the loadout from the vault, another out - a cost in Stress, unless resting. */
  swapCard(characterId: string, cardIn: string, cardOut?: string, options?: { resting?: boolean }): SwapResult;
  rest(kind: 'short' | 'long', plan: RestPlan): RestResult;
  applyLevelUp(characterId: string, plan: LevelUpPlan): LevelUpResult;
  travelTo(sceneId: string): boolean;
  /** A save loaded from its text - and its slot, which the server's game loads its own copy of (`wire.ts`). */
  loadGameText(text: string, slot?: string): LoadResult;
  jumpTo(id: string, destination: number, aim?: Spot): MoveResult;
  startEncounter(encounterId: string): void;
  /** Put the conversations where the selection says. */
  syncTalks(): boolean;
  /** A line in the log, from the page: a save made, a card with nowhere to aim. */
  note(text: string, tone: LogTone): LogLine[];
  select(id: string): boolean;
  selectNext(): string | null;
  link(id: string, withId: string): boolean;
  unlink(id: string): boolean;
  /** A portrait dropped on another in the HUD: linked, or moved in the order. */
  dropCard(id: string, drop: Drop): boolean;
  /** The container's window shut. */
  closeContainer(): void;
  /** One of something sold to a seller. */
  sellTo(id: string, item: string): boolean;
  /** A walk cut short: everyone still walking put down where they are drawn, and who was. */
  landWalkers(view: Walking): string[];
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
  /**
   * Whether the game was changed behind the page's back since it last asked - stood where the server's board
   * says, not by an intent the page gave - so the page draws it again. Asking clears it.
   */
  changedBehind(): boolean;
  nameOf(id: string): string;
  inCombat(): boolean;
  scriptPending(): Answer<typeof scriptPending>;
  reachableInteractable(): string | null;
  /** The container window, when one is open and in reach (`reach`), its acts redrawing the page (`refresh`). */
  containerView(reach: (id: string) => boolean, refresh: () => void): OpenContainer | null;
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
  /** A thing's state: used, open, removed. Reading it makes it, as the game keeps things. */
  thingState(id: string): { used: boolean; open: boolean; removed: boolean };
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
  /**
   * The editor opened: the dice still to be shown dropped, and the server's game let go - the editor's playtest
   * is the page's alone (`wire.ts`).
   */
  toTheEditor(): void;
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
 * The table every game the page plays is played at: the board, every intent by its name, the queries - the views
 * over the page's game, which are the page's - and the editor's and the test driver's hands. Seated as the page
 * plays: the defender asked how a hit lands, and the tokens walking, a fight a walk wakes starting when they arrive.
 *
 * Who plays an intent is the game's (`play`): the engine built to WebAssembly (`WasmGame`). An intent is its name
 * and its arguments, nothing of the rule it is - the page's own TypeScript rules, the oracle the Rust was held to,
 * are gone (`docs/SERVER.md`, phase 5, slice 0).
 */
export abstract class GameTable implements GameClient, LocalPowers {
  /** The game on the server this one is held to (`wire.ts`); none outside development, or for nobody signed in. */
  private wire: Wire | null = null;
  private behind = false;

  constructor(protected readonly demo: DemoScene) {
    demo.askDefender = true;
    demo.animated = true;
  }

  /** The editor changed the game under it - its project, its ground, its party - not by an intent. */
  protected edited(projectChanged: boolean): void {
    void projectChanged;
  }

  /** Held to the game on the server: told of every intent, and telling this game when the server's restores it. */
  wireWith(wire: Wire): void {
    this.wire = wire;
    wire.attach(() => {
      this.edited(false);
      this.behind = true;
    });
  }

  changedBehind(): boolean {
    const was = this.behind;
    this.behind = false;
    return was;
  }

  /** The editor's change, told to whatever plays beside the page's game - the engine, the server's. */
  private changed(projectChanged: boolean): void {
    this.edited(projectChanged);
    this.wire?.outOfStep();
  }

  /**
   * An intent: played (`play`), and - with a wire - sent up to the server's game and held to its answer. A read
   * asked for the mark it leaves (`compare.answer` false) gives how it reads the page's game (`read`).
   */
  // `any` by default: each intent's answer is declared on `GameClient`, which the method is held to.
  protected did<T = any>(call: string, args: readonly unknown[], read?: () => T, compare: { answer: boolean } = { answer: true }): T {
    // A question the server's game holds: answered there, not here; anything else played here, which refuses it.
    if (this.wire?.asking() === true) return this.wire.whileAsked(call, args, () => this.play<T>(call, args, read, compare));
    const sending = this.wire?.before() ?? false;
    const answer = this.play<T>(call, args, read, compare);
    if (sending) this.wire!.after(call, args, answer, compare);
    return answer;
  }

  /** An intent played, by whoever plays this table's game; a read for its mark answered by `read`. */
  protected abstract play<T>(call: string, args: readonly unknown[], read: (() => T) | undefined, compare: { answer: boolean }): T;

  /** A question the pointer asks, answered from the page's game - and, beside it, by the game's engine. */
  protected abstract asked<T>(question: string, asked: unknown, game: () => T, engine: (engine: WasmEngine) => unknown, seen?: (answer: T) => unknown): T;

  get board(): Board {
    return this.demo;
  }

  moveSelectedTo(...args: Args<'moveSelectedTo'>) { return this.did<MoveResult>('moveSelectedTo', args); }
  attackWithSelected(...args: Args<'attackWithSelected'>) { return this.did<SwingResult>('attackWithSelected', args); }
  endTurn() { return this.did<number>('endTurn', []); }
  useAbility(...args: Args<'useAbility'>) { return this.did<UseOutcome>('useAbility', args); }
  answerPending(...args: Args<'answerPending'>) { return this.did<UseOutcome>('answerPending', args); }
  useSelectedOn(...args: Args<'useSelectedOn'>) { return this.did<UseOutcome>('useSelectedOn', args); }
  approachThenUse(...args: Args<'approachThenUse'>) { return this.did<string>('approachThenUse', args); }
  arrived() { return this.did('arrived', []); }
  cancelApproach() { return this.did('cancelApproach', []); }
  arrive() { return this.did('arrive', []); }
  takeFromContainer(...args: Args<'takeFromContainer'>) { return this.did<boolean>('takeFromContainer', args); }
  equipItem(...args: Args<'equipItem'>) { return this.did<EquipResult>('equipItem', args); }
  unequipItem(...args: Args<'unequipItem'>) { return this.did<EquipResult>('unequipItem', args); }
  useItem(...args: Args<'useItem'>) { return this.did<UseOutcome>('useItem', args); }
  swapCard(...args: Args<'swapCard'>) { return this.did<SwapResult>('swapCard', args); }
  rest(...args: Args<'rest'>) { return this.did<RestResult>('rest', args); }
  applyLevelUp(...args: Args<'applyLevelUp'>) { return this.did<LevelUpResult>('applyLevelUp', args); }
  travelTo(...args: Args<'travelTo'>) { return this.did<boolean>('travelTo', args); }
  loadGameText(text: string, slot?: string) { return this.did<LoadResult>('loadGameText', slot === undefined ? [text] : [text, slot]); }
  jumpTo(...args: Args<'jumpTo'>) {
    // The player's "roll jumps automatically" is read inside the jump: the engine is told it.
    const [id, destination, aim] = args;
    return this.did<MoveResult>('jumpTo', [id, destination, aim ?? null, userSettings().autoRollJumps]);
  }
  startEncounter(...args: Args<'startEncounter'>): void { this.did('startEncounter', args); }
  syncTalks() { return this.did('syncTalks', []); }
  note(text: string, tone: LogTone) { return this.did<LogLine[]>('note', [text, tone]); }
  select(id: string) { return this.did('select', [id]); }
  selectNext() { return this.did('selectNext', []); }
  link(id: string, withId: string) { return this.did('link', [id, withId]); }
  unlink(id: string) { return this.did('unlink', [id]); }
  dropCard(id: string, drop: Drop) { return this.did('dropCard', [id, drop]); }
  landWalkers(view: Walking) {
    // Where each walker is drawn is the page's to say: the engine is told every walker and the spot, at once.
    const drawn = this.demo.party.members().filter((id) => view.isGliding(id)).map((id) => [id, view.spotOf(id)] as const).filter(([, at]) => at !== null);
    return this.did<string[]>('landWalkers', [drawn]);
  }
  closeContainer(): void { this.did('closeContainer', []); }
  sellTo(id: string, item: string) { return this.did('sellTo', [id, item]); }
  takeMotions() { return this.did('takeMotions', []); }
  takeFloaters() { return this.did('takeFloaters', []); }
  rollShown(id: number): void {
    // The engine's dice have no ids: the one shown is told by where it stands in the queue.
    const at = this.demo.rolls.findIndex((waiting) => waiting.id === id);
    this.did('rollShownAt', [at]);
  }
  clearRolls(): void { this.did('clearRolls', []); }
  toTheEditor(): void {
    this.clearRolls();
    this.wire?.close();
  }
  setDiceSpeed(millis: number): void { this.demo.diceMillis = Math.max(0, millis); }

  serialiseSave() { return serialiseSave(this.demo); }
  saveBlockedBy() { return saveBlockedBy(this.demo); }
  nameOf(id: string) { return nameOf(this.demo, id); }
  inCombat() { return inCombat(this.demo); }
  scriptPending() { return scriptPending(this.demo); }
  reachableInteractable() { return reachableInteractable(this.demo); }
  containerView(reach: (id: string) => boolean, refresh: () => void) {
    // What the window does is done through the seam - shut out of reach, a take, a sale, closing it - as a
    // game played elsewhere is told it; the view itself is the page's own.
    const open = openContainer(this.demo);
    if (open === null) return null;
    if (!reach(open)) {
      this.closeContainer();
      return null;
    }
    // Drawing the window read what is in it, which makes a seller's state: the engine reads it too.
    this.did('readContainer', [open]);
    return containerView(this.demo, {
      take: (item) => {
        this.takeFromContainer(open, item);
        refresh();
      },
      sell: (item) => {
        this.sellTo(open, item);
        refresh();
      },
      close: () => {
        this.closeContainer();
        refresh();
      },
    });
  }
  withinReach(...args: After<typeof withinReach>) { return withinReach(this.demo, ...args); }
  abilitiesOf(...args: After<typeof abilitiesOf>) { return abilitiesOf(this.demo, ...args); }
  abilityList(...args: After<typeof abilityList>) {
    // Read for the bar, it names the actor as it reads: the engine is asked it too, for the same mark.
    return this.did('abilityList', args, () => abilityList(this.demo, ...args), { answer: false });
  }
  abilityTargets(...args: After<typeof abilityTargets>) {
    const [id, ability] = args;
    return this.asked('targets', [id, ability.id], () => abilityTargets(this.demo, ...args), (e) => e.targets(id, ability.id));
  }
  pointTiles(...args: After<typeof pointTiles>) {
    const [id, ability] = args;
    return this.asked('tiles', [id, ability.id], () => pointTiles(this.demo, ...args), (e) => e.tiles(id, ability.id));
  }
  shapeAt(...args: After<typeof shapeAt>) {
    const [id, ability, tile] = args;
    return this.asked('shape', [id, ability.id, tile], () => shapeAt(this.demo, ...args), (e) => e.shape(id, ability.id, tile));
  }
  loadoutView(...args: After<typeof loadoutView>) { return loadoutView(this.demo, ...args); }
  gearView(...args: After<typeof gearView>) { return gearView(this.demo, ...args); }
  gearOf(...args: After<typeof gearOf>) { return gearOf(this.demo, ...args); }
  awaitingLevel() { return awaitingLevel(this.demo); }
  hudMembers() { return hudMembers(this.demo); }
  journalEntries() { return journalEntries(this.demo); }
  carriedItems() { return carriedItems(this.demo); }
  talkingView() { return talkingView(this.demo); }
  talkingTo() { return talkingTo(this.demo); }
  inspection(...args: After<typeof inspection>) {
    const [occupant, objectId] = args;
    const facts = inspection(this.demo, ...args);
    // A thing looked at had its state read, which makes it: the engine reads it too.
    if (occupant === null && objectId !== null) this.did('readThing', [objectId]);
    return facts;
  }
  thingState(id: string) {
    const state = this.demo.state.interactable(id);
    this.did('readThing', [id]);
    return { used: state.used, open: state.open, removed: state.removed };
  }
  reachableTiles(...args: After<typeof reachableTiles>) {
    const number = (n: number): number | null => (Number.isFinite(n) ? n : null);
    const drawn = (field: ReturnType<typeof reachableTiles>) => ({ start: field.start, budget: number(field.budget), tiles: field.tiles(), cost: field.tiles().map((t) => number(field.costTo(t))) });
    return this.asked('reach', args, () => reachableTiles(this.demo, ...args), (e) => e.reach(args[0]), drawn);
  }
  underPressureTiles() { return this.asked('pressure', [], () => underPressureTiles(this.demo), (e) => e.pressure()); }
  previewWalk(...args: After<typeof previewWalk>) {
    const [destination, aim, from] = args;
    return this.asked('preview', args, () => previewWalk(this.demo, ...args), (e) => e.preview(destination, aim, from));
  }
  hoverLine(...args: After<typeof hoverLine>) { return hoverLine(this.demo, ...args); }
  steerStep(...args: After<typeof steerStep>) { return steerStep(this.demo, ...args); }
  aimedArc(...args: After<typeof aimedArc>) { return aimedArc(this.demo, ...args); }
  reachRings(...args: After<typeof reachRings>) { return reachRings(this.demo, ...args); }
  jumpReaches(...args: After<typeof jumpReaches>) {
    const [id, destination, aim] = args;
    return this.asked('jumpReaches', args, () => jumpReaches(this.demo, ...args), (e) => e.jumpReaches(id, destination, aim));
  }
  jumpOffered() { return this.asked('jumpOffered', [], () => jumpOffered(this.demo), (e) => e.jumpOffered()); }
  jumpAim() { return this.asked('jumpAim', [], () => jumpAim(this.demo), (e) => e.jumpAim(), (aim) => aim?.tiles ?? null); }

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
    this.changed(true);
  }
  takeGround(scene: SceneDoc, old: TileGrid, grid: TileGrid) {
    const same = takeGround(this.demo, scene, old, grid);
    this.changed(true);
    return same;
  }
  syncAuthoredEncounters(): void {
    syncAuthoredEncounters(this.demo);
    this.changed(true);
  }
  gatherParty(tile: number): void {
    // The editor's: the engine is not told of it, and is brought into step again after.
    gatherParty(this.demo, tile);
    this.changed(false);
  }
  placeAt(id: string, tile: number): void { this.did('placeAt', [id, tile]); }
  setCards(id: string, cards: string[]): void {
    this.did('setCards', [id, cards]);
  }
  setGood(id: string, value: number): void {
    this.did('setGood', [id, value]);
  }
  wound(id: string, marks: number): void {
    this.did('wound', [id, marks]);
  }
  markStress(id: string, marks: number): void {
    this.did('markStress', [id, marks]);
  }
  setCondition(id: string, condition: string, on: boolean): boolean {
    return this.did('setCondition', [id, condition, on]);
  }
  giveItem(id: string, quantity: number): void { this.did('giveItem', [id, quantity]); }
  grantLevel(level?: number): void { this.did('grantLevel', [level ?? null]); }
}
