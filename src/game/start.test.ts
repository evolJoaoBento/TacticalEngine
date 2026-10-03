/**
 * Slice two of New Game, Load Game and Edit Game, below the screens: what the address opens on
 * (`start.ts`), the games New Game begins kept in the browser (`game-projects.ts`) and opened by
 * `?project=` (`project-store.ts`), each game's saves kept apart (`save-slots.ts`), and the models an
 * ancestry offers (`character-models.ts`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { startOf } from './start';
import { GameProjects } from './game-projects';
import { SaveSlots, memoryStore, projectOfSlot, projectSlot, QUICK_SLOT } from './save-slots';
import { bootDemo, savesToDefault } from './project-store';
import { campProject } from './camp';
import { sheetFor } from './new-character';
import { withListedPacks } from './listed-packs';
import { CAMP_CREW } from './camp';
import { modelName, modelsForAncestry } from './character-models';

const hero = () => sheetFor({ name: 'Ash', ancestryId: 'dwarf', model: 'quim', communityId: 'ridgeborne', classId: 'guardian', subclassId: 'stalwart', domainCards: ['bare-bones', 'get-back-up'] });

describe('what the page opens on', () => {
  it('is the main menu, unless the address has chosen, or the server is the tests’', () => {
    expect(startOf('', 'file')).toEqual({ menu: true, locked: false, edit: false, load: null });
    expect(startOf('', 'builtin').menu).toBe(false);
    expect(startOf('?menu', 'builtin').menu).toBe(true);
    expect(startOf('?boot=file', 'file').menu).toBe(false);
  });

  it('opens Edit Game with the editor, and Load Game and a new game played only', () => {
    expect(startOf('?edit', 'file')).toEqual({ menu: false, locked: false, edit: true, load: null });
    expect(startOf('?play', 'file')).toEqual({ menu: false, locked: true, edit: false, load: null });
    expect(startOf('?play&project=camp-ash-1&load=s1', 'file')).toEqual({ menu: false, locked: true, edit: false, load: 's1' });
  });
});

describe('the games New Game begins', () => {
  it('are kept in the browser, newest first, without what their packs lay', () => {
    const games = new GameProjects(memoryStore(), (() => { let t = 0; return () => ++t; })());
    const first = withListedPacks(campProject(hero(), 1));
    const second = campProject(hero(), 2);
    expect(games.write(first)).toBe(true);
    expect(games.write(second)).toBe(true);
    expect(games.list().map((game) => game.id)).toEqual([second.id, first.id]);
    const kept = JSON.parse(games.read(first.id)!);
    expect(kept.packs).toEqual(['srd-characters']);
    expect(kept.classes).toEqual([]);
    expect(games.remove(first.id)).toBe(true);
    expect(games.read(first.id)).toBeNull();
    expect(games.list().map((game) => game.id)).toEqual([second.id]);
  });

  it('open by address, played and never saved over the default project, their packs laid', async () => {
    const store = memoryStore();
    const games = new GameProjects(store);
    const project = campProject(hero(), 7);
    games.write(project);
    const booted = await bootDemo({ search: `?play&project=${project.id}`, boot: 'builtin', games });
    expect(booted.source).toBe('game');
    expect(booted.problem).toBeNull();
    expect(booted.demo.project.id).toBe(project.id);
    expect(booted.demo.party.members()).toEqual(['ash']);
    expect(booted.demo.characters.get('ash')!.sheet.classId).toBe('guardian');
    expect(savesToDefault(booted.source, true)).toBe(false);

    const problems: string[] = [];
    const missing = await bootDemo({ search: '?project=gone', boot: 'builtin', games, problems });
    expect(missing.source).toBe('invalid');
    expect(problems).toEqual(['There is no game called "gone" in this browser, so the demo opened instead.']);
  });
});

describe('each game’s saves', () => {
  it('say which game they are of, and the demo’s are the ones that never said', () => {
    const slots = new SaveSlots(memoryStore());
    const mine = slots.write('{}', 'Mine', 'the camp', undefined, 'camp-ash-1')!;
    expect(projectOfSlot(mine)).toBe('camp-ash-1');
    const old = slots.write('{}', 'Old', 'the vault')!;
    expect(projectOfSlot(old)).toBe('demo');
  });

  it('have a quick save and an autosave each, the demo keeping the names it always had', () => {
    expect(projectSlot(QUICK_SLOT, 'demo')).toBe('quick');
    expect(projectSlot(QUICK_SLOT, 'camp-ash-1')).toBe('quick-camp-ash-1');
  });
});

describe('the models an ancestry offers', () => {
  const shipped = [...CAMP_CREW.map((id) => ({ id })), { id: 'elf-ranger' }, { id: 'elf-2' }, { id: 'tree-prop' }];

  it('are its own, named for it, once it has any', () => {
    expect(modelsForAncestry('elf', shipped)).toEqual(['elf-ranger', 'elf-2']);
  });

  it('are the company’s while it has none, and never a prop', () => {
    expect(modelsForAncestry('dwarf', shipped)).toEqual([...CAMP_CREW]);
    expect(modelsForAncestry('dwarf', [{ id: 'quim' }, { id: 'tree-prop' }])).toEqual(['quim']);
    expect(modelName('wood-elf-2')).toBe('Wood Elf 2');
  });
});

describe('the models this build ships', () => {
  it('give the fungril, faerie, faun and ribbet their own, and leave the rest the company', () => {
    // The ids `npm run models` names, as the manifest makes them from the files.
    const lock = JSON.parse(readFileSync('models.lock.json', 'utf8')) as { files: { path: string }[] };
    const shipped = lock.files.map((file) => ({ id: file.path.replace(/\.(glb|gltf)$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') }));
    for (const ancestry of ['fungril', 'faerie', 'faun', 'ribbet']) {
      expect(modelsForAncestry(ancestry, shipped), ancestry).toEqual([`${ancestry}-female`, `${ancestry}-male`]);
    }
    expect(modelsForAncestry('dwarf', shipped)).toEqual([...CAMP_CREW]);
  });
});
