/**
 * The adventures a player imported (`adventure-library.ts`): a project file checked as one opened by hand is, kept in
 * the browser with what the menu and the portal show of it, read back whole, removed - and refused, in words, when it
 * is not a project, would take the id of one this build writes, or will not fit.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import { withListedPacks } from './listed-packs';
import { AdventureLibrary, adventureFromText, blurbOf, importAdventure } from './adventure-library';
import { BUILT_IN } from './adventure-portal';
import { ashwellProject } from './adventures/ashwell';
import { memoryStore } from './save-slots';

const here = dirname(fileURLToPath(import.meta.url));
const TEXT = readFileSync(resolve(here, '../../tests/fixtures/adventure-lichgate.json'), 'utf8');
const lichgate = (): ProjectDoc => projectSchema.parse(JSON.parse(TEXT));

describe('a project file as an adventure', () => {
  it('is taken when it is a project, migrated and checked', () => {
    const project = adventureFromText(TEXT, BUILT_IN);
    expect(typeof project).toBe('object');
    expect(project).toEqual(lichgate());
  });

  it('is refused, and says why, when it is not one', () => {
    expect(adventureFromText('not json', BUILT_IN)).toBe('That file is not a project the engine can play: it is not a project file at all.');
    expect(adventureFromText(JSON.stringify({ id: 'x', scenes: [], startScene: 7 }), BUILT_IN)).toMatch(/^That file is not a project the engine can play \(.+\)\.$/);
  });

  it('is refused when it would take the id of one this build writes', () => {
    expect(adventureFromText(JSON.stringify(ashwellProject()), BUILT_IN)).toBe('That is The Ashwell, which this build has already.');
  });
});

describe('the library', () => {
  it('keeps an adventure with its name and a line from its first room, newest first, and reads it back whole', () => {
    let at = 100;
    const library = new AdventureLibrary(memoryStore(), () => at++);
    expect(library.install(lichgate())).toBe(true);
    expect(library.install({ ...lichgate(), id: 'second', name: '' })).toBe(true);
    expect(library.list().map((adventure) => [adventure.id, adventure.name, adventure.installedAt])).toEqual([['second', 'second', 101], ['the-lichgate', 'The Lichgate', 100]]);
    expect(library.list()[1]!.blurb).toBe(lichgate().scenes[0]!.intro);
    expect(library.read('the-lichgate')).toEqual(lichgate());
    expect(library.read('nothing')).toBeNull();
  });

  it('keeps one again in place of the last of its id', () => {
    const library = new AdventureLibrary(memoryStore());
    library.install(lichgate());
    library.install({ ...lichgate(), name: 'The Lichgate, again' });
    expect(library.list().map((adventure) => adventure.name)).toEqual(['The Lichgate, again']);
  });

  it('keeps no pack’s entries: the packs it lists are laid again when it is opened', () => {
    const library = new AdventureLibrary(memoryStore());
    const laid = withListedPacks({ ...lichgate(), packs: ['srd-characters'] });
    expect(laid.cards.length).toBeGreaterThan(0);
    library.install(laid);
    expect(library.read('the-lichgate')!.cards).toEqual([]);
    expect(library.read('the-lichgate')!.packs).toEqual(['srd-characters']);
  });

  it('removes one, and lists it no more', () => {
    const library = new AdventureLibrary(memoryStore());
    library.install(lichgate());
    expect(library.remove('the-lichgate')).toBe(true);
    expect(library.list()).toEqual([]);
    expect(library.read('the-lichgate')).toBeNull();
  });

  it('keeps nothing of one the browser had no room for', () => {
    const map = new Map<string, string>();
    const store = memoryStore(map);
    let room = 1;
    const library = new AdventureLibrary({ ...store, set: (key, value) => { if (room-- <= 0) throw new Error('QuotaExceededError'); store.set(key, value); } });
    // The project's own key went in; the index would not.
    expect(library.install(lichgate())).toBe(false);
    expect([...map.keys()]).toEqual([]);
    expect(library.list()).toEqual([]);
  });

  it('reads nothing of one that no longer reads as a project', () => {
    const map = new Map<string, string>();
    const library = new AdventureLibrary(memoryStore(map));
    library.install(lichgate());
    map.set('tactical:adventure:the-lichgate', '{"broken"');
    expect(library.read('the-lichgate')).toBeNull();
    // JSON still, but no project.
    map.set('tactical:adventure:the-lichgate', '{"id": 5}');
    expect(library.read('the-lichgate')).toBeNull();
  });
});

describe('an import', () => {
  it('says what came in, or why nothing did', () => {
    const library = new AdventureLibrary(memoryStore());
    expect(importAdventure(library, TEXT, BUILT_IN)).toEqual({ imported: 'The Lichgate' });
    expect(importAdventure(library, 'nope', BUILT_IN)).toEqual({ refused: 'That file is not a project the engine can play: it is not a project file at all.' });
    const full = new AdventureLibrary({ ...memoryStore(), set: () => { throw new Error('QuotaExceededError'); } });
    expect(importAdventure(full, TEXT, BUILT_IN)).toEqual({ refused: 'This browser has no room left to keep it.' });
  });
});

describe('what is said of an adventure', () => {
  it('is its first room’s opening words, cut short when long, or how many rooms it has', () => {
    const project = lichgate();
    expect(blurbOf(project)).toBe(project.scenes[0]!.intro);
    const long = { ...project, scenes: [{ ...project.scenes[0]!, intro: 'word '.repeat(100) }] };
    expect(blurbOf(long)).toHaveLength(220);
    expect(blurbOf(long).endsWith('…')).toBe(true);
    expect(blurbOf({ ...project, scenes: [{ ...project.scenes[0]!, intro: '' }] })).toBe('One room.');
    expect(blurbOf({ ...project, scenes: [{ ...project.scenes[0]!, intro: '' }, { ...project.scenes[0]!, id: 'b', intro: 'no' }] })).toBe('2 rooms.');
  });
});
