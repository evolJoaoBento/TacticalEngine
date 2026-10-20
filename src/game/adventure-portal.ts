/**
 * The portal at a New Game's camp (`camp.ts`): where an adventure is begun. Used, it opens a window of the adventures
 * this browser has - the Ashwell, which this build writes, and any the player imported (`adventure-library.ts`) - and
 * choosing one begins it as a game of its own, played by the party as it stands at the camp: the character made, and
 * whoever of the company was asked along.
 *
 * The portal is a prop like any other, whose script opens it (`openContainer`); what makes its window a chooser rather
 * than a chest is its id (`ADVENTURE_PORTAL`). Nothing in the rules has to know: the window, and the game begun, are
 * the page's.
 */

import type { CharacterSheet } from '../engine/character/sheet';
import type { ProjectDoc } from '../engine/scene/schema';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { ASHWELL_ID, ashwellProject } from './adventures/ashwell';
import type { AdventureLibrary } from './adventure-library';
import { GameProjects } from './game-projects';

/** The id of the prop whose window is the chooser. */
export const ADVENTURE_PORTAL = 'adventure-portal';

/** The pack the party's characters are made of: an adventure begun lists it, whatever it listed before. */
const PARTY_PACK = 'srd-characters';

/**
 * An adventure the portal offers: what it is called, a line on it, whether it was imported, and the project it is for
 * a party - null when it can no longer be read.
 */
export interface AdventureChoice {
  id: string;
  name: string;
  blurb: string;
  imported?: true;
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
];

/** The ids this build's own adventures have: none imported may take one. */
export const BUILT_IN = new Set(ADVENTURES.map((adventure) => adventure.id));

/** An imported adventure, for a party: the party theirs in place of the one it was written with, its pack listed. */
export function forParty(project: ProjectDoc, party: readonly CharacterSheet[]): ProjectDoc {
  return { ...project, party: party.map((sheet) => characterSheetSchema.parse(sheet)), packs: project.packs.includes(PARTY_PACK) ? project.packs : [...project.packs, PARTY_PACK] };
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
      build: (party) => {
        const project = library!.read(adventure.id);
        return project === null ? null : forParty(project, party);
      },
    }));
  return [...ADVENTURES, ...imported];
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
