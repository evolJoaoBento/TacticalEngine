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
import {
  attackWithSelected,
  answerPending,
  buildProjectScene,
  moveSelectedTo,
  useSelectedOn,
} from '../game/demo-scene';

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
  blankSheet('kara', 'guardian', {
    name: 'Kara',
    traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
    ancestryId: 'human',
    armorId: 'chainmail-armor',
    primaryWeaponId: 'broadsword',
    subclassId: 'stalwart',
    domainCards: ['bare-bones', 'get-back-up'],
  }),
);

/** A blank project with one empty room, which is where a designer starts. */
function blank(): EditorSession {
  return new EditorSession(
    projectSchema.parse({
      id: 'authored',
      name: 'Authored',
      scenes: [sceneSchema.parse({ ...blankScene('hall', 12, 8), spawns: [{ x: 1, y: 4 }] })],
      startScene: 'hall',
    }),
  );
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
  s.run(addAdversary('hall', 'ambush', { id: 'burrower-1', adversary: 'acid-burrower', position: { x: 8, y: 4 } }));
  s.run(toggleTriggerCell('hall', 'ambush', { x: 7, y: 4 }));
  s.run(setSpawns('hall', [{ x: 1, y: 4 }]));

  return s;
}

describe('a scenario built with nothing but the editor', () => {
  it('passes the validator the Check button runs', () => {
    expect(validateProject(author().project)).toEqual([]);
  });

  it('plays: a locked door, the chest that answers it, and a fight past it', () => {
    const session = author();
    const demo = buildProjectScene(session.project, 'authored');

    // The party is the one the panel wrote, standing where the spawn says.
    expect([...demo.sheets.keys()]).toEqual(['kara']);
    expect(demo.party.selected).toBe('kara');
    const kara = demo.state.entity('kara')!;
    expect(demo.grid.xOf(kara.tile)).toBe(1);

    // The door refuses, in the words the panel wrote.
    demo.state.moveEntity('kara', demo.grid.indexOf(5, 4));
    const refused = useSelectedOn(demo, 'iron-door');
    expect(refused.lines.map((l) => l.text).join(' ')).toContain('will not turn');
    expect(demo.world.interactableState('iron-door').open).toBe(false);

    // The chest pays out the key the door wanted.
    demo.state.moveEntity('kara', demo.grid.indexOf(2, 4));
    useSelectedOn(demo, 'strongbox');
    if (demo.pending !== null) answerPending(demo, { kind: 'roll' });
    expect(demo.world.hasItem('iron-key')).toBe(true);

    // And now it opens.
    demo.state.moveEntity('kara', demo.grid.indexOf(5, 4));
    const opened = useSelectedOn(demo, 'iron-door');
    expect(opened.lines.map((l) => l.text).join(' ')).toContain('swings wide');
    expect(demo.world.interactableState('iron-door').open).toBe(true);

    // Walking onto the cell the panel marked starts the fight — nothing here
    // calls `startEncounter`, because a trigger a designer placed has to work.
    expect(demo.encounter).toBeNull();
    moveSelectedTo(demo, demo.grid.indexOf(7, 4));
    expect(demo.encounter).not.toBeNull();

    const foe = demo.state.entitiesOf('adversary')[0]!;
    expect(foe.definition).toBe('acid-burrower');
    const swing = attackWithSelected(demo, foe.id);
    expect(swing).not.toBeNull();
    expect(swing!.refused).toBeNull();
    expect(demo.log.map((line) => line.text).join(' ')).toMatch(/Broadsword/);
  });

  it('refuses to stand up a room that places a creature nobody can look up', () => {
    const s = author();
    s.project.scenes[0]!.encounters[0]!.adversaries[0]!.adversary = 'goblin-warror';
    expect(() => buildProjectScene(s.project)).toThrow(/goblin-warror/);
    // And the validator says the same thing before it is ever played.
    expect(
      validateProject(s.project, { knownAdversaries: new Set(['acid-burrower']) })
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
    session.run(updateSheet('kara', { name: 'Kara the Unmoved' }));
    session.run(updateInteractable('hall', 'iron-door', { name: 'A rusted door' }));

    const demo = buildProjectScene(session.project, 'authored');
    expect(demo.sheets.get('kara')!.name).toBe('Kara the Unmoved');
    expect(demo.scene.interactables.find((i) => i.id === 'iron-door')!.name).toBe('A rusted door');
  });
});
