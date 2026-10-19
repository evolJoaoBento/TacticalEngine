/** The Ashwell: Level 4, the Furnace of Names (`docs/ASHWELL.md`) - its rooms, its people, its quest. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import type { Effect } from '../../engine/script/schema';
import { INDEX_ID, NAVE_ID, GALLERY_ID, HALL_ID, FURNACE_QUEST, ILSE_DIALOGUE, STOKER_ID, SAINT_ID, sceneFromRows, passage, afterTheFight, THRONE_ID, THRONE_QUEST } from './ashwell-kit';

// ---------------------------------------------------------------------------------------------------------------
// Level 4: the Furnace of Names
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where names are smelted: Vane burns the pages of the finished dead to light his halls, and the ash is what the well
 * breathes. Three rooms. The Ash Nave, where nobody fights: the Choir of Ash singing in rows, Precentor Ilse Grey at
 * their head, and the Furnace Door, too hot to touch. East, the Coal Gallery, where the iron Stokers keep the fires up
 * and the great valve that would cool the door. Behind the door, the Furnace Hall and the Bellows Saint - and a furnace
 * that will open the stair down for one name, burnt, and one thing its owner remembers.
 */
const NAVE_ROWS = [
  '####################',
  '#...################',
  '#..................#',
  '#..cccc....cccc....#',
  '#..................#',
  '#..cccc....cccc....#',
  '#..................#',
  '#..cccc....cccc....#',
  '#..................#',
  '#..................#',
  '#########.#######..#',
  '#########.#######..#',
  '####################',
];

const GALLERY_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#..............#',
  '#.,,,,....,,,,.#',
  '#.,cc,....,cc,.#',
  '#.,,,,....,,,,.#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

const HALL_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#..............#',
  '#..............#',
  '#....,,,,,,....#',
  '#....,,,,,,....#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#######..#######',
  '#######..#######',
  '################',
];

/** Who the furnace may take: each of the company, and the one thing the fire takes with their name. */
const REMEMBERED: readonly { id: string; name: string; loses: string }[] = [
  { id: 'kara', name: 'Quim', loses: 'the face of whoever first taught them to hold a sword' },
  { id: 'finn', name: 'Violet', loses: 'the house they grew up in, and the colour of its door' },
  { id: 'mira', name: 'Scarlet', loses: 'the sound of their mother’s voice' },
  { id: 'arty', name: 'Arty', loses: 'why they ever came down the well' },
];

/**
 * The Furnace Hall's last stair: shut until a name has been burnt; then, the first time, the end of Level 4 - Vane's
 * page, the quest done, a level gained - and the way into Level 5, its quest begun; every time after, the way down.
 */
const THRONE_STAIR: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'name-burnt' },
    then: [
      {
        kind: 'branch',
        when: { kind: 'flag', flag: 'level-4-done' },
        then: [{ kind: 'goto', scene: THRONE_ID }],
        otherwise: [
          { kind: 'completeObjective', quest: FURNACE_QUEST, objective: 'burn-a-name' },
          {
            kind: 'story',
            title: 'Entry 11,040',
            paragraphs: [
              'Past the furnace the stair is warm and dry, and lamplit, and quiet. At the bottom is a door of plain wood with a plain brass handle, and a page pinned to it.',
              '"They have given the Furnace a name, and it has given them the stair. I have been eleven thousand and forty entries without anyone reaching this door. I find I am nervous. I have tidied. Come in."',
            ],
            button: 'Open the door',
          },
          { kind: 'completeQuest', quest: FURNACE_QUEST },
          { kind: 'levelUp' },
          { kind: 'setFlag', flag: 'level-4-done' },
          { kind: 'startQuest', quest: THRONE_QUEST },
          { kind: 'completeObjective', quest: THRONE_QUEST, objective: 'reach-the-throne' },
          { kind: 'goto', scene: THRONE_ID },
        ],
      },
    ],
    otherwise: [{ kind: 'log', text: 'The stair is barred with white-hot iron. The Furnace has not been fed.', tone: 'bad' }],
  },
];

export function nave(): SceneDoc {
  // The Choir of Ash, along the pews.
  const choir: readonly [string, number, number][] = [
    ['faun-female', 4, 4], ['fungril-female', 5, 4], ['ribbet-male', 12, 4], ['faerie-male', 13, 4],
    ['faun-male', 4, 6], ['ribbet-female', 13, 6], ['fungril-male', 5, 8], ['faerie-female', 12, 8],
  ];
  return sceneSchema.parse({
    id: NAVE_ID,
    name: 'The Ash Nave',
    intro: 'A long hall like a chapel, warm as a bread oven. Robed figures grey with ash from hood to hem stand in rows between the pews, singing without words. At the far end, iron doors glow a dull red.',
    ...sceneFromRows(NAVE_ROWS),
    spawns: [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 1 },
    ],
    decos: [
      {
        id: 'sealed-stair-up',
        model: 'stone-stairs',
        position: { x: 2, y: 1 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The paper stair', flavor: 'Up, through the torn paper seal, to the Index.', repeatable: true, effects: [{ kind: 'goto', scene: INDEX_ID }] },
      },
      {
        id: 'fourth-page',
        model: 'banner-prop',
        position: { x: 1, y: 6 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'scripted',
          name: 'A page, on the end of a pew',
          flavor: 'A page tucked into the hymn-rack at the end of a pew, where a hymn sheet would go.',
          effects: [
            {
              kind: 'story',
              title: 'Entry 10,998',
              paragraphs: [
                '"The Choir sing because the ones who sing are not burnt. Ilse has not told them that. Ilse knows exactly what she is doing, and I have filed her under kindness, which is not what she would choose."',
                '"The Saint was a cooper named Oswin Pell. He went in first, to show it did not hurt. It hurt. He is still showing them."',
              ],
              button: 'Put it back',
            },
            { kind: 'setFlag', flag: 'read-the-pew-page' },
          ],
        },
      },
      ...choir.map(([model, x, y], at) => ({ id: `chorister-${at + 1}`, model, position: { x, y }, rotation: 0, solid: true })),
      { id: 'ilse-grey', model: 'wandering-hedge-priest', position: { x: 8, y: 9 }, rotation: 0, solid: true, function: { kind: 'interaction', dialogue: ILSE_DIALOGUE } },
      {
        id: 'furnace-door',
        model: 'door-prop',
        position: { x: 9, y: 10 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'door',
          name: 'The Furnace Door',
          flavor: 'Iron doors, red at the hinges. The air in front of them shivers.',
          repeatable: true,
          effects: [
            {
              kind: 'branch',
              when: { kind: 'flag', flag: 'valve-turned' },
              then: [{ kind: 'log', text: 'The iron has gone dark. It is hot still, but it is only hot. The doors grind open.', tone: 'good' }, { kind: 'remove' }],
              otherwise: [{ kind: 'log', text: 'You get within an arm’s length and no nearer. The heat comes off the doors like a shove.', tone: 'bad' }],
            },
          ],
        },
      },
      passage('into-the-furnace', 'nave-hall', { x: 9, y: 11 }, 0),
      passage('down-to-the-gallery', 'nave-gallery', { x: 17, y: 11 }, 0),
      { model: 'standing-torch-prop', position: { x: 7, y: 2 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 16, y: 2 }, rotation: 0 },
    ],
  });
}

export function gallery(): SceneDoc {
  return sceneSchema.parse({
    id: GALLERY_ID,
    name: 'The Coal Gallery',
    intro: 'A low, black gallery heaped with coal and paper ash. Iron shapes move between the heaps with shovels, feeding chutes that roar. A great wheel-valve stands at the far end, wrapped in chain.',
    ...sceneFromRows(GALLERY_ROWS),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
    ],
    decos: [
      passage('up-from-the-gallery', 'nave-gallery', { x: 7, y: 1 }, Math.PI),
      {
        id: 'great-valve',
        model: 'pillar-prop',
        position: { x: 14, y: 9 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'scripted',
          name: 'The great valve',
          flavor: 'A wheel the height of a man, wrapped in chain, that feeds the furnace its air.',
          repeatable: true,
          effects: afterTheFight(
            'the-stokers',
            [
              { kind: 'setFlag', flag: 'valve-turned' },
              { kind: 'completeObjective', quest: FURNACE_QUEST, objective: 'turn-the-valve' },
              { kind: 'log', text: 'It takes all of you to turn it. Somewhere ahead, a roar drops to a mutter, and the gallery goes a little darker.', tone: 'good' },
            ],
            'The Stokers will not let you near the wheel.',
          ),
        },
      },
      { model: 'cart-prop', position: { x: 1, y: 8 }, rotation: 0.4 },
      { model: 'barrel-prop', position: { x: 14, y: 3 }, rotation: 0 },
    ],
    encounters: [
      {
        id: 'the-stokers',
        name: 'The Stokers',
        triggerCells: [7, 8].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'iron-stoker-1', adversary: STOKER_ID, name: 'Iron Stoker', model: 'hollow-knight', position: { x: 4, y: 8 } },
          { id: 'iron-stoker-2', adversary: STOKER_ID, name: 'Iron Stoker', model: 'hollow-knight', position: { x: 11, y: 8 } },
          { id: 'cinder-moths', adversary: 'grave-moth', name: 'Cinder Moths', position: { x: 8, y: 6 } },
        ],
      },
    ],
  });
}

export function hall(): SceneDoc {
  return sceneSchema.parse({
    id: HALL_ID,
    name: 'The Furnace Hall',
    intro: 'The furnace fills one wall, a mouth of white light. Pages go into it on a chain of hooks, one after another, and every one makes the light a little brighter. Before it, working the bellows with both arms, stands a man made of fire, singing.',
    ...sceneFromRows(HALL_ROWS),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
    ],
    decos: [
      passage('out-of-the-furnace', 'nave-hall', { x: 7, y: 1 }, Math.PI),
      {
        id: 'name-furnace',
        model: 'camp-fire-prop',
        position: { x: 12, y: 5 },
        rotation: 0,
        solid: true,
        function: {
          kind: 'script',
          object: 'scripted',
          name: 'The Name Furnace',
          flavor: 'A hatch in the furnace’s side, and beside it a blank page and a pen, waiting.',
          repeatable: true,
          effects: afterTheFight(
            'the-saint',
            [
              { kind: 'completeObjective', quest: FURNACE_QUEST, objective: 'the-saint' },
              { kind: 'revealObjective', quest: FURNACE_QUEST, objective: 'burn-a-name' },
              {
                kind: 'choice',
                title: 'The Name Furnace',
                body: 'The stair down will open for one name, written on the blank page and fed to the fire. Whoever’s it is will lose something with it.',
                options: REMEMBERED.map((member) => ({
                  label: `${member.name} writes their name.`,
                  effects: [
                    { kind: 'setFlag', flag: 'name-burnt' },
                    { kind: 'setFlag', flag: `burnt-${member.id}` },
                    { kind: 'markStress', amount: 3, target: { kind: 'entity', id: member.id } },
                    { kind: 'log', text: `${member.name} writes, and feeds the page to the fire, and watches it go. Afterwards, ${member.name} cannot remember ${member.loses}.`, tone: 'narration' },
                  ],
                })),
              },
            ],
            'The Saint stands between you and the furnace, singing.',
          ),
        },
      },
      {
        id: 'throne-stair',
        model: 'stone-stairs',
        position: { x: 7, y: 11 },
        rotation: 0,
        solid: true,
        function: { kind: 'script', object: 'portal', name: 'The last stair', flavor: 'A stair going down, barred with iron.', repeatable: true, effects: THRONE_STAIR },
      },
      { model: 'standing-torch-prop', position: { x: 1, y: 3 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 14, y: 3 }, rotation: 0 },
    ],
    encounters: [
      {
        id: 'the-saint',
        name: 'The Bellows Saint',
        triggerCells: [7, 8].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'oswin-pell', adversary: SAINT_ID, name: 'Oswin Pell, the Bellows Saint', model: 'bandit-captain', position: { x: 7, y: 7 } },
          { id: 'ash-zealot-1', adversary: 'bandit-cutter', name: 'Ash Zealot', position: { x: 3, y: 8 } },
          { id: 'ash-zealot-2', adversary: 'bandit-cutter', name: 'Ash Zealot', position: { x: 12, y: 8 } },
          { id: 'hall-stoker', adversary: STOKER_ID, name: 'Iron Stoker', model: 'hollow-knight', position: { x: 8, y: 9 } },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Its people
// ---------------------------------------------------------------------------------------------------------------

/** The iron Stokers: furnace-hands of riveted plate, made to keep the fires up and nothing else. A tier-2 bruiser. */
export const IRON_STOKER: AdversaryDef = {
  id: STOKER_ID,
  name: 'Iron Stoker',
  tier: 2,
  role: 'bruiser',
  description: 'A hunched shape of riveted iron plates, hot to the touch, with a coal shovel where one hand should be.',
  motivesAndTactics: 'Keep the fires fed. Shovel whoever is in the way into the chute. Do not stop.',
  difficulty: 14,
  thresholds: { major: 10, severe: 20 },
  hitPoints: 7,
  stress: 3,
  attackName: 'Coal Shovel',
  attackModifier: { count: 0, sides: 0, modifier: 3 },
  attackRange: 'melee',
  attackDamage: { count: 1, sides: 12, modifier: 3, types: ['physical'] },
  experiences: [],
  features: [],
} as AdversaryDef;

/** Oswin Pell, the Bellows Saint: the first of the Choir to go into the furnace, still burning, still singing. A tier-2 solo, and the level's boss. */
export const BELLOWS_SAINT: AdversaryDef = {
  id: SAINT_ID,
  name: 'Bellows Saint',
  tier: 2,
  role: 'solo',
  description: 'A big man made of fire, his shape kept by habit. He works the furnace bellows with both arms and sings while he does it.',
  motivesAndTactics: 'Keep the furnace breathing. Embrace whoever comes near, kindly, and hold on. Sing louder.',
  difficulty: 16,
  thresholds: { major: 13, severe: 26 },
  hitPoints: 10,
  stress: 5,
  attackName: 'Burning Embrace',
  attackModifier: { count: 0, sides: 0, modifier: 4 },
  attackRange: 'veryClose',
  attackDamage: { count: 2, sides: 10, modifier: 2, types: ['magic'] },
  experiences: [{ name: 'Has burnt before', modifier: 3 }],
  features: [],
} as AdversaryDef;

export const ILSE: ProjectDoc['dialogues'][number] = {
  id: ILSE_DIALOGUE,
  start: 'choir',
  nodes: [
    {
      id: 'choir',
      lines: [
        { text: 'A woman stands before the choir with her back to the doors, conducting with a burnt hand. The song has no tune you can hold. When she turns, her face is kind.' },
        { speaker: 'Ilse Grey', text: 'You’re early. Sit and listen a while. By the end of the hymn you’ll want to go in. Everybody does.' },
      ],
      choices: [
        { text: 'What is the Furnace?', goto: 'furnace' },
        { text: 'Who is the Saint?', goto: 'saint' },
        { text: 'The doors are too hot to touch.', available: { kind: 'not', of: { kind: 'flag', flag: 'valve-turned' } }, goto: 'valve' },
        { text: 'Why do they sing?', available: { kind: 'flag', flag: 'read-the-pew-page' }, goto: 'why' },
        { text: '[Leave the choir to its hymn.]' },
      ],
    },
    {
      id: 'furnace',
      lines: [
        { speaker: 'Ilse Grey', text: 'Where the finished go. He reads the last line, and the page goes in, and the light it makes is the light he reads the next one by.' },
        { speaker: 'Ilse Grey', text: 'The ash goes up the well. Your town has been breathing its dead all winter and calling it weather.' },
      ],
      choices: [
        { text: 'Who is the Saint?', goto: 'saint' },
        { text: 'The doors are too hot to touch.', available: { kind: 'not', of: { kind: 'flag', flag: 'valve-turned' } }, goto: 'valve' },
        { text: '[Leave the choir to its hymn.]' },
      ],
    },
    {
      id: 'saint',
      lines: [
        { speaker: 'Ilse Grey', text: 'Oswin Pell. A cooper, up in the town. He went in first, to show the rest of us it didn’t hurt.' },
        { speaker: 'Ilse Grey', text: 'He works the bellows now. He sings. He’s very happy.' },
        { text: 'She does not look at the doors when she says it.' },
      ],
      choices: [
        { text: 'The doors are too hot to touch.', available: { kind: 'not', of: { kind: 'flag', flag: 'valve-turned' } }, goto: 'valve' },
        { text: '[Leave the choir to its hymn.]' },
      ],
    },
    {
      id: 'valve',
      lines: [
        { speaker: 'Ilse Grey', text: 'The Stokers keep the fires up, in the Coal Gallery, and the fires keep the doors hot. There’s a great valve at the end of the gallery. Turn it, and the doors will cool enough for flesh.' },
        { speaker: 'Ilse Grey', text: 'The Stokers won’t like it. They don’t like anything. They were made not to.' },
      ],
      onEnter: [{ kind: 'completeObjective', quest: FURNACE_QUEST, objective: 'hear-the-choir' }],
      choices: [{ text: '[Go to the gallery.]' }],
    },
    {
      id: 'why',
      lines: [
        { speaker: 'Ilse Grey', text: 'Because he doesn’t burn the ones who are singing. He likes to listen.' },
        { text: 'She turns back to the choir and lifts her hand, and they go on.' },
        { speaker: 'Ilse Grey', text: 'Don’t tell them. Please. They’re so tired.' },
      ],
      choices: [{ text: '[Say nothing.]' }],
    },
  ],
} as ProjectDoc['dialogues'][number];

export const FURNACE_QUEST_DEF: ProjectDoc['quests'][number] = {
  id: FURNACE_QUEST,
  name: 'The Furnace of Names',
  summary: 'Below the Library, Vane burns the pages of the finished dead to light his halls. The ash is what the well breathes. The last stair is past the furnace.',
  objectives: [
    { id: 'reach-the-furnace', text: 'Go down through the paper seal into the Furnace.', hidden: false, summary: 'You came down into the heat.' },
    { id: 'hear-the-choir', text: 'Find a way through the Furnace Door.', hidden: false, summary: 'The Stokers keep the doors hot. There is a valve.' },
    { id: 'turn-the-valve', text: 'Turn the great valve in the Coal Gallery.', hidden: false, summary: 'The doors have cooled enough for flesh.' },
    { id: 'the-saint', text: 'Get past the Bellows Saint.', hidden: false, summary: 'Oswin Pell has stopped singing.' },
    { id: 'burn-a-name', text: 'Feed the Name Furnace a name.', hidden: true, summary: 'The stair opened for a name, and took something with it.' },
  ],
};
