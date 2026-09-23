import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { tileOf } from '../engine/scene/grid-from-scene';
import type { LevelUpPlan } from '../engine/character/progression';
import {
  answerPending,
  buildDemoScene,
  useSelectedOn,
  type DemoScene,
} from './demo-scene';
import { startEncounter } from './movement';
import { travelTo } from './room';
import { applyLevelUp, awaitingLevel } from './level-up';
import { PIT_SCENE_ID } from './demo-scenes';
import { loadGameText, saveGame } from './save';
import { runScript } from '../engine/script/runner';
import { createRng } from '../engine/core/rng';

/**
 * Levelling up, in the game.
 *
 * The engine decides whether a plan is legal; this is about what happens
 * around it — the GM granting a level through a script, the HUD knowing who
 * has one waiting, pools growing without clearing a wound, and a save carrying
 * the grown sheet.
 */

const scene = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

const karaToTwo: LevelUpPlan = {
  advancements: [{ kind: 'hitPoint' }, { kind: 'traits', traits: ['strength', 'agility'] }],
  domainCard: 'rallying-cry',
  experience: { name: 'Vault-born', modifier: 2 },
};

/** The GM says so. */
function grant(demo: DemoScene, level?: number): void {
  runScript([{ kind: 'levelUp', ...(level === undefined ? {} : { level }) }], demo.world, createRng(1));
}

describe('granting a level', () => {
  it('starts with nobody waiting', () => {
    expect(awaitingLevel(scene())).toEqual([]);
  });

  it('raises the party level by one, and everyone is waiting', () => {
    const demo = scene();
    grant(demo);
    expect(demo.scenario.partyLevel).toBe(2);
    expect(awaitingLevel(demo).sort()).toEqual(['arty', 'finn', 'ganja', 'kara', 'mira', 'pint']);
  });

  it('can name the level, and never goes backwards', () => {
    const demo = scene();
    grant(demo, 4);
    expect(demo.scenario.partyLevel).toBe(4);
    grant(demo, 2);
    expect(demo.scenario.partyLevel).toBe(4);
  });

  it('is journalled as news', () => {
    const demo = scene();
    const journal = runScript([{ kind: 'levelUp' }], demo.world, createRng(1));
    expect(journal).toContainEqual({ kind: 'levelUp', level: 2 });
  });
});

describe('taking the level', () => {
  it('refuses with no level waiting', () => {
    const result = applyLevelUp(scene(), 'kara', karaToTwo);
    expect(result.ok).toBe(false);
  });

  it('grows the pools, keeping every mark that was there', () => {
    const demo = scene();
    const kara = demo.state.entity('kara')!;
    kara.hitPoints.marked = 2;
    const before = { hp: kara.hitPoints.max, stress: kara.stress.max };
    grant(demo);
    const result = applyLevelUp(demo, 'kara', karaToTwo);
    expect(result).toEqual({ ok: true, level: 2 });
    expect(kara.hitPoints.max).toBe(before.hp + 1);
    expect(kara.hitPoints.marked).toBe(2);
    expect(kara.stress.max).toBe(before.stress);
    expect(demo.sheets.get('kara')!.level).toBe(2);
    expect(demo.characters.get('kara')!.traits.strength).toBe(3);
    expect(awaitingLevel(demo).sort()).toEqual(['arty', 'finn', 'ganja', 'mira', 'pint']);
    expect(demo.log.at(-1)!.text).toContain('Quim reaches level 2');
  });

  it('reaches the next check with the raised trait', () => {
    const demo = scene();
    grant(demo);
    applyLevelUp(demo, 'kara', karaToTwo);
    // Quim had the party's best Strength (2); it is 3 now, and a script's
    // Strength check rolls with it.
    expect(demo.world.traitModifier('strength')).toBe(3);
  });

  it('reports an illegal plan and changes nothing', () => {
    const demo = scene();
    grant(demo);
    const result = applyLevelUp(demo, 'kara', { ...karaToTwo, advancements: [{ kind: 'hitPoint' }] });
    expect(result.ok).toBe(false);
    expect(demo.sheets.get('kara')!.level).toBe(1);
  });

  it('refuses mid-fight and mid-conversation', () => {
    const demo = scene();
    grant(demo);
    startEncounter(demo, demo.scene.encounters[0]!.id);
    expect(applyLevelUp(demo, 'kara', karaToTwo).ok).toBe(false);

    const talking = scene();
    grant(talking);
    const chest = talking.scene.interactables.find((i) => i.id === 'chest-19-13')!;
    talking.state.moveEntity(
      talking.party.selected!,
      tileOf(talking.grid, { x: chest.position.x - 1, y: chest.position.y }),
    );
    useSelectedOn(talking, 'chest-19-13');
    expect(talking.pending).not.toBeNull();
    expect(applyLevelUp(talking, 'kara', karaToTwo).ok).toBe(false);
  });
});

describe('a grown sheet', () => {
  it('follows the party through a door', () => {
    const demo = scene();
    grant(demo);
    applyLevelUp(demo, 'kara', karaToTwo);
    const hp = demo.state.entity('kara')!.hitPoints.max;
    travelTo(demo, PIT_SCENE_ID);
    expect(demo.state.entity('kara')!.hitPoints.max).toBe(hp);
    expect(demo.sheets.get('kara')!.level).toBe(2);
  });

  it('survives a save', () => {
    const demo = scene();
    grant(demo);
    applyLevelUp(demo, 'kara', karaToTwo);
    const fresh = scene();
    expect(loadGameText(fresh, JSON.stringify(saveGame(demo))).ok).toBe(true);
    expect(fresh.sheets.get('kara')!.level).toBe(2);
    expect(fresh.characters.get('kara')!.traits.strength).toBe(3);
    expect(fresh.scenario.partyLevel).toBe(2);
    expect(awaitingLevel(fresh).sort()).toEqual(['arty', 'finn', 'ganja', 'mira', 'pint']);
  });

  it('loads a save written before levels existed', () => {
    const demo = scene();
    const save = JSON.parse(JSON.stringify(saveGame(demo)));
    delete save.sheets;
    delete save.scenario.partyLevel;
    const fresh = scene();
    expect(loadGameText(fresh, JSON.stringify(save)).ok).toBe(true);
    expect(fresh.sheets.get('kara')!.level).toBe(1);
  });
});

describe('the demo milestone', () => {
  it('levels the party when the strongbox opens', () => {
    // Give the party the word directly; the conversation is tested elsewhere.
    const demo = scene();
    demo.scenario.items.set('wardens-word', 1);
    travelTo(demo, PIT_SCENE_ID);
    const box = demo.scene.interactables.find((i) => i.id === 'strongbox')!;
    demo.state.moveEntity(demo.party.selected!, tileOf(demo.grid, { x: box.position.x - 1, y: box.position.y }));
    expect(useSelectedOn(demo, 'strongbox').status).toBe('done');
    if (demo.pending !== null) answerPending(demo, { kind: 'continue' });
    expect(demo.scenario.partyLevel).toBe(2);
    expect(demo.log.some((l) => l.text === 'The party reaches level 2.')).toBe(true);
  });
});
