import { describe, it, expect } from 'vitest';
import { blankSheet } from '../engine/character/sheet';
import { STARTER_CHARACTERS } from '../engine/content/pack/starter';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { MODELS } from '../engine/render/procedural/registry';
import { EditorSession, addSheet, removeSheet, updateSheet, type PartySheet } from './session';
import { validateProject } from './validate';

/**
 * The party as a document. It was three TypeScript literals; it is a list in
 * the project file now, edited the way every other list is, and checked
 * against the content it names.
 */

// The pack the app ships. Everything here is about the validator reading a document
// against content, not about which content that is.
const content = STARTER_CHARACTERS;

const KARA = blankSheet('kara', 'sentinel', {
  name: 'Kara',
  traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
  ancestryId: 'human',
  armorId: 'ringmail',
  primaryWeaponId: 'longsword',
  subclassId: 'shieldbearer',
  domainCards: ['power-slash', 'iron-stance'],
}) as PartySheet;

function project(): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', 6, 4))],
    party: [KARA],
    startScene: 'room',
  });
}

const session = (): EditorSession => new EditorSession(project());
const kara = (s: EditorSession) => s.project.party[0]!;

describe('the party in the project', () => {
  it('adds and removes a character, putting them back where they were', () => {
    const s = session();
    s.run(addSheet(blankSheet('finn', 'cutpurse', { name: 'Finn' }) as PartySheet));
    expect(s.project.party.map((p) => p.id)).toEqual(['kara', 'finn']);

    expect(s.run(removeSheet('kara'))).toBe(true);
    expect(s.project.party.map((p) => p.id)).toEqual(['finn']);
    s.undo();
    expect(s.project.party.map((p) => p.id)).toEqual(['kara', 'finn']);
  });

  it('removing somebody who is not there is a no-op, not an undo step', () => {
    const s = session();
    expect(s.run(removeSheet('nobody'))).toBe(false);
    expect(s.canUndo).toBe(false);
  });

  it('coalesces keystrokes in one field and starts again on another', () => {
    const s = session();
    for (const name of ['K', 'Ka', 'Kar', 'Karah']) s.run(updateSheet('kara', { name }));
    expect(kara(s).name).toBe('Karah');
    s.run(updateSheet('kara', { armorId: 'padded-coat' }));
    s.undo();
    expect(kara(s).armorId).toBe('ringmail');
    expect(kara(s).name).toBe('Karah');
    s.undo();
    expect(kara(s).name).toBe('Kara');
  });

  it('undoes only what it wrote, leaving what the table wrote alone', () => {
    const s = session();
    s.run(updateSheet('kara', { name: 'Karah' }));
    // The table levels her up between the edit and the undo: the panel never
    // knew about it, and must not take it back.
    s.project.party[0] = { ...s.project.party[0]!, level: 2, levels: [{ level: 2, advancements: [], domainCard: 'rallying-cry' }] };

    s.undo();
    expect(kara(s).name).toBe('Kara');
    expect(kara(s).level).toBe(2);
    expect(kara(s).levels).toHaveLength(1);
  });

  it('survives the trip through JSON with its level history intact', () => {
    const s = session();
    s.run(
      updateSheet('kara', {
        level: 3,
        levels: [
          { level: 2, advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }], domainCard: 'rallying-cry' },
          { level: 3, advancements: [{ kind: 'traits', traits: ['strength', 'instinct'] }], domainCard: 'reckless' },
        ],
      }),
    );
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(s.project)));
    expect(parsed.party[0]!.levels).toEqual(kara(s).levels);
  });

  it('keeps the model a character was pointed at through JSON', () => {
    // The field has to be on the schema *and* the interface: `parseSheet` types its return
    // as the interface, so a field the schema lost is caught - but an extra optional field
    // in the schema compiles quietly, and every equip and level-up re-parses the sheet. A
    // one-sided change would drop the choice on the first edit after it was made.
    const s = session();
    s.run(updateSheet('kara', { model: 'hollow-knight' }));
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(s.project)));
    expect(parsed.party[0]!.model).toBe('hollow-knight');

    // And clearing it goes back to whatever the class uses.
    s.run(updateSheet('kara', { model: undefined }));
    expect(projectSchema.parse(JSON.parse(JSON.stringify(s.project))).party[0]!.model).toBeUndefined();
  });

  it('rejects two characters with the same id', () => {
    const s = session();
    s.run(addSheet({ ...KARA, name: 'Another Kara' }));
    const problems = projectSchema.safeParse(JSON.parse(JSON.stringify(s.project)));
    expect(problems.success).toBe(false);
  });
});

describe('checking a party', () => {
  const check = (sheet: Partial<PartySheet>): string[] =>
    validateProject(projectSchema.parse({ ...project(), party: [{ ...KARA, ...sheet }] }), {
      characterContent: content,
    }).map((p) => p.message);

  it('says nothing about a sheet that names real content', () => {
    expect(check({})).toEqual([]);
  });

  it('warns when a character is drawn with a model nothing can supply', () => {
    // `knownModels` is passed here and not in `check`: every model check returns early
    // without it, so the assertion would pass while the loop never ran.
    const drawn = (model: string): string[] =>
      validateProject(projectSchema.parse({ ...project(), party: [{ ...KARA, model }] }), {
        knownModels: new Set(MODELS.map((m) => m.id)),
      })
        .filter((p) => p.message.includes('drawn with'))
        .map((p) => p.message);
    expect(drawn('no-such-model')).toHaveLength(1);
    expect(drawn('no-such-model')[0]!).toMatch(/Kara/);
    expect(drawn(MODELS[0]!.id)).toEqual([]);
  });

  it('reports a class, a weapon or a card that does not exist', () => {
    expect(check({ primaryWeaponId: 'vorpal-nonsense' }).join(' ')).toContain('vorpal-nonsense');
    expect(check({ domainCards: ['no-such-card'] }).join(' ')).toContain('no-such-card');
  });

  it('warns when the loadout names a card the character does not hold', () => {
    expect(check({ loadout: ['shield-wall'] }).join(' ')).toContain('does not hold it');
  });

  it('warns about a card from outside their domains', () => {
    // Arcane Ward is an Ember card; a Shieldbearer's domain is Bulwark alone.
    expect(check({ domainCards: ['power-slash', 'arcane-ward'] }).join(' ')).toContain('outside their domains');
  });

  it('warns when the traits are not the starting spread', () => {
    expect(check({ traits: { agility: 3, strength: 3, finesse: 3, instinct: 3, presence: 3, knowledge: 3 } }).join(' ')).toContain(
      'starting spread',
    );
    // A character who has levelled has moved past it, so it says nothing.
    expect(
      check({
        traits: { agility: 1, strength: 3, finesse: 0, instinct: 2, presence: 1, knowledge: -1 },
        level: 2,
        levels: [{ level: 2, advancements: [{ kind: 'traits', traits: ['strength', 'instinct'] }], domainCard: 'rallying-cry' }],
      }),
    ).toEqual([]);
  });

  it('says nothing at all when no content was handed to it', () => {
    expect(
      validateProject(projectSchema.parse({ ...project(), party: [{ ...KARA, classId: 'nonsense' }] })),
    ).toEqual([]);
  });
});
