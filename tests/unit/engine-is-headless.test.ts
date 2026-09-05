/**
 * Architecture guard.
 *
 * docs/CONTEXT.md: "Engine core (`src/engine/**` except `render/`, `audio/`,
 * `input/`) must be DOM- and WebGL-free so it runs under Vitest in node."
 *
 * Every slice so far has relied on that, and nothing has enforced it. A single
 * `import * as THREE` slipped into the rules or the grid would not fail a test —
 * it would just quietly make the core unusable on a server, untestable without a
 * browser, and impossible to run a headless replay through. So this walks the
 * source and fails on the imports and globals that would break it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const engineRoot = fileURLToPath(new URL('../../src/engine', import.meta.url));

/** Directories that are allowed to touch the browser: they are the adapter layer. */
const PRESENTATION_DIRECTORIES = new Set(['render', 'audio', 'input']);

function headlessSources(directory: string, relative = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = `${directory}/${entry}`;
    const path = relative === '' ? entry : `${relative}/${entry}`;
    if (statSync(full).isDirectory()) {
      if (relative === '' && PRESENTATION_DIRECTORIES.has(entry)) continue;
      out.push(...headlessSources(full, path));
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
    out.push(path);
  }
  return out;
}

const sources = headlessSources(engineRoot).map((path) => ({
  path,
  text: readFileSync(`${engineRoot}/${path}`, 'utf8'),
}));

/** Strip comments, so a module named in prose is not mistaken for an import. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Strip comments *and* string literals, for checks on identifiers.
 *
 * The import check deliberately does not use this: a module specifier is itself a
 * string, so stripping strings would hide exactly what it is looking for.
 */
function identifiers(text: string): string {
  return withoutComments(text)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Matches a real import of a module, in either static or dynamic form. */
function importOf(module: string): RegExp {
  const escaped = module.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`(?:from|import)\\s*\\(?\\s*['"]${escaped}(?:/|['"])`);
}

const FORBIDDEN_MODULES = ['three', 'three-mesh-bvh', 'cannon-es', 'preact', '@preact/signals'];
const BROWSER_GLOBALS = ['document', 'window', 'navigator', 'localStorage', 'requestAnimationFrame'];
const MATH_RANDOM = /\bMath\s*\.\s*random\s*\(/;

describe('the engine core stays headless', () => {
  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(10);
    const paths = sources.map((s) => s.path);
    expect(paths).toContain('rules/duality.ts');
    expect(paths).toContain('combat/attack.ts');
    expect(paths).toContain('grid/pathfinding.ts');
  });

  it('imports no rendering, DOM or physics library', () => {
    const offenders: string[] = [];
    for (const source of sources) {
      const body = withoutComments(source.text);
      for (const module of FORBIDDEN_MODULES) {
        if (importOf(module).test(body)) offenders.push(`${source.path} imports ${module}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('touches no browser global', () => {
    const offenders: string[] = [];
    for (const source of sources) {
      const body = identifiers(source.text);
      for (const name of BROWSER_GLOBALS) {
        if (new RegExp(`\\b${name}\\s*\\.`).test(body)) {
          offenders.push(`${source.path} uses ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never rolls Math.random — every roll comes from a seeded Rng', () => {
    const offenders = sources
      .filter((source) => MATH_RANDOM.test(identifiers(source.text)))
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  });

  it('detects a violation rather than passing vacuously', () => {
    const bad = [
      "import * as THREE from 'three';",
      "const el = document.getElementById('gl');",
      'const r = Math.random();',
    ].join('\n');
    expect(importOf('three').test(withoutComments(bad))).toBe(true);
    expect(/\bdocument\s*\./.test(identifiers(bad))).toBe(true);
    expect(MATH_RANDOM.test(identifiers(bad))).toBe(true);

    // Naming them in prose or in an unrelated string is not a violation.
    const innocent = [
      "// This module never imports from 'three' and never calls Math.random().",
      "/* document.getElementById is the renderer's business, not ours. */",
      'const note = "window.alert is not called here";',
    ].join('\n');
    expect(importOf('three').test(withoutComments(innocent))).toBe(false);
    expect(/\bdocument\s*\./.test(identifiers(innocent))).toBe(false);
    expect(/\bwindow\s*\./.test(identifiers(innocent))).toBe(false);
    expect(MATH_RANDOM.test(identifiers(innocent))).toBe(false);

    // A dynamic import is caught too.
    expect(importOf('cannon-es').test(withoutComments("await import('cannon-es');"))).toBe(true);
    // And a module whose name merely starts the same way is not.
    expect(importOf('three').test("from 'threejs-helpers'")).toBe(false);
  });
});
