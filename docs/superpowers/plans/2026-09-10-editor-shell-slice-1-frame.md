# Editor shell, slice 1 — theme and frame: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editor's single side panel with the purple, mode-based shell: a top bar (Project ▾, Content ▾, the four modes, scene picker, undo/redo, Play), each mode's tools on a rail, a library strip along the bottom, a side panel per mode, and content editors as workspaces under the bar. Every capability the old panel reached stays reachable.

**Architecture:** Decisions stay in DOM-free modules tested in node: `src/editor/modes.ts` (which tools each mode owns), `src/editor/controller.ts` (gains `mode`, `setMode`, a mode-aware Erase), `src/editor/library.ts` (what the strip offers and what a search matches). The Preact shell under `src/editor/ui/` only arranges them, styled by one stylesheet, `src/editor/ui/editor.css`: its tokens sit on `:root`, and every shell rule sits under `.ph-editor`. `src/main.ts` renders `EditorShell` where it rendered `EditorPanel`.

**Tech Stack:** TypeScript 7 strict, Preact 10 (automatic JSX runtime, `jsxImportSource: preact`, fragments `<>` work), Vite 8, Vitest 5 (node), Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-09-10-editor-shell-design.md` — this plan is §11 slice 1. Slices 2–5 get their own plans once this lands, because each depends on the code the one before produces.

**Deviation from the spec's slice list, on purpose:** the conversation list and graph move into Interaction mode in *this* slice (the spec put the whole Interaction host in slice 5). The side panel that held them is deleted here, and leaving conversations unreachable for four slices would break the e2e suite and the "everything stays reachable" rule. Object *behaviour* still moves in slice 5.

## Global Constraints

- The repository path contains a space. Quote it in every shell command. Use repo-relative paths in code and scripts.
- `legacy/` is never modified.
- **No TTS, speech or "voice" features. All UI text is English.**
- `src/engine/**` outside `render/` stays DOM-free. Nothing in this slice adds to the engine.
- `npx tsc --noEmit` is the only static check. There is no lint and no formatter, so match the surrounding style: 2-space indent, single quotes, semicolons, a doc comment on every exported thing that says *why*.
- The repo is LF. If you edit with a script, open files with `newline=''` (see `docs/BACKLOG.md` §4).
- **Never `git checkout` a file with uncommitted work in it.** To prove a test fails without its fix, copy the file aside and copy it back.
- `window.__polyheart` is declared in `src/main.ts` **and** mirrored by hand in `tests/e2e/demo.spec.ts`. Change both in the same commit.
- **Theme tokens,** exact values:
  - `--ph-bar #120f19`, `--ph-panel rgba(23, 19, 33, 0.96)`, `--ph-surface #151020`, `--ph-raised #181322`
  - `--ph-field #130f1b`, `--ph-backdrop rgba(11, 9, 16, 0.97)`
  - `--ph-line #30293f`, `--ph-line-soft #261f33`
  - `--ph-text #ece8f4`, `--ph-muted #a59cba`, `--ph-faint #6f6684`, `--ph-label #cdb9f2`
  - `--ph-accent #b58cff`, `--ph-accent-bg rgba(181, 140, 255, 0.17)`, `--ph-accent-line rgba(181, 140, 255, 0.5)`, `--ph-on-accent #1a0f2e`
  - `--ph-warm #f6c453`, `--ph-good #9ae08a`, `--ph-bad #ff8f7a`

  This extends the spec's §7 table with the tones the old panels needed.
- **Modes,** in the user's order: `inspect` (Inspector, key 1) · `terrain` (Terrain, 2) · `combat` (Combat, 3) · `interaction` (Interaction, 4).
- **Test ids kept:** `open-party`, `open-abilities`, `open-items`, `open-code`, `play-here`, `data-quest`, `data-asset`, and every id inside the four content panels and the dialogue graph.
- **Test ids added:**
  - top bar: `top-bar`, `open-project`, `open-content`, `open-scenes`, `open-quests`, `open-models`, `save-project`, `load-project`, `check-project`, `mode-<mode>`, `undo`, `redo`, `play`
  - panels and strips: `scene-menu`, `add-scene`, `tool-rail`, `terrain-library`, `combat-library`, `library-search`, `inspector-side`, `terrain-side`, `combat-side`, `interaction-side`, `add-conversation`, `encounter-select`
  - workspaces: `quests-panel`, `close-quests`, `add-quest`, `models-panel`, `close-models`, `add-model`, `problems`, `editor-shell`
- **Before claiming done:** `npx tsc --noEmit`, `npx vitest run`, `npx playwright test` — all green, unit ≥ 1692 and e2e ≥ 83 plus the new ones.
- **Commits** go on branch `editor-rebuild`. Each message is a sentence about the behaviour; the body gives the design reason and a verification line (what was run, what came back, how the new tests were shown to fail). End every message with:

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PEcVfJhHQKVdPeZYodMcqg
  ```

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/editor/modes.ts` | create | `EditorMode`, `EDITOR_MODES`, `MODE_LABELS`, `MODE_TOOLS`, `defaultTool`, `modeOfTool` |
| `src/editor/modes.test.ts` | create | the mode table |
| `src/editor/controller.ts` | modify | `mode`, `setMode`; `setTool` sets the mode; Erase in Combat takes creature → trigger cell → spawn |
| `src/editor/controller.test.ts` | modify | modes and Combat's eraser |
| `src/editor/library.ts` | create | `LibraryItem`, `LibraryTab`, `groundTab`, `propsTab`, `objectsTab`, `creatureTabs`, `filterLibrary`, `titleCase` |
| `src/editor/library.test.ts` | create | the library |
| `src/editor/ui/editor.css` | create | tokens on `:root`; shell rules under `.ph-editor` |
| `src/editor/ui/*.tsx` (12 existing panels) | modify | colour literals → `var(--ph-…)` |
| `src/editor/ui/icons.tsx` | create | `Icon` |
| `src/editor/ui/TopBar.tsx` | create | brand, Project and Content menus, modes, scene button, undo/redo, Play |
| `src/editor/ui/SceneMenu.tsx` | create | the scene list, as a dropdown |
| `src/editor/ui/ToolRail.tsx` | create | a mode's tools; `TOOL_LABELS` |
| `src/editor/ui/LibraryStrip.tsx` | create | tabs, search, cards |
| `src/editor/ui/ModeSides.tsx` | create | `InspectorSide`, `TerrainSide`, `CombatSide`, `InteractionSide` |
| `src/editor/ui/QuestsWorkspace.tsx` | create | quest list + `QuestEditor` |
| `src/editor/ui/ModelsWorkspace.tsx` | create | imported models |
| `src/editor/ui/ProblemsPopover.tsx` | create | what Check found |
| `src/editor/ui/EditorShell.tsx` | create | the root: state for menu, workspace, open conversation, problems; keys 1–4 and Esc |
| `src/editor/ui/EditorPanel.tsx` | delete | replaced by the shell |
| `src/main.ts` | modify | render `EditorShell`; `undoEdit`/`redoEdit`; start in Inspector; driver `editorMode`/`setEditorMode` |
| `tests/e2e/demo.spec.ts` | modify | driver mirror; conversations via Interaction; quests and models via Content |
| `tests/e2e/editor-panels.spec.ts` | modify | panels via Content ▾ |
| `tests/e2e/editor-shell.spec.ts` | create | the shell in a browser |
| `docs/MANUAL.md` §3, `docs/CRPG-GAPS.md` §8, `docs/BACKLOG.md` | modify | say what the editor is now |

---

### Task 1: Modes own the tools

**Files:**
- Create: `src/editor/modes.ts`, `src/editor/modes.test.ts`
- Modify: `src/editor/controller.ts`
- Test: `src/editor/controller.test.ts` (append)

**Interfaces:**
- Produces: `type EditorMode = 'inspect' | 'terrain' | 'combat' | 'interaction'`; `EDITOR_MODES: readonly EditorMode[]`; `MODE_LABELS: Readonly<Record<EditorMode, string>>`; `MODE_TOOLS: Readonly<Record<EditorMode, readonly EditorTool[]>>`; `defaultTool(mode: EditorMode): EditorTool`; `modeOfTool(tool: EditorTool, current: EditorMode): EditorMode`; `EditorController.mode: EditorMode`; `EditorController.setMode(mode: EditorMode): void`.

- [ ] **Step 1: Write the failing mode-table test** — create `src/editor/modes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { EditorTool } from './controller';
import { EDITOR_MODES, MODE_LABELS, MODE_TOOLS, defaultTool, modeOfTool } from './modes';

const ALL_TOOLS: readonly EditorTool[] = [
  'select',
  'paintTerrain',
  'raise',
  'lower',
  'prop',
  'spawn',
  'interactable',
  'adversary',
  'trigger',
  'erase',
];

describe('editor modes', () => {
  it('are the four the user named, in their order', () => {
    expect(EDITOR_MODES).toEqual(['inspect', 'terrain', 'combat', 'interaction']);
    expect(EDITOR_MODES.map((mode) => MODE_LABELS[mode])).toEqual(['Inspector', 'Terrain', 'Combat', 'Interaction']);
  });

  it('give every tool a home', () => {
    for (const tool of ALL_TOOLS) {
      expect(EDITOR_MODES.some((mode) => MODE_TOOLS[mode].includes(tool)), tool).toBe(true);
    }
  });

  it('default to a tool they own', () => {
    for (const mode of EDITOR_MODES) expect(MODE_TOOLS[mode]).toContain(defaultTool(mode));
  });

  it('find the mode a tool belongs to', () => {
    expect(modeOfTool('raise', 'inspect')).toBe('terrain');
    expect(modeOfTool('adversary', 'terrain')).toBe('combat');
    expect(modeOfTool('select', 'terrain')).toBe('inspect');
  });

  it('keep a shared tool in the mode that already owns it', () => {
    expect(modeOfTool('erase', 'combat')).toBe('combat');
    expect(modeOfTool('erase', 'terrain')).toBe('terrain');
    expect(modeOfTool('erase', 'inspect')).toBe('terrain');
    expect(modeOfTool('select', 'interaction')).toBe('interaction');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/editor/modes.test.ts`
Expected: FAIL — `Failed to resolve import "./modes"`.

- [ ] **Step 3: Write `src/editor/modes.ts`**

```ts
/**
 * The editor's modes, and which tools each one owns.
 *
 * The top bar switches between four ways of working on a room, in the order the
 * user set: look at and change what is there, shape the ground, set up a fight,
 * and write what things say and do. A tool belongs to a mode, so choosing a tool
 * chooses its mode too - the two can never disagree.
 */

import type { EditorTool } from './controller';

export type EditorMode = 'inspect' | 'terrain' | 'combat' | 'interaction';

/** The top bar's order, which is also the number keys'. */
export const EDITOR_MODES: readonly EditorMode[] = ['inspect', 'terrain', 'combat', 'interaction'];

export const MODE_LABELS: Readonly<Record<EditorMode, string>> = {
  inspect: 'Inspector',
  terrain: 'Terrain',
  combat: 'Combat',
  interaction: 'Interaction',
};

/**
 * The tools each mode offers, its default first.
 *
 * Terrain and Combat hold the tools the editor had before the shell; parts 3
 * and 4 of the rebuild replace them. Erase is in both, and what it removes
 * depends on which mode it is used in. Interaction keeps Select so a click on the
 * board still picks an object out.
 */
export const MODE_TOOLS: Readonly<Record<EditorMode, readonly EditorTool[]>> = {
  inspect: ['select'],
  terrain: ['paintTerrain', 'raise', 'lower', 'prop', 'interactable', 'erase'],
  combat: ['adversary', 'trigger', 'spawn', 'erase'],
  interaction: ['select'],
};

export function defaultTool(mode: EditorMode): EditorTool {
  return MODE_TOOLS[mode][0]!;
}

/**
 * The mode a tool belongs to. A tool two modes share stays in the current mode
 * when that mode owns it; otherwise it goes to the first mode in the bar that does.
 */
export function modeOfTool(tool: EditorTool, current: EditorMode): EditorMode {
  if (MODE_TOOLS[current].includes(tool)) return current;
  return EDITOR_MODES.find((mode) => MODE_TOOLS[mode].includes(tool)) ?? current;
}
```

- [ ] **Step 4: Run the mode-table test and watch it pass**

Run: `npx vitest run src/editor/modes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing controller tests** — append to the end of `src/editor/controller.test.ts`. It already imports `EditorController` and has `setup()`, which builds an 8×6 blank room whose only spawn is at (0, 0).

```ts
describe('modes', () => {
  it('starts in the mode that owns its tool', () => {
    const { editor } = setup();
    expect(editor.state.tool).toBe('paintTerrain');
    expect(editor.mode).toBe('terrain');
  });

  it('choosing a tool chooses its mode', () => {
    const { editor } = setup();
    editor.setTool('adversary');
    expect(editor.mode).toBe('combat');
    editor.setTool('select');
    expect(editor.mode).toBe('inspect');
  });

  it('choosing a mode picks its first tool, unless the current one is its own', () => {
    const { editor } = setup();
    editor.setMode('combat');
    expect(editor.state.tool).toBe('adversary');
    editor.setTool('erase');
    editor.setMode('terrain');
    expect(editor.state.tool).toBe('erase');
    editor.setMode('interaction');
    expect(editor.state.tool).toBe('select');
  });

  it('ends a drag when the mode changes', () => {
    const { editor, session } = setup();
    editor.setTool('paintTerrain');
    editor.set('terrainId', 'wall');
    editor.begin({ x: 0, y: 0 });
    editor.setMode('combat');
    editor.paint({ x: 1, y: 0 });
    expect(session.requireScene('room').terrain[1]).toBe('floor');
  });
});

describe('erasing in combat', () => {
  /** A creature, a trigger cell and a spawn all on (2, 2), with Combat's eraser in hand. */
  function stacked(): ReturnType<typeof setup> {
    const made = setup();
    const { editor } = made;
    for (const tool of ['adversary', 'trigger', 'spawn'] as const) {
      editor.setTool(tool);
      editor.begin({ x: 2, y: 2 });
      editor.end();
    }
    editor.setTool('erase');
    return made;
  }

  const erase = (editor: EditorController): void => {
    editor.begin({ x: 2, y: 2 });
    editor.end();
  };

  it('takes the creature, then the trigger cell, then the spawn', () => {
    const { editor, session } = stacked();
    const scene = () => session.requireScene('room');
    expect(editor.mode).toBe('combat');

    erase(editor);
    expect(scene().encounters[0]!.adversaries).toHaveLength(0);
    expect(scene().encounters[0]!.triggerCells).toEqual([{ x: 2, y: 2 }]);

    erase(editor);
    expect(scene().encounters[0]!.triggerCells).toEqual([]);
    expect(scene().spawns).toContainEqual({ x: 2, y: 2 });

    erase(editor);
    expect(scene().spawns).toEqual([{ x: 0, y: 0 }]);
  });

  it('never takes the last spawn', () => {
    const { editor, session } = setup();
    editor.setMode('combat');
    editor.setTool('erase');
    expect(editor.begin({ x: 0, y: 0 })).toBe('none');
    editor.end();
    expect(session.requireScene('room').spawns).toEqual([{ x: 0, y: 0 }]);
  });

  it('is undone a step at a time', () => {
    const { editor, session } = stacked();
    erase(editor);
    erase(editor);
    session.undo();
    expect(session.requireScene('room').encounters[0]!.triggerCells).toEqual([{ x: 2, y: 2 }]);
    session.undo();
    expect(session.requireScene('room').encounters[0]!.adversaries).toHaveLength(1);
  });

  it('leaves props to Terrain', () => {
    const { editor, session } = setup();
    editor.setTool('prop');
    editor.begin({ x: 3, y: 3 });
    editor.end();

    editor.setMode('combat');
    editor.setTool('erase');
    editor.begin({ x: 3, y: 3 });
    editor.end();
    expect(session.requireScene('room').decos).toHaveLength(1);

    // Erase is Terrain's too, so it stays in hand across the switch.
    editor.setMode('terrain');
    editor.begin({ x: 3, y: 3 });
    editor.end();
    expect(session.requireScene('room').decos).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npx vitest run src/editor/controller.test.ts`
Expected: FAIL. You should see TypeScript/runtime errors for `editor.mode` and `editor.setMode`: `setMode is not a function`, and `mode` is `undefined`.

- [ ] **Step 7: Give the controller modes** — in `src/editor/controller.ts`:

(a) Add to the imports. `removeAdversary` joins the existing session import list, keeping it alphabetical:

```ts
import { MODE_TOOLS, defaultTool, modeOfTool, type EditorMode } from './modes';
```

```ts
import {
  EditorSession,
  addAdversary,
  addDeco,
  addEncounter,
  addInteractable,
  adjustHeight,
  brushTiles,
  paintTerrain,
  removeAdversary,
  removeDecoAt,
  removeInteractable,
  rotateDeco,
  setSpawns,
  toggleTriggerCell,
} from './session';
```

(b) In `class EditorController`, under `state: EditorToolState;`, add the field:

```ts
  /** Which of the top bar's modes is in hand. It always owns `state.tool`. */
  mode: EditorMode;
```

(c) At the end of the constructor, after `this.onChange = …`:

```ts
    this.mode = modeOfTool(this.state.tool, 'inspect');
```

(d) Replace `setTool` with the two methods below:

```ts
  /** Change tools, ending any drag in progress. The mode follows the tool. */
  setTool(tool: EditorTool): void {
    this.end();
    this.state.tool = tool;
    this.mode = modeOfTool(tool, this.mode);
  }

  /**
   * Change modes, ending any drag. The tool in hand stays when the new mode owns
   * it - Erase crossing from Terrain to Combat - and is otherwise the mode's first.
   */
  setMode(mode: EditorMode): void {
    this.end();
    this.mode = mode;
    if (!MODE_TOOLS[mode].includes(this.state.tool)) this.state.tool = defaultTool(mode);
  }
```

(e) In `run`, make the first line of the `case 'erase': {` block:

```ts
        if (this.mode === 'combat') return this.eraseForCombat(point);
```

(f) Add this private method directly above `selectedInteractable()`:

```ts
  /**
   * Combat's eraser: the creature on the tile, else the trigger cell, else a
   * party start - never the last one, since a room must have somewhere to put
   * the party.
   */
  private eraseForCombat(point: Point): EditorChange {
    const { session, sceneId } = this;
    const scene = this.scene;
    const here = (p: Point): boolean => p.x === point.x && p.y === point.y;
    for (const encounter of scene.encounters) {
      const placed = encounter.adversaries.find((a) => here(a.position));
      if (placed !== undefined) {
        session.run(removeAdversary(sceneId, encounter.id, placed.id));
        return 'content';
      }
    }
    for (const encounter of scene.encounters) {
      if (encounter.triggerCells.some(here)) {
        session.run(toggleTriggerCell(sceneId, encounter.id, point));
        return 'content';
      }
    }
    const at = scene.spawns.findIndex(here);
    if (at >= 0 && scene.spawns.length > 1) {
      session.run(setSpawns(sceneId, scene.spawns.filter((_, i) => i !== at)));
      return 'content';
    }
    return 'none';
  }
```

- [ ] **Step 8: Run the controller and mode tests and watch them pass**

Run: `npx vitest run src/editor/modes.test.ts src/editor/controller.test.ts`
Expected: PASS, every test including the existing ones.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src/editor/modes.ts src/editor/modes.test.ts src/editor/controller.ts src/editor/controller.test.ts
git commit -F - <<'EOF'
Editor modes own their tools, and Combat's eraser takes what a fight put down

The shell's top bar switches between Inspector, Terrain, Combat and Interaction.
Which tools each shows is a table in modes.ts, and choosing a tool chooses its
mode, so the bar and the tool in hand can never disagree (a setTool from a test
or a key still lands in the right mode). Erase is in two modes: in Terrain it
takes the prop and then the object, as it always did; in Combat it takes the
creature, then the trigger cell, then a party start, never the last one.

Verification: npx vitest run src/editor/modes.test.ts src/editor/controller.test.ts
passes. Both new files failed first: modes.ts did not exist, and the controller had
no mode or setMode. npx tsc --noEmit is clean.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PEcVfJhHQKVdPeZYodMcqg
EOF
```

---

### Task 2: Purple tokens, and the existing panels read them

**Files:**
- Create: `src/editor/ui/editor.css`
- Modify (by script): `src/editor/ui/{AbilityPanel,CheckEditor,CodePanel,ConditionEditor,DialogueGraph,EditorPanel,EffectList,Inspector,ItemPanel,PartyPanel,QuestEditor,TargetEditor}.tsx`
- Modify: `src/editor/ui/EditorPanel.tsx` (import the stylesheet until Task 4 deletes the file)

**Interfaces:**
- Produces: the CSS custom properties in Global Constraints, defined on `:root`. Every later task writes colours as `var(--ph-…)` and nothing else.

- [ ] **Step 1: Record the before state** — the test is a grep that must come back empty once this task is done:

Run: `grep -rnE "#69d2ff|#8ea3b0|#39404d|#6f8cff" src/editor/ui`
Expected now: about 140 matching lines.

- [ ] **Step 2: Create `src/editor/ui/editor.css`**

```css
/*
 * The editor's look: purple, as the user asked.
 *
 * Tokens live on :root, so every editor panel resolves them wherever it is
 * mounted. They style nothing by themselves, so the play screen is untouched.
 * Rules that do style something sit under .ph-editor (added with the shell).
 */
:root {
  --ph-bar: #120f19;
  --ph-panel: rgba(23, 19, 33, 0.96);
  --ph-surface: #151020;
  --ph-raised: #181322;
  --ph-field: #130f1b;
  --ph-backdrop: rgba(11, 9, 16, 0.97);
  --ph-line: #30293f;
  --ph-line-soft: #261f33;
  --ph-text: #ece8f4;
  --ph-muted: #a59cba;
  --ph-faint: #6f6684;
  --ph-label: #cdb9f2;
  --ph-accent: #b58cff;
  --ph-accent-bg: rgba(181, 140, 255, 0.17);
  --ph-accent-line: rgba(181, 140, 255, 0.5);
  --ph-on-accent: #1a0f2e;
  --ph-warm: #f6c453;
  --ph-good: #9ae08a;
  --ph-bad: #ff8f7a;
}
```

- [ ] **Step 3: Load the stylesheet** — in `src/editor/ui/EditorPanel.tsx`, add this line directly after `import { useEffect, useState } from 'preact/hooks';`:

```ts
import './editor.css';
```

- [ ] **Step 4: Write the retheme script** — save it as `retheme.py` in your scratchpad directory, never in the repo. It follows the two-pass protocol from `docs/BACKLOG.md` §4.

The one SVG attribute is rewritten as a `style` first: `var()` is not reliable in an SVG presentation attribute.

```python
import io
import os

UI = os.path.join('src', 'editor', 'ui')
FILES = [os.path.join(UI, name) for name in [
    'AbilityPanel.tsx', 'CheckEditor.tsx', 'CodePanel.tsx', 'ConditionEditor.tsx',
    'DialogueGraph.tsx', 'EditorPanel.tsx', 'EffectList.tsx', 'Inspector.tsx',
    'ItemPanel.tsx', 'PartyPanel.tsx', 'QuestEditor.tsx', 'TargetEditor.tsx',
]]

EXACT = [(
    os.path.join(UI, 'DialogueGraph.tsx'),
    "stroke={link.dangling ? '#ff8f7a' : LINK_COLOR[link.kind]}",
    "style={{ stroke: link.dangling ? 'var(--ph-bad)' : LINK_COLOR[link.kind] }}",
)]

COLOURS = [
    ('#8ea3b0', 'var(--ph-muted)'), ('#39404d', 'var(--ph-line)'), ('#c8b88a', 'var(--ph-label)'),
    ('#1b1f28', 'var(--ph-field)'), ('#ff8f7a', 'var(--ph-bad)'), ('#e8e6df', 'var(--ph-text)'),
    ('#f6c453', 'var(--ph-warm)'), ('#6f8cff', 'var(--ph-accent)'), ('#69d2ff', 'var(--ph-accent)'),
    ('#28314a', 'var(--ph-accent-bg)'), ('#12151c', 'var(--ph-surface)'), ('#5d6b7a', 'var(--ph-faint)'),
    ('#e06c75', 'var(--ph-bad)'), ('#9ae08a', 'var(--ph-good)'), ('#7fb069', 'var(--ph-good)'),
    ('#2a303a', 'var(--ph-line-soft)'), ('#d8d4c8', 'var(--ph-text)'), ('#12161d', 'var(--ph-field)'),
    ('rgba(16,18,24,0.95)', 'var(--ph-panel)'), ('rgba(16,18,24,0.94)', 'var(--ph-panel)'),
    ('rgba(105,210,255,0.18)', 'var(--ph-accent-bg)'), ('rgba(10,12,16,0.97)', 'var(--ph-backdrop)'),
]


def read(path):
    return io.open(path, encoding='utf-8').read()


def write(path, text):
    io.open(path, 'w', encoding='utf-8', newline='').write(text)


# Pass one: every anchor is where it should be, before anything is written.
for path, old, _ in EXACT:
    assert read(path).count(old) == 1, (path, old)
for path in FILES:
    assert any(c in read(path) for c, _ in COLOURS), ('no colour literal in', path)

# Pass two: write.
for path, old, new in EXACT:
    write(path, read(path).replace(old, new))
for path in FILES:
    text = read(path)
    for old, new in COLOURS:
        text = text.replace(old, new)
    write(path, text)
print('rethemed', len(FILES), 'files')
```

- [ ] **Step 5: Run it from the repository root**

Run: `python "<your scratchpad>/retheme.py"`
Expected: `rethemed 12 files`.

- [ ] **Step 6: Check that nothing was missed**

Run: `grep -rnE "#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba\(" src/editor/ui --include=*.tsx`
Expected: exactly one line — `QuestEditor.tsx` with `rgba(0,0,0,0.3)`, a neutral shade that stays.

Run: `git diff --stat`
Expected: 12 `.tsx` files changed and no CRLF churn. Each file's change count should be close to its number of literals, not its whole length.

- [ ] **Step 7: Typecheck, unit tests, and the panels in a browser**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run`
Expected: all pass.

Run: `npx playwright test tests/e2e/editor-panels.spec.ts --reporter=list`
Expected: all pass.

Then open `test-results/editor-party-panel.png` and `test-results/editor-ability-panel.png`. They should show purple accents and violet-grey text on a near-black violet ground, with no cyan.

- [ ] **Step 8: Commit**

```bash
git add src/editor/ui
git commit -F - <<'EOF'
The editor turns purple, through tokens rather than literals

The user asked for a purple editor. The twelve panels carried 196 colour
literals between them, the old cyan accent among them; they now read CSS custom
properties defined once in editor.css. Tokens sit on :root so a panel resolves
them wherever it is mounted, and they style nothing themselves, so the play
screen is untouched. The dialogue graph's link colour moved from an SVG stroke
attribute into style, where var() is dependable.

Verification: grep finds no hex literal left under src/editor/ui besides one
neutral rgba shade. npx tsc --noEmit is clean, npx vitest run passes, and
editor-panels.spec.ts passes; its screenshots were looked at.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PEcVfJhHQKVdPeZYodMcqg
EOF
```

---

### Task 3: What the library strip offers

**Files:**
- Create: `src/editor/library.ts`, `src/editor/library.test.ts`

**Interfaces:**
- Consumes: `AdversaryDef` (`src/engine/content/types.ts`: `id`, `name`, `tier: 1|2|3|4`, `role: AdversaryRole`); `Interactable['kind']`.
- Produces:

```ts
interface LibraryItem { readonly tab: string; readonly id: string; readonly label: string; readonly detail?: string; readonly swatch?: string; readonly keywords?: readonly string[] }
interface LibraryTab { readonly id: string; readonly label: string; readonly items: readonly LibraryItem[] }
groundTab(terrainIds: readonly string[], colors: Readonly<Record<string, string>>): LibraryTab   // tab id 'ground'
propsTab(models: readonly string[], imported: readonly string[]): LibraryTab                       // tab id 'props'
objectsTab(): LibraryTab                                                                           // tab id 'objects'
OBJECT_KINDS: readonly Interactable['kind'][]
creatureTabs(adversaries: Iterable<Pick<AdversaryDef, 'id' | 'name' | 'tier' | 'role'>>): LibraryTab[]  // ids 'tier-1'..'tier-4'
filterLibrary(tabs: readonly LibraryTab[], query: string): LibraryItem[]
titleCase(id: string): string
```

- [ ] **Step 1: Write the failing test** — create `src/editor/library.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OBJECT_KINDS, creatureTabs, filterLibrary, groundTab, objectsTab, propsTab, titleCase } from './library';

const CREATURES = [
  { id: 'jagged-knife-bandit', name: 'Jagged Knife Bandit', tier: 1 as const, role: 'standard' as const },
  { id: 'acid-burrower', name: 'Acid Burrower', tier: 1 as const, role: 'solo' as const },
  { id: 'dire-wolf', name: 'Dire Wolf', tier: 1 as const, role: 'skulk' as const },
  { id: 'vault-guardian-sentinel', name: 'Vault Guardian Sentinel', tier: 3 as const, role: 'bruiser' as const },
];

describe('the library', () => {
  it('names ids the way a person would', () => {
    expect(titleCase('deadTree')).toBe('Dead Tree');
    expect(titleCase('tangle-bramble')).toBe('Tangle Bramble');
    expect(titleCase('wall')).toBe('Wall');
  });

  it('shows ground as swatches, falling back for a type with no colour', () => {
    const tab = groundTab(['floor', 'water'], { floor: '#5d8a4a' });
    expect(tab.id).toBe('ground');
    expect(tab.items.map((i) => [i.id, i.label, i.swatch, i.tab])).toEqual([
      ['floor', 'Floor', '#5d8a4a', 'ground'],
      ['water', 'Water', '#5d8a4a', 'ground'],
    ]);
  });

  it('lists imported models after the built-in props, and says so', () => {
    const tab = propsTab(['barrel', 'deadTree'], ['duck']);
    expect(tab.items.map((i) => i.label)).toEqual(['Barrel', 'Dead Tree', 'Duck']);
    expect(tab.items[2]!.detail).toBe('imported');
  });

  it('offers every kind of object', () => {
    expect(objectsTab().items.map((i) => i.id)).toEqual([...OBJECT_KINDS]);
    expect(OBJECT_KINDS).toEqual(['chest', 'door', 'pillar', 'portal', 'scripted']);
  });

  it('files creatures by tier, by name, with their role', () => {
    const tabs = creatureTabs(CREATURES);
    expect(tabs.map((t) => t.id)).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4']);
    expect(tabs[0]!.items.map((i) => i.label)).toEqual(['Acid Burrower', 'Dire Wolf', 'Jagged Knife Bandit']);
    expect(tabs[0]!.items[0]!.detail).toBe('T1 · Solo');
    expect(tabs[1]!.items).toEqual([]);
    expect(tabs[2]!.items.map((i) => i.id)).toEqual(['vault-guardian-sentinel']);
  });

  it('searches every tab at once, every word, any case', () => {
    const tabs = creatureTabs(CREATURES);
    expect(filterLibrary(tabs, 'wolf').map((i) => i.id)).toEqual(['dire-wolf']);
    expect(filterLibrary(tabs, 'VAULT sentinel').map((i) => i.id)).toEqual(['vault-guardian-sentinel']);
    // A role is searchable though it is not in the name.
    expect(filterLibrary(tabs, 'bruiser').map((i) => i.id)).toEqual(['vault-guardian-sentinel']);
    expect(filterLibrary(tabs, 'tier 3').map((i) => i.id)).toEqual(['vault-guardian-sentinel']);
  });

  it('finds nothing for an empty search, so the strip shows the open tab instead', () => {
    expect(filterLibrary(creatureTabs(CREATURES), '   ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/editor/library.test.ts`
Expected: FAIL — `Failed to resolve import "./library"`.

- [ ] **Step 3: Write `src/editor/library.ts`**

```ts
/**
 * What the bottom strip offers, as data.
 *
 * The strip is the TaleSpire half of the editor: pick a thing, then put it
 * down. Which things, grouped how, and what a search matches are decisions, so
 * they live here and are tested in node; the strip itself only draws.
 */

import type { AdversaryDef, AdversaryRole } from '../engine/content/types';
import type { Interactable } from '../engine/scene/schema';

export interface LibraryItem {
  /** Which tab it came from, so a pick found by searching still knows what it is. */
  readonly tab: string;
  /** What picking it sets on the tool: a terrain id, a model, a kind, an adversary. */
  readonly id: string;
  readonly label: string;
  /** A second line: "imported", "T1 · Solo". */
  readonly detail?: string;
  /** A flat colour shown instead of a picture, for ground. */
  readonly swatch?: string;
  /** Words a search matches besides the label and the id. */
  readonly keywords?: readonly string[];
}

export interface LibraryTab {
  readonly id: string;
  readonly label: string;
  readonly items: readonly LibraryItem[];
}

/** "deadTree" and "tangle-bramble" as a person would write them. */
export function titleCase(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter((word) => word !== '')
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

const FALLBACK_SWATCH = '#5d8a4a';

export function groundTab(terrainIds: readonly string[], colors: Readonly<Record<string, string>>): LibraryTab {
  return {
    id: 'ground',
    label: 'Ground',
    items: terrainIds.map((id) => ({ tab: 'ground', id, label: titleCase(id), swatch: colors[id] ?? FALLBACK_SWATCH })),
  };
}

export function propsTab(models: readonly string[], imported: readonly string[]): LibraryTab {
  return {
    id: 'props',
    label: 'Props',
    items: [
      ...models.map((id) => ({ tab: 'props', id, label: titleCase(id) })),
      ...imported.map((id) => ({ tab: 'props', id, label: titleCase(id), detail: 'imported' })),
    ],
  };
}

/** Every kind the schema allows, in the order a designer reaches for them. */
export const OBJECT_KINDS: readonly Interactable['kind'][] = ['chest', 'door', 'pillar', 'portal', 'scripted'];

export function objectsTab(): LibraryTab {
  return {
    id: 'objects',
    label: 'Objects',
    items: OBJECT_KINDS.map((kind) => ({ tab: 'objects', id: kind, label: titleCase(kind) })),
  };
}

const ROLE_LABELS: Readonly<Record<AdversaryRole, string>> = {
  bruiser: 'Bruiser',
  horde: 'Horde',
  leader: 'Leader',
  minion: 'Minion',
  ranged: 'Ranged',
  skulk: 'Skulk',
  social: 'Social',
  solo: 'Solo',
  standard: 'Standard',
  support: 'Support',
};

/** The SRD's creatures, a tab per tier, alphabetical within it. */
export function creatureTabs(
  adversaries: Iterable<Pick<AdversaryDef, 'id' | 'name' | 'tier' | 'role'>>,
): LibraryTab[] {
  const tiers = [1, 2, 3, 4] as const;
  const byTier = new Map<number, LibraryItem[]>(tiers.map((tier) => [tier, []]));
  for (const creature of adversaries) {
    byTier.get(creature.tier)?.push({
      tab: `tier-${creature.tier}`,
      id: creature.id,
      label: creature.name,
      detail: `T${creature.tier} · ${ROLE_LABELS[creature.role]}`,
      keywords: [creature.role, `tier ${creature.tier}`],
    });
  }
  return tiers.map((tier) => ({
    id: `tier-${tier}`,
    label: `Tier ${tier}`,
    items: byTier.get(tier)!.sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

/**
 * Items across every tab whose label, id or keywords hold every word of the
 * query, ignoring case. An empty query matches nothing: the strip then shows the
 * open tab rather than everything at once.
 */
export function filterLibrary(tabs: readonly LibraryTab[], query: string): LibraryItem[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];
  return tabs.flatMap((tab) =>
    tab.items.filter((item) => {
      const haystack = [item.label, item.id, ...(item.keywords ?? [])].join(' ').toLowerCase();
      return words.every((word) => haystack.includes(word));
    }),
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/editor/library.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output.

```bash
git add src/editor/library.ts src/editor/library.test.ts
git commit -F - <<'EOF'
The library strip's contents are data: ground, props, objects, creatures by tier

What the editor's bottom strip offers, and what a search there matches, are
decisions rather than drawing, so they live in a DOM-free module the strip
reads. Ground comes as colour swatches, imported models after the built-in
props, the five object kinds, and the SRD's creatures on a tab per tier. A
search spans every tab and matches a creature's role and tier as well as its
name. Each item remembers its tab, so a pick found by searching still knows
which tool it belongs to.

Verification: npx vitest run src/editor/library.test.ts passes. It failed first
because the module did not exist. npx tsc --noEmit is clean.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PEcVfJhHQKVdPeZYodMcqg
EOF
```

---

### Task 4: The shell replaces the side panel

This is the task where a reviewer sees the new editor. It is one task because half a frame cannot ship: the moment `EditorPanel.tsx` goes, every tool and form it held must be reachable from the shell, and the e2e specs that clicked it must follow in the same commit.

**Files:**
- Modify: `src/editor/ui/editor.css` (append the shell rules)
- Create: `src/editor/ui/icons.tsx`, `TopBar.tsx`, `SceneMenu.tsx`, `ToolRail.tsx`, `LibraryStrip.tsx`, `ModeSides.tsx`, `QuestsWorkspace.tsx`, `ModelsWorkspace.tsx`, `ProblemsPopover.tsx`, `EditorShell.tsx`
- Delete: `src/editor/ui/EditorPanel.tsx`
- Modify: `src/main.ts`, `tests/e2e/editor-panels.spec.ts`, `tests/e2e/demo.spec.ts`

**Interfaces:**
- Consumes (Task 1): `EditorMode`, `EDITOR_MODES`, `MODE_LABELS`, `MODE_TOOLS`, `EditorController.mode`, `setMode`, `setTool`.
- Consumes (Task 3): `LibraryItem` with its `tab`, `groundTab`, `propsTab`, `objectsTab`, `creatureTabs`.
- Produces: `EditorShell(props: EditorShellProps)`, the root `main.ts` renders into `#app` in edit mode; `type Menu = 'project' | 'content' | 'scenes'`; `type Workspace = 'party' | 'cards' | 'items' | 'quests' | 'code' | 'models'`; `TOOL_LABELS: Readonly<Record<EditorTool, string>>` (exported from `ToolRail.tsx`).
- Consumes, unchanged: the panels' props, exactly as `EditorPanel.tsx` passes them today.
  - `PartyPanel {session, content, onChange, onClose}`
  - `ItemPanel {session, content, hookIds, sceneIds, dialogueIds, encounterIds, quests, onChange, onClose}`
  - `AbilityPanel {session, libraryAbilities, hookIds, adversaryIds, sceneIds, dialogueIds, encounterIds, quests, onChange, onClose}`
  - `CodePanel {session, nativeHooks, onChange, onClose}`
  - `DialogueGraph {session, dialogue, sceneIds, dialogueIds, encounterIds, quests, onClose, onChange}`
  - `Inspector {interactable, onChange, onDelete, sceneIds, dialogueIds, encounterIds, quests}`
  - `QuestEditor {session, quest, onChange}`

The four content panels already position themselves `absolute; inset: 24px`, so inside a workspace container they fill it without changing. `DialogueGraph` is `absolute; inset: 0` and fills it the same way.

- [ ] **Step 1: Append the shell rules to `src/editor/ui/editor.css`**

```css

/* ---------------------------------------------------------------- the shell */

.ph-editor {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--ph-text);
  font: 13px/1.45 system-ui, 'Segoe UI', sans-serif;
}
.ph-editor button,
.ph-editor input,
.ph-editor select,
.ph-editor textarea { font: inherit; color: inherit; }
.ph-editor button { cursor: pointer; }
.ph-editor button:disabled { cursor: default; opacity: 0.45; }
.ph-editor small { color: var(--ph-muted); }
.ph-icon { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.ph-panel {
  pointer-events: auto;
  background: var(--ph-panel);
  border: 1px solid var(--ph-line);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}

/* Top bar */
.ph-topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 46px; z-index: 5;
  display: flex; align-items: center; gap: 6px; padding: 0 10px; box-sizing: border-box;
  background: var(--ph-bar); border-bottom: 1px solid var(--ph-line); pointer-events: auto;
}
.ph-brand { display: flex; align-items: center; gap: 7px; font-weight: 700; margin-right: 6px; white-space: nowrap; }
.ph-brand b { color: var(--ph-accent); }
.ph-menu-wrap { position: relative; }
.ph-menu-button { padding: 6px 10px; border: 0; border-radius: 6px; background: transparent; white-space: nowrap; }
.ph-menu-button:hover, .ph-menu-button.ph-open { background: var(--ph-raised); }
.ph-caret { color: var(--ph-muted); margin-left: 4px; font-size: 10px; }
.ph-badge { margin-left: 5px; padding: 0 6px; border-radius: 999px; background: var(--ph-bad); color: var(--ph-on-accent); font-size: 11px; font-weight: 700; }
.ph-modes { margin: 0 auto; display: flex; gap: 2px; padding: 3px; background: var(--ph-raised); border: 1px solid var(--ph-line); border-radius: 9px; }
.ph-mode { display: flex; align-items: center; gap: 6px; padding: 6px 11px; border: 0; border-radius: 7px; background: transparent; color: var(--ph-muted); font-weight: 600; }
.ph-mode kbd { font: 600 10px/1 system-ui, sans-serif; color: var(--ph-faint); border: 1px solid var(--ph-line); border-radius: 3px; padding: 2px 4px; }
.ph-mode:hover { color: var(--ph-text); }
.ph-mode.ph-on { background: var(--ph-accent-bg); color: var(--ph-accent); box-shadow: inset 0 0 0 1px var(--ph-accent-line); }
.ph-mode.ph-on kbd { color: var(--ph-accent); border-color: var(--ph-accent-line); }
.ph-right { display: flex; align-items: center; gap: 6px; }
.ph-scene-button { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--ph-line); border-radius: 7px; background: var(--ph-raised); white-space: nowrap; }
.ph-icon-button { width: 32px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--ph-muted); }
.ph-icon-button:hover:not(:disabled) { background: var(--ph-raised); color: var(--ph-text); }
.ph-dirty { color: var(--ph-warm); font-size: 12px; white-space: nowrap; }
.ph-button { padding: 6px 12px; border: 1px solid var(--ph-line); border-radius: 7px; background: transparent; font-weight: 600; white-space: nowrap; }
.ph-button:hover { background: var(--ph-raised); }
.ph-button.ph-primary { background: var(--ph-accent); border-color: var(--ph-accent); color: var(--ph-on-accent); }

/* Menus */
.ph-menu {
  position: absolute; top: 40px; left: 0; z-index: 6; min-width: 230px; padding: 6px;
  background: var(--ph-raised); border: 1px solid var(--ph-line); border-radius: 8px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
}
.ph-menu-right { left: auto; right: 0; }
.ph-item {
  display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%;
  padding: 6px 9px; border: 0; border-radius: 5px; background: transparent; text-align: left; box-sizing: border-box; cursor: pointer;
}
.ph-item:hover, .ph-item.ph-on { background: var(--ph-accent-bg); }
.ph-item.ph-on { color: var(--ph-accent); }
.ph-sep { border-top: 1px solid var(--ph-line); margin: 5px 2px; }
.ph-scene-row { display: flex; gap: 3px; align-items: center; }
.ph-scene-row .ph-item { flex: 1; }
.ph-mini { min-width: 26px; height: 26px; padding: 0 6px; border: 1px solid var(--ph-line); border-radius: 5px; background: transparent; }
.ph-mini:hover:not(:disabled) { background: var(--ph-accent-bg); }
.ph-note { color: var(--ph-muted); font-size: 11px; margin: 6px 4px 2px; }
.ph-file { display: none; }

/* Tool rail */
.ph-rail { position: absolute; top: 58px; left: 12px; width: 46px; padding: 5px; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px; }
.ph-tool { height: 36px; display: grid; place-items: center; border: 0; border-radius: 7px; background: transparent; color: var(--ph-muted); }
.ph-tool:hover { color: var(--ph-text); background: var(--ph-raised); }
.ph-tool.ph-on { background: var(--ph-accent-bg); color: var(--ph-accent); }

/* Side panels */
.ph-side { position: absolute; top: 58px; right: 12px; width: 300px; max-height: calc(100% - 70px); overflow-y: auto; padding: 12px 14px; box-sizing: border-box; }
.ph-side-left { right: auto; left: 12px; width: 260px; }
.ph-heading { font: 600 10.5px/1 system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ph-muted); margin: 14px 0 7px; }
.ph-heading:first-child { margin-top: 0; }
.ph-hint { color: var(--ph-muted); font-size: 12px; }
.ph-row { display: flex; gap: 4px; align-items: center; margin-bottom: 3px; }
.ph-chip { padding: 4px 10px; border: 1px solid var(--ph-line); border-radius: 6px; background: transparent; }
.ph-chip.ph-on { border-color: var(--ph-accent); background: var(--ph-accent-bg); color: var(--ph-accent); }
.ph-select { width: 100%; padding: 5px 8px; border: 1px solid var(--ph-line); border-radius: 5px; background: var(--ph-field); }

/* Library strip */
.ph-library { position: absolute; left: 70px; right: 324px; bottom: 12px; height: 168px; padding: 8px 10px; box-sizing: border-box; display: flex; flex-direction: column; }
.ph-library-tabs { display: flex; gap: 4px; align-items: center; margin-bottom: 8px; }
.ph-tab { padding: 4px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--ph-muted); font-weight: 600; font-size: 12px; }
.ph-tab.ph-on { background: var(--ph-raised); color: var(--ph-text); }
.ph-search { margin-left: auto; display: flex; align-items: center; gap: 6px; width: 200px; padding: 3px 8px; border: 1px solid var(--ph-line); border-radius: 6px; background: var(--ph-field); color: var(--ph-muted); }
.ph-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; }
.ph-library-row { flex: 1; display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden; padding-bottom: 4px; }
.ph-card { flex: none; width: 84px; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 0; border: 0; background: transparent; color: var(--ph-muted); font-size: 11px; text-align: center; }
.ph-card.ph-on { color: var(--ph-accent); }
.ph-thumb { width: 82px; height: 82px; box-sizing: border-box; border-radius: 8px; border: 1px solid var(--ph-line); background: var(--ph-surface); display: grid; place-items: center; }
.ph-card:hover .ph-thumb { border-color: var(--ph-accent-line); }
.ph-card.ph-on .ph-thumb { border-color: var(--ph-accent); box-shadow: 0 0 0 2px var(--ph-accent-bg); }
.ph-glyph { font: 700 26px/1 system-ui, sans-serif; color: var(--ph-faint); }
.ph-card-label { max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-card-detail { color: var(--ph-faint); font-size: 10px; }
.ph-empty { color: var(--ph-muted); padding: 8px; }

/* Workspaces and popovers */
.ph-workspace { position: absolute; top: 46px; left: 0; right: 0; bottom: 0; pointer-events: auto; }
.ph-workspace-panel { position: absolute; inset: 24px; display: flex; gap: 12px; padding: 12px; background: var(--ph-surface); border: 1px solid var(--ph-line); border-radius: 6px; overflow: hidden; }
.ph-workspace-list { width: 260px; flex: none; overflow-y: auto; }
.ph-workspace-body { flex: 1; overflow-y: auto; }
.ph-popover { position: absolute; top: 54px; left: 90px; width: 440px; max-height: 60%; overflow-y: auto; padding: 10px 12px; z-index: 6; }
.ph-popover-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.ph-popover ul { margin: 0; padding: 0 0 0 16px; font-size: 12px; }
.ph-popover li { margin-bottom: 3px; }
.ph-bad { color: var(--ph-bad); }
.ph-warm { color: var(--ph-warm); }
.ph-good { color: var(--ph-good); }
```

- [ ] **Step 2: Create `src/editor/ui/icons.tsx`**

```tsx
/**
 * The editor's icons: a few strokes each, drawn in the current text colour so a
 * button's state colours its icon too. Keyed by mode and tool name, so a rail
 * can ask for `Icon name={tool}` without a lookup table of its own.
 */

const PATHS: Readonly<Record<string, string>> = {
  inspect: 'M5 3l6.5 17 2.2-7.3L21 10.5z',
  terrain: 'M2 19l6.5-11 4 6.5 3-4.5L22 19z',
  combat: 'M4 4l10 10M20 4L10 14M7 17l-3 3M17 17l3 3M6 14l4 4M18 14l-4 4',
  interaction: 'M4 5h16v10H10l-5 4v-4H4z',
  select: 'M5 3l6.5 17 2.2-7.3L21 10.5z',
  paintTerrain: 'M4 20c4 0 5-2 5-5l8-8 3 3-8 8c-3 0-5 1-5 5z',
  raise: 'M12 4l6 6h-4v8h-4v-8H6z',
  lower: 'M12 20l6-6h-4V6h-4v8H6z',
  prop: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  interactable: 'M4 9h16v10H4zM4 9l2-4h12l2 4M10 13h4',
  adversary: 'M12 3a4 4 0 110 8 4 4 0 010-8zM5 21c0-4 3-7 7-7s7 3 7 7',
  trigger: 'M4 4h6v6H4zM14 14h6v6h-6zM14 4h6v6h-6z',
  spawn: 'M6 21V4M6 4h11l-3 4 3 4H6',
  erase: 'M4 16l9-9 6 6-7 7H7zM10 20h10',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-2',
  redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 000 10h2',
  search: 'M11 5a6 6 0 110 12 6 6 0 010-12zM20 20l-4.5-4.5',
  close: 'M6 6l12 12M18 6L6 18',
};

export function Icon(props: { name: string; size?: number }): preact.JSX.Element {
  const size = props.size ?? 18;
  return (
    <svg class="ph-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[props.name] ?? ''} />
    </svg>
  );
}
```

- [ ] **Step 3: Create `src/editor/ui/SceneMenu.tsx`** — this is the old panel's scene list with the same refusals and the same browser prompts, now as a dropdown under the scene button.

```tsx
/**
 * The rooms of the project, as a dropdown under the scene button: switch,
 * rename, make the opening scene, delete, add. The same list and the same
 * refusals the side panel had - the opening scene and the last scene stay.
 */

import type { EditorSession } from '../session';

export interface SceneMenuProps {
  session: EditorSession;
  /** The scene being edited. */
  editing: string;
  /** The scene the party is standing in, which need not be the one being edited. */
  playingScene: string;
  onSwitch: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onSetStart: (id: string) => void;
  onClose: () => void;
}

export function SceneMenu(props: SceneMenuProps): preact.JSX.Element {
  const scenes = props.session.project.scenes;
  const start = props.session.project.startScene;
  return (
    <div class="ph-menu ph-menu-right" data-testid="scene-menu">
      {scenes.map((scene) => {
        const opens = start === scene.id;
        return (
          <div key={scene.id} class="ph-scene-row">
            <button
              class={scene.id === props.editing ? 'ph-item ph-on' : 'ph-item'}
              data-scene={scene.id}
              title={scene.id}
              onClick={() => {
                props.onSwitch(scene.id);
                props.onClose();
              }}
            >
              <span>
                {scene.name || scene.id} <small>{scene.width}×{scene.height}</small>
                {opens ? <span class="ph-warm"> ▸</span> : null}
                {scene.id === props.playingScene ? <span class="ph-good"> ●</span> : null}
              </span>
            </button>
            <button
              class="ph-mini"
              title="Rename"
              onClick={() => {
                const name = prompt('Scene name', scene.name || scene.id);
                if (name !== null && name !== '') props.onRename(scene.id, name);
              }}
            >
              ✎
            </button>
            <button
              class="ph-mini"
              title={opens ? 'Already the opening scene' : 'Open the project here'}
              disabled={opens}
              onClick={() => props.onSetStart(scene.id)}
            >
              ▸
            </button>
            <button
              class="ph-mini"
              title={
                opens
                  ? 'The opening scene cannot be deleted'
                  : scenes.length <= 1
                    ? 'A project needs at least one scene'
                    : 'Delete this scene'
              }
              disabled={opens || scenes.length <= 1}
              onClick={() => {
                if (confirm(`Delete "${scene.name || scene.id}"?`)) props.onRemove(scene.id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div class="ph-sep" />
      <button
        class="ph-item"
        data-testid="add-scene"
        onClick={() => {
          const name = prompt('New scene name', 'New room');
          if (name !== null && name !== '') {
            props.onAdd(name);
            props.onClose();
          }
        }}
      >
        + New scene
      </button>
      <div class="ph-note">▸ opens the project · ● the party is here</div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/editor/ui/TopBar.tsx`**

```tsx
/**
 * The top bar: the Project and Content menus, the four modes, the room, undo,
 * and Play.
 *
 * Presentation only. Which menu is open belongs to the shell, and which mode is
 * in hand belongs to the controller; this draws them and reports clicks.
 */

import type { EditorSession } from '../session';
import { EDITOR_MODES, MODE_LABELS, type EditorMode } from '../modes';
import type { Problem } from '../validate';
import { Icon } from './icons';

export type Menu = 'project' | 'content' | 'scenes';
export type Workspace = 'party' | 'cards' | 'items' | 'quests' | 'code' | 'models';

interface ContentEntry {
  workspace: Workspace;
  label: string;
  /** Kept from the side panel, so the specs that opened panels still find them. */
  testId: string;
  count: (session: EditorSession) => number;
}

const WRITTEN: readonly ContentEntry[] = [
  { workspace: 'party', label: 'Party', testId: 'open-party', count: (s) => s.project.party.length },
  { workspace: 'cards', label: 'Cards', testId: 'open-abilities', count: (s) => s.project.abilities.length },
  { workspace: 'items', label: 'Items & loot', testId: 'open-items', count: (s) => s.project.items.length },
  { workspace: 'quests', label: 'Quests', testId: 'open-quests', count: (s) => s.project.quests.length },
  { workspace: 'code', label: 'Code', testId: 'open-code', count: (s) => s.project.code.length },
];

const IMPORTED: ContentEntry = {
  workspace: 'models',
  label: 'Models',
  testId: 'open-models',
  count: (s) => s.project.assets.length,
};

export interface TopBarProps {
  session: EditorSession;
  mode: EditorMode;
  menu: Menu | null;
  sceneName: string;
  sceneSize: string;
  /** What the last Check found; null before one has run. */
  problems: readonly Problem[] | null;
  /** The scene menu, drawn under its button while open. */
  sceneMenu: preact.JSX.Element;
  onMode: (mode: EditorMode) => void;
  onMenu: (menu: Menu | null) => void;
  onWorkspace: (workspace: Workspace) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onCheck: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPlay: () => void;
  onPlayHere?: () => void;
}

export function TopBar(props: TopBarProps): preact.JSX.Element {
  const { session, menu } = props;
  const toggle = (which: Menu): void => props.onMenu(menu === which ? null : which);
  const errors = props.problems?.filter((problem) => problem.severity === 'error').length ?? 0;
  const entry = (item: ContentEntry): preact.JSX.Element => (
    <button
      key={item.workspace}
      class="ph-item"
      data-testid={item.testId}
      onClick={() => {
        props.onMenu(null);
        props.onWorkspace(item.workspace);
      }}
    >
      {item.label} <small>{item.count(session)}</small>
    </button>
  );

  return (
    <header class="ph-topbar" data-testid="top-bar">
      <div class="ph-brand">
        <b>◆</b> PolyHeart Editor
      </div>

      <div class="ph-menu-wrap">
        <button
          class={menu === 'project' ? 'ph-menu-button ph-open' : 'ph-menu-button'}
          data-testid="open-project"
          onClick={() => toggle('project')}
        >
          Project<span class="ph-caret">▾</span>
          {errors > 0 ? <span class="ph-badge">{errors}</span> : null}
        </button>
        {menu === 'project' ? (
          <div class="ph-menu" data-testid="project-menu">
            <button
              class="ph-item"
              data-testid="save-project"
              onClick={() => {
                props.onMenu(null);
                props.onSave();
              }}
            >
              Save JSON
            </button>
            <label class="ph-item" data-testid="load-project">
              Load…
              <input
                class="ph-file"
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  props.onMenu(null);
                  if (file !== undefined) props.onLoad(file);
                }}
              />
            </label>
            <button
              class="ph-item"
              data-testid="check-project"
              onClick={() => {
                props.onMenu(null);
                props.onCheck();
              }}
            >
              Check <small>{props.problems === null ? '' : `${props.problems.length} found`}</small>
            </button>
          </div>
        ) : null}
      </div>

      <div class="ph-menu-wrap">
        <button
          class={menu === 'content' ? 'ph-menu-button ph-open' : 'ph-menu-button'}
          data-testid="open-content"
          onClick={() => toggle('content')}
        >
          Content<span class="ph-caret">▾</span>
        </button>
        {menu === 'content' ? (
          <div class="ph-menu" data-testid="content-menu">
            {WRITTEN.map(entry)}
            <div class="ph-sep" />
            {entry(IMPORTED)}
          </div>
        ) : null}
      </div>

      <nav class="ph-modes" aria-label="Editor modes">
        {EDITOR_MODES.map((mode, i) => (
          <button
            key={mode}
            class={mode === props.mode ? 'ph-mode ph-on' : 'ph-mode'}
            data-testid={`mode-${mode}`}
            aria-pressed={mode === props.mode ? 'true' : 'false'}
            title={`${MODE_LABELS[mode]} (${i + 1})`}
            onClick={() => props.onMode(mode)}
          >
            <Icon name={mode} />
            {MODE_LABELS[mode]}
            <kbd>{i + 1}</kbd>
          </button>
        ))}
      </nav>

      <div class="ph-right">
        <div class="ph-menu-wrap">
          <button class="ph-scene-button" data-testid="open-scenes" onClick={() => toggle('scenes')}>
            {props.sceneName} <small>{props.sceneSize}</small>
            <span class="ph-caret">▾</span>
          </button>
          {menu === 'scenes' ? props.sceneMenu : null}
        </div>
        <button
          class="ph-icon-button"
          data-testid="undo"
          title={session.undoLabel === null ? 'Nothing to undo' : `Undo ${session.undoLabel}`}
          aria-label="Undo"
          disabled={!session.canUndo}
          onClick={props.onUndo}
        >
          <Icon name="undo" />
        </button>
        <button
          class="ph-icon-button"
          data-testid="redo"
          title={session.redoLabel === null ? 'Nothing to redo' : `Redo ${session.redoLabel}`}
          aria-label="Redo"
          disabled={!session.canRedo}
          onClick={props.onRedo}
        >
          <Icon name="redo" />
        </button>
        {session.dirty ? <span class="ph-dirty">● unsaved</span> : null}
        {props.onPlayHere !== undefined ? (
          <button
            class="ph-button"
            data-testid="play-here"
            title="Play in this room, from its spawns. Shift-click a tile to play from there."
            onClick={props.onPlayHere}
          >
            ▶ Play here
          </button>
        ) : null}
        <button class="ph-button ph-primary" data-testid="play" onClick={props.onPlay}>
          ▶ Play
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Create `src/editor/ui/ToolRail.tsx`**

```tsx
/**
 * A mode's tools, as a column of icons down the left of the board.
 *
 * Erase is the one tool two modes share, and it removes different things in
 * each, so its label says which.
 */

import type { EditorTool } from '../controller';
import type { EditorMode } from '../modes';
import { Icon } from './icons';

export const TOOL_LABELS: Readonly<Record<EditorTool, string>> = {
  select: 'Select',
  paintTerrain: 'Paint ground',
  raise: 'Raise ground',
  lower: 'Lower ground',
  prop: 'Place a prop',
  interactable: 'Place an object',
  adversary: 'Place a creature',
  trigger: 'Trigger cells',
  spawn: 'Party start',
  erase: 'Erase',
};

function labelFor(tool: EditorTool, mode: EditorMode): string {
  if (tool !== 'erase') return TOOL_LABELS[tool];
  return mode === 'combat' ? 'Erase a creature, trigger cell or party start' : 'Erase a prop or object';
}

export interface ToolRailProps {
  mode: EditorMode;
  tools: readonly EditorTool[];
  current: EditorTool;
  onTool: (tool: EditorTool) => void;
}

export function ToolRail(props: ToolRailProps): preact.JSX.Element {
  return (
    <aside class="ph-rail ph-panel" data-testid="tool-rail">
      {props.tools.map((tool) => (
        <button
          key={tool}
          class={tool === props.current ? 'ph-tool ph-on' : 'ph-tool'}
          title={labelFor(tool, props.mode)}
          aria-label={labelFor(tool, props.mode)}
          aria-pressed={tool === props.current ? 'true' : 'false'}
          data-tool={tool}
          onClick={() => props.onTool(tool)}
        >
          <Icon name={tool} />
        </button>
      ))}
    </aside>
  );
}
```

- [ ] **Step 6: Create `src/editor/ui/LibraryStrip.tsx`** — `library.ts` decides what the tabs hold and what a search finds; this file only draws.

```tsx
/**
 * The strip along the bottom of the board: tabs of things to put down, a
 * search across all of them, and the one in hand marked.
 */

import { useState } from 'preact/hooks';
import { filterLibrary, type LibraryItem, type LibraryTab } from '../library';
import { Icon } from './icons';

export interface LibraryStripProps {
  tabs: readonly LibraryTab[];
  /** The id the tool holds, marked on its card. */
  picked: string;
  onPick: (item: LibraryItem) => void;
  /** Which strip this is, for a test: `terrain-library`, `combat-library`. */
  testId: string;
}

export function LibraryStrip(props: LibraryStripProps): preact.JSX.Element {
  const [tabId, setTabId] = useState(props.tabs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const tab = props.tabs.find((t) => t.id === tabId) ?? props.tabs[0];
  const items = searching ? filterLibrary(props.tabs, query) : (tab?.items ?? []);

  return (
    <footer class="ph-library ph-panel" data-testid={props.testId}>
      <div class="ph-library-tabs">
        {props.tabs.map((t) => (
          <button
            key={t.id}
            class={t.id === tab?.id && !searching ? 'ph-tab ph-on' : 'ph-tab'}
            data-tab={t.id}
            onClick={() => {
              setTabId(t.id);
              setQuery('');
            }}
          >
            {t.label}
          </button>
        ))}
        <label class="ph-search">
          <Icon name="search" size={14} />
          <input
            value={query}
            placeholder="Search"
            data-testid="library-search"
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="ph-library-row">
        {items.length === 0 ? <div class="ph-empty">Nothing matches.</div> : null}
        {items.map((item) => (
          <button
            key={`${item.tab}:${item.id}`}
            class={item.id === props.picked ? 'ph-card ph-on' : 'ph-card'}
            data-item={item.id}
            title={item.detail === undefined ? item.label : `${item.label} · ${item.detail}`}
            onClick={() => props.onPick(item)}
          >
            <span class="ph-thumb" style={item.swatch === undefined ? undefined : { background: item.swatch }}>
              {item.swatch === undefined ? <span class="ph-glyph">{item.label.slice(0, 1)}</span> : null}
            </span>
            <span class="ph-card-label">{item.label}</span>
            {item.detail === undefined ? null : <span class="ph-card-detail">{item.detail}</span>}
          </button>
        ))}
      </div>
    </footer>
  );
}
```

- [ ] **Step 7: Create `src/editor/ui/ModeSides.tsx`**

```tsx
/**
 * What sits beside the board in each mode.
 *
 * Inspector: the selected object's properties (the object inspector from the
 * side panel; everything else joins it in the next slice). Terrain and Combat:
 * what the tool in hand does, the brush, the encounter creatures go into.
 * Interaction: the conversations, each opening its graph.
 */

import type { QuestDef } from '../../engine/content/quests';
import { dialogueSchema } from '../../engine/dialogue/schema';
import type { EditorController, EditorTool } from '../controller';
import {
  addDialogue,
  removeDialogue,
  removeInteractable,
  updateInteractable,
  type EditorSession,
} from '../session';
import { Inspector } from './Inspector';
import { TOOL_LABELS } from './ToolRail';

/** The ids an effect list picks from rather than having them typed. */
export interface PickableIds {
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
}

export function InspectorSide(props: {
  session: EditorSession;
  controller: EditorController;
  ids: PickableIds;
  onChange: () => void;
}): preact.JSX.Element {
  const { session, controller } = props;
  const object = controller.selectedInteractable();
  const sceneId = controller.sceneId;
  return (
    <aside class="ph-side ph-panel" data-testid="inspector-side">
      {object === null ? (
        <div class="ph-hint">Click an object on the board to change what it is and what it does.</div>
      ) : (
        <Inspector
          interactable={object}
          {...props.ids}
          onChange={(changes) => {
            session.run(updateInteractable(sceneId, object.id, changes));
            props.onChange();
          }}
          onDelete={() => {
            session.run(removeInteractable(sceneId, object.id));
            controller.selected = null;
            props.onChange();
          }}
        />
      )}
    </aside>
  );
}

const TERRAIN_HINTS: Partial<Record<EditorTool, string>> = {
  paintTerrain: 'Drag across the board to paint the ground picked below.',
  raise: 'Drag to raise the ground a level. One drag is one undo.',
  lower: 'Drag to lower the ground a level. One drag is one undo.',
  prop: 'Click to place the prop picked below; click it again to turn it.',
  interactable: 'Click to place the object picked below; click an object again to remove it.',
  erase: 'Click a prop to remove it, then the object under it.',
};

const BRUSHED: readonly EditorTool[] = ['paintTerrain', 'raise', 'lower'];

export function TerrainSide(props: { controller: EditorController; onChange: () => void }): preact.JSX.Element {
  const { controller } = props;
  const tool = controller.state.tool;
  return (
    <aside class="ph-side ph-panel" data-testid="terrain-side">
      <div class="ph-heading">{TOOL_LABELS[tool]}</div>
      <div class="ph-hint">{TERRAIN_HINTS[tool] ?? ''}</div>
      {BRUSHED.includes(tool) ? (
        <div>
          <div class="ph-heading">Brush</div>
          <div class="ph-row">
            {[1, 3, 5].map((size) => (
              <button
                key={size}
                class={controller.state.brushSize === size ? 'ph-chip ph-on' : 'ph-chip'}
                data-brush={size}
                onClick={() => {
                  controller.set('brushSize', size);
                  props.onChange();
                }}
              >
                {size}×{size}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

const COMBAT_HINTS: Partial<Record<EditorTool, string>> = {
  adversary: 'Click to place the creature picked below in the encounter.',
  trigger: 'Click the cells that start the encounter when the party steps on one.',
  spawn: 'Click to add or remove a place the party starts.',
  erase: 'Click a creature to remove it, then a trigger cell, then a party start.',
};

export function CombatSide(props: { controller: EditorController; onChange: () => void }): preact.JSX.Element {
  const { controller } = props;
  const scene = controller.scene;
  const tool = controller.state.tool;
  const current = controller.state.encounterId ?? scene.encounters[0]?.id ?? '';
  return (
    <aside class="ph-side ph-panel" data-testid="combat-side">
      <div class="ph-heading">{TOOL_LABELS[tool]}</div>
      <div class="ph-hint">{COMBAT_HINTS[tool] ?? ''}</div>
      <div class="ph-heading">Encounter</div>
      {scene.encounters.length === 0 ? (
        <div class="ph-hint">None yet. The first creature or trigger cell you place starts one.</div>
      ) : (
        <select
          class="ph-select"
          data-testid="encounter-select"
          value={current}
          onChange={(e) => {
            controller.set('encounterId', (e.target as HTMLSelectElement).value);
            props.onChange();
          }}
        >
          {scene.encounters.map((encounter) => (
            <option key={encounter.id} value={encounter.id}>
              {encounter.name || encounter.id} · {encounter.adversaries.length} creatures · {encounter.triggerCells.length} cells
            </option>
          ))}
        </select>
      )}
    </aside>
  );
}

export function InteractionSide(props: {
  session: EditorSession;
  onOpen: (dialogueId: string) => void;
  onChange: () => void;
}): preact.JSX.Element {
  const { session } = props;
  return (
    <aside class="ph-side ph-side-left ph-panel" data-testid="interaction-side">
      <div class="ph-heading">Conversations</div>
      {session.project.dialogues.map((entry) => (
        <div key={entry.id} class="ph-row">
          <button class="ph-item" onClick={() => props.onOpen(entry.id)}>
            {entry.id} <small>{entry.nodes.length} nodes</small>
          </button>
          <button
            class="ph-mini"
            title="Delete this conversation"
            onClick={() => {
              if (!confirm(`Delete "${entry.id}"?`)) return;
              session.run(removeDialogue(entry.id));
              props.onChange();
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        class="ph-item"
        data-testid="add-conversation"
        onClick={() => {
          const name = prompt('Conversation id', 'a-conversation');
          if (name === null || name === '') return;
          const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          if (id === '' || session.project.dialogues.some((d) => d.id === id)) return;
          session.run(
            addDialogue(dialogueSchema.parse({ id, start: 'start', nodes: [{ id: 'start', lines: [{ text: '' }] }] })),
          );
          props.onOpen(id);
          props.onChange();
        }}
      >
        + Conversation
      </button>
      <div class="ph-note">
        What an object does is still edited in the Inspector. It moves here with the interaction graph.
      </div>
    </aside>
  );
}
```

- [ ] **Step 8: Create `src/editor/ui/QuestsWorkspace.tsx`** — the quest list moves out of the side panel. A click *selects* a quest rather than toggling it, so a second click on the open quest keeps it open.

```tsx
/**
 * Quests, as a workspace: the list on the left, the open quest's form beside it.
 *
 * Moved out of the side panel, where one long quest pushed everything under it
 * off the screen. A click opens a quest rather than toggling it, so clicking
 * the open one again leaves it open.
 */

import { useState } from 'preact/hooks';
import { questSchema } from '../../engine/content/quests';
import { addQuest, removeQuest, type EditorSession } from '../session';
import { QuestEditor } from './QuestEditor';
import { Icon } from './icons';

export function QuestsWorkspace(props: {
  session: EditorSession;
  onChange: () => void;
  onClose: () => void;
}): preact.JSX.Element {
  const { session } = props;
  const [open, setOpen] = useState<string | null>(null);
  const quest = session.project.quests.find((q) => q.id === open) ?? null;

  return (
    <div class="ph-workspace-panel" data-testid="quests-panel">
      <div class="ph-workspace-list" data-testid="quest-list">
        <div class="ph-row">
          <strong style={{ flex: 1 }}>Quests</strong>
          <button class="ph-mini" data-testid="close-quests" aria-label="Close" onClick={props.onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {session.project.quests.map((q) => (
          <div key={q.id} class="ph-row">
            <button class={q.id === open ? 'ph-item ph-on' : 'ph-item'} data-quest={q.id} onClick={() => setOpen(q.id)}>
              {q.name} <small>{q.objectives.length} steps</small>
            </button>
            <button
              class="ph-mini"
              title="Delete this quest"
              onClick={() => {
                if (!confirm(`Delete "${q.name}"?`)) return;
                session.run(removeQuest(q.id));
                if (open === q.id) setOpen(null);
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          class="ph-item"
          data-testid="add-quest"
          onClick={() => {
            const name = prompt('Quest name', 'A quest');
            if (name === null || name.trim() === '') return;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (id === '' || session.project.quests.some((q) => q.id === id)) return;
            session.run(
              addQuest(
                questSchema.parse({
                  id,
                  name: name.trim(),
                  objectives: [{ id: 'first-step', text: 'Do the first thing.' }],
                }),
              ),
            );
            setOpen(id);
            props.onChange();
          }}
        >
          + Quest
        </button>
      </div>
      <div class="ph-workspace-body">
        {quest === null ? (
          <div class="ph-hint">Pick a quest to write its steps.</div>
        ) : (
          <QuestEditor session={session} quest={quest} onChange={props.onChange} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Create `src/editor/ui/ModelsWorkspace.tsx`**

```tsx
/**
 * Imported models, as a workspace: what the project declares, where each one
 * loads from, and a way to add another by URL.
 */

import { modelAssetSchema } from '../../engine/render/assets';
import { addAsset, removeAsset, type EditorSession } from '../session';
import { Icon } from './icons';

export function ModelsWorkspace(props: {
  session: EditorSession;
  /** The project's model list changed; the loader should follow. */
  onAssetsChanged?: () => void;
  onChange: () => void;
  onClose: () => void;
}): preact.JSX.Element {
  const { session } = props;
  return (
    <div class="ph-workspace-panel" data-testid="models-panel">
      <div class="ph-workspace-body" data-testid="asset-list">
        <div class="ph-row">
          <strong style={{ flex: 1 }}>Models</strong>
          <button class="ph-mini" data-testid="close-models" aria-label="Close" onClick={props.onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {session.project.assets.map((asset) => (
          <div key={asset.id} class="ph-row" data-asset={asset.id}>
            <span style={{ flex: 1 }}>
              {asset.id} <small>{asset.url}</small>
            </span>
            <button
              class="ph-mini"
              title="Remove this model"
              onClick={() => {
                if (!confirm(`Remove model "${asset.id}"?`)) return;
                session.run(removeAsset(asset.id));
                props.onAssetsChanged?.();
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          class="ph-item"
          data-testid="add-model"
          onClick={() => {
            const url = prompt('Model file (.glb / .gltf URL)', '/models/thing.glb');
            if (url === null || url.trim() === '') return;
            const base = url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? 'model';
            const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
            if (session.project.assets.some((a) => a.id === id)) return;
            const scale = Number(prompt('Scale (a tile is one unit)', '1')) || 1;
            session.run(addAsset(modelAssetSchema.parse({ id, url: url.trim(), scale })));
            props.onAssetsChanged?.();
            props.onChange();
          }}
        >
          + Model
        </button>
        <div class="ph-note">Pick an imported model from Terrain's Props tab, or name it on an object, to use it.</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Create `src/editor/ui/ProblemsPopover.tsx`**

```tsx
/**
 * What Check found: errors first, then warnings, in the validator's own words.
 */

import { summarise, type Problem } from '../validate';
import { Icon } from './icons';

export function ProblemsPopover(props: { problems: readonly Problem[]; onClose: () => void }): preact.JSX.Element {
  const sorted = [...props.problems].sort(
    (a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1),
  );
  return (
    <div class="ph-popover ph-panel" data-testid="problems">
      <div class="ph-popover-head">
        <strong>{summarise(props.problems)}</strong>
        <button class="ph-mini" aria-label="Close" onClick={props.onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <ul>
        {sorted.slice(0, 30).map((problem, i) => (
          <li key={i} class={problem.severity === 'error' ? 'ph-bad' : 'ph-warm'}>
            {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 11: Create `src/editor/ui/EditorShell.tsx`**

> **Constraint, easy to break without noticing:** in Inspector mode, the Inspector side panel must hold the first `<input>` in `#app`. `demo.spec.ts` ("shows the inspector for a clicked object") fills `#app input:first` and expects the object's *name* to change. The top bar renders an input only while the Project menu is open (the file picker), and the library strip is not shown in Inspector mode, so this holds as written. Do not add an always-visible input (a search box, say) to the top bar or anywhere before the side panel without giving that test a testid for the name field in the same commit.

```tsx
/**
 * The editor: a top bar of modes over the board, and whatever the mode in hand
 * needs around the edges.
 *
 * It replaces the side panel that carried every tool and every form in one
 * scrolling column. The shape is the TaleSpire one the user asked for: tools on
 * a rail, things to put down in a strip along the bottom, properties on the
 * right, and each mode showing only its own. The long-lived editors (party,
 * cards, items, quests, code, models, a conversation) open as workspaces under
 * the bar, which stays put, so the way back is always on screen.
 *
 * Thin on purpose, like the panel it replaces. Which tools a mode owns and what
 * a click means are `modes.ts` and `controller.ts`; what the strip offers is
 * `library.ts`. This file arranges them.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import './editor.css';
import { SRD_CONDITIONS } from '../../engine/content/conditions';
import type { AbilityDef } from '../../engine/content/abilities';
import type { AdversaryDef } from '../../engine/content/types';
import type { SrdCharacterContent } from '../../engine/content/srd/daggersearch';
import type { Interactable } from '../../engine/scene/schema';
import type { EditorController, EditorTool } from '../controller';
import type { EditorSession } from '../session';
import { EDITOR_MODES, MODE_TOOLS, type EditorMode } from '../modes';
import { creatureTabs, groundTab, objectsTab, propsTab, type LibraryItem } from '../library';
import { validateProject, type Problem } from '../validate';
import { TopBar, type Menu, type Workspace } from './TopBar';
import { SceneMenu } from './SceneMenu';
import { ToolRail } from './ToolRail';
import { LibraryStrip } from './LibraryStrip';
import { CombatSide, InspectorSide, InteractionSide, TerrainSide, type PickableIds } from './ModeSides';
import { DialogueGraph } from './DialogueGraph';
import { PartyPanel } from './PartyPanel';
import { AbilityPanel } from './AbilityPanel';
import { ItemPanel } from './ItemPanel';
import { CodePanel } from './CodePanel';
import { QuestsWorkspace } from './QuestsWorkspace';
import { ModelsWorkspace } from './ModelsWorkspace';
import { ProblemsPopover } from './ProblemsPopover';

export interface EditorShellProps {
  session: EditorSession;
  controller: EditorController;
  terrainIds: readonly string[];
  /** Swatch colour per terrain id, for the Ground tab. */
  terrainColors: Readonly<Record<string, string>>;
  propModels: readonly string[];
  /** The SRD's stat blocks, for the creature library. */
  adversaries: readonly AdversaryDef[];
  /** Ids the validator should consider resolvable. */
  knownModels: ReadonlySet<string>;
  knownAdversaries: ReadonlySet<string>;
  /** Hooks the engine registers itself, listed in the Code panel. */
  nativeHooks: readonly string[];
  /** The cards the engine ships, listed beside the project's own. */
  libraryAbilities: readonly AbilityDef[];
  /** The vendored SRD content the Party panel picks from, and validates against. */
  characterContent: SrdCharacterContent;
  /** The scene the party is standing in, which need not be the one being edited. */
  playingScene: string;
  onPlay: () => void;
  /** Play in the room being edited, arriving on its spawns. */
  onPlayHere?: () => void;
  /** Undo and redo, redrawing the board: a session undo alone leaves it stale. */
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  /** The project's model list changed; the loader should follow. */
  onAssetsChanged?: () => void;
  onSwitchScene: (id: string) => void;
  onAddScene: (name: string) => void;
  onRenameScene: (id: string, name: string) => void;
  onRemoveScene: (id: string) => void;
  onSetStartScene: (id: string) => void;
}

/** Typing into a field must not switch modes or close what is being typed in. */
function typing(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function EditorShell(props: EditorShellProps): preact.JSX.Element {
  const { session, controller } = props;
  // The session and controller are mutable objects rather than signals, so the
  // shell re-renders on a version counter, as the side panel did.
  const [version, setVersion] = useState(0);
  useEffect(() => session.subscribe(() => setVersion((v) => v + 1)), [session]);
  const bump = (): void => setVersion((v) => v + 1);

  const [menu, setMenu] = useState<Menu | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  /** The conversation whose graph is open, in Interaction. */
  const [graph, setGraph] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  const scene = controller.scene;
  const mode = controller.mode;
  const tool = controller.state.tool;

  const changeMode = (next: EditorMode): void => {
    controller.setMode(next);
    setMenu(null);
    setWorkspace(null);
    setGraph(null);
    bump();
  };

  /** Esc closes the nearest thing: a menu, the problems, a workspace, a graph, then the selection. */
  const escape = (): void => {
    if (menu !== null) setMenu(null);
    else if (showProblems) setShowProblems(false);
    else if (workspace !== null) setWorkspace(null);
    else if (graph !== null) setGraph(null);
    else if (controller.selected !== null) {
      controller.selected = null;
      bump();
    }
  };

  // One key listener for the life of the shell, reading the latest handlers.
  const keys = useRef({ changeMode, escape });
  keys.current = { changeMode, escape };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (typing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      const index = ['1', '2', '3', '4'].indexOf(event.key);
      if (index >= 0) keys.current.changeMode(EDITOR_MODES[index]!);
      else if (event.key === 'Escape') keys.current.escape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A click anywhere outside a menu closes it, the way every menu bar behaves.
  useEffect(() => {
    if (menu === null) return;
    const onDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest('.ph-menu-wrap') === null) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  const check = (): void => {
    setProblems(
      validateProject(session.project, {
        knownModels: props.knownModels,
        knownAdversaries: props.knownAdversaries,
        knownHooks: new Set(props.nativeHooks),
        knownConditions: new Set(SRD_CONDITIONS.map((c) => c.id)),
        characterContent: props.characterContent,
      }),
    );
    setShowProblems(true);
  };

  const ids: PickableIds = {
    sceneIds: session.project.scenes.map((s) => s.id),
    dialogueIds: session.project.dialogues.map((d) => d.id),
    encounterIds: scene.encounters.map((e) => e.id),
    quests: session.project.quests,
  };
  // A card's or an item's `run` can name either door: the engine's own hooks or
  // the project's code, which is exactly what the runner looks in.
  const hookIds = [...props.nativeHooks, ...session.project.code.map((c) => c.id)];
  const closeWorkspace = (): void => setWorkspace(null);
  const useTool = (next: EditorTool): void => {
    controller.setTool(next);
    bump();
  };

  /** A pick from Terrain's strip puts the matching tool in hand. */
  const pickForTerrain = (item: LibraryItem): void => {
    if (item.tab === 'ground') {
      controller.setTool('paintTerrain');
      controller.set('terrainId', item.id);
    } else if (item.tab === 'props') {
      controller.setTool('prop');
      controller.set('propModel', item.id);
    } else {
      controller.setTool('interactable');
      controller.set('interactableKind', item.id as Interactable['kind']);
    }
    bump();
  };
  const pickCreature = (item: LibraryItem): void => {
    controller.setTool('adversary');
    controller.set('adversaryId', item.id);
    bump();
  };
  const terrainPicked =
    tool === 'prop'
      ? controller.state.propModel
      : tool === 'interactable'
        ? controller.state.interactableKind
        : tool === 'paintTerrain'
          ? controller.state.terrainId
          : '';

  let body: preact.JSX.Element | preact.JSX.Element[] | null = null;
  if (workspace === null && graph === null) {
    if (mode === 'inspect') {
      body = <InspectorSide session={session} controller={controller} ids={ids} onChange={bump} />;
    } else if (mode === 'terrain') {
      body = [
        <ToolRail key="rail" mode={mode} tools={MODE_TOOLS.terrain} current={tool} onTool={useTool} />,
        <LibraryStrip
          key="terrain-library"
          testId="terrain-library"
          tabs={[
            groundTab(props.terrainIds, props.terrainColors),
            propsTab(props.propModels, session.project.assets.map((a) => a.id)),
            objectsTab(),
          ]}
          picked={terrainPicked}
          onPick={pickForTerrain}
        />,
        <TerrainSide key="side" controller={controller} onChange={bump} />,
      ];
    } else if (mode === 'combat') {
      body = [
        <ToolRail key="rail" mode={mode} tools={MODE_TOOLS.combat} current={tool} onTool={useTool} />,
        <LibraryStrip
          key="combat-library"
          testId="combat-library"
          tabs={creatureTabs(props.adversaries)}
          picked={tool === 'adversary' ? controller.state.adversaryId : ''}
          onPick={pickCreature}
        />,
        <CombatSide key="side" controller={controller} onChange={bump} />,
      ];
    } else {
      body = <InteractionSide session={session} onOpen={setGraph} onChange={bump} />;
    }
  }

  const openGraph = graph === null ? null : (session.project.dialogues.find((d) => d.id === graph) ?? null);
  let workspaceBody: preact.JSX.Element | null = null;
  switch (workspace) {
    case 'party':
      workspaceBody = <PartyPanel session={session} content={props.characterContent} onChange={bump} onClose={closeWorkspace} />;
      break;
    case 'cards':
      workspaceBody = (
        <AbilityPanel
          session={session}
          libraryAbilities={props.libraryAbilities}
          hookIds={hookIds}
          adversaryIds={props.adversaries.map((a) => a.id)}
          {...ids}
          onChange={bump}
          onClose={closeWorkspace}
        />
      );
      break;
    case 'items':
      workspaceBody = (
        <ItemPanel session={session} content={props.characterContent} hookIds={hookIds} {...ids} onChange={bump} onClose={closeWorkspace} />
      );
      break;
    case 'code':
      workspaceBody = <CodePanel session={session} nativeHooks={props.nativeHooks} onChange={bump} onClose={closeWorkspace} />;
      break;
    case 'quests':
      workspaceBody = <QuestsWorkspace session={session} onChange={bump} onClose={closeWorkspace} />;
      break;
    case 'models':
      workspaceBody = (
        <ModelsWorkspace session={session} onAssetsChanged={props.onAssetsChanged} onChange={bump} onClose={closeWorkspace} />
      );
      break;
    case null:
      break;
  }

  return (
    <div class="ph-editor" data-testid="editor-shell" data-version={version}>
      <TopBar
        session={session}
        mode={mode}
        menu={menu}
        sceneName={scene.name || scene.id}
        sceneSize={`${scene.width}×${scene.height}`}
        problems={problems}
        sceneMenu={
          <SceneMenu
            session={session}
            editing={scene.id}
            playingScene={props.playingScene}
            onSwitch={props.onSwitchScene}
            onAdd={props.onAddScene}
            onRename={props.onRenameScene}
            onRemove={props.onRemoveScene}
            onSetStart={props.onSetStartScene}
            onClose={() => setMenu(null)}
          />
        }
        onMode={changeMode}
        onMenu={setMenu}
        onWorkspace={(next) => {
          setGraph(null);
          setWorkspace(next);
        }}
        onSave={props.onSave}
        onLoad={props.onLoad}
        onCheck={check}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onPlay={props.onPlay}
        onPlayHere={props.onPlayHere}
      />
      {body}
      {openGraph !== null ? (
        <div class="ph-workspace">
          <DialogueGraph session={session} dialogue={openGraph} {...ids} onClose={() => setGraph(null)} onChange={bump} />
        </div>
      ) : null}
      {workspaceBody === null ? null : <div class="ph-workspace">{workspaceBody}</div>}
      {showProblems && problems !== null ? (
        <ProblemsPopover problems={problems} onClose={() => setShowProblems(false)} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 12: Wire `src/main.ts` to the shell.** Every anchor below is unique. Check each with a grep before you change it.

(a) Imports. Replace `import { EditorPanel } from './editor/ui/EditorPanel';` with:

```ts
import { EditorShell } from './editor/ui/EditorShell';
```

Directly after `import { SceneView, hueOf } from './engine/render/scene-view';`, add:

```ts
import { DEFAULT_TERRAIN_COLORS } from './engine/render/terrain-mesh';
```

(b) The creature list. Replace `const ADVERSARY_IDS = [...SRD_ADVERSARIES.keys()].sort();` with the line below. First confirm with `grep -n "ADVERSARY_IDS" src/main.ts` that `renderPanel` is its only other use.

```ts
const ADVERSARY_DEFS = [...SRD_ADVERSARIES.values()].sort((a, b) => a.name.localeCompare(b.name));
```

(c) Open on the Inspector. Directly before `const KNOWN_MODELS = new Set(MODELS.map((m) => m.id));`, add:

```ts
// The editor opens on the Inspector, the first of the top bar's modes.
editor.setMode('inspect');

```

In `loadProjectText`, directly after the statement that ends the `editor = new EditorController({ … });` block, add:

```ts
  editor.setMode('inspect');
```

Opening on the Inspector changes the current tool from `paintTerrain` to `select`. Three driver paths reach `editor.begin`:
- `placeProp` sets its own tool.
- `editAt` uses whatever tool is current. Every `editAt` call in `tests/e2e` is preceded by a `setTool` in the same block: `editor-panels.spec.ts:121→123` and `demo.spec.ts:344→346`, `350→352`, `356→358`, `413→415`, `444→446`, `728→730` and `839→841`.
- The canvas pointer handler uses the current tool too. No spec clicks the board in edit mode; every `screenOf`/`screenAt` click is in play mode.

So no existing test depends on the old default. A new spec that calls `editAt` or `setTerrain` without first calling `setTool` will select instead of paint.

(d) Undo and redo from anywhere. Directly before `let mode: 'play' | 'edit' = 'play';`, add:

```ts
/**
 * Undo from anywhere - a key, the top bar, a test - and redraw what it touched.
 * The top bar's button used to call the session alone and left the board stale.
 */
function undoEdit(): boolean {
  const ok = session.undo();
  rebuildTerrain();
  view.setDecos(editor.scene.decos);
  if (mode === 'edit') renderPanel();
  return ok;
}

function redoEdit(): boolean {
  const ok = session.redo();
  rebuildTerrain();
  view.setDecos(editor.scene.decos);
  if (mode === 'edit') renderPanel();
  return ok;
}
```

In the `keydown` handler, replace:

```ts
      if (event.shiftKey) session.redo();
      else session.undo();
      rebuildTerrain();
      view.setDecos(editor.scene.decos);
      renderPanel();
```

with:

```ts
      if (event.shiftKey) redoEdit();
      else undoEdit();
```

In the driver object, replace the bodies of `undo` and `redo` so they read:

```ts
  undo: (): boolean => undoEdit(),
  redo: (): boolean => redoEdit(),
```

(e) Render the shell. Replace the whole `renderPanel` function with:

```ts
function renderPanel(): void {
  render(
    h(EditorShell, {
      session,
      controller: editor,
      terrainIds: TERRAIN_IDS,
      terrainColors: DEFAULT_TERRAIN_COLORS,
      propModels: PROP_MODELS,
      adversaries: ADVERSARY_DEFS,
      knownModels: KNOWN_MODELS,
      knownAdversaries: new Set(SRD_ADVERSARIES.keys()),
      nativeHooks: [...SRD_HOOKS.keys()],
      libraryAbilities: SRD_ABILITIES,
      characterContent: SRD_CHARACTERS,
      playingScene: demo.scene.id,
      onPlay: () => setMode('play'),
      onPlayHere: () => playAt(editor.sceneId, null),
      onUndo: () => void undoEdit(),
      onRedo: () => void redoEdit(),
      onSave: saveProject,
      onLoad: loadProject,
      onAssetsChanged: () => {
        for (const id of assets.ids()) assets.remove(id);
        for (const asset of session.project.assets) assets.add(asset);
        view.setDecos(editor.scene.decos);
      },
      onSwitchScene: (id: string) => {
        editor.switchScene(id);
        rebindScene();
        refreshEditor();
      },
      onAddScene: (name: string) => {
        const id = newSceneId(name);
        session.run(addScene(blankScene(id, 12, 10)));
        session.run(renameScene(id, name));
        editor.switchScene(id);
        rebindScene();
        refreshEditor();
      },
      onRenameScene: (id: string, name: string) => {
        session.run(renameScene(id, name));
        renderPanel();
      },
      onRemoveScene: (id: string) => {
        session.run(removeScene(id));
        if (editor.sceneId === id) editor.switchScene(session.project.scenes[0]!.id);
        rebindScene();
        refreshEditor();
      },
      onSetStartScene: (id: string) => {
        session.run(setStartScene(id));
        renderPanel();
      },
    }),
    app,
  );
}
```

(f) Update the header comment near the top of `main.ts`. Replace `Edit: pick a tool and drag on the map. Ctrl+Z / Ctrl+Shift+Z undo and redo.` with:

```ts
 * Edit: pick a mode in the top bar (1-4), a tool on its rail and a thing from
 * its strip, then click or drag on the map. Ctrl+Z / Ctrl+Shift+Z undo and redo.
```

- [ ] **Step 13: Delete the side panel**

Run: `git rm src/editor/ui/EditorPanel.tsx`

Run: `grep -rn "EditorPanel" src tests`
Expected: nothing, apart from prose in comments. If a comment names the old panel, reword it to say "the shell".

- [ ] **Step 14: Typecheck and run the unit tests**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run`
Expected: all pass. No node test imports the shell.

- [ ] **Step 15: Point the existing specs at the shell** — the panels now open from Content ▾, and conversations live in Interaction.

In `tests/e2e/editor-panels.spec.ts`:
- In the first test's loop, add `await page.locator('[data-testid="open-content"]').click();` as the first line of the loop body, before `const button = …`.
- In the second test's loop, add the same line before ``await page.locator(`[data-testid="${open}"]`).click();``.
- In the last test, add the same line before `await page.locator('[data-testid="open-party"]').click();`.

In `tests/e2e/demo.spec.ts`, use a replace-all for this exact line, which occurs five times:

```ts
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();
```

Replace each occurrence with:

```ts
  await page.locator('[data-testid="mode-interaction"]').click();
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();
```

Replace `  await page.locator('[data-quest="the-wardens-word"]').click();` with:

```ts
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-quests"]').click();
  await page.locator('[data-quest="the-wardens-word"]').click();
```

Replace `  await page.locator('button', { hasText: '+ Quest' }).click();` with:

```ts
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-quests"]').click();
  await page.locator('button', { hasText: '+ Quest' }).click();
  // The workspace covers the board; close it before the inspector is needed.
  await page.locator('[data-testid="close-quests"]').click();
```

Replace `  await expect(page.locator('[data-asset="duck"]')).toBeVisible();` with:

```ts
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-models"]').click();
  await expect(page.locator('[data-asset="duck"]')).toBeVisible();
```

- [ ] **Step 16: Run the whole browser suite**

Run: `npx playwright test --reporter=list`
Expected: every test passes, 83 or more.

If one fails because it clicked something that moved, move the test to the shell's way of reaching it, in the style of Step 15. Never weaken what it asserts. If one fails for any other reason, stop and read it: the shell must not change what play does.

- [ ] **Step 17: Look at the editor.** Save a throwaway script (in your scratchpad, not the repo) that opens the dev page, presses Ctrl+E, then presses 1, 2, 3 and 4 in turn, taking a screenshot after each. `tests/e2e/editor-panels.spec.ts`'s `editing()` helper shows how to boot. Read every image and check:
- the purple top bar;
- the four mode tabs with the active one lit;
- the rail and the strip in Terrain and Combat;
- the side panel on the right;
- the conversation list in Interaction;
- nothing overlapping the top bar at 1280×800.

Fix whatever is wrong before committing.

- [ ] **Step 18: Commit**

```bash
git add -A src/editor/ui src/main.ts tests/e2e/demo.spec.ts tests/e2e/editor-panels.spec.ts
git commit -F - <<'EOF'
The editor becomes a shell of modes, and the side panel goes

The single 268-pixel panel that carried every tool and form is replaced by the
layout the user approved:
- a purple top bar with Project and Content menus, the four modes (1-4), the
  scene picker, undo, redo and Play;
- each mode's tools on a rail and its things to put down in a strip along the
  bottom, with a side panel beside the board;
- party, cards, items, quests, code and models as workspaces under the bar.

Conversations move into Interaction now rather than in slice 5, because the
panel that held them is gone. Terrain and Combat still hold the old tools, as
the spec says, until parts 3 and 4 replace them.

Undo and redo now go through one path that redraws the board. The panel's Undo
button used to leave it stale.

Verification: npx tsc --noEmit is clean, npx vitest run passes, and
npx playwright test passes: <N> tests, with editor-panels.spec.ts and
demo.spec.ts moved to the shell's way of reaching panels, quests, models and
conversations. The screenshots of each mode were read.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PEcVfJhHQKVdPeZYodMcqg
EOF
```

Replace `<N>` with the count Playwright reported before running the commit.

---

### Task 5: The shell, tested in a browser

**Files:**
- Modify: `src/main.ts` (the `declare global` block and the driver object)
- Modify: `tests/e2e/demo.spec.ts` (the hand-kept copy of the driver type)
- Create: `tests/e2e/editor-shell.spec.ts`

**Interfaces:**
- Consumes: the test ids listed in Global Constraints; `EditorController.mode` / `setMode`.
- Produces: driver handles `editorMode: () => string` and `setEditorMode: (mode: string) => void`.

- [ ] **Step 1: Write the failing spec** — create `tests/e2e/editor-shell.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

/**
 * The editor's shell, clicked: the top bar and its menus, the four modes and
 * their keys, each mode's tools and library, workspaces under the bar, and the
 * purple the user asked for.
 */

async function editing(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    window.__polyheart!.setDiceSpeed(0);
    window.__polyheart!.setMode('edit');
  });
  return errors;
}

const mode = (page: Page): Promise<string> => page.evaluate(() => window.__polyheart!.editorMode());

test('the top bar holds the four modes in the order the user set, and 1-4 switch them', async ({ page }) => {
  const errors = await editing(page);
  await expect(page.locator('[data-testid="top-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid^="mode-"]')).toHaveText([/Inspector/, /Terrain/, /Combat/, /Interaction/]);
  // The editor opens on the first of them.
  expect(await mode(page)).toBe('inspect');

  for (const [key, expected] of [
    ['2', 'terrain'],
    ['3', 'combat'],
    ['4', 'interaction'],
    ['1', 'inspect'],
  ] as const) {
    await page.keyboard.press(key);
    expect(await mode(page)).toBe(expected);
    await expect(page.locator(`[data-testid="mode-${expected}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `test-results/shell-${expected}.png` });
  }
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the editor is purple', async ({ page }) => {
  const errors = await editing(page);
  const active = page.locator('[data-testid="mode-inspect"]');
  expect(await active.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(181, 140, 255)');
  expect(await page.locator('[data-testid="play"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(181, 140, 255)',
  );
  expect(errors).toEqual([]);
});

test('Terrain: its own tools, and a pick from the strip takes up the tool that places it', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="mode-terrain"]').click();
  await expect(page.locator('[data-testid="tool-rail"] [data-tool]')).toHaveCount(6);

  const strip = page.locator('[data-testid="terrain-library"]');
  await strip.locator('[data-tab="props"]').click();
  await strip.locator('[data-item="barrel"]').click();
  await expect(page.locator('[data-testid="tool-rail"] [data-tool="prop"]')).toHaveAttribute('aria-pressed', 'true');

  const placed = await page.evaluate(() => {
    const api = window.__polyheart!;
    const before = api.propCount();
    api.editAt(2 * 22 + 2);
    return api.propCount() - before;
  });
  expect(placed).toBe(1);
  expect(errors).toEqual([]);
});

test('Combat: its own tools, and a creature found by searching is the one placed', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="mode-combat"]').click();
  await expect(page.locator('[data-testid="tool-rail"] [data-tool]')).toHaveCount(4);

  const strip = page.locator('[data-testid="combat-library"]');
  await strip.locator('[data-testid="library-search"]').fill('bramble');
  await strip.locator('[data-item="tangle-bramble"]').click();

  const placed = await page.evaluate(() => {
    const api = window.__polyheart!;
    const kinds = (): string[] =>
      (JSON.parse(api.exportProject()) as { scenes: { encounters: { adversaries: { adversary: string }[] }[] }[] }).scenes[0]!
        .encounters.flatMap((e) => e.adversaries.map((a) => a.adversary));
    const brambles = (): number => kinds().filter((kind) => kind === 'tangle-bramble').length;
    const before = { all: kinds().length, brambles: brambles() };
    api.editAt(2 * 22 + 2);
    return { added: kinds().length - before.all, brambles: brambles() - before.brambles };
  });
  // One creature more, and it is the one the search found - wherever the encounter lists it.
  expect(placed).toEqual({ added: 1, brambles: 1 });
  expect(errors).toEqual([]);
});

test('Content opens a workspace under the top bar, and Esc closes it', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-quests"]').click();
  await expect(page.locator('[data-testid="quests-panel"]')).toBeVisible();
  // The way back is still on screen.
  await expect(page.locator('[data-testid="mode-inspect"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/shell-workspace.png' });

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="quests-panel"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Interaction lists the conversations and opens one as a graph', async ({ page }) => {
  const errors = await editing(page);
  await page.keyboard.press('4');
  await page.getByRole('button', { name: /the-listening-pillar/ }).click();
  await expect(page.locator('[data-testid="dialogue-graph"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Project: Check lists what it found', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-project"]').click();
  await page.locator('[data-testid="check-project"]').click();
  await expect(page.locator('[data-testid="problems"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the scene picker switches the room being edited, and the top bar undoes', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-scenes"]').click();
  await page.locator('[data-testid="scene-menu"] [data-scene="the-pit"]').click();
  expect(await page.evaluate(() => window.__polyheart!.editScene())).toBe('the-pit');

  const painted = await page.evaluate(() => {
    const api = window.__polyheart!;
    api.setTool('paintTerrain');
    api.setTerrain('wall');
    const before = api.terrainAt(0);
    api.editAt(0);
    return { before, after: api.terrainAt(0) };
  });
  expect(painted.after).toBe('wall');
  await page.locator('[data-testid="undo"]').click();
  expect(await page.evaluate(() => window.__polyheart!.terrainAt(0))).toBe(painted.before);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test tests/e2e/editor-shell.spec.ts --reporter=list`
Expected: FAIL. The first test fails on `editorMode is not a function`. It also fails at typecheck, because `editorMode` is not on the driver type yet.

- [ ] **Step 3: Add the handles.** In `src/main.ts`:
- In the `declare global` block, directly after `setMode: (mode: 'play' | 'edit') => void;`, add:

```ts
      /** The top bar's mode: 'inspect', 'terrain', 'combat' or 'interaction'. */
      editorMode: () => string;
      setEditorMode: (mode: string) => void;
```

- In the driver object, directly after the line `  setMode,`, add:

```ts
  editorMode: (): string => editor.mode,
  setEditorMode: (next: string): void => {
    editor.setMode(next as EditorMode);
    if (mode === 'edit') renderPanel();
  },
```

- Add the type import beside the other editor imports:

```ts
import type { EditorMode } from './editor/modes';
```

In `tests/e2e/demo.spec.ts`, add the same two members to its copy of the type, directly after its `setMode: (mode: 'play' | 'edit') => void;`:

```ts
      editorMode: () => string;
      setEditorMode: (mode: string) => void;
```

- [ ] **Step 4: Run the spec and watch it pass**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx playwright test tests/e2e/editor-shell.spec.ts --reporter=list`
Expected: PASS, 8 tests.

Then open and read `test-results/shell-inspect.png`, `shell-terrain.png`, `shell-combat.png`, `shell-interaction.png` and `shell-workspace.png`. In each, the mode's own furniture is on screen and nothing overlaps.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts tests/e2e/demo.spec.ts tests/e2e/editor-shell.spec.ts
git commit -F - <<'EOF'
The shell has its own browser test, and the driver says which mode is up

editor-shell.spec.ts clicks the new editor the way a designer would:
- the four modes and their number keys;
- each mode's rail and strip, with a pick from the strip taking up the tool that
  places it;
- a creature found by search being the one that lands;
- workspaces under a top bar that stays visible;
- the conversation graph in Interaction, Check, the scene picker, and the top
  bar's undo;
- the computed purple of the active tab.

The driver gains editorMode and setEditorMode, mirrored in demo.spec.ts.

Verification: the new spec failed first, because the driver had no editorMode; it
now passes (8 tests). npx tsc --noEmit is clean. The per-mode screenshots were
read.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PEcVfJhHQKVdPeZYodMcqg
EOF
```

---

### Task 6: Say what the editor is now, then run everything

**Files:**
- Modify: `docs/MANUAL.md` §3, `docs/CRPG-GAPS.md` §8, `docs/BACKLOG.md`

- [ ] **Step 1: Rewrite the start of `docs/MANUAL.md` §3** — replace everything from `## 3. The editor` down to, but not including, `### Objects and the inspector` with:

```markdown
## 3. The editor

Press `Ctrl+E`. The editor is a **top bar** over the board, and a **mode** decides what sits
around the board's edges. In edit mode the view follows the scene being edited, which need not be
the room the party is in; browsing scenes never moves the party or abandons their fight.

### The top bar

| Part | What it does |
|---|---|
| **Project ▾** | Save JSON · Load… · Check (lists what the validator finds; a red badge counts errors) |
| **Content ▾** | Party · Cards · Items & loot · Quests · Code · Models — each opens as a workspace under the bar; its ✕ or `Esc` closes it |
| **Inspector · Terrain · Combat · Interaction** | The four modes, also on keys `1`–`4` |
| **Scene ▾** | Every scene with its size; **▸** marks the one the project opens on and **●** the one the party is in. Click to edit it; **✎** renames, **▸** makes it the opening scene, **✕** deletes (refused for the opening scene or the last one); **+ New scene** adds a blank 12×10 room |
| **Undo / Redo** | The same history as `Ctrl+Z` / `Ctrl+Shift+Z`; hover for what it would undo |
| **▶ Play here / ▶ Play** | Play in this room from its spawns (Shift-click a tile to play from there), or go back to where the party is |

`Esc` closes the nearest thing: a menu, the problem list, a workspace, a conversation, then the
selection.

### The modes

| Mode | Around the board | What a click or drag does |
|---|---|---|
| **Inspector** (1) | The selected object's properties, on the right | Click an object to select it |
| **Terrain** (2) | Tools on the left rail; **Ground**, **Props** and **Objects** in the strip along the bottom; the tool's options on the right | Paint ground (brush 1×1, 3×3, 5×5); raise or lower it a level; place a prop (click it again to turn it); place an object (click one again to remove it); erase a prop, then the object under it |
| **Combat** (3) | Tools on the left rail; the SRD's creatures by tier in the strip, with a search; the encounter on the right | Place the picked creature in the encounter; toggle trigger cells that start it; toggle party start tiles; erase a creature, then a trigger cell, then a party start (never the last one) |
| **Interaction** (4) | The conversations, on the left | Click one to open its graph |

Picking something from a strip puts the tool that places it in hand. Terrain and Combat still hold
the editor's original tools; TaleSpire-style building and a creature palette with factions replace
them in later parts of the rebuild (`docs/superpowers/specs/2026-09-10-editor-shell-design.md`).

```

- [ ] **Step 2: Correct the rest of §3 where it says where things are.** Read every remaining subsection of §3 and replace each description of the old side panel with the new place:

| The text says | It now reads |
|---|---|
| "With Inspect, click an object" | "In Inspector mode, click an object" |
| the Conversations list, "+ Conversation" in the panel | "Interaction mode lists the conversations; + Conversation adds one" |
| the Quests list in the panel, "+ Quest" | "Content ▾ → Quests: the list on the left, the open quest's form beside it; + Quest adds one" |
| the Models list, "+ Model" | "Content ▾ → Models" |
| "Write a character…" / "Party (n)…" | "Content ▾ → Party" |
| "Write a card…" / "Cards (n)…" | "Content ▾ → Cards" |
| "Write an item…" / "Items (n)…" | "Content ▾ → Items & loot" |
| "Write logic in code…" / "Code (n)…" | "Content ▾ → Code" |
| "Check" at the bottom of the panel | "Project ▾ → Check" |
| "Save JSON" / "Load" in the panel | "Project ▾ → Save JSON / Load…" |

Run: `grep -n "panel on the left\|the panel\|below the tools\|Inspect tool\|With Inspect" docs/MANUAL.md`
Expected: no line in §3 still describing the side panel. Lines about the play screen's own panels stay.

- [ ] **Step 3: Record it in `docs/CRPG-GAPS.md` §8.** Directly after the paragraph that opens `### ~~8. The editor~~ — first pass done` (the one ending "Ctrl+E toggles play and edit."), add:

```markdown
**The shell (2026-09-10).** The user judged that editor "not even good enough to be called a
prototype", and it is being rebuilt to their direction. The plan is
`docs/superpowers/specs/2026-09-10-editor-shell-design.md`. The first slice replaced the side panel
with a purple top bar of four modes (Inspector, Terrain, Combat, Interaction):
- each mode has a tool rail, a library strip and a side panel;
- content editors open as workspaces under the bar;
- Combat's eraser takes creatures, trigger cells and party starts.

**Still open, and the spec's next slices:**
- The board in edit mode draws the played room's runtime state, not the document.
- Trigger cells and spawns are never drawn.
- No object has a model, so doors, chests, pillars and stairs are invisible in play too.
- Only objects can be inspected.
- Terrain and Combat still hold the original tools.
```

- [ ] **Step 4: Put the user's program in `docs/BACKLOG.md`.**

Directly after the line `## 2. The backlog, ranked`, and before the paragraph that begins "Ranked by **what it adds to a fight**", add:

```markdown
### 0. The editor rebuild — the user's direction, ahead of everything below

On 2026-09-10 the user set the editor as the priority, which overrides the fight-first ranking
that follows. There are five parts, each with its own spec, plan and slices:
1. Shell + Inspector
2. 3D multi-level world
3. TaleSpire-style Terrain
4. Combat with factions
5. Interaction graphs

Part 1's spec is `docs/superpowers/specs/2026-09-10-editor-shell-design.md`, and its slice plans
are in `docs/superpowers/plans/`. Part 2 starts from `docs/research/multilevel-dependency-map.md`.

**Done:** part 1, slice 1 (the shell's frame).
**Next:** part 1, slice 2 — the board shows the document, and objects get models.
```

Then re-pin the header. Replace the commit hash and the three numbers in the paragraph that begins `**Pinned to commit` with this slice's final commit and the counts from Step 5. Do it after Step 5, so the numbers are real.

- [ ] **Step 5: Run everything**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run`
Expected: all pass. Note the file and test counts: 1692 plus the new mode, controller and library tests.

Run: `npx playwright test --reporter=list`
Expected: all pass. Note the count: 83 plus the 8 in `editor-shell.spec.ts`.

Now re-pin the BACKLOG header with these counts, and name Task 5's commit (`git log -1 --format=%h`, run before this commit) as the pinned one. That is the tree the counts were measured on. This docs-only commit changes no code, so the pin stays true, and there is nothing to amend.

- [ ] **Step 6: Commit**

```bash
git add docs/MANUAL.md docs/CRPG-GAPS.md docs/BACKLOG.md
git commit -F - <<'EOF'
The manual, the gaps audit and the backlog describe the editor's new shell

MANUAL section 3 now describes:
- the top bar and its menus;
- the four modes, with what sits around the board and what a click does in each;
- where every content editor went.

CRPG-GAPS section 8 records the rebuild, and names the defects the next slices
fix: edit mode draws play state, triggers and spawns are never drawn, and no
object has a model. BACKLOG puts the user's five-part program ahead of the
fight-first ranking, and the header is re-pinned.

Verification: npx tsc --noEmit is clean; npx vitest run gives <unit counts>;
npx playwright test gives <e2e count>. Docs only in this commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PEcVfJhHQKVdPeZYodMcqg
EOF
```

Replace `<unit counts>` and `<e2e count>` with the numbers from Step 5.

---

## Self-review (done while writing)

- **Spec coverage (slice 1, §11.1):**
  - Tokens and `editor.css` → Task 2.
  - The top bar, menus, scene picker → Task 4, steps 3–4.
  - Modes with today's tools re-housed → Tasks 1 and 4.
  - Workspaces → Task 4, steps 8, 9 and 11.
  - The problems popover → Task 4, step 10.
  - A library strip without thumbnails → Tasks 3 and 4.
  - Existing e2e updated → Task 4, step 15.
  - Keys 1–4 and Esc (§4.7, partly) → Task 4, step 11.
  - The purple accent (§10.9) → Task 5.
  - Conversations in Interaction: pulled forward from slice 5, and said so at the top.
  - Not in this slice, by the spec: the edit view, object models, the selection model, the
    outliner, properties for every kind, drag-to-move, thumbnails, object behaviour in
    Interaction.
- **Names used across tasks:**
  - `EditorMode`, `EDITOR_MODES`, `MODE_LABELS`, `MODE_TOOLS`, `defaultTool`, `modeOfTool`
  - `EditorController.mode` / `setMode`
  - `LibraryItem.tab`, `groundTab`, `propsTab`, `objectsTab`, `creatureTabs`, `filterLibrary`
  - `TOOL_LABELS`, `Menu`, `Workspace`, `PickableIds`
  - `undoEdit` / `redoEdit`, `editorMode` / `setEditorMode`

  Each is defined in the task that produces it and used under the same name after.
- **Placeholders:** none in code. Two values are measured, not guessed: the Playwright count in
  Task 4's commit message, and the suite counts in Task 6's.
