---
name: run-the-demo
description: Launch and drive the Tactical Engine demo in a real browser - open the app, walk the party into the vault fight, use cards, and screenshot what is on screen. Use when asked to run the app, play a fight, see a change working, or check the HUD and log rather than only the tests.
---

# Running the demo

A Vite + three.js page. There is nothing to click blind: `src/main.ts`
publishes about a hundred handles on `window.__engine`, and the
e2e suite drives the game entirely through them. Use that. Writing a
mouse-and-pixel driver for this app is wasted work.

```bash
npx playwright test tests/e2e/playpass.spec.ts --reporter=list
```

Playwright starts its own dev server on **8421** (`playwright.config.ts`).
`npm run dev` is **8420** and is for a human with a browser — do not start
it first and expect Playwright to use it.

## The driver

`window.__engine` — see the `declare global` block at the top of
`src/main.ts` for the full list. The ones that matter:

| Doing | Handle |
|---|---|
| pick a character | `select(id)`, `selected()`, `party()` |
| walk | `reachable()`, `moveTo(tile)`, `walkTo(x, y)` (a spot in tile units, where a click lands), `standBeside(id)`, `tileOf(id)`, `standingAt(id)` (the spot), `screenAt(x, y)` |
| steer | there is no handle: hold the left button on the board and they walk towards the pointer (`tests/e2e/steer.spec.ts`). Holding centres the camera on them, so aim from the middle of the screen, not from a `screenAt` taken before the press |
| who follows | `linked(id)` (their group), `unlink(id)` (they stand while the rest walk), `link(id, withId)`; out of a fight a walk brings the walker's group along, nobody else. With the mouse: drag a HUD card aside, onto another, or between two (`tests/e2e/link.spec.ts` has the drags) |
| fight | `inCombat()`, `adversaries()`, `attack(id)`, `endGmTurn()`, `round()` |
| cards | `setCards(id, cards)`, `abilities(id)`, `useAbility(id, ability, targets?, point?)` |
| aimed cards | `aim(ability)` for the legal tiles, `shape(ability, tile)` for what it catches |
| answer a prompt | `pendingKind()`, `answer(response)` |
| read the room | `log()`, `dice()`, `hitPoints(id)`, `stressOf(id)`, `conditionsOf(id)` |
| read the board | `zones()` for the ground a spell holds (tiles per zone), `floaters()` for the numbers rising over heads right now (read them in the same tick - they live 1.4 s) |
| objects | `objects()`, `use(id)`, `objectState(id)` |

Always `setDiceSpeed(0)` first, or the dice animation makes everything
wait. A check *clicked* through the UI is thrown on a card of its own,
which holds the dice until `[data-testid="accept"]` is clicked whatever the
speed; answering with `answer({ kind: 'roll' })` skips the card, and those
dice go to the tray as they always did. A move that wakes an encounter does not start it until the tokens
arrive; call `arrive()` after the move (or wait for `gliding() === 0`)
before reading `inCombat()`. Drain prompts with
`while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 })`
— index 0 is always "let it pass" / "take it as it comes".

## Getting into a fight — the part that wastes an hour

`tests/e2e/playpass.spec.ts` has this as `intoTheVault`. Copy it. Four
things bite, in this order:

1. **A card refuses with "only in a fight."** Nothing is a fight until an
   encounter starts.
2. **The map is 44x32 now** - the woods south and west, the vault's halls east - but the old room
   is still its north-west corner, so the door is at (12, 7), the spawns at (2, 7) and a tile index
   is `y * 44 + x`. It draws about twice as much as the old map, which is why `playwright.config.ts`
   asks ANGLE for the real GPU (`--use-angle=d3d11`) rather than SwiftShader: software rendering ran
   the demo at two frames a second and timed screenshots out, and the GPU runs it at forty.
3. **`startFight()` is not enough.** It starts the encounter but leaves
   the party standing across the room from every adversary, so nothing is
   in range of anything. The demo's real route is: pick the **vault door**
   (`use(door)` in a loop, answering `{ kind: 'roll' }`), then walk east
   until `inCombat()` — the trigger past the door is what wakes the room.
4. **`standBeside(foe)` returns `false` across a room.** In a fight a
   character moves freely inside a circle of Close range round where the
   spotlight found them (`reachable()` is the tiles inside it; a click past
   it is an Agility Roll that widens it a step, and a failure ends the turn).
   `attack(foe)` walks up to where the weapon reaches from before the
   swing when that is inside the circle, and otherwise closes to its edge
   for free (`attack` returns false). So: `attack(foe)`, `endGmTurn()`,
   repeat, rather than a closing loop of your own - `endGmTurn()` gives the
   party's spotlight up when it is theirs, then plays the room's turn.
5. **The closing loop moves whoever is *selected*.** If the caster is
   Mira, `select('mira')` *before* closing, or you will walk Kara up and
   then cast from where Mira never left.

## Look at the screenshot

`await page.screenshot({ path: 'test-results/whatever.png' })`, then
actually read the image. The play pass that added this skill found a
defect no unit test could: a condition was written to the log and the HUD
by the **id it is keyed by** rather than its name — "Kara is
holding-the-line". Every unit test agreed, because they all assert on
ids too. Screenshots are how you catch the class of bug where the engine
is right and the presentation is not.

What should be on screen after a card is used: the hand fanned along the
bottom (the card with its cost on its corner; passives as emblems above it;
the Light orb; End Turn), the party HUD down the left edge (HP / Stress /
Armor / Light as pips, and any conditions under the gear line), the Shadow
track under it, and the narrative log bottom-right in tone colours. On the board: a blue ring breathing under
whoever is selected, shadows under walls and tokens, any zone painted as
one shape with a border (Warding Flame's ring is an orange square of nine
tiles at Melee - a diagonal is Melee too), in a fight a blue ring on the ground: the
circle of Close range the selected one moves freely in, with a fainter amber
ring outside it for the ground a push would open (nothing is lit as squares,
in or out of a fight: one click walks anywhere the circle or the floor
goes), and a
number - "-2 HP", "+1 Stress", a condition's name - rising over whoever it
happened to for about a second.

## Related

- `tests/e2e/demo.spec.ts` — the big suite; the original route into the
  vault and the fight loop are near the top.
- `npm run test:e2e` runs everything: 79 tests, about 2.7 minutes.
- `docs/BACKLOG.md` - what to build next, and the rules that are not written elsewhere.
