import { describe, expect, it } from 'vitest';
import { codeQuestion } from './code-question';

describe('the question asked before code comes in', () => {
  it('names each script, by its name and id or its id alone, and what code can do', () => {
    const asked = codeQuestion('pack.json', [{ id: 'mark', name: 'Mark the page' }, { id: 'rally', name: '' }], 'Import');
    expect(asked.split('\n\n')).toEqual([
      'pack.json carries code: 2 scripts -- Mark the page (mark), rally.',
      'Code in a pack runs inside the game with everything the game can reach. It is not sandboxed.',
      'Import it only if you trust whoever made it. Import it, code and all?',
    ]);
    expect(codeQuestion('camp.json', [{ id: 'mark', name: '' }], 'Load')).toMatch(/^camp\.json carries code: one script -- mark\.[\s\S]*Load it, code and all\?$/);
  });
});
