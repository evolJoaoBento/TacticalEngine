import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importContentPack, type ContentPack } from '../content/pack/import';

/**
 * The vendored catalogue, as the level-up rules see it: that it imports without issues, that a
 * subclass carries the domains it prints, that there are more than 150 cards to choose from, and
 * that a card's text came across.
 *
 * **This file is deleted with the catalogue.** Advancement itself is `progression.test.ts`, which
 * reads fixture content — the shipped pack stops at level 2, and a test about tier boxes needs
 * cards above it.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/daggersearch/core/${name}.json`, 'utf8'));

const imported = importContentPack({
  weapons: read('weapons'),
  armors: read('armors'),
  classes: read('classes'),
  ancestries: read('ancestries'),
  communities: read('communities'),
  subclasses: read('subclasses'),
  domainCards: read('domain-cards'),
});
const content: ContentPack = imported.content;

describe('the import', () => {
  it('reads subclasses and domain cards, with content ids', () => {
    expect(imported.issues).toEqual([]);
    expect(content.subclasses.get('stalwart')?.classId).toBe('guardian');
    expect(content.subclasses.get('stalwart')?.domains).toEqual(['valor', 'blade']);
    expect(content.subclasses.get('stalwart')?.foundation.length).toBeGreaterThan(0);
    expect(content.domainCards.size).toBeGreaterThan(150);
    const card = content.domainCards.get('bare-bones')!;
    expect(card).toMatchObject({ domain: 'valor', level: 1, type: 'ability' });
    expect(card.text.length).toBeGreaterThan(20);
  });
});
