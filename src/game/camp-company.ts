/**
 * The company at a New Game's camp fire (`camp.ts`): six who will come along if asked. Each is a character made as
 * the player's is - an SRD class, subclass, ancestry and community, two of the class's level-1 domain cards, the
 * class's traits and gear (`sheetFor`) - drawn with the model they stand round the fire in, and kept in the project
 * as a companion (`project.companions`). Talking to one is a short conversation whose "Come with us" takes them into
 * the party (`joinParty`) and their figure away from the fire; four is a party, and a fifth asked stays where they
 * are (`game/party_join.rs`).
 *
 * The engine's own characters, written for this project; their words are its own too.
 */

import type { CharacterSheet } from '../engine/character/sheet';
import type { ProjectDoc } from '../engine/scene/schema';
import { sheetFor, type Creation } from './new-character';

/** One of the company: who they are, what they say of themselves, and what they would say they do. */
interface Companion {
  creation: Creation;
  /** What they say when they look up from the fire. */
  greeting: string;
  /** What they say when asked what they can do. */
  can: string;
}

/** The company, by the model each is drawn with (`CAMP_CREW` in `camp.ts`). */
export const COMPANIONS: readonly Companion[] = [
  {
    creation: { name: 'Quim', model: 'quim', ancestryId: 'dwarf', communityId: 'ridgeborne', classId: 'guardian', subclassId: 'stalwart', domainCards: ['i-am-your-shield', 'not-good-enough'] },
    greeting: 'You look like somebody about to walk into something. I could walk in first.',
    can: 'I hold the line. You stand behind me, and you stay standing. That is the whole of it.',
  },
  {
    creation: { name: 'Violet', model: 'violet', ancestryId: 'elf', communityId: 'slyborne', classId: 'rogue', subclassId: 'nightwalker', domainCards: ['rain-of-blades', 'deft-deceiver'] },
    greeting: 'Whatever you are after, it is behind a door. Doors are what I do.',
    can: 'Locks, purses, the backs of things that are watching you. In about that order.',
  },
  {
    creation: { name: 'Scarlet', model: 'scarlet', ancestryId: 'human', communityId: 'loreborne', classId: 'wizard', subclassId: 'school-of-war', domainCards: ['book-of-illiat', 'bolt-beacon'] },
    greeting: 'I have read about places like the one you are going. Most of the books end early.',
    can: 'I read the books so that you do not have to. Some of what is in them burns.',
  },
  {
    creation: { name: 'Arty', model: 'arty', ancestryId: 'halfling', communityId: 'wanderborne', classId: 'ranger', subclassId: 'wayfinder', domainCards: ['vicious-entangle', 'i-see-it-coming'] },
    greeting: 'Going somewhere? I have been everywhere, near enough. Somewhere new would make a change.',
    can: 'Point me at it. It will be down before it is close enough to bother you.',
  },
  {
    creation: { name: 'Pint', model: 'pint', ancestryId: 'galapa', communityId: 'orderborne', classId: 'seraph', subclassId: 'divine-wielder', domainCards: ['mending-touch', 'bare-bones'] },
    greeting: 'Somebody ought to go with you who knows how to close a wound. It might as well be me.',
    can: 'I keep people breathing. And I carry an axe, for the things that would rather they did not.',
  },
  {
    creation: { name: 'Ganja', model: 'ganja', ancestryId: 'orc', communityId: 'wildborne', classId: 'warrior', subclassId: 'call-of-the-brave', domainCards: ['whirlwind', 'untouchable'] },
    greeting: 'You smell like a fight that has not happened yet. I would like to be there when it does.',
    can: 'Big thing, small thing: I hit it until it stops. Then I hit the next one.',
  },
];

/** The figure that stands for a companion at the fire: taken away when they join. */
export const figureOf = (model: string): string => `${model}-figure`;

/** The conversation one of the company is asked along in. */
export const companionDialogue = (id: string): string => `camp-${id}`;

/**
 * The company for a camp whose character is the one given: everyone but whoever has that character's model - nobody
 * meets their twin at the fire - or their id.
 */
export function companyFor(sheet: Pick<CharacterSheet, 'id' | 'model'>): { sheet: CharacterSheet; companion: Companion }[] {
  return COMPANIONS.map((companion) => ({ sheet: sheetFor(companion.creation), companion })).filter(
    ({ sheet: theirs, companion }) => companion.creation.model !== sheet.model && theirs.id !== sheet.id,
  );
}

/** A companion's conversation at the fire: who they are, what they can do, and whether they come. */
export function companionConversation(sheet: CharacterSheet, companion: Companion): ProjectDoc['dialogues'][number] {
  const name = sheet.name;
  const join = { text: 'Come with us.', detail: 'They join the party: four at most.', effects: [{ kind: 'joinParty' as const, companion: sheet.id, figure: figureOf(companion.creation.model) }] };
  return {
    id: companionDialogue(sheet.id),
    start: 'met',
    nodes: [
      {
        id: 'met',
        lines: [
          { text: `${name} looks up from the fire.` },
          { speaker: name, text: companion.greeting },
        ],
        choices: [join, { text: 'What can you do?', goto: 'can' }, { text: 'Not yet.' }],
      },
      {
        id: 'can',
        lines: [{ speaker: name, text: companion.can }],
        choices: [join, { text: 'Not yet.' }],
      },
    ],
  };
}
