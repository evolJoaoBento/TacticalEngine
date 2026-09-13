import { describe, it, expect } from 'vitest';
import { blankScene } from './grid-from-scene';
import { CURRENT_FORMAT_VERSION, contentIdSchema, effectSchema, projectSchema, sceneSchema } from './schema';

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

  it('accepts a model override on one placed creature', () => {
    const parsed = sceneSchema.parse(
      scene({
        encounters: [
          {
            id: 'group-1',
            adversaries: [
              { id: 'a', adversary: 'tangle-bramble', position: { x: 0, y: 0 }, model: 'knight' },
            ],
          },
        ],
      }),
    );
    expect(parsed.encounters[0]!.adversaries[0]!.model).toBe('knight');
  });

  it('leaves a placement without one unset, so the type default decides', () => {
    const parsed = sceneSchema.parse(
      scene({
        encounters: [
          {
            id: 'group-1',
            adversaries: [{ id: 'a', adversary: 'tangle-bramble', position: { x: 0, y: 0 } }],
          },
        ],
      }),
    );
    expect(parsed.encounters[0]!.adversaries[0]!.model).toBeUndefined();
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
              onSuccessWithGood: [
                { kind: 'log', text: 'It opens.' },
                { kind: 'open' },
              ],
            },
          },
        ],
      }),
    );
    const check = parsed.interactables[0]!.check!;
    expect(check.onSuccessWithGood).toEqual([
      { kind: 'log', text: 'It opens.' },
      { kind: 'open' },
    ]);
    // Outcomes nobody wrote stay absent, and fall back at runtime.
    expect(check.onFailureWithBad).toBeUndefined();
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
              onSuccessWithGood: [
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
    const effects = parsed.interactables[0]!.check!.onSuccessWithGood!;
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

  it('accepts a project and defaults the format version to the current one', () => {
    expect(projectSchema.parse(project()).formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it('still accepts a version-1 document, which the door has already migrated', () => {
    expect(projectSchema.safeParse(project({ formatVersion: 1 })).success).toBe(true);
  });

  it('defaults the per-type model map, so a project written before it is still a project', () => {
    expect(projectSchema.parse(project()).adversaryModels).toEqual({});
  });

  it('keeps a per-type model map it is given', () => {
    const parsed = projectSchema.parse(project({ adversaryModels: { 'tangle-bramble': 'knight' } }));
    expect(parsed.adversaryModels['tangle-bramble']).toBe('knight');
  });

  it('defaults the content lists, so a project written before packs still parses', () => {
    const parsed = projectSchema.parse(project());
    expect(parsed.classes).toEqual([]);
    expect(parsed.ancestries).toEqual([]);
    expect(parsed.communities).toEqual([]);
    expect(parsed.subclasses).toEqual([]);
    expect(parsed.cards).toEqual([]);
    expect(parsed.weapons).toEqual([]);
    expect(parsed.armors).toEqual([]);
  });

  it('carries the content a project declares', () => {
    const parsed = projectSchema.parse(
      project({
        classes: [
          {
            id: 'sentinel',
            name: 'Sentinel',
            domains: ['bulwark'],
            startingEvasion: 9,
            startingHitPoints: 7,
          },
        ],
        cards: [
          {
            id: 'power-slash',
            name: 'Power Slash',
            domain: 'bulwark',
            type: 'ability',
            level: 1,
            recallCost: 1,
            text: 'Strike hard.',
          },
          { id: 'hold-the-line', name: 'Hold the Line', text: 'Stand your ground.', grant: { kind: 'class', classId: 'sentinel' } },
        ],
      }),
    );
    expect(parsed.classes[0]!.name).toBe('Sentinel');
    expect(parsed.cards[1]!.grant).toEqual({ kind: 'class', classId: 'sentinel' });
    expect(parsed.cards[0]!.id).toBe('power-slash');
  });

  it('refuses content that does not describe itself properly', () => {
    const bad = projectSchema.safeParse(
      project({ classes: [{ id: 'Sentinel', name: 'Sentinel', startingEvasion: 9, startingHitPoints: 7 }] }),
    );
    // Ids are kebab-case; "Sentinel" is not one.
    expect(bad.success).toBe(false);
  });

  it('rejects a format version from a build that does not exist yet, rather than guessing', () => {
    expect(projectSchema.safeParse(project({ formatVersion: 99 })).success).toBe(false);
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
