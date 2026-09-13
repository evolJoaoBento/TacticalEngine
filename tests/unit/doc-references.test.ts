import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * The reference docs name only files the repository has.
 *
 * Slice 3 deleted a catalogue, the sources it was built from and the scripts that generated two docs
 * out of it, and the docs went on describing all of it: a recipe that edited a deleted file, a table
 * of modules that were gone, a rule about regenerating docs nobody could regenerate. It was found by
 * hand three times. This finds it on the next run.
 *
 * Only the reference docs are read -- the ones somebody follows to change the code. A record of what
 * was removed (the backlog, `CONTEXT.md`, `AGENTS.md`) names what it removed on purpose.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const REFERENCE_DOCS = [
  'docs/DEVELOPING.md',
  'docs/developer-guide.html',
  'docs/MANUAL.md',
  'docs/CRPG-GAPS.md',
  '.claude/skills/run-the-demo/SKILL.md',
];

/** Where a doc's short paths start from: `combat/attack.ts` is `src/engine/combat/attack.ts`. */
const BASES = ['', 'src/', 'src/engine/', 'src/game/', 'src/editor/', 'docs/', 'tests/'];

/** A path to a file: at least one directory, and an extension. A bare name or a directory is not checked. */
const FILE = /^[\w@.-]+(?:\/[\w@.-]+)*\/[\w@.-]+\.(?:ts|tsx|js|mjs|md|py|json|css|html|txt)$/;

const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean));

/** Whether the repository has this file, or ignores it on purpose (`public/cards/index.json`). */
function known(path: string): boolean {
  if (BASES.some((base) => tracked.has(base + path))) return true;
  for (const file of tracked) if (file.endsWith(`/${path}`)) return true;
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/** Every file a doc names in code: `backticks` in Markdown, `<code>` in HTML. */
function filesNamedIn(doc: string): { line: number; path: string }[] {
  const found: { line: number; path: string }[] = [];
  readFileSync(resolve(repoRoot, doc), 'utf8')
    .split(/\r?\n/)
    .forEach((text, index) => {
      const spans = [...text.matchAll(/`([^`]+)`/g), ...text.matchAll(/<code>(.*?)<\/code>/g)].map((match) =>
        match[1]!.replace(/<[^>]+>/g, ''),
      );
      for (const span of spans) {
        const path = span.trim().split(/[\s:]/)[0]!.replace(/[.,;)]+$/, '');
        if (FILE.test(path)) found.push({ line: index + 1, path });
      }
    });
  return found;
}

describe('the reference docs', () => {
  it('name only files the repository has', () => {
    const dead = REFERENCE_DOCS.flatMap((doc) =>
      filesNamedIn(doc)
        .filter((named) => !known(named.path))
        .map((named) => `${doc}:${named.line}: ${named.path}`),
    );
    expect(dead, 'A reference doc names a file that is gone. Rewrite the passage; the test is the guard.').toEqual([]);
  });

  it('would notice one that did', () => {
    // The check itself, on names it must refuse and names it must pass.
    expect(known('src/engine/content/srd/hooks.ts')).toBe(false);
    expect(known('combat/attack.ts')).toBe(true);
    expect(known('src/engine/script/native-hooks.ts')).toBe(true);
  });
});
