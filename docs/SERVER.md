# The server: Rust, and the rules in it

The plan for turning Tactical Engine into a client and a server, as the user chose it on 29 September
2026. This file is the plan and the record of how far it has got; `docs/BACKLOG.md` points here.

## What was chosen

- **A Rust server that runs the game.** The rules - combat, scripts, dialogue, the grid, movement,
  saves - are ported from TypeScript to Rust and computed on the server. The server also holds the
  assets, the accounts, the Store, each player's models, the projects and the saves.
- **The client stays TypeScript**: three.js rendering, input, the editor's UI. It connects to the
  server the way a browser connects to a website.
- **Why**: play from anywhere (sign in on any machine and your games are there), **co-op** (several
  players in one game), and **light clients** (a phone does not run the rules).
- **Where first**: this machine, as the dev server runs now; a public host once it works.

## The shape

```
Browser (TypeScript, three.js, Preact)          Rust server (this repository's server/)
  renders the board, plays the events   <-- WS --  runs a game session: the engine crate
  sends intents: move, attack, use,     -- WS -->    steps the rules, seeded dice
    answer a prompt, end the turn                  + a sandboxed JS runtime for project hooks
  the editor's UI                       <-HTTPS->  accounts, sessions, the Store, your models,
  (playtest: the engine as WebAssembly)              assets, projects, saves
```

- **HTTPS** carries what the dev plugins carry today, **under the same paths**: `/__accounts/*`,
  `/__store/*`, `/__models/*`, `/__art-provenance`, the default project. The plugins in `tools/*.ts`
  and the e2e stand-ins for them are the contract; the Rust server answers it route by route.
- **A WebSocket per game session** carries play: the client sends intents, the server answers with
  what happened (log lines, dice, floaters, prompts) and the state to draw. The client's game layer
  becomes a view of that state.
- **Two crates, kept apart**: `engine` is the rules alone - no files, no clock, no network, no tokio -
  so it compiles to WebAssembly for the editor's playtest as well as into the server; `serve` is axum,
  and owns everything that touches the disk or a socket.

## How the port stays honest: the TypeScript engine is the oracle

The rules are about 20,000 lines of TypeScript (`src/engine` without `render`) and about 9,000 more in
`src/game` (movement, rooms, interaction, saves, shops), behind some 2,700 unit tests. A port that is
"close" silently breaks content, so every module is ported against **golden fixtures**:

1. A TypeScript test drives the module through many cases and compares against
   `server/fixtures/<module>.json` (`UPDATE_GOLDEN=1` writes it instead). So a fixture is always
   what TypeScript really does.
2. A Rust test replays the same fixture and asserts the same answers.
3. Only when both pass is the module ported.

This works because the engine is **deterministic**: every roll comes from `core/rng.ts`, SplitMix32
over 32-bit integers with FNV-1a for text seeds, and nothing in `src/engine` calls `Math.random` (a hook
that tries is refused). Rust reproduces it bit for bit with wrapping `u32` arithmetic; the seed hash
reads UTF-16 code units, as JavaScript's `charCodeAt` does.

The TypeScript engine keeps working the whole way: the port grows beside it, and the client switches
to the server only when a whole session plays the same. Single-player parity comes first; co-op is
added after, so the rules are not redesigned while they are being transliterated.

## Things to get right

- **Project hooks are JavaScript** (`script/hooks.ts`: `project.code[]`, compiled with `new
  Function`). The shipped SRD pack carries 3, the default project 2; everything else a card does is
  data. The server runs them in an embedded JS engine (QuickJS through `rquickjs`) with the same
  `ctx` API, no host access, and limits on memory and time. On a server with other players'
  projects this is a **security boundary**, not the honest-mistake guard it is in a browser.
- **The schemas' defaults are load-bearing.** zod's `.default()` chains let a project written years
  ago still load. serde must parse the same JSON: `#[serde(default)]` field by field, checked against
  the shipped projects and packs as fixtures.
- **Floating point**: `+ - * /` and `Math.sqrt` are exact in IEEE on both sides; the rest is not, and
  is reproduced as V8 computes it (`server/engine/src/js.rs`). `Math.hypot` is V8's scaled Kahan sum, not
  `f64::hypot` - which differs in the last bit on the grid's own inputs, and fails the fixture - and
  `Math.round` rounds a half upwards (`Math.round(-0.5)` is -0), where `f64::round` goes away from zero:
  at a body's rim by the map's edge that is whether a tile is on the board. `Math.max`/`min` keep +0
  over -0. The typed arrays keep their precision (`lift` is `f32`). And a
  float read from JSON must be read exactly: `serde_json` needs `float_roundtrip`, or a number the
  TypeScript wrote comes back a digit off (found on the Store's timestamps).
- **A value-level fixture can hide a byte-level difference**: both sides of the comparison go through
  the same parser. Anything the other side reads back as a file is also checked as bytes.
- **The script interpreter** (`script/runner.ts`, `script/world.ts`, about 4,600 lines) is the
  hardest module; its fixtures are the shipped pack's cards and the default project's scenes played
  through, not cases written by hand.
- **Co-op changes the rules' edges** - whose turn, who sees what, who answers a prompt. It is a phase
  of its own, after parity.

## Phases

| Phase | What | Done when |
|---|---|---|
| 0 | This plan; the Rust toolchain; the `server/` workspace; `core/rng` ported with golden fixtures | TS and Rust both reproduce `server/fixtures/rng.json` |
| 1 | The platform server: axum serves the built client and the `/__*` routes - accounts, then the Store, your models, the models manifest and ancestries, art provenance, the default project; the Vite dev server proxies to it; each TS plugin deleted as its route moves | `accounts-store.spec.ts`, `your-models.spec.ts` and the round-trip scripts pass against the Rust server |
| 2 | The rules, bottom up, each against fixtures: `grid`, `rules`, `character`, `dialogue`, `content` (serde schemas), `combat`, `script` (effects, runner, world, hooks in QuickJS), then the game layer - the scene document and the room stood up from it, the party, the session (`demo-scene.ts`: building from a project, the fight loop, the GM's turn, prompts), and `movement`, `room`, `interaction`, `leap`, `save`, `shop`, `equip` on it | every module's fixture passes in Rust |
| 3 | Game sessions on the server: the WebSocket protocol, the client's game layer as a view, the editor's playtest on the engine built to WebAssembly | the full e2e suite passes with play on the server |
| 4 | Co-op: several players in a session, turn ownership, visibility, reconnecting | two browsers play one fight |
| 5 | The internet: HTTPS, a real admin password, upload and rate limits, backups, a host | reachable from outside this machine |

## Running it

```bash
cd server && cargo test                                         # the Rust port against its fixtures
npx vitest run src/engine/grid/grid.golden.test.ts src/engine/rules/rules.golden.test.ts src/engine/character/character.golden.test.ts src/engine/dialogue/dialogue.golden.test.ts src/engine/content/content.golden.test.ts src/engine/combat/combat.golden.test.ts src/engine/script/script.golden.test.ts src/engine/script/conditions.golden.test.ts src/engine/script/runner.golden.test.ts src/engine/script/hooks.golden.test.ts src/engine/scene/scene.golden.test.ts src/engine/scene/room.golden.test.ts src/engine/scene/party.golden.test.ts src/game/session.golden.test.ts src/game/play.golden.test.ts   # the fixtures are still what TypeScript does (runner.golden writes runner.json and world.json)
npm run build:server && npm run server                          # the game from the Rust server alone, on 8430
npm run server                                                  # (npm run dev starts it too, for the routes alone)
npx vitest run tests/unit/accounts.golden.test.ts tests/unit/store.golden.test.ts   # the fixtures are still what TypeScript does
npx vitest run src/engine/core/rng.golden.test.ts               # the fixture is still what TypeScript does
UPDATE_GOLDEN=1 npx vitest run src/engine/core/rng.golden.test.ts   # write it afresh after a TS change
```

The toolchain is `rustup`'s stable MSVC (Visual Studio 2022's C++ tools provide the linker), with the
`wasm32-unknown-unknown` target for the engine's WebAssembly build:
`cargo build -p tactical-engine --target wasm32-unknown-unknown`.

## Progress

- **Phase 0** - done 29 September 2026. This plan; Rust stable installed; the `server/` workspace with
  the `engine` crate (`tactical-engine`, `server/engine/src/rng.rs`), which builds to WebAssembly; and
  `core/rng` ported - `src/engine/core/rng.golden.test.ts` writes `server/fixtures/rng.json` (15 seeds:
  text with accents and an emoji, numbers negative, fractional and past 2^32; every call the generator
  has), and `server/engine/tests/golden_rng.rs` replays it bit for bit.
- **Phase 1** - started 29 September 2026.
  - **The accounts are the Rust server's.** `server/serve` (`tactical-serve`, axum) answers
    `/__accounts/me`, `register`, `login` and `logout` as `tools/accounts.ts` did - the same
    `data/accounts.json` and `data/sessions.json`, written as `JSON.stringify(value, null, 2)` writes
    them, since the TypeScript Store and your-models routes read them too. Passwords hash to the byte as
    Node's `scryptSync` does (the salt's hex text is the salt), so an account either side made signs in
    on the other. `tests/unit/accounts.golden.test.ts` writes `server/fixtures/accounts.json` - hashes,
    sign-in bodies (the 200-character limit counted in UTF-16 units), cookies, origins - and
    `server/serve/tests/golden_accounts.rs` replays it; `accounts_routes.rs` drives every route and
    refusal, in the order TypeScript gives them. `tools/rust-server.ts` builds and starts the server with
    the dev server and proxies the route to it; the TypeScript route is gone, leaving only its 404 for the
    tests' server. Tried end to end through 8420 - the admin that Node hashed signs in, a session Rust
    issued opens the Store and your models, and the real menu signs in and out in Chromium.
  - One deliberate difference: a stored hash of fewer than 10 or more than 64 bytes matches nothing
    (Node would compare two empty buffers and say yes).
  - **The Store is the Rust server's** (`server/serve/src/store.rs`): listings, publishing, showing the
    work later, votes, pictures, Get into a player's own models (`your_models.rs`, the import alone - the
    your-models routes are still the dev plugin's, over the same index), engine models listed, take-down.
    `tests/unit/store.golden.test.ts` writes `server/fixtures/store.json` - uploads (Node's lenient
    base64), about 36 publishes and 22 updates at every edge (JavaScript's `trim` and UTF-16 lengths, nulls,
    non-objects), votes, views, engine listings, old listings migrated, and a listings file with
    fractional timestamps that must come back **to the byte**; `golden_store.rs` replays it,
    `store_routes.rs` drives every route. Tried end to end through 8420: the show-your-work and the
    models round trips answer as they did in TypeScript, the TypeScript your-models routes read the index
    the Rust Get wrote, and the listings file the TypeScript wrote is byte-identical after the Rust server
    rewrote it four times.
  - Found by that byte check: `serde_json` parses floats fast, not exactly, so one timestamp in several
    came back a digit off. Its `float_roundtrip` feature parses as JavaScript does; the byte test fails
    without it.
  - Deliberately different: a body of JSON `null` to `publish` or `update` hung the TypeScript (it threw
    outside its try, and nothing answered); the Rust server answers as for `{}`.
  - **Your models are the Rust server's** (`server/serve/src/your_models.rs`): the list, a player's files
    served to anybody signed in, imports of a file or of another player's model. `golden_your_models.rs`
    replays `server/fixtures/your-models.json` - served urls, import bodies, a folder filled in order to
    the same ids - and writes back an index the TypeScript wrote, to the byte; `your_models_routes.rs`
    drives the routes. The proxy key for the files is `/__models/u/`, with its slash, so the models routes
    still in TypeScript (`/__models/ancestry`, `/__models/add`) are not caught. Tried end to end in a
    real browser on 8420 - Get in the Store, then the model under *Your models* in the editor - which
    found the models watcher reloading the page on a Get (fixed; `docs/BACKLOG.md`).
  - Found by the byte check: a model's keys are in the order of its history - `listing` after `added`
    when it was imported and then got from the Store, before it when got first - so an index entry is
    kept as the ordered object it is, not a struct. (The Store's listings could do the same only for
    fields a later version adds, or a listing from before claims; neither is in any file yet.)
  - **The engine's models are the Rust server's** (`server/serve/src/manifest.rs`): + Model to the engine
    (`/__models/add`, into `public/models`) and a model's ancestry for every project
    (`/__models/ancestry`, the tracked `projects/model-ancestries.json`). `golden_manifest.rs` replays
    `server/fixtures/model-manifest.json` - ids from file names (`İstanbul` is `i-stanbul`, as JavaScript
    lower-cases it), ancestry files, about 80 changes and 66 uploads judged, the folder listed in
    JavaScript's sort, and the ancestries file written after every change, to the byte. The list itself
    still reaches the page as the dev server's virtual module - moving it means the page asking for it,
    which is phase 3 - so the dev server now watches the ancestries file as it watched the folder, and a
    write by either side refreshes the next page's list. Tried end to end through 8420: an ancestry set
    and seen in the page's list, a model added and listed, every refusal; the real ancestries file
    restored byte for byte after.
  - Found doing it: the dev server stopped the Rust server when its HTTP server reported closed, which a
    browser's keep-alive can hold off for good - so on a restart the old server kept the port, and the
    new dev server passed routes to a server built from older code. It is stopped when the dev server
    is closed now, or its process ends.
  - **The art marks and the default project are the Rust server's** (`server/serve/src/art_and_project.rs`):
    `/__art/provenance` into the tracked `projects/art-provenance.json`, and `/projects/default.json`
    read fresh and saved (`/__project/save`) as the editor sent it. The marks file's keys are in
    JavaScript's `localeCompare` order - `_ - : .`, digits, letters case set aside, then lower before
    upper (`model:apple` before `model:Arty`) - which `locale_order` reproduces for the characters a key
    has; `golden_art_and_project.rs` holds it to the byte over 27 changes. The page still loads the marks
    as the dev server's virtual module, which now watches the file.
  - **Every route a dev plugin answered is the Rust server's.** What is left of the dev server is serving
    the page itself, the models, the card art and the two virtual lists (models, marks).
  - Found on the way, and it cost data: two plugins changed at once restarted the dev server twice
    over; one restart found 8420 still held and slid onto 8421, the tests' port, and a full e2e run
    reused it - running on the file-booted project, which saves - so a test's save rewrote
    `projects/default.json` (restored from git). `vite.config.ts` now has `strictPort: true` and
    `playwright.config.ts` `reuseExistingServer: false`: a taken port is an error, never a server to use.
    And the Rust server the dev server starts is held on `globalThis`: a restart loads the plugin afresh,
    so several at once (a few `tools/*.ts` saved together) each thought they owned a server, and an older
    one kept the port. Now each restart stops whatever is running first - five restarts at once left
    exactly one server, started after the last.
  - **The game runs from the Rust server alone.** `npm run build:server` (Vite's `server` mode) builds the
    client into `dist-server` in seconds - it copies none of `public/`'s 1.1 GB, and saves back as the dev
    server does (`savesChanges`), where a static build is read-only - and `npm run server` serves it:
    `site()` in `server/serve/src/lib.rs` puts a file in `public/` first (live: a model added to the
    engine is there without building again), then the build's, then the page, and under them every
    route. Nothing outside those two folders is reached (`..`, encoded or not, never gets to `data/`).
    **The private card art** in `public/cards/` is served only when the server listens on this machine
    alone; beyond it `/cards/` is the build's empty index, as a static site's is (`site_routes.rs`).
    Tried in a real browser on 8430, no Vite: signed in, the Store's 52 listings, the card art, the Hollow
    Vault drawn with its 38 models, no request failed; Ctrl+S in the editor saved through the server (204).
  - **Phase 1 is done.** What Vite still does in development is serve the page itself.
  - **The two lists the page opens with are asked of the server** (`src/game/engine-lists.ts`, a top-level
    `await`): `GET /__models/shipped` and `GET /__art/marks`, read on every request, so a model added while
    the server runs is in the next page's list with no build - tried from the Rust server alone (51 models,
    a file copied in, 52 after a reload) and through the dev server. The tests' server answers both itself;
    a static build does not ask. (The first cut answered the tests' server with a 404 - the page fell back
    as meant, but the browser logs a 404 as a console error, and 116 e2e tests failed on it.) The dev server's two file watchers retired with it; the one
    that reloads the other open pages when a model arrives stays. This is the first thing the page is
    told at run time rather than at build time - the shape phase 3 carries on.
- **Phase 2** - started 29 September 2026.
  - **The grid is ported** (`server/engine/src/grid`: `terrain`, `tile_grid`, `los`, `pathfinding`,
    `walk`, with `rules/cover`): tiles and what stands on them, sight and cover, reachability and A*,
    and the walk - a creature's body, its smoothed line, its cost. `src/engine/grid/grid.golden.test.ts`
    builds four grids through the real API (the default palette with stacked pieces, lifts, a barred
    edge and a void cell; a palette of its own with fractional costs and smoke; a flat room, all ties;
    a corridor) and writes `server/fixtures/grid.json`: every tile's answers, sight and cover for every
    pair under three margins (about 27,000), traces, 1,500 reachability fields and 375 sets of paths
    under five movement rules and five contexts, and the walk over 3,400 spots, 480 segments, 240
    settlings and 120 smoothed lines with everything measured along them. `golden_grid.rs` replays it,
    every float to the last bit. The TypeScript's binary heap is ported sift for sift, since which of
    two equally cheap tiles comes first decides which route is walked; a heap that breaks ties the
    other way fails the fixture, and so do Rust's own `round` and `hypot`.
  - **The rules are ported** (`server/engine/src/rules`: `dice`, `duality`, `gm_die`, `range`,
    `countdown`, `cover`, `damage`, `resources`, `jump`). `src/engine/rules/rules.golden.test.ts` drives every
    function over edge-heavy inputs into `server/fixtures/rules.json`, and every roll records where the dice
    stream stood after it - so the Rust draws the same dice in the same order, and refuses (a fractional or
    impossible count, bad sides) without drawing any, as the TypeScript throws. `parseDice` is the
    TypeScript's four regular expressions matched by hand: JavaScript's `\s` (U+FEFF yes, U+0085 no) and its
    replacement rule (`'$11d$2'` is group one then a one, so `d6+d8` is refused). Three deliberate
    mutations - Rust's whitespace, a fractional count let through, the Help dice drawn before the advantage
    die - each fail the fixture; the last one did not until two cases rolled with both, which the fixture now has.
  - **The character is ported** (`server/engine/src/character`: `progression`, `sheet`, `schema`; with
    `server/engine/src/content`: `pack`, `abilities`, `features`). The engine crate takes `serde` and
    `serde_json` now (both build to wasm32): a sheet, a plan and the content read from the JSON the
    TypeScript keeps, and the rule types they carry (`Trait`, `Traits`, `RangeBand`, `DamageType`,
    `DiceExpression`, `ParsedDamage`, `DamageThresholds`, `MarkPool`, `Currency`) serialize as it writes
    them. A content table keeps a `Map`'s order - the cards granted to a sheet come in it, and laying a
    project over the shipped content replaces an entry where it stands. `character.golden.test.ts` takes
    the content the game plays with (the demo pack, the shipped SRD characters laid over it, their
    abilities, and a few probe cards and abilities for the grants and modifiers the shipped ones leave
    out) and writes `server/fixtures/character.json`: 68 sheets derived (numbers, cards, modifiers in
    order, attack and defender profiles, pools, granted and lent cards) and queried; one sheet of each of
    the twelve classes levelled by legal plans drawn off a seeded stream, 88 levels in all - the nine SRD
    classes to ten, the demo's three (one domain of five cards each) until their cards run out at level 3
    or 4; 2,264 plans tried, every refusal in the same words and order; what each gear feature plainly
    says; and what `parseSheet` lets in.
    `golden_character.rs` replays it; 27 of 28 deliberate mutations fail it (the 28th, a pair of any
    length let past the schema, is still refused by serde's `[T; 2]`). The modifiers' `when` is kept as
    the JSON it was written in - read in full by the script's schema - until the conditions' evaluation
    is ported.
  - **A defect found by the port, and fixed on both sides**: the Proficiency advancement cost both picks
    and added nothing (`levelUp` added `takenNow.get('proficiency')`, a key its `tier:kind` map never
    held). Both now count the box where the sheet is derived, as a Hit Point box is, and the fixture was
    written afresh (`docs/CRPG-GAPS.md`).
  - **Dialogue is ported** (`server/engine/src/dialogue`: `schema`, `layout`, `runner`), with the
    hand-written schema checks now shared (`server/engine/src/schema.rs`) and JavaScript's string `sort()`
    order (`js::utf16_cmp`: by UTF-16 unit, so a character past U+FFFF sorts before U+E000-U+FFFF). The
    walk stands on `script/`, which is not ported, so it asks `script/`'s four questions - does a
    condition hold, run these effects, answer this prompt, what modifier would a check add - of a
    `DialogueHost`. `dialogue.golden.test.ts` wraps the real TypeScript modules (`vi.mock` over the
    originals) to record every one of those questions the dialogue itself asks, with its answer, step by
    step - not the ones a script asks inside a run - while a seeded player drives the game's dialogues
    and a set written for the corners through 1,689 steps. `golden_dialogue.rs` walks the same
    graphs against that tape: the same questions in the same order (a node's view is built twice on
    entering it, as the TypeScript builds it), none left unasked, the same view, prompt and journal.
    When `script` is ported its world becomes the host, and the tape comes out. `parse_dialogue` is on
    the zod-alike now, reading conditions, effects and checks with the script's schemas, and its refusals
    are compared with zod's word for word. 19 of 20 deliberate mutations
    fail the fixture; the 20th (an empty node list let past the schema) is still refused, since the
    start cannot be one of no nodes. Several of the game's own nodes are never shown in the replay:
    they are walked through by design, or gated on quest state the fixture's small world lacks.
  - **A quirk kept on purpose**: choosing a reply while another reply's script waits on a prompt - the
    dialogue allows it - starts a new script but reads its journal on from where the old one stood, so
    the new script's first entries are dropped (`consumed` is not reset). The Rust does the same; the
    fixture has a play that shows it.
  - **The content schemas are ported** (`server/engine/src/content`: `schema`, `document`), on a
    zod-alike (`server/engine/src/zod.rs`): schemas as data - strings, numbers, sets, literals, lists,
    objects with optional and defaulted fields, unions, tagged unions, refinements - read the way zod
    4.5.4 reads them, because `readPack` shows the player zod's own words. So the output is zod's (defaults
    put in as written, unknown keys dropped) and a refusal is zod's, every issue with its path and message
    in its order. zod's rules, pinned by probes and then by the fixture: a wrong type, a word not in a set,
    a failed union or a fractional integer stops that value and skips its object's refinements; a bound,
    a pattern or an integer past the safe range is reported and checking goes on; a length is checked on
    anything that has one, even after its type failed, and worded by what it found (a string's `min` given
    `[]` says "expected array to have >=1 items"); a union falls back to the one option that failed only
    on checks, or else "Invalid input". Every schema the engine reads content with is here: weapon,
    armor, class, ancestry, community, subclass, card, experience, adversary, ability, condition, code,
    item, loot table, quest - and `readPack`, `packOf`, `describePack`. Conditions and effects are read
    with the script's schemas. `content.golden.test.ts` reads 1,807 real entries (the
    shipped SRD characters and the default project as written, the starter pack, the equipment
    catalogue), breaks samples of each kind at every field two levels down twelve ways, writes out 29
    corners and 12 documents, into `server/fixtures/content.json`. `golden_content.rs` compares every
    one of the 5,988 breaks word for word (156 of them waited, refused inside a condition or effect, until
    the script's schemas were ported). Of 24 deliberate mutations 22 fail it; the other two are equivalent here (a string length
    counted in bytes - no content string has a minimum above one - and a default read through its own
    schema, which every default passes). Every weapon, armour, class, ancestry, subclass and card the
    schemas read also reads into the character's types.
  - **One difference, until the scene is ported**: `readPack` brings an older document up to date first
    (`scene/migrate.ts`), and that is not ported. Everything the server reads is at the current format
    (6), so `read_pack` refuses an older or unversioned document by name instead of reading it half-right.
  - **Combat is ported** (`server/engine/src/combat`: `targeting`, `area`, `adversary_features`, `attack`,
    `defense`, `encounter`), on the part of the scene state a fight reads and writes
    (`server/engine/src/scene/state.rs`: creatures in the order they came, with their tile and spot, pools,
    conditions and side; the Shadow pool; each encounter's progress - the rest comes with the scene's port).
    The rule results now serialize as the TypeScript writes them (a Duality roll, the GM's Die, a damage
    roll, resolved damage), the character's attack and defender profiles are combat's, and an ability
    carries what a reaction to damage needs (its kind, trigger, cost, what it does, whether it fires by
    itself). `combat.golden.test.ts` draws everything off seeded streams over two of the grid fixture's
    grids: 800 targetings, 240 areas and moves under pressure, stat blocks' features (Relentless, Momentum,
    Terrifying, Horde, Minion, read off names and brackets as JavaScript reads them), 700 attacks - each
    from its own seed, the dice stream's position after recorded, then landed on a scene - 500 defences by
    policy and by plan with their previews, and eight encounters of 120 turns each under both turn
    policies. `golden_combat.rs` replays all of it; 28 of 32 deliberate mutations fail it, and the other
    four are equivalent (a space `parseDice` ignores, a zero reduction passed or not, a ward loop that
    stops or goes on past nothing to save, Armor Slots planned against damage they cannot touch).
  - **A defect fixed on the way**: `tilesInArea` scanned from `origin - reach`, and with a band table whose
    reach ends part-way across a tile it scanned the spaces between tiles, answering fractional "tiles"
    and missing real ones. Nothing calls it with such a table yet. The scan is bounded in whole tiles now,
    in both languages (`src/engine/combat/area.test.ts`).
  - **Script, in five parts.** At 7,000 lines it is ported the way phase 2 has gone, bottom up: (1) the
    schema, (2) the conditions' evaluation, with marks, zones and countdowns, (3) the runner, (4) the
    world, (5) hooks in QuickJS. `rquickjs` does not build for `wasm32-unknown-unknown` as the engine crate
    must, so the hooks may live in the serve crate, or behind a feature, with the engine asking for them
    through a trait - to be settled when that part comes.
  - **The script's schema is ported** (`server/engine/src/script/schema.rs`): target selectors, the 31
    conditions and the 80 effects, checks and choice options, on the zod-alike - which gained `lazy` (the
    vocabulary holds itself: a branch holds effects, `not` holds a condition), `record` (hook arguments;
    a bad key is fatal, and an own `__proto__` is dropped from the output as JavaScript's assignment drops
    it) and `null` - and the walks that visit every effect and condition inside a script.
    `script.golden.test.ts` reads every selector, condition and effect the shipped content and the default
    project carry, and one of every kind written out (the content leaves about thirty kinds unused), 795 in
    all, breaks samples of each kind at every field two levels down twelve ways - 8,532 breaks - and walks
    each effect. `golden_script.rs` compares every one word for word. With it, nothing is opaque any more:
    the content schemas read conditions and effects in full, and the dialogue schema is on the zod-alike.
    15 of 16 deliberate mutations fail the fixtures; the 16th (the amount union's options in another
    order) is equivalent, as its options never overlap by type.
  - **The conditions' evaluation is ported** (`server/engine/src/script/conditions.rs`, with `marks`,
    `zones` and `countdowns`): `evaluate` walks a condition asking a `ConditionContext` - twenty reads of
    the world: flags, variables, pools, bands, factions, who a selector names, whether a hook is defined
    and what it answers - and a `DiceHand` for `chance`, in the TypeScript's order and with its
    short-circuits; `compare` is JavaScript's `===` between script values and orders only numbers; a
    hook's reads are gathered (the actor, then the fight) before it is asked, as the TypeScript gathers
    them. As with dialogue, the world is not ported, so `conditions.golden.test.ts` wraps a real one and
    tapes every question the evaluation asks, with its answer: 207 conditions - every one the content
    carries and a set written so each kind is met both ways - in three worlds (a character acting, an
    adversary, nobody), under four bindings, with and without dice: 3,315 evaluations and 4,703 taped
    questions. `golden_conditions.rs` asks them again, in order, none left over, to the same verdicts.
    Countdown boards - armed in `Map` order, ticked on action-roll and Hit Point cues, looped with their
    start re-rolled, reaped as their owners fall or leave, ended with the scene - are replayed from the
    stream's position before each advance to its position after; zone and countdown snapshots read as zod
    reads them (the zod-alike gained `nullable`); mark keys parse alike. 25 of 25 deliberate mutations
    fail the fixtures, three of them only once a case was added for each (a `spent` count the evaluator
    must ignore, a variable read twice, a looping start rolled below one).
  - **The runner is ported** (`server/engine/src/script/runner.rs`): `ScriptRunner` runs a script's effects
    off a stack of frames, stops at a prompt (a check to roll, a roll to answer, a choice, a dialogue) and
    picks up where it stopped when the prompt is answered, as the TypeScript does - the journal, the
    counts a script reads back (`spent`, Hit Points taken and dealt, targets hit), the last action roll,
    the flags a card reads after (`spotlightToGm`, `rolled`, `cancelled`, `vaulted`). What it asks of the
    world is `ScriptWorld`, 72 methods beside the conditions' reads; the five that draw dice (loot,
    damage, an attack, a reaction roll, a hook's effect) are handed the runner's stream. `evaluate` now
    takes one context that is both the world and the dice, so a gate inside the runner can roll. The world
    was not ported yet, so `runner.golden.test.ts` wraps a real one as the conditions' fixture does and tapes
    every call the runner makes, its arguments and its answer, and the stream's position after each call
    that drew from it; hooks are taped, not run. 217 scripts - every one the default project and the SRD
    pack carry, and 47 written for the corners - each played four times from a seeded start (who acts, in
    or out of a fight, with the cards that answer rolls and blows or without) by a seeded player who
    mostly answers straight and now and then cancels or answers nonsense: 868 runs, 1,284 steps, 4,731
    taped calls, all 64 kinds of journal line (the counts since the world's port, whose probed runs play
    with more content). `golden_runner.rs` replays them against the tape, which
    moves the stream to where the world left it, and holds every step's status, journal, flags and stream
    position to the fixture. 37 of 41 deliberate mutations fail it; the other four are equivalent (the
    Experiences read before the targets rather than after, a lowered roll said though the lift is never
    negative, zones kept when a moving effect prompts though none does, half Proficiency floored at one
    though Proficiency never falls below one).
  - **The world is ported** (`server/engine/src/script/world/`, split as the TypeScript's sections are):
    `SceneScriptWorld` over a live `SceneState` and the `ScenarioState` that outlives it - everything the
    runner and the conditions ask through their traits, and what a fight asks beyond them: the modifiers a
    creature holds and wears, read from its own chair; its defences; advantage on either scale of a roll;
    the reactions it may answer with and their gates; the swing a stat block prints; a defence and the
    damage that lands through thresholds and armour; an attack with a swarm piling in; summons and
    replacements; zones and who is standing in them; the clocks a fight counts; walks, blinks and pushes.
    The content it reads is borrowed for its life (`WorldContent`), so a changed project is a new world;
    hooks come through a `Hooks` trait, taped until part 5. With it came the rest of the scene state (the
    room's things and doors, who blocks whom, attitudes, conditions cleared, the snapshot and its restore
    - one from a room since grown is refused, reshaping being the scene document's), condition
    definitions, stat blocks and loot tables as types (`content::conditions`, `adversaries`, `items` with
    `rollLoot`), `AbilityDef` widened to what the world reads, `js::locale_cmp` (the ICU root order
    `localeCompare` breaks ties by: `_` sorts before `-`) and `JsObject` (a plain object's key order), and
    serde_json's `preserve_order`, so JSON read keeps the order JavaScript wrote it in. The save's schema
    for a scenario snapshot comes with the save module.
    `runner.golden.test.ts` also writes `server/fixtures/world.json` from the same runs: the ten worlds and
    four sets of content they began in - read off the TypeScript's world itself - every hook run at any
    depth, what each step changed, and what was left waiting to be heard. `golden_world.rs` derives the
    characters from their sheets (held to what the TypeScript derived), stands the Rust world up, and runs
    the Rust runner against it: every call answered by the world and held to the tape, each step's changes
    held to the TypeScript's. One run in four (217) is then probed, in a world carrying content written
    for the corners the demo's never reaches - conditions that pay out, aid an Armor Slot, answer a fall,
    swap the Light Die, stop a creature or end of themselves; a card a condition lends; tokens that lift a
    roll; features printed on the stat blocks - with 30,285 direct calls of 124 kinds: on one probed run in
    four a scripted pass, a rule at a time (every world call the runner's runs never make is asked there),
    then eighty calls off a seeded stream that mostly go back to whoever the last one was about. The probes
    were grown against deliberate mutations: 72 written first, the fixture strengthened until each failed
    it; then 18 written fresh, 13 of which failed at once and the rest once a probe asked their question;
    then 3 more for the calls added last. 93 of 93 fail it now, with the runner's 37 of 41 as before.
  - **Hooks are ported** (`server/hooks`, the `tactical-hooks` crate, on `rquickjs`; the engine's side is
    `server/engine/src/script/hooks.rs`). The engine stays free of any JavaScript engine, and still builds
    to wasm32: it asks a `Hooks` trait, and lends the hook a `HookReader` over the world while it runs -
    `ctx.pool`, `ctx.select` against the bindings the hook was run under (which `HookReads` now carries),
    and the rest. The crate compiles a project's code as `compileHooks` does - `new Function`, the same 24
    names shadowed, `Math.random` refusing - and builds each call's `ctx` from the TypeScript's own code run
    inside QuickJS (`prelude.js`): `hookReads`; `createRng` started from the scenario's stream, so its
    errors are the TypeScript's words and the stream is taken up where the hook left it; the queue and the
    log. Each call gets a runtime of its own, with no host but the reads and limits on memory (32 MB),
    stack and work - interrupt checks counted, not timed, so a hook stopped is stopped on every machine. A
    runtime to itself is also what lets a read reach another hook: a modifier gated on one, read while a
    hook asks a Difficulty. A read the TypeScript's world throws on - a pool no creature has - throws in the
    hook here too. Where QuickJS and V8 differ: an error the engine raises itself is worded its own way
    (its kind is the same), there is no `Intl`, and a hook past its limits fails where the browser would
    carry on.
    `hooks.golden.test.ts` runs the five hooks the default project and the SRD pack carry (25 cases) and
    47 cases written for the rest of the `ctx` - every read, of every kind of argument; every die; the last
    roll; the queue; what a hook may not touch; what it throws; the language, numbers and sorting - through
    the engine's own `compileHooks`, `hookReads` and `runHook` in the demo world, taping each read that
    reaches the world, into `server/fixtures/hooks.json`. `golden_hooks.rs` holds QuickJS to the same
    reads, outcome, queue and dice: an error in the hook's words or the shims' word for word, the engine's
    by its kind. The runner's fixture gained a hook of its own, run and asked in every run's project, and
    `world.json` the code each content was played with, so `golden_runs.rs` replays all 868 runs with
    nothing taped - the Rust runner, the Rust world, the hooks compiled and run in QuickJS - to the same
    prompts, journal, dice and world. `boundary.rs` holds what the TypeScript cannot show: a loop, an
    allocation and a recursion stopped; nothing reachable but the reads; the dice the scenario's stream; a
    read reaching a hook. 25 of 26 deliberate mutations - in the prelude, the bridge and the world's reader - fail them; the 26th (a log's tone written as undefined rather than left out) is equivalent, JSON having no undefined, and the runner's 37 of 41 and the world's 93 of 93 hold on the fixtures as they now stand. The serve crate builds no worlds yet:
    `QuickJsHooks::compile` is where the game layer's port plugs a project's code in.
- **The game layer, in six parts.** The row above first named seven modules, about 1,800 lines. Each
  of them works on the session (`DemoScene`, `game/demo-scene.ts`, 4,373 lines), on the party
  (`scene/party.ts`, 784) and on scene code not yet ported (about 2,300 lines): some 9,000 lines in all,
  which phase 3 needs on the server anyway. Bottom up: (1) the scene document - (1a) the documents, their
  schema and their migration, (1b) a room stood up from one: its grid, its state, reshaping, triggers,
  prop functions, interaction - (2) the party; (3) the session built from a project (`room`, the log,
  roster and pools, travel), hooks reaching it through a factory; (4) movement, leaps, interaction, props
  and talk, and what drives a script from play; (5) the fight loop - attacks, the GM's turn, defence and
  death prompts; (6) `shop`, `equip`, gear, and `save` with the scenario snapshot's schema.
  - **The documents are ported** (`server/engine/src/scene/document.rs`, `migrate.rs`): the scene and
    project schemas on the zod-alike, with what they are built of - the prop functions and the shop, the
    building layer's pieces, structures and keys, a model asset, the jump rules, and a character sheet
    as zod reads it (`character::schema::sheet_schema`; `parse_sheet` stays the door a lone sheet comes
    in by) - and `migrateDocument`, every step, following JavaScript's ways with an object's keys (a key
    renamed moves to the end, one assigned keeps its place) and building ids as the TypeScript does
    (`toContentId`, NFKD by `unicode-normalization`). `read_pack` migrates now, as `readPack` does, where
    it refused an older document by name. The zod-alike gained `multipleOf` (zod's own tolerance),
    `trim`, `tuple` and a record refined whole; and `js::number_to_string` writes a large whole number
    as JavaScript does - its shortest digits and then zeros, `1152921504606847000` for 2^60 - where it
    wrote every digit, which no earlier fixture had reached.
    `scene.golden.test.ts` writes `server/fixtures/scene.json`: the documents older builds really wrote
    (the captured version-1 project and save, the version-3 project), the default project with its
    version taken off so every step walks real data, and 17 written for each step's corners, migrated;
    the projects read whole and as packs; a sample project using every part of the schema broken twelve
    ways at 200 places, deeper inside a scene (2,400 cases); 25 corners the breaks cannot reach; names
    made into ids. `golden_scene.rs` replays it, issue for issue and field for field. 36 of 37
    deliberate mutations fail it; the 37th (a document of this version migrated rather than returned)
    is equivalent, every step being skipped and the version written as it was.
  - **A defect fixed on the way**: whether a building piece's structure exists was asked of a registry
    only a grid built for a project sets, so a project building with a structure of its own was refused
    on a fresh page ("No structure called ..."). The project's schema asks it now, of the engine's four
    and the project's own, in both languages (`src/engine/scene/schema.test.ts`).
  - **A room stands up from its document** (`server/engine/src/scene/`): `building` (the four atoms, the
    structures a project declares, what a piece is to somebody standing on it), `deco_span`,
    `grid_from_scene` (a project's palette and structures, the grid with its building layer stacked and
    its solid props barred, an unknown terrain id reported once), `prop_functions` (each function as the
    object it plays as, portals paired, objects made props), `triggers`, `reshape` (a room grown, and a
    snapshot counted again from the corner that moved), `interact` (a use refused or run), and
    `state::scene_state_from_scene` with `placements_of`. The TypeScript's structure registry, which
    `paletteForProject` refills as a side effect, is a value here (`Structures`), handed to whoever builds
    a grid, so one project's structures never leak into another's room. `SceneState::restore` now
    reshapes a snapshot taken before the room grew, where it refused one.
    `room.golden.test.ts` writes `server/fixtures/room.json`: the demo's rooms (and the proof that one
    built there is the demo's own room, grid and state), the default project's, the captured version-1
    project's with its objects as they were and made props, and 120 rooms written from a seed - pieces at
    every shape, level and stretch, stacked, tied, numbered and a million tiles off, props solid and
    spanning and with nested functions, overlapping triggers, bystanders and friends, creatures off the
    board and without a stat block, heights past an `Int16Array`'s reach; then rooms grown and games
    restored across the growth and back, snapshots shifted, 300 prop functions, portals, and 4,400 uses
    refused or run. `golden_room.rs` replays it. `runner.golden.test.ts` adds to `world.json` every
    usable thing in the demo's vault used three times over from nine starts, prompts answered;
    `server/hooks/tests/golden_runs.rs` replays those against the real world with the hooks run, dice
    for dice. 49 of 50 deliberate mutations fail the two; the 50th (a pair id trimmed or not before
    it is looked for) is equivalent, since the schema trims every pair id a document holds.
  - **The party is ported** (`server/engine/src/scene/party.rs`): selection and Tab, the party's order,
    who walks with whom (link, unlink, the ranks closed behind somebody leaving a group), who is held;
    the ground a member reaches and the ground their movement covers - the straighter line's reach past
    the count of squares, and inside a circle only what a walk reaches without leaving it; a walk planned
    and made, aimed at a spot, begun mid-walk, a step within one's own tile, cut short where the
    allowance or the circle runs out and backed up to where a body can stand; the followers walking down
    the leader's trail a pace apart, the ones it cannot place left standing unless walked into or left
    behind; and a walk stopped where the figure got to. The TypeScript's `Party` holds its scene; this one
    holds only what is its own - selection, groups, order, held members, trails - and is handed the
    scene each time, so the state stays the one owner of who stands where. `alongTheLine`, private and
    called by nothing, is not ported.
    `party.golden.test.ts` writes `server/fixtures/party.json`: 113 sessions of 30 to 40 orders - the
    demo's vault with the demo's own party, and rooms written from a seed with walls, marsh, raised
    ground, pieces, solid props, a door and creatures in the way, under party options and movement rules
    of every sort, the rules changed and members falling part-way - each order's answer and, after it,
    everybody's tile and spot with the party's selection, order, groups, held members and trails.
    `golden_party.rs` replays it. 41 of 42 deliberate mutations fail it; the 42nd (a walk inside a
    circle measured for leaving it as well as for every point being in it) is equivalent, a circle being
    convex.
  - **A game is played from a project** (`server/engine/src/game/`): `Session::build` is
    `buildProjectScene` - the project's objects made props, every sheet derived with the project's content, the opening room
    stood up (`build_runtime`: its grid, every placement's stat block - the project's own before the shipped
    pack, none substituted - the party on the spawns with the pools it carries, the party's control, the
    triggers and the world). Then what happens between actions: `refresh_world`, `set_sheet`,
    `sync_roster` (a sheet added arrives beside the party, one removed walks off), `sync_pools`,
    `gather_party` and `free_tile_near`, `travel_to` (a room remembered comes back as it was left),
    `sync_authored_encounters` (a room made to agree with its document, back from the editor),
    `enter_saved_scene`; and the log's `note`, with the creatures a line names found in it in UTF-16
    units, as JavaScript finds them. `game/rules.rs` is the demo's house rules, `game/content.rs` the
    content a project plays with.
    - **What the app ships is handed in** (`Shipped`: the characters with the equipment catalogue, the stat
      blocks, the abilities, the conditions), not embedded: the engine carries no content, and where the
      server reads it from is phase 3's to settle. **So are the hooks** (`HooksFor`): the engine runs no
      JavaScript, and keeping a project's last compile, as `hooksFor` does, is the caller's to do.
    - **The world now shares its content** (`Rc<WorldContent>`) instead of borrowing it, so a session can
      own the world it plays in. The world owns the room's state and the scenario, and a world rebuilt is
      built over them. The world's reads that handed back references into the content while it changed
      itself read from a content handle the caller holds (`held_by_in` and its siblings), `reactions_for`
      answers owned abilities, and `defend` takes the content it reads its reactions from. What the world
      reads of the project is fixed when it is built, as the TypeScript's traits are; the sheets, which the
      TypeScript's world reads live, are handed to it again whenever they change.
    - **Left for the parts that play them**: the log's words for a script's journal (`record`), the
      destination a script asked for (`settleTravel`), what waits on the player, a fight and the GM's
      turn, and arriving by portal. `openProject`'s renaming of retired models and adding of shipped ones
      are the renderer's - so a project the server writes back would differ from the browser's in model
      ids.
    `session.golden.test.ts` writes `server/fixtures/session.json`: the shipped content once, the three
    projects once each (the demo's, the default project, and the default project carrying a stat block, a
    condition, a step height and an old object of its own), and fifteen sessions of forty steps - travel,
    the roster, sheets written back, wounds, the party gathered (on a member, deep in a wall), a save
    loaded, the world rebuilt, placements renamed, dropped and added and triggers moved as the editor
    does, lines with names that overlap - each followed by the room, everybody in it, the party, the rooms
    remembered, the log's new lines, the world's content and the scenario. `server/hooks/tests/
    golden_session.rs` replays it with the hooks compiled in QuickJS. 43 of 47 deliberate mutations fail
    it; of the rest two are equivalent (a Hit Point floor no sheet reaches; an object left an object,
    which plays as the prop it would have become - `room.json` holds the making of it) and two wait for
    what reaches them (zones read again, and marked spots forgotten, when nothing between actions sets
    either). The world's 93 still all fail `golden_world.rs` after the change to how it holds its content.
  - **Part 4 is two halves.** What the game state part 4 needs, inventoried: a prompt waiting (a
    script's, with the conversation it opened), the fight (only begun - its loop is part 5's), where a
    script sends the party, the conversations, and what a view is handed (motions, numbers over heads, dice)
    are real; `ambush` and `approaching` exist only so a fight waits for tokens to finish drawing, and on a
    server a walk arrives in the same call, so they are not ported; the GM's turn is part 5's. The log's
    words for a journal land here, not with the fight: every use of a thing goes through `record`, whose
    reaction to a party's roll ends conditions that last until it - a world change on the first lock picked.
    (4a) using things and talking, out of a fight; (4b) walking - triggers begin fights - the movement
    circle, closing on a thing or a target, leaps.
  - **Things are used and creatures talked to** (`server/engine/src/game/play.rs`): `use_selected_on` - in
    reach, refused in the thing's own words, run - and the prompt it stops on held until
    `answer_pending`, the conversation `settle` opens on a `startDialogue` had reply by reply
    (`answer_dialogue`, `resume_outer`), `record` (the journal written down and acted on: the room's things
    and where a script sends the party, pools, a party roll's conditions spent), `settle_travel`, a
    creature on nobody's side talked to (`talk_now`), a container's window read and taken from, a portal's
    partner in this room or another (arriving beside it when travel settles), and a conversation set aside
    for somebody else and brought back (`sync_talks`). `game/log.rs` writes a journal down - every
    sentence, the dice, the numbers over heads, the tokens' motions - and a conversation's lines.
    - **A prompt waits between calls**: a script runner can be put down (`ScriptRunner::suspend`) and
      picked up again with the world and the dice (`SuspendedRunner::attach`), and the dialogue runner holds
      its dialogue by `Rc`, so a conversation in progress waits in the session.
    - **The fight's parts refuse, loudly**: a card offered on a roll to a table that asks (`ask_defender`)
      returns an error naming it, rather than doing something else quietly. (A journal that starts a fight
      refused here until 4b; a creature answering the party's roll and a countdown a roll moves, until 5a.)
      `sync_roster` walks a member the project dropped off the board only out of a fight, as the TypeScript
      does.
    - What the app ships gained the catalogue's item names (`Shipped::items`), for loot and keys.
    `play.golden.test.ts` writes `server/fixtures/play.json`: the demo's project, the default project, and a
    proving ground built on it (a portal to another room and one with no partner, a conversation nobody
    wrote, a stair that sends the party away and then asks for a roll, a condition that ends on the next
    roll and one that swells Hit Points, loot named from the catalogue, a party with no talent and a card
    that answers a failed roll), 24 sessions of 40 steps and a tour of the proving ground - things used,
    prompts answered, conversations had and set aside, windows read, taken from and shut, travel - each
    followed by the prompt waiting, the window open, everybody's place and pools, the log's new lines, what
    a view is handed, the room's things and the scenario. A session is cut where a fight would begin.
    `server/hooks/tests/golden_play.rs` replays it with the hooks compiled. 55 of 60 deliberate mutations
    fail it; of the rest two are equivalent here (travel settled while a prompt waits, which nothing does
    until a finished script can raise another; a conversation's outer script with no target, when the
    conversation hands its own to every script inside it) and three needed a fight: `fight.json` now fails
    a swing's miss, and talking to the dead and a conversation set aside broken off with somebody still
    standing are not reached there either.
  - **The party walks, pushes and jumps** (`server/engine/src/game/{movement,leap,fight}.rs`), in a fight
    and out of one: a click's meaning (`aim_of_move` - the walk, the nearest reachable spot out of a fight,
    as far as the circle allows in one, or a push), the walk (`walk_the_move`: a trigger stops it where it
    fires and begins its fight at once, since nothing waits for tokens to arrive; the others follow out of a
    fight), the movement circle and the push circle, the ground lit and the ground a push would open,
    closing on a thing, a creature to talk to or a target to strike, and the previews. The rolled moves are
    real: a push past the circle (`run_for_it` - the roll is the action; a success pushes the circle out a
    step and walks on, a failure holds them and hands the spotlight over), and a jump (`plan_jump`, a
    run-up found at a tenth of a tile, the arc kept clear of walls and ground, `leap_to` and the landing -
    getting up, going on alone, a trigger landed on, falling hurt, the fail condition). Both wait on their
    roll as a prompt (`OnDone::Run`, `OnDone::Leap`) when the dice are not rolled for them.
    - **A fight begins, stops and is closed** (`fight.rs`): an attitude turned hostile, a trigger, or a
      journal's `started` begins it; `ended` stands everybody down under a truce; `close_fight` ends the
      scene's conditions and the creatures' countdowns and forgets per-scene uses, once, in the log's words.
      Every action in a fight is spent (`act`), under the table's spotlight rules.
    - **What a fight answers was part 5's**: here `settle_fight` ran only when nothing waited to be
      answered, and returned an error naming what did; 5a plays all of it.
    - The project's jump rules are read (`jump_rules_for`, each field the engine's where it says nothing).
    `walk.golden.test.ts` writes `server/fixtures/walk.json` (about 5.8 MB): the demo, the default project, a
    drill yard built on it (a trip-wire that lays its user prone, a horn that begins the fight, a white flag
    that ends it, a platform three blocks up, a trigger on its corner) and the drill yard for somebody who
    cannot jump; 30 sessions of clicks - moves, previews, reach, approaches, talk, strikes, uses, answers,
    selection, travel, pushes and jumps with the arc and the Jump button's landings - and six tours of the
    drill yard, one fight each: prone and up, a jump asked, asked again, let go and made, onto the platform
    and off it, the fight begun by a landing or by the horn after a flag with no fight, pushes answered and
    let go, a detour inside the circle, one put outside it, the flag waved and the horn blown again. Each
    step is followed by the fight (its view, log and circles) and everything `play.json` records. A step that
    would settle a fight with a blow still queued, and a jump whose fall hurts, are probed and not made.
    `server/hooks/tests/golden_walk.rs` replays it (about 7 s at `opt-level = 1`, a minute unoptimised). 61 of
    66 deliberate mutations fail it; of the rest two are equivalent (a strike previewed from where they
    already stand, to which a walk plans no route anyway; a failed push's spotlight, which a failed roll
    already hands over), one is equivalent here (whether closing on a thing came up short, which only an
    animated view reads), and two are not reached (a fight begun again while it is on, and a spot inside the
    circle whose only way there leaves it).
  - **Part 5 is three halves.** `askDefender` draws the line: with nobody at the table asked, every
    question a fight puts to a player can wait, so (5a) is the fight loop played that way; (5b) is the
    questions - the defence a hit is taken with, a card offered on a roll, a blow, a wound or a miss, and the
    death move asked (Blaze of Glory, Risk It All, a card instead); (5c) is the action bar - a card used on
    the character's turn (`useAbility`: its targets, a point, a shape, tokens), which the six-part plan put in
    neither part 5 nor part 6.
  - **The fight is played** (`server/engine/src/game/{turn,features,answer,swing,blow,fight}.rs`), with nobody
    at the table asked anything:
    - **The GM's turn** (`turn.rs`): the party's turn ended (`end_turn`), what they carried for a moment
      shaken off, and the adversaries the encounter has waiting spotlighted while the Shadow lasts - Relentless
      keeping its place, a granted spotlight not billed, one it cannot pay for ending the turn. Each shakes off
      what holds it (a Shadow spent on what stops it acting), uses a feature worth using, or walks up (within
      Close for free, Very Far as the whole action) and swings. What a stat block's script does to the queue -
      a swarm that swung with it, arrivals, allies rallied at half strength, itself again, a creature replaced -
      is `after_adversary_script`. The spotlight counts are the session's `spotlit`, which the world's
      `spotlight_spent` reads (`bindTurn`), tied again whenever the world is rebuilt and not after travel, as
      the TypeScript ties it.
    - **A stat block's features** (`features.rs`): the one worth using (`adversary_feature` - one aimed at the
      nearest it can reach, one that works on itself, its own side, a summons, a clock or a rally that has
      somebody to call, or one that catches two of the party), what it costs the GM, its uses, the reactions
      it plays on its own, the script it runs (aimed at the nearest of the party), and the countdowns - ticked
      by the party's rolls and hits, and going off with their owner acting.
    - **What answers a moment** (`answer.rs`): the party's cards - a free one plays itself, and one whose
      script asks something waits as a prompt (`OnDone::Reaction`) holding whatever swing it was about; a
      stat block's reactions; the wounds (`playDamageReactions`, drained until quiet), a creature's own, an
      ally's and a bystander's; a party roll; a swing at somebody; the riders on a hit and a miss; a debt a
      condition leaves for whoever swings; ground that bites.
    - **The party's swing** (`swing.rs`): closed on, rolled, the roll put to the room before anything comes
      of it, the damage put to it, and the blow landed - counted again when a card grew it, named its band,
      forced it or doubled it, rebuilt when a card threw the dice again (`as_answered`, `as_rerolled`);
      minions fall to it. **The GM's** (`blow.rs`): what the room adds (`boostDamage`), a rally's half, the
      defence the engine decides, an aura's step down, Momentum and Terrifying, the riders.
    - **The settle** (`fight.rs`): the ground, the wounds, a creature that stops to talk at its threshold, a
      creature's last word (once per creature - entities carry a serial, since a summons can take a fallen
      one's id and the TypeScript tells them apart by the object), the death move (Avoid Death with its scar;
      a last stand that answers the fall instead), who is left standing, the countdowns a death sets off.
    - **A question being answered is still open**: the TypeScript's `answerPending`, `answerDialogue`,
      `resumeOuter` and `settle` leave the question in `pending` while its journal is recorded, and everything
      a fight settles reads that - a death move the answer's own roll caused waits. The session counts the
      depth (`answering`) and the fight asks `waiting()`. A creature's conversation over picks a GM's turn it
      stopped up again. `AbilityDef` gained text, target and uses, and `AdversaryDef` its features.
    - **A table that asks was refused** here, loudly - a defence, a card offered, a death move asked each
      returned an error naming them - until 5b.
    `fight.golden.test.ts` writes `server/fixtures/fight.json` (about 14 MB): the demo, the default project,
    a pit built on it and the pit alone - stat blocks of its own that are Relentless, carry Momentum, are
    Terrifying, are Minions or a Horde, with cards printed on them for every moment a fight raises, cards
    given to the party that play themselves at every moment theirs (a choice mid-swing, a reroll, a blow
    grown, a Stress cleared, a hold, a revival on a critical), a debt, a last stand, an aura, a lucky die, a
    creature that stops to talk, a white flag, and a lever that drops whoever pulls it wrong and arms a trap
    - in 28 sessions of up to 80 steps (a fight begun, swings, the turn ended, walks, the selection, things
    used, prompts answered) and two tours (the flag, a stood-down creature struck, a creature held). After
    each step its answer, the GM's turn, the fight, everybody's pools and conditions, the Shadow, the scars,
    the log, and what a view is handed. `server/hooks/tests/golden_fight.rs` replays it (about 40 s at
    `opt-level = 1`, six minutes unoptimised). 96 of 106 deliberate mutations fail it; of the rest three are equivalent (a fresh
    creature the GM cannot pay for skipped rather than ending the turn, when everything behind it costs the
    same; a card seen twice, when one ability answers one trigger; a card's Stress, when only free cards play
    with nobody asked) and seven are not reached (a creature talked round still waiting in the queue, a second
    pass of wounds that nothing logs between, a party member revived and falling again, a fight a script
    stopped in the middle of the GM's turn, a rally dearer than the allies it calls, a lieutenant's rally on
    the spotlight with nobody to call, and a rallied blow's odd total halved).
  - **The table is asked** (`server/engine/src/game/ask.rs`): with `ask_defender` on, every question a fight
    puts to a player is put and answered as the page puts it. The question has the session's `asked`, the
    other half of the TypeScript's one `pending` - never set while a script waits, and `waiting()` counts it.
    - **How a hit is taken** (`defenseChoices`, `offerOrLand`, `offerMiss`): take it, an Armor Slot, the
      reactions the defender can pay for alone and with a slot - each with the Hit Points it would leave, and
      a plan that changes nothing left out - the defender's cards' own scripts, an ally's card to step in front
      or make the GM roll again; and a card to answer a miss. The answer (`applyDefenseChoice`) lands a plan,
      plays a script and puts the blow again with what it said (`answeredWith`: softened, avoided, stepped
      down, seen coming), moves the blow to the ally who stepped in, or rolls the attack or its damage again.
      A card that stops to ask something of its own holds the blow (`OnDone::Answered`, `OnDone::Dodged`).
    - **A card offered** (`askReaction`): on a roll before anything comes of it, on the damage, on a wound,
      a hit, a miss or a roll - one character at a time, the rest queued behind, a swing waiting on the answer
      at the stage it was stopped, and a script stopped mid-roll carried on with what the cards said
      (`offerOnRoll`, `answerFrom`).
    - **The death move** (`askDeathMove`): Avoid Death, Blaze of Glory (the one last swing, critical, at the
      nearest the weapon reaches, and the veil), Risk It All (the Duality Dice), or a card that answers the
      fall - and the three put again when the card was not enough.
    - A defect from 4a fixed on the way: a raised roll's line read the number as text, and said
      "Another  goes behind the roll."
    `fight.golden.test.ts` also writes `server/fixtures/ask.json` (about 9 MB), its own file so `fight.json`
    stays as it was: the demo and the pit with cards in the party's hands worth asking about (wards, plate, a
    rune, a guard, a jinx, a parry, a sidestep, a riposte and a taunt, a push, a named roll, a reroll, a
    heavier blow, a cheer, a card against the fall), the boss's swing made direct and the swarm's of no kind,
    three of the party on their last Hit Point - 17 sessions with the table asked, each question answered
    with one of its options (now and then one that is not there, or stepping back), the death moves taken in
    turn. `golden_fight.rs` replays it too (about 15 s at `opt-level = 1`). 43 of 49 deliberate mutations
    of the questions and their answers fail it; of the rest one is equivalent (a card already spent offered
    again as a plan, when a plan ends the hit and a redirect is never a plan) and five are not reached (a
    defender with nothing but "take it", Risk It All with Shadow higher and with the dice matched, a card
    against the fall that was not enough, and a named roll paid for on a script's roll).
  - **The action bar** (`server/engine/src/game/bar.rs`): the abilities a character has, in bar order, with
    the cards a condition lends (`abilitiesOf`); whom one may be aimed at (`abilityTargets` - a foe, an ally, a
    fallen ally for a card that raises one, anybody, a group, only those it is worth aiming at - and a roll's
    own selector, `scriptTargets`); the tiles a card aimed at the ground may land on and whom it would catch
    there (`pointTiles`, `shapeAt`); whether it can be used now and why not (`canUseAbility` - not standing,
    a question open, a passive or a reaction, nothing the engine can run, only in a fight, the GM's turn,
    already acted, a cost in Shadow, Light or Stress, uses spent, its gate, nothing to aim at), and the bar as
    a view reads it (`abilityList`, with the card's words and its art); and using it (`useAbility`): the only
    valid pick taken when none was given, a group gathered, the price paid, the script run, the action spent
    in a fight when the script is done (`OnDone::Used`), the card put back - its price returned - when its
    roll is stepped away from, the vault. Tokens are placed again when what refills them comes round
    (`refillTokens`). `AbilityDef` gained `inCombatOnly` and `action`, its tokens what refills them.
    `bar.golden.test.ts` writes `server/fixtures/bar.json` (about 6 MB): the demo, the default project and a
    workshop built on it (a card in every hand for each way a card is aimed and limited, words on the card, a
    card a condition lends, a knot of foes by the door) - 16 sessions of the bar read, cards used on a pick
    that is there, one that is not, a tile or nothing, rolls answered or stepped back from, tokens refilled,
    with the fight going on around them, some with the table asked - and two tours (a mark that leaves one
    foe the only pick, the bar of one with no Stress slot left, a fallen ally raised).
    `server/hooks/tests/golden_bar.rs` replays it (about 7 s at `opt-level = 1`). 37 of 39 deliberate
    mutations fail it; of the rest one is equivalent (acting twice, when under the spotlight a member who
    has acted is still ready while the party holds it) and one is not reached (a card aimed at the ground
    with nowhere to land, when every band reaches some floor).
  - **The tests build at `opt-level = 1`** (`[profile.test]` in `server/Cargo.toml`): the fight's three
    replays took most of ten minutes unoptimised, and `cargo test --workspace` now takes about a minute. The
    times above at `opt-level = 1` are what `cargo test` gives; nothing need be set to get them.
  - **The kit** (`server/engine/src/game/kit.rs`, part 6a): the shops - what a seller still has, a limited
    line counted on its saved state (`shopContents`), the party's purse, buying and the word when it cannot
    pay (`buyFrom`), what a seller pays for one thing - its share, half unless it says, of its own price or
    the item's worth, never nothing, never its own coin (`offerFor`) - what the party could sell it and
    selling (`sellables`, `sellTo`), and a shop's wares taken through the container window, which is buying;
    wielding and wearing (`equipItem`, `unequipItem`: hands counted, a two-handed weapon freeing the
    secondary, armour not changed in a fight, the old piece back in the pack when an item stands for it,
    Armor Slots following the armour) and the HUD's line (`gearOf`); the binder's cards (`gearCard`,
    `gearView`); using an item (`useItem`: a consumable spent before its script runs, the action in a fight,
    a roll left waiting); the loadout and the vault as the sheet shows them, with the cards granted and lent
    and the numbers an attack would meet (`loadoutView`), a card recalled for its Stress or free at a rest
    (`swapCard`); a rest, short or long (`rest`: the loadouts set first, each character's two moves, Light
    for those preparing, uses, tokens, marked spots and conditions a rest ends, the GM's Shadow); and the
    cards a stat block prints (`statBlockCards`). The item stand-in in `game/content.rs` is the whole item
    now (`ItemName`: its kind, words, gear, worth, tier, picture and use).
    `kit.golden.test.ts` writes `server/fixtures/kit.json` (about 5 MB): the default project and a workshop
    built on it (a stall with a limited line, a fence that buys nothing, a pawnbroker paid in carapace, an
    empty stall; a scroll that asks a roll, a salve that braces until a rest, a relic, a weapon with no gear
    and one pointing at gear nobody has; more cards in each hand than a loadout takes; abilities a rest, a
    long rest and a scene refresh, a token a rest refills; cards a stat block prints) - 11 sessions of
    buying, selling, equipping, using, recalling and resting with the fight going on around them, and a
    tour of every refusal. `server/hooks/tests/golden_kit.rs` replays it (about 4 s at `opt-level = 1`).
    63 of 64 deliberate mutations fail it; the one left is equivalent (an item carried at nought shown in
    the pack, when taking the last of something takes its line away).
  - **Next**: (6b) saves - `saveGame`, `loadGame` and `loadGameText` with the save's schema and the scenario
    and scene snapshots', the seed's state kept, a saved room entered, and old saves migrated.
