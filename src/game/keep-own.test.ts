/**
 * Each keeps their own (`keep-own.ts`): an adventure that keeps its party, joined by a character of a pack it does not
 * carry, where the two define one thing by one id - the Demo Vault's Human and the SRD's; a class, its subclasses, and
 * a level multiclassed into it, in a project written for the test.
 */

import { describe, expect, it } from 'vitest';
import { deriveCharacter } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { DEMO_VAULT_ID, ADVENTURES, beginAdventure } from './adventure-portal';
import { buildDemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { GameProjects } from './game-projects';
import { keepEachOwn, ownId } from './keep-own';
import { withListedPacks } from './listed-packs';
import { sheetFor } from './new-character';
import { characterContentFor } from './room';
import { memoryStore } from './save-slots';

const ASH = sheetFor({ name: 'Ash', ancestryId: 'human', model: 'violet', communityId: 'highborne', classId: 'guardian', subclassId: 'stalwart', domainCards: [] });
const derived = (sheet: Parameters<typeof deriveCharacter>[0], project: Parameters<typeof characterContentFor>[0] & { abilities: Parameters<typeof deriveCharacter>[2] }) =>
  deriveCharacter(sheet, characterContentFor(project), project.abilities);

describe('an adventure that keeps its party, and a newcomer of another pack', () => {
  it('keeps the Demo Vault’s Human the vault’s, and the SRD’s Human the newcomer’s', () => {
    const games = new GameProjects(memoryStore());
    const id = beginAdventure(games, DEMO_VAULT_ID, [ASH], ADVENTURES, 1);
    const kept = projectSchema.parse(JSON.parse(games.read(id!)!));
    const laid = withListedPacks(structuredClone(kept));
    // The newcomer: the SRD's Human under an id of its own, and every feature the SRD gives it - as in a camp of the
    // SRD, where the starter's Human gives an SRD Human nothing of its own (`mergePack`), Adaptable never among them.
    const ash = laid.party.find((sheet) => sheet.id === 'ash')!;
    expect(ash.ancestryId).toBe(ownId('human', 'srd-characters'));
    const theirs = derived(ash, laid);
    expect(theirs.issues).toEqual([]);
    const camp = withListedPacks(projectSchema.parse({ id: 'camp', scenes: [sceneSchema.parse(blankScene('room', 4, 4))], startScene: 'room', packs: ['srd-characters'], party: [ASH] }));
    const asMade = derived(camp.party[0]!, camp);
    const names = (from: typeof theirs) => from.character!.granted.map((card) => card.name);
    expect(names(theirs)).toEqual(expect.arrayContaining(['High Stamina', 'Adaptability']));
    expect(names(asMade)).not.toContain('Adaptable');
    expect(names(theirs).sort()).toEqual(names(asMade).sort());
    expect({ ...theirs.character!, granted: [], sheet: null }).toEqual({ ...asMade.character!, granted: [], sheet: null });
    // The vault's own, exactly as the vault makes them alone: Scarlet's Human is the vault's.
    const alone = buildDemoScene(hollowVaultMap()).project;
    for (const member of ['kara', 'finn', 'mira']) {
      const here = laid.party.find((sheet) => sheet.id === member)!;
      expect(derived(here, laid)).toEqual(derived(alone.party.find((sheet) => sheet.id === member)!, alone));
    }
  });

  it('keeps a class of the adventure’s, its subclasses the pack’s own, and a level multiclassed into it pointed with them', () => {
    const scene = sceneSchema.parse(blankScene('room', 4, 4));
    const own = { id: 'guardian', name: 'Gate Warden', domains: ['valor'], startingEvasion: 12, startingHitPoints: 9 };
    const project = projectSchema.parse({ id: 'keep', scenes: [scene], startScene: 'room', fixedParty: true, classes: [own] });
    const levelled = characterSheetSchema.parse({ ...ASH, level: 2, levels: [{ level: 2, advancements: [{ kind: 'multiclass', classId: 'guardian', domain: 'valor' }, { kind: 'hitPoint' }], domainCard: 'body-basher' }] });
    const { project: out, sheet } = keepEachOwn(project, levelled, 'srd-characters');
    const fresh = ownId('guardian', 'srd-characters');
    expect(sheet.classId).toBe(fresh);
    expect(sheet.levels![0]!.advancements[0]).toEqual({ kind: 'multiclass', classId: fresh, domain: 'valor' });
    // The adventure's class stays its own; the pack's is beside it, and its subclasses and the cards it grants go with it.
    expect(out.classes.find((entry) => entry.id === 'guardian')).toEqual(own);
    expect(out.classes.find((entry) => entry.id === fresh)!.name).toBe('Guardian');
    expect(out.subclasses.filter((entry) => ['stalwart', 'vengeance'].includes(entry.id)).map((entry) => entry.classId)).toEqual([fresh, fresh]);
    const granted = out.cards.filter((card) => card.grant.kind === 'class');
    expect(granted.length).toBeGreaterThan(0);
    expect(granted.every((card) => card.grant.kind === 'class' && card.grant.classId === fresh)).toBe(true);
    // Laid with the pack, the adventure's guardian is still its own, and the newcomer still the SRD's.
    const laid = withListedPacks({ ...structuredClone(out), packs: ['srd-characters'], party: [characterSheetSchema.parse(sheet)] });
    expect(laid.classes.find((entry) => entry.id === 'guardian')).toEqual(own);
    expect(derived(laid.party[0]!, laid).issues).toEqual([]);
    // Nobody's sheet but the newcomer's moves, and the project handed in is not touched.
    expect(project.classes).toEqual([own]);
    expect(levelled.classId).toBe('guardian');
  });

  it('keeps the adventure’s own whoever the newcomer is - the pack is laid whole - and leaves an unknown pack be', () => {
    const project = projectSchema.parse({ id: 'plain', scenes: [sceneSchema.parse(blankScene('room', 4, 4))], startScene: 'room', fixedParty: true });
    const elf = sheetFor({ name: 'Wren', ancestryId: 'elf', model: 'violet', communityId: 'wildborne', classId: 'ranger', subclassId: 'wayfinder', domainCards: [] });
    // An elf: their sheet as it was, but the SRD's Human still kept from whoever in the adventure is human.
    const kept = keepEachOwn(project, elf, 'srd-characters');
    expect(kept.sheet).toEqual(elf);
    expect(kept.project.ancestries.map((entry) => entry.id)).toEqual(['human', ownId('human', 'srd-characters')]);
    expect(kept.project.cards.map((card) => card.grant)).toEqual([
      { kind: 'ancestry', ancestryId: ownId('human', 'srd-characters') },
      { kind: 'ancestry', ancestryId: ownId('human', 'srd-characters') },
    ]);
    expect(keepEachOwn(project, ASH, 'no-such-pack')).toEqual({ project, sheet: ASH });
  });

  it('keeps one of each, begun again from a game it was kept in - an adventure exported, imported, begun', () => {
    const project = projectSchema.parse({ id: 'twice', scenes: [sceneSchema.parse(blankScene('room', 4, 4))], startScene: 'room', fixedParty: true, classes: [{ id: 'guardian', name: 'Gate Warden', domains: ['valor'], startingEvasion: 12, startingHitPoints: 9 }] });
    const once = keepEachOwn(project, ASH, 'srd-characters');
    const twice = keepEachOwn(once.project, ASH, 'srd-characters');
    for (const list of ['classes', 'subclasses', 'ancestries', 'cards'] as const) {
      const ids = (twice.project[list] as { id: string }[]).map((entry) => entry.id);
      expect(new Set(ids).size, list).toBe(ids.length);
      expect(ids, list).toEqual((once.project[list] as { id: string }[]).map((entry) => entry.id));
    }
    expect(projectSchema.safeParse(twice.project).success).toBe(true);
  });
});
