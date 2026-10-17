/**
 * New Game: a character made at a table, card by card, then a camp of their own.
 *
 * Each choice is a deck laid face up on a wooden table, only its top card showing. Cards are dragged
 * off the top and put down anywhere, to see what is under them - and a double-click on the table
 * gathers them back into the deck. A card clicked is **inspected**: it is taken up and zoomed to the
 * middle of the table, big enough to read, the rest dimmed, with Put back and Choose under it (a click
 * off it, or Escape, puts it back too). Chosen, it is slid into a sleeve and set in the row along the
 * top of the table, the rest of the cards are swept away, and the next deck is dealt. A card in the row
 * is inspected the same way, with Choose again: its sleeve comes off, the table is cleared, and its
 * deck comes back with it on top. However long a card's words, they are set to fit it (`fit-text.ts`),
 * small if they must - the zoom is for reading them.
 *
 * The Model step is not a deck: the figures stand on the table as miniatures, seen from above
 * (`mini-table.ts`), picked up and put down anywhere and lined up again by a double-click. One clicked
 * is taken up close, to be turned left and right, and Chosen or Put back; chosen - a mini is not sleeved -
 * the row's box holds it as it is seen from above (`mini-portraits.ts`).
 *
 * Everything that comes onto the table comes on from off its left edge: a deck, the title, a card set
 * in the row, the name card, the minis.
 *
 *   Ancestry     the SRD's ancestries, each a card of its two features
 *   Model        the figures that draw them: the ancestry's own models, or the company's while it has
 *                none (`character-models.ts`)
 *   Community    the communities, each its feature
 *   Class        the classes, with their domains, Evasion, Hit Points and features
 *   Subclass     the class's two, with their foundations
 *   Domain cards the level-1 cards of the class's domains, as the loadout shows them - two chosen
 *   Traits       the starting spread shared out among the six traits on a sheet (`TraitBoard.tsx`),
 *                starting where the class leans
 *   Equipment    two from the catalogue's cards, as the binder and the shops draw them: a tier-1 primary
 *                weapon (a magic one only for a caster), then tier-1 armour, the class's suggestion on
 *                top of each deck (`startingWeapons`, `startingArmors`)
 *   Name         once every card is chosen: the character's sheet, the loadout's own (`SheetPaper.tsx`),
 *                worked out as the game will (`sheet-preview.ts`), the name written on it; Begin makes
 *                the camp and opens it, played
 *
 * A choice that another hangs on takes the other with it when it changes to something the other does
 * not belong to: a new class, a subclass of another class and domain cards of other domains; a new
 * ancestry, a model that is not one of its own. The same choice made again keeps them.
 *
 * What is offered is the shipped SRD character pack (`listed-packs.ts`) - the pack the camp's project
 * lists. Traits and gear are filled in for the class (`new-character.ts`), and the camp is built round
 * the character (`camp.ts`), kept in this browser (`game-projects.ts`) and opened by address.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CardDef } from '../../engine/content/pack/import';
import { AssetLibrary, modelAssetSchema } from '../../engine/render/assets';
import { SHIPPED_MODELS } from '../project-open';
import { shippedPack } from '../listed-packs';
import { loadoutCardOf, printedText } from '../demo-abilities';
import { modelName, modelsForAncestry } from '../character-models';
import { isArmor, keyTrait, sheetFor, startingArmors, startingWeapons, suggestedTraits, type Creation } from '../new-character';
import { catalogueCard } from '../gear';
import { GearFace } from './GearBinder';
import { equipmentArt } from './equipment-art';
import { ArtNote, artNoteHandlers } from './AiNote';
import type { Traits } from '../../engine/character/sheet';
import { campProject } from '../camp';
import type { GameProjects } from '../game-projects';
import { CardFace } from './CardFace';
import { artFor, choiceArtFor, type ChoiceKind } from './card-art';
import { useFitText } from './fit-text';
import { TraitBoard, TraitsFace } from './TraitBoard';
import { SheetPaper } from './SheetPaper';
import { sheetPreview } from '../sheet-preview';
import { ModelRegistry } from '../../engine/render/procedural/registry';
import { portraitOf } from '../../engine/render/thumbnails';
import { MiniPortraits } from './mini-portraits';
import { MiniTable } from './mini-table';
import { openPage } from './MainMenu';
import './cards.css';
import './table.css';

const STEPS = ['Ancestry', 'Model', 'Community', 'Class', 'Subclass', 'Domain cards', 'Traits', 'Equipment'] as const;
type Step = (typeof STEPS)[number];

/** How long each move of the cards takes, in step with `table.css`. */
const DEAL_MS = 520;
const SWEEP_MS = 430;
const SLEEVE_MS = 460;
const GATHER_MS = 460;
/** How far a press travels before it is a drag and not a click. */
const DRAG_START = 5;
/** How long a card inspected takes to go back where it came from, in step with `table.css`. */
const PUT_BACK_MS = 220;
/** How much of the table an inspected card fills at most: of its height, and of its width. */
const LOOK_FILL = { down: 0.72, across: 0.6 };

/** What has been chosen so far. */
type Picks = Partial<Omit<Creation, 'domainCards' | 'name'>> & { domainCards: string[] };

/** A card lying loose on the table: which, where its middle is, and how it came to rest. */
interface Loose {
  id: string;
  x: number;
  y: number;
  turn: number;
}

type Phase = 'dealing' | 'idle' | 'gathering' | 'sleeving' | 'sweeping';

/**
 * A card being inspected: which, whether it is one already chosen (in the row) or one on offer, where
 * it was taken from - its middle, as an offset from where it is shown, and its size there as a part of
 * its own - and how far it is zoomed.
 */
interface Look {
  at: Step;
  id: string;
  chosen: boolean;
  from: { x: number; y: number; scale: number };
  zoom: number;
}

const INSTRUCTION: Record<Step, string> = {
  Ancestry: 'Choose your ancestry',
  Model: 'Choose who you look like',
  Community: 'Choose the community you come from',
  Class: 'Choose your class',
  Subclass: 'Choose your subclass',
  'Domain cards': 'Choose two domain cards',
  Traits: 'Share out your traits',
  Equipment: 'Choose your weapon and armor',
};

/**
 * A card's face for a choice: its picture when `public/cards/` has one (`card-art.ts`), its kind, its
 * name, a line, and the features it prints. A class's picture is its banner, hung from the top edge;
 * the others' is an illustration across the top of the card.
 */
function ChoiceFace(props: { kind: string; art: ChoiceKind; id: string; name: string; line?: string; features: CardDef[] }): preact.JSX.Element {
  const picture = choiceArtFor(props.art, props.id);
  const banner = props.art === 'class';
  const root = useRef<HTMLDivElement>(null);
  useFitText(root, (face) => face.querySelector<HTMLElement>('.deal-features'), picture !== null && !banner ? 9.5 : 10.5, `${props.art}:${props.id}:${picture ?? ''}`);
  return (
    <div ref={root} className={`deal-face${picture === null ? '' : banner ? ' has-banner' : ' has-art'}`}>
      {picture === null ? null : <img className={banner ? 'deal-banner' : 'deal-art'} data-testid="choice-art" src={picture} alt="" draggable={false} {...artNoteHandlers(`card:${props.art}-${props.id}`)} />}
      <span className="deal-kind">{props.kind}</span>
      <h3 className="deal-name">{props.name}</h3>
      {props.line === undefined ? null : <span className="deal-line">{props.line}</span>}
      <div className="deal-features">
        {props.features.map((feature) => (
          <p key={feature.id}>
            <b>{feature.name}.</b> {printedText(feature)}
          </p>
        ))}
      </div>
    </div>
  );
}

/** A domain card as the loadout shows it, its rules set to fit the card; marked when no script is written for it. */
function DomainFace(props: { card: CardDef; words: boolean }): preact.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  useFitText(root, (face) => face.querySelector<HTMLElement>('.face-rules'), 9, props.card.id);
  return (
    <div ref={root} className="deal-face is-domain">
      <CardFace card={loadoutCardOf(props.card)} />
      {props.words ? <span className="deal-words" data-testid="text-only" title="No script is written for this card yet: it is kept in the loadout, and does nothing in play">Text only</span> : null}
    </div>
  );
}

/** The shipped models, loaded once for the table: as miniatures on it, and seen from above in the row. */
function useModels(): { assets: AssetLibrary; portraits: MiniPortraits } {
  const models = useMemo(() => {
    const loader = new GLTFLoader();
    const assets = new AssetLibrary(
      (url) => loader.loadAsync(url).then((gltf) => {
        gltf.scene.animations = gltf.animations;
        return gltf.scene;
      }),
      SHIPPED_MODELS.map((model) => modelAssetSchema.parse({ ...model, kind: 'gltf' })),
    );
    return { assets, portraits: new MiniPortraits(assets) };
  }, []);
  useEffect(() => () => models.portraits.dispose(), [models]);
  return models;
}

/**
 * The Model step: the figures standing on the table as miniatures, each with its name plate, and the one
 * clicked up close with Choose and Put back. While the table is swept away after a Choose (`held`) the
 * one chosen stays up close.
 */
function MiniStage(props: { ids: string[]; assets: AssetLibrary; selected: string | null; held: boolean; onSelect: (id: string | null) => void; onChoose: () => void }): preact.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const plates = useRef<HTMLDivElement>(null);
  const stage = useRef<MiniTable | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (props.selected !== null || !props.held) setShown(props.selected);
  }, [props.selected, props.held]);
  const key = props.ids.join('|');
  useEffect(() => {
    const table = new MiniTable(canvas.current!, props.assets, plates.current!, props.ids, props.onSelect);
    stage.current = table;
    return () => {
      table.dispose();
      stage.current = null;
    };
  }, [key]);
  useEffect(() => stage.current?.inspect(shown), [shown, key]);
  useEffect(() => {
    if (props.held) stage.current?.leave();
  }, [props.held, key]);
  return (
    <>
      <canvas ref={canvas} className="mini-stage" data-testid="mini-table" data-count={props.ids.length} />
      <div className="mini-plates" ref={plates}>
        {props.ids.map((id) => (
          <div key={id} className="mini-plate" data-testid="mini" data-choice={id}>
            <button type="button" className="mini-name" onClick={() => props.onSelect(id)}>
              {modelName(id)}
            </button>
          </div>
        ))}
      </div>
      {shown === null ? null : (
        <div className="mini-inspect" data-testid="mini-inspect" data-choice={shown}>
          <div className="mini-panel">
            <h2 className="mini-title">{modelName(shown)}</h2>
            <div className="mini-actions">
              <button type="button" className="deal-button" data-testid="put-back" disabled={props.held} onClick={() => props.onSelect(null)}>
                Put back
              </button>
              <button type="button" className="deal-button" data-testid="choose-card" disabled={props.held} onClick={props.onChoose}>
                Choose
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** A chosen mini in its box in the row, seen from above; its initial stands in until the file has loaded. */
function MiniPortrait(props: { portraits: MiniPortraits; id: string }): preact.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => props.portraits.attach(canvas.current!, props.id), [props.portraits, props.id]);
  return (
    <span className="deal-box-view" data-letter={modelName(props.id).charAt(0)} {...artNoteHandlers(`model:${props.id}`)}>
      <canvas ref={canvas} className="deal-figure" data-testid="model-figure" data-model={props.id} />
    </span>
  );
}

export function NewGame(props: { onBack: () => void; games: GameProjects }): preact.JSX.Element {
  const pack = useMemo(() => shippedPack('srd-characters')!, []);
  const scripted = useMemo(() => new Set(pack.abilities.map((ability) => ability.source?.card).filter((card): card is string => card !== undefined)), [pack]);
  const { assets, portraits } = useModels();
  // The photograph on the sheet is the one the game takes (`portraitOf`), redrawn when the file arrives.
  const registry = useMemo(() => new ModelRegistry(), []);
  const [, photographed] = useState(0);
  useEffect(() => assets.onChange(() => photographed((n) => n + 1)), [assets]);
  const [picks, setPicks] = useState<Picks>({ domainCards: [] });
  const [step, setStep] = useState<Step | 'Name'>('Ancestry');
  const [deck, setDeck] = useState<string[]>(() => pack.ancestries.map((ancestry) => ancestry.id));
  const [loose, setLoose] = useState<Loose[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('dealing');
  const [looking, setLooking] = useState<Look | null>(null);
  const [puttingBack, setPuttingBack] = useState(false);
  const [name, setName] = useState('');
  /** The traits as they lie on the sheet while the Traits step is open. */
  const [draft, setDraft] = useState<Traits | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const table = useRef<HTMLDivElement>(null);
  const deckBox = useRef<HTMLDivElement>(null);
  const pressed = useRef<{ id: string; from: 'deck' | 'loose'; element: HTMLElement; x: number; y: number; moved: boolean; offset: { x: number; y: number } } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (ms: number, then: () => void): void => {
    timers.current.push(setTimeout(then, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const phaseNow = useRef(phase);
  phaseNow.current = phase;
  useEffect(() => later(DEAL_MS, () => setPhase('idle')), []);
  // Every card's picture fetched and decoded as the table opens, so a card turned up, dragged off or
  // zoomed shows its picture at once rather than a blank while it loads.
  const preloaded = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    const pictures = [
      ...pack.ancestries.map((entry) => choiceArtFor('ancestry', entry.id)),
      ...pack.communities.map((entry) => choiceArtFor('community', entry.id)),
      ...pack.classes.map((entry) => choiceArtFor('class', entry.id)),
      ...pack.subclasses.map((entry) => choiceArtFor('subclass', entry.id)),
      ...pack.cards.filter((card) => card.grant.kind === 'chosen').map((card) => {
        const art = artFor(card.id);
        return art.kind === 'image' ? art.src : null;
      }),
      ...[...startingWeapons(undefined, true), ...startingArmors(undefined)].map((id) => equipmentArt(catalogueCard(id)?.card)),
    ].filter((src): src is string => src !== null);
    preloaded.current = [...new Set(pictures)].map((src) => {
      const image = new Image();
      image.src = src;
      void image.decode?.().catch(() => undefined);
      return image;
    });
  }, [pack]);

  // ---- What each step offers, and what it takes to be done.
  const granted = (kind: string, key: string, id: string): CardDef[] =>
    pack.cards.filter((card) => card.grant.kind === kind && (card.grant as Record<string, unknown>)[key] === id);
  const offerOf = (at: Step, with_: Picks = picks): string[] => {
    const klass = pack.classes.find((entry) => entry.id === with_.classId);
    switch (at) {
      case 'Ancestry': return pack.ancestries.map((entry) => entry.id);
      case 'Model': return with_.ancestryId === undefined ? [] : modelsForAncestry(with_.ancestryId, SHIPPED_MODELS);
      case 'Community': return pack.communities.map((entry) => entry.id);
      case 'Class': return pack.classes.map((entry) => entry.id);
      case 'Subclass': return pack.subclasses.filter((sub) => sub.classId === with_.classId).map((sub) => sub.id);
      case 'Traits': return with_.classId === undefined ? [] : ['traits'];
      // The weapon first, then the armour: one deck at a time.
      case 'Equipment': {
        if (with_.classId === undefined) return [];
        const casts = pack.subclasses.find((sub) => sub.id === with_.subclassId)?.spellcastTrait !== undefined;
        return with_.primaryWeaponId === undefined ? startingWeapons(with_.classId, casts) : startingArmors(with_.classId);
      }
      case 'Domain cards': return klass === undefined ? [] : pack.cards.filter((card) => card.grant.kind === 'chosen' && card.level === 1 && card.domain !== undefined && klass.domains.includes(card.domain)).map((card) => card.id);
    }
  };
  const chosenOf = (at: Step, with_: Picks = picks): string[] => {
    switch (at) {
      case 'Ancestry': return with_.ancestryId === undefined ? [] : [with_.ancestryId];
      case 'Model': return with_.model === undefined ? [] : [with_.model];
      case 'Community': return with_.communityId === undefined ? [] : [with_.communityId];
      case 'Class': return with_.classId === undefined ? [] : [with_.classId];
      case 'Subclass': return with_.subclassId === undefined ? [] : [with_.subclassId];
      case 'Domain cards': return with_.domainCards;
      case 'Traits': return with_.traits === undefined ? [] : ['traits'];
      case 'Equipment': return [with_.primaryWeaponId, with_.armorId].filter((id): id is string => id !== undefined);
    }
  };
  const needs = (at: Step): number => (at === 'Domain cards' || at === 'Equipment' ? 2 : 1);
  const done = (at: Step, with_: Picks = picks): boolean => chosenOf(at, with_).length >= needs(at);
  const nextOpen = (with_: Picks): Step | 'Name' => STEPS.find((at) => !done(at, with_)) ?? 'Name';

  /** The trait that matters most to the character: the one the subclass casts with, or where the class leans. */
  const mostImportant = keyTrait(picks.classId, pack.subclasses.find((entry) => entry.id === picks.subclassId)?.spellcastTrait);

  // ---- A card's face.
  const face = (at: Step, id: string): preact.JSX.Element => {
    switch (at) {
      case 'Ancestry': {
        const ancestry = pack.ancestries.find((entry) => entry.id === id)!;
        return <ChoiceFace kind="Ancestry" art="ancestry" id={id} name={ancestry.name} features={granted('ancestry', 'ancestryId', id)} />;
      }
      case 'Model': {
        return (
          <div className="deal-face is-box">
            <MiniPortrait portraits={portraits} id={id} />
            <span className="deal-box-name">{modelName(id)}</span>
          </div>
        );
      }
      case 'Community': {
        const community = pack.communities.find((entry) => entry.id === id)!;
        return <ChoiceFace kind="Community" art="community" id={id} name={community.name} features={granted('community', 'communityId', id)} />;
      }
      case 'Class': {
        const entry = pack.classes.find((klass) => klass.id === id)!;
        const line = `${entry.domains.map((domain) => domain.charAt(0).toUpperCase() + domain.slice(1)).join(' & ')} · Evasion ${entry.startingEvasion} · ${entry.startingHitPoints} HP`;
        return <ChoiceFace kind="Class" art="class" id={id} name={entry.name} line={line} features={granted('class', 'classId', id)} />;
      }
      case 'Subclass': {
        const sub = pack.subclasses.find((entry) => entry.id === id)!;
        const foundation = pack.cards.filter((card) => card.grant.kind === 'subclass' && card.grant.subclassId === id && card.grant.stage === 'foundation');
        return <ChoiceFace kind="Subclass" art="subclass" id={id} name={sub.name} {...(sub.spellcastTrait === undefined ? {} : { line: `Spellcast: ${sub.spellcastTrait.charAt(0).toUpperCase() + sub.spellcastTrait.slice(1)}` })} features={foundation} />;
      }
      case 'Domain cards': {
        const card = pack.cards.find((entry) => entry.id === id)!;
        // A card no ability is written for is its words only: in the loadout, never dealt to the hand.
        return <DomainFace card={card} words={!scripted.has(id)} />;
      }
      case 'Traits':
        return <TraitsFace traits={picks.traits ?? draft ?? suggestedTraits(picks.classId)} keyTrait={mostImportant} />;
      case 'Equipment': {
        // The catalogue's own card, as the binder and the shops draw it: its picture, or its numbers.
        const card = catalogueCard(id);
        return <div className="deal-face is-gear">{card === null ? <h3 className="deal-name">{id}</h3> : <GearFace card={card} />}</div>;
      }
    }
  };

  // ---- Moving cards about the table.
  const pointOnTable = (clientX: number, clientY: number): { x: number; y: number } => {
    const box = table.current!.getBoundingClientRect();
    return { x: clientX - box.left, y: clientY - box.top };
  };
  const deckCentre = (): { x: number; y: number } => {
    const box = deckBox.current?.getBoundingClientRect();
    if (box === undefined) return { x: 0, y: 0 };
    return pointOnTable(box.left + box.width / 2, box.top + box.height / 2);
  };

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const press = pressed.current;
      if (press === null) return;
      if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START) return;
      const at = pointOnTable(e.clientX, e.clientY);
      const x = at.x - press.offset.x;
      const y = at.y - press.offset.y;
      if (!press.moved) {
        press.moved = true;
        setSelected(null);
        // Off the top of the deck and into the hand, at the top of the pile of loose cards.
        if (press.from === 'deck') setDeck((was) => was.filter((id) => id !== press.id));
        setLoose((was) => [...was.filter((card) => card.id !== press.id), { id: press.id, x, y, turn: was.find((card) => card.id === press.id)?.turn ?? (Math.random() * 14 - 7) }]);
        return;
      }
      setLoose((was) => was.map((card) => (card.id === press.id ? { ...card, x, y } : card)));
    };
    const up = (): void => {
      const press = pressed.current;
      pressed.current = null;
      if (press === null || press.moved) return;
      // A press that never went anywhere is a click: take the card up to look at.
      lookNow.current(press.element, press.id, false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const press = (id: string, from: 'deck' | 'loose') => (e: PointerEvent): void => {
    if (e.button !== 0 || phase !== 'idle') return;
    e.preventDefault();
    e.stopPropagation();
    const at = pointOnTable(e.clientX, e.clientY);
    const lying = loose.find((card) => card.id === id);
    const centre = lying ?? deckCentre();
    pressed.current = { id, from, element: e.currentTarget as HTMLElement, x: e.clientX, y: e.clientY, moved: false, offset: { x: at.x - centre.x, y: at.y - centre.y } };
  };

  // ---- Inspecting a card: taken up from where it lies, zoomed to the middle of the table.
  const look = (element: HTMLElement, id: string, chosen: boolean, at?: Step): void => {
    const shown = at ?? stepNow.current;
    if (shown === 'Name' || phaseNow.current !== 'idle' || table.current === null) return;
    const box = table.current.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    // The face is laid out at the card's full size whatever it is drawn at; that is what is zoomed.
    const face = element.querySelector<HTMLElement>('.deal-face');
    const width = face?.offsetWidth || rect.width;
    const height = face?.offsetHeight || rect.height;
    const zoom = Math.min((box.height * LOOK_FILL.down) / height, (box.width * LOOK_FILL.across) / width);
    setPuttingBack(false);
    setLooking({
      at: shown,
      id,
      chosen,
      from: { x: rect.left + rect.width / 2 - box.left - box.width / 2, y: rect.top + rect.height / 2 - box.top - box.height * 0.47, scale: rect.height / height },
      zoom,
    });
    setSelected(chosen ? null : id);
  };
  const lookNow = useRef(look);
  lookNow.current = look;
  const stepNow = useRef<Step | 'Name'>(step);
  stepNow.current = step;

  /** Put the card inspected back where it came from. */
  const putBack = (): void => {
    if (looking === null || puttingBack || phase !== 'idle') return;
    setPuttingBack(true);
    later(PUT_BACK_MS, () => {
      setLooking(null);
      setPuttingBack(false);
      setSelected(null);
    });
  };
  const putBackNow = useRef(putBack);
  putBackNow.current = putBack;
  useEffect(() => {
    if (looking === null) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') putBackNow.current();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [looking !== null]);

  /** A double-click on the table: every loose card slides back onto the deck, in the order it left. */
  const gather = (e: MouseEvent): void => {
    if (e.target !== e.currentTarget || phase !== 'idle' || loose.length === 0) return;
    setSelected(null);
    setPhase('gathering');
    const home = deckCentre();
    setLoose((was) => was.map((card) => ({ ...card, x: home.x, y: home.y, turn: 0 })));
    later(GATHER_MS, () => {
      setDeck((was) => [...was, ...loose.map((card) => card.id)]);
      setLoose([]);
      setPhase('idle');
    });
  };

  /** Deal a step's deck: the table cleared, then the deck in. */
  const deal = (at: Step | 'Name', with_: Picks, onTop?: string, traits?: Traits): void => {
    setPhase('sweeping');
    later(SWEEP_MS, () => {
      setStep(at);
      // The sheet opens with the traits as they were left, or as the class would have them.
      if (at === 'Traits') setDraft(traits ?? with_.traits ?? suggestedTraits(with_.classId));
      setLoose([]);
      setSelected(null);
      setLooking(null);
      if (at !== 'Name') {
        const offered = offerOf(at, with_).filter((id) => !chosenOf(at, with_).includes(id));
        setDeck(onTop === undefined ? offered : [onTop, ...offered.filter((id) => id !== onTop)]);
      } else setDeck([]);
      setPhase('dealing');
      later(DEAL_MS, () => setPhase('idle'));
    });
  };

  /** Choose the card lifted: sleeve it, set it in the row, and go on. A mini is not sleeved: it goes straight into its box. */
  const choose = (): void => {
    if (step === 'Name' || phase !== 'idle') return;
    const id = step === 'Traits' ? 'traits' : selected;
    if (id === null) return;
    const at = step;
    const shared = draft ?? suggestedTraits(picks.classId);
    const settle = (): void => {
      let next: Picks = { ...picks };
      switch (at) {
        case 'Ancestry':
          next.ancestryId = id;
          // A model that is not one of the new ancestry's goes.
          if (next.model !== undefined && !offerOf('Model', next).includes(next.model)) delete next.model;
          break;
        case 'Model': next.model = id; break;
        case 'Community': next.communityId = id; break;
        case 'Class':
          next.classId = id;
          // What no longer belongs to the class goes: a subclass of another, domain cards of other domains.
          if (next.subclassId !== undefined && !offerOf('Subclass', next).includes(next.subclassId)) delete next.subclassId;
          next.domainCards = next.domainCards.filter((card) => offerOf('Domain cards', next).includes(card));
          break;
        case 'Subclass':
          next.subclassId = id;
          // A magic weapon goes with a subclass that casts nothing.
          if (next.primaryWeaponId !== undefined && !offerOf('Equipment', { ...next, primaryWeaponId: undefined }).includes(next.primaryWeaponId)) delete next.primaryWeaponId;
          break;
        case 'Domain cards': next.domainCards = [...next.domainCards, id]; break;
        case 'Traits': next.traits = { ...shared }; break;
        case 'Equipment':
          if (isArmor(id)) next.armorId = id;
          else next.primaryWeaponId = id;
          break;
      }
      setPicks(next);
      setSelected(null);
      if (!done(at, next) && at === 'Equipment') {
        // The weapon chosen: the armour's deck is dealt in its place.
        deal('Equipment', next);
        return;
      }
      if (!done(at, next)) {
        // More of this step to choose: the chosen card leaves the table, the rest stay.
        setLooking(null);
        setDeck((was) => was.filter((card) => card !== id));
        setLoose((was) => was.filter((card) => card.id !== id));
        setPhase('idle');
        return;
      }
      deal(nextOpen(next), next);
    };
    if (at === 'Model') return settle();
    setPhase('sleeving');
    later(SLEEVE_MS, settle);
  };

  /** Choose again: the sleeve off, the table cleared, and the step's deck back with this card on top. */
  const chooseAgain = (at: Step, id: string): void => {
    if (phase !== 'idle') return;
    setLooking(null);
    const next: Picks = { ...picks, domainCards: picks.domainCards.filter((card) => card !== id) };
    if (at === 'Ancestry') delete next.ancestryId;
    if (at === 'Model') delete next.model;
    if (at === 'Community') delete next.communityId;
    if (at === 'Class') delete next.classId;
    if (at === 'Subclass') delete next.subclassId;
    if (at === 'Traits') delete next.traits;
    if (at === 'Equipment') {
      if (isArmor(id)) delete next.armorId;
      else delete next.primaryWeaponId;
    }
    setPicks(next);
    deal(at, next, id, at === 'Traits' ? picks.traits : undefined);
  };

  const begin = (): void => {
    const project = campProject(sheetFor({ ...(picks as Creation), name }));
    if (!props.games.write(project)) {
      setFailed('This browser would not keep the new game, so it could not begin.');
      return;
    }
    openPage(`play&project=${encodeURIComponent(project.id)}`);
  };

  const here = step;
  const top = deck[0];
  /** The sheet the character will have, on the last step: worked out once for what was chosen, the name aside. */
  const preview = useMemo(
    () => (here === 'Name' && STEPS.every((at) => done(at)) ? sheetPreview({ ...(picks as Creation), name: 'Hero' }) : null),
    [here, JSON.stringify(picks)],
  );
  /** Whether a card on the table is the one up close, and so not where it lay. */
  const looked = (id: string): boolean => looking !== null && !looking.chosen && looking.id === id;
  const chosenRow: { at: Step; id: string }[] = STEPS.flatMap((at) => chosenOf(at).map((id) => ({ at, id })));

  return (
    <div className={`deal-table is-${phase}`} data-testid="new-game" data-step={here} ref={table} onDblClick={gather}>
      {/* How the art under the pointer was made, in the corner. */}
      <ArtNote />
      <button type="button" className="deal-leave" data-testid="wizard-back" onClick={props.onBack}>
        ‹ Menu
      </button>

      {/* What has been chosen, sleeved, along the top of the table. */}
      <div className="deal-row" data-testid="chosen-row">
        {chosenRow.map(({ at, id }) => (
          <div key={`${at}:${id}`} className="deal-slot">
            <button type="button" className={`deal-card is-small${at === 'Model' ? '' : ' is-sleeved'}${looking?.chosen === true && looking.id === id ? ' is-looked' : ''}`}
              data-testid="chosen-card" data-step={at} data-choice={id} onClick={(e) => look(e.currentTarget, id, true, at)}>
              {face(at, id)}
              {at === 'Model' ? null : <span className="deal-sleeve" />}
            </button>
            <span className="deal-label">{at === 'Equipment' ? (isArmor(id) ? 'Armor' : 'Weapon') : at}</span>
          </div>
        ))}
      </div>

      {here === 'Name' ? (
        // The character's sheet, the one the loadout shows in the game, with the name still to write.
        <div className="deal-sheet deck-sheet" data-testid="name-card">
          <SheetPaper
            name={<input className="sheet-name-input" data-testid="character-name" value={name} maxLength={40} placeholder="Their name" aria-label="Their name"
              onInput={(e) => setName(e.currentTarget.value)} />}
            eyebrow={`${preview?.member.role ?? 'Character'} · Level 1`}
            {...(preview === null ? {} : { sheet: { ...preview.member, name }, stats: preview.stats })}
            portrait={picks.model === undefined ? null : portraitOf(registry, assets, picks.model)}>
            <div className="sheet-foot">
              <p>Anything on the sheet can be changed in Edit Game whenever you like. The rest of the company is waiting at the camp.</p>
              {failed === null ? null : <p className="deal-failed" role="alert">{failed}</p>}
              <button type="button" className="deal-button is-big" data-testid="begin-game" disabled={name.trim() === ''} onClick={begin}>
                Begin
              </button>
            </div>
          </SheetPaper>
        </div>
      ) : here === 'Traits' ? (
        <>
          <h1 className="deal-title">{INSTRUCTION[here]}</h1>
          <TraitBoard traits={draft ?? suggestedTraits(picks.classId)} suggested={suggestedTraits(picks.classId)} keyTrait={mostImportant}
            className={pack.classes.find((entry) => entry.id === picks.classId)?.name ?? 'the class'}
            sleeving={phase === 'sleeving'} busy={phase !== 'idle'} onChange={setDraft} onChoose={choose} />
        </>
      ) : here === 'Model' ? (
        <>
          <h1 className="deal-title">{INSTRUCTION[here]}</h1>
          <MiniStage ids={deck} assets={assets} selected={selected} held={phase === 'sleeving' || phase === 'sweeping'}
            onSelect={(id) => {
              // Nothing is taken up or put back while the one chosen is being sleeved.
              if (phaseNow.current !== 'idle') return;
              setSelected(id);
            }}
            onChoose={choose} />
        </>
      ) : (
        <>
          <h1 className="deal-title">{here === 'Equipment' ? (picks.primaryWeaponId === undefined ? 'Choose your weapon' : 'Choose your armor') : INSTRUCTION[here]}{needs(here) > 1 ? ` · ${chosenOf(here).length} of ${needs(here)}` : ''}</h1>
          {/* The deck, face up: only the top card is seen. */}
          <div className="deal-deck" ref={deckBox} data-testid="deck" data-count={deck.length}>
            {deck.length > 1 ? <span className="deal-under" style={{ '--depth': Math.min(deck.length - 1, 6) }} /> : null}
            {/* The next card, face up under the top one: seen when the top is dragged off or taken up to look at. */}
            {deck[1] === undefined ? null : (
              <div key={`under:${deck[1]}`} className="deal-card is-top is-next" data-testid="deck-next" data-choice={deck[1]} aria-hidden="true">
                {face(here, deck[1])}
              </div>
            )}
            {top === undefined ? <span className="deal-empty">The deck is spread on the table.</span> : (
              <div key={top} className={`deal-card is-top${looked(top) ? ' is-looked' : ''}`}
                data-testid="deck-top" data-choice={top} onPointerDown={press(top, 'deck')}>
                {face(here, top)}
              </div>
            )}
          </div>
          {/* The cards spread about the table, the last put down on top. */}
          {loose.map((card, i) => (
            <div key={card.id} className={`deal-card is-loose${looked(card.id) ? ' is-looked' : ''}`}
              data-testid="table-card" data-choice={card.id}
              style={{ left: `${card.x}px`, top: `${card.y}px`, zIndex: 10 + i, '--turn': `${card.turn}deg` }}
              onPointerDown={press(card.id, 'loose')}>
              {face(here, card.id)}
            </div>
          ))}
        </>
      )}

      {/* The card being inspected, up close: taken from where it lay, and put back there. */}
      {looking === null ? null : (
        <div className={`deal-look${puttingBack ? ' is-putting-back' : ''}${!looking.chosen && phase === 'sleeving' ? ' is-sleeving' : ''}`}
          data-testid="card-inspect" data-choice={looking.id}
          style={{ '--from-x': `${looking.from.x}px`, '--from-y': `${looking.from.y}px`, '--from-scale': looking.from.scale, '--zoom': looking.zoom }}
          onClick={(e) => {
            if (e.target === e.currentTarget) putBack();
          }}>
          <div className={`deal-card deal-look-card${looking.chosen && looking.at !== 'Model' ? ' is-sleeved' : ''}`}>
            {face(looking.at, looking.id)}
            {looking.at === 'Model' ? null : <span className="deal-sleeve" />}
          </div>
          <div className="deal-look-actions">
            <button type="button" className="deal-button" data-testid="put-back" disabled={phase !== 'idle'} onClick={putBack}>
              Put back
            </button>
            {looking.chosen ? (
              <button type="button" className="deal-button" data-testid="choose-again" disabled={phase !== 'idle'} onClick={() => chooseAgain(looking.at, looking.id)}>
                Choose again
              </button>
            ) : (
              <button type="button" className="deal-button" data-testid="choose-card" disabled={phase !== 'idle'} onClick={choose}>
                Choose
              </button>
            )}
          </div>
        </div>
      )}

      <p className="deal-tip" data-testid="table-tip">
        {looking !== null
          ? 'Click off the card, or Esc, to put it back'
          : here === 'Name'
          ? 'Click a card in the row to look at it again, or choose again'
          : here === 'Traits'
          ? 'Drag a number onto another trait to trade them · Suggested puts them back · Choose when they suit you'
          : here === 'Model' && selected !== null
            ? 'Drag left or right to turn it · Click the table or Put back to set it down'
            : here === 'Model'
            ? 'Pick up a mini and put it down anywhere · Double-click the table to line them up · Click a mini to look at it'
            : 'Drag cards off the deck to see the next · Double-click the table to gather them back · Click a card to look at it'}
      </p>
    </div>
  );
}
