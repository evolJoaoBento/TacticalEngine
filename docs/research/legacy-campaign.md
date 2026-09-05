# Legacy one-shot research: "The Conductor's Stage"

Research document for porting the scripted one-shot in `legacy/js/campaign.js` (480 lines) and
`legacy/js/data-campaign.js` (411 lines) to the PolyHeart Engine as **data**, not code.

Supporting files read to resolve what the campaign calls into: `legacy/js/game.js` (862 lines,
hook system, rolls, combat), `legacy/js/data.js` (238, enemy stat blocks, `makeEnemy`),
`legacy/js/ui.js` (242, dialogs and log), `legacy/js/main.js` (176, wiring), `legacy/js/grid.js`
(685, movement rules, flash registry, pillar lights), `legacy/js/models.js` (508, model keys,
spirit eyes), `legacy/README.md`.

**Method: static analysis only.** The legacy game was not executed in this session (it loads
three.js from a CDN and needs manual dice throws). Every "line N" reference below was read from
the source; every claim about runtime behaviour is derived from the code, not observed. A short
list of things that could not be confirmed without running it is in section 10.

No TTS / voice features exist in these files and none are proposed here.

---

## 1. Runtime architecture of the legacy campaign

### 1.1 The `Campaign` class (campaign.js:17-480)

```js
new Campaign(sm, grid, dice, ui, game)      // campaign.js:18
campaign.onExit = enterPlay                 // main.js:95 – finale returns to free play
campaign.start()                            // main.js:92 – "★ One-Shot" button
```

Campaign-owned state (all plain fields on the instance):

| Field | Set at | Meaning |
|---|---|---|
| `active` | start/exit | hooks early-return when false |
| `partyDefs` | `start()` (line 36) | `buildParty()` – the four uninhabited hero defs |
| `party` | lines 37, 73, 150 **only** | live hero array carried between phases (see bug L1 in section 9) |
| `mood` | 265, 222, 275 | `null` → `'entertained'` / `'insulted'` / `'vengeful'` – the branch variable |
| `knowsCranks` | 223, 276 | `true` on the two Hag paths; gates riddles vs. crank reveal |
| `ended` | 463 | set in `finale()`; stops `archfeyActs` |
| `phase` | 67 | 1, 2, 3 |
| `inhabited` | 72, 151 | bodies taken in phase 1 (0..4) |
| `cranksHeld`, `cranksFound` | 98-99, 314-315, 346 | inventory counter and progress counter |
| `riddleIdx` | 100, 391 | cycling index for riddles |
| `bramblesSpawned` | 101, 427 | reinforcement cap counter (max 4) |
| `pendingFightPath` | 233 | **written, never read** (dead field) |

### 1.2 Hook contract into `Game` (campaign.js:24-32, consumed in game.js)

| Hook | Signature | Fired from | Semantics |
|---|---|---|---|
| `onNodeInteract` | `(node, hero) => Promise<boolean>` | game.js:351, **before** the generic adjacency check | return `true` = consumed (generic node logic skipped) |
| `onHeroMoved` | `(hero) => Promise<void>` | game.js:211, after the move + party follow, not mid-path | used for the fog loop |
| `onFearRoll` | `(result) => Promise<void>` | game.js:340-342 | fires **only when `mode !== 'combat'`** and the roll is `withFear` (not crit) |
| `onEnemyPhaseStart` | `() => Promise<void>` | game.js:555, after a 500 ms pause | fires on **every** enemy phase, whether caused by a Fear roll or by token exhaustion; the hook may end combat (checked at 556) |
| `onCombatEnd` | `(group) => Promise<void>` | game.js:683 | fires after the generic "+1 Hope to survivors" |

Consequence worth stating twice: the Archfey's cadence in phase 3 is two different triggers.
Out of combat he acts on Fear rolls only; in combat he acts at the start of every enemy phase
(Fear roll *or* tokens spent), and Fear rolls do not additionally fire `onFearRoll` there.

### 1.3 `Game.start(map, opts)` options the campaign uses (game.js:29-72)

```js
{ party, hooks, quietIntro: true, onRestart, noSpawn }   // campaign.js:49-56, 75
// generic runner also passes: keys: Set, flags: Set, onGoto(sceneId)   (main.js:61-74)
```

- `party` defs are **shallow-copied** into fresh hero objects by `addHero` (game.js:75-90):
  `hp = def.hp > 0 ? def.hp : def.maxHp`, `hope = def.hope ?? 2`, `slow = 0`. Carried wounds
  persist; the fallen revive at full HP.
- `noSpawn: true` (phase 1 only) leaves `heroes = []`; the HUD shows "You are formless — spirits
  adrift. Find vessels." (ui.js:84-86).
- `quietIntro: true` suppresses the generic map intro so the campaign writes its own.
- `game.start` also resets `fear = 0`, `mode = 'explore'`, `tokens = 0`, builds dormant enemy
  tokens for every `map.enemies[i].hp > 0`.

### 1.4 The action roll (game.js:287-344)

```js
await game.actionRoll({ hero, trait, dc, title, flavor, bonus = 0 })
// → null if the player cancels the roll dialog, else:
{ category: 'crit'|'hopeSuccess'|'fearSuccess'|'hopeFail'|'fearFail',
  crit, success, withHope, withFear /* = !withHope && !crit */,
  hope, fear, mod, total, dc }
```

Bookkeeping inside: optional "spend 1 Hope for +2" (askRoll checkbox), `crit = hope === fear`,
`success = crit || total >= dc`, Hope +1 on crit or withHope (cap 6), GM Fear +1 otherwise (cap
12), 1100 ms read pause, then `onFearRoll` (out of combat only). The physical dice throw is
`dice.roll()` → `{hope, fear}`; it is **not** seeded (cannon-es physics + user drag).

### 1.5 Restart chain (death is a rewind, not an end)

`damageHero` → all heroes dead → `ui.showEnd(false, …, () => this.restart())` (game.js:663) →
`Game.restart()` → `opts.onRestart()` (game.js:93) → `Campaign.restartPhase()` (campaign.js:58-63):

1. every `this.party` member: `hp = maxHp`, `hope = 2`, `slow = 0`
2. log `Reality stutters. A bored voice sighs: "No, no, no — from the top. Corpses are SO last act."` (class `fear`)
3. `startPhase(this.phase, { keepLog: true })` – the map is **rebuilt from its generator**
   (`campMap()` / `pitMap()` / `theaterMap()`), so nodes, enemies and triggers reset; `mood`,
   `knowsCranks`, `ended` are **not** reset; phase-3 counters are reset by `startPhase(3)`.

### 1.6 Per-phase reset (campaign.js:66-69)

`startPhase(n)` sets `phase = n`, then for every `this.party` member `blessingUsed = false`,
`slow = 0`, then `ui.clearLog()` unless `keepLog`. So blessings are "one use per scene" by
virtue of this reset — the campaign, not `Game`, owns that rule.

---

## 2. Data inventory (data-campaign.js)

### 2.1 Party (`buildParty()`, lines 10-41)

| id | name | class | heroKey / model | traits (Agi/Str/Fin/Ins/Pre/Kno) | HP | Ev | Spd | weapon (trait, dmg, range) |
|---|---|---|---|---|---|---|---|---|
| `pc-battleMage` | Ardyn | Battle Mage | `battleMage` | 0/0/-1/1/1/2 | 5 | 11 | 4 | Emberbolt (Knowledge, 3, 4) |
| `pc-defender` | Tomé | Village Defender | `defender` | 1/1/0/1/2/-1 | 6 | 12 | 4 | The Arcane Stick (Presence, 3, 2) |
| `pc-frostMage` | Iskra | Frost Mage | `frostMage` | 0/-1/1/2/0/1 | 5 | 12 | 4 | Frost Lance (Instinct, 3, 4) |
| `pc-knight` | Bram | Vanguard Knight | `knight` | 1/2/0/0/1/-1 | 8 | 13 | 3 | Tower Blade (Strength, 4, 1) |

Hero def shape: `{ id, name, class, color, model, heroKey, traits{6}, maxHp, evasion, speed,
weapon{name, trait, dmg, range} }`. When inhabited the campaign adds `spirit: 1` (one glowing
eye, models.js `setSpiritEyes(group, count)`) and `blessing: BLESSINGS[heroKey]`.

**Stat-model gap (for the orchestrator):** these are prototype numbers — flat HP 5-8, Evasion,
no damage thresholds, no Stress, no Armor Slots, no Hope cap of 6 per SRD (SRD Hope max is 6, so
that one matches), no domain cards. The port must re-express the four heroes as real Daggerheart
level-1 characters (class/subclass/ancestry/community, thresholds, Stress) and re-tune every
flat damage number (3/4 weapon damage, 2-damage traps, 3-HP brambles) against thresholds. This
document records the legacy numbers verbatim; it does not attempt the remap.

### 2.2 Spirit Blessings (`BLESSINGS`, lines 45-85)

Shape: `{ name, desc, async use(game, hero) }` — **executable JS**, the clearest non-data
element in the legacy content. One use per scene (campaign resets `blessingUsed`), costs one
action token in combat, usable **out of combat too** (`useBlessing`, game.js:697-715, only
checks tokens when in combat).

| key | name | effect (exact) | targeting |
|---|---|---|---|
| `battleMage` | Cinder Nova | 3 damage to every enemy with `hp > 0` within Manhattan 3 of the user (`damageEnemy`, no roll, no difficulty) | AoE, self-centred, enemies only, includes **dormant** enemies |
| `defender` | Hearthlight | every hero with `hp > 0` heals 2 (capped at `maxHp`) | all living allies, no range |
| `frostMage` | Hoarfrost Bind | nearest living enemy within Manhattan 4 takes 2; if still alive gets `frozen = true` (skips its next activation, game.js:571-575) | single nearest enemy, tie → array order |
| `knight` | Shield Wall | `game.shieldWall = true` → +2 to every hero's effective Evasion; cleared at the end of the next enemy phase (game.js:641) and on `endCombat` (674) | party buff, duration "until end of next enemy phase" |

### 2.3 Text blocks (all English; rendered through `esc()` so they are plain text)

| Constant | Lines | Count | Used by |
|---|---|---|---|
| `CAMP_INTRO` | 88-92 | 3 paragraphs | phase 1 log |
| `FOG_LOOP_LINES` | 94-98 | 3 | random pick on fog loop |
| `FLASHBACKS[heroKey]` | 101-134 | 4 × `{title, memories[3]}` | body possession story panel |
| `PIT_INTRO` | 137-142 | 4 | phase 2 story panel + log |
| `PROCLAMATION` | 144-147 | 2 | phase 2 story panel |
| `HAG_PITCH` | 149-153 | 3 | hag story panel; `[1..]` echoed to log |
| `HAG_DEAL_DONE` | 155-159 | 3 | deal story panel; `[1]` echoed to log |
| `HAG_FIGHT_WIN` | 161-165 | 3 | moon staff story panel |
| `OPENINGS[mood]` | 168-181 | 3 × 2 | phase 3 story panel + log |
| `RIDDLES[crankId]` | 183-188 | 4 | Archfey riddle lines |
| `ENDINGS[mood]` | 190-203 | 3 × 2 | finale story panel + log |
| `OUTRO` | 205-208 | 2 | finale story panel + log |

Phase 3 story-panel titles are inline in campaign.js:105-109 (`'The Archfey — Entertained'`
etc.) and 470 (`'Ending — The Arena' / 'Ending — The Deal' / 'Ending — The Fight'`).

### 2.4 Position constants (lines 211-214) and the one that is not a constant

```js
CAMP_GATE          = { x: 11, y: 2 }     // phase 1 gate spawns here
PIT_PORTAL_ARENA   = { x: 12, y: 10 }    // pit floor (h0)
PIT_PORTAL_HUT     = { x: 6, y: 17 }     // rim (h3), beside the hut
THEATER_REINFORCE  = [[2, 9], [21, 9], [4, 16], [19, 16]]
```

The Moon Staff portal is spawned at the **hardcoded literal `(2, 11)`** (campaign.js:282), a
seating-tier tile (h2). It is not one of the constants.

### 2.5 Map document shape (`base()`, lines 218-224)

```js
{ name, intro: '', w, h,
  tiles: [{ h: 0..8, color: '#rrggbb', prop: null|'cover'|'difficult' }],  // row-major y*w+x
  nodes: [...], enemies: [...], triggers: [...], decos: [{type,x,y,rot,id?}], spawns: [[x,y]],
  fog?: { band: 2 } }
```

Scripted node shapes actually used (all `type: 'scripted'`; the campaign keys on ad-hoc flags,
not on `type`):

| Node | Discriminator | Extra fields | Map |
|---|---|---|---|
| `body-<heroKey>` ×4 | `heroKey` | `model: 'body:<heroKey>'`, `name` | camp |
| `gate` | `id === 'gate'` (+ `phase === 1`) | `model: 'gate'`, spawned at runtime | camp |
| `hag` | `hagNode: true` | `model: null` (no mesh! the hut deco at (3,17) is the visual), name | pit |
| `portal` | `id === 'portal'` | `model: 'gate'`, spawned at runtime | pit |
| `crank-piano` etc. ×4 | `crank: true` | `trait`, `dc`, `foundText`, runtime `found` | theater |
| `pillar-1..4` | `pillar: true` | `model: 'spotlight'`, runtime `lit`, `inserted` | theater |

All nodes are movement blockers (`blockedNodeSet`, game.js:138-145: every node except an open
door). The hag node at (4,17) therefore blocks that tile even though it has no mesh.

Enemy instance shape (`makeEnemy(x, y, group, type)`, data.js:141-149):
`{ id: 'enemy-<rand>', type, name, model, maxHp, difficulty, atkMod, dmg, speed, range, special?, hp, x, y, group }`.

| type | name | HP | Difficulty | atk | dmg | spd | range | special |
|---|---|---|---|---|---|---|---|---|
| `bramble` | Tangle Bramble | 3 | 12 | +1 | 2 | 2 | 1 | `entangle` – on hit `target.slow += 1` (stacking −1 speed, floor 1; cleared at combat end) |
| `shadowHag` | Shadow Hag | 14 | 14 | +3 | 3 | 3 | 4 | `nightmare` – each activation 50 %: every hero within 5 with Hope > 0 loses 1 Hope, hag heals 1, skips her attack |

Trigger shape: `{ id, group, once: true, cells: [[x,y]…], fired? }`. `triggerAt` (game.js:278)
only fires in explore mode, only if the group still has a living enemy, and followers stop one
cell short of any live trigger (game.js:258-262).

### 2.6 Map geometry that the script depends on

**Camp (22×16, `campMap()` 227-277).** `fog: { band: 2 }` → two-tile ring is the fog wall (also
rendered as drifting sprites, grid.js:268-298, and denser scene fog). Bodies at (8,6) battleMage,
(14,6) defender, (8,10) frostMage, (14,10) knight, around the fire at (11,8). `spawns: [[11,8]]`
is unused because of `noSpawn`. Gate appears at (11,2) — inside the fog band (y ≤ 1 is band;
y = 2 is the first walkable row), which is why the fog loop has a gate exception.

**Pit (26×20, `pitMap()` 280-335).** Rim h3, seating tier h2 (x 2-23, y 3-16), floor h0 (x 6-19,
y 5-14). Balcony h6 at x 11-14, y 0-1 with throne deco (12,0) and `archfey-2` deco (13,0) (decos
with an `id` are flash-referenceable but not interactable). Cover rocks (8,7), (17,12), (9,12).
**Stairs (12,15), (13,15) at h1 are the only legal way onto the floor** — `findReachable` rejects
any step with `|Δh| > 1` (grid.js:622) and tier→floor is Δ2. Stairs lead onto (12,14)/(13,14),
which are inside `trig-arena` (group 1, 12 cells: x 10-15 × y 13-14). Six dormant brambles
(group 1) at (8,6), (15,6), (10,9), (16,9), (8,12), (14,12). Hag node (4,17), hut deco (3,17).
Party spawns (12,18), (13,18), (11,18), (14,18) on the rim.

**Theater (24×18, `theaterMap()` 338-411).** Stage h1 (x 1-22, y 1-5), house h0, curtain walls
h4 (row 0, columns 0 and 23 for y 1-6). Throne dais h2 at (11,1), (12,1) with throne deco,
`archfey-3` deco and a `barrier` deco at (12,1). Cranks: piano (5,2) Finesse DC 11, floorboard
(11,3) Instinct DC 11, spectator (5,8) Presence DC 12, trunk (18,2) Strength DC 11. Pillars
`pillar-1..4` at (3,2), (20,2), (3,7), (20,7). Five dormant brambles (group 1) at (5,11),
(18,11), (8,15), (15,15), (3,13). Spawns (11,17), (12,17), (10,17), (13,17). **No triggers** —
combat here is started by script only.

---

## 3. Behaviour catalogue

Legend for the *Class* column: **DATA** = expressible with plain declarative content;
**DATA+EXPR** = declarative plus a small condition/selector expression; **SCRIPT** = needs a
sandboxed script hook unless the engine grows a dedicated primitive.

### Phase 1 — Waking Up

| id | Legacy ref | Trigger | Conditions | Effects (in order) | Primitive | Class |
|---|---|---|---|---|---|---|
| P1.1 | campaign.js:71-82 | scene start | — | start camp with `party: []`, `noSpawn`; clear log; header `PHASE 1 — WAKING UP`; log `CAMP_INTRO[0..2]`; log "Four bodies lie in the dirt: <refs>"; context "You are spirits. Click a body to inhabit it."; badge `SPIRITS ADRIFT` | scene `onEnter` effect list; spawn policy `none`; HUD mode label | DATA |
| P1.2 | 142-166 | interact body node | none — **no adjacency, no hero required** (hook runs before the generic check and ignores `hero`) | story panel `💀 <title>` with 3 memories, button `Take the body`; remove body node; `addHero({...def, spirit:1, blessing})` at the node's tile; `inhabited++`; log "The spirit sinks into the cold flesh — and **Name, Class**, draws breath… Blessing gained: ✦ Name"; refresh HUD; if `inhabited === 4` → spawn node `gate` at (11,2), header `THE FOG PARTS`, log, context "Walk the party to the gate…"; else context "n/4 bodies inhabited…" | interactable with `requiresAdjacency:false`, cutscene, `removeNode`, `spawnPartyMember(actorId, at:node, tags)`, `grantAbility`, counter var, conditional `spawnNode` | DATA (counter condition is `inhabited == 4`) |
| P1.3 | 168-179 | interact `gate` | `phase === 1` (implicit: scene) | choice `The Gate in the Fog` {Step through → go to phase 2, Not yet} | travel node with confirm (legacy generic `node.goto` already does exactly this, game.js:369-384) | DATA |
| P1.4 | 445-459 | `onHeroMoved` | scene = camp; hero in band `x<=1 \|\| y<=1 \|\| x>=w-2 \|\| y>=h-2`; **exception**: gate exists and Manhattan(hero, gate) ≤ 1 | teleport hero to `x' = clamp(w-1-x, 2, w-3)`, `y' = clamp(h-1-y, 2, h-3)` (mirror through the centre, clamped inside the band); move token; log random `FOG_LOOP_LINES` (class `fear`) | region trigger (`onEnter`, region = complement of inner rect) with exception region; `teleport` effect with `mode: 'mirror'`; `logRandom` | DATA+EXPR (mirror arithmetic) — or SCRIPT |

Notes on P1.4: only the moved (leader) hero is checked; followers who trailed into the band stay
there (party follow runs before the hook). The band tiles are walkable and cost 1; explore-mode
move budget is `speed + 4` (game.js:162). Phase 1 has no enemies, so death/restart cannot happen
here.

### Phase 2 — The Pit

| id | Legacy ref | Trigger | Conditions | Effects | Primitive | Class |
|---|---|---|---|---|---|---|
| P2.1 | 84-95 | scene start | — | start pit with carried party; header `PHASE 2 — THE PIT`; story panel `The Rim of the Pit` (`PIT_INTRO`); story panel `The Archfey's Proclamation` (`PROCLAMATION`); log `PIT_INTRO`; log "Above the pit, [the Archfey] watches…" (`fear`); log "Three roads from here…" with hag ref (`system`); context | cutscene sequence, log, HUD context | DATA |
| P2.2 | data-campaign.js:328-332 + game.js:187-207 | step on `trig-arena` cell | explore mode; group 1 has a living enemy; `!fired` | `enterCombatGroup(1)` (generic intro text) | encounter trigger region (already generic) | DATA |
| P2.3 | 263-271 | `onCombatEnd(1)` | `phase === 2 && !mood` | `mood = 'entertained'`; header `PATH CHOSEN — THE ARENA`; log applause line (`hope`); `spawnPortal(12,10)` (spawn node `portal`, flash it, log "A backdoor portal tears open…", context) | `onEncounterCleared` event; `setVar`; `spawnNode`; `flash`; log | DATA |
| P2.4 | 435-437 | `onFearRoll` | `phase === 2 && !mood` | log "…the Archfey leans forward a fraction. *"Oh, do that again."*" | roll-result event | DATA — **but unreachable** (see Q6) |
| P2.5a | 205-208 | interact `hag` node | **no adjacency**; `mood` already set → log "Only a cold patch of shadow remains by the hut." and stop | conditional dialogue entry | DATA |
| P2.5b | 207-217 | (cont.) | `mood == null` | story panel `The Shadow Hag` (`HAG_PITCH`); log `HAG_PITCH[1..2]` (`fear`); choice `The Hag's Bargain` with 3 options (labels/details verbatim at 213-215) | dialogue node with choices | DATA |
| P2.5c deal | 219-230 | choice = `deal` | — | every hero: `blessing = null`, `blessingUsed = false`; HUD; `mood = 'insulted'`; `knowsCranks = true`; story panel `The Deal Is Struck` (`HAG_DEAL_DONE`); header `PATH CHOSEN — THE DEAL`; log "…All Spirit Blessings are gone." (`fear`); log `HAG_DEAL_DONE[1]`; `spawnPortal(6,17)`. Hag node **stays** (later clicks hit P2.5a) | `revokeAbility(all party)`, `setVar`×2, cutscene, `spawnNode` | DATA |
| P2.5d fight | 232-245 | choice = `fight` | — | `pendingFightPath = true` (dead); header `PATH CHOSEN — THE FIGHT`; log "Naughty children…"; `makeEnemy(4,17, group 2, 'shadowHag')` pushed to `map.enemies`; remove hag node; rebuild nodes; build enemy token; `enterCombatGroup(2, intro html with ref to the hag)`. `mood` **not** set here | `spawnEnemy(at node)`, `removeNode`, `startEncounter(group, introText)` | DATA |
| P2.5e leave | 247 | choice = `leave` | — | log "You back away from the hut. Her chuckle follows you like smoke." Hag can be re-approached; pitch repeats | — | DATA |
| P2.6 | 273-284 | `onCombatEnd(2)` | `phase === 2` | `mood = 'vengeful'`; `knowsCranks = true`; every hero `weapon = {...weapon, dmg: dmg + 1}`; story panel `The Moon Staff` (`HAG_FIGHT_WIN`); header `THE MOON STAFF`; log "+1 damage to every hero's weapon."; HUD; `spawnPortal(2,11)` | `onEncounterCleared`; `setVar`; `modifyStat(all party, weapon.dmg, +1, permanent)`; cutscene; `spawnNode` | DATA |
| P2.7 | 184-195 | interact `portal` | **no adjacency** | choice `The Backdoor` {Step through the backdoor → phase 3, Linger} | travel node with confirm | DATA |
| P2.8 | game.js:578-589, 629-632 | enemy phase | hag alive / bramble hit | Waking Nightmare, Entangle (see 2.5) | actor abilities on the adversary template | DATA (adversary feature definitions) |
| P2.9 | game.js:663 → campaign.js:58-63 | party wiped | — | rewind (section 1.5) | scene restart policy | DATA |

### Phase 3 — The Conductor's Stage

| id | Legacy ref | Trigger | Conditions | Effects | Primitive | Class |
|---|---|---|---|---|---|---|
| P3.1 | 97-134 | scene start | `mood ?? 'entertained'` | reset `cranksHeld/cranksFound/riddleIdx/bramblesSpawned = 0`; start theater; header `PHASE 3 — THE CONDUCTOR'S STAGE`; story panel titled by mood with `OPENINGS[mood]`; log the same (`fear`); log the barrier/pillar instructions (`narration`); **if `knowsCranks`**: log the four crank refs (`hope`) and `flash` all four crank nodes; **else** log the "piece by piece… every time Fear takes the dice, he will recite a riddle" line; **if `mood !== 'entertained'`**: wait 400 ms, `enterCombatGroup(1, "Brambles burst from beneath the seats — and worse: [the Archfey] flexes his fingers like a puppeteer…")`; else context "Search the stage…" | scene `onEnter` with branches on vars; `flash`; delayed `startEncounter` | DATA |
| P3.2 | 292-329 | interact crank node | hero required; Manhattan ≤ 1 else log "too far" + flash; `found` → log "already given up its secret"; in combat with `tokens <= 0` → silently refuse | `actionRoll(trait, dc, title "Search <name> — <trait> DC <dc>", flavor by `knowsCranks`)`; cancel → nothing; in combat `tokens--`; **success** (any) → `found = true`, `cranksFound++`, `cranksHeld++`, log `foundText` (`success`), log "Crank handle secured! (n/4 found, k in hand) — fit it into a dark [spotlight pillar]" (`hope`); **fail with Fear** → log "The hiding place bites back…" + `damageHero(hero, 2, 'Hidden thorns')`; **fail with Hope** → log "Nothing yields — yet…"; then in combat: withFear → `enemyPhase('Rolled with Fear — the stage strikes back.')`, else tokens ≤ 0 → `enemyPhase('The party is spent.')` | check-interactable with 4-outcome table (legacy generic nodes already have `outcomes.{hopeSuccess,fearSuccess,hopeFail,fearFail}` with `effect`/`param`, game.js:392-411); effects `setNodeState`, `incVar`×2, `damage`; `actionCost: 1`, `endsTurnOnFear: true` | DATA |
| P3.3 | 333-361 | interact pillar node | hero required; Manhattan ≤ 1 | **no roll, no token cost, works in combat**. `!inserted`: `cranksHeld <= 0` → log "crank socket is empty"; else `cranksHeld--`, `inserted = lit = true`, `setPillarLit`, log "…the spotlight blazes to life. (n/4 lit)". `inserted && !lit`: `lit = true`, `setPillarLit`, log "re-cranks the sabotaged pillar…". `lit && litCount < 4`: log "This pillar already burns. n more remain dark." and stop. Finally if `litCount === 4` → P3.4 | state-machine interactable (`empty → inserted+lit ⇄ inserted+dark`), `requireVar(cranksHeld > 0)`, `decVar`, `setNodeState`, visual state binding, `actionCost: 0`; derived condition `count(nodes where pillar && lit) == 4` | DATA+EXPR (the count) |
| P3.4 | 363-376 | all 4 lit (from P3.3, including clicking any lit pillar afterwards) | — | trait = `hero.traits.Knowledge >= hero.traits.Finesse ? 'Knowledge' : 'Finesse'`; header `THE FOUR LIGHTS`; log; `actionRoll(trait, 13, "Align the spotlights — <trait> DC 13", flavor)`; cancel → nothing; success → P3.8; fail → log "…Re-align them (click any lit pillar)." (`fear`). **No token cost, no enemy-phase handoff in combat** | check with `trait: bestOf(['Knowledge','Finesse'])`; `actionCost: 0`; `endsTurnOnFear: false` | DATA+EXPR (best-of selector) |
| P3.5 | 379-431 `archfeyActs` | see P3.6 | `phase === 3 && !ended && any hero alive` | header `THE ARCHFEY ACTS`, then sub-steps a-d below | composite scripted event | — |
| P3.5a riddle | 387-394 | (part of P3.5) | `mood === 'entertained' && !knowsCranks` (second clause always true on that path) | `hidden = CRANK_ORDER.filter(!found)`; if any: `id = hidden[riddleIdx % hidden.length]`, `riddleIdx++`, log "[The Archfey] drawls a riddle from his throne: RIDDLES[id]" (`fear`) | `logFromList(list: unfound cranks in fixed order, pick: cycling index)` | DATA+EXPR |
| P3.5b victim | 396 | (part) | — | `victim = random(alive heroes)` | random selector | DATA+EXPR (seeded stream) |
| P3.5c sabotage | 398-408 | (part) | `mood === 'entertained'` and ≥ 1 lit pillar | random lit pillar: `lit = false` (`inserted` stays true), `setPillarLit(false)`, flash victim, log "**TAKEOVER!** <victim>'s eye flashes iridescent — their legs carry them… to the [spotlight pillar], and their own hands crank the light **back off**. (n/4 lit)" (`fear`) | `setNodeState(random(nodes where pillar && lit), lit=false)`, `flash`, log | DATA+EXPR |
| P3.5d punish | 409-420 | (part) | `mood !== 'entertained'` and ≥ 2 heroes alive | `target = nearest other alive hero to victim` (Manhattan, tie → array order); flash victim; log "**TAKEOVER!** Starlight floods <victim>'s eyes — and their <weapon> swings at **<target>**…" (`fear`); `bumpAttack` animation victim→target; `damageHero(target, max(1, victim.weapon.dmg - 1), '<victim> (puppeted)')` (no roll, no Evasion) | `selectNearest`, `playAnim('bump')`, `damage(expr)` | DATA+EXPR |
| P3.5e reinforce | 422-429 | (part) | `mood !== 'entertained' && mode === 'combat' && bramblesSpawned < 4` | spawn `bramble` group 1 at `THEATER_REINFORCE[bramblesSpawned % 4]`, build token, `bramblesSpawned++`, log "Another [tangle bramble] tears itself free of the seating vines." | `spawnEnemy(template, at: list[counter], group)`, `incVar`, cap | DATA |
| P3.6 | 433-442 | `onFearRoll` (out of combat) **and** `onEnemyPhaseStart` (in combat) | `phase === 3` | → P3.5 | two event bindings to one effect list | DATA |
| P3.7 | 286-288 | `onCombatEnd(any)` | `phase === 3` | log "The stage falls quiet — but the Archfey's smile never wavers. *"Intermission. Do continue searching."*" (`system`) | `onEncounterCleared` | DATA |
| P3.8 finale | 462-479 | align success | — | `ended = true`; header `THE SCRIPT CRACKS`; log "Four beams slam onto the throne at once…" (`success`); story panel `Ending — <path>` with `ENDINGS[mood]`; log same (`hope`); story panel `Outro` (`OUTRO`, button `Fade to black`); log same (`narration`); `showEnd(true, 'End of the one-shot. The town below the ridge waits — and someone there is already looking for you.', exit)` → `onExit` = free play | `setVar`, cutscene×2, `endScenario(victory, text)` | DATA |
| P3.9 | 58-63 | party wiped | — | rewind: theater rebuilt (cranks unfound, pillars dark, 5 brambles back), counters reset, `mood` kept so the same opening + immediate combat replays on skip paths; party healed, Hope 2; weapon bonus / traded blessings as carried in `this.party` (see L1) | scene restart policy | DATA |

**Timed / countdown primitives: none.** The only time-based code is cosmetic pacing:
`setTimeout` 400 ms before the phase-3 ambush (campaign.js:127), 300 ms before `spawnGroup`
combat (game.js:434), 500 ms at enemy-phase start (552), 1100 ms after a roll (335), 250/350 ms
between enemy activations (586, 638), 600 ms before the generic victory modal (690). No behaviour
depends on wall-clock time or a turn countdown. The port needs a `delay(ms)` effect for pacing,
nothing more.

**Randomness inventory** (CONTEXT.md requires seeded RNG; each should become a named stream):

| Draw | Where | Purpose |
|---|---|---|
| `FOG_LOOP_LINES[random]` | campaign.js:457 | flavour line |
| `alive[random]` | 396 | takeover victim |
| `lit[random]` | 402 | sabotaged pillar |
| `Math.random() < 0.5` | game.js:578 | Waking Nightmare proc |
| `d12` | game.js:622 | enemy attack roll |
| `ITEMS[random]` | game.js:453 | generic loot (unused by the one-shot) |
| `'enemy-' + random id` | data.js:144 | instance ids (should be deterministic ids in the port) |
| physical Hope/Fear d12 | dice.js | player rolls — physics; the port must allow a seeded non-physical resolver for tests |

---

## 4. Engine mechanics the one-shot leans on (game.js)

These are not campaign script but the one-shot's balance and puzzle logic assume them:

- **Action tokens** = living heroes + 1 (`maxTokens`, 119). Move, attack, node check, blessing
  each cost 1. Enemy phase when tokens hit 0 **or any roll lands with Fear** (attack 541, node
  409, crank 326). Tokens refill after the enemy phase (644).
- **Roll outcome maths**: crit on matching dice; Hope +1 on crit/withHope (cap 6); Fear +1
  otherwise (cap 12). Spend 1 Hope for +2 before rolling.
- **Hero attack damage**: `weapon.dmg + (withHope||crit ? 1 : 0) + (crit ? weapon.dmg : 0)`
  (528-529). Difficulty to hit = `enemy.difficulty + (cover ? 2 : 0)`, +1 bonus from high ground.
- **Enemy attack**: `d12 + atkMod + surge >= evasion + (cover ? 2 : 0) + (shieldWall ? 2 : 0)`
  (622-627). GM spends 4 Fear at enemy-phase start for `surge = 2` (560-565).
- **Enemy AI**: nearest hero by Manhattan; move within `speed` toward it (BFS with `|Δh| ≤ 1`,
  difficult ×2, occupied/blocked cells excluded); attack if within `range`.
- **Statuses**: `frozen` (skip one activation, 571), `slow` (stacking −speed, floor 1, cleared on
  `endCombat` 675), `shieldWall` (party-wide, cleared 641/674).
- **End of combat**: +1 Hope to every living hero (678), then `onCombatEnd(group)`.
- **Exploration**: party moves as a conga line behind the selected leader; followers never enter
  an untriggered live trigger zone; move budget `speed + 4`; allies do not block each other.
- **Node checks (generic)**: adjacency ≤ 1; `requireKey`; `goto` travel with confirm; 4-outcome
  table with effects `giveKey|setFlag|spawnGroup|goto|open|loot|damage|removeNode`
  (`EFFECTS`, data.js:6-16). The crank search (P3.2) is a hand-written copy of this generic
  flow with custom outcome effects — evidence that the generic node already covers ~80 % of it.
- **Text ↔ world links**: `ref(id, text)` → `<span class="ref" data-ref="id">` (ui.js:10); hovering
  calls `grid.flash(id)` on any registered hero/enemy/node/deco-with-id. Log entries carry one
  of six classes: `narration`, `system`, `hope`, `fear`, `combat`, `success`. campaign.js also
  hardcodes `<b>`, `<i>` and one raw `<span class="ref">` (line 153) inside otherwise-escaped
  strings. The port needs a **safe markup** (e.g. `[[ref:id|text]]`, `**bold**`, `*italic*`)
  rendered by the UI, never raw HTML from content.

---

## 5. Proposed data primitives (sketches)

These are shapes, not a final schema; ids are illustrative. Everything in section 3 maps onto
them.

### 5.1 Scenario, scenes, variables

```jsonc
{
  "id": "conductors-stage",
  "variables": {
    "mood":            { "type": "enum", "values": ["entertained","insulted","vengeful"], "default": null },
    "knowsCranks":     { "type": "bool", "default": false },
    "inhabited":       { "type": "int",  "default": 0,  "scope": "scene" },
    "cranksHeld":      { "type": "int",  "default": 0,  "scope": "scene" },
    "cranksFound":     { "type": "int",  "default": 0,  "scope": "scene" },
    "riddleIdx":       { "type": "int",  "default": 0,  "scope": "scene" },
    "bramblesSpawned": { "type": "int",  "default": 0,  "scope": "scene" },
    "ended":           { "type": "bool", "default": false }
  },
  "scenes": ["camp", "pit", "theater"],
  "start": "camp",
  "restartPolicy": { "on": "partyWiped", "do": ["healParty", { "setHope": 2 }, "clearStatuses",
                     { "log": "Reality stutters…", "class": "fear" }, { "restartScene": { "keepLog": true } }] }
}
```

`scope: "scene"` variables reset on scene (re)entry — this reproduces `startPhase(3)` resetting
the phase-3 counters while `mood` survives a rewind.

### 5.2 Events and effect lists

```jsonc
{ "on": "sceneEnter",                              "if": "...", "do": [ ...effects ] }
{ "on": "interact",      "node": "body-knight",    "do": [...] }
{ "on": "regionEnter",   "region": "fog-band",     "except": { "nearNode": "gate", "radius": 1 }, "do": [...] }
{ "on": "encounterCleared", "encounter": "arena",  "if": "mood == null", "do": [...] }
{ "on": "rollResolved",  "if": "roll.withFear && !inCombat", "do": [...] }
{ "on": "enemyPhaseStart", "do": [...] }
```

Effect vocabulary needed by this one-shot (each one appears in section 3):

`log(text, class)`, `logHeader`, `logRandom(list, class)`, `setContext`, `setBadge`,
`cutscene({title, paragraphs, button})`, `choice({title, body, options[{label, detail, then: effects}]})`,
`setVar`, `incVar`, `decVar`, `spawnNode(nodeDef)`, `removeNode(id)`, `setNodeState(id|selector, patch)`,
`flash(id|selector)`, `spawnPartyMember(actorId, at, patch)`, `grantAbility(selector, abilityId)`,
`revokeAbility(selector, abilityId|all)`, `modifyStat(selector, path, delta, {permanent})`,
`healParty(n)`, `damage(selector, amountExpr, sourceName)`, `applyStatus(selector, status, duration)`,
`teleport(selector, {mode: 'mirror'|'to', ...})`, `spawnEnemy(template, at, group)`,
`startEncounter(group, introText)`, `check({trait|traitExpr, dc, title, flavor, actionCost, endsTurnOnFear, outcomes})`,
`playAnim(actor, kind, target)`, `delay(ms)`, `gotoScene(id, {confirm})`, `endScenario({victory, text})`.

### 5.3 Selectors and expressions (the "EXPR" in DATA+EXPR)

A tiny expression language covering exactly what the script computes: variable reads,
comparisons, `&&/||/!`, `count(selector)`, `random(selector)`, `nearest(selector, from)`,
`bestOf(actor, [traits])`, `clamp`, `max`, `list[index % len]`, `inCombat`, `roll.*`,
`node.*`, `actor.*`. Every use in the one-shot is one line; none needs loops or side effects.
That is the strongest argument for an expression language over general scripting.

### 5.4 Interactables (nodes)

```jsonc
{ "id": "crank-piano", "kind": "check", "model": "piano", "at": [5,2], "rot": 0.5,
  "name": "The Grand Piano", "requiresAdjacency": true, "actionCost": 1, "endsTurnOnFear": true,
  "once": true, "usedText": "… has already given up its secret.",
  "check": { "trait": "Finesse", "dc": 11, "flavor": { "if": "knowsCranks", "then": "…", "else": "…" } },
  "outcomes": {
    "success":  [ { "setNodeState": { "found": true } }, { "incVar": "cranksFound" }, { "incVar": "cranksHeld" },
                  { "log": "…foundText…", "class": "success" }, { "log": "Crank handle secured! ({cranksFound}/4…)", "class": "hope" } ],
    "fearFail": [ { "log": "The hiding place bites back…", "class": "fear" }, { "damage": { "target": "actor", "amount": 2, "source": "Hidden thorns" } } ],
    "hopeFail": [ { "log": "Nothing yields — yet…", "class": "system" } ]
  } }

{ "id": "pillar-1", "kind": "stateMachine", "model": "spotlight", "at": [3,2], "requiresAdjacency": true, "actionCost": 0,
  "state": { "inserted": false, "lit": false }, "visual": { "lit": "beam+lens" },
  "transitions": [
    { "if": "!node.inserted && cranksHeld <= 0", "do": [ { "log": "crank socket is empty…" } ] },
    { "if": "!node.inserted",                    "do": [ { "decVar": "cranksHeld" }, { "setNodeState": { "inserted": true, "lit": true } }, { "log": "…blazes to life ({count(nodes[pillar && lit])}/4 lit)" } ] },
    { "if": "node.inserted && !node.lit",        "do": [ { "setNodeState": { "lit": true } }, { "log": "re-cranks the sabotaged pillar…" } ] },
    { "if": "node.lit && count(nodes[pillar && lit]) < 4", "do": [ { "log": "This pillar already burns…" } ], "stop": true }
  ],
  "after": [ { "if": "count(nodes[pillar && lit]) == 4", "do": [ { "runCheck": "align-spotlights" } ] } ] }
```

### 5.5 Abilities (blessings as data)

```jsonc
{ "id": "cinder-nova",    "name": "Cinder Nova",    "uses": { "per": "scene", "count": 1 }, "cost": { "actionToken": 1 },
  "usableOutOfCombat": true,
  "effects": [ { "damage": { "target": { "enemies": { "within": 3, "of": "self", "metric": "manhattan", "alive": true } }, "amount": 3, "source": "Cinder Nova" } },
               { "ifNone": { "log": "The nova blooms over empty ground." } } ] }
{ "id": "hearthlight",    "effects": [ { "heal": { "target": { "allies": { "alive": true } }, "amount": 2 } }, { "log": "…The party heals 2 HP." } ] }
{ "id": "hoarfrost-bind", "effects": [ { "damage": { "target": { "nearestEnemy": { "within": 4 } }, "amount": 2 } },
                                       { "applyStatus": { "target": "last", "status": "frozen", "duration": { "activations": 1 }, "ifAlive": true } } ] }
{ "id": "shield-wall",    "effects": [ { "applyStatus": { "target": "party", "status": "evasion+2", "duration": { "until": "endOfNextEnemyPhase" } } } ] }
```

### 5.6 Encounters

```jsonc
{ "id": "arena", "group": 1, "members": [ { "template": "bramble", "at": [8,6] }, … ], "trigger": { "region": [[10,13]…[15,14]], "once": true } }
{ "id": "hag",   "group": 2, "members": [], "spawnedByScript": true, "intro": "[The Shadow Hag] rakes the air…" }
{ "id": "stage", "group": 1, "members": [ …5 brambles… ], "trigger": null,
  "reinforcements": { "template": "bramble", "positions": [[2,9],[21,9],[4,16],[19,16]], "cap": 4, "on": "enemyPhaseStart", "if": "mood != 'entertained'" } }
```

### 5.7 Actor templates

Adversaries as SRD-style stat blocks with features: `Tangle Bramble` (feature *Entangle*: on
hit, target gains stacking `slowed`), `Shadow Hag` (feature *Waking Nightmare*: 50 % per
activation, range 5, −1 Hope to each hero in range with Hope > 0, self-heal 1, replaces attack).
Party members as full character sheets plus a `spirit` cosmetic flag and an `abilities` slot for
the blessing.

---

## 6. Checklist — engine features required to port this one-shot 100 % as data

Tags: `[DATA]` plain content · `[DATA+EXPR]` needs the small expression language of 5.3 ·
`[SCRIPT]` needs a sandboxed script hook unless a dedicated primitive is built.

**Scenario / scene / state**
- [ ] `[DATA]` Multi-scene scenario with ordered scenes, per-scene maps generated or stored as JSON (three maps: 22×16 fog camp, 26×20 pit, 24×18 theater).
- [ ] `[DATA]` Scenario-scoped variables (enum `mood`, bool `knowsCranks`, bool `ended`) and scene-scoped counters that reset on scene (re)entry.
- [ ] `[DATA]` Scene `onEnter` effect lists with conditional branches (`mood`, `knowsCranks`).
- [ ] `[DATA]` Party carry-over between scenes preserving HP, Hope, statuses cleared, granted/revoked abilities, permanent stat modifiers (fixes legacy bug L1).
- [ ] `[DATA]` Spawn policy per scene: `none` (spirits), `spawnPoints[]` (pit/theater).
- [ ] `[DATA]` Scene restart policy on party wipe: heal, set Hope, clear statuses, rebuild scene, keep scenario vars, `keepLog`.
- [ ] `[DATA]` Scenario end (`endScenario` victory modal with custom text, hand-off to free play/menu).

**Events / triggers**
- [ ] `[DATA]` `sceneEnter`, `interact(node)`, `regionEnter` (rect / band / cell list, with an exception region), `encounterCleared(id)`, `rollResolved` (with `withFear`, `inCombat` predicates), `enemyPhaseStart`, `partyWiped`.
- [ ] `[DATA]` Generic encounter trigger regions (`once`, only while the group has living members, followers stop short).
- [ ] `[DATA]` Interactable flags: `requiresAdjacency` (false for bodies/gate/hag/portal, true for cranks/pillars), `requiresHero`, `actionCost` (0 for pillars and the align roll, 1 for crank searches), `endsTurnOnFear` (true for cranks, false for align), `once`/`usedText`.

**Effects**
- [ ] `[DATA]` Log with markup classes (`narration|system|hope|fear|combat|success`), headers, context bar, mode badge; safe inline markup with entity references that flash the 3D object on hover.
- [ ] `[DATA]` `logRandom(list)` from a seeded stream.
- [ ] `[DATA]` Cutscene ("story panel"): title, N paragraphs, custom button label; sequential awaiting.
- [ ] `[DATA]` Choice dialog: title, body, options with label + detail, each option running an effect list (3-way Hag bargain; 2-way gate/portal confirms).
- [ ] `[DATA]` `spawnNode` / `removeNode` at runtime (gate, portal, hag→enemy swap, body→hero swap), including nodes with no mesh (`model: null`).
- [ ] `[DATA]` `setNodeState` with visual binding (spotlight `beam`/`lens` on `lit`; body model swap).
- [ ] `[DATA]` `flash(id)` and `flash(selector)` (all four cranks at once).
- [ ] `[DATA]` `spawnPartyMember(actorId, at: nodeTile, patch: {spirit: 1})` mid-scene + HUD refresh.
- [ ] `[DATA]` `grantAbility` / `revokeAbility(all party)`.
- [ ] `[DATA]` `modifyStat(all party, weapon.damage, +1, permanent)`.
- [ ] `[DATA]` `damage(target, amount, sourceName)` bypassing rolls/Evasion (hidden thorns 2, puppet strike), `heal`, `applyStatus`.
- [ ] `[DATA]` `spawnEnemy(template, at, group)` at runtime (hag, reinforcements) with token build.
- [ ] `[DATA]` `startEncounter(group, introText)` from script (no trigger), optionally after `delay(ms)`.
- [ ] `[DATA]` `check({...})` effect that opens the roll dialog and dispatches on the four outcomes (crank search, align).
- [ ] `[DATA]` `gotoScene(id, {confirm: {title, body, yes, no}})`.
- [ ] `[DATA]` `playAnim(actor, 'bump', target)` for the puppet strike; `delay(ms)` for pacing.
- [ ] `[DATA+EXPR]` `teleport(actor, mode: 'mirror', clampInset: 2)` for the fog loop — or a dedicated "wrap-around region" primitive.

**Selectors / expressions**
- [ ] `[DATA+EXPR]` `count(nodes[pillar && lit]) == 4`, `count(...) < 4`, `cranksHeld > 0`, `inhabited == 4`, `mood == null`, `mood != 'entertained'`, `!inCombat`, `bramblesSpawned < 4`.
- [ ] `[DATA+EXPR]` `random(aliveHeroes)`, `random(nodes[pillar && lit])` from a seeded stream.
- [ ] `[DATA+EXPR]` `nearest(otherAliveHeroes, from: victim)` (Manhattan, deterministic tie-break).
- [ ] `[DATA+EXPR]` `bestOf(actor, ['Knowledge','Finesse'])` (tie → first listed).
- [ ] `[DATA+EXPR]` `max(1, actor.weapon.damage - 1)`.
- [ ] `[DATA+EXPR]` `list[riddleIdx % len(list)]` over a filtered ordered list (riddle cycling).
- [ ] `[DATA+EXPR]` conditional text: `flavor: if knowsCranks then A else B`; text interpolation `{cranksFound}/4`.

**Rules / combat (engine, not script — but required)**
- [ ] `[DATA]` Action-token pool (alive + 1), Fear-roll-ends-turn, token refresh, 4-Fear surge (or the SRD-faithful replacement the engine chooses).
- [ ] `[DATA]` Adversary features as data: *Entangle* (stacking slow, cleared at combat end), *Waking Nightmare* (50 %, range 5, Hope drain, self-heal, replaces attack), *Frozen* (skip activation).
- [ ] `[DATA]` Party-wide temporary buff with duration `until end of next enemy phase` (Shield Wall), `usesPerScene: 1` abilities, `usableOutOfCombat`.
- [ ] `[DATA]` Dormant enemies (visible, non-hostile until their group starts) that can still be damaged by AoE abilities — or an explicit decision to make dormant actors immune.
- [ ] `[DATA]` Movement rule `|Δh| ≤ 1`, difficult ×2, cover +2, high ground +1 — the pit puzzle (stairs = trigger) relies on the climb rule.
- [ ] `[DATA]` Fog wall rendering from `map.fog.band` (cosmetic, but the loop reads the same band).

**Content / assets**
- [ ] `[DATA]` Model keys referenced: heroes `battleMage|defender|frostMage|knight`, `body:<hero>` corpse variants, enemies `bramble|shadowHag`, nodes `gate|piano|floorboard|trunk|spectator|spotlight`, decos `throne|archfey|barrier|curtain|hut|tent|campfire|brazier|banner|crate|barrel|cart|dummy|deadTree|rock|spectator`.
- [ ] `[DATA]` Spirit-eye cosmetic (`spirit: 0|1|2`) on hero models; Hag/Archfey always 2.
- [ ] `[DATA]` Hover/inspect metadata for nodes (check trait/DC, pillar state, crank state) — game.js:804-816.

**Determinism / tests**
- [ ] `[DATA]` Named seeded RNG streams for: fog line, victim, pillar, nightmare proc, enemy d12, player duality dice (test resolver), enemy instance ids.

---

## 7. Behaviours that need a scripting hook (or a bespoke primitive) — and why

Ranked by how far they are from plain data. With the expression language of 5.3, **nothing in
this one-shot requires general-purpose scripting**; each item below lists the smallest primitive
that removes the need.

1. **Fog-loop mirror teleport (P1.4).** Arithmetic on coordinates (`w-1-x`, clamp). Options:
   (a) `teleport` effect with `mode: 'mirror'` + `inset`; (b) author a cell→cell warp table in
   the editor (136 band cells for the camp — tedious but pure data); (c) script. Recommend (a).
2. **Archfey act (P3.5).** Random victim, random lit pillar, nearest ally, `max(1, dmg-1)`,
   riddle cycling with modulo, reinforcement position by counter. All are one-line selectors;
   with `random/nearest/count/list[i % n]` in the expression language it is data. Without them
   it is the single strongest case for a script hook (`onEnemyPhaseStart`/`onFearRoll` handler
   with read access to actors/nodes/vars and an effect API).
3. **Spirit Blessings (2.2).** Legacy stores them as `async use(game, h)` functions. As
   abilities with the targeting shapes in 5.5 they are data; the odd one is Shield Wall's
   duration ("until end of next enemy phase"), which needs a status-duration enum value rather
   than a number.
4. **Align roll trait selection (P3.4).** `bestOf([...])` selector, otherwise script.
5. **Pillar state machine (P3.3).** Ordered guarded transitions on node state plus a derived
   count. A generic "state-machine interactable" primitive covers it; otherwise script.
6. **Body possession (P1.2).** Needs `spawnPartyMember` at a node's tile with patch data and
   node removal in one effect list; pure data once the effect exists.
7. **Hag → enemy swap (P2.5d).** `spawnEnemy(at: node.tile)` + `removeNode` + `startEncounter`;
   data.
8. **Restart rewind (1.5).** A declarative restart policy; data.

If the engine does add a script hook, the sandbox needs: read-only views of actors/nodes/vars/
RNG streams, the effect API of 5.2, no DOM/WebGL access (CONTEXT.md: engine core is DOM-free),
deterministic execution under Vitest.

---

## 8. Engine-side design notes drawn from the legacy

- The generic node flow in game.js (`interactNode` + `applyEffect` + `EFFECTS`) is already ~80 %
  of what the cranks need; the campaign hand-copied it only to add `incVar`/`setNodeState`
  effects and a conditional flavor text. Growing `EFFECTS` into an effect list (5.2) subsumes the
  copy.
- `onNodeInteract` running **before** the adjacency check is what lets spirits click bodies from
  nowhere; the port should make adjacency a per-node flag rather than a hook-order accident.
- Phase-3 "combat vs. exploration" is porous: pillars and the align roll work in combat without
  spending tokens, crank searches spend tokens. Model `actionCost` per interaction explicitly.
- `knowsCranks` is fully derivable (`mood == 'insulted' || mood == 'vengeful'`); keep it as a
  derived expression or drop it.
- `ref()` hover-flash is a genuinely good UX primitive; keep it as a first-class markup token.

---

## 9. Legacy bugs and quirks — with a port decision for each

CONTEXT.md asks for decisions, not questions. Each entry: what the code does, confidence, and
what the port should do.

| # | Finding | Evidence | Confidence | Port decision |
|---|---|---|---|---|
| **L1** | **Stale `this.party` after phase 1.** `this.party` is assigned only at lines 37, 73 and 150 (`= this.game.heroes` during phase 1). `Game.start` reassigns `this.heroes = []` and `addHero` pushes shallow copies. So phases 2 and 3 are both built from the **phase-1 hero objects**. Phase-2 mutations — `blessing = null` (deal), `weapon.dmg + 1` (Moon Staff), HP/Hope changes — live on phase-2 copies and are discarded when phase 3 starts: traded blessings come back, +1 damage vanishes, HP/Hope reset to end-of-phase-1 values (full HP, Hope 2). `restartPhase` heals the stale objects, which by accident is correct. | campaign.js:37/73/150, game.js:54-60, 75-90 | High (static); not runtime-verified | Implement the **intended** behaviour the texts and README describe: carry the live party forward; deal = blessings gone for phase 3; fight = +1 damage kept. Add a unit test "party state survives scene transition". |
| **L2** | **Soft lock after a chosen path + arena death.** After `deal` (or Moon Staff), the arena trigger stays live. Descend, fight the six brambles, die → `restartPhase` rebuilds `pitMap()` **without the portal**; hag says "cold patch" (mood set); `combatEnd(1)` is gated on `!mood`. No exit from phase 2. | campaign.js:206, 263, 58-63 | High (static) | On scene restart, re-derive spawned nodes from vars (`mood == 'insulted'` → portal at (6,17); `'vengeful'` → (2,11)); additionally disable `trig-arena` once `mood` is set (the arena is pointless afterwards and its only effect is L2). |
| **L3** | **No adjacency for bodies, gate, hag, portal.** Hook runs before the generic distance check; the campaign only checks distance for cranks/pillars. All four are clickable from anywhere on the map (the portal from the far rim, the hag from the spawn point). | game.js:351, campaign.js:142-195 | High | Bodies: keep no-adjacency (spirits are formless — intended). Gate/portal/hag: **require adjacency** (`requiresAdjacency: true`) — the texts ("Walk the party to the gate", "approach the figure") imply it. |
| **L4** | **Free actions in combat.** `pillarInteract` costs 0 tokens and rolls nothing; `alignRoll` costs 0 tokens and, on a Fear result in combat, does **not** call `enemyPhase` (crank search does). | campaign.js:333-376 vs 325-328 | High | Pillars: keep free (it is a flavourful puzzle action). Align: cost 1 token and `endsTurnOnFear: true` for consistency. Both become per-interaction flags either way. |
| **L5** | **Phase-2 Fear reaction is dead code.** `onFearRoll` fires only out of combat; the pit has no check nodes, `attack()` refuses outside combat, hag/portal are choice-only. The "Oh, do that again." line can never print. | game.js:340, 500-504; campaign.js:435-437 | High | Drop it, or attach it to *in-combat* Fear rolls during the arena fight (a nicer use of the line). Decision: attach to in-combat Fear rolls in the arena encounter only. |
| **L6** | **Hardcoded `(2,11)`** for the Moon Staff portal instead of a named constant. | campaign.js:282 | Certain | Name it `PIT_PORTAL_TIER` in content. |
| **L7** | `pendingFightPath` written, never read. | campaign.js:233 | Certain | Drop. |
| **L8** | `knowsCranks` redundant with `mood`; `!knowsCranks` in P3.5a is always true when `mood == 'entertained'`. | campaign.js:223/276/387 | Certain | Keep as derived expression. |
| **L9** | **Blessings work out of combat and hit dormant enemies.** From the seating tier at e.g. (8,4), Cinder Nova reaches the bramble at (8,6) (Manhattan 2) before the arena starts. `damageEnemy` never checks combat state. Not a soft lock (at most one or two brambles are within 3 of any tier tile), but it lets the party pre-thin the arena and the theater ambush. | game.js:697-723, data-campaign.js:50-53 | High | Engine decision: dormant (non-hostile) actors are **immune to damage** until their encounter starts. Keep blessings usable out of combat for Hearthlight. |
| **L10** | Hag can be re-approached indefinitely after `leave`; the full pitch cutscene replays. | campaign.js:206-217 | Certain | Second visit shows the choice dialog only (skip the pitch) — a `visited` node flag. |
| **L11** | Riddle order is not strictly sequential: `riddleIdx` keeps growing while `hidden` shrinks, so after a crank is found the modulo can skip or repeat riddles. | campaign.js:388-391 | Certain | Acceptable; keep cycling but reset the index when the hidden list changes, so every remaining riddle is heard in order. |
| **L12** | Followers can be left inside the fog band when the leader loops (only the mover is checked). | campaign.js:445-459, game.js:209-211 | High | Apply the region trigger to every party member that ends a move inside the band. |
| **L13** | Puppet strike damage on the vengeful path is `weapon.dmg + 1 − 1` = base damage (3-4), so the "punishment" is harsher after the Moon Staff. | campaign.js:277, 419 | Certain | Keep — thematically right ("that staff makes you gods?"). |
| **L14** | Raw HTML inside content strings (`<b>`, `<i>`, one `<span class="ref">` at 153) mixed with `esc()`. | campaign.js:153 etc. | Certain | Convert to safe markup tokens in the port; never render content as HTML. |
| **L15** | `enemy-<random>` ids make encounter members non-addressable across saves. | data.js:144 | Certain | Stable authored ids (`pit-bramble-1`…). |

---

## 10. What could not be verified

- Nothing was executed; every runtime claim (including L1 and L2) is from reading the code. L1
  in particular should be confirmed by a 5-minute manual run of `legacy/start.bat` before anyone
  relies on it as a reason to change carry-over semantics — the port decision above is correct
  either way, because it implements the documented intent.
- The exact visual behaviour of `setPillarLit` (beam/lens materials) and the fog sprites is
  described from grid.js:526-539 and 268-298 without rendering.
- Whether the physics dice ever produce a pathological result (e.g. a die off the table) that
  `actionRoll` handles specially — dice.js was only skimmed for `roll()`/`active`.
- The legacy README says flashback text was originally Portuguese and later translated; the
  strings in data-campaign.js are English (checked). Whether any other locale artefacts remain
  elsewhere in `legacy/` was not searched.

---

## Appendix A — Quick reference: state transitions of the branch variable

```
mood = null ──(arena cleared, P2.3)──────────▶ 'entertained'  → riddles + pillar sabotage; no ambush
          ├──(hag deal, P2.5c)───────────────▶ 'insulted'     → knowsCranks; blessings gone; ambush + puppet strikes + reinforcements
          └──(hag slain, P2.6)───────────────▶ 'vengeful'     → knowsCranks; +1 weapon dmg; ambush + puppet strikes + reinforcements
Phase 3 opening / ending text keyed by mood; default 'entertained' if somehow null (campaign.js:104, 464).
```

## Appendix B — Quick reference: phase-3 puzzle state

```
cranksFound 0..4 (progress)   cranksHeld 0..4 (inventory; −1 per pillar insertion)
pillar: {inserted:false, lit:false} → insert (needs cranksHeld>0) → {true,true}
        {true,true} ──sabotage (entertained path, random lit pillar)──▶ {true,false} ──re-crank (free)──▶ {true,true}
count(lit) == 4 → align check (bestOf(Knowledge,Finesse) vs DC 13) → success: finale; fail: click any lit pillar to retry
```
