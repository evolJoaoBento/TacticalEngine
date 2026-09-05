# Legacy PolyHeart Editor & UI — Research Notes

Source of truth: `legacy/` as of 2026-09-04 (files dated 2026-06-12). Every claim below was read from the code;
`file:line` anchors point at `legacy/js/*.js`, `legacy/index.html` and `legacy/css/style.css`. Nothing in this
document was verified by running the app or taking screenshots — see the final "Unverified" section.

Purpose: give the Preact/TypeScript port (a) an exact inventory of what the legacy editor and play UI do,
(b) the data shapes and storage keys it must stay compatible with, (c) the visual tokens to preserve, and
(d) the list of UX gaps a BG3-style engine editor has to close.

No TTS / voice / narration features exist in the legacy UI and none are proposed here.

---

## 1. Runtime context the UI lives in

### 1.1 Modules and construction order (`main.js:1-18`)

```
SceneManager(canvas)            scene.js   three.js renderer/camera/OrbitControls/tweens
GridWorld(sm)                   grid.js    heightfield, tokens, nodes, decos, markers, entity registry
UI(onFlash = id => grid.flash)  ui.js      DOM: log, party HUD, dialogs, node panel, inspector
DiceManager(sm, grid, ui)       dice.js    cannon-es d12s + dice overlay DOM
Game(sm, grid, dice, ui)        game.js    exploration / combat rules + inspect/hover
Editor(sm, grid, ui)            editor.js  campaign editor (tools, scenes, save/load)
Campaign(sm, grid, dice, ui, game) campaign.js  scripted one-shot ("The Conductor's Stage")
```

No build step. `index.html:9-17` uses an import map to `three@0.160.0` and `cannon-es@0.20.0` from unpkg (the
new project pins three 0.185 in `node_modules`). Served by `legacy/start.bat` on `http://localhost:8420`.

Global debug handle: `window.PH = { sm, grid, dice, game, editor, ui, campaign }` (`main.js:176`).

### 1.2 Three modes, one canvas (`main.js:38-98`)

| Mode | Entered by | What happens |
|---|---|---|
| `play` | `#btn-play`, boot (`main.js:173`), campaign exit | `campaign.active=false; editor.exit()`; deep-clones `masterCampaign.scenes` (`JSON.parse(JSON.stringify(...))`), starts `game.start(scene[startIdx], { party, keys, flags, onGoto })`. `startIdx = min(editor.sceneIdx, scenes.length-1)` → "▶ Play tests from the current scene". Party/keys/flags carry across `onGoto` transitions. |
| `editor` | `#btn-editor` | `campaign.active=false; ui.hideInspect(); game.stop(); editor.enter(masterCampaign)`. **Play state is discarded** — there is no "return to playtest where I was". |
| `campaign` | `#btn-campaign` ("★ One-Shot") | `editor.exit(); campaign.start()`; `campaign.onExit = enterPlay`. |

`masterCampaign` (`main.js:21-33`) is the editor's source of truth; play mode always works on a clone so the
master is never mutated by play.

### 1.3 Pointer routing precedence (`main.js:129-163`)

Canvas `pointerdown/move/up` are dispatched in this strict order:

1. `dice.active` → `DiceManager.onPointer*` (fling the dice; everything else ignored).
2. `mode === 'editor'` → `Editor.onPointer*`.
3. Play: left button records `downPos` and hides the inspector; on `pointerup` a left click is only a
   "click" if moved `< 6 px` (`Math.hypot`), otherwise it was an OrbitControls drag. Right button same
   6 px rule → `game.inspectAt(ev)`. `pointermove` in play is throttled to one `game.handleHover` per **80 ms**
   (`main.js:147`); **editor hover is not throttled** (`editor.js:183`).

`contextmenu` is prevented on the canvas (`main.js:134`). Escape (`main.js:165-170`) adds `.hidden` to every
`.modal` except `#end-modal`, and hides the inspector — it does **not** resolve pending dialog promises (see §10).

### 1.4 Camera / mouse mapping per mode

| Mode | LEFT | MIDDLE | RIGHT | Source |
|---|---|---|---|---|
| play / campaign | rotate (`MOUSE.ROTATE = 0`) | dolly (1) | pan (2) — and right *click* (<6 px) inspects | `editor.js:160` restores `{LEFT:0, MIDDLE:1, RIGHT:2}` |
| editor | `-1` (no camera action; reserved for tools) | dolly | rotate | `editor.js:140` sets `{LEFT:-1, MIDDLE:1, RIGHT:0}` |

There is no pan in the editor. Right-click does nothing in the editor besides rotate (`Editor.onPointerDown`
returns on `ev.button !== 0`, `editor.js:175`). OrbitControls treats an unknown action value by setting
`state = NONE` (verified in three 0.185.1 `OrbitControls.js:1721-1723`; the legacy loads 0.160 from CDN — assumed
identical).

OrbitControls settings (`scene.js:21-27`): `maxPolarAngle = 0.46π`, `minDistance 6`, `maxDistance 34`,
damping `0.12`. `focusMap(w,h)` (`scene.js:119-123`) resets target to origin and camera to
`(0, d*0.95, d*0.9)` with `d = max(w,h)`; the editor calls it on **every** `refresh()` (`editor.js:153`) —
scene switch, resize, enter, load — so the camera never remembers where you were.

---

## 2. Layout and visual style (preserve in the port)

### 2.1 CSS tokens (`style.css:2-15`)

| Token | Hex | Used for |
|---|---|---|
| `--bg` | `#14161f` | body background |
| `--panel` | `#1c1f2b` | top bar, sidebar, modal cards, outcome inner inputs |
| `--panel2` | `#232736` | buttons, hero cards, inputs, roll-detail chips, outcome blocks |
| `--line` | `#313749` | all 1 px borders, scrollbar thumb, header underlines |
| `--text` | `#d9dce8` | body text |
| `--dim` | `#8b91a7` | labels, system log, context bar, hints |
| `--hope` | `#f6c453` | gold: brand, Hope pips, selected hero border, primary buttons, dice instruction |
| `--fear` | `#9d6bff` | violet: Fear pool, fear log lines, fear outcome headers |
| `--accent` | `#5fb0ff` | blue: active mode/tool buttons, `.ref` links, editor badge, inspector border, trait names |
| `--danger` | `#ff6b6b` | HP pips, combat badge/log, delete button, enemy inspect header |
| `--ok` | `#7ad17a` | `.log-entry.success` |

Root `font-size: 15px`; font stack `"Segoe UI", system-ui, sans-serif` (`style.css:21`). `* { box-sizing:
border-box; margin:0; padding:0 }`; `html, body, #app { height:100%; overflow:hidden }` — the app never scrolls.
Extra literal colours: mode-button dark text `#0c1018`, primary-button dark text `#1a1408`, gold border
`#5c4a1e`, choice-button hover bg `#2a2536`, spirit-note cyan `#7be8ff`.

### 2.2 Page structure (`index.html:20-123`)

```
#app (flex column, 100%)
├─ header#topbar   flex row, gap 16, padding 6px 14px, bg --panel, border-bottom --line, user-select none
│   ├─ .brand "⬡ POLYHEART"      weight 800, letter-spacing 3px, --hope, .95rem
│   ├─ .mode-buttons  #btn-play "▶ Play" · #btn-campaign.gold "★ One-Shot" · #btn-editor "✎ Editor"
│   └─ .file-buttons (margin-left:auto)  #btn-new "New" · #btn-save "Save" · #btn-load "Load" · input#file-input[type=file accept=.json hidden]
└─ #main (flex:1, flex row, min-height 0)
    ├─ #viewport (flex:1, position:relative, min-width 0)
    │   ├─ canvas#gl (100%/100%, touch-action none)
    │   ├─ #editor-toolbar.hidden      (absolute top 10 left 10 — see §3)
    │   ├─ #dice-overlay.hidden        (absolute inset 0 — see §7.6)
    │   ├─ #mode-badge "EXPLORATION"   (absolute top 10, centered pill)
    │   └─ #inspect-panel.hidden       (absolute, right-click inspector — see §7.8)
    └─ #sidebar (width 400px, flex column, bg --panel, border-left --line)
        ├─ #party-panel   (flex row, gap 6, padding 8, border-bottom)
        ├─ #status-row    (#fear-pool "☠ FEAR <span#fear-count>" · #action-tokens.hidden "⬢ TOKENS <span#token-pips>")
        ├─ #log[aria-live=polite]  (flex:1, overflow-y auto, padding 12px 14px, .9rem, line-height 1.55, smooth scroll, 8px scrollbar)
        └─ #context-bar   (padding 7px 12px, .75rem, --dim, border-top, min-height 30px)
```

Modals live outside `#main` as `div.modal.hidden` siblings: `#roll-dialog`, `#node-panel`, `#choice-dialog`,
`#end-modal`. `.hidden { display:none !important }` (`style.css:289`).

Buttons: `.mode-btn, .bar-btn` = bg `--panel2`, 1 px `--line`, radius 6, padding 4px 14px, .85rem; `.active`
= bg `--accent`, text `#0c1018`, bold; hover = border `--accent`. `.mode-btn.gold` = text `--hope`, border
`#5c4a1e`; `.gold.active` = bg `--hope`, text `#1a1408`.

Mode badge (`style.css:50-58`): centered pill, bg `rgba(20,22,31,.8)`, 1 px `--line`, padding 3px 16px, radius
20, .72rem, letter-spacing 3px, `--dim`, `pointer-events:none`; `.combat` → `--danger` text+border; `.editor`
→ `--accent`.

Modal (`style.css:168-192`): fixed inset 0, z 50, backdrop `rgba(8,9,14,.6)`, flex-centered. `.modal-card`: bg
`--panel`, 1 px `--line`, radius 12, padding 20, width **420 px** (`.wide` 640, `.story-card` 560), max-width
92vw, max-height 88vh (scrolls), shadow `0 16px 60px rgba(0,0,0,.6)`. `h3` 1rem, letter-spacing 1px.
`.modal-actions` right-aligned buttons: bg `--panel2`, radius 6, padding 7px 16px; `.primary` bg `--hope` text
`#1a1408` bold; `.danger` border+text `--danger`; hover `filter: brightness(1.15)`.

### 2.3 The 3D "look" the chrome sits on

| Thing | Value | Source |
|---|---|---|
| Scene background / fog colour | `#181b26`, `THREE.Fog` near 28 far 60 (13/34 when `map.fog` set) | `scene.js:15-16`, `grid.js:134-135` |
| Camera | Perspective fov 46, near .1, far 200, initial `(0,13,12)` | `scene.js:18-19` |
| Lights | Hemisphere `#bcc7ff` / `#2a2418` × 0.75; Directional `#fff4e0` × 1.6 at `(10,18,6)`, shadow map 2048², PCFSoft, bias −0.0005 | `scene.js:11-40` |
| Void floor | 80×80 plane `#11131c` at y −0.02, receives shadows | `scene.js:43-50` |
| Pixel ratio | `min(devicePixelRatio, 2)` | `scene.js:68` |
| Terrain | one flat-shaded vertex-coloured heightfield, 2 tris/tile with alternating diagonal, per-tile brightness jitter `0.94 + hash*0.12`, corner height jitter `(hash-0.5)*0.09`; tiles with `h >= 3` (`STRUCT_MIN`) are crisp `BoxGeometry` blocks instead | `grid.js:12-15, 81-89, 149-214` |
| Height scale | `BASE_H 0.25` + `LEVEL_H 0.35` per level; h=8 → 3.05 world units; 1 tile = 1 unit | `grid.js:12-14` |
| Perimeter skirt | `#23202b` down to y −0.05 | `grid.js:177` |
| Default tile colour | `#5d8a4a` (grass); wall tool paints `#454a59` | `data.js:155`, `editor.js:217` |
| Difficult-terrain decal | 5-sided circle r .32, `#2c3b33`, α .55 | `grid.js:222-230` |
| Cover decal | icosahedron r .26 `#6e7480`, offset (+.22, −.18) | `grid.js:231-237` |
| Editor trigger marker | .9×.9 plane `#ff8c42` α .3 at top+0.04 | `grid.js:568-578` |
| Editor spawn marker | ring r .22–.36 `#5fb0ff` α .6 at top+0.045 | `grid.js:580-589` |
| Reachable highlight | discs r .34 α .2; `#f6c453` explore, `#5fb0ff` combat | `grid.js:593-604`, `game.js:168` |
| Flash colour | emissive `(0.4k, 0.65k, k)` — accent-blue pulse | `grid.js:314` |
| Dice | Hope d12 `#f6c453` numbers `#3a2c08`; Fear d12 `#6f42c8` numbers `#efe6ff`; numbers `bold 52px Georgia` on canvas sprites | `dice.js:83, 218-219` |

### 2.4 Glyphs used as icons (port caveat)

The UI relies entirely on Unicode/emoji glyphs rendered by the system font: `⬡ ▶ ★ ✎ ＋ 🗑 ⤢ 📜 ▲ ▼ ▮ 🎨 ≋ ▣
✕ ⌧ ⎕ ◫ ⊙ ☠ ⚠ ⌂ ⛺ ♥ · ◆ ◇ ● ○ ⬢ ✦ 🗝 🎲 ◈ ▦ 🏞 ⚔ 🤝 ↩ 💀`. Emoji (🎨 🗑 📜 ⛺ 🎲 🗝 🏞) render as colour
emoji on Windows/Segoe UI Emoji and differ per platform; monochrome symbols (`⊙ ◫ ⌧ ⎕`) depend on font
fallback. The port should either ship an icon set or keep the same glyphs with an explicit fallback stack.

---

## 3. Editor toolbar and tools

### 3.1 Toolbar chrome (`index.html:44-99`, `style.css:128-145, 252-261`)

`#editor-toolbar`: absolute `top 10px; left 10px`, flex column gap 6, bg `rgba(20,22,31,.92)`, 1 px `--line`,
radius 10, padding 10, **max-width 240 px**. Groups are `.tool-group` (flex wrap, gap 4) each starting with a
full-width `.tool-label` (.62rem, letter-spacing 2px, `--dim`). `.tool-btn`: bg `--panel2`, 1 px `--line`,
radius 5, padding 3px 8px, .75rem; `.active` = accent bg, `#0c1018` text, bold. Selects (`#scene-select` max
130 px, `#enemy-type-select`/`#deco-type-select` max 110 px, `#group-select`) share the same styling at .75rem.
`#paint-color` is a bare `<input type=color>` 28×24.

Shown by `editor.enter()` (`classList.remove('hidden')`, `editor.js:137`), hidden by `exit()`. It overlays the
viewport (no docking) so on a small window it covers the west edge of the map.

### 3.2 Non-tool controls

| Control | Element | Behaviour | Source |
|---|---|---|---|
| Scene picker | `select#scene-select` | options `"${i+1}. ${name}"`, value = index; `change` → `switchScene(idx)`: persists, swaps `this.map`, `refresh()`, logs "Editing scene **name** (w×h)." | `editor.js:34-58` |
| Add scene | `#scene-add` "＋" | three native `prompt()`s: width (8–48, default 24), height (8–48, default 18), name (default `Scene N`); `blankMap(w,h)`, id `scene-` + 6 base-36 chars; pushes, switches to it | `editor.js:60-70` |
| Rename | `#scene-rename` "✎" | `prompt('Scene name:', current)`; empty/cancel = no change | `editor.js:72-75` |
| Delete | `#scene-del` "🗑" | refuses if only one scene; `confirm()` warns "Portals pointing at it will go dead."; selects previous index | `editor.js:77-86` |
| Resize | `#map-resize` "⤢ Size" | two `prompt()`s, clamp 8–48, `resizeMap()` crops/grows in place (out-of-bounds nodes/enemies/decos/trigger cells/spawns dropped; spawns fall back to `[[1,1]]`) | `editor.js:88-96`, `data.js:116-133` |
| Intro text | `#map-intro` "📜 Intro" | single-line `prompt()` for `map.intro` (multi-line intro impossible) | `editor.js:98-101` |
| New campaign | `#btn-new` (top bar) | `confirm()` then `prompt('Campaign name:')`; one blank 24×18 scene named "Scene 1"; **not persisted until the next edit** | `main.js:105-113` |
| Save | `#btn-save` | `editor.download()` — see §6.4 | `main.js:101-104` |
| Load | `#btn-load` → `#file-input` | `editor.loadJson(text)` — see §6.5 | `main.js:114-127` |

All scene/map operations use browser-native `prompt`/`confirm` — no in-app forms.

### 3.3 Tool table (`index.html:57-98`, `editor.js:103-127, 200-310`)

Tool state: `this.tool` (default `'raise'`, `editor.js:12`), buttons `.tool-btn[data-tool]` toggled `.active`.
`setTool()` writes a hint into the context bar as `"EDITOR — " + hint`.

Drag tools (`editor.js:204`): `raise lower wall paint difficult cover clearprop trigger`. A drag tool applies
once per distinct cell while the left button is held (`lastCell` dedupe). Every other tool is a **click tool**:
fires once per press (`if (!dragTool && this.lastCell !== null) return`, `editor.js:206`).

| Group | `data-tool` | Label | Kind | Mutation (tile `t`, cell `c`, `group = #group-select`) | Visual rebuild | Hint text |
|---|---|---|---|---|---|---|
| TERRAIN | `raise` | ▲ Raise | drag | `t.h = min(t.h+1, 8)` | `grid.buildTile()` → **full `rebuildGround()`** | Drag across tiles to raise terrain. |
| | `lower` | ▼ Lower | drag | `t.h = max(t.h−1, 0)` | same | Drag across tiles to lower terrain. |
| | `wall` | ▮ Wall | drag | toggle: `t.h >= 4 ? t.h = 0 : (t.h = 4, t.color = '#454a59')` — lowering does not restore the old colour | same | Drag to paint solid walls (blocks movement; impassable height). |
| | `paint` | 🎨 Paint | drag | `t.color = #paint-color.value` | same | Drag to paint tile color. |
| PROPS | `difficult` | ≋ Difficult | drag | `t.prop = 'difficult'` | same | Drag to mark difficult terrain (movement ×2). |
| | `cover` | ▣ Cover | drag | `t.prop = 'cover'` | same | Drag to place cover (+2 Evasion for occupant). |
| | `clearprop` | ✕ Clear | drag | `t.prop = null` | same | Drag to clear tile properties. |
| NODES | `chest` | ⌧ Chest | click | if no node on cell: `makeNode('chest', x, y)` pushed to `map.nodes` | `grid.buildNode(n)` | Click a tile to place a chest, then Inspect to script it. |
| | `door` | ⎕ Door | click | as above, type `door` | same | Click a tile to place a door (blocks movement until opened). |
| | `pillar` | ◫ Pillar | click | as above, type `pillar` | same | Click a tile to place a crumbling pillar (blocks movement). |
| | `portal` | ⊙ Portal | click | as above, type `portal`, `model:'gate'`, **`goto` defaults to the next scene's id** (or `null`) | same | Click to place a portal, then Inspect it to choose the target scene. |
| ENCOUNTER | `enemy` | ☠ Enemy | click | if no enemy on cell: `makeEnemy(x, y, group, #enemy-type-select.value)` | `grid.buildEnemyToken(e)` | Click to place the selected enemy type in the selected encounter group. |
| | `trigger` | ⚠ Trigger | drag | find-or-create the **single** trigger for `group` (`{id:'trig-…', group, once:true, cells:[]}`), add `[x,y]` if absent | `grid.rebuildMarkers(true)` (all markers) | Drag to paint a combat trigger zone for the selected group. |
| | `spawn` | ⌂ Spawn | click | push `[x,y]` to `map.spawns` if absent | `rebuildMarkers(true)` | Click to add party spawn points (first 3 used). |
| | `erase` | 🗑 Erase | click | see erase order below | varies | Click to remove nodes, enemies, triggers, or spawns. |
| DECOR | `deco` | ⛺ Deco | click | if a deco exists on the cell: `rot = (rot + π/2) % 2π` (rotate in place); else push `{type:#deco-type-select.value, x, y, rot:0}` | `grid.rebuildDecos()` (all decos) | Click to place scenery. Click again on the same tile to rotate it. |
| SELECT | `inspect` | ✎ Inspect | click | if a node is on the cell → `openNodeScript(n)` (§5); enemies/decos/triggers have **no** inspector | — | Click a node to open its script: flavor text, trait, DC, and the four Daggerheart outcomes. |

Palette selects: `#enemy-type-select` is generated from `ENEMY_TYPES` (`husk` "Hollow Husk", `bramble` "Tangle
Bramble", `shadowHag` "Shadow Hag"; `editor.js:22-24`); `#deco-type-select` from `DECO_TYPES` (`models.js:480-484`,
20 names shown as raw identifiers: `tent campfire piano trunk floorboard throne spectator hut barrier gate pine
deadTree rock barrel crate banner brazier cart dummy curtain`); `#group-select` is hard-coded "Grp 1"–"Grp 4".

Erase priority (`editor.js:285-310`), first match wins, one thing per click: **node → enemy → deco → (all
trigger cells on that tile, then spawns)**. Node erase calls `grid.rebuildNodes()` (rebuilds every node);
enemy erase `grid.removeToken(id)`; deco erase `rebuildDecos()`; triggers that lose their last cell are
deleted; then `rebuildMarkers(true)`.

Terrain semantics worth knowing for the port: movement blocks when `|Δh| > 1` between adjacent tiles
(`grid.js:622`), so a `wall` (h 4) is impassable from h ≤ 2, but a `raise`d h 3 tile next to h 2 is climbable;
tiles at `h >= 3` silently switch from heightfield to crisp box rendering (`STRUCT_MIN`, `grid.js:15`).
Raise cap is 8 (`editor.js:213`).

### 3.4 Editor pointer and hover (`editor.js:173-198`)

- `onPointerDown` (button 0 only): `painting = true; lastCell = null; applyAt(ev)`.
- `onPointerMove`: paints if `painting`, else `hoverInfo(ev)` → context bar
  `EDITOR — tile x,y · h=N[ · prop] · tool: T`. Unthrottled raycast against the terrain mesh plus every
  structure box (`grid.pickCell`, `grid.js:242-250`).
- `onPointerUp`: `painting = false; persist()` (full `JSON.stringify(campaign)` to localStorage after each stroke).
- No pointer capture: releasing the button outside the canvas leaves `painting === true` until the next
  `pointerup` on the canvas (traced, not executed).
- No hovered-tile highlight, no cursor change, no grid overlay, no coordinates readout other than the text bar.

### 3.5 Editor entry messaging (`editor.js:130-147`)

`enter()` sets badge `CAMPAIGN EDITOR` (class `editor`), clears the log, writes header `CAMPAIGN CREATOR` and one
long system line explaining Wall/Portal/Inspect/right-drag/Play. `refresh()` = `grid.build(map)`,
`rebuildMarkers(true)`, `rebuildEnemies()` (only `hp > 0`), `focusMap`.

---

## 4. Scenes / campaign model as the editor sees it

`Editor.campaign` is the whole document; `Editor.sceneIdx` + `Editor.map` point at the scene being edited
(`editor.js:129-135`). `get scenes()` returns `campaign.scenes` (`editor.js:43`). There is no "campaign
settings" UI beyond the New-campaign name prompt; `campaign.start` is written as `0` by `makeCampaign()`
(`data.js:138`) and **never read** (play starts from `editor.sceneIdx`, `main.js:58`).

Portals are the only inter-scene link: node `goto` = target scene id; play resolves it in `onGoto`
(`main.js:64-73`) and logs "The portal sputters — its destination no longer exists" for dangling ids. No editor
validation of links exists.

---

## 5. Node scripting panel (`#node-panel`, `index.html:139-197`, `ui.js:187-241`)

Opened by the Inspect tool (`editor.js:312-322`) with `{ scenes: [{id,name}], onApply, onDelete }`.
`.modal-card.wide` (640 px). Title: `Node Script — <span#np-type>` = `node.type.toUpperCase()`.

| Field | Element | Input | Loaded from | Written on Apply (`ui.js:224-238`) |
|---|---|---|---|---|
| Name | `#np-name` | text | `node.name` | verbatim |
| Trait | `#np-trait` | select, 6 options hard-coded in HTML (`Agility Strength Finesse Instinct Presence Knowledge`) — duplicates `TRAITS` in `data.js:4` | `node.trait` | verbatim |
| Difficulty (DC) | `#np-dc` | number `min 5 max 25 value 12` (browser hint only) | `node.dc` | `parseInt(v) \|\| 12` — no clamp, `0`/NaN → 12 |
| Requires key 🗝 | `#np-reqkey` | text, placeholder "(none)" | `node.requireKey \|\| ''` | `.trim()` |
| Travel to scene (portal) | `#np-goto` | select: `""` "(none — this is a check)" + one option per scene (value = scene id, label = name) | `node.goto \|\| ''` | `value \|\| null` |
| Locked text | `#np-locked` | textarea rows 1 | `node.lockedText \|\| ''` | verbatim |
| Flavor text | `#np-flavor` | textarea rows 2 | `node.flavor` | verbatim |
| Note | `.np-note` | static: "Travel nodes skip the roll. For checks, each outcome below can also trigger a mechanical effect — give a key, set a flag, start a combat group, or jump to a scene." | | |
| 4 outcomes | `.np-outcomes` 2-col grid of `.np-outcome.hope/.fear` | per key `hopeSuccess` (✦ Success with Hope), `fearSuccess` (☠ Success with Fear), `hopeFail` (✦ Failure with Hope), `fearFail` (☠ Failure with Fear): `textarea[data-out]` rows 2, `select[data-eff]` built from `EFFECTS`, `input[data-parm]` text | `outcomes[key].text/.effect/.param` | text verbatim, effect value, `param.trim()` |
| Buttons | `#np-ok.primary` "Apply", `#np-delete.danger` "Delete Node", `#np-cancel` "Close" | | | Apply → close + `onApply(node)` (persist + log "Node **name** updated."); Delete → close + `onDelete(node)` (no confirm); Close → discard |

Param visibility: `syncParm()` (`ui.js:213-219`) shows `input[data-parm]` only when
`EFFECTS[effect].needsParam`, placeholder `param: ${hint}`. Handlers are assigned with `onclick =` /
`onchange =` so reopening does not stack listeners.

`EFFECTS` (`data.js:6-16`) — drives the dropdown dynamically (pattern worth keeping):

| key | label | needsParam / hint | runtime (`game.js:415-468`) |
|---|---|---|---|
| `none` | No effect | — | nothing |
| `open` | Open / unlock node | — | `node.open = used = true`, lid/panel animation, door stops blocking |
| `loot` | Loot (+1 Hope, item found) | — | open anim, hero `+1 Hope` (cap 6), random item from `ITEMS` |
| `damage` | Trap (2 damage to roller) | — | `damageHero(hero, 2, node.name)` |
| `removeNode` | Destroy node | — | destroy anim, node removed from `map.nodes` |
| `giveKey` | Give key… | `key name` | `keys.add(param)` (party-wide `Set`), log "The party obtains 🗝 key" |
| `setFlag` | Set story flag… | `flag name` | `flags.add(param)`; **nothing in the legacy game ever reads `flags`** (grep: only `add`) |
| `spawnGroup` | Start combat: group… | `group #` | `parseInt(param) \|\| 1`; enters combat if that group has living enemies |
| `goto` | Travel to scene… | `scene id` | `opts.onGoto(param)` — **free-text scene id**, unlike the node-level `#np-goto` dropdown |

Runtime resolution (`game.js:401-403`): `crit` maps to the `hopeSuccess` outcome; the outcome text is logged
with class `narration` for Hope/crit and `fear` otherwise. Nodes with `requireKey` refuse everything (travel and
checks) until the key is held (`game.js:361-366`), showing `lockedText` or "It will not yield. You need: K."
Travel nodes (`goto` set) skip the roll and ask an `askChoice` "Travel onward / Stay" (`game.js:369-384`). A node
is single-use once `used` is set by an effect (`game.js:386`).

What the panel cannot edit: node `type`, `model`, position, `open` initial state, enemy anything, trigger
`once`/group/cells, deco rotation beyond 90° clicks, scene-level fields other than name/intro/size.

---

## 6. Data formats and persistence

### 6.1 Campaign document (`data.js:136-139`)

```jsonc
{ "campaign": true, "name": "My Campaign", "scenes": [ /* Map */ ], "start": 0 }
```
`start` is never read. Scene ids are assigned lazily (`m.id ??= 'scene-' + rand6`).

### 6.2 Map / scene (`data.js:151-161`)

```jsonc
{
  "id": "scene-k3j9x2",            // added by makeCampaign/addScene/loadJson
  "name": "Untitled Map",
  "w": 16, "h": 12,                // editor clamps 8..48
  "tiles": [ { "h": 0, "color": "#5d8a4a", "prop": null } /* w*h, row-major: index = y*w + x */ ],
  "nodes": [], "enemies": [], "triggers": [], "decos": [],
  "spawns": [[1,1],[2,1],[1,2]],   // [x,y] pairs; play uses spawns[i % spawns.length] per hero (game.js:58)
  "intro": "A new place, waiting for a story.",
  "fog": { "band": 2 }             // optional; only set by campaign maps (data-campaign.js:231), not editable
}
```
Tile: `h` integer 0–8, `color` CSS hex string, `prop` `null | 'difficult' | 'cover'`.

### 6.3 Entities

```jsonc
// Node (data.js:89-113)
{ "id": "node-a1b2c3", "type": "chest|door|pillar|portal", "x": 3, "y": 4,
  "name": "Old Wooden Chest", "flavor": "…", "trait": "Finesse", "dc": 12,
  "outcomes": { "hopeSuccess": { "text": "…", "effect": "loot", "param": "" }, "fearSuccess": {…}, "hopeFail": {…}, "fearFail": {…} },
  "open": false, "requireKey": "", "lockedText": "", "goto": null,   // goto: scene id string for portals
  "model": "gate" }                                                    // only when type === 'portal'
// runtime-only, never in editor JSON: used, found, lit, inserted, pillar, crank, heroKey, hagNode (campaign scripting)

// Enemy (data.js:141-149) — the whole ENEMY_TYPES template is spread into every placed enemy
{ "id": "enemy-x9y8z7", "type": "husk", "name": "Hollow Husk", "model": "husk",
  "maxHp": 5, "difficulty": 13, "atkMod": 2, "dmg": 2, "speed": 3, "range": 1, "special": "entangle"?,
  "hp": 5, "x": 16, "y": 8, "group": 1 }   // runtime: frozen

// Trigger (editor.js:260)
{ "id": "trig-q1w2e3", "group": 1, "once": true, "cells": [[13,6],[13,7]] }   // `once` never read; runtime `fired`

// Deco (editor.js:252)
{ "type": "pine", "x": 2, "y": 2, "rot": 1.5707963 }   // radians; editor steps by π/2, demo uses arbitrary values
// Decos placed by the editor have NO id, so they cannot be flashed from the log (grid.js:455 registers only if d.id)
```

Default names/flavour/traits per node type (`data.js:90-97`): chest "Old Wooden Chest"/Finesse, door
"Iron-Banded Door"/Finesse, pillar "Crumbling Pillar"/Strength, portal "Stone Gate"/Instinct (trait unused for
travel). Default outcome texts+effects per type: `data.js:59-87`.

Stat blocks are **copied into the map JSON** per enemy; changing `ENEMY_TYPES` later does not update saved maps.

### 6.4 localStorage keys

| Key | Written by | Read by | Notes |
|---|---|---|---|
| `polyheart-campaign` | `Editor.persist()` (`editor.js:169-171`), wrapped in `try/catch` (quota errors are swallowed silently) | `main.js:23` at boot: accepted only if `c.campaign && c.scenes?.length` | Single slot, no versioning, no timestamp. |
| `polyheart-map` | never written by this codebase (older prototype format; could not verify its writer) | `main.js:29-30`: migration — wrapped via `makeCampaign([JSON.parse(legacy)], 'My Campaign')` | Only consulted when `polyheart-campaign` is absent/invalid; never deleted. |

`persist()` call sites (`editor.js`): `switchScene` (53), `renameScene` (74), `deleteScene` (85),
`resizeCurrent` (94), `editIntro` (100), `exit` (161), `onPointerUp` after a stroke (186), node panel `onApply`
(315) and `onDelete` (319). Not called by: New campaign, Load file (persisted only on the next edit or when
leaving the editor), `addScene` directly (it goes through `switchScene`, which persists the already-pushed scene).
Boot fallback (`main.js:32`): `makeCampaign([demoMap()], 'My Campaign')` — "The Husk Vault" 22×16.

### 6.5 File save (`editor.js:325-332`)

`Blob` of `JSON.stringify(campaign, null, 2)` (`application/json`), anchor download named
`(campaign.name || 'campaign').replace(/\W+/g, '-').toLowerCase() + '.json'`. `#btn-save` first re-points
`editor.campaign = masterCampaign` (`main.js:102`). Top-bar tooltips still say "map JSON".

### 6.6 File load (`editor.js:334-354`, `main.js:114-127`)

Accepts either a campaign document (`doc.campaign && Array.isArray(doc.scenes)`) or a bare legacy map (wrapped
as `makeCampaign([doc], doc.name || 'Imported Map')`). Validation is **only** the presence of `tiles`, `w`, `h`
per scene; `nodes/enemies/triggers/decos` default to `[]`, `spawns` to `[[1,1]]`, missing `id` generated.
Not checked: `tiles.length === w*h`, tile field types, node/enemy shapes, portal targets, colour strings, size
bounds. Failure logs `Load failed: <message>` with class `fear`. After load: `sceneIdx = 0`; play mode restarts,
editor mode re-enters.

---

## 7. Play-mode UI surfaces (all in `ui.js` unless noted)

### 7.1 Log (`ui.js:29-41`, `style.css:89-120`)

`log(html, cls = 'narration')` appends `div.log-entry.<cls>` with **`innerHTML`** (callers must `esc()` user
text; `game.js` mostly does, `editor.js`/`main.js` do not — see §10), autoscrolls to bottom, trims to the
last **250** entries. `logHeader(text)` = `log('<h5>…</h5>', 'system')`. `clearLog()` empties it.

Classes and colours: `narration` `--text`; `system` `--dim`, .8rem, italic; `hope` `--hope`; `fear` `--fear`;
`combat` `--danger`; `success` `--ok`. Entries animate `fadeIn .35s` (opacity 0 → 1, translateY 6 px → 0).
`h5` headers: .7rem, letter-spacing 2px, `--dim`, bottom border `--line`. `.roll-detail` chip: inline-block, bg
`--panel2`, radius 6, padding 1px 8px, .8rem, 1 px border; `.d-hope`/`.d-fear` bold coloured dice values.
`rollDetail(r)` renders `Hope <n> + Fear <n> ± mod = <b>total</b> vs DC <dc>` (`ui.js:43-48`).

### 7.2 Context bar (`ui.js:52`)

`setContext(text)` sets `textContent` of `#context-bar`. Written by: hero selection, hover (§7.9), out-of-reach /
out-of-range notices, combat/phase prompts, campaign prompts, editor tool hints and tile hover.

### 7.3 Mode badge (`ui.js:54-57`)

`setBadge(text, cls)` — `className` is replaced wholesale. Used values: `EXPLORATION` (`''`), `⚔ COMBAT`
(`combat`), `CAMPAIGN EDITOR` (`editor`), `SPIRITS ADRIFT` (`''`, campaign phase 1).

### 7.4 Party HUD (`ui.js:60-87`, `style.css:67-80, 237-250`)

`renderParty(heroes, selectedId, onSelect, onBlessing)` rebuilds `#party-panel.innerHTML` from scratch on
every `refreshHud()`. Per hero `div.hero-card[.selected][.dead]` (flex:1, bg `--panel2`, 2 px border `--line`,
radius 8, padding 6px 8px; `.selected` border `--hope`; `.dead` opacity .35 + grayscale):

```
<div class="hname"><span class="hero-chip" style="background:{h.color}"></span>{name}</div>   (bold .85rem; chip 10px circle)
<div class="hstats"><span class="hp-pips">♥♥♥♥··</span><br><span class="hope-pips">◆◆◇◇◇◇</span><br>{class} · Ev {evasion}</div>
[<button class="blessing-btn[.used]" title="{desc}" disabled?>✦ {blessing.name} | ✦ spent</button>]
```
HP pips: `'♥'.repeat(max(hp,0)) + '·'.repeat(max(maxHp-hp,0))` in `--danger`; Hope pips:
`'◆'.repeat(hope) + '◇'.repeat(max(6-hope,0))` in `--hope` (Hope hard-capped at 6 everywhere). `.hstats` .72rem
`--dim`, line-height 1.5. Card click → `onSelect(id)`; blessing click stops propagation → `onBlessing(id)`.
Empty party → `div.spirit-note` "You are formless — spirits adrift. Find vessels." (`#7be8ff`, italic).

### 7.5 Status row (`ui.js:119-124`)

`renderFear(n)` → `#fear-count` text. `renderTokens(n, max, show)` → toggles `#action-tokens.hidden` (shown only
in combat) and sets `#token-pips` to `'●'.repeat(n) + '○'.repeat(max(max-n,0))`. `#fear-pool` `--fear` bold
letter-spacing 1px; `#action-tokens` `--accent`, pushed right.

### 7.6 Roll dialog `askRoll` (`ui.js:127-151`, `index.html:126-137`)

Signature `askRoll({ title, flavor, trait, mod, dc, canSpendHope }) → Promise<{go:true, spendHope:boolean} |
{go:false}>`. Fills `#roll-title`, `#roll-flavor.flavor` (italic `--dim`), `#roll-meta` =
`<b class="trait">{trait}</b> check · modifier {+mod} · Difficulty <b>{dc}</b>`; `#hope-spend-row` (label,
`--hope`, "Spend 1 Hope for **+2**", checkbox `#hope-spend` reset to unchecked) shown only if `canSpendHope`.
Buttons `#roll-go.primary` "🎲 Roll the Duality Dice", `#roll-cancel` "Cancel". Listeners are added with
`addEventListener` and removed only inside `done()`.

Flow after `go` (`game.js:287-344`): spend Hope (−1, +2 mod), `busy = true`, `dice.roll()` (physics fling),
result label + `dice.showResult()` overlay + log line + Hope/Fear bookkeeping, then a fixed **1100 ms** pause
before the world reacts.

### 7.7 Dice overlay (`dice.js:114-116, 208-232, 330-354`, `style.css:147-165`)

`#dice-overlay`: absolute inset 0, `pointer-events:none`, radial vignette `transparent 55% → rgba(10,11,18,.55)`.
`#dice-instruction` "CLICK & DRAG — FLING THE DICE": margin-top 48, .85rem, letter-spacing 4px, `--hope`,
text-shadow, `pulse 1.4s` opacity to .45. `#dice-result`: 1.6rem, weight 800, `popIn .3s` (scale .6 → 1),
`.hope`/`.fear` colour, `.sub` line .85rem normal `--text`. `showResult(html, cls)` sets `className = cls`
(which also drops `hidden`). While rolling: OrbitControls disabled, dice held at `(0, 4.5, 4)` on a y=3.2 pick
plane, fling velocity from the last 8 pointer samples capped at 16 u/s, settle after 0.45 s still or 7 s max,
overlay hidden 1400 ms after settling with a 0.4 s shrink tween.

### 7.8 Choice / story dialog (`ui.js:89-117`, `index.html:199-206`)

`askChoice({ title, html, options: [{label, detail?, value}] }) → Promise<value>`. `#choice-dialog` →
`.modal-card.story-card` (560 px): `.choice-title` h3, `.choice-body` (innerHTML, max-height 46vh scroll),
`.choice-options` column (gap 8) of `button.choice-btn` = `<b>{label}</b>[<span>{detail}</span>]` (left-aligned,
radius 8, padding 10px 14px, .9rem; detail .75rem `--dim`; hover border `--hope` bg `#2a2536`). Buttons use
`onclick =` and the option list is rebuilt each call. `story({ title, paragraphs, button = 'Continue' })` wraps
each paragraph in `p.story-p` (italic, .92rem, line-height 1.6, 2 px left border `--line`, padding-left 12) and
offers a single option resolving `true`.

### 7.9 Right-click inspector `showInspect` (`ui.js:153-171`, `game.js:752-830`, `style.css:268-287`)

`#inspect-panel`: absolute inside `#viewport`, z 30, width 280 px (max 60vw), bg `rgba(20,22,31,.96)`, 1 px
`--accent` border, radius 10, padding 12px 14px, .8rem, line-height 1.45, shadow `0 10px 36px rgba(0,0,0,.65)`,
**`pointer-events:none`** (cannot be interacted with; closes on any left click). Position: pointer relative to
the viewport `+ (14, 10)`; measured after reset to `(0,0)`; if it would overflow right (`x + pw > vp.width − 8`)
it flips to the left of the cursor (`max(8, cx − pw − 14)`); if it overflows bottom it is pinned to
`max(8, vp.height − ph − 8)`. Always appends `div.ins-hint` "right-click elsewhere or press Esc to close".

Content markup: `h4` (.9rem; `.ins-enemy` red; hero header inline-styled with the hero colour), `p` (italic
`--dim`), `.ins-row` (flex space-between, dotted bottom border; `<span>label</span><b>value</b>`), `.ins-traits`
(accent, .72rem). Pick order: tokens → nodes → decos (raycast), else the terrain tile under the cursor.

| Target | Rows shown |
|---|---|
| Hero | `⚔ Name — Class`; HP `a / max`; Hope `n / 6`; Evasion (+2 Shield Wall); Speed (slowed n); Weapon `name — trait, dmg, range`; traits line `AGI +0 · STR +2 …`; ✦ Blessing (+desc) if any; Spirit eyes |
| Enemy | `☠ Name`; HP; Difficulty `n (to hit it)`; Attack `+mod, dmg, range`; Speed; special text (entangle / nightmare); frozen status; Status `HOSTILE` / `Dormant — not yet hostile` / `Destroyed` |
| Node | `◈ Name`; flavor; Travel row if `goto`; Locked `Requires 🗝 key (held)`; Check `Trait vs DC n` (non-travel); state rows: door Open/Locked, chest Emptied/Sealed, pillar "Blocks movement — can be toppled", campaign pillar/crank states |
| Deco | `🏞 {DECO_INFO.name}`; desc; Type "Scenery — walkable, no effect on play" |
| Tile | `▦ Tile x, y`; Elevation `h (high ground: +1 to attacks against lower targets)`; prop sentence or Terrain "Open ground" |

Hidden by: left `pointerdown` on the canvas (`main.js:139`), Escape, `enterEditor`, right-click on empty space,
or when the game is not running. Inspect is **play-mode only**; the editor has no equivalent.

### 7.10 Hover → context bar (`game.js:832-861`)

80 ms throttle. Enemy: `Name — HP a/max · Difficulty n · hits for d`. Node: `Name — Trait DC n[ (spent)]` or
just the name. Hero: `Name the Class — HP a/max, Hope n`. Otherwise tile: `Tile x,y · elevation h[ · DIFFICULT
TERRAIN (move ×2)][ · COVER (+2 Evasion)]`. Nothing on the 3D side is highlighted on hover.

### 7.11 End modal (`ui.js:174-185`, `index.html:209-215`)

`showEnd(win, text, onRestart)`: `#end-title.win` "✦ VICTORY ✦" (`--hope`, 1.5rem) or `.lose` "☠ THE PARTY
FALLS ☠" (`--danger`); `#end-text`; `#end-restart.primary` "Restart Map". Excluded from Escape.

---

## 8. Text ↔ grid hover reference system

Pipeline (one direction only: **text → 3D**):

1. Authors emit `ref(id, text)` (`ui.js:10`) → `<span class="ref" data-ref="{id}">{text}</span>` (both escaped).
   Used by `game.js` (intro node list `game.js:107`, combat intro, attack/miss lines, node messages) and
   `campaign.js` (archfey, hag, cranks, pillars, portal).
2. `#log` has one delegated `mouseover` listener (`ui.js:23-26`): `ev.target.closest('.ref')` → `onFlash(dataset.ref)`.
3. `onFlash = id => grid.flash(id)` (`main.js:14`). `flash()` (`grid.js:309-318`) looks the id up in
   `GridWorld.registry` (`Map<id, {mesh, mats}>`) and runs a **0.9 s** tween setting every emissive-capable
   material to `(0.4k, 0.65k, k)` with `k = |sin(3πp)|·0.9` (three pulses), then restores each material's base
   emissive hex.
4. Registry population via `register(id, group)` (`grid.js:301-307`): `buildHeroToken` (hero id),
   `buildEnemyToken` (enemy id), `buildNode` (node id), `buildDeco` **only if `d.id`** — editor decos have none.
   Cleared by `build()`; `rebuildNodes()` deletes/re-adds node ids; `removeToken()` / `animateNodeDestroy()` delete.

CSS: `.ref` `--accent`, 1 px dotted underline, `cursor:help`; hover bg `rgba(95,176,255,.15)`.

Properties of the legacy implementation the port should be aware of:
- No throttle or de-dup: re-entering a span starts another overlapping tween; whichever finishes last restores
  the base colour (traced, not executed).
- Unknown ids are silently ignored (`registry.get` miss). `campaign.js:153` emits a bare `<span class="ref">`
  with no `data-ref` (styled, inert).
- There is no reverse link (hover 3D → highlight text), no click-to-focus/camera, no persistent highlight, and
  no way to reference tiles, triggers or decos placed in the editor.
- The README sells this as a headline feature ("Blue underlined words … hover them and the matching 3D object
  flashes"); preserve the affordance (colour, dotted underline, help cursor, pulse) exactly.

---

## 9. Per-mode summary of what the sidebar shows

| Mode | Party panel | Status row | Log | Context bar | Badge |
|---|---|---|---|---|---|
| play (explore) | hero cards | Fear; tokens hidden | scene header + intro (`introHtml` weaves node refs) | selection/hover hints | EXPLORATION |
| play (combat) | hero cards | Fear + ⬢ TOKENS pips | COMBAT BEGINS / ENEMY PHASE / PARTY PHASE headers | "COMBAT — move (1 token), attack (1 token)…" | ⚔ COMBAT (red) |
| editor | stale from last play (never cleared by `enter()`) | stale | CAMPAIGN CREATOR help text + tool/placement logs | `EDITOR — {hint}` / tile hover | CAMPAIGN EDITOR (blue) |
| campaign | may be empty (`spirit-note`) | Fear | phase headers, story text mirrored after dialogs | scripted prompts | SPIRITS ADRIFT → EXPLORATION/⚔ COMBAT |

---

## 10. UX shortcomings a BG3-style engine editor must fix

Grouped; each item names the legacy behaviour it replaces. No voice/narration items by design.

### 10.1 Editing model
1. **No undo/redo** at all; every stroke is committed to the data and to localStorage on `pointerup`.
2. **No selection concept.** There is no "selected object"; the only property editor is a modal reached by
   choosing the Inspect *tool* and clicking a node. Enemies, decos, triggers, spawns and tiles have no property
   editor whatsoever (enemy group/type cannot be changed after placement; trigger `once` is not exposed; deco
   rotation is 90° steps by re-clicking).
3. **No multi-select, box select, fill, line/rect tools, brush size or falloff.** Terrain edits are ±1 level per
   cell per drag pass; walls are a fixed h 4 toggle that also overwrites the tile colour.
4. **No copy/paste, no prefabs/stamps, no move** (to relocate a node you erase it and lose its script).
5. **No keyboard shortcuts** (only Escape); no hotkeys for tools, undo, save, play.
6. **Modal-only property editing**; the node panel blocks the viewport, so you cannot look at the map while
   scripting. Scene add/rename/delete/resize/intro and New-campaign use native `prompt/confirm` (single-line,
   unstyled, no validation UI, intro cannot contain newlines).
7. **No outliner / hierarchy** of scenes → nodes/enemies/triggers/decos; the scene picker is a `<select>`.
8. **Asset palette is a raw `<select>` of internal ids** (`deadTree`, `shadowHag`) with no thumbnails, search, or
   categories; adding an asset means editing `models.js`.
9. **Toolbar is a fixed 240 px overlay** with wrapping groups; it occludes the map and cannot dock/collapse.
10. **Camera resets on every scene switch/resize/enter** (`focusMap`), no bookmarks, no pan in the editor.
11. **No editor-side inspect/hover highlight**: no hovered-cell outline, no grid overlay, no coordinates HUD, no
    ghost preview of the object about to be placed, no cursor change per tool.
12. **Playtest loses state**: entering the editor calls `game.stop()`; Play always restarts the current scene from
    the master. No "play from here", no pause/resume, no state inspection.

### 10.2 Data, validation, content model
13. **Free-text effect parameters** (`giveKey`/`setFlag` names, `spawnGroup` "group #", `goto` "scene id") with no
    autocomplete, registry or validation; typos are silent. Node-level `goto` uses a dropdown but the `goto`
    *effect* wants a raw scene id.
14. **Dangling references** (portal → deleted scene, `spawnGroup` → empty group, `requireKey` never granted) only
    surface as a runtime log line. No lint/validation panel.
15. **Story flags are write-only** (`flags.add` only); there is no condition system to read them.
16. **Single effect per outcome, no conditions, no sequencing, no dialogue graphs, no quests.** Scripting = four
    text blobs + one enum + one string. A BG3-style editor needs dialogue trees, conditions, variables, quest
    states, and multi-step scripted sequences.
17. **One trigger zone per encounter group per scene** (`find(tr => tr.group === group)`); all zones look the
    same; no non-combat triggers (dialogue, cutscene, teleport, ambience).
18. **Encounter groups are a hard-coded 1–4 dropdown**; no per-enemy overrides; **stat blocks are baked into
    every placed enemy** so content updates do not propagate to saved maps.
19. **Spawn hint says "first 3 used"**, but play cycles `spawns[i % length]` for however many heroes exist —
    spawn *order* matters and is invisible (no numbering on the markers).
20. **Map size 8–48 hard clamp**, square tiles only, integer heights 0–8, `prop` single-valued
    (`difficult` xor `cover`), tile colour is the only material property; no textures, layers, water, lighting
    or per-scene environment settings (fog is data-only, not editable).
21. **Save format has no version field**, no checksum, no per-scene files, no asset bundling; loading validates
    only `tiles/w/h` presence (no `tiles.length === w*h` check, no shape validation) so malformed files fail deep
    inside rendering.
22. **Single localStorage slot**, silent quota failure, no dirty indicator, no autosave feedback, no history,
    no "unsaved changes" guard on New/Load/reload.

### 10.3 Feedback and performance
23. `buildTile()` **rebuilds the whole heightfield, all structure boxes and all decals for every painted cell**
    (`grid.js:147-239`) and `rebuildMarkers/rebuildDecos/rebuildNodes` rebuild all of their kind; the port must
    do incremental updates (typed-array patches, instancing) per CONTEXT.md's budget requirement.
24. Editor hover raycasts on **every** `pointermove` (no throttle), against every structure box.
25. Entire campaign is `JSON.stringify`'d to localStorage after each stroke.
26. Party HUD, party panel and choice options are rebuilt via `innerHTML` on every refresh — fine at 3–4 heroes,
    but the Preact port should render from signals.
27. No visual confirmation of persist/save, no toast system; all feedback goes through the narrative log, which
    mixes editor system messages with play narration (and is cleared on mode switch).

### 10.4 Robustness issues visible in the code (traced, not executed)
28. **Escape hides dialogs without resolving their promises** (`main.js:167`): `askRoll`/`askChoice`/`story`
    callers hang. For `askRoll` the `roll-go`/`roll-cancel` listeners are only removed inside `done()`
    (`ui.js:146-149`), so after an Escape a later `askRoll` stacks a second pair of listeners and one click
    resolves both promises (two overlapping `dice.roll()` calls). A campaign `await ui.story(...)` interrupted by
    Escape leaves the phase half-initialised.
29. **Unescaped user text in `innerHTML`**: `editor.js:57` (scene name), `:235` (node name), `:243` (enemy name),
    `:315` (node name), `main.js:67` (scene id), `:121` (campaign name). Names come from `prompt()`/the node
    panel, so a name containing `<b>` or `<img onerror>` is injected into the log.
30. **No pointer capture** while painting (§3.4).
31. **`np-dc` parse** (`parseInt || 12`) ignores the `min/max` attributes; DC 0 silently becomes 12, DC 99 is kept.
32. **Deleting a scene** does not retarget portals; **resizing** silently drops out-of-bounds content without
    listing what was lost.
33. **New campaign** replaces `masterCampaign` in memory but leaves the old one in localStorage until the first
    edit — a reload restores the old campaign, contradicting the confirm text's promise.
34. Trigger `once` and campaign `start` are dead fields; `goto` on non-portal nodes is honoured by play but only
    editable through the portal dropdown on any node type (any chest can become a travel node).

---

## 11. "Preserve exactly" checklist for the Preact port

- The 11 colour tokens and their roles (§2.1); `Segoe UI, system-ui, sans-serif` at 15 px root; dark
  `#14161f` ground with `#1c1f2b` panels and `#313749` hairlines; no light theme existed.
- Layout: top bar → (viewport | 400 px sidebar); sidebar order party → status → log → context bar.
- Log classes `narration/system/hope/fear/combat/success`, `h5` section headers, `.roll-detail` chip,
  `.d-hope/.d-fear`, 250-entry cap, autoscroll, `fadeIn` entry animation, `aria-live="polite"`.
- `.ref` affordance (accent, dotted underline, `cursor:help`, hover tint) and the 0.9 s three-pulse blue emissive
  flash on the referenced 3D entity.
- Party card glyphs: `♥`/`·` HP pips (`--danger`), `◆`/`◇` Hope pips (`--hope`, max 6), `hero-chip` colour dot,
  `Class · Ev N`, ✦ blessing button; `.selected` gold border, `.dead` greyed.
- Status row `☠ FEAR n` (violet) and `⬢ TOKENS ●●○` (blue, combat only).
- Mode badge pill top-centre with `combat` (red) / `editor` (blue) variants.
- Roll dialog contents and copy ("Spend 1 Hope for +2", "🎲 Roll the Duality Dice"), the `{go, spendHope}`
  contract, and the 1.1 s read pause; dice overlay instruction/result styling and dice colours.
- Choice/story dialog shapes (`label` + `detail` buttons, italic bordered story paragraphs).
- Inspector: 280 px accent-bordered card near the cursor with flip/clamp rules, row/paragraph markup, and the
  per-kind row sets in §7.9; hover context strings in §7.10.
- Editor toolbar grouping and labels (SCENES / MAP / TERRAIN / PROPS / NODES / ENCOUNTER / DECOR / SELECT) and the
  tool hint sentences; trigger/spawn marker colours; wall colour `#454a59`; default tile `#5d8a4a`.
- Node panel field set, the four outcome blocks (✦ hope / ☠ fear headers), `EFFECTS`-driven effect dropdown with
  conditional param field and `param: {hint}` placeholder.
- Data compatibility: read `polyheart-campaign` / `polyheart-map`, accept both campaign and bare-map JSON with
  the same defaulting rules, keep row-major `tiles[y*w+x]`, `[x,y]` pair arrays for spawns/trigger cells.

---

## 12. Unverified

- Rendered appearance, exact wrapping of the 240 px toolbar, emoji glyph rendering and the inspector clamp
  behaviour were inferred from CSS/JS only; the legacy app was not launched and no screenshot was taken.
- OrbitControls `LEFT: -1` → "no action" was confirmed against three 0.185.1 in `node_modules`; the legacy page
  loads three 0.160.0 from unpkg, which was not inspected.
- Items in §10.4 (promise hang / listener stacking, pointer-capture leak, overlapping flash tweens) were traced
  from source, not reproduced at runtime.
- The writer of the older `polyheart-map` localStorage key is not present in `legacy/`; its schema is assumed to
  be the bare-map shape that `loadJson` also accepts.
- `models.js` was only sampled (`MODELS`, `DECO_TYPES`, `DECO_INFO`, exports); model geometry details are out of
  scope here. `data-campaign.js` was read only for `buildParty`/`BLESSINGS` heads and the `fog` field.
