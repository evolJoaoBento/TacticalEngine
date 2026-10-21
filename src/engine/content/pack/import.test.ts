import { describe, expect, it } from 'vitest';
import { mergePack } from './import';
import { STARTER_CHARACTERS } from './starter';

/**
 * Laying a project's own content over a pack.
 *
 * A project is played with the pack the app was given *plus* whatever it
 * carries itself, and the project wins where the two name the same id. That is
 * what makes a scenario portable — it can ship the one card it is about — and
 * it is the only reason a test needs to borrow nothing from a shipped deck.
 */

const FIXTURE_CARD = {
  id: 'test-only-card',
  name: 'Test Only Card',
  grant: { kind: 'chosen' as const },
  domain: 'bulwark',
  type: 'ability' as const,
  level: 1,
  recallCost: 0,
  text: 'A card that exists in no pack.',
  features: [],
};

describe('mergePack', () => {
  it('leaves the pack alone when a project carries nothing', () => {
    const merged = mergePack(STARTER_CHARACTERS, {});
    // The same maps, not copies of them: nothing to merge is nothing to do.
    expect(merged.cards).toBe(STARTER_CHARACTERS.cards);
    expect(merged.classes).toBe(STARTER_CHARACTERS.classes);
  });

  it("adds the project's own content to what the pack already has", () => {
    const before = STARTER_CHARACTERS.cards.size;
    const merged = mergePack(STARTER_CHARACTERS, { cards: [FIXTURE_CARD] });

    expect(merged.cards.get('test-only-card')?.name).toBe('Test Only Card');
    expect(merged.cards.size).toBe(before + 1);
    // The pack the app shipped is not edited by a project reading it.
    expect(STARTER_CHARACTERS.cards.has('test-only-card')).toBe(false);
    expect(STARTER_CHARACTERS.cards.size).toBe(before);
  });

  it('lets the project win where both name the same id', () => {
    const shipped = [...STARTER_CHARACTERS.cards.values()][0]!;
    const before = STARTER_CHARACTERS.cards.size;
    const merged = mergePack(STARTER_CHARACTERS, {
      cards: [{ ...shipped, name: 'Overridden' }],
    });

    expect(merged.cards.get(shipped.id)?.name).toBe('Overridden');
    // Replaced, not added alongside.
    expect(merged.cards.size).toBe(before);
    expect(STARTER_CHARACTERS.cards.get(shipped.id)?.name).toBe(shipped.name);
  });

  describe("a thing the project defines anew, with features of its own", () => {
    const human = STARTER_CHARACTERS.ancestries.get('human')!;
    const starters = (cards: ReadonlyMap<string, { grant: { kind: string } & Record<string, unknown> }>, kind: string, key: string, id: string) =>
      [...cards.values()].filter((card) => card.grant.kind === kind && card.grant[key] === id).map((card) => (card as unknown as { id: string }).id);
    const feature = (id: string, grant: object) => ({ id, name: id, grant, text: '', features: [] }) as never;
    const ofTheStarter = starters(STARTER_CHARACTERS.cards as never, 'ancestry', 'ancestryId', 'human');

    it("is its own whole: the base's features for it are not added to the project's", () => {
      expect(ofTheStarter.length).toBeGreaterThan(0);
      const merged = mergePack(STARTER_CHARACTERS, { ancestries: [{ ...human }], cards: [feature('human-own', { kind: 'ancestry', ancestryId: 'human' })] });
      expect(starters(merged.cards as never, 'ancestry', 'ancestryId', 'human')).toEqual(['human-own']);
      // Every other ancestry's features as they were.
      expect(merged.cards.size).toBe(STARTER_CHARACTERS.cards.size - ofTheStarter.length + 1);
    });

    it("keeps the base's when the project only adds a feature, or only redefines it, or redefines one of its own features", () => {
      // A feature added to a thing the project does not define: the Demo Vault's Hold Fast for the starter's Sentinel.
      const added = mergePack(STARTER_CHARACTERS, { cards: [feature('human-more', { kind: 'ancestry', ancestryId: 'human' })] });
      expect(starters(added.cards as never, 'ancestry', 'ancestryId', 'human')).toEqual([...ofTheStarter, 'human-more']);
      // Defined anew, with nothing of its own to give: the base's still given.
      const renamed = mergePack(STARTER_CHARACTERS, { ancestries: [{ ...human, name: 'Folk' }] });
      expect(starters(renamed.cards as never, 'ancestry', 'ancestryId', 'human')).toEqual(ofTheStarter);
      // Defined anew, and one of the base's features rewritten: that one the project's, the others the base's still.
      const first = STARTER_CHARACTERS.cards.get(ofTheStarter[0]!)!;
      const rewritten = mergePack(STARTER_CHARACTERS, { ancestries: [{ ...human }], cards: [{ ...first, name: 'Rewritten' }] });
      expect(starters(rewritten.cards as never, 'ancestry', 'ancestryId', 'human')).toEqual([ofTheStarter[0]]);
      expect(rewritten.cards.get(first.id)!.name).toBe('Rewritten');
      // In its place, as any card the project rewrites is.
      expect([...rewritten.cards.keys()].indexOf(first.id)).toBe([...STARTER_CHARACTERS.cards.keys()].indexOf(first.id));
    });

    it('holds for a class, a subclass and a community as for an ancestry', () => {
      for (const [list, kind, key] of [['classes', 'class', 'classId'], ['subclasses', 'subclass', 'subclassId'], ['communities', 'community', 'communityId']] as const) {
        const [id, def] = [...(STARTER_CHARACTERS[list] as ReadonlyMap<string, object>)][0]!;
        const theirs = starters(STARTER_CHARACTERS.cards as never, kind, key, id);
        expect(theirs.length, list).toBeGreaterThan(0);
        const merged = mergePack(STARTER_CHARACTERS, { [list]: [def], cards: [feature(`${id}-own`, { kind, [key]: id, ...(kind === 'subclass' ? { stage: 'foundation' } : {}) })] } as never);
        expect(starters(merged.cards as never, kind, key, id), list).toEqual([`${id}-own`]);
      }
    });
  });

  it('merges each kind of content independently', () => {
    const merged = mergePack(STARTER_CHARACTERS, { cards: [FIXTURE_CARD] });
    // Carrying a card says nothing about the rest, which stays as it was.
    expect(merged.weapons).toBe(STARTER_CHARACTERS.weapons);
    expect(merged.armors).toBe(STARTER_CHARACTERS.armors);
    expect(merged.subclasses).toBe(STARTER_CHARACTERS.subclasses);
  });
});
