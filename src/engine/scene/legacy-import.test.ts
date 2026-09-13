import { describe, it, expect } from 'vitest';
import {
  WALL_HEIGHT,
  convertEffect,
  encounterId,
  importLegacyCampaign,
  importLegacyScene,
  type LegacyMap,
} from './legacy-import';
import { sceneSchema } from './schema';

function legacyMap(overrides: Partial<LegacyMap> = {}): LegacyMap {
  const w = 3;
  const h = 2;
  return {
    name: 'Test Room',
    intro: 'A room.',
    w,
    h,
    tiles: Array.from({ length: w * h }, () => ({ h: 0, color: '#5d8a4a', prop: null })),
    nodes: [],
    enemies: [],
    triggers: [],
    decos: [],
    spawns: [[0, 0]],
    ...overrides,
  };
}

describe('convertEffect', () => {
  it('translates the legacy effect vocabulary', () => {
    expect(convertEffect('none', '')).toEqual({ kind: 'none' });
    expect(convertEffect('open', '')).toEqual({ kind: 'open' });
    expect(convertEffect('loot', '')).toEqual({ kind: 'loot' });
    expect(convertEffect('removeNode', '')).toEqual({ kind: 'remove' });
    expect(convertEffect('giveKey', 'brass')).toEqual({ kind: 'giveKey', key: 'brass' });
    expect(convertEffect('setFlag', 'met-hag')).toEqual({ kind: 'setFlag', flag: 'met-hag' });
    expect(convertEffect('goto', 'The Pit')).toEqual({ kind: 'goto', scene: 'the-pit' });
  });

  it('turns the legacy flat trap into an authored amount', () => {
    expect(convertEffect('damage', '')).toEqual({ kind: 'damage', amount: 2 });
  });

  it('turns a numbered group into a named encounter', () => {
    expect(convertEffect('spawnGroup', '2')).toEqual({
      kind: 'startEncounter',
      encounter: 'group-2',
    });
    expect(encounterId(3)).toBe('group-3');
  });

  it('rejects a parameterised effect with no parameter', () => {
    expect(convertEffect('giveKey', '')).toBeNull();
    expect(convertEffect('goto', '')).toBeNull();
    expect(convertEffect('teleport', 'x')).toBeNull();
  });
});

describe('importLegacyScene', () => {
  it('produces a scene that validates against the schema', () => {
    const { scene, issues } = importLegacyScene(legacyMap());
    expect(issues).toEqual([]);
    expect(sceneSchema.safeParse(scene).success).toBe(true);
    expect(scene!.id).toBe('test-room');
    expect(scene!.intro).toBe('A room.');
  });

  it('turns wall-height tiles into impassable terrain, keeping the height', () => {
    const map = legacyMap();
    (map.tiles as { h: number }[])[1]!.h = WALL_HEIGHT;
    const { scene } = importLegacyScene(map);
    expect(scene!.terrain[1]).toBe('wall');
    expect(scene!.heights[1]).toBe(WALL_HEIGHT);
    expect(scene!.terrain[0]).toBe('floor');
  });

  it('leaves walkable elevation alone', () => {
    const map = legacyMap();
    (map.tiles as { h: number }[])[0]!.h = 3;
    expect(importLegacyScene(map).scene!.terrain[0]).toBe('floor');
  });

  it('maps tile props onto terrain', () => {
    const map = legacyMap();
    (map.tiles as { prop: string | null }[])[0]!.prop = 'difficult';
    (map.tiles as { prop: string | null }[])[1]!.prop = 'cover';
    const { scene } = importLegacyScene(map);
    expect(scene!.terrain.slice(0, 3)).toEqual(['difficult', 'cover', 'floor']);
  });

  it('keeps the per-tile colours as tints', () => {
    const { scene } = importLegacyScene(legacyMap());
    expect(scene!.tints).toHaveLength(6);
    expect(scene!.tints![0]).toBe('#5d8a4a');
  });

  it('rejects a map whose tile count does not match its size', () => {
    const { scene, issues } = importLegacyScene(legacyMap({ tiles: [] }));
    expect(scene).toBeNull();
    expect(issues[0]!.message).toMatch(/expected 6 tiles, got 0/);
  });

  it('rejects a map with no usable dimensions', () => {
    const { scene, issues } = importLegacyScene(legacyMap({ w: 0 }));
    expect(scene).toBeNull();
    expect(issues[0]!.field).toBe('w/h');
  });

  it('reports a missing spawn and defaults it rather than failing', () => {
    const { scene, issues } = importLegacyScene(legacyMap({ spawns: [] }));
    expect(scene!.spawns).toEqual([{ x: 0, y: 0 }]);
    expect(issues[0]!.message).toMatch(/no usable spawn/);
  });

  it('drops out-of-bounds spawns', () => {
    const { scene } = importLegacyScene(
      legacyMap({ spawns: [[9, 9] as [number, number], [1, 1] as [number, number]] }),
    );
    expect(scene!.spawns).toEqual([{ x: 1, y: 1 }]);
  });

  describe('interactables', () => {
    it('converts an editor node with its check and outcomes', () => {
      const { scene } = importLegacyScene(
        legacyMap({
          nodes: [
            {
              id: 'node-a1b2c3',
              type: 'chest',
              x: 1,
              y: 0,
              name: 'Old Chest',
              flavor: 'It rots.',
              trait: 'Finesse',
              dc: 12,
              open: false,
              requireKey: 'brass',
              lockedText: 'Locked.',
              goto: null,
              outcomes: {
                hopeSuccess: { text: 'It opens.', effect: 'loot' },
                fearFail: { text: 'A needle.', effect: 'damage' },
              },
            },
          ],
        }),
      );
      const chest = scene!.interactables[0]!;
      expect(chest.kind).toBe('chest');
      expect(chest.position).toEqual({ x: 1, y: 0 });
      expect(chest.requiresKey).toBe('brass');
      // The legacy outcome text becomes a leading `log`: in the unified
      // vocabulary a line of narration is an effect like any other.
      expect(chest.check).toEqual({
        trait: 'finesse',
        difficulty: 12,
        onSuccessWithGood: [{ kind: 'log', text: 'It opens.', tone: 'narration' }, { kind: 'loot' }],
        onFailureWithBad: [
          { kind: 'log', text: 'A needle.', tone: 'narration' },
          { kind: 'damage', amount: 2 },
        ],
      });
    });

    it('replaces a random legacy id with a stable positional one', () => {
      const map = legacyMap({ nodes: [{ id: 'node-a1b2c3', type: 'door', x: 2, y: 1 }] });
      const first = importLegacyScene(map).scene!.interactables[0]!;
      const second = importLegacyScene(map).scene!.interactables[0]!;
      expect(first.id).toBe('door-2-1');
      expect(second.id).toBe(first.id); // re-importing is deterministic
    });

    it('keeps a hand-written id', () => {
      const { scene } = importLegacyScene(
        legacyMap({ nodes: [{ id: 'body-knight', type: 'scripted', x: 0, y: 0 }] }),
      );
      expect(scene!.interactables[0]!.id).toBe('body-knight');
    });

    it('moves scripted node flags into tags and data', () => {
      const { scene } = importLegacyScene(
        legacyMap({
          nodes: [
            {
              id: 'body-knight',
              type: 'scripted',
              x: 0,
              y: 0,
              heroKey: 'knight',
              model: 'body:knight',
            },
            { id: 'crank-1', type: 'scripted', x: 1, y: 0, crank: true, foundText: 'A crank!' },
            { id: 'pillar-1', type: 'scripted', x: 2, y: 0, pillar: true, lit: false },
          ],
        }),
      );
      const [body, crank, pillar] = scene!.interactables;
      expect(body!.tags).toEqual(['heroKey']);
      expect(body!.data['heroKey']).toBe('knight');
      expect(body!.model).toBe('body:knight');
      expect(crank!.tags).toEqual(['crank']);
      expect(crank!.data['foundText']).toBe('A crank!');
      expect(pillar!.tags).toEqual(['pillar']);
      // Runtime state stays out of the document.
      expect(pillar!.data['lit']).toBeUndefined();
    });

    it('drops the legacy runtime fields', () => {
      const { scene } = importLegacyScene(
        legacyMap({ nodes: [{ id: 'chest-x', type: 'chest', x: 0, y: 0, open: true, used: true }] }),
      );
      expect(Object.keys(scene!.interactables[0]!)).not.toContain('open');
      expect(Object.keys(scene!.interactables[0]!)).not.toContain('used');
    });

    it('reports a node placed outside the scene', () => {
      const { scene, issues } = importLegacyScene(
        legacyMap({ nodes: [{ id: 'chest-x', type: 'chest', x: 99, y: 0 }] }),
      );
      expect(scene!.interactables).toEqual([]);
      expect(issues[0]!.field).toBe('nodes');
    });

    it('gives no check to a node without outcomes', () => {
      const { scene } = importLegacyScene(
        legacyMap({ nodes: [{ id: 'body-x', type: 'scripted', x: 0, y: 0 }] }),
      );
      expect(scene!.interactables[0]!.check).toBeUndefined();
    });
  });

  describe('encounters', () => {
    it('groups enemies and their trigger into one named encounter', () => {
      const { scene } = importLegacyScene(
        legacyMap({
          enemies: [
            { id: 'enemy-aaa111', type: 'bramble', x: 0, y: 0, group: 1 },
            { id: 'enemy-bbb222', type: 'bramble', x: 1, y: 0, group: 1 },
            { id: 'enemy-ccc333', type: 'husk', x: 2, y: 0, group: 2 },
          ],
          triggers: [{ id: 'trig-ddd444', group: 1, cells: [[0, 1], [1, 1]] }],
        }),
      );
      expect(scene!.encounters).toHaveLength(2);
      const [first, second] = scene!.encounters;
      expect(first!.id).toBe('group-1');
      expect(first!.adversaries).toHaveLength(2);
      expect(first!.triggerCells).toEqual([{ x: 0, y: 1 }, { x: 1, y: 1 }]);
      expect(second!.id).toBe('group-2');
      expect(second!.triggerCells).toEqual([]);
    });

    it('maps the one legacy enemy that exists in the SRD onto its content id', () => {
      const { scene } = importLegacyScene(
        legacyMap({ enemies: [{ type: 'bramble', x: 0, y: 0, group: 1 }] }),
      );
      expect(scene!.encounters[0]!.adversaries[0]!.adversary).toBe('tangle-bramble');
    });

    it('keeps the homebrew enemies as their own content ids', () => {
      const { scene } = importLegacyScene(
        legacyMap({
          enemies: [
            { type: 'husk', x: 0, y: 0, group: 1 },
            { type: 'shadowHag', x: 1, y: 0, group: 1 },
          ],
        }),
      );
      expect(scene!.encounters[0]!.adversaries.map((a) => a.adversary)).toEqual([
        'hollow-husk',
        'shadow-hag',
      ]);
    });

    it('gives each placement a stable id derived from its position', () => {
      const map = legacyMap({ enemies: [{ type: 'husk', x: 2, y: 1, group: 1 }] });
      const a = importLegacyScene(map).scene!.encounters[0]!.adversaries[0]!.id;
      const b = importLegacyScene(map).scene!.encounters[0]!.adversaries[0]!.id;
      expect(a).toBe('group-1-husk-2-1');
      expect(b).toBe(a);
    });
  });

  describe('decos', () => {
    it('keeps model, position and rotation', () => {
      const { scene } = importLegacyScene(
        legacyMap({ decos: [{ type: 'campfire', x: 1, y: 1, rot: 0.5 }] }),
      );
      expect(scene!.decos[0]).toEqual({
        model: 'campfire',
        position: { x: 1, y: 1 },
        rotation: 0.5,
      });
    });

    it('keeps the hand-written id the narrative refers to', () => {
      const { scene } = importLegacyScene(
        legacyMap({ decos: [{ type: 'archfey', x: 1, y: 1, id: 'archfey-2' }] }),
      );
      expect(scene!.decos[0]!.id).toBe('archfey-2');
    });

    it('drops decos placed outside the scene', () => {
      const { scene } = importLegacyScene(
        legacyMap({ decos: [{ type: 'crate', x: 9, y: 9 }, { type: 'crate', x: 0, y: 0 }] }),
      );
      expect(scene!.decos).toHaveLength(1);
    });
  });

  it('keeps the fog band', () => {
    expect(importLegacyScene(legacyMap({ fog: { band: 2 } })).scene!.fogBand).toBe(2);
    expect(importLegacyScene(legacyMap()).scene!.fogBand).toBeUndefined();
  });
});

describe('importLegacyCampaign', () => {
  it('imports a campaign document into a project', () => {
    const { project, issues } = importLegacyCampaign({
      campaign: true,
      name: 'The Conductors Stage',
      scenes: [legacyMap({ name: 'One' }), legacyMap({ name: 'Two' })],
    });
    expect(issues).toEqual([]);
    expect(project!.id).toBe('the-conductors-stage');
    expect(project!.scenes.map((s) => s.id)).toEqual(['one', 'two']);
    expect(project!.startScene).toBe('one');
  });

  it('wraps a bare map in a project', () => {
    const { project } = importLegacyCampaign(legacyMap({ name: 'Lonely' }));
    expect(project!.scenes).toHaveLength(1);
    expect(project!.scenes[0]!.id).toBe('lonely');
  });

  it('disambiguates scenes that would share an id', () => {
    const { project } = importLegacyCampaign({
      scenes: [legacyMap({ name: 'Room' }), legacyMap({ name: 'Room' })],
    });
    expect(project!.scenes.map((s) => s.id)).toEqual(['room', 'room-2']);
  });

  it('keeps the readable scenes when one is broken', () => {
    const { project, issues } = importLegacyCampaign({
      scenes: [legacyMap({ name: 'Good' }), legacyMap({ name: 'Broken', tiles: [] })],
    });
    expect(project!.scenes.map((s) => s.id)).toEqual(['good']);
    expect(issues[0]!.entry).toBe('Broken');
  });

  it('returns no project when nothing could be read', () => {
    const { project, issues } = importLegacyCampaign({ scenes: [legacyMap({ tiles: [] })] });
    expect(project).toBeNull();
    expect(issues.some((i) => i.message === 'no scene could be read')).toBe(true);
  });
});
