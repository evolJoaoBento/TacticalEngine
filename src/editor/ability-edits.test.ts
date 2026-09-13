import { describe, it, expect } from 'vitest';
import { abilitySchema } from '../engine/content/abilities';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { cardDefSchema } from '../engine/content/pack/schema';
import { EditorSession, addAbility, addCardWithAbility, removeAbility, removeCardWithAbility, updateAbility } from './session';
import { validateProject } from './validate';

/**
 * Editing a card as a document. The Cards panel is a view over these three
 * edits; every keystroke is one of them, coalesced by field, which is what
 * makes typing a card's text one undo rather than forty.
 */

const RALLY = {
  id: 'rally',
  name: 'Rally',
  source: { card: 'rally' },
  text: 'Shout, and they stand a little straighter.',
  cost: { good: 1 },
  effects: [{ kind: 'log', text: 'Kara shouts.' }],
};

function project(): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', 6, 4))],
    abilities: [abilitySchema.parse(RALLY)],
    startScene: 'room',
  });
}

const session = (): EditorSession => new EditorSession(project());
const rally = (s: EditorSession) => s.project.abilities[0]!;

describe('a cost only the GM can pay', () => {
  it('warns when a card asks its holder for a Shadow, and not when a stat block does', () => {
    const s = session();
    s.run(updateAbility('rally', { cost: { bad: 1 } }));
    expect(validateProject(s.project).map((p) => p.message).join(' ')).toContain('only the GM spends');

    // The same cost on a stat block's feature is exactly where it belongs.
    s.run(updateAbility('rally', { source: { kind: 'adversary', adversaries: ['acid-burrower'] } }));
    expect(validateProject(s.project)).toEqual([]);
  });
});

describe('cards in the project', () => {
  it('adds and removes one, putting it back where it was', () => {
    const s = session();
    s.run(addAbility(abilitySchema.parse({ ...RALLY, id: 'other', name: 'Other' })));
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'other']);

    expect(s.run(removeAbility('rally'))).toBe(true);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['other']);
    s.undo();
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'other']);
  });

  it('removing a card that is not there is a no-op, not an undo step', () => {
    const s = session();
    expect(s.run(removeAbility('nope'))).toBe(false);
    expect(s.canUndo).toBe(false);
  });

  it('deletes the card "+ Card" wrote with its ability, as one step, and no card anything else needs', () => {
    const s = session();
    const oath = (id: string, grant: Record<string, unknown>) => cardDefSchema.parse({ id, name: id, grant });
    const on = (id: string, card: string) => abilitySchema.parse({ id, name: id, source: { card } });
    s.run(addCardWithAbility(oath('oath', { kind: 'given', characters: ['kara'] }), on('oath', 'oath')));
    expect(s.project.cards.map((c) => c.id)).toEqual(['oath']);

    s.run(removeCardWithAbility('oath'));
    expect(s.project.cards).toEqual([]);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally']);
    s.undo();
    expect(s.project.cards.map((c) => c.id)).toEqual(['oath']);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'oath']);

    // A card a class grants is not the author's to lose by deleting what it does; nor is a given
    // card another ability still sits on.
    s.run(addCardWithAbility(oath('drill', { kind: 'class', classId: 'sentinel' }), on('drill', 'drill')));
    s.run(addAbility(on('oath-again', 'oath')));
    s.run(removeCardWithAbility('drill'));
    s.run(removeCardWithAbility('oath'));
    expect(s.project.cards.map((c) => c.id)).toEqual(['oath', 'drill']);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'oath-again']);
  });

  it('coalesces keystrokes in one field and starts again on another', () => {
    const s = session();
    for (const text of ['S', 'Sh', 'Sho', 'Shout']) s.run(updateAbility('rally', { text }));
    expect(rally(s).text).toBe('Shout');

    s.run(updateAbility('rally', { name: 'Rally the Line' }));
    expect(rally(s).name).toBe('Rally the Line');

    // The name is its own step; undoing it leaves the typed text alone.
    s.undo();
    expect(rally(s).name).toBe('Rally');
    expect(rally(s).text).toBe('Shout');
    s.undo();
    expect(rally(s).text).toBe(RALLY.text);
  });

  it('replaces the script whole, and the card survives a round trip through the schema', () => {
    const s = session();
    s.run(
      updateAbility('rally', {
        effects: [
          { kind: 'run', hook: 'rally-the-line', args: { bonus: 2 } },
          { kind: 'damage', dice: 'same', half: true, target: { kind: 'adversaries', range: 'veryClose', except: 'target' } },
        ],
      }),
    );
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(s.project)));
    expect(parsed.abilities[0]!.effects).toEqual([
      { kind: 'run', hook: 'rally-the-line', args: { bonus: 2 } },
      { kind: 'damage', dice: 'same', half: true, target: { kind: 'adversaries', range: 'veryClose', except: 'target' } },
    ]);
  });
});
