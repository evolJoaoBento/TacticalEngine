/**
 * The sheet New Game shows before Begin (`sheet-preview.ts`) is the sheet the game then has: the same
 * numbers the camp works out for the character once it is open.
 */

import { describe, expect, it } from 'vitest';
import { sheetPreview } from './sheet-preview';
import { swapTraits, SPREADS, type Creation } from './new-character';
import { campProject } from './camp';
import { sheetFor } from './new-character';
import { bootDemo } from './project-store';
import { GameProjects } from './game-projects';
import { memoryStore } from './save-slots';

const ash: Creation = {
  name: 'Ash',
  ancestryId: 'dwarf',
  model: 'quim',
  communityId: 'ridgeborne',
  classId: 'guardian',
  subclassId: 'stalwart',
  domainCards: ['bare-bones', 'get-back-up'],
  traits: swapTraits(SPREADS.guardian!, 'strength', 'knowledge'),
};

describe('the sheet New Game shows', () => {
  it('is the class, the traits as they were left, gear, and every pool empty', () => {
    const { member, stats } = sheetPreview(ash);
    expect(member.role).toBe('Guardian');
    expect(member.name).toBe('Ash');
    expect(stats.level).toBe(1);
    expect(stats.traits.map((trait) => [trait.id, trait.value])).toEqual([['agility', 1], ['strength', 0], ['finesse', -1], ['instinct', 0], ['presence', 1], ['knowledge', 2]]);
    // A Guardian casts nothing.
    expect(stats.traits.some((trait) => trait.spellcast)).toBe(false);
    for (const pool of [member.hitPoints, member.stress, member.armorSlots]) {
      expect(pool.marked).toBe(0);
      expect(pool.max).toBeGreaterThan(0);
    }
    expect(member.gear).toMatch(/ · /);
    expect(member.gear).not.toContain('Unarmed');
  });

  it('marks the trait a caster casts with', () => {
    const { stats } = sheetPreview({ ...ash, classId: 'sorcerer', subclassId: 'elemental-origin', domainCards: [], traits: undefined as never });
    expect(stats.traits.find((trait) => trait.spellcast)?.id).toBe('instinct');
  });

  it('has the numbers the camp works out once it is open', async () => {
    const games = new GameProjects(memoryStore());
    const project = campProject(sheetFor(ash), 5);
    games.write(project);
    const booted = await bootDemo({ search: `?play&project=${project.id}`, boot: 'builtin', games });
    const played = booted.demo.characters.get('ash')!;
    const { member, stats } = sheetPreview(ash);
    expect(stats.evasion).toBe(played.evasion);
    expect(stats.proficiency).toBe(played.proficiency);
    expect(stats.thresholds).toEqual(played.thresholds);
    expect(member.hitPoints.max).toBe(played.hitPoints);
    expect(member.stress.max).toBe(played.stress);
    expect(member.armorSlots.max).toBe(played.armorScore);
  });
});
