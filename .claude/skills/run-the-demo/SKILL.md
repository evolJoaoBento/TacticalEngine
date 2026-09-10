---
name: run-the-demo
description: Launch and drive the PolyHeart demo in a real browser - open the app, walk the party into the vault fight, use cards, and screenshot what is on screen. Use when asked to run the app, play a fight, see a change working, or check the HUD and log rather than only the tests.
---

# Running the demo

A Vite + three.js page. There is nothing to click blind: `src/main.ts`
publishes about a hundred handles on `window.__polyheart`, and the
e2e suite drives the game entirely through them. Use that. Writing a
mouse-and-pixel driver for this app is wasted work.

```bash
npx playwright test tests/e2e/playpass.spec.ts --reporter=list
```

Playwright starts its own dev server on **8421** (`playwright.config.ts`).
`npm run dev` is **8420** and is for a human with a browser — do not start
it first and expect Playwright to use it.

## The driver

`window.__polyheart` — see the `declare global` block at the top of
`src/main.ts` for the full list. The ones that matter:

| Doing | Handle |
|---|---|
| pick a character | `select(id)`, `selected()`, `party()` |
| walk | `reachable()`, `moveTo(tile)`, `walkTo(x, y)` (a spot in tile units, where a click lands), `standBeside(id)`, `tileOf(id)`, `standingAt(id)` (the spot), `screenAt(x, y)` |
| fight | `inCombat()`, `adversaries()`, `attack(id)`, `endGmTurn()`, `round()` |
| cards | `setCards(id, cards)`, `abilities(id)`, `useAbility(id, ability, targets?, point?)` |
| aimed cards | `aim(ability)` for the legal tiles, `shape(ability, tile)` for what it catches |
| answer a prompt | `pendingKind()`, `answer(response)` |
| read the room | `log()`, `dice()`, `hitPoints(id)`, `stressOf(id)`, `conditionsOf(id)` |
| read the board | `zones()` for the ground a spell holds (tiles per zone), `floaters()` for the numbers rising over heads right now (read them in the same tick - they live 1.4 s) |
| objects | `objects()`, `use(id)`, `objectState(id)` |

Always `setDiceSpeed(0)` first, or the dice animation makes everything
wait. Drain prompts with
`while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 })`
— index 0 is always "let it pass" / "take it as it comes".

## Getting into a fight — the part that wastes an hour

`tests/e2e/playpass.spec.ts` has this as `intoTheVault`. Copy it. Four
things bite, in this order:

1. **A card refuses with "only in a fight."** Nothing is a fight until an
   encounter starts.
2. **`startFight()` is not enough.** It starts the encounter but leaves
   the party standing across the room from every adversary, so nothing is
   in range of anything. The demo's real route is: pick the **vault door**
   (`use(door)` in a loop, answering `{ kind: 'roll' }`), then walk east
   until `inCombat()` — the trigger past the door is what wakes the room.
3. **`standBeside(foe)` returns `false` across a room.** In a fight a
   character moves within Close range per turn (a disc round them, as the
   crow flies - not a count of steps). Close over several turns: move to
   the reachable tile nearest the foe, `endGmTurn()`, repeat. Out of a
   fight nobody counts: one click walks anywhere the floor goes.
4. **The closing loop moves whoever is *selected*.** If the caster is
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

What should be on screen after a card is used: the action bar with the
card and its cost, the party HUD (HP / Stress / Armor / Hope as pips, and
any conditions under the gear line), the Fear track, and the narrative log
bottom-right in tone colours. On the board: a blue ring breathing under
whoever is selected, shadows under walls and tokens, any zone painted as
one shape with a border (the Korvax circle is a purple square of nine
tiles at Melee - a diagonal is Melee too), in a fight the Close-range walk
lit as a disc with an edge round whoever is selected (out of a fight
nothing is lit: one click walks anywhere the floor goes), and a
number - "-2 HP", "+1 Stress", a condition's name - rising over whoever it
happened to for about a second.

## Related

- `tests/e2e/demo.spec.ts` — the big suite; the original route into the
  vault and the fight loop are near the top.
- `npm run test:e2e` runs everything, about 1.3 minutes.
