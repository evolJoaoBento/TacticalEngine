# Editor shell and Inspector — design (part 1 of the editor rebuild)

**Date:** 2026-09-10 · **Status:** layout approved by the user; spec awaiting review
**Mockup:** the layout the user approved is the two-frame mockup rendered over the real demo room
(Inspector and Terrain frames), recoloured purple at the user's request.

---

## 0. The program this belongs to

On 2026-09-10 the user judged the editor "not even good enough to be called a prototype": one
268-pixel side panel carrying every tool and every content form, over flat per-tile ground. They
set a direction that overrides the fight-first ranking in `docs/BACKLOG.md`:

| Part | What | Depends on |
|---|---|---|
| **1** | **Shell + Inspector** (this spec): top bar with modes, outliner, properties for every placed thing, content workspaces, purple theme, and an editor that draws what the document says | — |
| 2 | **3D world engine**: multi-level map (walk on *and* under bridges, caves, upper floors) through the map format, pathfinding, line of sight, movement, saves and rendering. The user chose this over a one-walkable-surface option. Start from `docs/research/multilevel-dependency-map.md` | — |
| 3 | **Terrain mode, TaleSpire-style**: a library of tiles and props with real models; drag a rectangle, lift to set height; snap and free placement; box select, copy, erase. Replaces the paint/raise/lower/prop/object tools | 1, 2 |
| 4 | **Combat mode**: creature palette, factions with ally / neutral / hostile relations between each pair (the party is one faction), the engine reading relations for targeting and AI | 1 |
| 5 | **Interaction mode**: conversation trees and object interaction trees in one graph editor | 1 |

Each part gets its own spec, plan and implementation. The mode order in the top bar is the user's:
**Inspector, Terrain, Combat, Interaction.**

---

## 1. Goal of part 1

Replace the side panel with a mode-based shell. Make the editor **show** what the document
contains and let a designer **click any of it and change it in place**. Every authoring capability
that exists today stays reachable. No rules change.

Part 1 is deliberately honest about what it does not do: until parts 3 and 4 land, the Terrain and
Combat modes hold **today's tools**, re-housed in the new frame. The user accepted that when they
approved the layout.

## 2. What is there now, and what is wrong with it

Found while designing this, and verified against the running demo:

1. **One panel does everything.** `src/editor/ui/EditorPanel.tsx` stacks ten tools, the scene list,
   conversations, quests, models, project buttons and validation into a scrolling column; Party,
   Cards, Items, Code and the dialogue graph *replace* it wholesale while open.
2. **The editor draws the game, not the document.** Edit mode calls `view.syncTokens(demo.state)`
   — the runtime state of the room being *played*. A creature placed in the editor is not drawn
   until Play; a room the party is not in shows none of its creatures at all.
3. **Trigger cells and spawn points are never drawn.** Nothing in `main.ts` renders either.
4. **Objects are invisible, in play and in the editor.** `Interactable.model` is read by nothing,
   the model library has no chest, door, pillar or stair model, and every object in both demo rooms
   is `model: null` with no prop on its tile (`door-12-7`, `chest-19-13`, `pillar-14-7`,
   `stair-down`, `stair-up`, `strongbox`).
5. **Only objects can be inspected.** The Inspect tool hits interactables; props, creatures, spawns,
   triggers and tiles have no properties anywhere.
6. **Most creatures have no model.** `DEMO_MODELS` maps two of the 129 SRD adversaries
   (`acid-burrower`, `hollow-husk`); the rest stand as the magenta placeholder. Part 1 does not fix
   this (it is part 4's palette problem) but must not pretend otherwise in the library.

Items 2–4 are defects, not missing features. Part 1 fixes all three because the Inspector is
meaningless over a board that does not show what is on it.

## 3. Decisions

| # | Decision | Rejected alternative, and why |
|---|---|---|
| D1 | Layout as the approved mockup: top bar, left rail or outliner, bottom library strip, right properties panel, full-area workspaces under the top bar | Extra top-bar tabs for Party/Cards/Items/…: clutters the four modes the user named |
| D2 | Purple theme, as CSS custom properties on the editor root; the old cyan accent leaves the editor entirely | Restyling panel by panel: 196 colour literals in 12 files would drift |
| D3 | A **mode owns its tools**; choosing a tool selects its mode, so `setTool('paintTerrain')` keeps working | Modes and tools independent: two states that can disagree |
| D4 | **The editor draws the document** ("edit view"): creatures from every encounter at their authored spots, objects, spawns, trigger cells — rebuilt on each edit, in whatever room is being edited | Keep drawing play state: defect 2 |
| D5 | Objects are drawn in **both** modes. `model: null` changes meaning from "invisible" to "the default model for the kind", and a new `hidden` flag is the deliberate way to draw nothing | Keep null as invisible and default only in the editor: the invisible chest is a play defect, and every shipped object is null |
| D6 | The Inspector edits *what an object is and where*; *what it does* (effects, roll) moves to Interaction mode. The Inspector shows a summary and a link | Everything in the Inspector: the right panel becomes the old side column again |
| D7 | One selection model for every kind of thing, with a fixed pick order and click-again-to-cycle through a stack | Per-kind select tools: TaleSpire and BG3 tools select by clicking, not by choosing a tool first |
| D8 | Direct manipulation in Inspector mode: drag the selected thing to move it, Delete, R, F, Esc | Coordinates only: the user's bar is a level editor, not a form |
| D9 | The bottom library strip is one generic component; thumbnails are rendered from the model registry; a creature whose model is the placeholder shows a tier/role card instead | Text buttons: the palette is the TaleSpire half of the request |
| D10 | Content editors open as workspaces under the top bar, which stays visible | Modal dialogs: they hide the mode bar, and these are long-lived editors |
| D11 | A scoped stylesheet (`editor.css`, every selector under `.ph-editor`) for the new shell; existing panels keep inline styles but read colours from tokens | Inline styles only: menus and hover states need CSS; a page stylesheet cannot reach `.ph-editor`-scoped rules |

## 4. Layout

Everything floats over the full-window canvas (`#gl`); the shell root is `pointer-events: none`
and each panel turns them back on, as `#app` does today.

### 4.1 Top bar (46 px, full width)

- **Left:** `◆ Tactical Engine Editor` · **Project ▾** · **Content ▾**
- **Centre:** the mode switch — **Inspector 1 · Terrain 2 · Combat 3 · Interaction 4** — keys 1–4.
- **Right:** scene picker (`The Husk Vault 22×16 ▾`) · undo · redo · `● unsaved` · **▶ Play here**
  (`data-testid="play-here"`, kept) · **▶ Play**.

**Project ▾:** Save JSON · Load… · Check. Check runs `validateProject` and opens a problems popover
(errors first, first 30, the same text as today); the menu shows a count badge while problems stand.

**Content ▾:** Party · Cards · Items & loot · Quests · Code · Models, each with its count. Each opens
a workspace (§4.6). Menu items carry today's testids (`open-party`, `open-abilities`, `open-items`,
`open-code`) plus `open-quests` and `open-models`.

**Scene picker ▾:** every scene with its size, `▸` on the opening scene and `●` where the party is;
per row rename, make opening, delete (the same refusals as today); **+ New scene**.

### 4.2 Modes

| Mode | Key | Left | Bottom | Right | A click on the board |
|---|---|---|---|---|---|
| **Inspector** | 1 | Outliner (§4.4) | — | Properties of the selection (§4.5) | selects; drag the selection to move it |
| **Terrain** | 2 | Tool rail: Paint · Raise · Lower · Prop · Object · Erase (the prop, else the object, as today) *(interim, part 3 replaces)* | Library: Ground · Props · Objects | Brush size and the picked item's details | the tool acts |
| **Combat** | 3 | Tool rail: Creature · Trigger · Spawn · Erase (the creature on the tile, else its trigger cell, else a spawn) *(interim, part 4 replaces)* | Library: creatures, tabs Tier 1–4 and search | Encounter panel: current encounter, new, rename, starts on trigger, delete | the tool acts |
| **Interaction** | 4 | Conversations (+ new, delete) and this scene's objects | — | — | clicking an object opens its behaviour |

In Interaction the middle of the screen is the editor: the existing `DialogueGraph` for a
conversation, or the object behaviour editor (the effect list and roll from today's Inspector,
extracted as `ObjectBehaviour`) for an object. Part 5 replaces the latter with a graph.

### 4.3 Selection

```ts
type EditorSelection =
  | { kind: 'tile'; x: number; y: number }
  | { kind: 'prop'; index: number }            // decos have optional ids
  | { kind: 'object'; id: string }
  | { kind: 'creature'; encounterId: string; id: string }
  | { kind: 'spawn'; index: number }
  | { kind: 'encounter'; id: string };          // what a trigger cell belongs to
```

- **Pick order on a tile:** creature → object → prop (topmost) → spawn → encounter (trigger cell)
  → the tile itself. **Clicking the same tile again** selects the next thing down the stack, then
  wraps.
- **Revalidated after every edit, undo and redo:** a selection whose thing is gone becomes `null`.
  Prop and spawn indices stay valid because adds append and removes restore at their index on undo.
- The selection lives in the controller, is not an edit and never enters the undo history.
- The board shows it with the existing ring (`SceneView.showSelection`).

### 4.4 Outliner (Inspector, left, 250 px)

Search box, then groups: **Objects**, **Creatures** (by encounter), **Props** (grouped by model with
counts, expandable), **Party start** (spawns, numbered), **Triggers** (encounters with cell counts).
Clicking a row selects the thing and frames the camera on it. Built by a DOM-free
`outline(scene)` so grouping and filtering are tested in node.

### 4.5 Properties (Inspector, right, 300 px)

Every change goes through a session edit, so it is undoable, and typing coalesces into one step the
way `updateInteractable` already does (merge key per thing per field set).

| Kind | Fields |
|---|---|
| Tile | terrain (palette select) · height (number, ±) · tint (colour, clear) · what stands here (each a link that selects it) |
| Prop | model (library props and imported models) · rotation (0/90/180/270 and a degree field) · x, y · Delete |
| Object | name · flavour · kind · model (default by kind, §5.2) · hidden (draw nothing) · x, y · blocks movement · can be used again · key it needs · what it says without the key · summary pills (roll trait and Difficulty, effect count, travel, loot) · **Edit behaviour in Interaction →** · Delete |
| Creature | stat block (searchable over the SRD adversaries: name, tier, role, Difficulty, HP read-only) · display name · HP override · encounter (move it to another) · x, y · Delete |
| Spawn | x, y · "2 of 3" · Delete (disabled on the last: a scene must have one, and `setSpawns` already refuses) |
| Encounter | name · starts on trigger · its creatures (links) · trigger cells (count) · **Edit cells** (Combat, Trigger tool, this encounter) · Delete (with its creatures, one undo step) |

### 4.6 Workspaces

Content items and Interaction's editors open in a container below the top bar
(`top: 46px`, rest of the window). Party, Cards, Items and Code keep their panels and testids; their
root style changes from window-filling to container-filling, and their own Close buttons return to
the mode. Two new thin wrappers: **Quests** (the list and `QuestEditor`, moved out of the side
panel; `data-testid="quest-list"` kept) and **Models** (the list and add-by-URL; `asset-list` kept).
Switching mode or pressing Esc closes a workspace.

### 4.7 Keys

1–4 modes · Ctrl+E play/edit (as now) · Ctrl+Z / Ctrl+Shift+Z undo/redo (as now) · Delete or
Backspace deletes the selection · R turns a selected prop 90° · F frames the selection · Esc closes a
menu, then a workspace, then clears the selection, and cancels a drag in progress. All ignored while
typing (the existing `typing()` guard).

### 4.8 Pointer

- **Inspector:** a still left click selects (and cycles). A left press **on the selected thing**
  followed by a drag moves it: a ghost ring follows the tile under the pointer, release commits one
  edit (`Move chest`), Esc cancels, off the map is ignored. A left drag that starts anywhere else
  orbits, as in play. Tiles do not move.
- **Terrain, Combat:** as today — left press and drag applies the tool; the other buttons orbit and
  pan. Shift-click keeps "play from this tile".

## 5. The board in edit mode

### 5.1 The edit view (D4)

Whenever edit mode is on, and after every edit, undo, redo or scene switch:

- **Creatures:** one token per placement in every encounter of the edited scene, at its authored
  spot, built with `sceneStateFromScene(scene, grid, { adversaries })` and **no party**, synced with
  `syncTokens(state, { snap: true })` so nothing glides. The play state is never drawn in edit mode.
- **Objects:** drawn through `SceneView.setObjects` (§5.2).
- **Spawns:** painted as a zone in the good colour; their numbers are in the outliner.
- **Trigger cells:** painted as a zone per encounter in the warm colour; the current encounter's
  brighter.
- **Selection:** the ring on the selected thing's tile.

Returning to play re-syncs from `demo.state`, as `setMode('play')` already rebinds and refreshes.

### 5.2 Objects get models (D5)

- New procedural models in `render/procedural/library/props.ts`: `chest`, `door`, `door-open`,
  `pillar`, `stairs`, `runestone`, in the existing low-poly style.
- **A documented contract changes.** `interactableSchema.model` says `null` means "present but
  invisible". Nothing ever drew a model, so that meaning never took effect, and every shipped
  object is `null`. From part 1, `null` means the default model for the kind, and a new
  `hidden: z.boolean().default(false)` is how an object deliberately draws nothing (a scripted
  trigger spot, say). Old files parse unchanged. The schema comment and `MANUAL.md` §3 say so.
  `legacy-import.ts` is unchanged: a legacy node with no model now draws its kind's default, and
  no legacy test asserts an unseen object.
- A DOM-free `objectModel(interactable, state?)` in `engine/scene/` returns nothing when `hidden`,
  otherwise `interactable.model ?? default by kind` (chest → `chest`, door → `door`,
  pillar → `pillar`, portal → `stairs`, scripted → `runestone`), with `door-open` for an open door
  and **nothing** for a removed object.
- `SceneView.setObjects(objects, modelOf)` draws them like decos (one group each, rebuilt on
  change, same shadow and placement rules).
- Play calls it with the runtime state, so an opened door is drawn open and a removed thing
  disappears; edit calls it with no state, so every object is drawn as authored.

## 6. Library strip and thumbnails (D9)

- `LibraryStrip`: tabs, a search box, a horizontally scrolling row of cards (thumbnail, swatch or
  glyph; label; sublabel), a selected state. Picking a card sets the tool's item (`terrainId`,
  `propModel`, `interactableKind`, `adversaryId`) through the controller.
- **Terrain tabs (interim):** Ground (the palette's terrain types, as colour swatches from
  `DEFAULT_TERRAIN_COLORS` or the project palette), Props (library props and imported models),
  Objects (the five kinds, with their default models).
- **Combat tab set (interim):** Tier 1–4 plus search across all 129 SRD adversaries. A creature
  whose model resolves to the placeholder gets a card showing its tier and role rather than a
  magenta box.
- `render/thumbnails.ts`: `ModelThumbnails` renders a model id with its own small `WebGLRenderer`
  (96×96, transparent background, fixed three-quarter camera fitted to the model's bounds by a pure
  `fitCamera(box)`), caches the data URL per id, and renders lazily — a few per frame — so opening
  the strip never stalls. Imported glTF models get thumbnails once loaded.

## 7. Theme (D2, D11)

Tokens on `.ph-editor`:

| Token | Value | Token | Value |
|---|---|---|---|
| `--ph-bar` | `#120f19` | `--ph-accent` | `#b58cff` |
| `--ph-panel` | `rgba(23,19,33,0.96)` | `--ph-accent-bg` | `rgba(181,140,255,0.17)` |
| `--ph-raised` | `#181322` | `--ph-on-accent` | `#1a0f2e` |
| `--ph-field` | `#130f1b` | `--ph-warm` | `#f6c453` |
| `--ph-line` | `#30293f` | `--ph-good` | `#9ae08a` |
| `--ph-text` | `#ece8f4` | `--ph-bad` | `#ff8f7a` |
| `--ph-muted` | `#a59cba` | | |

The existing panels (`AbilityPanel`, `CheckEditor`, `CodePanel`, `ConditionEditor`,
`DialogueGraph`, `EffectList`, `Inspector` → split, `ItemPanel`, `PartyPanel`, `QuestEditor`,
`TargetEditor`) swap their colour literals for `var(--ph-…)`. Done means `#69d2ff` appears nowhere
under `src/editor/`. The play HUD is not the editor and does not change.

## 8. Architecture

Import direction as today: `editor/` may import `engine/`; `engine/` (outside `render/`) stays
headless.

**DOM-free, tested in node**

| File | Responsibility |
|---|---|
| `src/editor/modes.ts` | `EditorMode`, which tools each mode owns, `modeOfTool`, `defaultTool` |
| `src/editor/selection.ts` | `EditorSelection`, `pickAt(scene, point, previous)` (order and cycling), `revalidate`, `selectionTile` |
| `src/editor/outline.ts` | `outline(scene)` → groups and rows; `filterOutline(outline, query)` |
| `src/editor/controller.ts` | gains `mode`, `setMode`, `selection`, `select`, `pressInspect` / `dragInspect` / `endInspect`, `deleteSelection`, `rotateSelection`; `setTool` also sets the mode; `erase` acts by mode (§4.2) |
| `src/editor/session.ts` | new edits: `updateDeco`, `updateAdversary` (fields, position, and encounter), `updateEncounter`, `removeEncounter`, `setTint` — each with apply, undo and a merge key where typing drives it |
| `src/engine/scene/object-models.ts` | `objectModel(interactable, state?)` |
| `src/engine/scene/schema.ts` | `interactableSchema` gains `hidden` (default `false`); the `model` comment changes (§5.2) |

**Preact (thin, as the repo insists — decisions live in the files above)**

`EditorShell` (root; owns which menu, popover and workspace is open) · `TopBar` · `SceneMenu` ·
`ToolRail` · `LibraryStrip` · `Outliner` · `PropertiesPanel` with `TileProps`, `PropProps`,
`ObjectProps`, `CreatureProps`, `SpawnProps`, `EncounterProps` · `EncounterPanel` ·
`InteractionMode` · `ObjectBehaviour` (split out of `Inspector.tsx`) · `QuestsWorkspace` ·
`ModelsWorkspace` · `ProblemsPopover` · `editor.css` · `theme.ts`. `EditorPanel.tsx` is deleted;
`Inspector.tsx` becomes `ObjectProps` plus `ObjectBehaviour`.

**Render:** `render/thumbnails.ts`; `SceneView.setObjects`; new prop specs.

**`main.ts`:** `renderPanel` renders `EditorShell`; a `syncEditView()` runs on every editor change
and scene switch (§5.1); pointer handling routes by mode (§4.8); the new keys (§4.7); the driver
handles below.

**Data flow:** a panel or the pointer calls the controller or a session edit → the session notifies
→ `main.ts` redraws the edit view → the shell re-renders on the version counter it already uses.

## 9. The driver, and the e2e mirror

New handles on `window.__engine`, added to the `declare global` block in `src/main.ts` **and** the
hand-kept copy in `tests/e2e/demo.spec.ts` in the same patch:

`editorMode()`, `setEditorMode(mode)`, `selection()` (a plain object or `null`), `selectAt(tile)`,
`selectThing(kind, idOrIndex)`, `moveSelection(tile)`, `deleteSelection()`, `editTokens()` (ids
drawn in edit mode), `objectModels()` (object id → model drawn, in the room on screen).

The object handles the existing specs drive — `selectObject`, `editObject`, `objectField` — keep
their signatures and behaviour; they read and set a selection of kind `object`.

## 10. Testing

**Unit (node).**
- Modes and tool ownership.
- Pick order, cycling and revalidation after undo.
- Outline grouping and filtering.
- Controller press, drag, commit and cancel for each movable kind, plus delete and rotate, each
  undone.
- Every new session edit: apply, undo, redo and merge.
- `objectModel` defaults and states.
- `fitCamera`.

Each regression test is shown failing without its fix, per `DEVELOPING.md` §8.

**New e2e, `tests/e2e/editor-shell.spec.ts`:**
1. The four modes are in the top bar and keys 1–4 switch them. It takes a screenshot per mode to
   `test-results/shell-<mode>.png`, and the screenshots are read, not just taken.
2. The edit view draws the document:
   - A creature placed in Combat is in `editTokens()` at once, with no Play.
   - Switching to `the-pit` shows its objects.
   - `objectModels()` names a model for every object, and the screenshot shows the chest.
3. Inspector: click the chest in the outliner, rename it in the properties, and Ctrl+Z restores
   the name.
4. Drag a creature with the mouse. It moves, and one undo returns it.
5. Delete a prop with the key. Undo restores it.
6. Content ▾ → Party opens under a still-visible top bar, and its Close returns to the mode.
7. Interaction: a conversation opens the graph, and an object opens its behaviour showing
   "The roll".
8. Project ▾ → Check opens the problems popover.
9. The active mode tab's computed colour is the purple accent.

**Play regression.** Objects are drawn in play: the vault door, the chest and the pillar are in
`objectModels()`, and the door is drawn open after it is opened.

**Existing specs updated in the same slice:**
- `editor-panels.spec.ts` opens Content ▾ before its panel testids.
- `demo.spec.ts`:
  - The "shows the editor panel" text checks still pass: the brand reads "Tactical Engine Editor" and a
    mode tab reads "Terrain".
  - "shows the inspector for a clicked object" finds the name field by testid and the roll in
    Interaction.
  - The three conversation tests switch to Interaction first.
  - "shows the editor panel and keeps the scene renderable" paints walls over tiles x 6–15,
    y 4–11 and compares the middle pixel before and after. The door (12,7) and pillar (14,7) now
    stand inside that block; if one covers the sampled pixel, the test samples open ground
    instead. Checked when slice 2 lands.
  - `setTool` calls are unchanged (D3).

**Before claiming done:** `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`, all green, with
counts at or above the pinned 1692 unit / 83 e2e plus the new ones.

## 11. Slices (the plan will expand these)

Each ends green and is committed on its own:

1. **Theme and shell frame.** Tokens and `editor.css`, the top bar, menus, scene picker, modes with
   the current tools re-housed, workspaces, the problems popover, and a library strip without
   thumbnails. Existing e2e updated.
2. **The board shows the document.** The edit view, object models in both modes, spawn and trigger
   overlays.
3. **Inspector.** The selection model, the outliner, properties per kind, direct manipulation,
   the new session edits.
4. **Library thumbnails and creature cards.**
5. **Interaction host and docs.**
   - The conversation graph and object behaviour in Interaction.
   - `MANUAL.md` §3 rewritten around modes.
   - `DEVELOPING.md` §2–3.
   - `CRPG-GAPS.md` §8 records the shell, the three defects fixed, and that the Terrain and
     Combat tools are interim.
   - `BACKLOG.md` gains the user's program above its old ranking, and the header is re-pinned.

## 12. Out of scope for part 1

Multi-level terrain. New terrain tools, the tile library, box select, copy and paste. Factions,
allies and relations. Models for the SRD creatures. Object interaction graphs. Object rotation
(arrives with part 3's placement). Dockable or resizable panels. Multi-select. Any change to the
play HUD.

## 13. Risks

- **`main.ts` is about 2,000 lines and owns pointer handling for both modes.** Routing by editor
  mode must leave every play path untouched. The e2e suite is the net, so it runs after every
  slice.
- **Selector churn in the e2e specs** is expected. It lands with the change that causes it, never
  later.
- **Thumbnails under headless SwiftShader may be slow.** They are lazy and capped per frame, and no
  test depends on their pixels.
- **Colour literals missed in the retheme.** A grep for `#69d2ff` under `src/editor/` is part of
  done.

## 14. Done means

- No side panel. A purple top bar with the four modes in the user's order.
- Every placed thing can be selected from the board or the outliner, edited in place, moved by
  dragging, deleted, and undone.
- In any room, the editor draws what the document says: creatures, objects, spawns, triggers.
- Objects are visible in play, and doors open visibly.
- Everything the old panel could reach is reachable from the shell.
- `tsc`, `vitest` and `playwright` are green, with the docs and backlog updated as in §11.

## 15. Amendments

### 2026-09-11 — the construction layer landed ahead of parts 2 and 3

After slice 1 (commit `e484a09`), the user ran Codex overnight. It added a sparse construction
layer with no spec or plan, which was committed unchanged as `7c6afa5`, reviewed, and fixed through
`40832da` (`docs/research/construction-layer-review.md` holds the review's findings and what part 2
needs from the new format). The rulings below override the sections they name. Each is reversible
in a line or two, and the user has not yet confirmed them.

| Ruling | Overrides | What stands now |
|---|---|---|
| C1 | §5, §8 (document) | Two vertical units coexist until part 2 unifies them: `heights[]` counts levels of `levelHeight` (0.35 world units); `buildingTiles.level` and `position.z` count tiles, in quarter steps. Nothing converts between them into saved content. Part 2's spec opens with the choice of one unit. |
| C2 | §4.2 Terrain row, the approved mockup | Terrain's strip has a **Tiles** tab before Ground · Props · Objects, and **the open tab chooses the placement action** (`TERRAIN_TAB_TOOL` in `modes.ts`); the rail shows only that tab's other tools (`TERRAIN_RAIL`): Tiles → Erase tiles; Ground → Raise · Lower; Props and Objects → Erase. Terrain's default tool is Build tiles, so key 2 hands the user the build tool. Slice 1's six-tool rail is in `bbbf098` if the user wants it back. |
| C3 | §4.7 | **R** rotates the piece in hand: Build tiles, Erase tiles, and now also the **prop** tool (via `rotatablePlacement()`), so a facing can be chosen without the mouse. §4.7's R (turn a selected prop) is Inspector mode and still free. |
| C4 | §2 item 6 | A creature without a model of its own draws as the `husk` body in edit and play. `ModelRegistry.missing()` still lists it and `SceneView.modelSource(id)` returns `fallback:husk`, so the diagnostic is honest; part 4 gives them art. |
| C5 | §9, validation | A placement outside the board (signed coordinates to ±1,000,000) is authored content that takes no part in play: the validator gives one warning, never an error, and neither play path creates an entity for it. |
| C6 | §5.1 | Creatures placed in the editor enter the running game on return to play *and* on every scene entry, through a per-scene record of synced placement ids; a creature a script removed is not re-added. |

**New document fields** (`src/engine/scene/schema.ts`, `src/engine/scene/building.ts`), all optional, so
every earlier project still parses: `scene.buildingTiles` (a record keyed `x,y,level`, with `#n`
suffixes for overlapping pieces: `shape` block · floor · wall · stairs, `material` stone · wood ·
grass, `rotation` 0–3, `level` in quarter tiles, optional `height`); `position.z` and signed `x`/`y` on
decos, interactables and adversary placements.

**What this pre-empts.** §5.1's edit view is half-delivered: creatures are drawn from the document
(`SceneView.setAuthoring`); objects, spawns and trigger cells are not, and remain slice 2. §12's
"new terrain tools, the tile library" are now in, as scenery only: nothing walks on or under a piece,
and pieces block neither movement nor sight, which is part 2.

### 2026-09-11 — placement rotation and a shared elevation slider (Codex batch 2)

The user ran Codex again. It added placement-time rotation and replaced the per-mode Z fields with one
left-edge slider, with no spec or plan, committed unchanged as `b5c52bb`, then reviewed
(`.superpowers/sdd/codex-rotation/review.md`) and fixed. The rulings below override the sections they
name. Each is reversible in a line or two, and the user has not yet confirmed them.

| Ruling | Overrides | What stands now |
|---|---|---|
| C7 | §12 (placement rotation, deferred to part 3) | Alt + a mouse drag on the build plane — also Alt held + **R**, also the **Rotate** button — turns the piece to a cardinal facing (north, west, south, east), for **build tiles and props**. The world delta is read from the raycast hit, so it is camera-aware. Reversible: the gesture wiring in `main.ts` (`rotatePlacement`, `placementRotation`) and `rotatablePlacement()`. |
| C8 | nothing (extends slice 1) | Props place with the chosen `buildRotation` (× π/2) instead of always 0. Clicking a tile that already holds the same prop still turns it by `rotationStep` from its current facing. |
| C9 | §4 mockup (Z lived in the right panel) | The per-mode Z number fields ("Z · Vertical position" in Terrain, "Z · Creature height" in Combat) are replaced by one `PlacementHeightControl`, shared by terrain placement tools and creature placement. It first landed as a plain ±16 slider at the board's **left** edge; the user found that too small to aim with, so at their direction (2026-09-11) it became a **fisheye ladder docked at the board's right edge**, beside the mode panel — one rung per quarter tile, large at the level being placed at and shrinking with distance, dragged to scrub, clicked to jump, with the exact box still reaching ±1,000,000. The curve is DOM-free and tested in `src/editor/height-ladder.ts`. This is a layout change to the approved shell. Reversible: `PlacementHeightControl` in `ModeSides`. |

**C3 (prior batch), amended above.** Its R — which rotated only while Build/Erase tiles was in hand —
now also covers the **prop** tool through `rotatablePlacement()`, so §4.7's prop-R-in-Inspector still
does not collide.

**§12 is not fully contradicted.** §12 deferred *placement-time rotation* to part 3 ("Object rotation …
arrives with part 3's placement"); this batch brings it early for tiles and props only. Interactables and
"objects" are untouched, so that clause still holds for them.

### 2026-09-11 — creatures can be re-skinned from the Combat panel

The user asked to choose an enemy's model in the editor, from a panel on the right in Combat, by
selecting the enemy. Before this, a creature's model was whatever its adversary id resolved to, and
the only way to change it was to name an imported `.glb` file after the adversary — or to edit the
game's own `DEMO_MODELS` map in source.

| Ruling | Overrides | What stands now |
|---|---|---|
| C10 | §5, §8 (document) | Two new optional document fields, both defaulted so every earlier project still parses: `project.adversaryModels` (a record of adversary id → model id, the **type default**) and `model?` on an adversary placement (**one creature only**). Resolution runs placement → project map → the game's own `DEMO_MODELS` → the adversary's own id → the `husk` stand-in. The project's map beats `DEMO_MODELS` deliberately: an author who re-skins a type the demo already names would otherwise be silently ignored. `EntityState` gains an optional `model` so the per-creature override survives into play. |
| C11 | §4.2 Combat row | Combat's rail gains **Select**, placed **last** so `defaultTool('combat')` is still `adversary` and entering Combat still hands over creature placement. `modeOfTool` already allows a shared tool to stay in the mode that owns it, so Select no longer throws the user to the Inspector from Combat. The controller keeps `selectedAdversary` apart from `selected`, because the two modes select different kinds of thing and one field holding either would leave every reader asking which. Selecting a creature opens a block in Combat's right-hand panel editing its type model, its own model, its name and its hit points — the last two being placement overrides the schema always had and nothing could reach. |

**Validation.** `checkAdversaryModels` warns (never errors) when either field names a model nothing can
supply; the creature still plays in a borrowed body. Like the other model checks it runs only when the
caller passes `knownModels`, so `validate.ts` keeps its distance from the renderer — but it additionally
counts the project's own `assets` ids as resolvable, since those are written down in the document.

**A pre-existing gap this uncovered, deliberately left alone.** `KNOWN_MODELS` in `main.ts` is built once
from the procedural library only and never includes imported asset ids, so the existing **deco** and
**interactable** model checks warn about a perfectly good imported model. The new creature check does not
share that bug. Fixing the other two is a separate change and was out of this slice's scope.

### 2026-09-12 — rigged models are imported and configured in the editor

The user asked to add their own rigged, animated models and configure the animations. The runtime
already did all of it — `instantiate` clones skinned meshes with `SkeletonUtils`, gives each clone an
`AnimationMixer`, and maps `spec.clips` to four states — but the Models workspace only ever asked for
a URL and a scale, so `clips`, `groundOffset` and `rotationY` were reachable only by editing saved
JSON by hand.

| Ruling | Overrides | What stands now |
|---|---|---|
| C12 | §12 (imported models were a later part's problem) | **No document change.** `clips`, `groundOffset` and `rotationY` were already in `modelAssetSchema`, and a `data:` URL is still a URL, so embedding needed no new field — which also matters because three separate tests assert the exact defaulted asset object (`assets.test.ts`, `demo.spec.ts`) and any new field would have broken them. The work is a rewritten panel plus one `updateAsset` edit. |
| C13 | — | **+ Model is a file picker, and the file is carried inside the project** (`FileReader.readAsDataURL` into `url`), at the user's choice, so a saved document is self-contained. The row never prints the encoded bytes: it reports `embedded · N MB`. `checkEmbeddedAssets` warns past 8 MB, since embedding is a deliberate trade rather than a mistake. A referenced path still works and is shown as the path. |
| C14 | — | **Clips are chosen from the file's own animation names**, read back from the loaded template, not typed. Opening the panel starts the load, because nothing loads until something draws it and an unplaced model would otherwise have no clips to offer. `updateAsset` takes `clips: null` to drop the mapping rather than store empty names. The id and the URL are deliberately not editable: swapping the file under a name content already refers to is a different act, through remove and add. |

**One thing the e2e caught.** `AssetLibrary.onChange` only woke the `SceneView`, so when a file
finished loading the panel did not redraw and its clip dropdowns stayed empty until something else
happened to re-render. `main.ts` now re-renders the editor panel on that signal too.
