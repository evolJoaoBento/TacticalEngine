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
import { closeContainer, openContainer, takeFromContainer, withinReach } from './prop-use';
import { sellTo } from './shop';
import { syncTalks } from './talks';
import { hoverLine } from './hover';
import { steerStep } from './steer';
import { landWalkers } from './land';
import { dropCard, type Drop } from './party-drop';
import { carriedItems, containerView, hudMembers, journalEntries, talkingTo, talkingView } from './ui/play-views';
import { shadowFor, type Shadow } from './shadow';
import type { Wire } from './wire';
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
  /** The container's window shut. */
  closeContainer(): void;
  /** One of something sold to a seller. */
  sellTo(id: string, item: string): boolean;
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
  /** The replica the pointer's questions are also put to, once the engine is here; none outside development. */
  private shadow: Shadow | null = null;
  /** The game on the server this one is held to (`wire.ts`); none outside development, or for nobody signed in. */
  private wire: Wire | null = null;

  /** `shadowed`: whether the page's dev engine is fetched to shadow it; a game that is the engine's own is not. */
  constructor(protected readonly demo: DemoScene, shadowed = true) {
    demo.askDefender = true;
    demo.animated = true;
    if (shadowed) {
      void shadowFor(demo).then((shadow) => {
        this.shadow = shadow;
      });
    }
  }

  /** The editor changed the game under it - its project, its ground, its party - not by an intent. */
  protected edited(projectChanged: boolean): void {
    if (projectChanged) this.shadow?.projectChanged();
    else this.shadow?.outOfStep();
  }

  /** For a test: a shadow given rather than fetched. */
  shadowWith(shadow: Shadow): void {
    this.shadow = shadow;
  }

  /** Held to the game on the server: told of every intent, and telling this game when the server's restores it. */
  wireWith(wire: Wire): void {
    this.wire = wire;
    wire.attach(() => this.edited(false));
  }

  /** The editor's change, told to whatever plays beside the page's game - the engine, the server's. */
  private changed(projectChanged: boolean): void {
    this.edited(projectChanged);
    this.wire?.outOfStep();
  }

  /** An intent: played (`play`), and - with a wire - sent up to the server's game and held to its answer. */
  protected did<T>(call: string, args: readonly unknown[], run: () => T, compare: { answer: boolean } = { answer: true }): T {
    const sending = this.wire?.before() ?? false;
    const answer = this.play(call, args, run, compare);
    if (sending) this.wire!.after(call, args, answer, compare);
    return answer;
  }

  /** An intent played: done, and - with a shadow - done in step in the engine too, the two held to each other. */
  protected play<T>(call: string, args: readonly unknown[], run: () => T, compare: { answer: boolean }): T {
    return this.shadow === null ? run() : this.shadow.mirror(call, args, run, compare);
  }

  /** The game's answer - and, with a replica, the replica's beside it, any parting counted. */
  protected asked<T>(question: string, asked: unknown, game: () => T, replica: Parameters<Shadow['check']>[3], seen?: (answer: T) => unknown): T {
    return this.shadow === null ? game() : this.shadow.check(question, asked, game, replica, seen);
  }

  get board(): Board {
    return this.demo;
  }

  moveSelectedTo(...args: After<typeof moveSelectedTo>) { return this.did('moveSelectedTo', args, () => moveSelectedTo(this.demo, ...args)); }
  attackWithSelected(...args: After<typeof attackWithSelected>) { return this.did('attackWithSelected', args, () => attackWithSelected(this.demo, ...args)); }
  endTurn() { return this.did('endTurn', [], () => endTurn(this.demo)); }
  useAbility(...args: After<typeof useAbility>) { return this.did('useAbility', args, () => useAbility(this.demo, ...args)); }
  answerPending(...args: After<typeof answerPending>) { return this.did('answerPending', args, () => answerPending(this.demo, ...args)); }
  useSelectedOn(...args: After<typeof useSelectedOn>) { return this.did('useSelectedOn', args, () => useSelectedOn(this.demo, ...args)); }
  approachThenUse(...args: After<typeof approachThenUse>) { return this.did('approachThenUse', args, () => approachThenUse(this.demo, ...args)); }
  arrived() { return this.did('arrived', [], () => arrived(this.demo)); }
  cancelApproach() { return this.did('cancelApproach', [], () => cancelApproach(this.demo)); }
  arrive() { return this.did('arrive', [], () => arrive(this.demo)); }
  takeFromContainer(...args: After<typeof takeFromContainer>) { return this.did('takeFromContainer', args, () => takeFromContainer(this.demo, ...args)); }
  equipItem(...args: After<typeof equipItem>) { return this.did('equipItem', args, () => equipItem(this.demo, ...args)); }
  unequipItem(...args: After<typeof unequipItem>) { return this.did('unequipItem', args, () => unequipItem(this.demo, ...args)); }
  useItem(...args: After<typeof useItem>) { return this.did('useItem', args, () => useItem(this.demo, ...args)); }
  swapCard(...args: After<typeof swapCard>) { return this.did('swapCard', args, () => swapCard(this.demo, ...args)); }
  rest(...args: After<typeof rest>) { return this.did('rest', args, () => rest(this.demo, ...args)); }
  applyLevelUp(...args: After<typeof applyLevelUp>) { return this.did('applyLevelUp', args, () => applyLevelUp(this.demo, ...args)); }
  travelTo(...args: After<typeof travelTo>) { return this.did('travelTo', args, () => travelTo(this.demo, ...args)); }
  loadGameText(...args: After<typeof loadGameText>) { return this.did('loadGameText', args, () => loadGameText(this.demo, ...args)); }
  jumpTo(...args: After<typeof jumpTo>) {
    // The player's "roll jumps automatically" is read inside the jump: the engine is told it.
    const [id, destination, aim] = args;
    return this.did('jumpTo', [id, destination, aim ?? null, userSettings().autoRollJumps], () => jumpTo(this.demo, ...args));
  }
  startEncounter(...args: After<typeof startEncounter>): void { this.did('startEncounter', args, () => { startEncounter(this.demo, ...args); return null; }); }
  syncTalks() { return this.did('syncTalks', [], () => syncTalks(this.demo)); }
  note(text: string, tone: LogTone) { return this.did('note', [text, tone], () => note(this.demo, text, tone)); }
  select(id: string) { return this.did('select', [id], () => this.demo.party.select(id)); }
  selectNext() { return this.did('selectNext', [], () => this.demo.party.selectNext()); }
  link(id: string, withId: string) { return this.did('link', [id, withId], () => this.demo.party.link(id, withId)); }
  unlink(id: string) { return this.did('unlink', [id], () => this.demo.party.unlink(id)); }
  dropCard(id: string, drop: Drop) { return this.did('dropCard', [id, drop], () => dropCard(this.demo.party, id, drop)); }
  landWalkers(view: Parameters<typeof landWalkers>[1]) {
    // Where each walker is drawn is the page's to say: the engine is told every walker and the spot, at once.
    const drawn = this.demo.party.members().filter((id) => view.isGliding(id)).map((id) => [id, view.spotOf(id)] as const).filter(([, at]) => at !== null);
    return this.did('landWalkers', [drawn], () => landWalkers(this.demo.party, view));
  }
  closeContainer(): void { this.did('closeContainer', [], () => { closeContainer(this.demo); return null; }); }
  sellTo(id: string, item: string) { return this.did('sellTo', [id, item], () => sellTo(this.demo, id, item)); }
  takeMotions() { return this.did('takeMotions', [], () => this.demo.motions.splice(0)); }
  takeFloaters() { return this.did('takeFloaters', [], () => this.demo.floaters.splice(0)); }
  rollShown(id: number): void {
    // The engine's dice have no ids: the one shown is told by where it stands in the queue.
    const at = this.demo.rolls.findIndex((waiting) => waiting.id === id);
    this.did('rollShownAt', [at], () => {
      this.demo.rolls = this.demo.rolls.filter((waiting) => waiting.id !== id);
      return null;
    });
  }
  clearRolls(): void { this.did('clearRolls', [], () => { this.demo.rolls.length = 0; return null; }); }
  setDiceSpeed(millis: number): void { this.demo.diceMillis = Math.max(0, millis); }

  serialiseSave() { return serialiseSave(this.demo); }
  saveBlockedBy() { return saveBlockedBy(this.demo); }
  nameOf(id: string) { return nameOf(this.demo, id); }
  inCombat() { return inCombat(this.demo); }
  scriptPending() { return scriptPending(this.demo); }
  reachableInteractable() { return reachableInteractable(this.demo); }
  containerView(...args: After<typeof containerView>) {
    // What the window does is done through the seam - shut out of reach, a take, a sale, closing it - as a
    // game played elsewhere is told it; the view itself is the page's own.
    const [reach, refresh] = args;
    const open = openContainer(this.demo);
    if (open !== null && !reach(open)) this.closeContainer();
    const view = containerView(this.demo, () => true, refresh);
    if (view === null) return null;
    // Drawing the window read what is in it, which makes a seller's state: the engine reads it too.
    this.did('readContainer', [view.id], () => null);
    return {
      ...view,
      onTake: (item: string) => {
        this.takeFromContainer(view.id, item);
        refresh();
      },
      onClose: () => {
        this.closeContainer();
        refresh();
      },
      ...(view.onSell === undefined ? {} : { onSell: (item: string) => {
        this.sellTo(view.id, item);
        refresh();
      } }),
    };
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
    if (occupant === null && objectId !== null) this.did('readThing', [objectId], () => null);
    return facts;
  }
  thingState(id: string) {
    const state = this.demo.state.interactable(id);
    this.did('readThing', [id], () => null);
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
  placeAt(id: string, tile: number): void { this.did('placeAt', [id, tile], () => { this.demo.state.moveEntity(id, tile); return null; }); }
  setCards(id: string, cards: string[]): void {
    this.did('setCards', [id, cards], () => {
      const sheet = this.demo.sheets.get(id);
      if (sheet === undefined) return null;
      const grown = { ...sheet, domainCards: cards };
      delete (grown as { loadout?: readonly string[] }).loadout;
      setSheet(this.demo, grown);
      refreshWorld(this.demo);
      return null;
    });
  }
  setGood(id: string, value: number): void {
    this.did('setGood', [id, value], () => {
      const entity = this.demo.state.entity(id);
      if (entity?.good !== undefined) entity.good = { max: entity.good.max, value: Math.max(0, Math.min(entity.good.max, value)) };
      return null;
    });
  }
  wound(id: string, marks: number): void {
    this.did('wound', [id, marks], () => {
      const entity = this.demo.state.entity(id);
      if (entity !== undefined) entity.hitPoints.marked = Math.min(entity.hitPoints.max, Math.max(0, marks));
      return null;
    });
  }
  markStress(id: string, marks: number): void {
    this.did('markStress', [id, marks], () => {
      const entity = this.demo.state.entity(id);
      if (entity !== undefined) entity.stress = { ...entity.stress, marked: Math.min(entity.stress.max, Math.max(0, marks)) };
      return null;
    });
  }
  setCondition(id: string, condition: string, on: boolean): boolean {
    return this.did('setCondition', [id, condition, on], () => (on ? this.demo.world.applyCondition(id, condition, 'scene') : this.demo.world.clearCondition(id, condition)));
  }
  giveItem(id: string, quantity: number): void { this.did('giveItem', [id, quantity], () => { this.demo.world.addItem(id, quantity); return null; }); }
  grantLevel(level?: number): void { this.did('grantLevel', [level ?? null], () => { this.demo.world.grantLevel(level); return null; }); }
}
