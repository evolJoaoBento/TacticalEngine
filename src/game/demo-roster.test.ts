import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { blankSheet, startingPools } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { NO_TILE } from '../engine/grid/grid';
import { buildDemoScene, gatherParty, syncRoster, type DemoScene } from './demo-scene';
import { startEncounter } from './movement';
import { loadGameText, saveGame } from './save';

/**
 * The party on the board keeping step with the party in the project.
 *
 * The editor's Party panel writes a sheet into the document and nothing else;
 * `syncRoster` is what pressing Play does with it, so a character added in the
 * panel is standing beside the others rather than waiting for the project to
 * be loaded again.
 */

const scene = (): DemoScene => buildDemoScene(hollowVaultMap(), 'demo');

const tamsin = () => characterSheetSchema.parse(blankSheet('tamsin', 'cutpurse', { name: 'Tamsin' }));

const adjacent = (demo: DemoScene, a: number, b: number): boolean => demo.grid.chebyshevDistance(a, b) <= 1;

describe('a character added to the project', () => {
  it('joins beside the party with a fresh sheet\'s pools, and says so', () => {
    const demo = scene();
    const before = demo.party.members();
    demo.project.party.push(tamsin());

    expect(syncRoster(demo)).toEqual({ joined: ['tamsin'], left: [] });

    expect(demo.party.members()).toEqual([...before, 'tamsin']);
    const entity = demo.state.entity('tamsin')!;
    expect(entity.faction).toBe('party');
    expect(entity.tile).not.toBe(NO_TILE);
    expect(demo.grid.isPassable(entity.tile)).toBe(true);
    expect(demo.state.occupantsOf(entity.tile)).toEqual(['tamsin']);
    // Next to whoever was selected, not on a spawn across the room.
    const selected = demo.state.entity(demo.party.selected!)!;
    expect(adjacent(demo, entity.tile, selected.tile)).toBe(true);

    const pools = startingPools(demo.characters.get('tamsin')!);
    expect(entity.hitPoints).toEqual(pools.hitPoints);
    expect(entity.stress).toEqual(pools.stress);
    expect(entity.armorSlots).toEqual(pools.armorSlots);

    expect(demo.log.at(-1)?.text).toBe('Tamsin joins the party.');
    // The line links the newcomer, like every other name in the log.
    expect(demo.log.at(-1)?.mentions).toEqual([{ id: 'tamsin', name: 'Tamsin' }]);
  });

  it('is the same character on the second Play', () => {
    const demo = scene();
    demo.project.party.push(tamsin());
    syncRoster(demo);
    const count = demo.log.length;
    expect(syncRoster(demo)).toEqual({ joined: [], left: [] });
    expect(demo.party.members().filter((id) => id === 'tamsin')).toHaveLength(1);
    expect(demo.log).toHaveLength(count);
  });

  it('can walk into a fight and be ready in it', () => {
    const demo = scene();
    startEncounter(demo, demo.scene.encounters[0]!.id);
    demo.project.party.push(tamsin());
    expect(syncRoster(demo).joined).toEqual(['tamsin']);
    expect(demo.encounter?.canAct('tamsin')).toBe(true);
  });

  it('is carried by a save', () => {
    const demo = scene();
    demo.project.party.push(tamsin());
    syncRoster(demo);
    const tile = demo.state.entity('tamsin')!.tile;

    const fresh = scene();
    expect(loadGameText(fresh, JSON.stringify(saveGame(demo))).ok).toBe(true);
    expect(fresh.party.members()).toContain('tamsin');
    expect(fresh.state.entity('tamsin')?.tile).toBe(tile);
    expect(fresh.characters.get('tamsin')?.sheet.name).toBe('Tamsin');
    // And into the document, or the next Play would send them away again.
    expect(fresh.project.party.map((s) => s.id)).toContain('tamsin');
    expect(syncRoster(fresh)).toEqual({ joined: [], left: [] });
  });
});

describe('gathering the party at a tile', () => {
  it('puts the selected one on it and the rest on the nearest free floor, nobody on top of anybody', () => {
    const demo = scene();
    demo.party.select('mira');
    const target = demo.grid.indexOf(10, 8);
    expect(demo.grid.isPassable(target)).toBe(true);
    gatherParty(demo, target);
    expect(demo.state.entity('mira')!.tile).toBe(target);
    const tiles = demo.party.members().map((id) => demo.state.entity(id)!.tile);
    expect(new Set(tiles).size).toBe(tiles.length);
    for (const tile of tiles) {
      expect(tile).not.toBe(NO_TILE);
      expect(demo.grid.chebyshevDistance(tile, target)).toBeLessThanOrEqual(2);
    }
  });

  it('lands beside a wall rather than in it, and does nothing for a tile off the map', () => {
    const demo = scene();
    // The vault's own wall is blocks anybody strong enough may stand on, so a wall nobody can is made for this.
    demo.grid.barred[demo.grid.indexOf(9, 4)] = 1;
    const wall = Array.from({ length: demo.grid.size }, (_, i) => i).find((t) => !demo.grid.isPassable(t))!;
    gatherParty(demo, wall);
    for (const id of demo.party.members()) {
      const tile = demo.state.entity(id)!.tile;
      expect(demo.grid.isPassable(tile)).toBe(true);
      expect(demo.grid.chebyshevDistance(tile, wall)).toBeLessThanOrEqual(3);
    }
    const before = demo.party.members().map((id) => demo.state.entity(id)!.tile);
    gatherParty(demo, -1);
    expect(demo.party.members().map((id) => demo.state.entity(id)!.tile)).toEqual(before);
  });
});

describe('a character removed from the project', () => {
  it('leaves the board, and the selection moves on', () => {
    const demo = scene();
    const [first, ...rest] = demo.party.members();
    demo.party.select(first!);
    demo.project.party.splice(
      demo.project.party.findIndex((s) => s.id === first),
      1,
    );

    expect(syncRoster(demo)).toEqual({ joined: [], left: [first] });
    expect(demo.party.members()).toEqual(rest);
    expect(demo.state.entity(first!)).toBeUndefined();
    expect(demo.sheets.has(first!)).toBe(false);
    expect(demo.party.selected).toBe(rest[0]);
    expect(demo.log.at(-1)?.text).toMatch(/leaves the party\.$/);
  });

  it('waits for the fight to end', () => {
    const demo = scene();
    const first = demo.party.members()[0]!;
    startEncounter(demo, demo.scene.encounters[0]!.id);
    demo.project.party.splice(
      demo.project.party.findIndex((s) => s.id === first),
      1,
    );
    expect(syncRoster(demo)).toEqual({ joined: [], left: [] });
    expect(demo.state.entity(first)).toBeDefined();
  });
});
