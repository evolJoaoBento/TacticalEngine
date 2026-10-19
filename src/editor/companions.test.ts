/**
 * The project's companions (`project.companions`) and the "Join the party" effect that asks one along (`joinParty`):
 * what the editor's check says of an effect naming a companion the project has not got and of a companion nothing
 * asks, and the schema refusing two companions of one id. What joining does is the engine's
 * (`server/hooks/tests/party_join.rs`); the camp that has them is `game/camp.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { blankSheet } from '../engine/character/sheet';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { validateProject } from './validate';

const violet = blankSheet('violet', 'rogue', { name: 'Violet' });

function build(extra: Record<string, unknown> = {}): ProjectDoc {
  return projectSchema.parse({ id: 'camp', name: 'Camp', scenes: [sceneSchema.parse(blankScene('room', 6, 4))], startScene: 'room', ...extra });
}

const asking = (companion: string) => ({ id: 'ask', name: 'Ask', kind: 'consumable', use: [{ kind: 'joinParty', companion, figure: 'violet-figure' }] });
const messages = (project: ProjectDoc): string[] => validateProject(project).map((p) => p.message);

describe('companions, and a "Join the party" effect', () => {
  it('are checked: a companion nothing asks along is warned of, and one asked that is not there is an error', () => {
    expect(messages(build({ companions: [violet] }))).toContain('Companion "violet" can never join: no "Join the party" effect names them.');
    const asked = messages(build({ companions: [violet], items: [asking('violet')] }));
    expect(asked.filter((m) => m.includes('Join the party') || m.includes('Companion'))).toEqual([]);
    expect(messages(build({ items: [asking('nobody')] }))).toContain('A "Join the party" effect names companion "nobody", who is not one of the project\'s companions.');
  });

  it('are refused with the same id twice, and may be in the party once they have joined it', () => {
    const twice = projectSchema.safeParse({ id: 'camp', scenes: [sceneSchema.parse(blankScene('room', 6, 4))], startScene: 'room', companions: [violet, violet] });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues.map((i) => i.message)).toContain('duplicate companion id "violet"');
    expect(projectSchema.safeParse({ id: 'camp', scenes: [sceneSchema.parse(blankScene('room', 6, 4))], startScene: 'room', party: [violet], companions: [violet] }).success).toBe(true);
  });

  it('default to none, so a project written before them is still a project', () => {
    expect(build().companions).toEqual([]);
  });
});
