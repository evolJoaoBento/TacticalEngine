# Tactical Engine — Backlog and agent startup notes

For whoever picks this up next. `docs/DEVELOPING.md` says how to extend the engine and
`docs/CRPG-GAPS.md` audits what exists; this file says **what to build next** and carries the
handful of working rules that are learned the expensive way rather than read.

## An object has a facing, and Alt turns it — done

Alt turned a prop in hand and left a door alone, because only a prop had a rotation in the
document. A door is the thing that most obviously needs one: it hangs in a wall, and which
way it faces is half of placing it. So an object carries a facing now, exactly as a prop
does — declared on the interactable (defaulted, so a document written before this is still a
document), drawn by `setObjects`, picked up with the thing, and landed with it.

`moveInteractable` came out of `relocate` for the same reason `moveDeco` did: `relocate`'s
idea of "nothing changed" is the position alone, and a door turned in its own doorway hangs
where it hung while the document is not the same. That is an edit, and an undo step of its
own. The kinds that can turn are now a list the controller keeps — a prop and an object —
rather than a check against one of them, so a creature and a party start, which have no
facing anywhere in the document, are still left alone.

Every place that builds an interactable by hand rather than through its schema gained the
field: the editor's own `newInteractable`, the legacy importer (a legacy map turned nothing,
so everything it brings in faces north), and the fixtures in three test files.

Verified: `npx tsc --noEmit` clean, `npx vitest run` 1967 passed, `npx playwright test` 127
passed in 6.1 minutes, exit 0 read off all three. Two tests are the new behaviour:
`move-edits.test.ts` turns an object without moving it and finds that an edit, with one undo
that takes the facing back and a move that keeps it; and `controller.test.ts` picks the chest
up with Select, turns it a quarter, lets go, and finds the document holding the new facing at
the same tile — then picks up a creature and finds nothing to turn, which is the line between
what has a facing and what does not. The browser suite matters here more than usual: this
changed a schema the saved games, the legacy importer and the pack round trip all read, and a
defaulted field is exactly what shows up there and nowhere else.

## Alt turns what the editor is carrying — done

Alt already faced a prop as it was placed: hold it, point the mouse the way the thing should
face, and the ghost turns a quarter at a time. It does the same for a prop already on the
board. Pick one up, hold Alt, and it turns where it hangs under the pointer; let go and it
lands facing that way, in the one undo step the carry already was. The gesture is the same
one, so there is nothing new to learn: the drag that faces a new crate faces the crate that
is already there.

Only a prop takes it. A creature, an object and a party start have no facing in the
document — nothing to turn, so Alt leaves them where they are rather than pretending.

Three things had to be true for it. `CarryMotion` keeps the facing it picked a thing up with
and applies it under the lean, so `turnTo` turns it in the hand without disturbing the swing.
`moveDeco` no longer goes through `relocate`, whose idea of "nothing changed" is the position
alone: a prop turned on the spot stands where it stood and the document is not the same, so
that is an edit and an undo step of its own. And the controller owns the whole gesture —
`turnBy` answers `carried` when the thing in hand took the turn and `placed` when it belongs
to the ghost — which is what kept `main.ts` at its pin (2454) rather than growing a branch.

Verified: `npx tsc --noEmit` clean, `npx vitest run` 1965 passed, `npx playwright test` 127
passed in 6.7 minutes, exit 0 read off all three. Three tests are the new behaviour:
`carry.test.ts` turns a thing while it hangs and finds it at rest facing that way with its
lean gone; `move-edits.test.ts` turns a prop without moving it and finds that an edit, with
one undo that takes the facing back; and `controller.test.ts` picks a prop up with Select,
turns it a quarter, lets go, and finds the document holding the new facing at the same tile —
and the same quarter twice reported as no change. `building.spec.ts`, which pins the placement
gesture (including that blur, not keyup, ends one), still passes untouched.

## An object stands in the room, and lights up when you point at it — done

An object with a model of its own was drawn only while somebody was authoring the scene:
`setAuthoring` built it, and going to play cleared it away with the rest of the marks. Every
door, chest and pillar in the game was therefore invisible the moment play began. Objects are
content, not authoring furniture, so they are drawn in both modes now (`setObjects`, beside
`setDecos`), and the gold mark is what it always should have been — the thing an author takes
hold of when an object has *no* body of its own. An object with `model: null` is still
invisible in play, deliberately; the demo's own door, stair and strongbox are all like that,
which is a line of content each and not a code change.

What the pointer is on is rimmed in white, and the rim is drawn through whatever stands in
front of it, so a chest half behind a wall reads as a whole chest. Only the rim ignores the
room: the pointing itself does not, so waving at a wall lights nothing, and an object is lit
only where it can actually be seen. It is the ink rim's own trick — an inverted hull on the
outline layer, which the editor never draws and no raycast ever finds — in white, with the
depth test off (`render/spotlight.ts`).

An imported model can be nudged across its tile as well as up and down (`offsetX`, `offsetY`,
in tiles), for a figure that should not stand in its own middle, and the Models panel shows a
picture of what the file will look like in the room: seated, scaled, turned, nudged, and
standing on the same base ring a token carries. The picture is kept under the settings that
made it, so tuning the scale redraws it rather than showing the old one.

The camera centre follows the storey being built on again. It had been pinned to the build
plane every frame, which is why it was narrowed to the build tools only — a pin like that
left Home unable to bring the view back down. It is an event now: `takeLevelChange` on the
controller says once that the plane moved, and every way of moving it goes through there, so
the ladder, Ctrl and the wheel, and Page Up all carry the view with them and nothing holds it
down afterwards.

Two extractions paid for the lines this cost: the journey a token takes is now
`render/glide.ts` (`planGlide`, `advanceGlide`), and the model edits are `editor/asset-edits.ts`,
which `session.ts` still hands out — the same move `creature-edits.ts` and `card-edits.ts` made,
for the same reason. `scene-view.ts` came out of it at 1469 lines.

Verified: `npx tsc --noEmit` clean, `npx vitest run` 1959 passed, `npx playwright test` 127
passed in 7.2 minutes, exit 0 read off all three. The bug itself is a test: an object with a
body drawn while nothing is being authored, and one without still invisible. `spotlight.test.ts`
covers the two rims, the layer only play draws and the fact that no raycast finds them;
`glide.test.ts` the journey the view no longer owns; `controller.test.ts` the one-shot the camera
follows; and `editor-panels.spec.ts` picks a model in a browser, reloads the page and finds it
declared with its data URL, then removes it and finds it gone — which is what caught an import
whose write had not been waited for, and would have been lost with the tab.

The rim took three goes and was read as pictures each time. Drawn with the depth test off it
covered the thing it was meant to ring; drawn `GreaterDepth` as a pushed-out hull it was
occluded by the very thing it belonged to, which came to the same white blob. What works is two
rims: a hull pushed out and drawn with the room, which shows only past the silhouette, and the
thing's own shape at its own depth, which draws nothing where it can be seen and comes through
where a wall is in front. The last screenshots show a crate on the grass — plain, then rimmed
under the pointer, then plain again — and a pale shape through the stonework when it stands
behind the wall.

## An imported model sits where it is put, and is still there tomorrow — done

Three things were wrong with a model a designer imports, and the first was the one on
screen: nothing seated the file. Every model the library builds stands with its feet at
y = 0 and centred over its tile (`buildModel` says so in as many words), but a glTF arrives
around whatever origin it was exported from — the middle of a crate, a character's hips —
and the view cloned it, scaled it about that origin and put it down. A cube modelled about
its own centre stood half buried; worse, `scale` multiplied the offset, so resizing *slid*
the model off its tile instead of growing it there, and `groundOffset` could not fix it
because the drift is sideways as much as down. `seatOnTile` (`src/engine/render/assets.ts`)
measures what actually arrived and moves it onto the tile, after the rotation and scale are
on, so the two settings mean one thing each again: one sizes it, one deliberately sinks or
floats it. A file with nothing in it to measure is left alone, which is what the existing
tests hand the loader.

The second was that a change of model never reached the board. A token is built once per
creature and kept; `tokenModels` recorded what each was drawn from and nothing ever compared
it, so a creature re-skinned where the document is written kept the body it was first drawn
with — in play, where it matters most. `syncTokens` now asks what the entity should be drawn
with every time and drops the token when the answer changes, taking its history with it so
the replacement is put down rather than walking in from wherever the old one stood.
`assetChanged` was already doing exactly this for a file that arrives late, and now both go
through the one `dropToken`.

The third was that an import did not survive the tab. The file rides inside the project
document — that was true and stays true — but the document itself is not kept in the browser,
so every model imported into it was lost on reload. `src/editor/model-memory.ts` keeps the
declarations in IndexedDB (not `localStorage`, where the saves live: one rigged character is
several megabytes), and the editor lays them back under the project as it opens. A project
that declares a model of its own wins the id every time, a model removed in the panel is
forgotten for good, and a scale tuned in the panel is the scale it comes back at. The store
is injected, so the rule about what comes back is driven by a Map in the unit tests.

`placementCentre` moved to `render/layout.ts`, beside the rest of the grid-to-world
arithmetic, which paid for what this cost `scene-view.ts` (1493 lines, against the 1500 ceiling).

Verified: `npx tsc --noEmit` clean, `npx vitest run` 1946 passed, `npx playwright test` 127
passed in 8.3 minutes, exit 0 read off all three. `seatOnTile` is driven on a box modelled
well away from its file's own origin — centred and stood on the ground, and at twice the
scale the same spot rather than twice as far off it — and again from the view's side, where
a token wearing an imported file is on its tile, on the ground, and grows in place when the
asset is retuned. The re-skin has a test of its own: a token built from another id is a new
token, put down where it stands with nothing gliding, while the same id twice running keeps
the token it had. The seating was read as pictures too, with a unit cube, which is modelled
about its own centre: half buried before, standing on the grass after, twice as big in the
same place at twice the scale, and the same again in play. Remembering is driven by a Map in
`tests/unit/model-memory.test.ts` — the project wins the id, a removed model stays removed,
an unreadable row is skipped — and in a browser by `tests/e2e/editor-panels.spec.ts`, which
picks `Fox.glb` through the panel, reloads the page, and finds it declared with its data URL
still inside; removed in the panel, it is gone through the next reload.

## The camera is levered towards looking down as it pulls back — done

Close up the angle is the player's: that is where the room is looked at from, and a low
camera is what makes it a place rather than a plan. Pulled back it is a different question —
where is everything — so the pitch is now floored by the distance, from complete freedom at
the nearest zoom to nearly overhead at the furthest. The floor is measured on the logarithm
of the distance, because zoom multiplies: a notch of the wheel moves it by about as much
wherever it is turned, instead of crawling up close and lurching far out.

What a player asks for is never thrown away. `orbit` writes the angle they dragged to, whether
or not this distance can show it, and the camera is seated above it while it cannot — so
dragging flat while zoomed out does nothing on the spot, and then zooming in arrives exactly
at the angle they set. `farPitch` joins the limits, so a test can set it.

Verified by the same three runs. `pitchFloor` is driven at both ends of the zoom and for the
evenness of a wheel notch across it, and the camera's own tests cover what a player would
notice: the clamps still hold at the nearest zoom, all the way out the angle is the far
view's whatever was asked for, and an angle dragged while it could not be shown is handed
back on the way in. Two existing tests changed with the behaviour rather than around it —
'never goes flat or overhead' now runs at the nearest zoom, where the floor is the old
minimum, and framing says what it now does: the angle is kept, and seated for how far out
the fit puts the camera.

## A check is thrown the way Baldur's Gate 3 throws one — done

The roll a player is asked for was a prompt in the corner of the panel, answered with a
button, with the dice tumbling somewhere else afterwards. It is a step of its own now.
Using something that wants a roll blurs and darkens the room behind a card that names the
roll, shows the Difficulty, sets both d12s down with the modifier beside them and offers
each Experience as a chip to spend a Light on: Roll, or Cancel and go back to exploring.
Roll throws the dice on the card — they tumble and land face on to the player, showing what
the rules already rolled — and then the sum is read out a term at a time: the Light die, the
Shadow die, whatever is added to them, the total, and what it was against, each landing on
the one before it until the verdict pops on the end of it. A term lands every six tenths of
a second, the first a little sooner. Accept waits for the sum, so the
result is read before the room moves again, and a press anywhere on the card skips to the
end of it. Escape is Cancel before the throw and Accept once the sum is in, and the card
keeps the overlay's own keys — Enter passes the turn, Tab picks the next character — off
itself while it is up.

The dice are dice now, not the flat pentagon badges the tray drew: `src/game/ui/d12.ts` is
the dodecahedron itself — twelve pentagons numbered so opposite faces make thirteen, turned
by a seeded throw and flattened to polygons, each face in the board's three flat bands with
its number carried on it and the whole solid ringed in ink. Nothing is downloaded for it and
no image ships. `Die.tsx` draws one, the card and the tray share it, and only the throw a
card made is shown on that card: a swing, a reaction, or a check a script answered for the
room goes to the tray behind, which waits its turn. That is also why a test driving the game
through `answer({ kind: 'roll' })` never meets the card at all.

The check prompt left `PlayPanel`, which paid for the card in `main.ts` (pin 2455), and the
Agility Roll test moved out of `demo.spec.ts` (pin 2879) into `tests/e2e/roll.spec.ts` with
the rest of the rolls.

Verified: `npx tsc --noEmit` clean, `npx vitest run` 1934 passed, `npx playwright test` 126
passed in 8.3 minutes, exit 0 read off all three. Eight of the unit tests are the die's own
geometry (`tests/unit/d12.test.ts`): twelve pentagons on a sphere, opposite faces making
thirteen, corners wound the same way round every face, a throw that only ever turns — never
squashed or mirrored — and one that ends showing the face the rules rolled, however long it
took. `tests/e2e/roll.spec.ts` drives the card at the vault door: asked, cancelled back to
exploring, asked again, thrown, tallied and accepted, checking the faces on screen are the
faces the engine rolled and that the tray behind never shows the same dice again. Its four
screenshots were read — the card asking, the dice in the air, the moment they land, and the
sum with its verdict.

## The play UI goes Slay the Spire — done

What the user meant by the cartoon ask: the UI. The navy glass and bronze hairlines are gone. Every
panel, button and card is warm leather or wood with a thick ink line round it, a gold hairline
inside, and a hard drop shadow instead of a blur; names and numbers are Kreon, Slay the Spire's own
face, in white outlined in ink. The party are plaques, the selected one lit gold; pips are chunky
bevelled bars. The Light orb is the energy orb, bigger, glowing, a slow swirl turning in it. End
Turn is the big blue button rimmed in gold (Rest the same in amber), buttons press down, the relics
sit on a wooden shelf. Cards are framed in their domain's colour with the name on a ribbon across
the top, the art in an ink-rimmed window, the rules in cream on a dark inset, and the cost gems
hanging off the corners where Slay the Spire puts its energy cost, clear of the name; a playable
card glows cyan. The deck browser, the rest and the level-up sheets wear the same leather, and a
floater is a big inked number that pops. The hand's widths are untouched; a seven-card hand still
fits and a hovered card still grows where it stands. Two things the screenshots caught: the cost
gems first sat on the name, and then were clipped, because `cards.css` loads after `hud.css`
(PlayPanel imports it first) and `.face` won a tie with `.hand-card` -- the hand's rule is
`.face.hand-card` now, with a note. Kreon is vendored with its SIL OFL (`public/fonts/kreon`); it is
the one third-party file, credited in `CONTEXT.md` and guarded by `licensing-boundary.test.ts`.

`npx tsc --noEmit` clean; vitest **1926 passed (1926)**; Playwright **125 passed (6.4m)**, `EXIT 0` --
a minute and a half slower than before the cartoon work (4.9m). New: `licensing-boundary.test.ts`
fails if a font is tracked without its licence beside it. Screenshots read for exploring, a fight,
a hovered card, a seven-card hand and its hover, the rest, the loadout's deck browser and the
level-up sheet, and a floater close up.

## A kind of ground can be drawn with a model - done, and too slow

A terrain type can name a model the way an adversary does. `terrain('floor', { model:
'plank' })` stands one on every floor tile, at that tile's own height, from the library or
from anything the project imported - so a `.glb` dropped into the Models panel customises
the ground exactly as it customises a creature. Terrain mode's Ground tab has the picker,
beside the ground it paints.

The ground mesh is still built underneath, deliberately: a tile model is a look, and the
grid is what a raycast hits, what a walk costs and how high a tile stands. A file that
fails to load leaves the room playable.

**It is too slow to use on a whole floor.** 290 floor tiles carrying the library's `crate`
took the editor from 35 frames a second to 1. `buildTileModels` makes one `BuiltModel` per
tile, so that is 290 groups, 290 draw calls and 290 base rings. Clones share geometry, so
the memory is fine and the draw calls are not. Usable today for a sparse type - a few
tiles of something - and not for floor. The fix is instancing: one `InstancedMesh` per
model with a matrix per tile, which is a rewrite of `tile-models.ts` and not of anything
around it, because the module was kept apart from `SceneView` for exactly this reason.

Three things had to be fixed before a single crate appeared, and each looked like the
feature working when it was not:

- `rebuildTerrain` built a grid from the document using `activeGrid.palette` - the palette
  the grid already had - so a type given a model went on being drawn as a colour. The grid
  object cannot be swapped (the camera, the party and the view all hold it), so `TileGrid`
  gained `adopt`, which takes the palette across with the tiles.
- The picker ran its edit straight off the session. That notifies the session's own
  subscribers, which redraws the panel and nothing else; `EditorController.onChange`
  ('terrain') is what reaches the viewport. Every other tool already went through the
  controller. The picker now does too.
- Twice the frame rate was measured on a board drawing nothing and read as "essentially
  free" - 38 to 37. A number measured before the picture is worth nothing.

## A walk ran in slow motion while the room loaded - done

`main.ts` advanced the world by `Math.min(0.1, elapsed)` each frame. The cap is there so a
tab left in the background does not come back and jump the world forward by a minute. But
it also means a frame longer than 100ms advances the world by 100ms however much wall
clock actually went by - and parsing a glTF of 13-22 MB on the main thread takes hundreds
of milliseconds. Below ten frames a second the animation stopped being time-based and ran
in slow motion. A walk of about a second took eight while the room's ten models loaded.

Half a second keeps the guard for a backgrounded tab, where the delta is measured in
minutes, and lets an ordinary stall through at its real length.

This is what `demo.spec.ts:1799` had been failing on: `gliding()` not reaching nought
inside the test's five seconds. Three runs of three now pass, in about eight seconds each.

The road there is worth recording, because four things were blamed first and none of them
was it. **Toon shading** was not (the test failed identically with `toonify` reverted).
**Eager loading** was not (the fox lands in 168ms; and note the test calls `setMode('edit')`,
which mounts the Models panel, and the panel still asks for every declared model as its
rows are drawn - so making that per-row rather than `requestAll()` changed nothing on this
path, and the earlier claim that it would was wrong). **The glide-discard** above was not
(the test timed out identically with that guard toggled in and out). What settled it was
the A/B nobody had run: the test passes three of three with the ten models undeclared and
fails three of three with them declared, and that pointed at load stalls rather than at
anything the renderer was drawing.

## A sync mid-walk threw the walk away - done

`syncTokens` sets a token's drawn spot to where the engine has the creature at the end of
every pass. So the *next* sync, landing while the token is still walking there, reads as
"not moved" - and the branch that handles that case deleted the glide and snapped the
token to its destination:

    this.glides.delete(entity.id);
    this.placeToken(token, entity);

The idle clip is played by `advanceGlides` when a glide *arrives*. A glide deleted never
arrives, so what this left behind was a token standing at its destination with the walk
clip still playing on it - `gliding()` at nought and 'Run' on a creature that had stopped.

Nothing synced mid-walk often enough to meet it until the game began shipping models:
`assetChanged` syncs every token each time a file lands, and there are ten of them. A
glide under way is now left alone unless the caller asked to snap (`options.snap`), and
`scene-view.test.ts` has the case: move a token, sync again part-way, and the journey and
the position both survive.

**Not the cause of `demo.spec.ts:1799`.** That test was run three times with this guard in
and three times with it toggled out, and timed out at line 1822 - `gliding()` never
reaching nought inside five seconds - every time, identically. The guard is neutral there.

It was the frame delta, and that is its own entry below.

## The board comes back off cartoon — done

The look went on the board in `The board goes cartoon` below and came off again here, so
this is the half worth reading: what broke it was not taste but reach.

Imported glTF models could be lit on the same ramp — `toonify` did it, and kept each
model's texture, normal map and facing while doing it — but they could not be *rimmed*.
A rim is an inverted hull, and closing one means merging vertices across the whole
geometry: instant on a library crate of forty vertices, seconds on a sculpt of two
hundred thousand. Nor could they be faceted, because faceting throws away the normals a
sculpted mesh was authored with. So the room had ink round every procedural part and
none round any imported creature, and smooth sculpts standing among flat-shaded props.

Asked to choose, the user chose consistency: if the imports cannot carry it, the rest
should not either. `toonMaterial`, `toonGradient`, `toonify`, `addOutline` and `inkEdges`
are gone; library parts, the ground and the construction layer take a `MeshStandardMaterial`,
which also means a spec's `metalness` and `roughness` — carried in `MatSpec` all along and
swallowed by the ramp — reach the material again.

What stayed is the white hover rim (`spotlight.ts`), which is a thing you need to see
rather than a style: `OUTLINE_LAYER`, `smoothHull`, `outlineMaterial` and `xrayMaterial`
are what `toon.ts` is now, 95 lines of it where there were 241.

Verified: `npx tsc --noEmit` clean, `npx vitest run` 1966 in 107 files (nine tests of the
ramp, the ink and the relighting deleted with what they tested), and the room, the vault
and a hovered door screenshotted — plainly lit, no ink, and the door still rimmed.

## The board goes cartoon — done

The user asked for the player view to look more like Slay the Spire's cartoon, and liked what
the board became, though what they meant was the UI (the next entry). Light falls on every model,
the ground and the construction pieces in three flat bands (`MeshToonMaterial` on one shared ramp,
`src/engine/render/toon.ts`), faceted as before. Models wear an ink rim: an inverted hull per lit,
solid part, its normals averaged so a box's rim does not split at the corners, skipped for fx,
glass and specks like eyes. A hull only draws a silhouette, which left a raised slab's front edge
bare, so the ground is inked along its creases instead, as lines a few screen pixels wide, found
over the whole ground at once so two kinds of ground meeting on the level draw no border. Rims and
lines live on a layer only play's camera turns on: the editor stays plain, and no raycast ever
hits one. The light is warm (a candle sky, a plum bounce, an afternoon sun), the backdrop a warm
dark instead of navy, shadows `PCFShadowMap` (what was already running, without the deprecation
warning in every log), and play grades the canvas a little richer with a vignette, in CSS, while
the HUD is up. The floaters' inline styles moved into `hud.css` to pay for the one line in
`main.ts`, and its pin came down to 2457.

`npx tsc --noEmit` clean; vitest **1925 passed (1925)**; Playwright **127 passed (6.6m)**, `EXIT 0` -- the
125 committed specs and two local screenshot specs. New: `toon.test.ts` (the ramp's three nearest
bands; a closed hull with outward normals; the ink shader's push; a rim on its own layer that no
raycast hits; a slab's twelve creases; one ink over the ground with no border between two kinds of
ground) and a `build.test.ts` case (a rim only when asked, never on fx, glass or a speck, sharing
its hull). Screenshots and close-ups read: models rimmed, slabs and steps inked, no squares on the floor.

## Carry anything, with a lift, a swing and a drop — done

The user's ask: a pickup animation, a hover where the bottom lags, a drop animation, and all of it
in the Inspector for props, objects, players and enemies. Three things stood in the way. Objects
and party starts were drawn nowhere, so there was nothing to take hold of; the editor draws them now
(`src/engine/render/authoring-marks.ts`: the legacy blue ring with a pawn for a party start, a gold
ring and a gem for an object with no model), and play still does not. The document moved on every
tile a drag crossed, and each move rebuilt every authored group, so an animation on the carried one
would have been thrown away a tile later; the controller now carries a thing for as long as the
pointer is held and moves it once, on release (`move-edits.ts`, which replaces `creature-edits.ts`),
so a carry is still one undo step and a click is none. And a press read the ground under the pointer,
so a click on a creature's body or a pine's crown took the tile behind it, and a door in a wall took
the wall; Select and the creature tool now take the thing drawn under the pointer when the ground
does not hide it (`SceneView.authoredUnder`). The motion is `src/engine/render/carry.ts`: the thing
lifts with a small overshoot and stretch, hangs from its top under a critically damped follow while
its bottom swings behind on a looser pendulum, floats while held still, and on release falls onto
wherever the document now has it and squashes with one bounce. The Inspector's Select takes an
object first, then a creature, a prop, a party start; Combat's Select a creature, then a party start.
A prop or a party start leaves the Inspector showing its hint, as bare ground does: neither has a
panel yet. `inspectTile`'s body moved from `main.ts` to `src/game/inspect.ts` to pay for the wiring,
and the pin came down to 2467. A follow-up: Select took the build ladder's level for where a thing
lands, though the Inspector never shows the ladder, so a raised creature pressed and let go dropped to
the ground and a ground prop dragged after building upstairs floated; Select now keeps a thing's own
height and only the creature tool, with its ladder on screen, uses the level. And a carry ended early
by a hotkey or Ctrl+wheel, before the thing moved, left it hovering until the next press; letting go
with nothing held now drops whatever the view still hangs.

`npx tsc --noEmit` clean; vitest **1917 passed (1917)**; Playwright **125 passed (5.0m)**, `EXIT 0`. New:
`move-edits.test.ts` (each kind moved and undone; no-ops), `carry.test.ts` (the follow never overshoots,
the lean trails the motion, the drop squashes and settles), two `authored-view` tests (marks drawn,
lifted and dropped; the ray pick, and a wall hiding it), five controller tests (all four kinds carried
in the Inspector, one undo each; `carried`; nothing moves before the release; no landing on another;
props stack) and `inspect.test.ts`. `carry.spec.ts` carries one of each with the mouse and undoes
them, and fails against the committed code. Close-ups read for the lift, the swing, the landing and
the rest.

## Pick a creature up and put it down elsewhere — done

The user's ask: a placed enemy has to be draggable. Nothing could move one -- `updateAdversary`
changes a creature's model, name and Hit Points, not where it stands -- and pressing the place tool
on one stacked a second creature on top of it. Now a press on a placed creature, with Select or
with the place tool, picks it up; the drag carries it tile to tile at the plane's Z, as a fresh
placement would be; letting go drops it. It waits on the last free tile rather than landing on
another creature. `moveAdversary` (`src/editor/creature-edits.ts`, since `session.ts` is pinned)
coalesces per creature, so the whole carry is one undo step back to where it was picked up, and a
press without a drag is no step at all. Props and objects do not move this way yet.

`npx tsc --noEmit` clean; vitest **1894 passed (1894)**; Playwright **124 passed (4.8m)**, `EXIT 0`. New:
`creature-edits.test.ts` (a move, one undo for a whole carry, no-ops) and three controller tests
(Select and the place tool both carry; never onto another creature; a click is no step);
`creature-drag.spec.ts` drags with the mouse and undoes, and fails against the old controller.

## The strip shows what it puts down — done

The Combat strip was six grey tiles with a letter on each, and Props and Objects the same: the
strip fell back to a label's first letter for anything that was neither a Tile nor a colour. Now
`src/engine/render/thumbnails.ts` draws a model as Blender's asset browser previews one -- built
once, framed by its bounds, lit, drawn into a small canvas with a WebGL context of its own (made
on the first picture, so play never opens it) and kept as a data URL -- and `main.ts` hands it to
the editor as `thumbnail`. A creature resolves the way the board resolves it, `modelForEntity`'s
order and then `fallbackFor`'s husk, so its picture is what will stand there when it is placed,
and a husk drawn for a creature with no model of its own is marked **stand-in** -- six identical
bodies unlabelled read as placeholders as surely as six letters did;
an imported glTF prop gets its picture when its file arrives. Objects place no model, so they are
drawn as icons in the Tiles tab's style, and the Tiles icons lost the lavender they kept from the
purple theme. A name too long for its card wraps to a second line instead of being cut
("Wandering He..."). A browser that will not give the second canvas WebGL still gets the letters.
And an empty tier said "Nothing matches." -- a search's words, when nobody had searched: the pack
has no creature above tier 2, so Tiers 3 and 4 say "Nothing in Tier 3 yet." now, dimmed on the bar.

`npx tsc --noEmit` clean; vitest **1888 passed (1888)**; Playwright **122 passed (5.2m)**, `EXIT 0`. New:
`thumbnails.test.ts` (which model a picture is of; no picture and no recorded miss without WebGL)
and `library-thumbnails.spec.ts` (every creature and prop card a picture, every object an icon, no
letters, stand-ins marked, an empty tier said so); screenshots read for all four tiers and each tab.

## The editor goes Blender-grey — done

The user's second direction, with Blender's startup screen as the reference. The purple is gone:
`editor.css`'s tokens are Blender's greys (`#181818` bar, `#303030` regions, `#3d3d3d` raised,
`#1d1d1d` fields, `#1c1c1c` seams) with its blue (`#4772b3`) on the one selected thing and white
text on it, never blue text on grey. The floating rounded cards are flat regions flush to the
edges: the rail down the left, the properties panel down the right, the library strip along the
bottom between them, the top bar's modes as tabs underlined in blue, section headings as the
raised strips Blender's panels have, and the Content workspaces filling the editor rather than
floating in it. `editor-shell.spec.ts`'s colour test now pins the grey. The workspaces' own
layouts (Quests is still one row in a corner) are the next slice, not this one. Two leftovers the
screenshots showed went after: the build grid and the ghost piece were still purple -- three.js
colours in `building-view.ts`, not CSS -- and are grey and the editor's blue; and Piece height was a
heading wrapping its own input, which the new heading strip swallowed. The 3D viewport behind the
editor was still play's navy; it is Blender's grey now (`#393939`, set in `setAuthoring`, so play
keeps its dark ground), with the build grid lightened to read on it. The side panels were 96% opaque,
so a bright board ghosted through them; they are solid now, as Blender's are. And the tool rail was
one icon tall at the top-left, leaving dead board under it: it runs down to the library strip now,
and the strip runs to the left edge under it, as the user asked. And the heading strip painted
itself over fields wherever `ph-heading` sat on a `label` wrapping its own control -- the Combat
panel's selected creature and the Models workspace, which Piece height had been patched around one
at a time: a label is inline, so the strip's padding took no room and covered what was above and
below. Such a label is Blender's property label now, muted over its control, and only a `div`
heading is a strip. The same screenshot showed the rule that sets a panel's first heading flush
under its edge (10px up) catching the first heading of any block inside a panel, so "Selected
creature" rode up over the hint above it; it applies to a side panel's own first heading only.
`panel-layout.spec.ts` reads the panels' boxes, which is how either would have been caught.

`npx tsc --noEmit` clean; vitest **1886 passed (1886)**; Playwright **121 passed**, `EXIT 0`, with the
colour test retargeted. Screenshots read: the four modes, the Content menu, the Cards and Party
workspaces.

## The hand — done

The user's direction, with Slay the Spire as the reference: the card interaction has to be a
hand. The action bar's row of chips along the top is gone. The selected character's actions and
reactions are card faces (`.face`, the deck browser's) fanned along the bottom, tilted away from
the middle, a card lifting and growing under the pointer to show its whole text, the Light cost
a gold coin on its corner and the Stress cost a violet one, an unplayable card greyed with why
along its foot. Passives are not cards to play, so they are relics: small emblems above the hand
with their text on hover. The Light orb at the hand's left is the deck-builder's energy; End Turn
at its right is the hex button. The party HUD moved to a column down the left edge, Baldur's
Gate's portraits, so the bottom belongs to the hand. `ActionBar` keeps its name, its props (plus
`light`) and every testid; the slot basis shrinks when the hand is large, so a hand of fourteen
still fits between the HUD and the panel. `main.ts` paid its one new line with two collapsed
imports (2,540 -> 2,518). Then, on the user's look: the card grows where it stands, anchored at
its foot so it stays under the pointer, and its neighbours slide aside (`:has()` for the ones to
its left); the relics moved to the top centre so a lifted card never covers them. That cut still
overlapped: the fan sized itself from its content, which is nothing (the faces are positioned), so
it shrank to about 280px and piled onto the orb and End Turn, and a 34px push did not clear a card
grown half again. Now the fan takes the room between them, a slot is that room shared out (`cqw`,
at most 96px), and a hovered card's slot widens to hold it: while the row has room the others step
aside and the grown card stays exactly where it was; once it has none (seven cards and up at 1280px)
they squeeze, the grown card sits over its neighbours as a deck-builder's does, and nothing leaves
the fan for the orb or End Turn. A cut that slid the neighbours by a fixed amount ran a big hand's
end cards onto both; so did keeping the spare room as padding outside the slots, which left a
four-card hand nothing to spread into. The fan's whole tilt is held to about twelve degrees, and the resting cards
stand high enough to show the reason along their foot. And the GM strip's Shadow label ran into its
pips -- the row shrank the label to fit twelve of them; neither shrinks now, and the GM's pips are
narrow enough that twelve fit on the line.

`npx tsc --noEmit` clean; vitest **1886 passed (1886)**; Playwright **121 passed**, `EXIT 0`, every
existing card test clicking its card in the fan. Screenshots read: exploring, hovering, in a fight,
hovering in a fight; the four fixes they asked for (slot basis, clipped bottoms, the hex button's
padding, the hovered card growing to its text) went in before the run.

## The level-up sheet and the dice tray follow — done

The two play surfaces the HUD restyle left in the old grey. `LevelUpPanel` is the rest's modal,
taller and scrolling: the name and level in Georgia, the pick count as the browser's pill,
eyebrow caps over each section, each pick in its own framed row, the new card's text quoted
under a gold rule. The dice tray keeps its dice and puts the readout on a gold-framed pill, the
verdict in Georgia, green or red. Reading the screenshots found a defect older than the restyle:
the tray sat at 18% from the top, exactly under the action bar, which painted over it -- with a
character selected the dice have been landing behind the bar. It is at 36% now and above the
overlays, and `demo.spec.ts` never noticed because it reads the tray's attributes, not the screen.

`npx tsc --noEmit` clean; vitest **1886 passed (1886)**; Playwright **121 passed**, `EXIT 0`. A restyle
and a placement: the screenshots were read (sheet with two picks; dice tumbling and settled), and
the tray's move is what made the second pair possible at all.

## The play HUD speaks the deck browser's language — done

Screenshots of every screen (`test-results/shots/`, a throwaway spec) showed the split: the editor
has its purple, the deck browser has gold on navy with Georgia for names, and the play overlay
had neither -- grey rounded boxes, hollow square pips, four accent colours, system-ui everywhere,
a name floating loose in the action bar and three Save buttons hanging in a corner. Now
`src/game/ui/hud.css` names the browser's palette once (`--play-*`) and `PartyHud`, `ActionBar`,
`PlayPanel` and `RestPanel` wear its classes: one surface, one border, one accent (gold is yours),
Georgia for names only, eyebrow caps for labels, pips as lit bars in the dice's colours (Light
gold, Shadow violet), the GM's strip shaped unlike a character's, the acting character as the
bar's title with the turn under it, the verbs as buttons under the bar rather than a second box,
the saves as ghosts. The log's tones follow: good is the Light die's gold, bad the Shadow die's
violet, and the floaters over heads read `TONE` too, so they changed with it. Anchors, testids
and pointer rules are as they were. Still in the old look: `LevelUpPanel`, the dice tray's
readout, and the editor's Content workspaces (Quests is an empty panel with one row in a corner).

`npx tsc --noEmit` clean; vitest **1886 passed (1886)**; Playwright **121 passed**, `EXIT 0`. A restyle:
no new test, since nothing asserts on colours; the screenshots were read, every one, and the two
defects they showed (a pip label under its pips, the card row wrapping under the name) fixed
before the run.

## Middle drag orbits, Ctrl + wheel climbs — done

A middle drag turns the camera in play and in the editor alike, where the left button belongs
to the tool in hand; a right drag still pans. In the editor, with a placing tool in hand, Ctrl +
wheel moves the build level a quarter tile a notch with the pointer anywhere over the board --
the height ladder's own wheel, without having to reach it -- and ends an Alt rotation first,
as Page Up/Down does. Both are `main.ts`'s events; the camera and the ladder are unchanged.

`npx tsc --noEmit` clean; vitest **1886 passed (1886)**; Playwright **121 passed (4.6m)**, `EXIT 0`. New:
`tests/e2e/camera.spec.ts`, two tests -- a middle drag turns and does not move the target in both
modes while a right drag still pans, and Ctrl + wheel steps the ladder's `aria-valuenow` by a
quarter while the plain wheel zooms and leaves it; both were red before the patch landed.

## The card beside the form — done

The Cards panel shows the card as the player will see it, beside the form, redrawn as its author
types: a chosen card with its level, recall and domain, any other with what grants it, and the
art this browser holds. The import moved with it: `CardArtImport` is the picker the deck browser's
reader and the panel share, and `CardPreview` is a face over it. The editor cannot import the game,
so `main.ts` hands the preview to `EditorShell` as a render prop and `AbilityPanel` draws it in a
third column, for a scripted card and a text-only one alike. "+ Script" now words its ability for
the card as well as naming it, so the form and the face agree from the first click. `main.ts` is 2,548 lines: the
demo-scene import collapsed to one line to pay for the two it gained.

`npx tsc --noEmit` clean; vitest **1886 passed (1886)**; Playwright **119 passed (4.3m)**, `EXIT 0`. New:
`tests/e2e/card-editor.spec.ts` reads the face before and after typing, the level badge after a
regrant, the art imported from the panel, and that the words reached the card; the screenshot it
writes (`test-results/card-editor-preview.png`) was read.

## A card's words are one thing — done

A card is two documents, and each carried a name and a text: the action bar read the ability's,
the deck browser and a card's face read the card's, and nothing kept them in step, so a card
written with `+ Card` played from the bar with its text and showed a blank face in the browser.
`src/editor/card-edits.ts` now holds the card and ability edits (out of `session.ts`, which is
1,712 lines) and `updateCardWords`: one edit that writes a name or a text onto the ability and
onto the project's own card when the ability is alone on it, one undo for both, coalescing by
field as before. A pack's card keeps its words until "Edit a copy"; a grimoire keeps its own. And
the active hand read a card's features and never its text, so a project's chosen card with text
and no features was blank there regardless: `printedText` is the one reading now, for the hand,
the vault and what is granted, and `loadoutCardOf`/`grantedCardOf` are the faces' shapes for
whoever draws a card next.

`npx tsc --noEmit` clean; vitest **1886 passed (1886)**; Playwright **118 passed (5.2m)**, `EXIT 0`. New:
`ability-edits.test.ts` rewords card and ability as one and undoes both; `demo-abilities.test.ts`
shows a chosen card's own text in the hand (red on the old `describe`, which read features only).

## Walking leaves `demo-scene.ts` — done

`src/game/movement.ts`: where the selected member can go, the walk once a destination is
settled, closing to strike before a swing, the previews a view draws before the click -- and
`arrive` and `startEncounter`, since the fight starts when the walkers reach the trigger.
`moveSelectedTo` and `runForIt` stay: the click is the game's, and the Movement Under Pressure
roll is a script, which is the fight. `inCombat` and `scriptPending` are `src/game/moment.ts`,
eighteen lines every module asks; below all of them so none has to import them from the
game and start the cycle back up. `demo-scene.ts` is 4,437 lines, from 5,856 when this began: the fight, the builders, the click, and what is left
of the interact section, and the rest of the split (`BACKLOG.md` §2) is a design decision,
not a move.

`npx tsc --noEmit` clean; vitest **1884 passed (1884)**; Playwright **118 passed (4.2m)**, `EXIT 0`. A
move, so no new test; the runtime module graph changed again (`RUN_TILES` now evaluates in
`movement.ts`), and the e2e boot is the check for that.

## The room leaves `demo-scene.ts` — done

Standing a room up and moving between rooms is `src/game/room.ts`: `SceneRuntime`, `buildRuntime`,
`worldOptions` and the content it reads (`characterContentFor`, `adversaryDefsFor`, `hooksFor`,
`traitsFor`), `install`, `travelTo`, `enterSavedScene`, `syncAuthoredEncounters`, `settleTravel`.
The demo's house rules and cast -- the `DEMO_*` constants and `PARTY_SHEETS` -- are
`src/game/demo-rules.ts`. `room.ts` reads the rules and the engine and knows `DemoScene` only as
a type, so `demo-scene.ts` imports from it and never the other way. The cycle that
`authored-encounters.ts` existed to avoid is gone; that shim stays only so its two importers do
not move. Nineteen importers were repointed by parsing their import statements, and `tsc` found
exactly the two functions that had been file-private and nothing else. `demo-scene.ts` is
4,722 lines, from 5,856 when this began.

`npx tsc --noEmit` clean; vitest **1884 passed (1884)**; Playwright **118 passed (4.2m)**, `EXIT 0`. A
move, so no new test; this one changed the runtime module graph (three top-level constants now
evaluate across a module line), which the e2e boot is the check for, and it was green first time.

## The fight says what it reads, and what it cannot — done

Every function in `demo-scene.ts` that takes `demo` was measured: the fields its body reads,
plus the needs of everything it passes `demo` to, iterated to a fixpoint. Of 129, **75 now take
a `Pick`** (70 rewritten here, most of them two to four fields: `statBlock` reads the board and
the world, `syncPools` the board, the sheets' derivations and the world, `defenseChoices` the
board, the sheets, the world and who is acting). `tsc` accepted every one on the first pass and
refuses each when a field is dropped, which is the check.

**51 need 24 or more of the 27 fields**, and keep `DemoScene`: a `Pick` of 24 says what a
function does not touch, which is the wrong way round. They are one cycle -- reactions
(`offersFor`, `playReaction`, `askReaction`, `afterReaction`), turns (`playGmTurn`, `runGmTurn`,
`endTurn`, `takeSpotlight`, `adversaryTurn`), defence (`offerOrLand`, `landAttack`,
`applyDefenseChoice`), death moves, both sides' attacks, and everything that runs a script
(`record`, `react`, `settle`, `answerPending`, `runAdversaryScript`, `runCountdown`,
`playPartyRolled`). A script's roll can wake a reaction card and a reaction card runs a
script, so each reaches all the others. That list is the fight core, measured rather than
guessed, and it is what the earlier entries were circling. The three between (14-17 fields)
are `travelTo`, `enterSavedScene` and `settleTravel`: the room module's, when it comes.

`npx tsc --noEmit` clean; vitest **1884 passed (1884)**; Playwright **118 passed (4.2m)**, `EXIT 0`. The
first e2e run was red on one boot wait (`editor-shell.spec.ts:154`, `frames > 2` not reached in 30 s,
on a 4.9-minute run straight after the unit suite); the spec alone and then the whole suite were
green. No behaviour changed: the edit is signatures only, and the compiler is the test -- dropping
`characters` from `syncPools`'s `Pick` fails at the line that reads it.

## `record` is `writeDown` and then `react` — done

The one function every script's journal passed through did two jobs: write the journal down
for the player and act on it for the fight. `writeDown` is in `log.ts` now, takes `Narration`
(nine fields: the board, the sheets, the world's and the project's names, who is acting, and
the four queues a view drains) and reaches nothing else -- `log.test.ts` drives it on a stub of
exactly those nine fields, with no scene built, which is the proof. `record` in
`demo-scene.ts` is `writeDown` followed by `react`: a `goto` remembered, pools re-fitted to
conditions, countdown cues and party-roll reactions.

What this did **not** do, and the earlier entry said it would: narrow the interact section.
`settle`, `answerPending` and `useSelectedOn` still hold the whole `DemoScene`, because they
still call `record`, and `react` is real -- a script's roll can wake a reaction card, and a
reaction card runs a script. That coupling is the game, not an accident of the file. What the
split buys is that the narration is its own testable module and the coupling has a name.

`npx tsc --noEmit` clean; vitest **1884 passed (1884)**, three of them new; Playwright **118 passed
(4.3m)**, `EXIT 0`. The new test asserts the exact sentence, roll, floater and motions a swing leaves,
and could not have compiled against the old `record`, which took a whole `DemoScene`.

## The helpers say what they read — done

`inCombat`, `setSheet`, `refreshWorld` (and `bindTurn`, `scriptPending`, `speak`) take a `Pick` of
`DemoScene` naming the fields they touch, and `applyLevelUp` and `equipItem` take `SheetChange`
on top of them: the eleven fields changing a sheet reaches -- the sheet and what is derived from it,
the moment, the world rebuilt to read it, the log. A body that reads past its `Pick` does not
compile, which is the check: dropping `log` from `SheetChange` failed at the two `note` calls.
`speak` moved to `log.ts`, where it belonged, so the type fits under the pin.

What the pass found: `settle` cannot be narrowed, because `record` -- the one function every
script's journal passes through -- ticks countdowns and plays party-roll reactions, so it reaches
the whole fight. `use-item.ts` stays on the full `DemoScene` for that reason. Narrowing `record`
means separating "write the journal down" from "react to what it says", which is the seam the
combat pass should open first.

`npx tsc --noEmit` clean; vitest **1881 passed (1881)**; Playwright **118 passed (4.3m)**, `EXIT 0`. The
check is the compiler: with `log` dropped from `SheetChange`, `tsc` fails at `note` in both files.

## Levelling, equipping and using items leave `demo-scene.ts` — done

The three sections at the end of the file that nothing in it called: `level-up.ts`
(`awaitingLevel`, `applyLevelUp`), `equip.ts` (`equipItem`, `gearOf`) and `use-item.ts`
(`useItem`). Each imports what it needs from `demo-scene.ts` and nothing imports back, so the
dependency runs one way. They still take the whole `DemoScene`, because the helpers they call
(`inCombat`, `setSheet`, `refreshWorld`, `settle`) do; narrowing them is the in-place pass below.

Travel was on the list and is not a leaf: `settleTravel` is called from three places in the
interact section, and `travelTo` shares `buildRuntime` with the scene builders, so it leaves
with the room-building cluster, not alone.

`npx tsc --noEmit` clean; vitest **1881 passed (1881)**; Playwright **118 passed (4.8m)**, `EXIT 0`. A
move, so no new test: the three sections' own tests (`demo-level`, `demo-equip`, `demo-items`) now
import from the new files, and the ceiling's pins came down with the file.

## The log leaves `demo-scene.ts`, and no file outgrows itself — done

`demo-scene.ts` went from 135 lines to 5,856 in eight days, every slice landing in it because the
recipes said so, and the docs still called it 2,435. The words are out: `src/game/log.ts` holds the
four view-feed types (`LogLine`, `Floater`, `Motion`, `RollShow`) and the narration over them --
`note`, `nameOf`, `withMentions`, `float`, `swungAt`, `struck`, `floatEntry`, `showRoll`,
`describeEntry`, `describeRoll`. Nothing in it reads the fight; `record` stays behind because it
does. Each function takes a `Pick` of `Narration`, the seven fields a line is written against,
rather than the whole `DemoScene`. That is the shape the rest of the split should follow: a
signature that names what it reads is the point, not the file count.

`tests/unit/file-size-ceiling.test.ts` fails when a source under `src/` or `tests/` passes 1,500
lines. The eleven already over it are pinned at today's size, and a pin only goes down. The recipes
in `DEVELOPING.md` §7 no longer send new behaviour into `demo-scene.ts`, and its line counts are
true again.

`npx tsc --noEmit` clean; vitest **1881 passed (1881)**; Playwright **118 passed (4.9m)**, `EXIT 0`. The
ceiling test was shown red by lowering `demo-scene.ts`'s pin to 5,000, then restored; the doc guard was
red on the two new files until they were staged, which is its `git ls-files` rule at work.

## Load asks too, and only about code that is new — done

Load put a project file's code into the running game without a word, which is the same door Import
pack had just learned to guard: a `.json` somebody hands you. `loadProjectText` now asks the same
question (`codeQuestion` in `main.ts`, with the verb changed), and a no loads nothing. Both doors ask
only about code the project does not already run, word for word -- `unfamiliarCode` in
`script/hooks.ts` reads id and text together -- so reloading the project you have open asks
nothing (a saved one loaded after a fresh boot, when the demo is open, asks once), and a script rewritten under an old id is asked about. A save slot carries no code, so
loading one has nothing to ask.

`npx tsc --noEmit` clean; vitest **1877 passed (1877)**; Playwright **118 passed (4.1m)**, `EXIT 0`. Two breaks --
Load without the question, and every script counted as already running -- each fail the tests
written for them.

## Packs carry code, and ask before it comes in — done

The engine shipped four native hooks named for a catalogue's cards (`SRD_HOOKS`, in
`script/native-hooks.ts`). They are gone, and the engine ships no hooks at all. A pack file carries a
`code` list now -- the same `codeSchema` a project's Code panel writes -- so a catalogue's card code
travels with its cards. The three the exported cards call (`arcane-barrage`, `falling-sky`,
`wild-flame`) were written into `packs/srd-abilities.json` as JavaScript, locally, with the file
backed up beside it first (`packs/srd-abilities.before-code.json`); the machine-local read in
`document.test.ts` checks they compile. The fourth, `mark-armor-or-hit-point`, only a fixture used:
it is the fixture's own code now (`ARMOUR_OR_HIT_POINT_CODE`).

Code in a pack runs in the page with everything the game can reach -- the shadowing in
`script/hooks.ts` is a guard rail, not a sandbox -- so Import pack asks first (`codeQuestion` in
`main.ts`): it names each script, says it is not sandboxed, and a no brings in none of the pack. A
project file imported as a pack asks too, and Export pack writes a project's code with its
content, so a pack written here asks wherever it is imported. ~~**Loading** a project still runs its code without asking;
that is the next thing to close.~~ — **closed**: *Load asks too*, above.

`npx tsc --noEmit` clean; vitest **1876 passed (1876)**; Playwright **117 passed (4.1m)**, `EXIT 0`. Three breaks --
the import not asking, a pack that cannot carry code, and the spray without its code -- each fail
the tests written for them.

## The engine keeps only the rules' conditions — done

The engine's own condition list held fifty, and forty-seven were a catalogue's: card markers
(`smiting`, `dodging`, `tavas-armor`, the vitality three...) and stat-block conditions (`asleep`,
`stunned`, `horrified`, `chilled`, `guilty`, `on-fire`...). Nothing shipped applied any of them.
They are gone from `content/conditions.ts`, which keeps the three the rules read -- Vulnerable and
Hidden in `attack.ts`, Restrained through the starter pack's Caught -- and a test in
`demo-scene.test.ts` pins exactly those. The exported catalogue carries all fifty itself, beside the
cards that apply them, and an import replaces by id, so nothing it plays is lost. A project saved
before this that applies one without carrying it now names a condition nobody defines, which Check
reports.

The tests that play those rules -- a block, an ending, a die on any roll, an immunity -- carry the
ten they need in `tests/fixtures/conditions.ts`, under the ids they always used, and add them to
their world the way an import would.

~~Still in the engine and named for cards: `SRD_HOOKS`, four native hooks (Arcane Barrage, Falling
Sky, Wild Flame, and the armor-or-Hit-Point rule several stat blocks share). A pack cannot carry
code, and the exported cards call them by id, so they stay until one can -- which means a pack
bringing code the game runs, the user's call.~~ — **closed**: *Packs carry code, and ask before it
comes in*, above. The five adversary keywords `adversary-features.ts`
runs are rules, not cards.

`npx tsc --noEmit` clean; vitest **1875 passed (1875)**; Playwright **116 passed (4.1m)**, `EXIT 0`. Three breaks --
a catalogue condition back in the engine, the demo tests without the fixture, and Asleep out of it --
each fail the tests written for them.

## Two spells leave the engine for a pack of their own — done

`sitil-echo` and `korvax-circle` sat in the engine's condition list though no shipped card applied
either: they were left over from the catalogue, which carries its own copies of both (its export
reads them, with the four abilities that use them). They are gone from `content/conditions.ts`, and
the two spells ship instead as a pack of their own, under neutral names, as a file a player imports
rather than as code: `public/packs/ember-spells.json`, served at `/packs/ember-spells.json`.
**Biting Circle** is the magic circle (a zone whose `biting-ground` condition bites and throws back
on the crossing); **Echo Mark** is the echo (an `echoing` marker that lends an `echoing-swing`
reaction laying the same roll against the next foe). Both are ember and level 1, so Mira can take
them from the Party panel.

`src/game/ember-spells-pack.test.ts` reads the file itself -- clean, validated, and played: the
circle bites and throws back and spares the caster's side, the echo reaches a second husk on the
same dice, and a bare project that imports the pack knows both conditions. The e2e fetches the file
from the dev server, imports it, and draws the circle in a fight.

`npx tsc --noEmit` clean; vitest **1875 passed (1875)**; Playwright **116 passed (4.1m)**, `EXIT 0`. Three breaks -- the circle
throwing nobody back, the echo throwing again instead of reading the last roll, and the pack
leaving its echo condition out -- each fail the tests written for them.

## Hold the Line's conditions ship with the pack — done

`holding-the-line` and `caught-in-the-line` sat in the engine's own list, `content/conditions.ts`,
though only the starter sentinel's Hold the Line reads them. They ship in `starter-conditions.ts`
now, beside Warding Flame's ring and Shield Wall's. A world inherits the pack's conditions as well
as the engine's, under a project's own (`withShippedConditions`, `game/demo-scene.ts`), so a starter
card played in a project that never wrote its conditions down still has them -- which was true of
these two only because they were in the wrong list, and not true of the ring or the shield at all.

`npx tsc --noEmit` clean; vitest **1871 passed (1871)**; Playwright **115 passed (4.2m)**, `EXIT 0`. Two breaks --
the pack's conditions left out, and a project's own no longer winning -- each fail the test written
for them.

## Two starter cards stop being text — done

Rallying Cry and Smoke Step shipped as text only, though nothing they say was out of the
vocabulary's reach. **Rallying Cry** clears a Stress from each ally within Far -- "who can hear
you" -- and costs the one calling out a Stress, as every card in the pack pays in Stress rather than
Light. **Smoke Step** puts its holder down on a spot within Close, a blink rather than a walk, since
nothing between two shadows has to let them pass. `cut-purse-strings` is the one text card left
among the chosen, and its blocker is real. Twenty of the pack's thirty-nine cards are text now:
one chosen, nineteen printed features.

Three places had leaned on Rallying Cry being text. The card-list test and the e2e that rewords a
pack's text card, and the one that finds no delete on it, now use Cut Purse Strings; and a defence
test's own reaction had borrowed the id `rallying-cry`, which would have sat beside the shipped one,
and has one of its own.

`npx tsc --noEmit` clean; vitest **1870 passed (1870)**; Playwright **115 passed (4.2m)**, `EXIT 0`. Two breaks --
the call reaching nobody, and the step going nowhere -- each fail the test written for them.

## The run on the hover path — done

Hovering the ground in a fight drew the part of the walk past one move in red, whether a run would
get there or nothing would. That part is amber now where an Agility Roll would get the fighter there
(`WalkPreview.run`, read from the same `underPressure` the click asks), and stays red past any run.
The driver's `previewAt` carries the flag. Nothing to validate and no field: it is a drawing of a
rule that already runs.

`npx tsc --noEmit` clean; vitest **1868 passed (1868)**; Playwright **115 passed (4.3m)**, `EXIT 0`. Two breaks --
the preview never calling a run a run, and the board drawing a run in red -- each fail the test
written for them.

## Delete a card of the project's own — done

✕ on an ability takes its card with it only when the card is `given` and nothing else sits on it, so
a card the project wrote and left without an ability -- one an imported pack brought as text, or one
whose ability went after it was granted another way -- could only go by Undo. The text-only view now
has **Delete card** (`removeCard`, the edit behind **Remove copy**) on a card of the project's own
that the pack does not print: the pack's text cards are not the project's to delete, and a copy is
removed, not deleted. Nothing new for **Check**: a character still holding a deleted card is already
reported, since deriving their sheet misses it. The e2e finds no delete on the pack's card or its
copy, grants a card of its own by a class, deletes its ability, and deletes the card left behind.

`npx tsc --noEmit` clean; vitest **1866 passed (1866)**; Playwright **115 passed (4.2m)**, `EXIT 0`.
Two breaks -- every text card offering Delete, and none -- each fail the e2e written for them.

## Movement Under Pressure — done

The rule was written and tested, and nothing called it: a click past one move in a fight walked as
far as the move allowed and stopped. Now a spot a run could reach -- past Close, as far as Very Far,
with a way there -- asks for an **Agility Roll** first (Difficulty 12, `DEMO_MOVE_DIFFICULTY`),
through the check prompt every roll uses. A success walks the whole way; a failure walks as far as
the move allows, which is all the click did before; either way the roll was the action, and its
Light, Shadow and spotlight stand. Calling the roll off costs nothing. A walk within Close asks for
no roll: in the demo the walk *is* the action, and the rule lets a move within Close ride on one
(`withAction`). Farther than a run, the old walk-as-far-as-it-goes stays.

The GM's side reads the same rule. A creature swings after a walk within Close, as before; when no
walk within Close brings its weapon to bear, it walks as far as Very Far instead, and that is its
turn (`approach`). One test's geometry assumed the old Close-only walk -- a watcher parked past Far
in a 40-wide hall reached Far in three turns -- and its hall is 96 wide now.

The runner gained `lastActionRoll`, read the way `cancelled` and `spotlightToGm` already are, so
whoever ran a script can tell what came of its roll. The difficulty is a constant, not an editor
field: nothing else about fight movement is authored per project yet. **Left** then, and closed
since: the hover path said nothing of the roll (*The run on the hover path*, above).

`npx tsc --noEmit` clean; vitest **1865 passed (1865)**; Playwright **114 passed (4.1m)**, `EXIT 0`. Seven
breaks -- the walk never asking, a success walking one move, a failure walking the whole way, a
called-off run spending the action, the GM's walk kept within Close, the GM swinging after any
walk, the runner saying nothing of its roll -- each fail the tests written for them. The GM test
stands its creature alone, so the no-swing half is asserted rather than skipped.

## Undo in play rebuilds the game — done

Undoing an import while in play rewrote the document and left the running game as it was. The card
itself went at once -- the bar and the loadout read the project live -- but what was built from it
did not: a passive's bonus stays folded into a character's derived numbers, and the world copies the
project's stat blocks and conditions when it is built. So a card that gave Kara two more Stress kept
giving it until the next trip through the editor.

Undo and redo now share `stepEdit` (`main.ts`): in play it rebuilds the party and the world over the
document the step left, as an import in play already did, and it refuses mid-fight or
mid-conversation, where the import is refused, rather than rebuilding under a turn order. The fix is
in the step, not the import, so every kind of edit gets it. Nothing for **Check** to say, and no
editor field: it is how an existing button behaves. The e2e imports that card in play, undoes it and
finds her Stress back to 6, redoes it and finds 8, then starts a fight and finds the undo refused
with the card still in the project.

`npx tsc --noEmit` clean; vitest **1861 passed (1861)**; Playwright **113 passed (4.1m)**, `EXIT 0`. Two breaks -- play
rebuilding nothing after a step, and a step taken mid-fight -- each fail the test; the first is also
how the test was written, red before the fix.

## Remove copy — done

A copy of a pack's card could only be taken back by Undo: ✕ on its ability leaves the copy, still
played. A copy now carries **Remove copy** (`removeCard`, `editor/session.ts`): the project's card
goes, `mergePack` has nothing to lay over the pack's, and the pack's is the card played again, the
abilities on it where they were. Only a copy offers it -- a project card the shipped pack also prints
-- so the panel is handed that pack before the project is laid over it (`characterPack`). Nothing
new for **Check** to say: a removed copy leaves the pack's card, which it already reads. The e2e
copies Power Slash, sets its recall to 3, removes the copy, finds a project's own card offering
none, and finds 1 on Kara's loadout.

`npx tsc --noEmit` clean; vitest **1861 passed (1861)**; Playwright **112 passed (4.0m)**, `EXIT 0`.
Three breaks -- the edit removing nothing, Undo leaving the copy out, every project card offering
the button -- each fail the test written for them.

## A condition lends a card — done

A condition used to lend one ability (`grants: { ability }`). Now a card says it is lent by a
condition -- `grant: { kind: 'condition', conditions }` -- and whoever bears one of those holds the
card while it lasts, character or creature. It is never a sheet's: the world, the action bar and the
loadout read it off the creature (`lentCards`, `character/sheet.ts`), it shows last under **Always in
play** as "Lent by" its condition, and the world counts its passives at roll time, since
`deriveCharacter` never saw them. The Cards panel's **granted by** offers "a condition on them", and
**Check** warns when a card is lent by no condition, or by one nothing defines.

Lending the card an ability already sat on would have handed a marked ally the whole spell, the
half that casts included, so the lent half is a card of its own. That is **format version 4**
(`toVersion4`, `scene/migrate.ts`): an ability that shared its card moves onto a lent card, one alone
on its card is copied so whoever held that card keeps it, and a lend of an ability the file does not
carry is dropped. Version 3 was pushed, so the migration is proved on a real version-3 project
captured before the change (`tests/fixtures/v3/README.md`). On a machine with the old catalogue
export, its two spells' second halves come out as two cards of their own. The engine's own
conditions lend nothing now: the two that did named abilities nothing ships.

`npx tsc --noEmit` clean; vitest **1860 passed (1860)**; Playwright **111 passed (4.0m)**, `EXIT 0`. Eight
breaks -- the world folding in no lent card for a character, or for a creature, the migration doing
nothing, moving where it should copy, the zone reading the sheet only, Check trusting an unknown
condition, a lent passive counting for nothing, the bar dropping lent cards -- each fail the tests
written for them.

## The GM's cards, face up — done

Looking at a creature (right click, or the driver's `inspect`) now shows the cards its stat block
prints, under its facts: every card granted by `adversary` to that block, scripted or not, named as
the card is and worded as the card is -- or, for a card the editor wrote, as the ability on it is
(`statBlockCards`, `game/demo-abilities.ts`). It reads the project as it stands, so a card printed
in the editor is on the block the next time anybody looks. The e2e prints a card on the Hollow
Knight from the Cards panel and finds it, name and words, on the inspect card in play.

`npx tsc --noEmit` clean; vitest **1851 passed (1851)**; Playwright **110 passed (4.1m)**, `EXIT 0`. Two breaks -- the
inspection carrying no cards, the list taking a card printed on another block -- each fail the test
written for them.

## Granted cards wear their art on the action bar — done

The action bar drew a picture only on a chosen card; an ability on a card a class, subclass,
ancestry or community grants -- or one a project hands a character -- had none. Every card draws
one now (`cardArtOf`, `game/demo-abilities.ts`): a chosen card in its domain's colour, any other in
the colour the loadout's **Always in play** already gives a card nobody chose. The palette's comment
stops saying there are nine domains; it lists twelve, and the granted colour.

`npx tsc --noEmit` clean; vitest **1850 passed (1850)**; Playwright **109 passed (4.0m)**, `EXIT 0`. One break -- a granted card
drawing nothing again -- fails the unit test and the e2e line written for it.

## The grant pickers, in a browser — done

The Cards panel's subclass-stage, ancestry and community pickers had only unit tests behind them
(the class picker was already in *The card editor*'s e2e). One e2e now writes a card, grants it by
each in turn and reads each grant out of the project, then plays: Kara is a Wayfarer, and the card
granted by the Wayfarer community is in her loadout's **Always in play**.

`npx tsc --noEmit` clean; vitest **1850 passed (1850)**; Playwright **109 passed (4.0m)**, `EXIT 0` -- both run
with the next slice (granted cards' art) applied on top, since this one adds only the test.

## Export pack — done

**Project ▾ → Export pack** writes the project's content as a pack file, `<project id>-pack.json`:
every list a pack carries (`packOf`, `content/pack/document.ts`) -- classes, ancestries,
communities, subclasses, cards, weapons, armor, adversaries, the abilities on the cards and the
conditions they apply -- copied out under the current `formatVersion`, and none of the scenes, party
or code. It is the other half of Import pack: a test writes the starter pack out and reads it back
through `readPack` entry for entry, nothing refused and nothing skipped, and the e2e checks the
downloaded file against the project list for list.

`npx tsc --noEmit` clean; vitest **1849 passed (1849)**; Playwright **108 passed (3.9m)**, `EXIT 0`. Three breaks -- a list
left out, the file sharing the project's entries, the menu item doing nothing -- each fail the test
written for them.

## Text-only cards in the Cards panel — done

The Cards panel lists every card no ability sits on under **Text only** (`unscriptedCards`,
`editor/card-list.ts`), read from the pack's cards with the project's own laid over them as they
stand. In the starter pack that is twenty-two of its thirty-nine cards: three a character chooses
(`rallying-cry`, `smoke-step`, `cut-purse-strings`) and nineteen features a class, subclass, ancestry
or community prints as text. The count this file and the manual gave before was three -- the chosen
ones only; the new test found the rest. One opens on its own: the card's name and text (the
project's own card edited where it stands, a pack's read-only until **Edit a copy**), how it gets
into play, and **+ Script**, which writes the first ability on it, named for the card
(`scriptIdFor`), and moves it up into the list of abilities.

`npx tsc --noEmit` clean; vitest **1848 passed (1848)**; Playwright **107 passed (3.9m)**, `EXIT 0`. Three breaks -- the list
keeping scripted cards, the list reading the snapshot rather than the project, **+ Script** writing
nothing -- each fail the test written for them.

## A roll pays out when it is made — done

A party swing's Light, the GM's Shadow and a critical's cleared Stress now arrive with the roll,
before anything answers the damage roll, rather than when the blow lands. `applyRoll`
(`combat/attack.ts`) is that half of `applyAttack` on its own. `afterRolled` settles it, where
nothing can change the Duality Dice any more -- every card that rerolls, names or raises them answers
`partyRolling`, earlier -- and marks the swing `settled`, so `landPartyAttack` lands only the blow
(`applyAttack(state, outcome, { roll: false })`). A blaze of glory never stops between the two and
still pays both at once; the runner's own `attack` and `check` already settled the roll before their
effects ran.

So from 0 Stress, a card that marks one on a critical's damage roll costs its Stress, and a card that
costs a Light can spend the Light the same roll gave. A test says each, from nothing held; the lift
test keeps its one Stress marked and measures only the lift.

`npx tsc --noEmit` clean; vitest **1846 passed (1846)**; Playwright **106 passed (3.8m)**, `EXIT 0`. Three breaks -- the swing
paying out only when it lands, the landing paying out again, `roll: false` ignored -- each fail the
tests written for them.

## The card editor — done

The Cards panel reaches the cards it could only name before. **a loadout** is a grant like the
others: switching a card into one writes the four numbers a chosen card cannot load without -- a
domain some class opens, a type, a level, a recall cost -- and a card switched out keeps them. A card
the pack prints is shown as the pack has it beside
**Edit a copy** (`addCard`): the copy lays over the pack's by id, whole (`mergePack`), so the table
plays it and the pack is never written. **Check** warns about a chosen card in a domain no class
opens, held or not -- the party's own warning covers a held card outside its holder's domains -- and
about one past level 10. The e2e copies Power Slash, grants it to a class and back, sets its recall
to 3, and finds 3 on Kara's loadout.

**Since closed:** the way back to the pack's card was only Undo, since ✕ on the ability leaves the
copy; *Remove copy*, above, is the way back now. A card with no ability on it, and a card's own name
and text, were open here too; *Text-only cards in the Cards panel*, above, reaches them.

`npx tsc --noEmit` clean; vitest **1843 passed (1843)**; Playwright **106 passed (3.7m)**, `EXIT 0`. Four breaks -- a loadout
written without its numbers, the project's cards laid over nothing, no warning for an unopened
domain, a second copy counted as an edit -- each fail the test written for them.

## The lift's red test — resolved

The one failure every run since `f4df9fa` carried was the test, not the card. It read whether the
swing was a critical off `demo.rolls` before the reaction was answered, and a party swing's roll
only reaches `demo.rolls` when the blow lands, so it read the swing before and said *not a critical*
every time. On seed `lifted-6` the swing is a critical: letting it pass ends at 0 Stress, playing
the card ends at 0 as well, and the formula expected 1.

Fixed on the test's own subject. Kara starts the swing with one Stress marked, so a critical's clear
has one to take in both runs, and the card costs exactly one more than letting the blow pass: the
critical drops out of the arithmetic. Three breaks -- the lift worth nothing, the card costing
nothing, no Stress marked before the swing -- each turn it red again.

**Open when this was written, and fixed since (*A roll pays out when it is made*, above): when a
critical clears its Stress.** The engine cleared it when the
blow landed (`applyAttack`, `combat/attack.ts`), after anything that answered the damage roll. The
SRD's order is the roll first -- the critical clears a Stress -- then the damage roll, then "mark
a Stress" on it. From 0 Stress the two disagree: the SRD ends at 1, the engine pays the card's
Stress and the landing clear takes it back, so the card is free. The same deferral holds the roll's
Light, so a Light-cost card answering the damage roll cannot spend the Light that roll just gave.
The fix is settling the roll's own economy in `afterRolled` (demo-scene.ts), where nothing can
change the Duality dice any more -- every card that rerolls, names or raises them answers
`partyRolling`, earlier. It is its own slice: `applyAttack` has five callers, and the runner's
`check` defers the same clear on purpose (`runner.ts`, "whoever is acting when the dice are
settled").

`npx tsc --noEmit` clean; vitest **1841 passed (1841)** -- the first fully green unit run since `f4df9fa`;
Playwright **105 passed (3.7m)**, `EXIT 0`.

## The docs stop naming what is gone — done

The reference docs described a repository that no longer exists. `DEVELOPING.md` and
`developer-guide.html` lose the vendored-sources section, the generated-docs rules, the
`content/srd/` rows and a recipe that edited a deleted library; recipe (c) is now how a stat
block's feature is written, as a card printed on a block. The HTML guide also stops saying
`formatVersion` is 1, and gains the content-pack rows it never had. `MANUAL.md` and `CRPG-GAPS.md`
stop pointing at `docs/CARDS.md`, `docs/ADVERSARIES.md` and the catalogue's counts, and say which
four native hooks exist. A new guard, `tests/unit/doc-references.test.ts`, fails when a reference
doc names a file the repository does not have: this drift had been found by hand three times.

`npx tsc --noEmit` clean; vitest **1840 passed / 1 failed (1841)**, the one failure being the documented deliberate one;
Playwright **105 passed (3.7m)**, `EXIT 0`. The guard earned its place on its first run: it found one
reference the rewrite had missed (the build's index, named as if it were a repository file).

A second look found the guard's own hole: it read only a span's first word, so a path behind a
command (`python tools/adversaries-doc.py`, the deleted generator, named twice) passed. It reads
every word now, and its own test says so. The same look corrected a recipe that credited two test
files with what one plays, and a MANUAL line that read as if the starter pack scripted every card
(twenty-two of its thirty-nine are text, counted since: three chosen, nineteen printed features).

## Card zones — done

The loadout shows **Always in play** between the hand and the vault: what a character has
without choosing it -- class, subclass up to the stage reached, ancestry, community, and anything
a project hands them -- face up, in the order a sheet lists abilities (`grantRank`, now shared),
each saying what granted it. It reads the cards as they stand, so a card handed over is shown at
once. A granted card has no domain, level or recall, so it has a face of its own (`GrantedFace`)
in a colour of its own; a search reaches the zone and a domain filter puts it away.

`npx tsc --noEmit` clean; vitest **1838 passed / 1 failed (1839)**, the one failure being the documented deliberate one;
Playwright **105 passed (3.8m)**, `EXIT 0`. Three breaks -- the zone reading the cards as the sheet was
derived, keeping the pack's order, naming a grant by id -- each fail the test written for them.

## The grant editor — done

The Cards panel's **granted by** re-grants a project's own card: named characters, a class, a
subclass stage, an ancestry, a community, or the stat blocks that print it. `chosen` is not offered
-- a chosen card needs the loadout's four numbers, and one switched to it without them no longer
loads -- and a pack's card is shown, not edited. **Check** warns when a grant names what nothing
defines, and about a card given to nobody or printed on no block. The e2e that writes a stat
block's feature from the panel now prints it on a block, and Check has nothing to say about its
Shadow.

`npx tsc --noEmit` clean; vitest **1837 passed / 1 failed (1838)**, the one failure being the documented deliberate one;
Playwright **105 passed (3.7m)**, `EXIT 0`. Three breaks -- Check never reading a grant, taking an unknown
class on trust, not asking about the party -- each fail the test written for them.

## Cards as the unit — done

Everything a character has is a card, and so is every feature a stat block prints. Format version 3
carries it. Nothing was pushed until both sides had landed: a pushed version is a promise to every
file written under it.

* **A card says how it got into play** (`cardGrantSchema`): `chosen` into a loadout, or granted by a
  class, a subclass stage, an ancestry, a community, a project handing it to named characters, or a
  stat block printing it (`adversary`).
  Only a chosen card has a domain, a type, a level and a recall cost, and the schema asks for them
  there and nowhere else.
* **An ability sits on a card**, `source: { card }`, and there is no other source. `abilitiesFor`
  reads the card's grant and
  orders by it -- class, subclass stage, loadout, ancestry, community, given -- then by list order.
  Both tests that pinned the old order pass unchanged, which is the evidence that nothing moved.
* **Printed features are cards.** A class, subclass, ancestry or community carries none; the
  starter pack's 24 are granted cards, and the name-matching that paired a printed feature with its
  ability is gone. So are the readers for a retired data set's shapes in `pack/import.ts`, which
  nothing had called since slice 3 and which wrote exactly those features.
* **Granted is read live.** `deriveCharacter` folds a granted card's passives into the numbers; the
  world and the action bar recompute a character's granted cards from the cards as they stand, each
  time they read (`grantedCards`), so a card handed over mid-scene is in hand at once -- as an
  ability written into a project always was. Two tests fail without that read.
* **The GM's side.** A stat block's feature is an ability on a card granted by `adversary`. The
  world finds a block's features through the cards (`statBlocksOf`), the validator's eleven
  stat-block checks ask the same cards, and no character is ever granted one -- a test names a block
  after a character to show it. What a block prints as traits (`features`: Relentless, Horde,
  Minion, Momentum, Terrifying) stays on the block: those are rules `adversaryTraits` reads, the same
  boundary as a weapon's features. Tests write a feature once and print it on its blocks with
  `printed(blocks, feature)`.
* **The editor.** "+ Card" writes a `given` card and the ability on it as one undo step, ✕ takes
  both back, and "held by" edits the card's characters. **Check** warns about an ability on a card nothing defines: under
  this model that ability is silently never in play.
* **The migration** (version 3, positional) builds a card for every ability that sat on something
  other than a card -- a stat block's feature among them -- granted the way its source said, and turns printed features into granted cards
  -- joining one to its ability's card when both are in the same document, and never matching
  against the shipped pack, which is code a document cannot see. The frozen version-1 project comes
  through with its seven such abilities on seven built cards.
* **The export, re-read.** `srd.json` now reads as 334 cards (189 chosen, 145 printed) and
  `srd-abilities.json` as 8 cards beside its 185 abilities. **Known:** imported together, those 8
  duplicate printed cards by name under other ids, because the two files were exported apart and are
  read apart. Merging them is the owner's call, not a migration's guess. Neither file carries a stat
  block's feature, so the GM's side changed neither count.

`npx tsc --noEmit` clean; vitest **1835 passed / 1 failed (1836)**, the one failure being the documented
deliberate one; Playwright **105 passed (3.7m)**, `EXIT 0`. Five breaks -- the world reading no cards, a
feature reaching every block, a stat block's card granted to a character, the validator asking no
cards, the migration skipping a stat block -- each fail the tests written for them.

**Next, in order:** what *The card editor* lists as still open (the grant editor, the card zones and
the card editor have landed, above).

---

## Import pack — done

The exported catalogue is reachable again. **Project ▾ → Import pack…** reads one or more pack files
and lays their content into the project being edited, id for id, as one undo step. The state the
handoff called "preserved but unreachable" is closed.

* **The file format** is `packDocumentSchema` (`content/pack/document.ts`): `contentPackSchema` plus
  `abilities` and `conditionDefs`. That is the fix for "a pack has no conditions field" — a card
  that applies a condition now travels with the condition, and with its script. A project file
  reads as a pack too.
* **The reader**, `readPack`, migrates first like every door, then validates each entry on its own:
  a broken entry is skipped and reported as a `ContentIssue`, and a newer build's file or one with
  nothing readable is refused. Importers still never throw.
* **The edit**, `importPack` in `editor/session.ts`, replaces a same-id entry where it stands and
  appends the rest, **in place** — the script world holds `project.abilities` by reference, so a
  fresh array would leave it reading the old one. A test fails exactly that way without it.
* **Replace, not keep**, on a same-id collision: importing is somebody choosing a file, and a pack
  re-exported with a fix should land the fix. The cost is a customised card imported over, which is
  why it is one undo and why the message counts what it replaced.
* The Combat strip and the validator's known adversaries read `adversaryDefsFor(project)` on every
  draw instead of a module constant, so an imported stat block can be placed.
* Not a load. An import is refused only in **play**, mid-prompt or mid-fight, where the world would
  be rebuilt under the question; in the editor the world is rebuilt on the way back to play, as it
  is for every other content edit.

**Verified on the real export, locally.** Both `packs/*.json` import with zero issues — 192 weapons,
34 armors, 9 classes, 18 ancestries, 9 communities, 18 subclasses, 189 cards, 129 adversaries, 185
abilities, 54 conditions — and an imported card was put in a loadout, offered, played, and applied
its imported condition. `document.test.ts` keeps the read as a `skipIf`: it runs where the
git-ignored export exists and reports skipped everywhere else. Importing the abilities file replaces
the 54 condition ids the demo project already carries, because the export holds the engine's
generic rules conditions too. *(Three of them since the engine kept only Vulnerable, Hidden and
Restrained.)*

`npx tsc --noEmit` clean; vitest **1821 passed / 1 failed (1822)**, the one being the documented
deliberate `demo-defense` failure; Playwright **105 passed**, `EXIT 0`.

**Still open on the same thread.** Classes and subclasses carry no feature text any more -- what
they print is cards (above), and the Cards panel edits them, an imported class's included (*The card
editor*, above), and a project's content goes back out as a pack through Project ▾ → Export pack
(*Export pack*, above). Nothing is left on this thread.

**Since fixed:** undoing an import while in *play* rewrote the document but not the running world;
*Undo in play rebuilds the game*, above, closes it for every kind of edit.

---

## Slice 4 — done

- **Light and Shadow.** Landed in two passes. What a player reads became **Light** and **Shadow**
  (686 display sites, 69 files); what a document stores became `good` and `bad` (74 files, a 1:1
  substitution). The split has a front and a back because `light` and `shadow` cannot be identifiers
  here — `spotlight` is the engine's own turn concept with 249 uses, and the renderer has shadow
  mapping. This was a **document format change**, not a rename: the pool enum, the pool selector,
  four `checkRequestSchema` keys (real persisted keys), four `RollOutcome` values, the UI labels in
  `DiceTray` and `PartyHud`, and the pool test ids the pips carry — which the e2e selectors read.
- **`formatVersion` 1 → 2**, with a load-time migration that rewrites a version-1 document rather
  than rejecting it. **Exercised on a real version-1 fixture**, or it is a promise rather than a
  behaviour.
- **Identity.** ~~Done.~~ `package.json` name → `tactical-engine` (and the derived name in
  `package-lock.json`), `<title>` → Tactical Engine, the editor top bar, and the retired name gone
  from 25 files. The e2e driver handle became `window.__engine`, 438 sites across 24 files — one
  literal, so `src/main.ts`'s `declare global` and `demo.spec.ts`'s hand-written mirror could not
  drift apart (`6767b90` has the old spelling, which the guard now forbids here). Three populations were protected: the prototype's persisted keys, the app's
  own three `localStorage` prefixes (now read as a fallback so nobody's saves are orphaned), and the
  RNG seeds in `rng.test.ts`.

  *This line previously read "Tactical Engine retired", which is nonsense.* The substitution that
  renamed the product could not tell the name being **adopted** from the name being **retired**, and
  inverted the sentence. The pass was protected against doubling (`Tactical Engine Engine`) but not
  against that. An audit for the same shape found one more — the content-pack spec's §11, which read
  "**Tactical Engine is retired** — its echo of…", where the trailing clause was the reason the
  *old* name had to go — and no others. Two inversions across 25 files, both in prose that named the
  retired name in order to retire it. Neither is a boundary breach, and the guard would not have
  caught either: one is in `docs/superpowers/`, which it exempts by design.
- **`legacy/` prose.** ~~Done~~, but the amendment's premise was wrong and the correction is worth
  keeping. The owner's ruling lifted the never-modify rule on the stated grounds that "all eight
  marks there are cosmetic comments and one editor hint, none functional". Measured: there are
  **20** marks, and three are functional — `polyheart-campaign` is written at
  `legacy/js/editor.js:170` and read at `main.js:23`, and `polyheart-map` is read at `main.js:29`.
  Those are persisted `localStorage` keys, so renaming them orphans any campaign or map somebody
  saved in the prototype. The prose was rewritten and the keys were left, which is the spirit of the
  amendment rather than its letter. `legacy/`'s 59 Light/Shadow sites were left too: 19 are live
  identifiers in `legacy/js/game.js`, and `legacy/README.md:50-65` documents the prototype's
  mechanics against its own code.
- **The guard.** ~~Done~~ in `tests/unit/licensing-boundary.test.ts`: three sweeps over what
  `git ls-files` reports, plus the existing check that `tools/srd-sources/` does not exist.

  The marks rule cannot be "never" — the DPCGL *obliges* the attribution — so an occurrence is
  legitimate when a licensing phrase sits within **±2 lines**. The window, not the line: attribution
  paragraphs wrap mid-phrase (that file splits "System Reference / Document" across a break), so a
  per-line rule fails on the notices themselves, and reflowing a licensing paragraph would fail the
  boundary for no real reason. Two drafts of the doc passes broke exactly that way.

  Exemptions are named with reasons, never convenience: `legacy/`, `docs/research/`,
  `docs/superpowers/` (dated design records — a spec arguing for removing this IP must be able to
  name it), and the guard itself, whose rules have to spell the terms they forbid.

  Shown to fail without its fix, by injection into a tracked file that was clean first and reverted
  after: a sentence branding the engine as the licensed product made rule 1 fail and name the line,
  and a line carrying the retired product name made rule 2 fail. The guard was re-run green on the
  restored tree. Rule 3 needed no injection — it caught a real offender on its first run, a comment
  in `save.test.ts` naming the old pool field, which was reworded rather than added to the exemption
  list.

  **Note for whoever edits this entry:** the injected strings cannot be quoted verbatim here. This
  file is not exempt, so a doc recording the guard's own falsification trips the guard — describe
  the injections instead of spelling them.

---

## Slice 3 — done

The vendored catalogue is gone: 88 files, 39,652 deletions, including the 2.1 MB
`tools/srd-sources/` tree, `src/engine/content/srd/` entire, 182 KB of card scripts, 162 KB of
stat-block features, two doc generators and the two docs they generated. `tsc` clean, **Playwright
103 passed** — the same count as the baseline taken deliberately *before* the deletion, so the
deletion is what was verified rather than the deletion plus something else — and 1772 unit tests
passing with the one documented deliberate failure. The drop from 1828 is the 55
catalogue-integrity tests leaving with the catalogue they were about, which is exactly what
splitting them into `*-catalogue.test.ts` files was for.

**Exported before anything was removed**, because the rule is that this content stays importable
rather than lost. `packs/srd.json` holds the content as one `contentPackSchema` document (192
weapons, 34 armours, 9 classes, 18 ancestries, 9 communities, 18 subclasses, 189 cards, 129
adversaries, zero import issues). `packs/srd-abilities.json` holds the mechanics — 185 abilities
and 54 conditions — in the shape `projectSchema` accepts, because abilities belong to a project and
a pack alone would have been names and text with every script dropped. Both are git-ignored, and
the tool that wrote them went with the sources it read.

Four code changes came first, each on a tree that stayed green: `content/srd/hooks.ts` moved to
`script/native-hooks.ts` (engine code — four computations the effect vocabulary cannot express, one
of them already named by a fixture); `main.ts` hands the editor the starter pack as its ability
library, which narrows the Ability panel from 185 entries to 14; `withStatBlockFeatures` is gone, so
what a project places is what it carries; and `authored-scenario.test.ts` stopped loading 185
abilities for two tests whose blocks carry their own.

`licensing-boundary.test.ts` used to read `tools/srd-sources/official-2.0/README.md` to prove the
PDF was never vendored. It now makes the stronger claim — no vendored SRD source in the tree at all
— and pins both attributions where they live, `docs/CONTEXT.md`. CONTEXT.md itself lost 40 lines of
sourcing directions and kept what outlives them: the notices, and the 2.0-versus-1.0 findings that
explain what `cover.ts`, `los.ts` and `area.ts` implement.

**What slice 3 did not do, and is worth knowing next:**

* ~~`contentPackSchema` still has no `conditions` field~~ — **closed** by the pack file format,
  `packDocumentSchema`, which is `contentPackSchema` plus `abilities` and `conditionDefs`. The
  export's sidecar is simply a second pack.
* ~~**Nothing reads a pack from disk.**~~ — **closed**: Project ▾ → Import pack…, above.
* ~~`cut-purse-strings`, `rallying-cry` and `smoke-step` still ship as text only.~~ — **closed** for
  two of them: *Two starter cards stop being text*, above. `cut-purse-strings` is still text.
* ~~`holding-the-line` and `caught-in-the-line` still sit in `content/conditions.ts` rather than
  beside the feature that arms them.~~ — **closed**: *Hold the Line's conditions ship with the pack*, above.

---

**Pinned to commit `8b9316e`.** At that commit: `npx tsc --noEmit` clean, vitest **1877 passed (1877)**
across 95 files, Playwright **118 passed (4.1m)**, `EXIT 0`.

### History: the red e2e run after the demo was repointed

All 21 failures it found are fixed. The diagnosis is kept because the cause and the tiering are the
reusable parts.

Read the duration as a signal: green is ~3.6 minutes, and the red runs took 15 because twenty-one
failing locators each waited out a 90-second timeout.

The run was **RED: 21 failed, 82 passed**, measured
twice after the demo was repointed (15.1m and 15.3m, identical counts). An earlier version of this
line called that green by reading the pass count and not the exit code.

**All 21 are one cause: the specs name vendored content, the shipped pack names its own.** `7769fa1`
and the five commits after it changed what the demo plays, and no commit since has touched
`tests/e2e/`, so the repoint landed without its e2e half. An earlier version of this file guessed
three or four causes from the shape of the test names; both places where it could have gone the other
way were checked and did not:

* `card-browser` is not art-tier fallout. It injects `setCards('kara', ['bare-bones', …])` — six
  vendored ids — so `.deck-slot` resolving to 0 is the correct behaviour of a pack without them.
* `placement` / `editor-shell` are not construction fallout. `main.ts` hands the editor
  `adversaries: ADVERSARY_DEFS`, which looks like a second list but is
  `[...DEMO_ADVERSARIES.values()]`, and `DEMO_ADVERSARIES = STARTER_ADVERSARIES`. So
  `library-search.fill('wolf')` matches nothing, `[data-item]` never appears, and the click waits
  out its 90 seconds.

**Tier A — done: all fourteen re-pinned onto shipped content and verified in a browser.**
Kept as a table because it says which spec was pointed at what, which is what anybody repeating
this against another pack will want.

| Spec | Stale | Shipped |
|---|---|---|
| `demo:1479` | `Broadsword · Chainmail`, item `full-plate` | `Longsword · Ringmail`, `padded-coat` |
| `demo:2120` | `adversary: 'acid-burrower'` | `bandit-archer` |
| `demo:2293` | `gambeson-armor`, card `whirlwind` | `padded-coat`, `shield-wall` |
| `demo:2387` | `chainmail-armor` | `ringmail` |
| `demo:1890` | six vendored ids, log `/Acid Burrower's/` | 5 bulwark + `smoke-step`, `Hollow Knight's` |
| `card-browser` ×4 | `bare-bones`, `not-good-enough`, `reckless`, … | starter ids; Domain `blade`→`bulwark`, count 3→5 |
| `placement` ×3, `editor-shell` | search `wolf`, `tangle-bramble` | search `hound` (Rot Hound, unique) |
| `between-fights:141` | `/plate/i` in the payout | the table pays gold, draught, carapace, longsword, round shield |

Two of these are rewrites rather than swaps. `demo:1479` equips `longsword` expecting the displaced
`broadsword` to land in the pack — but Kara's primary *is* the longsword now, so the equip is a no-op
and `[data-item="broadsword"]` can never appear; it needs a different weapon to find (`hunting-bow`).
`card-browser` asserts counts per domain, and the starter domains hold 5 each where the vendored ones
held 3.

**Tier B — done: four cards stopped being text only, and the seven specs read them.** It needed
content, not engine work, exactly as this entry predicted. `warding-flame` got the zone its text
describes, `cinder-burst` became the first shipped card aimed at the ground (`target.kind: 'point'`
with `around: 'point'` on the roll), `shield-wall` got a named ally and a condition carrying the
bonus, and the sentinel's printed signature `Hold the Line` became mechanical — both conditions it
needs already existed. Two of the five the file called unsayable were sayable all along: a timed
bonus to someone else is a condition with a duration.

Three rewrites dropped an assertion each, and each drop was a correction rather than a concession:
`shield-wall` carries no check so a `check-prompt` could never appear; `cinder-burst` moves nobody
so the caster-runs-the-line assertion left with Deathrun; and `demo:1819`'s Light-cost assertion
contradicted the pack's rule of spending no Light. One silent guard became an assertion and fired
immediately — `if (targets.length > 1)` had been skipping a whole arm-and-disarm path whenever one
husk stood adjacent, which is the fifth vacuous pass found this way.

**What this uncovered and did not fix.** `contentPackSchema` has no `conditions` field: a project
*document* carries `conditionDefs` and `worldOptions` merges them, but a content *pack* cannot. So a
card that applies a zone condition cannot be imported with the condition it depends on — and a zone
whose condition is missing is silent *and* writes the condition's id into the log, because
`conditionName` falls back to it. Closing that is the next slice for mechanics travelling on cards. *(Closed since: a pack file is
`packDocumentSchema`, which carries conditions.)*
Smaller: `cut-purse-strings`, `rallying-cry` and `smoke-step` are still text only, and only the
first has a real blocker (`addItem` names a bare item id with no source, so taking what somebody
else carries cannot be said); and `holding-the-line`/`caught-in-the-line` still sit in
`content/conditions.ts`, which slice 3 prunes, when they belong beside the feature that arms them.
*(Closed since: `rallying-cry` and `smoke-step` are scripted, Hold the Line's two conditions ship
with the pack, and the magic circle and the echo left for `public/packs/ember-spells.json`.)*

The old diagnosis, kept because the reasoning is the reusable part: the pack shipped 14 abilities —
eleven passives and three `action`s with no effects. These specs exercise the *interactive* paths — arming, a
ground aim, Escape-disarm, an Experience prompt, a zone, a condition — and none can be renamed onto
content that does nothing. It is content work, not engine work: the effect vocabulary already has
`push`, `zone`, `applyCondition`, `check` with `difficulty: 'target'`, `damage`, `move` and
`vaultCard`, and the SRD originals are templates to write against rather than copy.

| Spec | Wants | Write |
|---|---|---|
| `demo:1819` | a Light cost, a check, an Experience pick, a named target | an ember action with a `check` |
| `demo:1856` | arm, pick a target, Escape-disarm, push | a bulwark/ember card with `push` |
| `demo:2436` | a ground aim with `shape()`, `lit()`, and the caster moving | a card aimed at ground |
| `playpass:134` | a named zone with tiles, damage, a floater, a flinch | `cinder-burst` as a real zone |
| `playpass:204` | conditions `holding-the-line` / `caught-in-the-line` | a bulwark card with `zone` + `applyCondition` |
| `readout` ×2 | cards that leave a condition behind | falls out of the two above |

The five cards the pack itself admits ship as text only — `shield-wall`, `rallying-cry`, `smoke-step`,
`cut-purse-strings`, `cinder-burst` — are where these belong, so Tier B is the same work as **making
mechanics carry on cards**, not a detour from it. `holding-the-line` and `caught-in-the-line` are safe
ids to keep: the starter sentinel already ships a signature feature named Hold the Line, so the name
is the pack's own. ~~`korvax-circle` is not, and wants a neutral id.~~ — **closed**: *Two spells
leave the engine for a pack of their own*, above.

If the passing count comes back lower than the pin above, something was lost — check before building on it. Symbol names are
the stable handles here; line numbers move.

---

## The two threads

Everything below served one of two goals, and both have landed.

**1. Remove the borrowed DNA.** The project carries no third-party tabletop IP going forward. Usable
(uncopyrightable) mechanics stay: dual-dice resolution, damage thresholds, armour slots, a stress
pool, the initiative-free loop, card-slot loadouts, advantage, experiences. What goes is everything
expressive — names, the nine-domain catalogue and its card set, verbatim rules text, adversary
names and their printed prose, UI labels lifted from the book. The rule from the legal note:
**ship an original set, and let people import their own.**

**2. Make mechanics importable as cards.** The engine is the base; anything content-bearing is a
pack. And the unit of content is a **card** — not only domain cards, but any feature a character or
creature has. Importing means importing cards; customising means customising cards.

The two specs:

| Spec | Status |
|---|---|
| `docs/superpowers/specs/2026-09-12-generic-engine-content-packs-design.md` | 4 slices, all done: the catalogue is a pack outside the tree, and the renames and the guard are in. |
| `docs/superpowers/specs/2026-09-12-cards-as-the-unit-design.md` | Decided 2026-09-12, built 2026-09-13; its §7 records the decisions taken when building. |

Read both before adding anything that names a source or defines a feature.

---

## 1. Reading order

Do not read the sources first. Forty minutes of reading below saves a day.

| Order | File | Why |
|---|---|---|
| 1 | `docs/CONTEXT.md` | The goal, the hard constraints, the stack. The working agreement. |
| 2 | **this file** | What to build, and the rules that are not written anywhere else. |
| 3 | the two specs above | What "generic" and "cards as the unit" actually mean, including what they rule out. |
| 4 | `docs/DEVELOPING.md` | Extending the engine: layer map, invariants, recipes, gotchas. A reference, not a tutorial. **§11 Gotchas earns its reading twice.** |
| 5 | `docs/CRPG-GAPS.md` | The honest audit against the CRPG goal. Read the relevant section before claiming a system exists or is missing. |
| 6 | `.claude/skills/run-the-demo/SKILL.md` | Driving the app in a real browser. Read it before writing any Playwright of your own. |

`docs/MANUAL.md` is user-facing: playing the demo and authoring content, every panel and field.
The generated `docs/ADVERSARIES.md` and `docs/CARDS.md` went with slice 3, along with their
generators. `docs/research/legacy-*.md` are static-analysis notes on the prototype with `file:line`
anchors; read those instead of re-reading `legacy/`.

---

## 2. The backlog, ranked

Both threads have landed: the IP is out (slice 3); the renames, the migrations and the guard are in
(slice 4, then format versions 3 and 4); and everything a character or a creature has is a card.
What is left is ranked by what a player or an author runs into first.

A *slice* is one behaviour complete: rule, content, editor field, validation, tests, docs. Half a
slice gets finished by someone with less context.

**Keeping this list true is part of landing a slice.** When one lands, delete its item here, record
it in the matching `CRPG-GAPS.md` section as done, and re-pin the commit and suite numbers in the
header. A backlog nobody prunes is wrong within a week, and then it costs the next agent the startup
time it was written to save.

### 1. `demo-scene.ts` comes apart

Measured off the call graph on 2026-09-15, in the order that never breaks an import:

1. ~~**Leaves first:** levelling, equipping, carried items; then **the room**, with travel and
   the `DEMO_*` constants.~~ Both done, above.
2. ~~**Movement.**~~ Done, above; `moveSelectedTo` and `runForIt` stayed, on purpose.
3. ~~**Narrow before splitting the fight.**~~ Done as far as a `Pick` goes (above): 75 of 129
   functions say what they read, and the 51 that cannot are the fight core, one cycle. The
   core does not narrow by type; it narrows by **inversion**: the fight raises what happened
   (a party roll, Hit Points marked, a death) and the reaction and countdown machinery
   subscribes, instead of `record` calling `playPartyRolled` which calls `runAdversaryScript`
   which calls `record`. Decide first whether that is worth doing at all -- the coupling is the
   game's, and the cycle is honest -- and if it is, spec it before touching a line. Splitting
   the 51 into files without it is cosmetic, and the ceiling does not ask for cosmetic.
4. `script/world.ts` and `main.ts` have doubled since the docs were written and get the same
   recipe, after.

Keep `demo-scene.ts` exporting what it exports today; the twenty-six importers are the tests.

### 2. Cards — what is left

The model, the zones, the card editor, text-only cards, pack import and export, and a condition
lending a card are done: each has its entry at the top of this file, and the spec's §7 has the
decisions.

- **The GM playing a stat block's cards.** They are face up on the inspect card, and the GM does
  not play them as cards.
- **Open, not decided:** whether a card handed over mid-fight -- given, or lent by a condition --
  should be announced.
- **Cheaper, not different:** the world's `cards` option is a closure that merges the pack on every
  read. The live read that two tests pin is `inPlay` recomputing a character's granted cards; a map
  built when the world is, if every content change rebuilds the world, would do. Measure first.

**Not a licence to rebuild the catalogue with a card model instead of a list.** The IP constraints
are untouched by this.

### 3. Starter-pack depth

The starter pack is sized to keep the game-layer tests meaningful, not to be a game: three classes
of one domain each, generic ancestries, 15 chosen cards at levels 1 and 2 only (nine and six), and
about ten adversaries. Depth beyond that is a content slice, judged on what it adds to a fight.
`DEVELOPING.md` §7(c) is still the recipe for scripting a feature. Known gaps in what it has:

- `cut-purse-strings` ships as text only, and has a real blocker: `addItem` names a bare item id
  with no source, so taking what somebody else carries cannot be said. (`rallying-cry` and
  `smoke-step` are scripted: *Two starter cards stop being text*, above.)
- No card is above level 2, which is why `progression.test.ts` climbs on a fixture
  (`tests/fixtures/characters.ts`) rather than on the pack.

### 4. The editor rebuild

The user's direction of 2026-09-10, in five parts, each with its own spec, plan and slices:
Shell + Inspector; 3D multi-level world; TaleSpire-style terrain; combat with factions; interaction
graphs. Part 1's spec is `docs/superpowers/specs/2026-09-10-editor-shell-design.md` and its §15
records the rulings (C1–C9) that landed the construction layer. Part 2 starts from
`docs/research/construction-layer-review.md` and `docs/research/multilevel-dependency-map.md`.

**Done:** part 1 slice 1 (the shell's frame); sparse construction with stackable tiles, extended
coordinates, brush/rotation/level controls, undo/save and chunked LOD; placement rotation with a
fisheye Z ladder (`src/editor/height-ladder.ts`); creature models chosen from Combat's panel, per
type or per placed creature; and rigged-model import carrying the `.glb` inside the project with
scale, seating, facing and four animation clips.

**Next:** part 2 — one vertical unit and multilevel navigation over constructed surfaces, spec
first; part 1 slice 2's remaining edit-view items (objects, spawns, trigger cells) and a rotated
prop-facing ghost during Alt.

### 5. Materials for imported models

`CRPG-GAPS.md` §9. Textures arrive with a glTF file, but nothing authors materials: there is no way
to tint one, swap a texture, or override what the file ships with. The file picker that was the other
half of this item landed on 2026-09-12.

### 6. Extend measured rendering budgets beyond construction

Construction has chunk instancing, frustum/distance culling, three LODs and a tested residency
budget (`render/building-view.ts`). Extend those to the legacy height field and props. Large
populated worlds still need hardware FPS/memory profiling; geometry counters are available through
`window.__engine.buildingStats()`.

### 7. Zip project export

`fflate` is a dependency and is imported nowhere under `src/`. `CONTEXT.md`'s "zip import and export
of projects with assets" is not implemented — export is `JSON.stringify` into a `Blob`, so a project
with imported assets cannot be handed to anyone as one file. This matters more once packs are a
product: a pack with art is the same problem.

---

## 3. Known doc drift

`DEVELOPING.md` labels its old line anchors as historical; use symbol names to find current
implementations.

Slice 3's drift is cleaned up: no reference doc -- `DEVELOPING.md`, its HTML twin, `MANUAL.md`,
`CRPG-GAPS.md` -- names a file the repository does not have, and
`tests/unit/doc-references.test.ts` keeps it that way. A record of what was removed (this file,
`CONTEXT.md`, `AGENTS.md`) still names what it removed, which is its job. No doc quotes a count of
catalogue content any more: the catalogue is a pack now, and its numbers are its own.

---

## 4. Working rules that `DEVELOPING.md` §11 does not cover

§11 has the environment traps — the space in the path, the ports, `legacy/`, no lint, `grep -a`, no
TTS, English only. These are the process ones, learned the expensive way.

### Editing files: use a Python patch script, not the shell

**A heredoc carrying a script has failed here more than once** — the shell parses the payload and
dies on an apostrophe or a brace — and **`python -` hangs** and has to be killed off. A heredoc
carrying *prose* is fine; `git commit -F -` that way is the normal path. For edits: write the script
to **your scratchpad directory** with the Write tool, then run `python <path>`. Two passes, so a bad
anchor cannot leave a half-patched tree.

```python
import io

def plan(steps):
    for p, old, _ in steps:
        t = io.open(p, encoding='utf-8').read()
        assert t.count(old) == 1, (p, t.count(old), old[:80])
    for p, old, new in steps:
        t = io.open(p, encoding='utf-8').read()
        io.open(p, 'w', encoding='utf-8', newline='').write(t.replace(old, new))
```

**`newline=''` is not optional.** The repo is LF (`.gitattributes` sets `* text=auto eol=lf`), and
Python's default text mode on Windows rewrites every `\n` to `\r\n` on the way out — one careless
write turns a whole file into a CRLF diff. When an anchor is ambiguous the assertion tells you the
count; extend it with the preceding line rather than reaching for a blind replace-all.

**Read the file into a variable before opening it for writing.** `open(p, 'w').write(read(p)...)`
opens -- and truncates -- before its argument is evaluated, so it reads back an empty file and
writes that. It emptied two files here once, recovered only because every change since HEAD was
still in a script. Build each file's whole text in memory, then open it.

### Every assert runs before every write

Not only within one file — across **all** files a patch touches. A script that writes its first file
and then trips an assertion on its second leaves a half-applied tree and needs a third script to
finish. That happened three times before the ordering was enforced and has not happened since. With
the asserts first, a tripped guard costs a read and nothing else.

### Measure counts, never reason them

In one long conversion, **seven** occurrence counts set by reasoning were wrong and **zero** counts
set by measurement were. Grep the count, then write the assertion from what came back. The same
applies to "this string appears once" intuitions: the same card id wore five different shapes in one
file — a held-card literal, three `useAbility` spellings with different scene variables, and one
element of a multi-card hand belonging to a test the patch did not convert.

And mind the **stage** a count is asserted at: a file-wide grep found six mentions of one id, but two
were call sites an earlier substitution in the same script rewrote, so the correct expectation at the
later pass was four.

### Scope a straggler assert to what the patch claims

An assertion that some departing name appears nowhere in the file is a false alarm when the patch
converts one block. It fired **seven** times on text the patch never touched: test titles, seed
strings, and blocks scheduled for a later slice. Slice the block out, substitute inside it, splice it
back, and assert on that substring.

**Seed strings and test titles carry ids.** A seed is fed to the RNG, so renaming one changes the
rolls and re-rolls any seed-hunting loop. Rename a seed only when it names something proprietary;
when it is an ordinary word, narrow the guard instead.

### A green test can pass for the wrong reason

The expensive class of defect in this work was not red tests but **vacuous** ones. Four examples, all
found by reading rather than by running:

- a "control run" that suppressed nothing, because the override it relied on only ever suppressed
  shipped content — and with a fixture there was nothing to suppress, so both arms were identical;
- a "not offered" assertion that held because the card did not exist at all;
- `useAbility` answering `'missing'` for an unknown id, which **satisfies**
  `expect(...).not.toBe('refused')`;
- a comment claiming a roll used "the block's own Difficulty" when the effect takes a literal and
  cannot read one — the two numbers merely happened to match.

Before trusting a passing assertion about absence, check that the thing whose absence is asserted
*could* have been present.

### `vitest` transpiles without type-checking

A test suite can be green on code `tsc` rejects. `const fixture-lurker = ...` — a hyphen produced by
a blanket rename — ran fine under vitest and failed the build. **Green tests over a red build is not
a pass.** `npx tsc --noEmit` is the only static check in the repo.

### Check who writes a string before rewriting it

Half the strings a test asserts are written by the **engine** out of content's own names —
`${name} uses ${ability.name}`, `${who} turns aside ${n} of it.`, `${who} marks the ground where they
stand.` Those re-pin by themselves when content is renamed, and rewriting them breaks the test for a
reason that looks like a rules bug. The other half is content prose, which must be rewritten. One
grep settles which, and guessing cost real time twice.

### Never `git checkout` a file with uncommitted work in it

To prove a new test fails without its fix, copy the file aside and copy it back. A `checkout` of a
dirty file throws away work that is not recoverable.

### The e2e suite hand-mirrors the driver type

`src/main.ts` declares `window.__engine` in a `declare global` block, and
`tests/e2e/demo.spec.ts` **declares its own copy of that type near the top.** Adding a handle to
`main.ts` without adding it to the spec is a `tsc` failure in the test, not in the app, which reads
as unrelated. Update both in the same patch.

### Driving a fight headless

`setDiceSpeed(0)` first or the dice animation makes everything wait. A move that wakes an encounter
does **not** start it until the tokens arrive — call `arrive()` after the move, or wait for
`gliding() === 0`, before reading `inCombat()`. Copy `intoTheVault` from
`tests/e2e/playpass.spec.ts` rather than writing a route. The skill has the rest, including the four
things that waste an hour.

### Manhattan distance stays

The nearest-creature sorts use Manhattan distance **by the user's explicit decision.** Do not propose
Euclidean again. Range *bands* are a separate matter and go through `bandForSpan` — every tile-to-tile
measurement in the engine does.

### Look at screenshots, and send them

`await page.screenshot({ path: 'test-results/whatever.png' })`, then actually read the image. It
catches the class of defect where the engine is right and the presentation is not — a condition
printed by the id it is keyed by rather than its name, which every unit test agreed with because they
assert on ids too. Send anything the user should see with **SendUserFile**: they follow this work
from a phone and will not scroll a terminal.

### What the guard sees, and what must keep the old names

Carried over from the slice-4 handoff when it was deleted, because nothing else records them.

* **The licensing guard reads `git ls-files`, so an untracked file is invisible to it.** A green run
  says nothing about a file that is not staged: the handoff itself passed 6/6 while untracked and
  showed six violations the moment it was added. `git add` a new file before trusting the guard.
* **When a guard rule fails, fix the source, not the exemption list.** Exempting the file that
  tripped rule 3 would have blinded it in the one file about persisted documents.
* **Some files keep the version-1 names on purpose.** `scene/migrate.ts` and `migrate.test.ts` read
  and table the old field names; `scene/legacy-import.ts` maps the prototype's own document keys. A
  rename pass over them stops the migration migrating **while every one of its tests still passes**
  — the failure only surfaces when somebody loads an old save. The guard's `DELIBERATE` list names
  them.
* **The version-1 fixtures are evidence, not test data.** `tests/fixtures/v1/` is never edited and
  never regenerated; its README says why. Read it, as `document.test.ts` does, and leave it alone.
* **A storage-key fallback is get / set / remove, and remove is the one that goes wrong.** Read the
  current key then the old one; write the current key only; remove **both**. Clearing only the
  current key lets a deleted save come back on the next read, which presents as the delete button
  not working. `save-slots.ts` and `ui/card-art.ts` each have a test asserting the old key is gone.

### Before claiming done

`npx tsc --noEmit`, `npx vitest run`, **and** `npx playwright test`. All three, every time — the e2e
suite is the only thing that catches a broken boot. **A green run is about 3.6 minutes** (103 tests),
so there is no reason to skip it.

A RED run takes far longer -- the two runs that found the repoint's damage took 15.1 and 15.3 minutes,
because a failing locator waits out a 90-second timeout and twenty-one of them is most of that
difference. So a slow run is itself a signal, and a long one is not evidence the suite is expensive.
An earlier version of this file turned that timeout cost into the suite's runtime and told you to
expect fifteen minutes.

**Read the exit code, not the pass count.** Playwright prints `82 passed (15.1m)` as its last
line and the failure count *above* it, so a red run's final line looks like a green one. `EXIT 1`,
or `test-results/.last-run.json` reading `"status": "failed"`, is the verdict. An earlier version of
this file claimed the suite was green on the strength of that pass line; it was red both times it
ran. The same mistake put a false slice-3 precondition here. Read to the end of the output. Every commit
body carries a verification line saying what was run and what came back, then a sentence on how the
new tests were shown to fail without their fix. If something could not be verified, say that instead
of implying it works.

### Commit and report

Commit messages are a sentence about the behaviour, not the files. The body explains the design
decision and why the alternative was rejected. **The `Co-Authored-By` and `Claude-Session` trailer is
whatever the current session hands you** — do not copy the one in `DEVELOPING.md` §9, which is an
example from an older session. A review that follows a slice lands as its own commit that says so;
do not amend the reviewed commit, because the pair is the record.

Close every reply to the user with a **ranked** recommendation of what to do next, unprompted.

**Report at the length the reader asked for.** A long technical narration of every probe and
correction is honest and still wrong if the person reading it cannot find the answer in it. State
what changed, what it cost, and what is next; keep the working out for the commit body.
