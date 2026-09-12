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
    expect(merged.domainCards).toBe(STARTER_CHARACTERS.domainCards);
    expect(merged.classes).toBe(STARTER_CHARACTERS.classes);
  });

  it("adds the project's own content to what the pack already has", () => {
    const before = STARTER_CHARACTERS.domainCards.size;
    const merged = mergePack(STARTER_CHARACTERS, { domainCards: [FIXTURE_CARD] });

    expect(merged.domainCards.get('test-only-card')?.name).toBe('Test Only Card');
    expect(merged.domainCards.size).toBe(before + 1);
    // The pack the app shipped is not edited by a project reading it.
    expect(STARTER_CHARACTERS.domainCards.has('test-only-card')).toBe(false);
    expect(STARTER_CHARACTERS.domainCards.size).toBe(before);
  });

  it('lets the project win where both name the same id', () => {
    const shipped = [...STARTER_CHARACTERS.domainCards.values()][0]!;
    const before = STARTER_CHARACTERS.domainCards.size;
    const merged = mergePack(STARTER_CHARACTERS, {
      domainCards: [{ ...shipped, name: 'Overridden' }],
    });

    expect(merged.domainCards.get(shipped.id)?.name).toBe('Overridden');
    // Replaced, not added alongside.
    expect(merged.domainCards.size).toBe(before);
    expect(STARTER_CHARACTERS.domainCards.get(shipped.id)?.name).toBe(shipped.name);
  });

  it('merges each kind of content independently', () => {
    const merged = mergePack(STARTER_CHARACTERS, { domainCards: [FIXTURE_CARD] });
    // Carrying a card says nothing about the rest, which stays as it was.
    expect(merged.weapons).toBe(STARTER_CHARACTERS.weapons);
    expect(merged.armors).toBe(STARTER_CHARACTERS.armors);
    expect(merged.subclasses).toBe(STARTER_CHARACTERS.subclasses);
  });
});
