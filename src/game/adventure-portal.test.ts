/**
 * The camp's portal (`adventure-portal.ts`): it stands in every camp, using it opens a window of the adventures there
 * are - in the engine's game and the page's alike, with nothing read that would part them - and an adventure begun is
 * a game of its own, kept in the browser, played by the party that went through. The window's engine half needs
 * `npm run wasm`, and says so without it.
 *
 * The camp the e2e begins the Ashwell at is this build's (`tests/fixtures/camp-wren.json`, which Playwright reads -
 * it cannot import the game's modules): `UPDATE_GOLDEN=1 npx vitest run src/game/adventure-portal.test.ts` writes it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema } from '../engine/scene/schema';
import { buildProjectScene } from './demo-scene';
import { boardOf, type BoardSnapshot } from './board';
import { firstDifference } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';
import { WasmGame } from './wasm-game';
import { campProject, crewPlaces, PORTAL_AT } from './camp';
import { withListedPacks } from './listed-packs';
import { sheetFor } from './new-character';
import { ADVENTURE_PORTAL, adventureChoices, beginAdventure, begunBy } from './adventure-portal';
import { ASHWELL_ID, ASHWELL_PARTY } from './adventures/ashwell';
import { GameProjects } from './game-projects';
import { memoryStore } from './save-slots';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);
const CAMP = resolve(here, '../../tests/fixtures/camp-wren.json');

const WREN = sheetFor({ name: 'Wren', ancestryId: 'elf', model: 'violet', communityId: 'wildborne', classId: 'ranger', subclassId: 'wayfinder', domainCards: ['gifted-tracker', 'natures-tongue'] });

describe('the portal at the camp', () => {
  it('stands at the clearing’s edge, on a tile nothing else takes, and opens when used', () => {
    const camp = campProject(WREN, 0);
    const scene = camp.scenes[0]!;
    const portal = scene.decos.find((deco) => deco.id === ADVENTURE_PORTAL)!;
    expect(portal.position).toEqual(PORTAL_AT);
    expect(portal.function).toMatchObject({ kind: 'script', repeatable: true, effects: [{ kind: 'openContainer' }] });
    const others = scene.decos.filter((deco) => deco !== portal).map((deco) => `${deco.position.x},${deco.position.y}`);
    expect(others).not.toContain(`${PORTAL_AT.x},${PORTAL_AT.y}`);
    expect(crewPlaces().map((figure) => `${figure.x},${figure.y}`)).not.toContain(`${PORTAL_AT.x},${PORTAL_AT.y}`);
    expect(scene.spawns).not.toContainEqual(PORTAL_AT);
  });

  it.skipIf(!built)('opens a window of the adventures there are, the engine’s game and the page’s the same after', async () => {
    const demo = buildProjectScene(withListedPacks(campProject(WREN, 0)), 'portal');
    const engine = await WasmEngine.load(readFileSync(WASM));
    const game = new WasmGame(demo, engine, shippedContent());
    game.approachThenUse(ADVENTURE_PORTAL);
    // Walked up to it, and the errand the walk was for done: the portal used.
    game.arrive();
    game.arrived();
    expect((engine.board() as BoardSnapshot).opened).toBe(ADVENTURE_PORTAL);
    const open = game.containerView(() => true, () => {});
    expect(open).toMatchObject({ id: ADVENTURE_PORTAL, name: 'The portal', lines: [] });
    expect(open!.adventures).toEqual(adventureChoices().map(({ id, name, blurb }) => ({ id, name, blurb })));
    expect(open!.adventures!.map((adventure) => adventure.id)).toContain(ASHWELL_ID);
    // Drawing the chooser read nothing that either game would keep: the boards are the same.
    expect(firstDifference(boardOf(demo), engine.board() as BoardSnapshot, 'board')).toBeNull();
    open!.onClose();
    expect((engine.board() as BoardSnapshot).opened).toBeNull();
  });
});

describe('the camp the e2e begins the Ashwell at', () => {
  it('is this build’s camp for Wren', () => {
    const now = JSON.parse(JSON.stringify(campProject(WREN, 0))) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(CAMP)) writeFileSync(CAMP, `${JSON.stringify(now)}
`, 'utf8');
    expect(JSON.parse(readFileSync(CAMP, 'utf8'))).toEqual(now);
  });
});

describe('an adventure begun', () => {
  const ashwell = adventureChoices().find((adventure) => adventure.id === ASHWELL_ID)!;

  it('is the adventure played by the party that went through, a game of its own named for who leads them', () => {
    const quim = ASHWELL_PARTY[0]!;
    const project = begunBy(ashwell, [WREN, quim], 1000);
    expect(project.id).toBe(`${ASHWELL_ID}-${(1000).toString(36)}`);
    expect(project.name).toBe("The Ashwell (Wren's party)");
    expect(project.party.map((sheet) => sheet.id)).toEqual(['wren', 'quim']);
    expect(project.packs).toEqual(['srd-characters']);
    expect(begunBy(ashwell, [WREN], 2000).id).not.toBe(project.id);
  });

  it('is kept among the browser’s games, and opens with the party in it', () => {
    const games = new GameProjects(memoryStore());
    const id = beginAdventure(games, ASHWELL_ID, [WREN], 5000);
    expect(id).toBe(`${ASHWELL_ID}-${(5000).toString(36)}`);
    expect(games.list().map((game) => game.id)).toEqual([id]);
    const kept = projectSchema.parse(JSON.parse(games.read(id!)!));
    const problems: string[] = [];
    const demo = buildProjectScene(withListedPacks(kept, problems), kept.id);
    expect(problems).toEqual([]);
    expect(demo.party.members()).toEqual(['wren']);
    expect(demo.scene.id).toBe(projectSchema.parse(ashwell.build([WREN])).startScene);
  });

  it('is not begun when there is no such adventure, or no room to keep it', () => {
    expect(beginAdventure(new GameProjects(memoryStore()), 'no-such-adventure', [WREN])).toBeNull();
    const full = new GameProjects({ ...memoryStore(), set: () => { throw new Error('QuotaExceededError'); } });
    expect(beginAdventure(full, ASHWELL_ID, [WREN])).toBeNull();
  });
});
