/**
 * A placed creature's own name, in play: what the log, a conversation's window and the right-click
 * card call it, before the stat block's name - kept across a save, and following a rename made in
 * the editor while the game runs.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { EditorSession, addAdversary, addEncounter, addSheet, setSpawns } from '../editor/session';
import { FIXTURE_ADVERSARIES, FIXTURE_FOE } from '../../tests/fixtures/adversaries';
import { buildProjectScene } from './demo-scene';
import { inspection } from './inspect';
import { nameOf } from './log';
import { syncAuthoredEncounters } from './room';

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'sentinel', { name: 'Kara', ancestryId: 'human', armorId: 'ringmail', primaryWeaponId: 'longsword', subclassId: 'shieldbearer' }),
);

function session(): EditorSession {
  const s = new EditorSession(
    projectSchema.parse({ id: 'n', name: 'N', scenes: [sceneSchema.parse({ ...blankScene('hall', 12, 8), spawns: [{ x: 1, y: 4 }] })], startScene: 'hall' }),
  );
  s.project.adversaries.push(...FIXTURE_ADVERSARIES);
  s.run(addSheet(KARA));
  s.run(setSpawns('hall', [{ x: 1, y: 4 }]));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'e', startsOnTrigger: false })));
  s.run(addAdversary('hall', 'e', { id: 'captain', adversary: FIXTURE_FOE, position: { x: 6, y: 4 }, name: 'Captain Vey' }));
  s.run(addAdversary('hall', 'e', { id: 'grunt', adversary: FIXTURE_FOE, position: { x: 8, y: 4 } }));
  return s;
}

describe("a placed creature's own name", () => {
  it('is what play calls it, and one with none is called by its stat block', () => {
    const demo = buildProjectScene(session().project, 'names');
    expect(nameOf(demo, 'captain')).toBe('Captain Vey');
    expect(nameOf(demo, 'grunt')).toBe('Foe');
    // The card says both: who it is, and what it fights with.
    const card = inspection(demo, 'captain', null)!;
    expect(card.name).toBe('Captain Vey');
    expect(card.line).toMatch(/^Foe · Tier \d/);
    expect(inspection(demo, 'grunt', null)!.line).toMatch(/^Tier \d/);
  });

  it('is kept across a save', () => {
    const demo = buildProjectScene(session().project, 'names');
    demo.state.restore(JSON.parse(JSON.stringify(demo.state.snapshot())));
    expect(nameOf(demo, 'captain')).toBe('Captain Vey');
  });

  it('follows a rename in the editor, and a creature placed meanwhile stands as the placement says', () => {
    const s = session();
    const demo = buildProjectScene(s.project, 'names');
    const hall = demo.scene;
    const encounter = hall.encounters.find((e) => e.id === 'e')!;
    delete encounter.adversaries.find((a) => a.id === 'captain')!.name;
    encounter.adversaries.find((a) => a.id === 'grunt')!.name = 'Old Tam';
    // Placed while the game ran: friendly, named, and on nobody's side from the moment it stands.
    encounter.adversaries.push({ id: 'pedlar', adversary: FIXTURE_FOE, position: { x: 4, y: 6 }, name: 'Tobin', interaction: { kind: 'friendly', dialogue: 'none' } });
    syncAuthoredEncounters(demo);
    expect(nameOf(demo, 'captain')).toBe('Foe');
    expect(nameOf(demo, 'grunt')).toBe('Old Tam');
    expect(nameOf(demo, 'pedlar')).toBe('Tobin');
    expect(demo.state.entity('pedlar')!.faction).toBe('neutral');
  });
});
