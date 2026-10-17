/**
 * The demo the page drives, asserted without a page.
 *
 * `game/demo-scene.ts` deliberately holds no renderer, camera or event handler,
 * so what the browser shows can be checked here — and an e2e failure means the
 * browser, not the scene.
 *
 * This is also the closest thing to a playable vertical slice, so these tests
 * double as the check on whether the engine can actually run one.
 */

import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from '../../src/game/demo-map';
import { characterContentFor } from '../../src/game/room';
import { SceneView } from '../../src/engine/render/scene-view';
import { tilesDrawn } from '../../src/engine/render/terrain-mesh';
import { tileOf } from '../../src/engine/scene/grid-from-scene';
import { attackProfile, wieldedTrait } from '../../src/engine/character/sheet';
import { buildDemoScene, setSheet, syncPools, type DemoScene } from '../../src/game/demo-scene';
import { reachableTiles, underPressureTiles } from '../../src/game/movement';
import { startEncounter } from '../fixtures/fight';
import { DEMO_ADVERSARY_ID, DEMO_BAND_TILES, PARTY_SHEETS, DEMO_ADVERSARIES, DEMO_CHARACTERS } from '../../src/game/demo-rules';

const build = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

/**
 * A project is played with the content it carries.
 *
 * The pack the app ships is a starting point, not the whole world: a project
 * may bring its own cards, classes and gear, and what it brings wins where the
 * two name the same id. This is what lets a scenario travel — and what lets a
 * test carry the one card it is about instead of borrowing a shipped one.
 */
describe('a project plays the content it carries', () => {
  const FIXTURE_CARD = {
    id: 'project-only-card',
    name: 'Project Only Card',
    grant: { kind: 'chosen' as const },
    domain: 'bulwark',
    type: 'ability' as const,
    level: 1,
    recallCost: 0,
    text: 'A card no pack has.',
    features: [],
  };

  it('resolves a card no shipped pack has', () => {
    const demo = build();
    demo.project.cards.push(FIXTURE_CARD);
    setSheet(demo, { ...demo.sheets.get('kara')!, domainCards: [FIXTURE_CARD.id] });

    expect(demo.characters.get('kara')!.cards.map((card) => card.id)).toEqual(['project-only-card']);
  });

  it('still plays the shipped pack when the project carries nothing', () => {
    const demo = build();
    setSheet(demo, { ...demo.sheets.get('kara')!, domainCards: ['power-slash'] });

    expect(demo.characters.get('kara')!.cards.map((card) => card.id)).toEqual(['power-slash']);
  });
});

describe('the demo scene', () => {
  it('builds the woods and the vault, and stands a party in them', () => {
    const demo = build();
    expect(demo.scene.width).toBe(44);
    expect(demo.grid.size).toBe(44 * 32);
    expect(demo.party.members()).toEqual(['kara', 'finn', 'mira', 'arty', 'pint', 'ganja']);
    expect(demo.party.selected).toBe('kara');
  });

  it('reads its adversaries from the pack it ships', () => {
    const knight = DEMO_ADVERSARIES.get(DEMO_ADVERSARY_ID)!;
    expect(knight.name).toBe('Hollow Knight');
    expect(DEMO_ADVERSARIES.size).toBe(10);

    // The prototype's husks are homebrew ids with no stat block, so the import
    // points every one of them at the demo's own creature: one block, however
    // many of them are standing in the vault.
    const demo = build();
    const adversaries = demo.state.entitiesOf('adversary');
    expect(adversaries.length).toBeGreaterThan(0);
    for (const a of adversaries) expect(a.hitPoints.max).toBe(knight.hitPoints);
  });

  it('stands one of every stat block along the back wall, on nobody\'s side', () => {
    const demo = build();
    const lineUp = demo.state.entitiesOf('neutral');
    expect(lineUp.map((e) => e.definition).sort()).toEqual([...DEMO_ADVERSARIES.keys()].sort());
    // Each on a tile of its own that can be stood on, and none of them where something else is.
    const taken = new Set([...demo.state.entitiesOf('party'), ...demo.state.entitiesOf('adversary')].map((e) => e.tile));
    expect(new Set(lineUp.map((e) => e.tile)).size).toBe(lineUp.length);
    for (const one of lineUp) {
      expect(demo.grid.isPassable(one.tile), one.id).toBe(true);
      expect(taken.has(one.tile), one.id).toBe(false);
      expect(one.hitPoints.max).toBe(DEMO_ADVERSARIES.get(one.definition)!.hitPoints);
    }
    // And the fight in the room is the one it always was: the three husks, and only them.
    expect(demo.state.entitiesOf('adversary').map((e) => e.id).sort()).toEqual(['group-1-husk-16-8', 'group-1-husk-18-3', 'group-1-husk-19-11']);
  });

  it('seats the party on the scene spawn points', () => {
    const demo = build();
    const spawns = demo.scene.spawns.map((p) => tileOf(demo.grid, p));
    for (const member of demo.state.entitiesOf('party')) expect(spawns).toContain(member.tile);
  });

  it('indexes the map trigger cells', () => {
    const demo = build();
    expect(demo.triggers.size).toBeGreaterThan(0);
  });
});

describe('party control', () => {

  it('keeps the preview off the walls and, out of a fight, counts no steps', () => {
    const demo = build();
    const field = reachableTiles(demo);
    const tiles = field.tiles();
    expect(tiles.length).toBeGreaterThan(1);
    for (const tile of tiles) expect(demo.grid.isPassable(tile)).toBe(true);
    // Everywhere the floor goes from where they stand: the far end of the vault included.
    const start = demo.state.entity('kara')!.tile;
    const farthest = Math.max(...tiles.map((t) => demo.grid.euclideanDistance(start, t)));
    expect(farthest).toBeGreaterThan(DEMO_BAND_TILES.close);
  });
});

describe('the party is built from content, not written down', () => {
  it('derives every sheet against the vendored SRD with no issues', () => {
    const demo = build();
    // Against what the demo is played with: the pack, plus whatever the project brings of its own.
    const content = characterContentFor(demo.project);
    expect(demo.characters.size).toBe(PARTY_SHEETS.length);
    for (const sheet of PARTY_SHEETS) {
      expect(content.classes.has(sheet.classId)).toBe(true);
      expect(content.armors.has(sheet.armorId!)).toBe(true);
      expect(content.weapons.has(sheet.primaryWeaponId!)).toBe(true);
      expect(content.ancestries.has(sheet.ancestryId!)).toBe(true);
    }
  });

  it('takes each character Hit Points and Armor Slots from their class and armor', () => {
    const demo = build();
    for (const [id, character] of demo.characters) {
      const klass = DEMO_CHARACTERS.classes.get(character.sheet.classId)!;
      const armor = DEMO_CHARACTERS.armors.get(character.sheet.armorId!)!;
      const entity = demo.state.entity(id)!;

      expect(entity.hitPoints.max).toBe(klass.startingHitPoints);
      // The pool is built from the derived score, which a class feature and a
      // held card both add to -- not from the armour's bare number.
      expect(entity.armorSlots.max).toBe(character.armorScore);
      expect(entity.stress.max).toBe(6);
      expect(entity.good!.value).toBe(2);
      // Level 1, so thresholds are the armor's plus one — plus one more for
      // Quim, whose subclass feature raises them.
      const raised = character.sheet.subclassId === 'shieldbearer' ? 1 : 0;
      expect(character.thresholds).toEqual({
        major: armor.baseThresholds.major + 1 + raised,
        severe: armor.baseThresholds.severe + 1 + raised,
      });
    }
  });

  it('gives the party genuinely different characters', () => {
    const demo = build();
    const evasions = [...demo.characters.values()].map((c) => c.evasion);
    const hitPoints = [...demo.characters.values()].map((c) => c.hitPoints);
    // Three classes, so these are not all the same number by construction.
    expect(new Set([...evasions, ...hitPoints]).size).toBeGreaterThan(1);
  });

  it('rolls the trait the equipped weapon names', () => {
    const demo = build();
    const finn = demo.characters.get('finn')!;
    const bow = DEMO_CHARACTERS.weapons.get(finn.sheet.primaryWeaponId!)!;
    const profile = attackProfile(finn);
    expect(profile.name).toBe(bow.name);
    expect(profile.modifier.modifier).toBe(finn.sheet.traits[wieldedTrait(finn, bow)]);
    expect(profile.range).toBe(bow.range);
  });

  it('gives the ranged character a longer reach than the sword-carrier', () => {
    const demo = build();
    const kara = attackProfile(demo.characters.get('kara')!);
    const finn = attackProfile(demo.characters.get('finn')!);
    expect(kara.range).toBe('melee');
    expect(finn.range).not.toBe('melee');
  });
});

describe('the demo renders', () => {
  it('draws every tile in a handful of draw calls, with a model per entity', () => {
    const demo = build();
    const view = new SceneView(demo.grid, { tints: demo.scene.tints });
    view.setDecos(demo.scene.decos);
    view.syncTokens(demo.state);

    expect(tilesDrawn(view.terrain)).toBe(demo.grid.size);
    expect(view.terrain.meshes.length).toBeLessThanOrEqual(4);
    expect(view.decoCount).toBe(demo.scene.decos.length);
    for (const entity of demo.state.allEntities()) expect(view.tokenFor(entity.id)).toBeDefined();
    // The ground and most of the dressing are shipped files, which are imports: a view handed no
    // asset library has none of them, and everything else the room names is in the procedural one.
    expect(view.registry.missing()).toEqual([
      'banner-prop', 'barrel-prop', 'camp-fire-prop', 'cart-prop', 'chest-prop', 'crate-prop', 'dirt-ground', 'door-prop', 'grass-ground',
      'pillar-prop', 'portal-prop', 'rock-prop', 'standing-torch-prop', 'stone-block', 'stone-stairs', 'stone-wall', 'training-dummy-prop', 'tree-prop', 'withering-tree-prop',
    ]);
    view.dispose();
  });

  it('paints exactly the reachable tiles', () => {
    const demo = build();
    const view = new SceneView(demo.grid);
    const tiles = reachableTiles(demo).tiles();
    view.showHighlights(tiles);
    expect(view.highlightedCount).toBe(tiles.length);
    view.dispose();
  });
});

describe('the ground a push would open', () => {
  it('is past the move a turn allows and inside what one push reaches, in a fight, for whoever may act', () => {
    const demo = build('pressure');
    expect(underPressureTiles(demo)).toEqual([]);
    startEncounter(demo, demo.scene.encounters.find((e) => e.adversaries.length > 0)!.id);
    const id = demo.party.selected!;
    const inReach = new Set(reachableTiles(demo).tiles());
    const run = underPressureTiles(demo);
    expect(run.length).toBeGreaterThan(0);
    const whole = new Set(demo.party.reachable(id, { inCombat: true, budget: Infinity }).tiles());
    for (const tile of run) {
      expect(inReach.has(tile)).toBe(false);
      expect(whole.has(tile)).toBe(true);
    }
    // Somebody who may not act this turn has no push to make.
    demo.encounter!.endGmTurn();
    demo.state.entity(id)!.alive = false;
    expect(underPressureTiles(demo)).toEqual([]);
  });
});

describe('the pools a sheet sets', () => {
  it('follow the derived numbers: Armor Slots to the armor score, what was marked kept inside them', () => {
    const demo = build('pools');
    const kara = demo.state.entity('kara')!;
    const score = demo.characters.get('kara')!.armorScore;
    expect(kara.armorSlots.max).toBe(score);
    kara.armorSlots = { max: score, marked: score };
    // A lighter armour: fewer slots, and the marks cut down to fit.
    demo.characters.set('kara', { ...demo.characters.get('kara')!, armorScore: score - 2 });
    syncPools(demo);
    expect(kara.armorSlots).toEqual({ max: score - 2, marked: score - 2 });
    // Back up: the slots return, the marks as they were left.
    demo.characters.set('kara', { ...demo.characters.get('kara')!, armorScore: score });
    syncPools(demo);
    expect(kara.armorSlots).toEqual({ max: score, marked: score - 2 });
  });
});
