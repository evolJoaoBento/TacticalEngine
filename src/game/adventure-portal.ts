/**
 * The portal at a New Game's camp (`camp.ts`): where an adventure is begun. Used, it opens a window of the adventures
 * this browser has - the Ashwell, which this build writes - and choosing one begins it as a game of its own, played by
 * the party as it stands at the camp: the character made, and whoever of the company was asked along.
 *
 * The portal is a prop like any other, whose script opens it (`openContainer`); what makes its window a chooser rather
 * than a chest is its id (`ADVENTURE_PORTAL`). Nothing in the rules has to know: the window, and the game begun, are
 * the page's.
 */

import type { CharacterSheet } from '../engine/character/sheet';
import type { ProjectDoc } from '../engine/scene/schema';
import { ASHWELL_ID, ashwellProject } from './adventures/ashwell';
import { GameProjects } from './game-projects';

/** The id of the prop whose window is the chooser. */
export const ADVENTURE_PORTAL = 'adventure-portal';

/** An adventure the portal offers: what it is called, a line on it, and the project it is for a party. */
export interface AdventureChoice {
  id: string;
  name: string;
  blurb: string;
  build(party: readonly CharacterSheet[]): ProjectDoc;
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

/** Every adventure the portal offers. */
export function adventureChoices(): readonly AdventureChoice[] {
  return ADVENTURES;
}

/**
 * An adventure begun by a party: its project with them in it, kept under an id of its own - a second beginning is a
 * second game, its saves its own - and named for whoever leads them.
 */
export function begunBy(choice: AdventureChoice, party: readonly CharacterSheet[], now: number): ProjectDoc {
  const project = choice.build(party);
  const lead = party[0]?.name;
  return { ...project, id: `${choice.id}-${now.toString(36)}`, name: lead === undefined ? project.name : `${project.name} (${lead}'s party)` };
}

/** Begin an adventure: kept among the browser's games, and its id - or null, when there is no such adventure or no room. */
export function beginAdventure(games: GameProjects, id: string, party: readonly CharacterSheet[], now: number = Date.now()): string | null {
  const choice = adventureChoices().find((adventure) => adventure.id === id);
  if (choice === undefined) return null;
  const project = begunBy(choice, party, now);
  return games.write(project) ? project.id : null;
}
