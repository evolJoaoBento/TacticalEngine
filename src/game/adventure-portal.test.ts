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
import { ADVENTURES, ADVENTURE_PORTAL, BUILT_IN, DEMO_VAULT_ID, PARTY_MOST, adventureChoices, beginAdventure, begunBy, partyFor, withOffers } from './adventure-portal';
import { buildDemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { characterContentFor } from './room';
import { deriveCharacter } from '../engine/character/sheet';
import { COMPANIONS } from './camp-company';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { AdventureLibrary, adventureFromText } from './adventure-library';
import { ASHWELL_ID, ASHWELL_PARTY } from './adventures/ashwell';
import { GameProjects } from './game-projects';
import { memoryStore } from './save-slots';
import { portalView } from './ui/play-views';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);
const CAMP = resolve(here, '../../tests/fixtures/camp-wren.json');
const LICHGATE = resolve(here, '../../tests/fixtures/adventure-lichgate.json');

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
    expect(open!.adventures!.map(({ id, name, blurb }) => ({ id, name, blurb }))).toEqual(adventureChoices().map(({ id, name, blurb }) => ({ id, name, blurb })));
    expect(open!.adventures!.map((adventure) => adventure.id)).toEqual([ASHWELL_ID, DEMO_VAULT_ID]);
    // The Ashwell is the party's to play; the Demo Vault keeps its own, and says who goes.
    expect(open!.adventures!.map((adventure) => adventure.party)).toEqual([undefined, 'Played by its own party: Wren, Quim, Violet, Scarlet. The companions wait at the camp.']);
    // Drawing the chooser read nothing that either game would keep: the boards are the same.
    expect(firstDifference(boardOf(demo), engine.board() as BoardSnapshot, 'board')).toBeNull();
    open!.onClose();
    expect((engine.board() as BoardSnapshot).opened).toBeNull();
  });
});

describe('the portal at a shared game', () => {
  it('shows a page not the host’s who chooses, and no adventure of its own to begin', () => {
    const camp = campProject(WREN, 0);
    const [scene, project] = [camp.scenes[0]!, camp];
    const acts = { begin: () => {}, close: () => {} };
    const theirs = portalView({ scene, project }, ADVENTURE_PORTAL, [], acts, 'Hana');
    expect(theirs).toMatchObject({ id: ADVENTURE_PORTAL, name: 'The portal', lines: [], adventures: [], chooser: 'Hana' });
    // The host's, and a page alone: the adventures to choose from, nobody else choosing.
    const ours = portalView({ scene, project }, ADVENTURE_PORTAL, adventureChoices(), acts);
    expect(ours.chooser).toBeUndefined();
    expect(ours.adventures!.map((adventure) => adventure.id)).toContain(ASHWELL_ID);
    expect(ours.adventures!.every((adventure) => adventure.offered === undefined)).toBe(true);
    // A guest's own, each offered to the host or not yet; and on the host's, one a guest offered, saying who.
    const own = [{ id: 'the-lichgate', name: 'The Lichgate', blurb: 'A churchyard.', imported: true as const, build: () => null }, { id: 'the-mire', name: 'The Mire', blurb: 'Wet.', imported: true as const, build: () => null }];
    const offering = portalView({ scene, project }, ADVENTURE_PORTAL, own, acts, 'Hana', ['the-mire']);
    expect(offering.adventures!.map((adventure) => [adventure.id, adventure.offered])).toEqual([['the-lichgate', false], ['the-mire', true]]);
    // What the others offered comes after the host's own; one of an id the host has already is the host's.
    const gus = { id: 'g', name: 'Gus' };
    const offers = [{ id: 'the-lichgate', name: 'The Lichgate', blurb: 'A churchyard.', by: gus }, { id: ASHWELL_ID, name: 'Not the Ashwell', blurb: '', by: gus }, { id: 'kept', name: 'Kept', blurb: '', by: gus, ownParty: [{ id: 'kara', name: 'Quim' }] }];
    const merged = withOffers(adventureChoices(), offers);
    expect(merged.map((choice) => [choice.id, choice.offeredBy])).toEqual([[ASHWELL_ID, undefined], [DEMO_VAULT_ID, undefined], ['the-lichgate', 'Gus'], ['kept', 'Gus']]);
    expect(merged[3]!.ownParty).toEqual([{ id: 'kara', name: 'Quim' }]);
    expect(merged[2]!.build([WREN])).toBeNull();
    const offeredToUs = portalView({ scene, project }, ADVENTURE_PORTAL, [{ ...own[0]!, offeredBy: 'Gus' }], acts);
    expect(offeredToUs.adventures).toEqual([{ id: 'the-lichgate', name: 'The Lichgate', blurb: 'A churchyard.', offeredBy: 'Gus' }]);
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
    const project = begunBy(ashwell, [WREN, quim], 1000)!;
    expect(project.id).toBe(`${ASHWELL_ID}-${(1000).toString(36)}`);
    expect(project.name).toBe("The Ashwell (Wren's party)");
    expect(project.party.map((sheet) => sheet.id)).toEqual(['wren', 'quim']);
    expect(project.packs).toEqual(['srd-characters']);
    expect(begunBy(ashwell, [WREN], 2000)!.id).not.toBe(project.id);
  });

  it('is kept among the browser’s games, and opens with the party in it', () => {
    const games = new GameProjects(memoryStore());
    const id = beginAdventure(games, ASHWELL_ID, [WREN], ADVENTURES, 5000);
    expect(id).toBe(`${ASHWELL_ID}-${(5000).toString(36)}`);
    expect(games.list().map((game) => game.id)).toEqual([id]);
    const kept = projectSchema.parse(JSON.parse(games.read(id!)!));
    const problems: string[] = [];
    const demo = buildProjectScene(withListedPacks(kept, problems), kept.id);
    expect(problems).toEqual([]);
    expect(demo.party.members()).toEqual(['wren']);
    expect(demo.scene.id).toBe(projectSchema.parse(ashwell.build([WREN])).startScene);
  });

  it('may be one imported: offered after this build\u2019s own, played by the party with the pack they are made of', () => {
    const library = new AdventureLibrary(memoryStore(), () => 7);
    const lichgate = adventureFromText(readFileSync(LICHGATE, 'utf8'), BUILT_IN);
    if (typeof lichgate === 'string') throw new Error(lichgate);
    expect(library.install(lichgate)).toBe(true);
    const choices = adventureChoices(library);
    expect(choices.map((adventure) => [adventure.id, adventure.imported ?? false])).toEqual([[ASHWELL_ID, false], [DEMO_VAULT_ID, false], ['the-lichgate', true]]);
    expect(choices[2]!.blurb).toMatch(/^A churchyard gone to moss/);
    expect(choices[2]!.ownParty).toBeUndefined();
    const games = new GameProjects(memoryStore());
    const id = beginAdventure(games, 'the-lichgate', [WREN, ASHWELL_PARTY[0]!], choices, 9000);
    expect(id).toBe(`the-lichgate-${(9000).toString(36)}`);
    const kept = projectSchema.parse(JSON.parse(games.read(id!)!));
    expect(kept.name).toBe("The Lichgate (Wren's party)");
    expect(kept.packs).toEqual(['srd-characters']);
    const problems: string[] = [];
    const demo = buildProjectScene(withListedPacks(kept, problems), kept.id);
    expect(problems).toEqual([]);
    expect(demo.party.members()).toEqual(['wren', 'quim']);
    expect(demo.scene.id).toBe('lichgate-yard');
  });

  it('is not one imported that has gone since the window was drawn', () => {
    const library = new AdventureLibrary(memoryStore());
    const lichgate = adventureFromText(readFileSync(LICHGATE, 'utf8'), BUILT_IN);
    if (typeof lichgate === 'string') throw new Error(lichgate);
    library.install(lichgate);
    const choices = adventureChoices(library);
    library.remove('the-lichgate');
    expect(beginAdventure(new GameProjects(memoryStore()), 'the-lichgate', [WREN], choices)).toBeNull();
  });

  it('never offers an imported one in place of this build\u2019s own', () => {
    const store = memoryStore();
    const library = new AdventureLibrary(store);
    // Put there by hand, past the import that refuses it.
    library.install({ ...projectSchema.parse(JSON.parse(readFileSync(LICHGATE, 'utf8'))), id: ASHWELL_ID });
    expect(adventureChoices(library).filter((adventure) => adventure.id === ASHWELL_ID)).toEqual([ADVENTURES[0]]);
  });

  it('is not begun when there is no such adventure, or no room to keep it', () => {
    expect(beginAdventure(new GameProjects(memoryStore()), DEMO_VAULT_ID, [WREN], [])).toBeNull();
    expect(beginAdventure(new GameProjects(memoryStore()), 'no-such-adventure', [WREN])).toBeNull();
    const full = new GameProjects({ ...memoryStore(), set: () => { throw new Error('QuotaExceededError'); } });
    expect(beginAdventure(full, ASHWELL_ID, [WREN])).toBeNull();
  });
});

describe('an adventure that keeps its party', () => {
  const quim = sheetFor(COMPANIONS[0]!.creation);
  const sheets = (ids: string[]) => ids.map((id) => ({ id }));

  it('is played by its own party and whoever leads the party that comes - four at most - the rest waiting', () => {
    const own = sheets(['kara', 'finn', 'mira', 'arty', 'pint']);
    expect(partyFor(false, own, sheets(['wren', 'quim']))).toEqual(sheets(['wren', 'quim']));
    expect(partyFor(true, own, sheets(['wren', 'quim']))).toEqual(sheets(['wren', 'kara', 'finn', 'mira']));
    expect(partyFor(true, own, sheets(['wren']))).toHaveLength(PARTY_MOST);
    // One of its own with the leader's id stays behind, the leader in their place; a party too small goes whole.
    expect(partyFor(true, own, sheets(['finn']))).toEqual(sheets(['finn', 'kara', 'mira', 'arty']));
    expect(partyFor(true, sheets(['kara']), sheets(['wren']))).toEqual(sheets(['wren', 'kara']));
    expect(partyFor(true, own, [])).toEqual(sheets(['kara', 'finn', 'mira', 'arty']));
  });

  it('is the Demo Vault: begun by Wren and a companion, it is Wren and the vault\u2019s own, each as they were written', () => {
    const vault = adventureChoices().find((adventure) => adventure.id === DEMO_VAULT_ID)!;
    expect(vault.ownParty!.map((member) => member.name).slice(0, 3)).toEqual(['Quim', 'Violet', 'Scarlet']);
    const games = new GameProjects(memoryStore());
    const id = beginAdventure(games, DEMO_VAULT_ID, [WREN, quim], ADVENTURES, 6000);
    expect(id).toBe(`${DEMO_VAULT_ID}-${(6000).toString(36)}`);
    const kept = projectSchema.parse(JSON.parse(games.read(id!)!));
    expect(kept.name).toBe("Demo Vault (Wren's party)");
    expect(kept.fixedParty).toBe(true);
    expect(kept.party.map((sheet) => sheet.id)).toEqual(['wren', 'kara', 'finn', 'mira']);
    const problems: string[] = [];
    const demo = buildProjectScene(withListedPacks(kept, problems), kept.id);
    expect(problems).toEqual([]);
    expect(demo.party.members()).toEqual(['wren', 'kara', 'finn', 'mira']);
    // On the board, every one of them, Wren beside the vault's own.
    for (const member of demo.party.members()) expect(demo.state.entity(member)?.tile ?? -1).toBeGreaterThanOrEqual(0);
    // Each made whole of the content there is - Wren of the SRD's pack, the vault's own as the vault makes them alone:
    // Scarlet is human, and the SRD's Human, kept the newcomer's (`keep-own.ts`), gives her nothing of its own.
    const content = characterContentFor(demo.project);
    for (const sheet of demo.project.party) expect(deriveCharacter(sheet, content, demo.project.abilities).issues).toEqual([]);
    const alone = buildDemoScene(hollowVaultMap()).project;
    const aloneContent = characterContentFor(alone);
    const theirs = (id: string, project: typeof alone, from: typeof content) => deriveCharacter(project.party.find((sheet) => sheet.id === id)!, from, project.abilities).character!;
    for (const id of ['kara', 'finn', 'mira']) expect(theirs(id, demo.project, content)).toEqual(theirs(id, alone, aloneContent));
  });

  it('may be one imported, said so in its project: its own party offered, and played', () => {
    const library = new AdventureLibrary(memoryStore(), () => 7);
    const lichgate = adventureFromText(readFileSync(LICHGATE, 'utf8'), BUILT_IN);
    if (typeof lichgate === 'string') throw new Error(lichgate);
    library.install({ ...lichgate, fixedParty: true, party: [characterSheetSchema.parse(quim)] });
    const choice = adventureChoices(library).find((adventure) => adventure.id === 'the-lichgate')!;
    expect(choice.ownParty).toEqual([{ id: 'quim', name: 'Quim' }]);
    expect(choice.build([WREN, ASHWELL_PARTY[1]!])!.party.map((sheet) => sheet.id)).toEqual(['wren', 'quim']);
  });
});
