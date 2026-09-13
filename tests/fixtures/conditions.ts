import { conditionDefSchema, type ConditionDef } from '../../src/engine/content/conditions';

/**
 * Conditions a catalogue carries, which the engine no longer ships.
 *
 * The engine keeps only the three its own rules read -- Vulnerable, Hidden and Restrained. Every
 * other condition travels with the pack whose card or stat block applies it. These are the ones the
 * tests play: each is here for the rule it exercises (a block, an ending, a die on any roll, an
 * immunity), under the id the tests always used, so a test builds its world with them the way a
 * project that imported the catalogue would.
 */
const RAW = [
  // Disadvantage on the bearer's own attacks, carried to any target.
  {
    id: 'chilled',
    name: 'Chilled',
    text: 'While Chilled, you have disadvantage on attack rolls.',
    modifiers: [{ stat: 'advantage', bonus: -1 }],
  },
  // Vulnerable is "all rolls targeting you", so `anyRoll`: a Spellcast Roll aimed at somebody
  // Horrified takes the die as surely as a swing does. In Shadow says "attack rolls" and stays
  // without it.
  {
    id: 'horrified',
    name: 'Horrified',
    text: 'What you are looking at cannot be looked away from. You are Vulnerable.',
    modifiers: [{ stat: 'advantage', bonus: 1, against: true, anyRoll: true }],
  },
  {
    id: 'in-shadow',
    name: 'In Shadow',
    text: 'Attack rolls have disadvantage when targeting you.',
    color: '#5a4b8a',
    modifiers: [{ stat: 'advantage', bonus: -1, against: true }],
  },
  // Nothing until damage or a Shadow clears it.
  {
    id: 'asleep',
    name: 'Asleep',
    text: 'Asleep until you take damage or the GM spends a Shadow to clear it.',
    blocks: ['act', 'move'],
    endsWhen: 'damaged',
  },
  {
    id: 'stunned',
    name: 'Stunned',
    text: "You can't use reactions and can't take any other actions until you clear this condition.",
    blocks: ['act', 'reactions'],
  },
  // Ends on whatever they roll next -- not the next thing they swing at.
  {
    id: 'inevitable',
    name: 'Inevitable',
    text: 'Your next action roll has advantage.',
    modifiers: [{ stat: 'advantage', bonus: 1, anyRoll: true }],
    endsWhen: 'rolls',
  },
  // Waiting on the swing it was declared for.
  {
    id: 'strategic-advantage',
    name: 'Strategic Approach',
    text: 'You have picked your line: your next attack is made with advantage.',
    modifiers: [{ stat: 'advantage', bonus: 1 }],
    endsWhen: 'attacks',
  },
  {
    id: 'magic-immune',
    name: 'Immune to Magic',
    text: 'Magic damage does nothing to you until your next rest.',
    defenses: { immunities: ['magic'] },
  },
  // Nothing but the stillness: what ends it is written on the card that cast it.
  {
    id: 'time-stopped',
    name: 'Stopped in Time',
    text: 'Time is not moving for you. You can do nothing at all until it starts again.',
    blocks: ['act', 'move', 'reactions'],
  },
  // On the one who stopped the room, so the card that restarts it knows there is a room stopped.
  {
    id: 'time-jamming',
    name: 'Timejammer',
    text: 'Time is held still around you, and your next action roll lets it go.',
  },
];

export const FIXTURE_CONDITIONS: readonly ConditionDef[] = RAW.map((def) => conditionDefSchema.parse(def));
