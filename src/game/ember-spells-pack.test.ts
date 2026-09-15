import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { deriveCharacter } from '../engine/character/sheet';
import { SRD_CONDITIONS } from '../engine/content/conditions';
import { describePack, readPack } from '../engine/content/pack/document';
import { STARTER_PACK } from '../engine/content/pack/starter';
import { NO_TILE } from '../engine/grid/grid';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import type { EntityState } from '../engine/scene/state';
import { importPack } from '../editor/session';
import { validateProject } from '../editor/validate';
import { useAbility } from './demo-abilities';
import {
  answerPending,
  attackWithSelected,
  buildDemoScene,
  refreshWorld,
  type DemoScene,
} from './demo-scene';
import { startEncounter } from './movement';
import { characterContentFor, worldOptions } from './room';

/**
 * The pack the build ships as a file rather than as code: two ember spells, each carrying the
 * condition it applies. The engine used to carry both conditions itself; they left it for this, so
 * everything here is read from the file a player would import, not from a copy of it.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const PACK_FILE = 'public/packs/ember-spells.json';
const reading = () => readPack(JSON.parse(readFileSync(`${repoRoot}${PACK_FILE}`, 'utf8')), PACK_FILE);

/** The pack laid into the demo's project the way Import pack lays it, and these cards held. */
function take(demo: DemoScene, who: string, cards: string[]): void {
  importPack(reading().pack).apply(demo.project);
  const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards };
  demo.sheets.set(who, sheet);
  demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
  refreshWorld(demo);
}

/** Put somebody on a free tile beside another, avoiding the tiles named. */
function standBeside(demo: DemoScene, who: string, beside: number, avoid: readonly number[] = []): void {
  const blocked = demo.state.blockedFor(who);
  let stand = NO_TILE;
  demo.grid.forEachNeighbor(beside, false, (tile) => {
    if (stand === NO_TILE && demo.grid.isPassable(tile) && !blocked(tile) && !avoid.includes(tile)) stand = tile;
  });
  if (stand !== NO_TILE) demo.state.moveEntity(who, stand);
}

/** Somebody beside the nearest husk, a fight begun, and every other creature down. */
function standoff(seed: string, who: string): { demo: DemoScene; foe: EntityState } {
  const demo = buildDemoScene(demoMap(), seed);
  demo.askDefender = false;
  const at = demo.state.entity(who)!.tile;
  const foe = demo.state
    .entitiesOf('adversary')
    .filter((e) => e.alive)
    .sort((a, b) => demo.grid.manhattanDistance(at, a.tile) - demo.grid.manhattanDistance(at, b.tile))[0]!;
  standBeside(demo, who, foe.tile);
  demo.party.select(who);
  startEncounter(demo, demo.scene.encounters[0]!.id);
  for (const e of demo.state.entitiesOf('adversary')) {
    if (e.id === foe.id) continue;
    e.hitPoints = { ...e.hitPoints, marked: e.hitPoints.max };
    e.alive = false;
  }
  foe.hitPoints = { max: 60, marked: 0 };
  return { demo, foe };
}

const settle = (demo: DemoScene): void => {
  while (demo.pending !== null) answerPending(demo, { kind: 'choose', index: 0 });
};

describe('the ember spells pack', () => {
  it('reads clean, and checks clean in a project that imports it', () => {
    const { pack, issues, refused } = reading();
    expect(refused).toBeNull();
    expect(issues).toEqual([]);
    expect(describePack(pack)).toBe('3 cards, 3 abilities, 2 conditions');

    const project = projectSchema.parse({
      id: 'ember',
      name: 'Ember',
      scenes: [sceneSchema.parse(blankScene('room', 4, 4))],
      startScene: 'room',
      ...STARTER_PACK,
    });
    importPack(pack).apply(project);
    const ids = [...pack.cards, ...pack.abilities, ...pack.conditionDefs].map((entry) => entry.id);
    // Nothing the validator says is about the pack: every condition its cards apply, it brought.
    const about = validateProject(project).filter((problem) => ids.some((id) => problem.message.includes(`"${id}"`)));
    expect(about).toEqual([]);
  });

  it('brings the conditions it applies, which the engine no longer carries', () => {
    // The two it replaces, by the ids they had in the engine's own list.
    const engine = SRD_CONDITIONS.map((def) => def.id);
    expect(engine).not.toContain('korvax-circle');
    expect(engine).not.toContain('sitil-echo');

    const project = projectSchema.parse({
      id: 'bare',
      name: 'Bare',
      scenes: [sceneSchema.parse(blankScene('room', 4, 4))],
      startScene: 'room',
    });
    importPack(reading().pack).apply(project);
    const named = new Map((worldOptions(new Map(), undefined, undefined, project).conditionDefs ?? []).map((def) => [def.id, def.name]));
    expect(named.get('biting-ground')).toBe('Biting Circle');
    expect(named.get('echoing')).toBe('Echoing');
  });

  it("Biting Circle bites the foe beside the caster and throws it back, and not the caster's side", () => {
    const { demo, foe } = standoff('ember-circle', 'mira');
    take(demo, 'mira', ['biting-circle']);
    const mira = demo.state.entity('mira')!;
    const kara = demo.state.entity('kara')!;
    standBeside(demo, 'kara', mira.tile, [foe.tile]);
    const hurt = { mira: mira.hitPoints.marked, kara: kara.hitPoints.marked };

    expect(useAbility(demo, 'mira', 'biting-circle', []).status).not.toBe('refused');
    settle(demo);
    // Standing in it when it is drawn is a crossing, and 2d12+4 always clears a threshold.
    expect(foe.hitPoints.marked).toBeGreaterThan(0);
    expect(demo.log.some((line) => /floor bites them/.test(line.text))).toBe(true);
    expect(demo.grid.chebyshevDistance(mira.tile, foe.tile)).toBeGreaterThan(1);
    // `side: 'adversaries'`: ground under somebody else's feet only.
    expect(mira.hitPoints.marked).toBe(hurt.mira);
    expect(kara.hitPoints.marked).toBe(hurt.kara);
  });

  it('Echo Mark lends the marked ally a blow that carries the same roll to the next foe', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { demo, foe } = standoff('ember-echo-' + seed, 'kara');
      take(demo, 'mira', ['echo-mark']);
      const kara = demo.state.entity('kara')!;
      const mira = demo.state.entity('mira')!;
      mira.good = { max: 6, value: 6 };
      // A second husk stood back up beside Kara, so the echo has somewhere to go.
      const spare = demo.state.entitiesOf('adversary').find((e) => !e.alive)!;
      spare.alive = true;
      spare.hitPoints = { max: 60, marked: 0 };
      standBeside(demo, spare.id, kara.tile, [foe.tile]);
      standBeside(demo, 'mira', kara.tile, [foe.tile, spare.tile]);
      if (demo.grid.chebyshevDistance(kara.tile, spare.tile) > 1) continue;

      demo.party.select('mira');
      expect(useAbility(demo, 'mira', 'echo-mark', ['kara']).status).not.toBe('refused');
      settle(demo);
      expect(kara.conditions.has('echoing')).toBe(true);

      demo.party.select('kara');
      const before = demo.rolls.length;
      attackWithSelected(demo, foe.id);
      settle(demo);
      const shown = demo.rolls.slice(before);
      if (shown.length < 2 || !shown[0]!.roll.success) continue;

      // The swing landed, and the echo laid the same throw against the second husk.
      expect(foe.hitPoints.marked).toBeGreaterThan(0);
      expect(spare.hitPoints.marked).toBeGreaterThan(0);
      const swing = shown[0]!.roll;
      const echo = shown[shown.length - 1]!.roll;
      expect([echo.good, echo.bad, echo.total]).toEqual([swing.good, swing.bad, swing.total]);
      // Spent: the blow it was waiting for has landed.
      expect(kara.conditions.has('echoing')).toBe(false);
      return;
    }
    throw new Error('Kara never landed a marked blow with a second husk beside her, in sixty tries');
  });
});
