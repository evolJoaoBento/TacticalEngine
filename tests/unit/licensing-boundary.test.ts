import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * The licensing boundary, as a test.
 *
 * Only vendored SRD *text* and our own code belong in this repository. The
 * Darrington Press Community Gaming License covers the System Reference
 * Document — rules text and mechanics. It does not cover Critical Role's
 * artwork, and a fan mirror is not a licence.
 *
 * `tools/download-card-art.mjs` fetches 191 card illustrations (~89 MB) from a
 * third-party mirror into `public/cards/`. Fetching them onto a developer's own
 * disk is fine; committing them is redistribution nobody granted us the right
 * to do. And a blob committed once is in history for good — `git rm` only adds
 * a deletion commit, every clone still pulls the files, and undoing it properly
 * means rewriting history and breaking every clone and fork.
 *
 * So the ignore rule is load-bearing, and this pins it. If this test fails,
 * restore the rule rather than deleting the test: it is the guard, not the
 * problem. Card faces drawn from the vendored SRD text carry no risk at all,
 * and that is the direction to build in.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative: string): string => readFileSync(resolve(repoRoot, relative), 'utf8');

/** Where the downloader puts what it fetches. */
const ART_DIRECTORY = 'public/cards';

describe('the licensing boundary', () => {
  it('ignores the scraped card art, so it can never be committed', () => {
    const ignored = read('.gitignore')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    // `public/cards/`, `public/cards`, `/public/cards/` all cover it.
    const covers = ignored.some((rule) => rule.replace(/^\/+|\/+$/g, '') === ART_DIRECTORY);

    expect(
      covers,
      `.gitignore must ignore "${ART_DIRECTORY}/". The card illustrations there are Critical ` +
        'Role artwork fetched from a third-party mirror, not SRD content, and nothing licenses ' +
        'them for redistribution. Committing them puts ~89 MB into git history permanently: a ' +
        'later delete does not remove a blob, only a history rewrite does, and that breaks every ' +
        'clone. Restore the rule instead of deleting this test.',
    ).toBe(true);
  });

  it('keeps the downloader pointed inside the ignored directory', () => {
    // If the downloader ever writes somewhere else, the rule above stops
    // covering it and the art quietly becomes committable again.
    const downloader = read('tools/download-card-art.mjs');

    expect(
      downloader.includes(ART_DIRECTORY),
      `tools/download-card-art.mjs must write under "${ART_DIRECTORY}/", which .gitignore covers. ` +
        'If the destination changed, move the ignore rule with it.',
    ).toBe(true);
  });

  it('does not vendor the source PDF, only the extracted text', () => {
    // The same boundary, one level up: the SRD text is vendored, the PDF it was
    // extracted from is deliberately not.
    const readme = read('tools/srd-sources/official-2.0/README.md');
    expect(readme).toContain('Daggerheart System Reference Document');
    expect(readme).toContain('Critical Role, LLC');
  });
});
