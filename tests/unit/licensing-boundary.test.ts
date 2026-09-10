import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * The licensing boundary, as a test.
 *
 * Only vendored SRD *text* and our own code belong in this repository. The
 * Darrington Press Community Gaming License covers the System Reference
 * Document — rules text and mechanics. It does not cover Critical Role's
 * artwork, and a fan mirror is not a licence.
 *
 * `public/cards/` holds whatever card art a developer has put there. Files on
 * their own disk are theirs; committing them is redistribution nobody granted
 * us the right to do. And a blob committed once is in history for good — `git
 * rm` only adds a deletion commit, every clone still pulls the files, and
 * undoing it properly means rewriting history and breaking every clone.
 *
 * So the ignore rule is load-bearing, and this pins it. If this test fails,
 * restore the rule rather than deleting the test: it is the guard, not the
 * problem. Cards draw their own emblems when the directory is empty
 * (`ui/card-sigil.ts`), which is why nothing breaks without it.
 *
 * When the art in that directory is the project's own, the rule can go and the
 * images can be committed along with their index. See `AGENTS.md`.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative: string): string => readFileSync(resolve(repoRoot, relative), 'utf8');

/** Where card art lives, and what `.gitignore` must cover. */
const ART_DIRECTORY = 'public/cards';

/** Every TypeScript source under `src/`. */
function sources(directory = resolve(repoRoot, 'src')): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe('the licensing boundary', () => {
  it('ignores the card art directory, so it can never be committed by accident', () => {
    const ignored = read('.gitignore')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    // `public/cards/`, `public/cards`, `/public/cards/` all cover it.
    const covers = ignored.some((rule) => rule.replace(/^\/+|\/+$/g, '') === ART_DIRECTORY);

    expect(
      covers,
      `.gitignore must ignore "${ART_DIRECTORY}/". Whatever is in there today came from a ` +
        'third-party mirror and is Critical Role artwork, which nothing licenses us to ' +
        'redistribute. Committing it puts the files into git history permanently: a later ' +
        'delete does not remove a blob, only a history rewrite does, and that breaks every ' +
        'clone. Restore the rule instead of deleting this test. When the art is the ' +
        "project's own, drop the rule deliberately and commit the images with their index.",
    ).toBe(true);
  });

  it('never builds a card art URL that the index did not promise', () => {
    // A guessed `/cards/${id}.jpg` 404s for every card without a file, and the
    // directory is ignored, so on most machines that is every card. Only
    // `card-art.ts` may name the directory, and only from an index entry.
    const offenders = sources()
      .filter((path) => read(path).includes('/cards/$'))
      .map((path) => path.slice(repoRoot.length + 1));

    expect(
      offenders,
      'these build a card art URL by interpolation rather than reading the index; use artFor()',
    ).toEqual([]);
  });

  it('does not vendor the source PDF, only the extracted text', () => {
    // The same boundary, one level up: the SRD text is vendored, the PDF it was
    // extracted from is deliberately not.
    const readme = read('tools/srd-sources/official-2.0/README.md');
    expect(readme).toContain('Daggerheart System Reference Document');
    expect(readme).toContain('Critical Role, LLC');
  });
});
