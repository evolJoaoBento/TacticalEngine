import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrateDocument } from '../engine/scene/migrate';
import { demoMap } from '../../legacy/js/data.js';
import { tileOf } from '../engine/scene/grid-from-scene';
import {
  answerPending,
  buildDemoScene,
  startEncounter,
  useSelectedOn,
  type DemoScene,
} from './demo-scene';
import { characterContentFor, travelTo } from './room';
import { note } from './log';
import { deriveCharacter } from '../engine/character/sheet';
import type { LevelUpPlan } from '../engine/character/progression';
import { PIT_SCENE_ID } from './demo-scenes';
import { SAVED_LOG_LINES, loadGame, loadGameText, saveBlockedBy, saveGame, saveSchema } from './save';
import { applyLevelUp } from './level-up';

/**
 * Putting a campaign down and picking it up again.
 *
 * The thing under test is not "does it round-trip" — a JSON copy round-trips —
 * but whether what comes back is the same *game*: the same dice ahead of you,
 * the same wounds, the same rooms left the way you left them.
 */

const CHEST = 'chest-19-13';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(demoMap(), seed);

function stand(demo: DemoScene, id: string): void {
  const object = demo.scene.interactables.find((i) => i.id === id)!;
  demo.state.moveEntity(
    demo.party.selected!,
    tileOf(demo.grid, { x: object.position.x - 1, y: object.position.y }),
  );
}

/** Open the vault chest, rolling if it asks. */
function loot(demo: DemoScene): void {
  stand(demo, CHEST);
  useSelectedOn(demo, CHEST);
  if (demo.pending !== null) answerPending(demo, { kind: 'roll' });
}

/** The vault's door, and the tile it stands on. */
function doorTile(demo: DemoScene): number {
  const door = demo.scene.interactables.find((i) => i.kind === 'door')!;
  return tileOf(demo.grid, door.position);
}

/** Save, put it through JSON, and load it into a scene built from scratch. */
function reload(demo: DemoScene, seed = 'demo'): DemoScene {
  const text = JSON.stringify(saveGame(demo));
  const fresh = scene(seed);
  const result = loadGameText(fresh, text);
  expect(result).toEqual({ ok: true });
  return fresh;
}

/**
 * A save written by an older build, at the door.
 *
 * `loadGameText` migrates before it validates, so the only thing standing between a version-1 file
 * and a refusal the player reads as "damaged" is whether the migrated document satisfies
 * `saveSchema`. `tests/fixtures/v1/save.json` is a real version-1 save — see the README beside it —
 * which is what lets this fail for a reason other than agreeing with itself.
 */
describe('a version-1 save at the door', () => {
  const v1Save = (): unknown =>
    JSON.parse(
      readFileSync(`${fileURLToPath(new URL('../../', import.meta.url))}tests/fixtures/v1/save.json`, 'utf8'),
    );

  it('validates once migrated', () => {
    const result = saveSchema.safeParse(migrateDocument(v1Save()));
    expect(result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
  });

  it('is refused unmigrated, because a scene must carry its pool', () => {
    // `sceneSnapshotSchema` declares `bad: currencySchema` — required, unlike the entity pool's
    // `good: currencySchema.optional()`. A version-1 scene carries the old pool key and no `bad`,
    // so zod strips the unknown key and then finds the required one missing. That refusal is what
    // makes the test above load-bearing rather than decorative.
    expect(saveSchema.safeParse(v1Save()).success).toBe(false);
  });

  it('loads into a fresh scene through the public door', () => {
    // The schema is not the whole door: `loadGameText` also checks the project id and derives every
    // sheet. This is the path a player's file actually takes.
    const fresh = scene();
    expect(loadGameText(fresh, JSON.stringify(v1Save()))).toEqual({ ok: true });
  });
});

describe('saving a game', () => {
  it('names the project, the room, and where the dice had got to', () => {
    const demo = scene();
    const save = saveGame(demo)!;
    expect(save.projectId).toBe(demo.project.id);
    expect(save.sceneId).toBe(demo.scene.id);
    expect(save.rng).toBe(demo.rng.save());
    expect(saveSchema.parse(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('includes the room being played, not only the ones left behind', () => {
    const demo = scene();
    // `snapshots` is "rooms I have left"; a save that trusted it would reload
    // into a pristine version of the room you were standing in.
    expect(demo.snapshots.size).toBe(0);
    expect(Object.keys(saveGame(demo)!.scenes)).toEqual([demo.scene.id]);
  });

  it('refuses mid-fight', () => {
    const demo = scene();
    const encounter = demo.scene.encounters[0]!;
    startEncounter(demo, encounter.id);
    expect(saveBlockedBy(demo)).toMatch(/fight/);
    expect(saveGame(demo)).toBeNull();
  });

  it('refuses a checkpoint while an ambush is waiting for the party to arrive', () => {
    const demo = scene();
    demo.ambush = demo.scene.encounters[0]!.id;
    expect(saveBlockedBy(demo)).toMatch(/ambush/);
    expect(saveGame(demo)).toBeNull();
    demo.ambush = null;
    expect(saveBlockedBy(demo)).toBeNull();
    expect(saveGame(demo)).not.toBeNull();
  });

  it('refuses while a script is waiting on an answer', () => {
    const demo = scene();
    stand(demo, CHEST);
    useSelectedOn(demo, CHEST);
    expect(demo.pending).not.toBeNull();
    expect(saveBlockedBy(demo)).toMatch(/conversation/);
    expect(saveGame(demo)).toBeNull();
  });
});

/**
 * A character is written down twice — the map the game reads and the list the
 * project carries — and everything that changes a sheet has to change both, or
 * the next time the party is rebuilt from the document the change is gone.
 */
const KARA_TO_TWO: LevelUpPlan = {
  advancements: [{ kind: 'hitPoint' }, { kind: 'traits', traits: ['strength', 'agility'] }],
  domainCard: 'rallying-cry',
  experience: { name: 'Vault-born', modifier: 2 },
};

describe('a sheet the document has to keep', () => {
  /** What `setMode('play')` does: rebuild the party from the project. */
  const rebuild = (demo: DemoScene): void => {
    for (const sheet of demo.project.party) {
      if (demo.sheets.has(sheet.id)) demo.sheets.set(sheet.id, sheet);
    }
    for (const [id, sheet] of demo.sheets) {
      demo.characters.set(id, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    }
  };

  it('keeps a level taken at the table through a rebuild', () => {
    const demo = scene();
    demo.world.grantLevel(2);
    expect(applyLevelUp(demo, 'kara', KARA_TO_TWO)).toMatchObject({ ok: true });
    expect(demo.sheets.get('kara')!.level).toBe(2);

    rebuild(demo);
    expect(demo.sheets.get('kara')!.level).toBe(2);
    expect(demo.project.party.find((s) => s.id === 'kara')!.levels).toHaveLength(1);
  });

  it('keeps a restored save through a rebuild', () => {
    const demo = scene();
    demo.world.grantLevel(2);
    expect(applyLevelUp(demo, 'kara', KARA_TO_TWO)).toMatchObject({ ok: true });

    const fresh = reload(demo);
    expect(fresh.sheets.get('kara')!.level).toBe(2);
    rebuild(fresh);
    expect(fresh.sheets.get('kara')!.level).toBe(2);
  });

});

describe('loading a game', () => {
  it('comes back in the same room, with the same log', () => {
    const demo = scene();
    loot(demo);
    travelTo(demo, PIT_SCENE_ID);

    const back = reload(demo);
    expect(back.scene.id).toBe(PIT_SCENE_ID);
    expect(back.log).toEqual(demo.log);
  });

  it('carries the pack, the flags and the variables', () => {
    const demo = scene();
    loot(demo);
    demo.scenario.flags.add('warden-appeased');
    demo.scenario.variables['mood'] = 'grim';
    expect(demo.scenario.items.size).toBeGreaterThan(0);

    const back = reload(demo);
    expect([...back.scenario.items]).toEqual([...demo.scenario.items]);
    expect([...back.scenario.flags]).toEqual([...demo.scenario.flags]);
    expect(back.scenario.variables).toEqual(demo.scenario.variables);
  });

  it('carries a clock that was running, and what it was counting towards', () => {
    const demo = scene();
    demo.world.startCountdown({
      id: 'ritual',
      name: 'Summoning Ritual',
      owner: null,
      dice: '2d6',
      value: 4,
      start: 7,
      advance: 'hpMarked',
      loop: 'reset',
      onDeath: 'trigger',
      effects: [{ kind: 'log', text: 'The circle closes.' }],
    });

    const back = reload(demo);
    // A clock is no use if loading a game loses what it was counting towards,
    // so the effects travel with it.
    expect(back.scenario.countdowns.get('ritual')).toEqual(demo.scenario.countdowns.get('ritual'));
    expect(back.world.countdowns()).toHaveLength(1);
  });

  it('refills the scenario in place, so the live room still reads it', () => {
    const demo = scene();
    const scenario = demo.scenario;
    loot(demo);
    const back = reload(demo);

    // The world the loaded scene is playing with has to be looking at the same
    // object the save filled, or a `hasItem` check in that room reads nothing.
    expect(back.world.scenario).toBe(back.scenario);
    for (const [id, quantity] of back.scenario.items) {
      expect(back.world.hasItem(id, quantity)).toBe(true);
    }
    // And the object identity survived the load rather than being replaced.
    expect(demo.scenario).toBe(scenario);
  });

  it('leaves the party where it stood, not on the spawns', () => {
    const demo = scene();
    const mover = demo.party.selected!;
    stand(demo, CHEST);
    const tile = demo.state.entity(mover)!.tile;
    const spawns = demo.scene.spawns.map((p) => tileOf(demo.grid, p));
    expect(spawns).not.toContain(tile);

    const back = reload(demo);
    expect(back.state.entity(mover)!.tile).toBe(tile);
  });

  it('leaves the vault door open, the way the save left it', () => {
    // The blocking index is built from the document, which still says the door
    // is shut; a load that trusted it would wall the party in.
    const demo = scene();
    const tile = doorTile(demo);
    const mover = demo.party.selected!;
    expect(demo.state.blockedFor(mover)(tile)).toBe(true);
    demo.world.openInteractable(demo.scene.interactables.find((i) => i.kind === 'door')!.id);
    expect(demo.state.blockedFor(mover)(tile)).toBe(false);

    const back = reload(demo);
    expect(doorTile(back)).toBe(tile);
    expect(back.state.blockedFor(mover)(tile)).toBe(false);
  });

  it('remembers wounds', () => {
    const demo = scene();
    const wounded = demo.party.selected!;
    demo.state.entity(wounded)!.hitPoints.marked = 2;
    demo.state.entity(wounded)!.stress.marked = 3;

    const back = reload(demo);
    expect(back.state.entity(wounded)!.hitPoints.marked).toBe(2);
    expect(back.state.entity(wounded)!.stress.marked).toBe(3);
  });

  it('remembers rooms that are not the one being played', () => {
    const demo = scene();
    loot(demo);
    expect(demo.state.interactable(CHEST).used).toBe(true);
    const vault = demo.scene.id;
    travelTo(demo, PIT_SCENE_ID);

    const back = reload(demo);
    expect(back.scene.id).toBe(PIT_SCENE_ID);
    expect(back.snapshots.get(vault)!.interactables[CHEST]!.used).toBe(true);
    // And going back finds it that way.
    travelTo(back, vault);
    expect(back.state.interactable(CHEST).used).toBe(true);
  });

  it('picks the dice stream up where it stopped', () => {
    // The point of saving the RNG position: what happens next has to be what
    // would have happened next. A save that only copied the seed would replay
    // rolls the session already spent.
    const demo = scene();
    // Spend dice first, so a load that only copied the seed would be rolling
    // numbers this session already used.
    demo.rng.dice(6, 12);
    const back = reload(demo);
    loot(demo);
    loot(back);
    expect(back.log.map((l) => l.text)).toEqual(demo.log.map((l) => l.text));
    expect([...back.scenario.items]).toEqual([...demo.scenario.items]);
  });

  it('does not simply restart the seed', () => {
    const demo = scene();
    // Spend some dice, then save; loading and rolling must not repeat them.
    demo.rng.dice(6, 12);
    const back = reload(demo);
    expect(back.rng.save()).toBe(demo.rng.save());
    expect(back.rng.save()).not.toBe(scene().rng.save());
  });

  it('refuses a save that belongs to another project', () => {
    const demo = scene();
    const save = saveGame(demo)!;
    const result = loadGame(scene(), { ...save, projectId: 'someone-elses-campaign' });
    expect(result.ok).toBe(false);
  });

  it('refuses a save with no state for the room it names', () => {
    const demo = scene();
    const save = saveGame(demo)!;
    const result = loadGame(scene(), { ...save, sceneId: PIT_SCENE_ID });
    expect(result.ok).toBe(false);
  });

  it('leaves the game alone when it refuses a room the project no longer has', () => {
    // A save naming a scene the editor has since deleted. Refusing after the
    // scenario had already been overwritten would leave a half-loaded game.
    const demo = scene();
    loot(demo);
    const save = saveGame(demo)!;
    const orphan = {
      ...save,
      sceneId: 'nowhere',
      scenes: { nowhere: save.scenes[save.sceneId]! },
      scenario: { ...save.scenario, items: [] as [string, number][], flags: ['ghost'] },
    };

    const before = { scene: demo.scene.id, items: [...demo.scenario.items] };
    expect(loadGame(demo, orphan).ok).toBe(false);
    expect(demo.scene.id).toBe(before.scene);
    expect([...demo.scenario.items]).toEqual(before.items);
    expect(demo.scenario.flags.has('ghost')).toBe(false);
  });

  it('refuses a save whose sheet is not a sheet', () => {
    const demo = scene();
    const save = JSON.parse(JSON.stringify(saveGame(demo)));
    save.sheets[0].level = 'banana';
    expect(loadGameText(scene(), JSON.stringify(save)).ok).toBe(false);
  });

  it('refuses a save whose sheet names gear the project does not have', () => {
    const demo = scene();
    const save = JSON.parse(JSON.stringify(saveGame(demo)));
    save.sheets[0].primaryWeaponId = 'vorpal-nonsense';
    const result = loadGameText(scene(), JSON.stringify(save));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/vorpal-nonsense/);
  });

  it('reports damaged text rather than throwing', () => {
    expect(loadGameText(scene(), 'not json at all').ok).toBe(false);
    // A version this build does not know, rather than one it writes: the door migrates what it
    // understands and refuses what it cannot.
    expect(loadGameText(scene(), '{"formatVersion":99}').ok).toBe(false);
  });

  it('drops a fight and a pending prompt on load', () => {
    const demo = scene();
    const save = saveGame(demo)!;
    const playing = scene();
    stand(playing, CHEST);
    useSelectedOn(playing, CHEST);
    expect(playing.pending).not.toBeNull();

    expect(loadGame(playing, save).ok).toBe(true);
    expect(playing.pending).toBeNull();
    expect(playing.encounter).toBeNull();
  });
});

describe('the scrollback a save carries', () => {
  it('keeps the tail and no more, however long the campaign ran', () => {
    const demo = scene();
    // A campaign's worth of lines: a swing, a roll and a door apiece.
    for (let i = 0; i < SAVED_LOG_LINES * 3; i++) note(demo, `line ${i}`, 'narration');
    expect(demo.log.length).toBeGreaterThan(SAVED_LOG_LINES);

    const save = saveGame(demo)!;
    expect(save.log).toHaveLength(SAVED_LOG_LINES);
    // The tail, in order: what a player picking the game up wants is the end.
    expect(save.log[save.log.length - 1]!.text).toBe(`line ${SAVED_LOG_LINES * 3 - 1}`);
    expect(save.log[0]!.text).toBe(`line ${SAVED_LOG_LINES * 2}`);
  });

  it('carries a short log whole', () => {
    const demo = scene();
    const before = demo.log.length;
    note(demo, 'the vault door is ajar', 'narration');
    const save = saveGame(demo)!;
    expect(save.log).toHaveLength(before + 1);
    expect(save.log[save.log.length - 1]!.text).toBe('the vault door is ajar');
  });

  it('and the live log is left alone, because four callers read it by index', () => {
    const demo = scene();
    for (let i = 0; i < SAVED_LOG_LINES * 2; i++) note(demo, `line ${i}`, 'narration');
    const before = demo.log.length;
    note(demo, 'one more', 'narration');
    // `log.slice(before)` is how a use reports what it added; a log trimmed
    // under that would hand back somebody else's lines.
    expect(demo.log.slice(before).map((l) => l.text)).toEqual(['one more']);
  });
});
