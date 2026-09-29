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
| 2 | The rules, bottom up, each against fixtures: `grid`, `rules`, `character`, `dialogue`, `content` (serde schemas), `combat`, `script` (effects, runner, world, hooks in QuickJS), then the game layer (`movement`, `room`, `interaction`, `leap`, `save`, `shop`, `equip`) | every module's fixture passes in Rust |
| 3 | Game sessions on the server: the WebSocket protocol, the client's game layer as a view, the editor's playtest on the engine built to WebAssembly | the full e2e suite passes with play on the server |
| 4 | Co-op: several players in a session, turn ownership, visibility, reconnecting | two browsers play one fight |
| 5 | The internet: HTTPS, a real admin password, upload and rate limits, backups, a host | reachable from outside this machine |

## Running it

```bash
cd server && cargo test                                         # the Rust port against its fixtures
npx vitest run src/engine/grid/grid.golden.test.ts src/engine/rules/rules.golden.test.ts src/engine/character/character.golden.test.ts   # the fixtures are still what TypeScript does
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
    length let past the schema, is still refused by serde's `[T; 2]`). The modifiers' `when` stays the
    JSON it was written in until the conditions are ported with the script.
  - **A defect kept on purpose**: the Proficiency advancement costs both picks and adds nothing. `levelUp`
    adds `takenNow.get('proficiency')`, and that map's keys are `tier:kind`, so the lookup always misses.
    The Rust does the same, so the fixture holds; fix both, and the fixture, together (`docs/CRPG-GAPS.md`).
  - **Next**: `src/engine/dialogue`, then the rest of the content schemas - the serde port of the
    project document the character module began.
