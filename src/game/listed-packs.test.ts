/**
 * A project's listed packs (`listed-packs.ts`): laid over it as it opens, the project's own entry
 * winning; left out of what is saved, unless the editor has made an entry the project's own; listed
 * and unlisted as one undo step; and a name nothing ships said, not thrown.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { cardDefSchema } from '../engine/content/pack/schema';
import { EditorSession } from '../editor/session';
import { characterContentFor } from './room';
import { shippedPack, togglePack, withListedPacks, withoutPackEntries } from './listed-packs';

const project = (packs: string[] = [], extra: Partial<ProjectDoc> = {}): ProjectDoc =>
  projectSchema.parse({ id: 'p', name: 'P', scenes: [sceneSchema.parse(blankScene('hall', 8, 8))], startScene: 'hall', packs, ...extra });

describe('the shipped SRD characters pack', () => {
  it('holds every class, subclass, ancestry and community, and the cards and scripts they run', () => {
    const pack = shippedPack('srd-characters')!;
    expect([pack.classes.length, pack.subclasses.length, pack.ancestries.length, pack.communities.length]).toEqual([9, 18, 18, 9]);
    expect(pack.cards.length).toBeGreaterThan(300);
    expect(pack.abilities.length).toBeGreaterThan(100);
    expect(pack.weapons).toEqual([]);
    expect(pack.adversaries).toEqual([]);
    expect(shippedPack('no-such-pack')).toBeNull();
  });
});

describe('a project that lists it', () => {
  it('is played with it: its classes are there to build a character from', () => {
    const opened = withListedPacks(project(['srd-characters']));
    const content = characterContentFor(opened);
    expect(content.classes.has('guardian')).toBe(true);
    expect(content.ancestries.has('elf')).toBe(true);
    expect(characterContentFor(project()).classes.has('guardian')).toBe(false);
  });

  it('keeps its own entry where it has one of the same id', () => {
    const own = cardDefSchema.parse({ id: 'bare-bones', name: 'Mine', grant: { kind: 'chosen' }, domain: 'valor', type: 'ability', level: 1, recallCost: 0, text: 'Ours.' });
    const opened = withListedPacks(project(['srd-characters'], { cards: [own] }));
    // Bare Bones is a card the pack ships too: it is the project's that stands.
    expect(shippedPack('srd-characters')!.cards.some((card) => card.id === own.id)).toBe(true);
    const cards = opened.cards.filter((card) => card.id === own.id);
    expect(cards).toEqual([own]);
  });

  it('saves without what the pack laid, but with what the editor made its own', () => {
    const opened = withListedPacks(project(['srd-characters']));
    expect(opened.classes.length).toBe(9);
    const edited = opened.cards[0]!;
    edited.name = 'Renamed where it stands';
    const saved = withoutPackEntries(opened);
    expect(saved.classes).toEqual([]);
    expect(saved.cards).toEqual([edited]);
    expect(saved.packs).toEqual(['srd-characters']);
    // And the file reopens to the same project.
    const again = withListedPacks(projectSchema.parse(JSON.parse(JSON.stringify(saved))));
    expect(again.classes.length).toBe(9);
    expect(again.cards.find((card) => card.id === edited.id)!.name).toBe('Renamed where it stands');
  });

  it('says so, and opens without it, when it lists a pack this build does not have', () => {
    const problems: string[] = [];
    withListedPacks(project(['long-gone']), problems);
    expect(problems).toEqual(['This project lists a pack called "long-gone", which this build does not have, so it opened without it.']);
  });
});

describe('listing a pack in the editor', () => {
  it('brings its entries in, and takes them out again, one undo step each way', () => {
    const session = new EditorSession(project());
    session.run(togglePack('srd-characters'));
    expect(session.project.packs).toEqual(['srd-characters']);
    expect(session.project.classes.length).toBe(9);
    session.undo();
    expect(session.project.packs).toEqual([]);
    expect(session.project.classes).toEqual([]);
    session.redo();
    expect(session.project.classes.length).toBe(9);
    session.run(togglePack('srd-characters'));
    expect(session.project.packs).toEqual([]);
    expect(session.project.cards).toEqual([]);
  });
});

describe('what New Game shows of the pack', () => {
  it('has its words on every feature an ancestry, community, class or subclass foundation prints - but one the export lacks', () => {
    const pack = shippedPack('srd-characters')!;
    const shown = pack.cards.filter((card) => ['ancestry', 'community', 'class'].includes(card.grant.kind) || (card.grant.kind === 'subclass' && card.grant.stage === 'foundation'));
    const blank = shown.filter((card) => card.text === '' && card.features.length === 0).map((card) => card.id);
    // Rogue's Dodge came out of the export with no text in either file; it is not made up here.
    expect(blank).toEqual(['rogue-rogues-dodge']);
  });
});
