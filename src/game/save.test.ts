import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrateDocument } from '../engine/scene/migrate';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { note } from './log';
import { SAVED_LOG_LINES, saveBlockedBy, saveGame, saveSchema } from './save';
const scene = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

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

  it('refuses a checkpoint while an ambush is waiting for the party to arrive', () => {
    const demo = scene();
    demo.ambush = demo.scene.encounters[0]!.id;
    expect(saveBlockedBy(demo)).toMatch(/ambush/);
    expect(saveGame(demo)).toBeNull();
    demo.ambush = null;
    expect(saveBlockedBy(demo)).toBeNull();
    expect(saveGame(demo)).not.toBeNull();
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
