import { describe, it, expect } from 'vitest';
import { blankScene } from './grid-from-scene';
import { contentIdSchema, effectSchema, projectSchema, sceneSchema } from './schema';

const scene = (overrides: Record<string, unknown> = {}) => ({
  ...blankScene('room', 3, 2),
  ...overrides,
});

describe('contentIdSchema', () => {
  it('accepts stable kebab and snake ids', () => {
    for (const id of ['chest', 'the-quiet-camp', 'group-1', 'body_knight', 'a1']) {
      expect(contentIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('rejects ids that would not survive a save round trip', () => {
    for (const id of ['', 'Chest', 'the camp', '-lead', 'trail-', 'a--b', 'ünicode']) {
      expect(contentIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe('effectSchema', () => {
  it('accepts the effect vocabulary with typed parameters', () => {
    expect(effectSchema.parse({ kind: 'open' })).toEqual({ kind: 'open' });
    expect(effectSchema.parse({ kind: 'giveKey', key: 'brass' })).toEqual({
      kind: 'giveKey',
      key: 'brass',
    });
    expect(effectSchema.parse({ kind: 'damage', amount: 2 }).kind).toBe('damage');
  });

  it('rejects an effect missing its parameter', () => {
    expect(effectSchema.safeParse({ kind: 'giveKey' }).success).toBe(false);
    expect(effectSchema.safeParse({ kind: 'goto', scene: 'Not An Id' }).success).toBe(false);
    expect(effectSchema.safeParse({ kind: 'damage', amount: 0 }).success).toBe(false);
    expect(effectSchema.safeParse({ kind: 'teleport' }).success).toBe(false);
  });
});

describe('sceneSchema', () => {
  it('accepts a blank scene and fills the defaults', () => {
    const parsed = sceneSchema.parse(scene());
    expect(parsed.interactables).toEqual([]);
    expect(parsed.encounters).toEqual([]);
    expect(parsed.decos).toEqual([]);
  });

  it('requires the tile arrays to match the declared size', () => {
    const short = sceneSchema.safeParse(scene({ terrain: ['floor', 'floor'] }));
    expect(short.success).toBe(false);
    expect(short.error!.issues[0]!.message).toMatch(/expected 6 entries for a 3x2 scene, got 2/);

    const badHeights = sceneSchema.safeParse(scene({ heights: [0] }));
    expect(badHeights.success).toBe(false);
    expect(badHeights.error!.issues[0]!.path).toEqual(['heights']);
  });

  it('checks the optional tints array too', () => {
    expect(sceneSchema.safeParse(scene({ tints: ['#fff'] })).success).toBe(false);
    expect(sceneSchema.safeParse(scene({ tints: new Array(6).fill('#fff') })).success).toBe(true);
  });

  it('requires at least one spawn, inside the scene', () => {
    expect(sceneSchema.safeParse(scene({ spawns: [] })).success).toBe(false);
    const outside = sceneSchema.safeParse(scene({ spawns: [{ x: 9, y: 0 }] }));
    expect(outside.success).toBe(false);
    expect(outside.error!.issues[0]!.message).toMatch(/outside the scene/);
  });

  it('rejects duplicate ids within a scene', () => {
    const duplicated = sceneSchema.safeParse(
      scene({
        interactables: [
          { id: 'chest', kind: 'chest', position: { x: 0, y: 0 } },
          { id: 'chest', kind: 'door', position: { x: 1, y: 0 } },
        ],
      }),
    );
    expect(duplicated.success).toBe(false);
    expect(duplicated.error!.issues[0]!.message).toMatch(/duplicate id "chest"/);
  });

  it('catches an id collision between an encounter and an adversary in it', () => {
    const clash = sceneSchema.safeParse(
      scene({
        encounters: [
          {
            id: 'ambush',
            adversaries: [
              { id: 'ambush', adversary: 'tangle-bramble', position: { x: 0, y: 0 } },
            ],
          },
        ],
      }),
    );
    expect(clash.success).toBe(false);
  });

  it('leaves the check outcomes partial', () => {
    const parsed = sceneSchema.parse(
      scene({
        interactables: [
          {
            id: 'door',
            kind: 'door',
            position: { x: 0, y: 0 },
            check: {
              trait: 'finesse',
              difficulty: 12,
              onSuccessWithHope: [
                { kind: 'log', text: 'It opens.' },
                { kind: 'open' },
              ],
            },
          },
        ],
      }),
    );
    const check = parsed.interactables[0]!.check!;
    expect(check.onSuccessWithHope).toEqual([
      { kind: 'log', text: 'It opens.' },
      { kind: 'open' },
    ]);
    // Outcomes nobody wrote stay absent, and fall back at runtime.
    expect(check.onFailureWithFear).toBeUndefined();
  });

  it('accepts an effect the old narrow vocabulary could not express', () => {
    const parsed = sceneSchema.parse(
      scene({
        interactables: [
          {
            id: 'statue',
            kind: 'scripted',
            position: { x: 1, y: 1 },
            check: {
              trait: 'presence',
              difficulty: 14,
              onSuccessWithHope: [
                {
                  kind: 'branch',
                  when: { kind: 'flag', flag: 'knows-the-name' },
                  then: [{ kind: 'startDialogue', dialogue: 'the-statue' }],
                  otherwise: [{ kind: 'log', text: 'It stays silent.' }],
                },
              ],
            },
          },
        ],
      }),
    );
    const effects = parsed.interactables[0]!.check!.onSuccessWithHope!;
    expect(effects[0]!.kind).toBe('branch');
  });
});

describe('projectSchema', () => {
  const project = (overrides: Record<string, unknown> = {}) => ({
    id: 'demo',
    name: 'Demo',
    scenes: [scene({ id: 'room' })],
    startScene: 'room',
    ...overrides,
  });

  it('accepts a project and defaults the format version', () => {
    expect(projectSchema.parse(project()).formatVersion).toBe(1);
  });

  it('rejects a future format version rather than guessing at it', () => {
    expect(projectSchema.safeParse(project({ formatVersion: 2 })).success).toBe(false);
  });

  it('requires startScene to name a scene that exists', () => {
    const bad = projectSchema.safeParse(project({ startScene: 'nowhere' }));
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]!.message).toMatch(/not one of the project/);
  });

  it('rejects duplicate scene ids', () => {
    const bad = projectSchema.safeParse(
      project({ scenes: [scene({ id: 'room' }), scene({ id: 'room' })] }),
    );
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]!.message).toMatch(/duplicate scene id/);
  });

  it('requires at least one scene', () => {
    expect(projectSchema.safeParse(project({ scenes: [] })).success).toBe(false);
  });
});
