/** The Ashwell: Level 4, the Furnace of Names (`docs/ASHWELL.md`) - its rooms, its people, its quest. */

import { sceneSchema, type ProjectDoc, type SceneDoc } from '../../engine/scene/schema';
import type { AdversaryDef } from '../../engine/content/types';
import { conditionDefSchema, type ConditionDef } from '../../engine/content/conditions';
import type { Effect } from '../../engine/script/schema';
import { INDEX_ID, NAVE_ID, GALLERY_ID, HALL_ID, FURNACE_QUEST, ILSE_DIALOGUE, STOKER_ID, SAINT_ID, sceneFromRows, passage, afterTheFight, THRONE_ID, THRONE_QUEST, kindsOf, type Furniture } from './ashwell-kit';

// ---------------------------------------------------------------------------------------------------------------
// Level 4: the Furnace of Names
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where names are smelted: Vane burns the pages of the finished dead to light his halls, and the ash is what the well
 * breathes. Three rooms. The Ash Nave, where nobody fights: the Choir of Ash singing in rows between the pews,
 * Precentor Ilse Grey at their head, and the Furnace Door, too hot to touch. East, the Coal Gallery, where the iron
 * Stokers keep the fires up under the chutes, and the great valve on its platform that would cool the door. Behind the
 * door, the Furnace Hall, the furnace filling its east wall, and the Bellows Saint - and a furnace that will open the
 * stair down for one name, burnt, and one thing its owner remembers.
 */
const NAVE_ROWS = [
  '####################',
  '#...################',
  '#..................#',
  '#..PPPP....PPPP....#',
  '#..................#',
  '#..PPPP....PPPP....#',
  '#..................#',
  '#..PPPP....PPPP....#',
  '#..................#',
  '#..................#',
  '#########.#######..#',
  '#########.#######..#',
  '####################',
];

const NAVE_FURNITURE: Readonly<Record<string, Furniture>> = {
  P: { kind: 'pew', shape: 'block', height: 0.5 },
};

/** A low black gallery: coal chutes in the north corners, heaps of coal, and the valve up on a platform in the south-east. */
const GALLERY_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#FF..........FF#',
  '#.,KK,....,KK,.#',
  '#.,KK,....,KK,.#',
  '#.,,,,....,,,,.#',
  '#..............#',
  '#............^^#',
  '#.........../^^#',
  '################',
];

const GALLERY_FURNITURE: Readonly<Record<string, Furniture>> = {
  F: { kind: 'furnace', shape: 'block', height: 2 },
  K: { kind: 'coal', shape: 'block', height: 0.75 },
};

/** The Furnace Hall: the furnace fills the east wall, floor to ceiling, and the ash lies thick in front of it. */
const HALL_ROWS = [
  '################',
  '#######..#######',
  '#######..#######',
  '#............FF#',
  '#............FF#',
  '#....,,,,,,..FF#',
  '#....,,,,,,..FF#',
  '#............FF#',
  '#............FF#',
  '#............FF#',
  '#######..#######',
  '#######..#######',
  '################',
];

const HALL_FURNITURE: Readonly<Record<string, Furniture>> = {
  F: { kind: 'furnace', shape: 'block', height: 2.5 },
};

/** What the furnace takes with a name: the first of the party loses the first, the second the second, and so on. */
const LOSSES: readonly string[] = [
  'the face of whoever first taught them to hold a sword',
  'the house they grew up in, and the colour of its door',
  'the sound of their mother’s voice',
  'why they ever came down the well',
];

/** Whose name the furnace may take: each of the party the adventure was begun with. */
export type Remembered = readonly { id: string; name: string }[];

/** The choristers along the pews: the Choir of Ash, who go up the well once there is nobody to sing for. */
const CHOIR: readonly [string, number, number][] = [
  ['faun-female', 4, 4], ['fungril-female', 5, 4], ['ribbet-male', 12, 4], ['faerie-male', 13, 4],
  ['faun-male', 4, 6], ['ribbet-female', 13, 6], ['fungril-male', 5, 8], ['faerie-female', 12, 8],
];
const CHORISTERS = CHOIR.map((_, at) => `chorister-${at + 1}`);

/** A chorister, spoken to: singing, and not to be stopped by you - or, told why, silent in the pew. */
const CHORISTER: Effect[] = [
  {
    kind: 'branch',
    when: { kind: 'flag', flag: 'choir-silent' },
    then: [{ kind: 'log', text: 'The chorister sits in the pew with ash-grey hands in their lap, looking at the doors. "Is it true?" they ask, and do not wait for an answer.', tone: 'narration' }],
    otherwise: [{ kind: 'log', text: 'The chorister sings on with their eyes shut. When you touch their sleeve they shake their head, gently, and do not stop.', tone: 'narration' }],
  },
];

/**
 * What Vane's page at the foot of the last stair says the Furnace took: whose name, and what went with it - and, if
 * the Choir went up, that he reads by his own light now.
 */
function whatTheFurnaceTook(party: Remembered): Effect[] {
  return [
    ...party.map((member, at): Effect => ({
      kind: 'branch',
      when: { kind: 'flag', flag: `burnt-${member.id}` },
      then: [{ kind: 'log', text: `Under it, in the same hand: "${member.name} gave the Furnace their name, and with it ${LOSSES[at % LOSSES.length]}. I have kept the page. It is on my desk, if ${member.name} wants it back."`, tone: 'narration' }],
    })),
    { kind: 'branch', when: { kind: 'flag', flag: 'choir-led-up' }, then: [{ kind: 'log', text: 'And under that: "They sent the Choir up the well. I shall have to read by my own light now. I find I do not mind as much as I expected."', tone: 'narration' }] },
  ];
}

/**
 * The Furnace Hall's last stair: shut until a name has been burnt; then, the first time, the end of Level 4 - Vane's
 * page, and whose name it was, the quest done, a level gained - and the way into Level 5, its quest begun; every time
 * after, the way down.
 */
function throneStair(party: Remembered): Effect[] {
  return [
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
            ...whatTheFurnaceTook(party),
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
}

export function nave(): SceneDoc {
  return sceneSchema.parse({
    id: NAVE_ID,
    name: 'The Ash Nave',
    intro: 'A long hall like a chapel, warm as a bread oven. Robed figures grey with ash from hood to hem stand in rows between the pews, singing without words. At the far end, iron doors glow a dull red.',
    light: 0.4,
    ...sceneFromRows(NAVE_ROWS, kindsOf('furnace'), NAVE_FURNITURE),
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
                '"The Saint was a cooper named Oswin Pell. He went in first, to show it did not hurt. It hurt. He is still showing them. He draws on their singing the way the furnace draws on the air."',
              ],
              button: 'Put it back',
            },
            { kind: 'setFlag', flag: 'read-the-pew-page' },
          ],
        },
      },
      ...CHOIR.map(([model, x, y], at) => ({ id: CHORISTERS[at]!, model, position: { x, y }, rotation: 0, solid: true, function: { kind: 'script', object: 'scripted', name: 'A chorister', flavor: 'Grey with ash from hood to hem.', repeatable: true, effects: CHORISTER } })),
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
              // The heat is a hazard, not a wall: whoever tries anyway pays for it.
              otherwise: [
                { kind: 'markStress', amount: 1, target: { kind: 'actor' } },
                { kind: 'log', text: 'You get within an arm’s length and no nearer. The heat comes off the doors like a shove.', tone: 'bad' },
              ],
            },
          ],
        },
      },
      passage('into-the-furnace', 'nave-hall', { x: 9, y: 11 }, 0),
      passage('down-to-the-gallery', 'nave-gallery', { x: 17, y: 11 }, 0),
      { model: 'standing-torch-prop', position: { x: 7, y: 2 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 16, y: 2 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 1, y: 9 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 16, y: 9 }, rotation: 0 },
    ],
  });
}

/** The valve turned: the door cools, and the gallery goes a little darker. */
const TURNED: Effect[] = [
  { kind: 'setFlag', flag: 'valve-turned' },
  { kind: 'completeObjective', quest: FURNACE_QUEST, objective: 'turn-the-valve' },
  { kind: 'log', text: 'The wheel gives, and goes round, and goes on going round. Somewhere ahead, a roar drops to a mutter, and the gallery goes a little darker.', tone: 'good' },
  { kind: 'markUsed' },
];

/**
 * The great valve, once the Stokers are down: a test of strength (Strength 13), tried as often as it takes. With Light
 * it turns; with Shadow it turns and burns the hands that turned it; a failure with Light costs a Stress, and one with
 * Shadow a burn off the chain.
 */
const VALVE: Effect[] = afterTheFight(
  'the-stokers',
  [
    {
      kind: 'check',
      check: {
        trait: 'strength',
        difficulty: 13,
        prompt: 'Turn the great valve',
        onCriticalSuccess: TURNED,
        onSuccessWithGood: TURNED,
        onSuccessWithBad: [{ kind: 'markStress', amount: 1, target: { kind: 'actor' } }, { kind: 'log', text: 'The chain is hot enough to blister. Whoever is on the wheel holds on anyway.', tone: 'bad' }, ...TURNED],
        onFailureWithGood: [{ kind: 'markStress', amount: 1, target: { kind: 'actor' } }, { kind: 'log', text: 'The wheel gives a quarter-turn and sticks. Again, then.', tone: 'bad' }],
        onFailureWithBad: [{ kind: 'damage', dice: '1d6', type: 'magic' }, { kind: 'log', text: 'The wheel will not move, and the chain round it is hot as a skillet. Again, then, with something round the hands.', tone: 'bad' }],
      },
    },
  ],
  'The Stokers will not let you near the wheel.',
).map((effect) =>
  // The wheel stays to be tried again until it turns: only turning it marks it used.
  effect.kind === 'branch' ? { ...effect, then: effect.then.filter((step) => step.kind !== 'markUsed') } : effect,
);

export function gallery(): SceneDoc {
  return sceneSchema.parse({
    id: GALLERY_ID,
    name: 'The Coal Gallery',
    intro: 'A low, black gallery heaped with coal and paper ash. Iron shapes move between the heaps with shovels, feeding chutes that roar. A great wheel-valve stands on a platform at the far end, wrapped in chain.',
    light: 0.25,
    ...sceneFromRows(GALLERY_ROWS, kindsOf('furnace'), GALLERY_FURNITURE),
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
          flavor: 'A wheel the height of a man, wrapped in chain, that feeds the furnace its air. It will take a strong back to turn.',
          repeatable: true,
          effects: VALVE,
        },
      },
      { id: 'chute-fire-west', model: 'camp-fire-prop', position: { x: 3, y: 3 }, rotation: 0, solid: true },
      { id: 'chute-fire-east', model: 'camp-fire-prop', position: { x: 12, y: 3 }, rotation: 0, solid: true },
      { model: 'cart-prop', position: { x: 1, y: 8 }, rotation: 0.4 },
      { model: 'barrel-prop', position: { x: 12, y: 7 }, rotation: 0 },
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

export function hall(party: Remembered): SceneDoc {
  return sceneSchema.parse({
    id: HALL_ID,
    name: 'The Furnace Hall',
    intro: 'The furnace fills one wall, a mouth of white light. Pages go into it on a chain of hooks, one after another, and every one makes the light a little brighter. Before it, working the bellows with both arms, stands a man made of fire, singing.',
    light: 0.6,
    ...sceneFromRows(HALL_ROWS, kindsOf('furnace'), HALL_FURNITURE),
    spawns: [
      { x: 8, y: 1 },
      { x: 8, y: 2 },
    ],
    decos: [
      passage('out-of-the-furnace', 'nave-hall', { x: 7, y: 1 }, Math.PI),
      {
        id: 'name-furnace',
        model: 'camp-fire-prop',
        position: { x: 12, y: 6 },
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
                options: party.map((member, at) => ({
                  label: `${member.name} writes their name.`,
                  effects: [
                    { kind: 'setFlag', flag: 'name-burnt' },
                    { kind: 'setFlag', flag: `burnt-${member.id}` },
                    { kind: 'markStress', amount: 3, target: { kind: 'entity', id: member.id } },
                    { kind: 'log', text: `${member.name} writes, and feeds the page to the fire, and watches it go. Afterwards, ${member.name} cannot remember ${LOSSES[at % LOSSES.length]}.`, tone: 'narration' },
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
        function: { kind: 'script', object: 'portal', name: 'The last stair', flavor: 'A stair going down, barred with iron.', repeatable: true, effects: throneStair(party) },
      },
      { model: 'camp-fire-prop', position: { x: 12, y: 3 }, rotation: 0 },
      { model: 'camp-fire-prop', position: { x: 12, y: 9 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 1, y: 3 }, rotation: 0 },
      { model: 'standing-torch-prop', position: { x: 1, y: 9 }, rotation: 0 },
    ],
    encounters: [
      {
        id: 'the-saint',
        name: 'The Bellows Saint',
        triggerCells: [7, 8].map((x) => ({ x, y: 3 })),
        adversaries: [
          { id: 'oswin-pell', adversary: SAINT_ID, name: 'Oswin Pell, the Bellows Saint', model: 'bandit-captain', position: { x: 10, y: 6 } },
          { id: 'ash-zealot-1', adversary: 'bandit-cutter', name: 'Ash Zealot', position: { x: 3, y: 8 } },
          { id: 'ash-zealot-2', adversary: 'bandit-cutter', name: 'Ash Zealot', position: { x: 11, y: 8 } },
          { id: 'hall-stoker', adversary: STOKER_ID, name: 'Iron Stoker', model: 'hollow-knight', position: { x: 8, y: 9 } },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Its people
// ---------------------------------------------------------------------------------------------------------------

const CHUTE_TEXT = 'Spend a Shadow to make an attack against a creature within Melee range. On a hit, the target takes the attack’s damage and is knocked back to Close range, toward the chutes.';
const BELLOWS_TEXT = 'Reaction: the first time a PC makes an action roll in the Hall, the Saint leans on the bellows and the furnace breathes out. The ground within Close range of him is the Furnace’s Breath until he falls: a creature that comes into it takes 1d6 magic damage.';
const HYMN_TEXT = 'Reaction, three times a scene: when the Saint marks Hit Points, the Choir’s hymn comes through the doors and he clears a Hit Point - unless the Choir has stopped singing.';

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
  features: [{ name: 'Into the Chute', kind: 'action', text: CHUTE_TEXT, costsGmResource: true }],
} as AdversaryDef;

/**
 * Oswin Pell, the Bellows Saint: the first of the Choir to go into the furnace, still burning, still singing. A tier-2
 * solo, and the level's boss. At the party's first roll he breathes the furnace out over the ground round him; and
 * while the Choir sings he draws on it, healing as he is hurt - unless the party told them why they sing.
 */
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
  features: [
    { name: 'The Bellows', kind: 'reaction', text: BELLOWS_TEXT, costsGmResource: false },
    { name: 'The Hymn', kind: 'reaction', text: HYMN_TEXT, costsGmResource: false },
  ],
} as AdversaryDef;

/** The ground the furnace breathes on: whoever comes into it is burnt as they come. */
export const FURNACE_CONDITIONS: ConditionDef[] = [
  conditionDefSchema.parse({
    id: 'furnace-breath',
    name: 'The Furnace’s Breath',
    text: 'The furnace breathes out across the floor: whoever comes into it is burnt as they come.',
    color: '#ff7a2a',
    onEnter: {
      effects: [
        { kind: 'log', text: 'The air by the furnace is like a hand on the face. It burns going in.', tone: 'combat' },
        { kind: 'damage', dice: '1d6', type: 'magic', target: { kind: 'target' } },
      ],
    },
  }),
];

/** The features above that act, as the cards their stat blocks print, and what each does. */
export const LEVEL_FOUR_CARDS: ProjectDoc['cards'] = [
  { id: 'stoker-into-the-chute', name: 'Into the Chute', grant: { kind: 'adversary', adversaries: [STOKER_ID] }, text: CHUTE_TEXT, features: [] },
  { id: 'saint-the-bellows', name: 'The Bellows', grant: { kind: 'adversary', adversaries: [SAINT_ID] }, text: BELLOWS_TEXT, features: [] },
  { id: 'saint-the-hymn', name: 'The Hymn', grant: { kind: 'adversary', adversaries: [SAINT_ID] }, text: HYMN_TEXT, features: [] },
] as ProjectDoc['cards'];

type Ability = ProjectDoc['abilities'][number];

export const LEVEL_FOUR_ABILITIES: ProjectDoc['abilities'] = [
  {
    id: 'stoker-into-the-chute',
    name: 'Into the Chute',
    source: { card: 'stoker-into-the-chute' },
    text: CHUTE_TEXT,
    cost: { bad: 1 },
    target: { kind: 'creature', range: 'melee' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'attack',
        range: 'melee',
        onHit: [
          { kind: 'push', to: 'close', target: { kind: 'hit' } },
          { kind: 'log', text: 'The shovel takes them under the ribs and pitches them toward the chutes.', tone: 'bad' },
        ],
      },
    ],
  } as Ability,
  {
    id: 'saint-the-bellows',
    name: 'The Bellows',
    source: { card: 'saint-the-bellows' },
    text: BELLOWS_TEXT,
    // As the Sexton's bell: a reaction to the party's first roll, which costs the GM nothing and waits for no spotlight.
    kind: 'reaction',
    trigger: 'partyRolled',
    cost: {},
    uses: { count: 1, per: 'scene' },
    target: { kind: 'self' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'Oswin leans his whole weight on the bellows, singing, and the furnace breathes out across the floor.', tone: 'bad' },
      { kind: 'zone', zone: 'the-furnace-breath', name: 'The Furnace’s Breath', condition: 'furnace-breath', at: 'actor', band: 'close', side: 'adversaries', onDeath: 'end' },
    ],
  } as Ability,
  {
    id: 'saint-the-hymn',
    name: 'The Hymn',
    source: { card: 'saint-the-hymn' },
    text: HYMN_TEXT,
    kind: 'reaction',
    trigger: 'tookHitPoints',
    cost: {},
    uses: { count: 3, per: 'scene' },
    target: { kind: 'self' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'branch',
        // Told why they sing, the Choir has stopped: there is nothing coming through the doors for him to draw on.
        when: { kind: 'flag', flag: 'choir-silent' },
        then: [{ kind: 'log', text: 'Oswin lifts his head to listen. The Nave is silent. Nothing comes.', tone: 'good' }],
        otherwise: [
          { kind: 'heal', amount: 1, target: { kind: 'actor' } },
          { kind: 'log', text: 'Through the doors the Choir’s hymn swells, and the fire in him knits where it was broken.', tone: 'bad' },
        ],
      },
    ],
  } as Ability,
];

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
        { text: 'Why do they sing?', available: { kind: 'all', of: [{ kind: 'flag', flag: 'read-the-pew-page' }, { kind: 'not', of: { kind: 'flag', flag: 'choir-silent' } }] }, goto: 'why' },
        { text: 'Oswin Pell has stopped singing.', available: { kind: 'all', of: [{ kind: 'objectiveDone', quest: FURNACE_QUEST, objective: 'the-saint' }, { kind: 'not', of: { kind: 'flag', flag: 'choir-led-up' } }] }, goto: 'after' },
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
      choices: [
        { text: '[Say nothing.]', effects: [{ kind: 'setFlag', flag: 'kept-ilses-secret' }] },
        { text: 'They should know.', goto: 'told' },
      ],
    },
    {
      id: 'told',
      lines: [
        { text: 'You say it to the nearest of them, and he says it to the next. It goes along the pews like a draught. The song thins, and falters, and stops.' },
        { text: 'One by one they sit down. Nobody goes to the doors. Nobody does anything at all.' },
        { speaker: 'Ilse Grey', text: 'There. Now they know what I know. Now they can be as tired as I am.' },
      ],
      onEnter: [{ kind: 'setFlag', flag: 'choir-silent' }],
      choices: [{ text: '[Leave her.]' }],
    },
    {
      id: 'after',
      lines: [
        { text: 'Ilse looks at the doors for the first time. Then she lowers her hand.' },
        { speaker: 'Ilse Grey', text: 'Then there’s nobody to sing for.' },
        { speaker: 'Ilse Grey', text: 'Up, all of you. Up the well. Mind the rope - Ketch will want paying, and she’s owed.' },
      ],
      onEnter: [
        {
          kind: 'branch',
          when: { kind: 'flag', flag: 'kept-ilses-secret' },
          then: [{ kind: 'log', text: 'On the way out she tells them herself, at last, why they sang. Some of them laugh. One of them cries, and is held. They go up singing anyway, for the sake of it.', tone: 'good' }],
          otherwise: [{ kind: 'log', text: 'The Choir get up from the pews without a word and go, the way people leave a church: slowly, and not looking back.', tone: 'good' }],
        },
        { kind: 'setFlag', flag: 'choir-led-up' },
        ...CHORISTERS.map((id): Effect => ({ kind: 'remove', interactable: id })),
      ],
      choices: [{ text: '[Let them go.]' }],
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
