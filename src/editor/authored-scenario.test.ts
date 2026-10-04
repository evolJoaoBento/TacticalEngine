import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, interactableSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { itemSchema, lootTableSchema } from '../engine/content/items';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import {
  EditorSession,
  addAdversary,
  addEncounter,
  addInteractable,
  addItem,
  addLootTable,
  addSheet,
  setSpawns,
  toggleTriggerCell,
  updateInteractable,
  updateSheet,
} from './session';
import { validateProject } from './validate';
import { FIXTURE_ADVERSARIES } from '../../tests/fixtures/adversaries';
import { FIXTURE_CONDITIONS } from '../../tests/fixtures/conditions';
import { buildProjectScene } from '../game/demo-scene';
import { interactablesOf } from '../engine/scene/prop-functions';

/**
 * The question `docs/CRPG-GAPS.md` exists to answer: could someone build a
 * small BG3-like scenario with this and no engine code?
 *
 * This is that question as a test. Nothing here reaches for the demo's
 * literals — no map, no party, no chest. A blank project is built up with the
 * same session edits the editor's panels run, checked with the same validator
 * the **Check** button runs, and then *played*: walk up to a locked door, be
 * refused, open a chest for the key it wanted, and swing at what is waiting.
 *
 * If any step of that ever needs something the editor cannot write, this test
 * is where it will show.
 */

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'sentinel', {
    name: 'Quim',
    traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
    ancestryId: 'human',
    armorId: 'ringmail',
    primaryWeaponId: 'longsword',
    subclassId: 'shieldbearer',
    domainCards: ['power-slash', 'iron-stance'],
  }),
);

/**
 * A blank project with one empty room, which is where a designer starts.
 *
 * The room is small on purpose - a fight in it is over quickly - so a fixture
 * that needs somebody genuinely out of range asks for a bigger one rather than
 * parking them off the board, which is authored scenery and never enters play.
 */
function blank(width = 12, height = 8): EditorSession {
  const session = new EditorSession(
    projectSchema.parse({
      id: 'authored',
      name: 'Authored',
      scenes: [sceneSchema.parse({ ...blankScene('hall', width, height), spawns: [{ x: 1, y: 4 }] })],
      startScene: 'hall',
    }),
  );
  // The stat blocks its fights place. A project that names a creature nobody can
  // look up is a broken document and the engine says so, so the creatures a
  // fixture fights are carried by the fixture — not borrowed from whatever pack
  // the app happens to ship.
  session.project.adversaries.push(...FIXTURE_ADVERSARIES);
  // And the catalogue conditions its fights apply, for the same reason: the engine ships only the
  // three its own rules read.
  session.project.conditionDefs.push(...FIXTURE_CONDITIONS);
  return session;
}

/** Every edit the panels would run, in the order a designer would run them. */
function author(): EditorSession {
  const s = blank();

  // The party.
  s.run(addSheet(KARA));

  // What they can carry, and what a chest gives them.
  s.run(addItem(itemSchema.parse({ id: 'iron-key', name: 'An iron key', kind: 'key', stackable: false })));
  s.run(addLootTable(lootTableSchema.parse({ id: 'strongbox', entries: [{ item: 'iron-key' }] })));

  // A chest that pays out, and a door that wants what it pays.
  s.run(
    addInteractable(
      'hall',
      interactableSchema.parse({
        id: 'strongbox',
        kind: 'chest',
        position: { x: 3, y: 4 },
        name: 'A strongbox',
        effects: [
          { kind: 'log', text: 'The lid gives.' },
          { kind: 'loot', table: 'strongbox' },
          { kind: 'open' },
        ],
      }),
    ),
  );
  s.run(
    addInteractable(
      'hall',
      interactableSchema.parse({
        id: 'iron-door',
        kind: 'door',
        position: { x: 6, y: 4 },
        name: 'An iron door',
        requiresKey: 'iron-key',
        lockedText: 'The lock will not turn without its key.',
        effects: [{ kind: 'log', text: 'The door swings wide.' }, { kind: 'open' }],
      }),
    ),
  );

  // Something waiting past it, and the cell that wakes it.
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'ambush', name: 'An ambush' })));
  s.run(addAdversary('hall', 'ambush', { id: 'foe-1', adversary: 'fixture-foe', position: { x: 8, y: 4 } }));
  s.run(toggleTriggerCell('hall', 'ambush', { x: 7, y: 4 }));
  s.run(setSpawns('hall', [{ x: 1, y: 4 }]));

  return s;
}

describe('a scenario built with nothing but the editor', () => {
  it('passes the validator the Check button runs', () => {
    expect(validateProject(author().project)).toEqual([]);
  });

  it('refuses to stand up a room that places a creature nobody can look up', () => {
    const s = author();
    s.project.scenes[0]!.encounters[0]!.adversaries[0]!.adversary = 'goblin-warror';
    expect(() => buildProjectScene(s.project)).toThrow(/goblin-warror/);
    // And the validator says the same thing before it is ever played.
    expect(
      validateProject(s.project, { knownAdversaries: new Set(['fixture-foe']) })
        .map((p) => p.message)
        .join(' '),
    ).toContain('goblin-warror');
  });

  it('reports what a half-finished scenario is missing', () => {
    const s = blank();
    s.run(addSheet(KARA));
    s.run(
      addInteractable(
        'hall',
        interactableSchema.parse({ id: 'iron-door', kind: 'door', position: { x: 6, y: 4 }, requiresKey: 'iron-key' }),
      ),
    );
    // A door wanting a key nobody wrote yet: an error with the id in it.
    expect(validateProject(s.project).map((p) => p.message).join(' ')).toContain('iron-key');

    // And once the item exists, it is quiet again.
    s.run(addItem(itemSchema.parse({ id: 'iron-key', name: 'An iron key', kind: 'key' })));
    expect(validateProject(s.project)).toEqual([]);
  });

  it('lets an edit made after the fact reach a game built from the document', () => {
    const session = author();
    session.run(updateSheet('kara', { name: 'Quim the Unmoved' }));
    session.run(updateInteractable('hall', 'iron-door', { name: 'A rusted door' }));

    const demo = buildProjectScene(session.project, 'authored');
    expect(demo.sheets.get('kara')!.name).toBe('Quim the Unmoved');
    expect(interactablesOf(demo.scene).find((i) => i.id === 'iron-door')!.name).toBe('A rusted door');
  });
});
