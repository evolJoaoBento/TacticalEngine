/**
 * The portal at a New Game's camp (`camp.ts`): where an adventure is begun. Used, it opens a window of the adventures
 * this browser has - the Ashwell, which this build writes, and any the player imported (`adventure-library.ts`) - and
 * choosing one begins it as a game of its own, played by the party as it stands at the camp: the character made, and
 * whoever of the company was asked along. An adventure written for a party of its own (`fixedParty`) - the Demo Vault,
 * whose cards and doors are its party's - is played by that party instead, with whoever leads the camp's party among
 * them, four at most; the companions wait at the camp.
 *
 * The portal is a prop like any other, whose script opens it (`openContainer`); what makes its window a chooser rather
 * than a chest is its id (`ADVENTURE_PORTAL`). Nothing in the rules has to know: the window, and the game begun, are
 * the page's.
 */

import type { CharacterSheet } from '../engine/character/sheet';
import type { ProjectDoc } from '../engine/scene/schema';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { ASHWELL_ID, ashwellProject } from './adventures/ashwell';
import { buildDemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { PARTY_SHEETS } from './demo-rules';
import type { AdventureLibrary } from './adventure-library';
import type { Offer } from './wire';
import { GameProjects } from './game-projects';

/** The id of the prop whose window is the chooser. */
export const ADVENTURE_PORTAL = 'adventure-portal';

/** The pack the party's characters are made of: an adventure begun lists it, whatever it listed before. */
const PARTY_PACK = 'srd-characters';

/** How many a party is at most, as a companion joining finds it (`engine::game::party_join::PARTY_MOST`). */
export const PARTY_MOST = 4;

/** The Demo Vault offered at the portal: the engine's own demo, played by the party it was written for. */
export const DEMO_VAULT_ID = 'the-demo-vault';

/**
 * An adventure the portal offers: what it is called, a line on it, whether it was imported, and the project it is for
 * a party - null when it can no longer be read.
 */
export interface AdventureChoice {
  id: string;
  name: string;
  blurb: string;
  imported?: true;
  /** Its own party, when it keeps it (`fixedParty`): who of them go is `partyFor`'s to say. */
  ownParty?: readonly { id: string; name: string }[];
  /** At a shared game, who of the others offered it (`Wire.offer`): its project is the table's until it is begun. */
  offeredBy?: string;
  build(party: readonly CharacterSheet[]): ProjectDoc | null;
}

/** The adventures this build writes. */
export const ADVENTURES: readonly AdventureChoice[] = [
  {
    id: ASHWELL_ID,
    name: 'The Ashwell',
    blurb: 'A grim dungeon in five levels, under the drowned town of Hallowmere. A tavern at the top, and a well.',
    build: (party) => ashwellProject(party),
  },
  {
    id: DEMO_VAULT_ID,
    name: 'The Demo Vault',
    blurb: 'A vault of husks and the pit beneath it: the engine\u2019s own demo, its cards and its doors its party\u2019s.',
    ownParty: PARTY_SHEETS.map(({ id, name }) => ({ id, name })),
    build: (party) => forParty({ ...buildDemoScene(hollowVaultMap()).project, fixedParty: true }, party),
  },
];

/** The ids this build's own adventures have: none imported may take one. */
export const BUILT_IN = new Set(ADVENTURES.map((adventure) => adventure.id));

/**
 * Who goes into an adventure: the party that comes - or, into one that keeps its own party (`fixedParty`), whoever
 * leads the party that comes and its own after them, four at most; one of its own of the leader's id stays behind.
 */
export function partyFor<S extends { id: string }>(fixed: boolean, own: readonly S[], party: readonly S[]): S[] {
  if (!fixed) return [...party];
  const lead = party[0];
  return lead === undefined ? own.slice(0, PARTY_MOST) : [lead, ...own.filter((sheet) => sheet.id !== lead.id).slice(0, PARTY_MOST - 1)];
}

/** An adventure, for a party: who goes in it in place of the one it was written with (`partyFor`), their pack listed. */
export function forParty(project: ProjectDoc, party: readonly CharacterSheet[]): ProjectDoc {
  const going = partyFor(project.fixedParty === true, project.party, party);
  return { ...project, party: going.map((sheet) => characterSheetSchema.parse(sheet)), packs: project.packs.includes(PARTY_PACK) ? project.packs : [...project.packs, PARTY_PACK] };
}

/** Every adventure the portal offers: this build's, then those imported, newest first. */
export function adventureChoices(library?: AdventureLibrary): readonly AdventureChoice[] {
  const imported = (library?.list() ?? [])
    .filter((adventure) => !BUILT_IN.has(adventure.id))
    .map((adventure): AdventureChoice => ({
      id: adventure.id,
      name: adventure.name,
      blurb: adventure.blurb,
      imported: true,
      ...ownPartyOf(library!.read(adventure.id)),
      build: (party) => {
        const project = library!.read(adventure.id);
        return project === null ? null : forParty(project, party);
      },
    }));
  return [...ADVENTURES, ...imported];
}

/** An imported adventure's own party, said in the chooser, when it keeps it. */
function ownPartyOf(project: ProjectDoc | null): Pick<AdventureChoice, 'ownParty'> {
  return project?.fixedParty === true ? { ownParty: project.party.map(({ id, name }) => ({ id, name })) } : {};
}

/**
 * At a shared game, the host's own adventures and then those the others offered (`Wire.offer`) - one of an id the host
 * has already is the host's own. An offered one's project is the table's, read once it is begun (`Wire.offered`).
 */
export function withOffers(mine: readonly AdventureChoice[], offers: readonly Offer[]): AdventureChoice[] {
  const theirs = offers
    .filter((offer) => !mine.some((choice) => choice.id === offer.id))
    .map((offer): AdventureChoice => ({ id: offer.id, name: offer.name, blurb: offer.blurb, offeredBy: offer.by.name, ...(offer.ownParty === undefined ? {} : { ownParty: offer.ownParty }), build: () => null }));
  return [...mine, ...theirs];
}

/**
 * An adventure begun by a party: its project with them in it, kept under an id of its own - a second beginning is a
 * second game, its saves its own - and named for whoever leads them. Null when the adventure no longer reads.
 */
export function begunBy(choice: AdventureChoice, party: readonly CharacterSheet[], now: number): ProjectDoc | null {
  const project = choice.build(party);
  if (project === null) return null;
  const lead = party[0]?.name;
  return { ...project, id: `${choice.id}-${now.toString(36)}`, name: lead === undefined ? project.name : `${project.name} (${lead}'s party)` };
}

/**
 * Begin an adventure: kept among the browser's games, and its id - or null, when there is no such adventure, it no
 * longer reads, or there is no room.
 */
export function beginAdventure(games: GameProjects, id: string, party: readonly CharacterSheet[], choices: readonly AdventureChoice[] = ADVENTURES, now: number = Date.now()): string | null {
  const choice = choices.find((adventure) => adventure.id === id);
  if (choice === undefined) return null;
  const project = begunBy(choice, party, now);
  return project !== null && games.write(project) ? project.id : null;
}
