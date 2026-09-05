# Legacy prototype research: `legacy/js/game.js` + `legacy/js/data.js`

Research document for the PolyHeart Engine port. Everything below was obtained by **static reading** of the
legacy sources; nothing was executed. Where a claim depends on runtime behaviour it is marked *unverified*.

## 0. Scope and method

| File | Coverage |
|---|---|
| `legacy/js/game.js` (862 lines) | Read in full. Primary subject. |
| `legacy/js/data.js` (238 lines) | Read in full. Primary subject. |
| `legacy/js/campaign.js` (480), `data-campaign.js` (411) | Read in full — they are the only consumers of the hooks API and define the "scripted" node shapes. |
| `legacy/js/grid.js` (685), `editor.js` (355), `ui.js` (242), `dice.js` (355), `main.js` (176), `scene.js` (124) | Read in full — needed for pathfinding rules, map schema, UI/dice contracts and lifecycle wiring. |
| `legacy/js/models.js` (508) | Lines 440–508 read (registry, `buildModel`, `DECO_TYPES`, `DECO_INFO`); rest grepped only. |
| `legacy/index.html` | Grepped for element ids and tool buttons only. |
| Daggerheart SRD (local copies in scratchpad) | Grepped to confirm the rule facts cited in §11. |

**TTS/voice negative, verified:** `grep -rniE "speech|tts|voice|utter|piper|audio"` over `legacy/` matches only
narrative prose ("a bored voice sighs", "her voice is dry leaves on stone"). There is no Web Speech, `<audio>`,
or narration code anywhere in the prototype. `legacy/README.md:12` says "flashback (PT)" but every flashback string
in `data-campaign.js:101-134` is English; the "(PT)" label is vestigial.

Line references below are `file:line` into `legacy/js/` unless stated otherwise.

---

## 1. `Game` object: state and lifecycle

### 1.1 Constructor state (`game.js:14-25`)

```js
constructor(sm, grid, dice, ui)      // SceneManager, GridWorld, DiceManager, UI — all DOM/WebGL objects
this.mode = 'idle';                  // 'idle' | 'explore' | 'combat'
this.busy = false;                   // input gate while animations/rolls run
this.fear = 0;                       // GM Fear pool, 0..12
this.heroes = [];                    // live hero objects (see §8.1)
this.selected = null;                // hero id
this.activeGroup = null;             // encounter group number in combat
this.tokens = 0;                     // shared action-token pool
this.running = false;
```

Fields assigned later and never declared in the constructor: `sourceJson`, `opts`, `hooks`, `map`, `keys` (Set),
`flags` (Set), `shieldWall` (boolean set by a blessing closure; `undefined` until first combat).

### 1.2 `start(map, opts = {})` (`game.js:29-72`)

`opts` shape (union of everything read from it across `game.js` and `main.js`/`campaign.js`):

```ts
{
  party?: HeroDef[]        // defaults to HERO_DEFS; campaign passes live hero objects to carry state
  noSpawn?: boolean        // campaign phase 1: spirits, no heroes yet
  hooks?: Hooks            // §7
  onRestart?: () => void   // replaces the default "reparse sourceJson and start again"
  quietIntro?: boolean     // skip clearLog/header/intro
  keys?: Set<string>       // party keys, shared object across scenes
  flags?: Set<string>      // story flags, shared object across scenes
  onGoto?: (sceneId: string) => void   // scene transition (main.js:64-73); synchronous
}
```

Sequence: `sourceJson = JSON.stringify(map)` (for restart) → `grid.build(map)` → `rebuildMarkers(false)` →
`sm.focusMap(w,h)` → reset `fear=0, mode='explore', busy=false, running=true, activeGroup=null, tokens=0` →
`keys = opts.keys || new Set()`, `flags = opts.flags || new Set()` → build an enemy token for every enemy with
`hp > 0` → spawn party: `defs.forEach((d,i) => addHero(d, spawns[i % spawns.length] || [1,1]))` → `selected =
heroes[0].id` → intro log unless `quietIntro` → badge `EXPLORATION` → `refreshHud()`.

Notable consequences:

- **Fear resets to 0 on every scene start**, including campaign portal transitions. Keys, flags and the party
  carry across scenes; Fear does not. (The SRD says Fear carries over; see §11.)
- `start()` mutates the `map` object it is given. In play mode `main.js:56` deep-clones the campaign scenes once
  per `enterPlay()`, so **revisiting a scene through a portal shows its mutated state** (dead enemies get no token,
  opened doors stay open, `trigger.fired` stays true). This is accidental scene persistence, not designed.
- `restart()` (`game.js:92-95`) calls `opts.onRestart()` if present, else `start(JSON.parse(sourceJson), opts)`.
  With `opts.party` set to live hero objects, `addHero` revives the dead (`hp <= 0 → maxHp`) and keeps wounds on
  survivors (`game.js:80`).

### 1.3 `addHero(def, x, y, {quiet})` (`game.js:75-90`)

```js
const h = { ...def, traits: { ...def.traits },
  hp: def.hp !== undefined && def.hp > 0 ? def.hp : def.maxHp,
  hope: def.hope !== undefined ? def.hope : 2,
  slow: 0, x, y };
```

Pushes to `heroes`, builds the 3D token, selects it if nothing is selected. Used mid-scene by the campaign when a
spirit inhabits a body (`campaign.js:149`).

### 1.4 `stop()` (`game.js:97-101`): `running=false; mode='idle'; grid.clearReachable()`. Used when entering the editor.

---

## 2. The explore / combat state machine

`mode` has three values but the transitions are scattered across nine call sites rather than centralised.
Two extra gates (`busy`, `dice.active`) block all input (`handleClick`, `handleHover`, `useBlessing`).

| From | To | Where | Condition |
|---|---|---|---|
| any | `explore` | `start()` `game.js:39` | scene (re)start |
| any | `idle` | `stop()` `game.js:99` | editor entered |
| `explore` | `combat` | `moveHero` → `enterCombat(trigger)` `game.js:207,471` | leader's path crosses an unfired trigger cell whose group has a living enemy (`triggerAt`, `game.js:278-283`); path is truncated at that cell (`game.js:190`) |
| `explore` | `combat` | `applyEffect('spawnGroup')` `game.js:433-435` | node outcome; only if `mode !== 'combat'` and the group has a living enemy; 300 ms delay |
| `explore` | `combat` | campaign: `game.enterCombatGroup(group, introHtml)` `campaign.js:128,241` | scripted (Hag fight, hostile theatre) |
| `combat` | `explore` | `attack` → `endCombat()` `game.js:540` | `activeEnemies().length === 0` after a hit |
| `combat` | `explore` | `useBlessing` → `endCombat()` `game.js:711` | blessing killed the last active enemy |
| `combat` | `explore` | `enemyPhase` after `onEnemyPhaseStart` `game.js:556` | hook may have changed `mode`; phase aborts (`busy=false; return`) |
| `combat` | `explore` | `onGoto` from a portal/`goto` effect while in combat | `start()` of the next scene — an unintended escape hatch (no token cost: the token check at `game.js:390` comes *after* the `goto` branch at `:369`) |

Things that do **not** change mode: hero death (dead heroes stay in `heroes` with `hp <= 0`), party wipe
(`ui.showEnd(false)` modal; mode remains `combat` until restart), killing a *dormant* enemy of another group.

Combat-only sub-state: `activeGroup` (number), `tokens` (§4), `shieldWall`, per-hero `slow`, per-enemy `frozen`.

**Quirk:** `attack()` checks `mode === 'combat'` and `e.hp > 0` but **not** `e.group === activeGroup`
(`game.js:496-505`), so during combat the party may attack dormant enemies from other groups. Their deaths do not
end the fight (only `activeEnemies()` is checked) but do count toward the "all enemies dead" victory test.

**Verdict — GENERALIZE.** Port the *semantics* (explore ↔ encounter, triggers, spawn-group effect, end-of-encounter
hooks) into an explicit, testable finite-state machine in the DOM-free engine core with a single `transition()`
entry point and events (`encounter:start`, `encounter:end`, `scene:start`). Do not port the implicit,
call-site-scattered transitions, the `busy` flag (replace by a command queue), or the cross-group attack quirk.

---

## 3. `actionRoll` — the duality roll (`game.js:287-344`)

Signature and result:

```ts
async actionRoll({ hero, trait, dc, title, flavor, bonus = 0 }): Promise<RollResult | null>

type RollResult = {
  category: 'crit' | 'hopeSuccess' | 'fearSuccess' | 'hopeFail' | 'fearFail',
  crit: boolean, success: boolean,
  withHope: boolean,        // hope > fear  (FALSE on a crit — dice are equal)
  withFear: boolean,        // !withHope && !crit
  hope: number, fear: number, mod: number, total: number, dc: number,
}
```

Algorithm, in order:

1. `baseMod = (hero.traits[trait] ?? 0) + bonus`.
2. `ui.askRoll({ title, flavor, trait, mod: baseMod, dc, canSpendHope: hero.hope > 0 })` → `{ go, spendHope }`.
   `!go` → return `null` (caller treats as cancelled: no token, no state change).
3. If `spendHope`: `hero.hope--; mod += 2` (flat +2, no Experience concept).
4. `busy = true`; `{hope, fear} = await dice.roll()` — **physics**: two cannon-es d12s flung by the player;
   values read from the face normals after settling (`dice.js:319-349`). Non-deterministic by design.
5. `total = hope + fear + mod; crit = hope === fear; success = crit || total >= dc; withHope = hope > fear`.
6. Bookkeeping (`game.js:308-310`): crit → `hero.hope = min(hope+1, 6)`; else withHope → same; else
   `this.fear = min(fear+1, 12)`. So exactly one of {hero +1 Hope, GM +1 Fear} happens per roll.
7. `dice.showResult(labelHtml, cls)`; `ui.log(...)` with `ui.rollDetail`; a "gains 1 Hope"/"GM gains 1 Fear" line.
8. `refreshHud()`; `await 1100 ms`; `busy = false`.
9. If `withFear && mode !== 'combat' && hooks.onFearRoll` → `await hooks.onFearRoll(result)`. **In combat the
   Fear hook is not called**; the caller instead starts `enemyPhase()`.

Labels: `CRITICAL SUCCESS!`, `SUCCESS with HOPE`, `SUCCESS with FEAR`, `FAILURE with HOPE`, `FAILURE with FEAR`
(`game.js:312-318`). Log css classes: `'hope' | 'fear'`.

Callers: `interactNode` (`game.js:392`), `attack` (`:517`), campaign `crankInteract` (`campaign.js:302`) and
`alignRoll` (`:368`). Every caller maps `crit` onto the `hopeSuccess` branch (`game.js:401`); there is no separate
crit outcome slot.

**Verdict — KEEP the core (2d12 + trait vs Difficulty, matching dice = crit, Hope/Fear caps 6/12, Hope +1 on
Hope rolls, Fear +1 on Fear rolls, cancel-before-roll) — it matches the SRD.** GENERALIZE the rest: the flat
"+2 for a Hope" should become the SRD Experience mechanic (spend Hope → add an Experience modifier) and Help an
Ally (advantage d6); add advantage/disadvantage d6, Stress clear on crit, and make `withHope` true on a crit (the
SRD states a crit "counts as a roll with Hope"; the legacy flag is false and callers patch around it). DROP the
physics dice as the *source of truth*: the engine core must roll from a seeded RNG (CONTEXT.md requirement) and the
3D dice become a presentation that is *driven to* the rolled faces (or purely cosmetic). DROP the hard-coded
1100 ms pause inside the rules function.

---

## 4. Action-token pool (`maxTokens`, `tokens`)

- `maxTokens() = heroes.filter(h => h.hp > 0).length + 1` (`game.js:119`).
- Filled on `enterCombatGroup` (`:479`) and at the end of every `enemyPhase` (`:644`). Zero outside combat; HUD pips
  only shown in combat (`refreshHud` → `ui.renderTokens(tokens, max, mode === 'combat')`).
- Costs 1 token each: `moveHero` (`:202`, after the move completes), `attack` (`:524`, after the roll — a cancelled
  roll costs nothing), `interactNode` skill check (`:399`, after the roll), `useBlessing` (`:702`), campaign
  `crankInteract` (`campaign.js:310`). **Costs 0:** travelling through a portal, right-click inspect, selecting a
  hero, node interactions consumed by `onNodeInteract` (the campaign re-implements the cost itself).
- Pre-checks: `moveHero`, `interactNode`, `attack`, `useBlessing` all refuse when `tokens <= 0` in combat.
- **Enemy phase triggers** (README "Action Tracker, not initiative"): (a) pool reaches 0 after an action
  (`'The party is spent.'`), or (b) **any roll with Fear** (`attack :541`, `interactNode :409`, campaign
  `:326`). A blessing never triggers the phase by Fear (no roll). A *failure with Hope* does not hand over the turn.
- No per-hero action limit: one hero may spend the entire pool.

**Verdict — GENERALIZE.** The SRD core has no initiative and no token pool: the spotlight passes to the GM when a
player rolls with Fear or fails, and the GM may also spend Fear to seize it. The core-book "Action Tracker" is an
*optional* rule (not present in the local SRD copies — *unverified*). Implement turn economy as a pluggable
policy (`spotlight` default per SRD; `actionTracker` variant preserving the legacy pool = alive+1, cost table as
data). Keep "roll with Fear ends the party's initiative" as the default policy's behaviour since it is SRD-aligned.

---

## 5. Enemy phase AI (`enemyPhase(reason)`, `game.js:546-650`)

```
busy = true; clearReachable(); logHeader('ENEMY PHASE'); log(reason,'fear'); wait 500 ms
await hooks.onEnemyPhaseStart?.()            // may end combat → if mode !== 'combat': busy=false; return
surge = 0; if (fear >= 4) { fear -= 4; surge = 2; log('...spends 4 Fear... +2 to enemy attacks') }
for e of activeEnemies():                    // evaluated AFTER the hook, so enemies the hook spawned act this phase
  alive = heroes with hp > 0; if none: break
  if e.frozen: e.frozen = false; log; continue                                   // Hoarfrost Bind: skip one activation
  if e.special === 'nightmare' && Math.random() < 0.5:                           // Shadow Hag
      victims = alive with manhattan(e) <= 5 && hope > 0
      if victims: each -1 Hope; e.hp = min(e.hp+1, e.maxHp); log; wait 350 ms; continue
      // no victims → falls through to a normal attack
  sort alive by manhattan distance to e (ascending); target = alive[0]          // tie-break: Array.sort stability → party order (unverified)
  atkRange = e.range || 1
  if dist > atkRange:
      reach = findReachable(grid, e, e.speed, occupiedSet(e.id), blockedNodeSet())
      best = reachable cell minimising manhattan(target); must be strictly < current dist;
             ties broken by lower path cost                                     // game.js:601-608
      if best: hopAlong(smoothPath(tracePath(...))); e.x,e.y = best; dist recomputed
  if dist <= atkRange && target.hp > 0:
      bumpAttack anim
      roll = d12 (Math.random)                                                   // NOT duality dice, NOT the SRD d20
      needed = target.evasion + (target tile prop==='cover' ? 2 : 0) + (shieldWall ? 2 : 0)
      total  = roll + e.atkMod + surge
      hit if total >= needed → damageHero(target, e.dmg, e.name)
          if e.special === 'entangle' && target.hp > 0: target.slow += 1 (stacking, -1 speed each; min speed 1)
      else log miss with "roll + mod = total vs Evasion needed"
  wait 250 ms
shieldWall = false                     // blessing lasts exactly one enemy phase
busy = false
if all heroes dead: return             // defeat modal already shown by damageHero
tokens = maxTokens(); logHeader('PARTY PHASE'); refreshHud(); showMoveRange()
```

Facts worth preserving in the port's tests:

- **Targeting** is nearest living hero by Manhattan distance, recomputed per enemy after earlier enemies moved.
  No threat, no focus fire, no line of sight, no flanking.
- **Ranged enemies** (only `shadowHag`, `range: 4`) advance until `dist <= range` and never retreat or kite. Attacks
  pass through walls: there is no LOS test anywhere (`findReachable` is only used for movement).
- **Movement** uses the same `findReachable` as heroes (4-neighbour, |Δh| ≤ 1, difficult ×2, budget = `e.speed`),
  blocked by *all* living heroes and enemies (any group) and by non-open nodes.
- **Cover** and **Shield Wall** each add +2 to the number needed; **high ground gives enemies nothing** (heroes
  get +1 at `game.js:513`).
- **Fear surge**: automatic, spends exactly 4 Fear once per phase for a flat +2 to every enemy attack; no other Fear
  spend exists. With Fear capped at 12 and +1 per Fear roll, a surge happens roughly every 4 Fear rolls.
- **Specials** are string-keyed (`'entangle' | 'nightmare'`) and hard-coded in `enemyPhase` and the inspector text
  (`game.js:792-795`). `frozen` is a third, unnamed special set only by the Hoarfrost Bind blessing
  (`data-campaign.js:74`); it is **not** cleared by `endCombat`, so a frozen enemy of a dormant group stays frozen
  until it next activates.
- **Slow** is cleared for all heroes at `endCombat` (`game.js:675`) and by the campaign at phase start.
- Delays: 500 ms phase start, 350 ms after a Nightmare, 250 ms after each enemy.

**Verdict — GENERALIZE (heavily).** Keep as a *baseline behaviour profile* ("melee brute: approach nearest, attack")
that the engine can express in data, but the new adversary model must follow the SRD stat block: `Difficulty`,
`Thresholds` (Major/Severe), `HP`, `Stress`, `ATK` bonus rolled on **d20**, attacks with range *bands* and damage
*dice*, `Motives & Tactics`, and Features (Passive / Action / Reaction / **Fear Feature** with explicit Fear cost)
loaded from content JSON — e.g. SRD Tangle Bramble is "Tier 1 Minion, Difficulty 11, HP 1, Stress 1, ATK −1,
Thorns: Melee 2 phy, Minion (4), Group Attack (Spend a Fear), Drain and Multiply". `entangle`/`nightmare`/`frozen`
become generic *conditions* (`Restrained`/`Vulnerable`-style status effects with duration) and *feature scripts*
selected by id, not string switches in the phase loop. The automatic "4 Fear → +2" surge should be DROPPED in favour
of the GM-AI choosing Fear Features / GM moves from a budget. Add LOS and range bands (§11). The nearest-target
heuristic can stay as the default tactic, driven by `Motives & Tactics` tags later.

---

## 6. Node interaction and effects

### 6.1 `interactNode(node)` (`game.js:347-413`) — check order matters

1. `h = selectedHero()` (may be `undefined`).
2. `if (hooks.onNodeInteract && await hooks.onNodeInteract(node, h)) return;` — **scripted nodes get first refusal
   before any adjacency/hero check** (spirits with no body click corpses).
3. `if (!h) return;`
4. `if (!node.outcomes && node.goto == null) return;` — model-only scenery node (e.g. campaign gate before it is scripted).
5. Adjacency: `manhattan(h, node) > 1` → log "too far", `grid.flash(node.id)`, return. (Diagonal = distance 2 = too far.)
6. `node.requireKey && !keys.has(requireKey)` → log `lockedText || "It will not yield. You need: <key>."`, flash, return.
   Applies to portals too, so keyed gates work.
7. Travel node (`node.goto` non-empty): if no `opts.onGoto` → "hums, but leads nowhere"; else
   `ui.askChoice({title: node.name, html: flavor || 'Step through?', options: [Travel onward / Stay]})` →
   `opts.onGoto(node.goto)`. **No roll, no token, allowed mid-combat.** Return.
8. `node.used` → "has given all it has", return.
9. Combat and `tokens <= 0` → return.
10. `actionRoll({ hero: h, trait: node.trait, dc: node.dc, title: `${name} — ${trait} DC ${dc}`, flavor })`;
    `null` → return.
11. Combat → `tokens--`.
12. `key = category === 'crit' ? 'hopeSuccess' : category; outcome = node.outcomes[key]`; log `outcome.text`
    (class `narration` on Hope/crit, `fear` otherwise).
13. `mapBefore = this.map; await applyEffect(node, h, outcome, result); if (this.map !== mapBefore) return;` —
    re-entrancy guard: a `goto` effect calls `opts.onGoto` **synchronously**, which runs `game.start()` for the next
    scene *while this call is still on the stack*.
14. Combat: `withFear` → `enemyPhase('Your moment of weakness invites them in.')`; `tokens <= 0` → `enemyPhase('The
    party is spent.')`. Else `refreshHud()`.

### 6.2 `applyEffect(node, hero, outcome, result)` (`game.js:415-468`)

`effect = typeof outcome === 'string' ? outcome : outcome.effect; param = outcome.param || ''` (the string form is
vestigial: `interactNode` already read `outcome.text`, which would be `undefined` for a string).

| effect | param | Behaviour | sets `node.used`? |
|---|---|---|---|
| `none` (or unknown) | — | nothing | **no** → node can be retried indefinitely |
| `open` | — | `node.open = true`; `grid.animateNodeOpen`; `showMoveRange()` (doors stop blocking) | yes |
| `loot` | — | as `open` + `hero.hope = min(+1, 6)` + log a random flavour item from `ITEMS` (6 strings, `game.js:11`) — **no inventory, nothing stored** | yes |
| `damage` | — | `damageHero(hero, 2, node.name)` (flat 2, can kill) | **no** |
| `removeNode` | — | `grid.animateNodeDestroy`; `map.nodes = nodes.filter(n => n.id !== node.id)`; `showMoveRange()` | yes |
| `giveKey` | key name | `keys.add(param)` (+ log) if not held | yes |
| `setFlag` | flag name | `flags.add(param)` | yes |
| `spawnGroup` | group # (`parseInt(param) || 1`) | if not in combat and group has a living enemy: wait 300 ms, `enterCombatGroup(grp)` (does **not** mark the group's trigger `fired`) | yes |
| `goto` | scene id | `opts.onGoto(param)` or "leads nowhere" log; **returns early, skipping `refreshHud`** | yes |

`EFFECTS` (`data.js:6-16`) is the editor palette for these with `needsParam`/`hint` metadata.
**`flags` are write-only**: nothing in the engine or campaign ever reads `game.flags`; `requireKey` is the only
condition gate that exists.

`defaultOutcomes(type)` (`data.js:59-87`) gives chest = loot/loot/none/damage, door = open/open/none/none,
pillar = removeNode/removeNode/none/damage, default = all `none`. Note "fearSuccess" still *succeeds* — the Fear
cost is only the GM Fear point and (in combat) the enemy phase.

**Verdict — GENERALIZE into a data-driven interaction system.** Keep the four-outcome shape (`hopeSuccess |
fearSuccess | hopeFail | fearFail`, plus add an explicit `crit` slot that defaults to `hopeSuccess`), the
adjacency rule, the key gate, and the "effects list" idea. Replace the single `{effect, param}` with an
**array of typed effect commands** validated by zod (`giveItem`, `setFlag`, `startEncounter`, `travel`, `open`,
`damage {amount|dice, type}`, `removeNode`, `grantHope`, `markStress`, `runScript`…), add **conditions**
(`requireFlag`, `requireItem`, `requireNotUsed`, trait/level gates) so flags become readable, and make `loot`
produce a real inventory item. DROP: the vestigial string-outcome form, the random `ITEMS` table, the synchronous
`onGoto` re-entrancy (make `travel` an event the scene runner handles after the interaction resolves), the
"portal costs no token / usable in combat" loophole (make it a scene-runner policy).

### 6.3 Movement-side node rules

- `blockedNodeSet()` (`game.js:138-145`): **every node blocks movement except an open door** — chests, pillars,
  portals, campaign bodies, the model-less Hag node, spotlight pillars.
- Triggers: `triggerAt(x,y)` (`:278`) — first trigger with `!fired` whose `cells` contain the tile **and** whose
  `group` still has a living enemy. `trigger.once` is never read; `fired` is the real flag. Followers stop short of
  trigger cells (`:259-261`); the leader's path is cut at the first trigger cell (`:188-191`).

---

## 7. Hooks / callback surface

### 7.1 `opts.hooks` (`game.js:32`, consumed at 5 sites)

| Hook | Signature | Fires when | Effect of return |
|---|---|---|---|
| `onNodeInteract(node, hero \| undefined)` | `→ Promise<boolean>` | first line of `interactNode`, before any check | truthy = interaction consumed; engine does nothing else |
| `onHeroMoved(hero)` | `→ Promise<void>` | `moveHero` after the move, **both modes**, but only if the move did **not** trigger combat (`:207` returns first) and, in combat, only if tokens remain (`:204` returns first). After `followParty` in explore. | ignored |
| `onFearRoll(result)` | `→ Promise<void>` | end of `actionRoll` when `withFear && mode !== 'combat'` | ignored |
| `onEnemyPhaseStart()` | `→ Promise<void>` | start of `enemyPhase` after the 500 ms delay, before surge/enemies | if it leaves `mode !== 'combat'` the phase aborts |
| `onCombatEnd(group)` | `→ any` | end of `endCombat` after Hope +1 and HUD refresh | **its return value is returned by `endCombat` and the "all enemies dead → victory / area silent" logic is skipped whenever the hook exists** (`game.js:683`) |

### 7.2 `opts` callbacks and the campaign's direct backdoors

`opts.onGoto(sceneId)` (sync, `main.js:64-73`: finds scene by id in the cloned array, logs `SCENE CHANGE`, calls
`startScene(target, game.heroes)`), `opts.onRestart()` (`campaign.js:58-63`: heals party to `maxHp`, Hope 2,
`slow 0`, re-runs the phase with `keepLog`).

`campaign.js` does not restrict itself to the hooks; it reaches into engine internals. Complete list, because each
one is a capability the new engine must expose *properly*:

- Mutates content in place: `game.map.nodes = game.map.nodes.filter(...)`, `.push(gate | portal)`,
  `game.map.enemies.push(makeEnemy(...))` (`campaign.js:147,157,237-238,252,424-425`).
- Calls the renderer directly: `grid.rebuildNodes()`, `grid.buildNode(n)`, `grid.buildEnemyToken(e)`,
  `grid.flash(id)`, `grid.setPillarLit(node, bool)`, `grid.bumpAttack(id, x, y)`, `grid.heroTokens.get(id)` +
  `grid.placeToken(g, x, y)` (teleport, `:455-456`).
- Calls engine methods: `game.addHero`, `game.enterCombatGroup(group, introHtml)`, `game.actionRoll`,
  `game.enemyPhase(reason)`, `game.damageHero`, `game.damageEnemy`, `game.refreshHud`, and mutates `game.tokens--`,
  `game.shieldWall = true` (via blessing), `e.frozen = true`, `h.weapon = {...h.weapon, dmg: +1}`,
  `h.blessing = null`, `h.hp/hope/slow`.
- Calls UI directly: `ui.story`, `ui.askChoice`, `ui.log`, `ui.logHeader`, `ui.setContext`, `ui.setBadge`,
  `ui.clearLog`, `ui.showEnd`.
- Reads `game.mode`, `game.tokens`, `game.heroes`, `game.map.nodes/enemies`.

Blessings (`data-campaign.js:45-85`) are **code-in-data**: `{ name, desc, async use(game, hero) }` closures that
call `damageEnemy`, heal, set `frozen`, set `shieldWall`. They cannot be serialised.

**Verdict — GENERALIZE into an event bus + command API; DROP the closure/direct-mutation form.** The five hooks
map cleanly onto engine events (`node:interact` (cancellable), `actor:moved`, `roll:resolved` (all categories,
both modes — let the listener filter), `encounter:phaseStart`, `encounter:end`). Everything the campaign did via
backdoors becomes a documented command (`spawnActor`, `removeNode`, `addNode`, `teleport`, `applyCondition`,
`modifyStat`, `startEncounter`, `travel`, `showStory`, `askChoice`) so that scripted content is JSON + a small
sandboxed script layer, and never touches the renderer. Blessings become Domain-card-like *abilities* defined in
data with effect commands. `onCombatEnd`'s "presence suppresses victory" semantics must not be ported — victory /
scene-objective rules belong to the scene data.

---

## 8. Data shapes

### 8.1 Hero

Static definition (`data.js:18-37`, `data-campaign.js:10-41`):

```ts
type HeroDef = {
  id: string; name: string; class: string;   // class is a display string only ('Sentinel', 'Battle Mage'…)
  color: string /* css hex */; model: keyof MODELS;
  traits: { Agility: number; Strength: number; Finesse: number; Instinct: number; Presence: number; Knowledge: number };
  maxHp: number; evasion: number; speed: number;    // speed = tiles per combat move
  weapon: { name: string; trait: TraitName; dmg: number; range: number /* Manhattan tiles */ };
  heroKey?: string;                                  // campaign: 'battleMage'|'defender'|'frostMage'|'knight'
};
```

Runtime additions (`addHero`, campaign): `hp`, `hope` (0..6, default 2), `slow` (≥0), `x`, `y`, `spirit?: 1`,
`blessing?: {name, desc, use}`, `blessingUsed?: boolean`.

| Hero | Class | Traits (Agi/Str/Fin/Ins/Pre/Kno) | HP | Ev | Spd | Weapon |
|---|---|---|---|---|---|---|
| Kara | Sentinel | 0/2/0/1/1/−1 | 7 | 11 | 4 | Greatblade, Strength, 4 dmg, range 1 |
| Finn | Nightwalker | 2/−1/2/1/0/0 | 5 | 13 | 5 | Shortbow, Finesse, 3, range 4 |
| Mira | Seer | 0/−1/1/2/2/1 | 5 | 12 | 4 | Spark Staff, Instinct, 3, range 3 |
| Ardyn | Battle Mage | 0/0/−1/1/1/2 | 5 | 11 | 4 | Emberbolt, Knowledge, 3, range 4 |
| Tomé | Village Defender | 1/1/0/1/2/−1 | 6 | 12 | 4 | The Arcane Stick, Presence, 3, range 2 |
| Iskra | Frost Mage | 0/−1/1/2/0/1 | 5 | 12 | 4 | Frost Lance, Instinct, 3, range 4 |
| Bram | Vanguard Knight | 1/2/0/0/1/−1 | 8 | 13 | 3 | Tower Blade, Strength, 4, range 1 |

Absent vs the SRD PC sheet: level, ancestry/community, class/subclass *mechanics*, Stress, damage thresholds,
Armor score/slots, Proficiency, Experiences, domain cards, equipment beyond one weapon, conditions, gold.

### 8.2 Enemy

```ts
type EnemyType = { type: string; name: string; model: string; maxHp: number; difficulty: number;
                   atkMod: number; dmg: number; speed: number; range: number; special?: 'entangle'|'nightmare' };
// makeEnemy(x, y, group, type='husk')  → { id: 'enemy-'+rand6, ...ENEMY_TYPES[type], hp: maxHp, x, y, group }
// runtime: frozen?: boolean
```

| type | name | HP | Difficulty | atkMod | dmg | speed | range | special |
|---|---|---|---|---|---|---|---|---|
| husk | Hollow Husk | 5 | 13 | +2 | 2 | 3 | 1 | — |
| bramble | Tangle Bramble | 3 | 12 | +1 | 2 | 2 | 1 | entangle |
| shadowHag | Shadow Hag | 14 | 14 | +3 | 3 | 3 | 4 | nightmare |

`ENEMY_TEMPLATE = ENEMY_TYPES.husk`. Only *Tangle Bramble* exists in the SRD adversary list (as a Tier 1 Minion —
see §5); Hollow Husk and Shadow Hag are homebrew. "archfey" is a model/deco, never an enemy.

### 8.3 Node (two incompatible shapes)

Editor node (`makeNode`, `data.js:89-113`):

```ts
type EditorNode = {
  id: 'node-'+rand6; type: 'chest'|'door'|'pillar'|'portal'; x: number; y: number;
  name: string; flavor: string; trait: TraitName; dc: number /* default 12 */;
  outcomes: Record<'hopeSuccess'|'fearSuccess'|'hopeFail'|'fearFail', { text: string; effect: EffectKey; param?: string }>;
  open: boolean; requireKey: string; lockedText: string; goto: string | null;
  model?: 'gate';                      // portal only
  used?: boolean; rot?: number;        // runtime / optional
};
```

Scripted node (`data-campaign.js`, `campaign.js` — `type: 'scripted'`, no `outcomes`, identified by ad-hoc fields):

| Field | Meaning |
|---|---|
| `heroKey` | a corpse; clicking runs the flashback and `addHero` (`campaign.js:142-166`) |
| `hagNode: true` | the Hag encounter dialogue (`:182`) |
| `id === 'gate'`, `id === 'portal'` | scene-advance choices (`:168,184`) |
| `crank: true, trait, dc, foundText, found?` | a search check that yields a crank (`:198, 292-329`) |
| `pillar: true, lit, inserted?` | spotlight pillar puzzle state (`:199, 333-361`) |
| `model` | any `MODELS` key, or `'body:<heroModel>'` (`models.js:474`), or `null` (invisible but still blocks movement) |

### 8.4 Trigger, deco, spawn

```ts
type Trigger = { id: 'trig-'+rand6; group: number; once: true /* never read */; cells: [number, number][]; fired?: boolean };
type Deco    = { type: DecoType; x: number; y: number; rot?: number /* radians */; id?: string /* registers for log-hover flash, e.g. 'archfey-2' */ };
type Spawn   = [number, number];       // hero i uses spawns[i % spawns.length]; editor hint says "first 3 used" but code uses all
```

The editor keeps **one trigger per group** (`editor.js:258-263` appends cells to the existing group trigger); the
data model allows several. Groups in the UI are 1–4 (`index.html:83-86`), the data is any integer.

### 8.5 Map / scene and campaign document

```ts
type Tile = { h: number /* 0..8; editor Wall = 4 */; color: string /* css hex */; prop: null | 'difficult' | 'cover' };
type MapDoc = {
  id?: string /* 'scene-'+rand6, assigned by makeCampaign/loadJson */; name: string; intro: string;
  w: number; h: number;                       // editor bounds 8..48 per side
  tiles: Tile[];                              // row-major, index = y * w + x (grid.js:72)
  nodes: (EditorNode | ScriptedNode)[]; enemies: Enemy[]; triggers: Trigger[]; decos: Deco[]; spawns: Spawn[];
  fog?: { band: number };                     // visual fog wall (grid.js:268-298); the *loop* logic is a campaign hook
};
type CampaignDoc = { campaign: true; name: string; scenes: MapDoc[]; start: number /* never read */ };
```

- Persistence: `localStorage['polyheart-campaign']` (JSON of `CampaignDoc`), migrated from `'polyheart-map'`
  (`main.js:21-33`). Download/upload as one JSON file (`editor.js:325-354`); a bare map file is auto-wrapped.
  `loadJson` validates only `tiles/w/h` presence and defaults the arrays.
- Play starts from `editor.sceneIdx`, not `campaign.start` (`main.js:58`).
- `resizeMap` (`data.js:116-133`) crops/pads tiles and drops out-of-bounds content; guarantees ≥1 spawn.
- **Runtime state is written into the content objects**: `trigger.fired`, `node.used/open/found/lit/inserted`,
  `enemy.hp/x/y/frozen`, `map.nodes` filtered, `map.enemies` pushed. There is **no save/load of a play session** —
  only of authored content. `keys`/`flags` are `Set`s (not JSON-serialisable as-is).

### 8.6 Grid / passability rules (`grid.js`)

Constants: `TILE = 1`, `BASE_H = 0.25`, `LEVEL_H = 0.35`, `STRUCT_MIN = 3` (tiles with `h >= 3` render as crisp
boxes; the heightfield clamps corner heights at `STRUCT_MIN - 1`).

`findReachable(grid, start, budget, occupied: Set<'x,y'>, blockedNodes: Set<'x,y'>) → { cost: Map, prev: Map, key }`
(`grid.js:609-636`): Dijkstra over 4-neighbours; a step is legal iff the tile exists, `|Δh| <= 1`, not occupied,
not a blocking node, and cumulative cost ≤ budget; `difficult` costs 2, else 1. **Passability is implicit**: a
Wall (`h = 4`) is impassable from `h ∈ {0,1,2}` but walkable from `h = 3`. The queue is re-sorted on every pop
(`:615`) — O(n² log n) worst case; fine for ≤48×48, not for engine scale.
`tracePath(reach, start, dest) → {x,y}[] | null`. `smoothPath(grid, path, blocked, occupied)` string-pulls with 4
samples per tile and `Math.round`, so a diagonal between two orthogonally blocked cells appears to pass visually
(logic stays 4-neighbour) — *unverified at runtime*.

Move budgets: explore `speed + 4`, allies non-blocking (`occupiedByEnemies`); combat `max(1, speed - slow)`, all
living tokens block. Followers get budget 60.

**Verdict on data shapes — GENERALIZE all of them into zod schemas with stable ids; separate authored content from
runtime state (a `SceneState` overlay keyed by content id).** Specific keeps/drops:
KEEP row-major tiles as the authoring format (but store as typed arrays at runtime), tile `prop` → generalise to a
terrain-type table with cost/cover/LOS flags, `h` levels, spawns, trigger zones as cell lists, decos with `rot`,
deco `id` for narrative references, `intro`. GENERALIZE: explicit `passable`/`wall` flag instead of height
arithmetic, encounter groups → named encounters with their own trigger/objective data, nodes → one `Interactable`
schema with a `kind` and optional `check`/`conditions`/`effects`/`script`, enemies → references to adversary
content ids + per-instance overrides. DROP: `once` and `campaign.start` (dead), `Math.random` ids (use
authored/stable ids, CONTEXT.md requires it), scripted-node ad-hoc flags, `Set` state, `ENEMY_TEMPLATE`.

---

## 9. Other engine behaviours

| Behaviour | Where | Detail | Verdict |
|---|---|---|---|
| Party follow (conga line) | `followParty` `game.js:218-276` | Explore only. Followers sorted by distance claim trail cells backwards from the leader's path; fallback to any free cell within Manhattan 1..2 of the leader by lowest path cost; never enter trigger cells; moves animated in parallel. | KEEP behaviour (BG3-style follow), reimplement over the new pathfinder; make follow distance/formation data. |
| Hero attack | `attack` `game.js:496-544` | Manhattan range check vs `weapon.range`; `dc = e.difficulty + (cover ? 2 : 0)`; `bonus = +1` if attacker tile `h` > defender tile `h`; on success `dmg = weapon.dmg + (Hope\|crit ? 1 : 0)`, crit adds `weapon.dmg` again; no LOS; dormant enemies can be hit in combat; out-of-combat click just logs "not yet hostile". | GENERALIZE: SRD damage dice × Proficiency vs thresholds; terrain modifiers as data; add LOS/range bands; DROP the flat +1/+double. |
| Hero damage / death | `damageHero` `game.js:652-668` | `hp -= dmg`; on 0: death anim, auto-select next living hero, party wipe → `showEnd(false)` (restart). Dead heroes remain in the array. | GENERALIZE: SRD marks HP vs thresholds, Armor Slots, Stress; death moves at 0 HP; DROP raw subtraction. |
| End of combat | `endCombat` `game.js:670-694` | Clears `slow`, `shieldWall`; every living hero +1 Hope; hook; single-map victory when all enemies dead (600 ms, modal); multi-scene: log only. | GENERALIZE: encounter rewards/objectives as data; the +1 Hope is not SRD (drop or make a house-rule option). |
| Blessings | `useBlessing` `game.js:697-715` | One use per scene (`blessingUsed`), costs a token in combat, cannot be interrupted, may end combat, never triggers the enemy phase. Four closures in `data-campaign.js:45-85`: Cinder Nova (3 dmg all enemies ≤3 tiles), Hearthlight (+2 HP party), Hoarfrost Bind (2 dmg nearest ≤4 + `frozen`), Shield Wall (+2 Evasion for one enemy phase). | GENERALIZE into data-defined abilities (domain-card style) with effect commands + targeting shapes; DROP closures. |
| Input routing | `handleClick` `game.js:726-749`, `main.js:129-163` | Click-vs-drag threshold 6 px; tokens/nodes picked before terrain; hero → select, enemy → attack, node → interact, tile → move. Right-click → inspector; hover → context bar (80 ms throttle). | GENERALIZE: keep the interaction model (BG3 click-to-move/attack), implement as an input layer over engine commands. |
| Inspector / hover | `inspectAt`, `handleHover` `game.js:752-861` | Rich HTML readouts of heroes, enemies (incl. specials text), nodes (state rows for door/chest/pillar/crank), decos (`DECO_INFO`), tiles (elevation, prop). | KEEP as a presentation feature; content strings move to data. |
| Text ↔ grid refs | `ref(id, text)` `ui.js:10`, `grid.flash` | Log spans with `data-ref=id`; hovering flashes the registered 3D object's emissive. `introHtml` auto-lists node refs. | KEEP the idea (narrative log with entity links); generalise the registry to any entity id. |
| Dice presentation | `dice.js` | Player flings two physics d12s; settle test `v < 0.18 && ω < 0.25` for 0.45 s, 7 s cap; static bodies rebuilt from terrain/tokens/nodes per roll; 1400 ms linger. | GENERALIZE: keep as cosmetic/optional presentation driven by the seeded roll (or skip-able); never the source of truth. |
| Timing constants | throughout | 1100 ms post-roll, 500/350/250 ms enemy phase, 300 ms spawn, 600 ms victory. | DROP from rules; presentation layer owns pacing. |
| Editor | `editor.js` | Tools: raise/lower (0..8), wall (toggle h 4), paint, difficult/cover/clearprop, chest/door/pillar/portal, enemy (type+group), deco (click again rotates 90°), trigger (per group), spawn, erase, inspect (node script panel: name, trait, DC, flavor, requireKey, lockedText, goto, 4 outcomes × {text, effect, param}). Scenes: add/rename/delete/resize/intro. | GENERALIZE: the feature list is the minimum bar for the new editor; rebuild on Preact with schema-driven panels. |

---

## 10. Determinism and coupling audit (against CONTEXT.md conventions)

`Math.random` sites: `game.js:453` (loot item), `:578` (Nightmare 50 %), `:622` (enemy attack d12);
`data.js:99,137,144,231` and `editor.js:64,260,343` (ids); `campaign.js:396,402,457` (takeover victim, sabotaged
pillar, fog line); `dice.js:225,283-284,293-295` (initial orientation, fling jitter); cosmetic `grid.js:359,454`,
`models.js:352`. Plus the physics dice themselves. **None of the rules can be unit-tested deterministically.**

Coupling: `Game` awaits renderer animations (`hopAlong`, `bumpAttack`, `deathAnim`, `animateNodeOpen/Destroy`),
`setTimeout` pauses, and modal UI promises (`askRoll`, `askChoice`) *inside* rules methods; it imports `ui.js`
(`ref`, `esc`) and `models.js` (`DECO_INFO`) and builds HTML strings. Nothing runs without a DOM.

**Verdict — DROP the architecture, KEEP the rules content.** The engine core must be a pure, seeded, event-emitting
state machine (`applyCommand(state, cmd, rng) → events`), with presentation layers subscribing to events and
owning all animation/pacing. This is also what makes save/load possible.

---

## 11. Rule divergences from the Daggerheart SRD (verified against local SRD text)

| Topic | Legacy | SRD (local copy) | Verdict |
|---|---|---|---|
| PC action roll | 2d12 Hope/Fear + trait vs Difficulty; crit = match | same | KEEP |
| Hope | start 2, max 6; +1 on Hope rolls; spend 1 for flat +2 | start 2, max 6; spend to add an **Experience** modifier or Help an Ally; crit also clears a Stress | GENERALIZE |
| Fear | max 12; +1 per Fear roll; auto-spent 4 for +2 surge; resets per scene | max 12; GM spends any time for GM moves / **Fear Features**; carries over | GENERALIZE (pool KEEP, spending → GM-AI over Fear Features, persistence fix) |
| GM turn | only "roll with Fear" hands over; failure with Hope does not | GM makes a move on a Fear roll **or** a failure; spotlight-based, no initiative | GENERALIZE (policy) |
| Adversary attack | d12 + atkMod (+surge) ≥ Evasion (+cover, +Shield Wall) | **d20** + ATK ≥ Evasion | DROP → d20 |
| Damage | flat `weapon.dmg`, +1 with Hope, ×2 on crit, subtracted from HP pool | damage dice × Proficiency + mod; compare to Major/Severe **thresholds** → mark 1/2/3 HP; Armor Slots; crit = max + roll | DROP → thresholds |
| Stress | none | 6 slots, marked by costs/GM moves, cleared on crit/rest | ADD |
| Range | Manhattan tiles, weapon `range` 1–4, no LOS | bands Melee / Very Close / Close / Far / Very Far | GENERALIZE (band → tile-distance table, add LOS) |
| Adversaries | 3 homebrew flat kits, string specials | stat block: Tier, type (Minion/Standard/…), Difficulty, Thresholds, HP, Stress, ATK, attack (range, dice), Experiences, Motives & Tactics, Features incl. Fear Features | GENERALIZE (content-driven; SRD has 129 adversaries incl. Tangle Bramble) |
| Death | fall at 0 HP; party wipe = game over; revive on restart | death moves (Blaze of Glory / Avoid Death / Risk It All), Scars | ADD |
| Cover / high ground | +2 / +1 fixed | not codified (GM adjudication) | GENERALIZE as terrain-modifier data (house-rule defaults) |
| End-of-combat +1 Hope | yes | no such rule | DROP or optional house rule |
| Rests, leveling, domains, armor, ancestry/community, equipment | none | core systems | ADD (out of scope for this doc) |

---

## 12. Consolidated verdict table

| Behaviour | Verdict | Reason |
|---|---|---|
| Duality roll core (2d12 + trait vs DC, crit on match, Hope/Fear ±1, caps 6/12, cancel) | **KEEP** | SRD-exact; tests will pin it |
| Physics dice as the roll source | **DROP** (keep as cosmetic) | seeded RNG required; non-deterministic |
| Spend Hope for flat +2 | **GENERALIZE** | becomes Experiences / Help an Ally |
| explore ↔ combat via triggers / spawnGroup / scripted start | **GENERALIZE** | explicit FSM + events; keep semantics |
| Action-token pool (alive+1), Fear roll ends party turn | **GENERALIZE** | pluggable turn policy; SRD spotlight default, tracker as option |
| Enemy AI: nearest target, approach, attack, no LOS | **GENERALIZE** | baseline tactic profile in data; add LOS/bands |
| Enemy attack d12, flat damage, HP subtraction | **DROP** | replace with SRD d20 / thresholds / Stress |
| Fear surge (4 Fear → +2) | **DROP** | replace with data-driven Fear Features / GM moves |
| Specials `entangle` / `nightmare` / `frozen` | **GENERALIZE** | generic conditions + adversary features from content |
| Node check with 4 outcomes + effects + `requireKey` | **GENERALIZE** | schema-validated effect lists, readable conditions, crit slot |
| Effects `open/loot/damage/removeNode/giveKey/setFlag/spawnGroup/goto` | **GENERALIZE** | keep vocabulary, typed params, real inventory |
| Random `ITEMS` loot, write-only flags | **DROP** | replaced by inventory + condition system |
| Portal travel (choice dialog, no roll) | **KEEP** semantics, **GENERALIZE** mechanism | event-based transition, no sync re-entry, policy for combat |
| Hooks API (5 hooks + onGoto/onRestart) | **GENERALIZE** | event bus + command API |
| Campaign direct mutation of map/grid/ui; blessing closures | **DROP** | not serialisable; violates engine/renderer split |
| Party follow (conga line, stop before triggers) | **KEEP** | good exploration feel; reimplement on new pathfinder |
| Pathfinding rules (4-neighbour, \|Δh\| ≤ 1, difficult ×2, occupancy, blocking nodes) | **GENERALIZE** | explicit passability flags, efficient Dijkstra/A*, typed arrays |
| Path smoothing + glide animation | **KEEP** (presentation) | verify corner-cutting |
| Map JSON (tiles row-major, nodes, enemies, triggers, decos, spawns, intro, fog) | **GENERALIZE** | zod schema, stable ids, content/runtime split, named encounters |
| Campaign doc (`{campaign, name, scenes, start}`) | **GENERALIZE** | becomes the project/scene manifest; drop dead `start`; add importer for legacy files |
| Hero/enemy stat shapes | **GENERALIZE** | SRD character/adversary schemas; legacy values become the demo's tier-1 content |
| Inspector, hover context, log entity refs, mode badge | **KEEP** (presentation) | port to Preact; strings from data |
| Editor tool set and scene manager | **GENERALIZE** | minimum feature bar for the new editor |
| Hard-coded delays inside rules | **DROP** | pacing belongs to presentation |
| Session persistence (none) | **ADD** | required by CONTEXT.md |
| Any TTS/voice | **none exists; never add** | user constraint |

---

## 13. Explicitly unverified

- All runtime behaviour (nothing was executed); in particular enemy tie-breaking on equal distance (relies on
  `Array.prototype.sort` stability → party order) and `smoothPath` corner-cutting.
- What happens if `enterCombatGroup` is called for a group with no living enemies (no code path checks; the party
  could be stuck in combat with no way to end it except a portal).
- Whether `index.html`'s node panel exposes anything beyond the ids grepped (`np-trait`, `np-dc`, `np-goto`,
  `np-reqkey`, `np-locked`, `data-out/eff/parm`).
- Which model sets `userData.hover = true` at `models.js:218` (bobbing tokens) — not read.
- The core-book optional "Action Tracker" rule: not present in the local SRD copies, so its exact wording could
  not be compared to the legacy token pool.
