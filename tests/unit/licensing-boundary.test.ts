import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * The licensing boundary, as a test.
 *
 * Only vendored SRD *text* and our own code belong in this repository, and a
 * third-party asset whose licence grants redistribution, shipped with that
 * licence beside it -- the play UI's font, Kreon, under the SIL OFL. The
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

  it('ignores the heavy models, so 361 MB of source never lands in history', () => {
    // The same argument as the card art, for a different reason: these are ours, so nothing
    // forbids committing them - but they are the originals every served model is lightened from,
    // nothing loads them, and a blob committed once is in history for good. A `git add -A` with
    // this rule missing is 361 MB that only a history rewrite takes back out.
    const ignored = read('.gitignore')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(
      ignored.some((rule) => rule.replace(/^\/+|\/+$/g, '') === 'public/models/heavy'),
      '.gitignore must ignore "public/models/heavy/" -- the heavy originals are kept on disk and ' +
        'out of git. Restore the rule rather than deleting this test.',
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

  it('vendors no SRD source at all, and keeps the attribution anyway', () => {
    // This used to read `tools/srd-sources/official-2.0/README.md` and check the notice there,
    // back when the repository vendored the SRD text and deliberately not the PDF it came from.
    // The sources are gone now — exported to a gitignored pack and deleted — so the claim is the
    // stronger one: nothing vendored is here to license.
    expect(existsSync(resolve(repoRoot, 'tools/srd-sources'))).toBe(false);

    // The attribution outlives the files. AGENTS.md makes keeping both notices a hard rule, and
    // docs/CONTEXT.md is where their wording lives, so that is what this pins.
    const context = read('docs/CONTEXT.md');
    expect(context).toContain('Daggerheart System Reference Document');
    expect(context).toContain('Critical Role, LLC');
    expect(context).toContain('Darrington Press Community Gaming');
    // The community data sets were SRD 1.0 and carried their own notice; both must survive.
    expect(context).toContain('SRD 1.0');
  });
});

describe('the licence the repository is under', () => {
  /**
   * The repository went public, and a public repository with no licence grants nobody anything.
   * Three files have to agree about which one it is, and they are edited at different times by
   * different people, so this is the thing that notices when one of them stops agreeing.
   */
  it('ships the licence text whole, and the section a browser game is licensed for', () => {
    const licence = read('LICENSE');
    expect(licence).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(licence).toContain('Version 3, 19 November 2007');
    // Section 13 is why this and not the GPL: the game is used over a network, never handed over.
    expect(licence).toContain('13. Remote Network Interaction');
  });

  it('says which licence in the place a tool reads and the place a person reads', () => {
    expect(JSON.parse(read('package.json')).license).toBe('AGPL-3.0-or-later');
    const notice = read('NOTICE.md');
    expect(notice).toContain('GNU Affero General Public License');
    expect(notice).toContain('https://github.com/evolJoaoBento/TacticalEngine');
  });

  it('keeps the carve-outs the licence cannot reach', () => {
    // Two things in here are not ours to relicense, and the notice is where a reader finds that
    // out. Neither line may be dropped for tidiness: the font's licence requires the credit, and
    // the rules are somebody else's Public Game Content under the DPCGL.
    const notice = read('NOTICE.md');
    expect(notice).toContain('public/fonts/kreon/OFL.txt');
    expect(notice).toContain('DPCGL');
    expect(notice).toContain('docs/CONTEXT.md');
  });
});

/**
 * The boundary, enforced rather than remembered.
 *
 * Slice 4 removed the marks, the retired product name and the paired resource terms from the
 * engine. Every one of those could come back in a single careless commit, and nothing would say so
 * — which is the same argument that made the card-art rule a test instead of a note.
 *
 * Each rule below is a *whole-repository* sweep over what git actually tracks, with exemptions that
 * are named and reasoned rather than convenient. When one of these fails, the fix is the source, not
 * the exemption list.
 */
describe('the marks stay out of the repository', () => {
  /** What git tracks is the honest definition of "in the repository". */
  const tracked = (): string[] =>
    execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .filter((line) => line !== '');

  const BINARY = /\.(png|jpe?g|gif|glb|gltf|ktx2|wasm|woff2?|ico|mp3|ogg|wav|pdf)$/i;

  const lines = (relative: string): string[] => read(relative).split(/\r?\n/);

  /**
   * Paths exempt from the mark and product-name rules. Four, each for a stated reason:
   *
   *   `legacy/`            the original prototype, which CLAUDE.md and AGENTS.md both require stay
   *                        runnable and unmodified. Its marks are its own, and three of its
   *                        `polyheart` strings are persisted localStorage keys.
   *   `docs/research/`     static analyses of that prototype, carrying `file:line` anchors into it.
   *                        They describe another codebase's vocabulary.
   *   `docs/superpowers/`  dated design and plan records. The spec that argues for removing this IP
   *                        has to be able to name it; a design record that may not say what it
   *                        removed is useless.
   *   this file            the rules below have to spell the terms they forbid. Exactly the same
   *                        case as `.gitignore:11`, which names Critical Role in order to say the
   *                        artwork may never be committed. A guard cannot be forbidden its own
   *                        vocabulary, and contorting these patterns to hide from themselves would
   *                        make them unreadable and easy to weaken by accident.
   */
  const EXEMPT = [
    /^legacy\//,
    /^docs\/research\//,
    /^docs\/superpowers\//,
    /^tests\/unit\/licensing-boundary\.test\.ts$/,
  ];
  const exempt = (path: string): boolean => EXEMPT.some((rule) => rule.test(path));

  const MARK = /daggerheart|critical role|darrington/i;

  /**
   * The licence *requires* the marks in the attribution, so the rule cannot be "never". These are
   * the phrases that make an occurrence legitimate: the two DPCGL notices, the trademark
   * disclaimer, and the explanation of where the ignored card art came from.
   */
  const LICENSING = [
    /System Reference Document/i,
    /trademark of Critical Role/i,
    /SRD content is used under/i,
    /Darrington Press Community Gaming/i,
    /Critical Role, LLC/i,
    /Public Game Content under the DPCGL/i,
    /artwork/i,
    /daggerheart\.com/i,
    /daggerheart\.su/i,
  ];

  it('names the marks only where the licence requires it', () => {
    // A window, not the line. Attribution paragraphs wrap mid-phrase — this file splits "System
    // Reference / Document" across a break at :10-11 — so a per-line rule would fail on the
    // notices themselves, and a harmless reflow would fail the boundary for no real reason.
    const WINDOW = 2;
    const offenders: string[] = [];

    for (const path of tracked()) {
      if (BINARY.test(path) || exempt(path)) continue;
      const text = lines(path);
      text.forEach((line, index) => {
        if (!MARK.test(line)) return;
        const near = text.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).join('\n');
        if (!LICENSING.some((ok) => ok.test(near))) {
          offenders.push(`${path}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }

    expect(
      offenders,
      'these name a third-party mark outside the attribution. The engine may not be branded or ' +
        'documented as somebody else\'s product. Rewrite the sentence; do not add it here.',
    ).toEqual([]);
  });

  it('ships a font only with its licence beside it', () => {
    // Kreon is the one third-party file here, and the SIL Open Font License that lets us ship it
    // requires the licence to travel with it. A font without its OFL.txt is one nobody can check.
    const files = tracked();
    const fonts = files.filter((path) => path.startsWith('public/fonts/') && /\.(woff2?|ttf|otf)$/i.test(path));
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(files, `${font} has no licence beside it`).toContain(font.replace(/[^/]+$/, 'OFL.txt'));
  });

  it('has retired the old product name everywhere but its persisted keys', () => {
    // `polyheart:saves`, `polyheart:save:` and `polyheart:card-art:` are read as a fallback so a
    // player's saves and imported art survive the rename, and `rng.test.ts` seeds with the word --
    // a seed's value picks a dice sequence, so renaming one silently re-rolls a test. Anything else
    // is branding.
    const KEY_OR_SEED = /polyheart:|polyheart-|'polyheart'/i;
    const offenders: string[] = [];

    for (const path of tracked()) {
      if (BINARY.test(path) || exempt(path)) continue;
      lines(path).forEach((line, index) => {
        if (/polyheart/i.test(line) && !KEY_OR_SEED.test(line)) {
          offenders.push(`${path}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }

    expect(
      offenders,
      'the retired product name is back. It is Tactical Engine now; the only survivors are the ' +
        'legacy storage keys read as a fallback and the RNG seeds.',
    ).toEqual([]);
  });

  it('stores the paired pools as good and bad, never the old terms', () => {
    /**
     * Five files name the old terms on purpose, and each would be broken by "fixing" it:
     *
     *   migrate.ts / migrate.test.ts   the version-1 -> 2 migration reads the old field names and
     *                                  its test tables them beside the new ones. Renaming these
     *                                  stops the migration migrating while every test still passes.
     *   legacy-import.ts / .test.ts    OUTCOME_KEYS maps the prototype's own document keys, which
     *                                  `legacy/` never changes. Only their values moved.
     *   pack/schema.test.ts            asserts `costsFear` is ABSENT from a parsed block.
     */
    const DELIBERATE = [
      'src/engine/scene/migrate.ts',
      'src/engine/scene/migrate.test.ts',
      'src/engine/scene/legacy-import.ts',
      'src/engine/scene/legacy-import.test.ts',
      'src/engine/content/pack/schema.test.ts',
      // This file: the list below has to spell every token it forbids.
      'tests/unit/licensing-boundary.test.ts',
    ];

    // The seven RNG seeds, and English built on the same stems (`hopeful`, `hoped`, `hopes`), which
    // the word boundaries below do not match anyway.
    const SEED = /'no-hope'|'wolf-fear'|createRng\('fear'\)|'fear-cost'|'tank-hope-'/;

    const COMPOUND = new RegExp(
      [
        'onSuccessWithHope', 'onSuccessWithFear', 'onFailureWithHope', 'onFailureWithFear',
        'successWithHope', 'successWithFear', 'failureWithHope', 'failureWithFear',
        'gainHope', 'loseHope', 'spendHope', 'gainFear', 'loseFear',
        'withHope', 'withFear', 'classHope', 'hopeDie',
      ].join('|'),
    );
    const BARE = /(?<![A-Za-z])(hope|fear|Hope|Fear)(?![A-Za-z])/;

    const offenders: string[] = [];
    for (const path of tracked()) {
      if (!/^(src|tests)\/.*\.tsx?$/.test(path)) continue;
      if (DELIBERATE.includes(path)) continue;
      lines(path).forEach((line, index) => {
        if (SEED.test(line)) return;
        if (COMPOUND.test(line) || BARE.test(line)) {
          offenders.push(`${path}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }

    expect(
      offenders,
      'a document field or enum value is using the old paired-pool terms. What a player reads is ' +
        'Light and Shadow; what a file stores is `good` and `bad`.',
    ).toEqual([]);
  });
});
