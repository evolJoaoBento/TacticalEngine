# Multi-level world: dependency map

A read-only survey of everything that assumes **one walkable surface per (x, y) column**, taken at
commit `96c8c05` (2026-09-10) as input for part 2 of the editor rebuild, the 3D world engine (see
`docs/superpowers/specs/2026-09-10-editor-shell-design.md` §0). Symbol names are the stable
handles; line numbers were not recorded because they move.

`demo-scene.ts`, `main.ts` and `scene-view.ts` were read only in their geometry sections; the rest
of their hits are by grep. Every `grid/*`, `scene/*` and `combat/*` file, `world.ts`, `layout.ts` and
`terrain-mesh.ts` was read in full.

## The ten riskiest assumptions, ranked

1. **One dense index space with arithmetic adjacency.** `TileGrid.indexOf` / `xOf` / `yOf` /
   `forEachNeighbor` (±1, ±width), `Pathfinder` buffers sized `grid.size`, and every loop over
   `0..size` (`ReachableField.tiles`, `zoneFootprint`, `standingRoom`, `sceneTerrainFromGrid`).
2. **The authored document is one row-major surface.** `sceneSchema.terrain` / `heights` / `tints`
   with the `superRefine` length check; `pointSchema {x, y}` in five places (spawns,
   `interactable.position`, `adversaryPlacement.position`, `encounter.triggerCells`,
   `deco.position`); `formatVersion: z.literal(1)`.
3. **Saves store raw tile numbers.** `sceneSnapshotSchema.entities[].tile` and `.at`,
   `runningZoneSchema.anchor`, mark tiles in the scenario variables, and
   `saveSchema.formatVersion: z.literal(1)`.
4. **Neighbours are horizontal only, gated by a height difference.** There is no link type for
   stairs, ladders or drops and no cost for changing level (`Pathfinder.canStep`,
   `forEachNeighbor`, `walk.canStandAt`, `segmentClear`).
5. **Positions have no level.** `EntityState.at: Spot {x, y}`; `tileAtSpot` resolves a column, not a
   floor (`SceneState.placeEntity`, `Party.walkTo` / `settle`, `settleEnd`, `smoothPath`).
6. **Occupancy and blocking are keyed by column.** `SceneState.occupants`, `blockingInteractables`,
   the 3×3 check in `bodiesExcept`, `TriggerIndex.byTile`, and `validate.ts`'s "shares a tile". A
   creature under a bridge would block one standing on it.
7. **Range is 2D.** `euclideanDistance` feeds `bandForSpan` in `evaluateTarget`, `area.*`,
   `SceneScriptWorld.bandBetween` (zones, selectors, summons) and the demo's `approach` /
   `strikeTile`. Manhattan orders GM targets and followers — and stays, by the user's decision
   (`BACKLOG.md` §4).
8. **Line of sight is a 2D walk plus a height test.** `traceLine`, and `blocksBetween` (a tile
   blocks when its height minus the higher endpoint reaches `blockingHeightMargin`). No ceilings,
   no overhangs, no shot under a bridge.
9. **Rendering is a heightfield end to end.** `buildTerrainMesh`, `TerrainMesh.tileOf`,
   `main.groundUnderPointer` picking a column, `worldToSpot` / `tileAtWorld` dropping Y, and
   `tileCenter` / `spotToWorld` taking Y from the column for every token, glide, highlight, cursor
   and deco.
10. **The editor authors one surface.** `session.tileIndex`, `brushTiles`, `resizeScene`,
    `adjustHeight`, `EditorController.inspect` (one `height`), and `decoAt` / `interactableAt`
    matching on x, y only.

## How the rules use height today

- **Stepping.** `Pathfinder.canStep` and `isCornerClear` refuse a height difference above
  `maxStepHeight` (1, also in the demo), both up and down. A drop is refused like a climb.
- **Movement cost.** Height adds nothing.
- **Standing.** `canStandAt` refuses a body that overhangs a drop, and `segmentClear` rejects a
  level change of more than one step.
- **Line of sight.** It is blocked by terrain that `blocksSight`, or by a tile that is at least the
  margin above both endpoints. There is no interpolation along the line.
- **Cover.** Cover comes from the target's terrain having `providesCover`, or from a partial
  corner obstruction. Elevation gives nothing.
- **High ground, falling, climbing.** None of them exist.
- **Legacy import.** `WALL_HEIGHT = 4` turns into wall terrain.
- **Height is enforced unevenly, which becomes a bug once levels exist.**
  - These ignore height: `pushBack`, `blinkTo`, `standingRoom` (summon and replace, via
    `bodyFree`), `gatherParty` / `freeTileNear`, the `standNear` / `standBeside` driver handles,
    and `moveUnderPressure`.
  - `drawTo`, `drawIn` and `breakAway` respect height, because they go through `Pathfinder`.

## Public APIs that would need a level

- **Grid:**
  - `TileGrid` construction
  - `indexOf`, `tileAtSpot`, `spotOf`, `xOf`, `yOf`
  - `heightAt`, `setHeight`
  - `terrainAt`, `costAt`, `isPassable`, `blocksSight`, `setTerrain`
  - the three distances
  - `forEachNeighbor`, `isDiagonalStep`
  - `Spot`, `NO_TILE`
- **Pathfinding:** `MovementRules.maxStepHeight`, `MovementContext.isBlocked`/`extraCost`,
  `Pathfinder.reachable`/`findPath`/`nearestReachableAdjacentTo`/`tracePath`.
- **Walk:** `canStandAt`, `segmentClear`, `settleEnd`, `smoothPath`, `WalkRules.maxStepHeight`.
- **Line of sight:** `traceLine`, `lineOfSight`, `hasLineOfSight`, `coverBetween`,
  `LineOfSightRules.blockingHeightMargin`.
- **Combat:** `evaluateTarget`, `canTarget`, `isLegalOrigin`, `isInArea`, `tilesInArea`,
  `moveUnderPressure`.
- **Scene:**
  - `pointSchema`, and the scene's terrain, heights, tints, spawns, positions and trigger cells
  - `gridFromScene`, `tileOf`, `pointOf`, `sceneTerrainFromGrid`, `blankScene`
  - `EntityState.tile` / `.at`
  - `SceneState.moveEntity`, `placeEntity`, `occupantsOf`, `blockedFor`, `bodyFree`,
    `placeInteractable`, `setInteractableBlocking`
  - `createAdversaryEntity`
  - `Party.walkTo` / `planWalk` / `moveTo` / `lineAlong` / `followAlong`
  - `TriggerIndex.at` / `firstAlong`
- **Render:**
  - `surfaceHeight`, `tileCenter`, `tileAtWorld`, `worldToSpot`, `spotToWorld`
  - `buildTerrainMesh` / `TerrainMesh.tileOf`
  - `SceneView.showHighlights`, `showZones`, `showCursor`, `showSelection`, `lunge`, `rebind`
- **Script:**
  - `ScriptWorld.tileOf`, `recallSpot`, `drawTo`, `blinkTo`, `pushBack`, `drawIn`, `breakAway`
  - the runner's `point` option, and `TargetBindings.point`
  - `SceneScriptWorld.bandBetween`, `alongPath`, `zoneFootprint`, `marks`
  - `RunningZone.anchor`
- **Editor:** `setHeight`, `adjustHeight`, `paintTerrain`, `brushTiles`, `resizeScene`,
  `removeDecoAt`, `rotateDeco`, `toggleTriggerCell`, `setSpawns`, and the controller's `begin`,
  `paint`, `decoAt`, `interactableAt`, `inspect`.
- **Game:** `moveSelectedTo`, `previewWalk`, `gatherParty`, `shapeAt`, `useAbility`'s point.

## Tests that pin two dimensions

**Unit.** 25 distinct files construct a `TileGrid` or touch heights. 33 build scenes, and 22 call
`indexOf`, `tileAtSpot`, `spotOf`, `xOf` or `yOf` directly.

**End-to-end.** The driver type is mirrored only in `tests/e2e/demo.spec.ts`. Handle usage across
the specs, with call counts:

| Kind | Handles (calls) |
|---|---|
| Take a tile index | `moveTo` (17), `editAt` (8), `terrainAt` (8), `screenOf` (7), `inspect` (4), `useAbility` point (4), `heightAt` (3), `placeProp` (3), `playAt` (1), `shape` (1) |
| Take a spot | `walkTo` (2), `previewAt` (2), `screenAt` (3) |
| Return tiles or spots | `tileOf` (55), `reachable` (25), `standingAt` (7), `cursorTile` (3), `objectTile` (2), `aim` (2), `lit` (1), `zones` (1) |
| Placement helpers that ignore height | `standBeside` (38), `standNear` (5) |

Specs also hard-code row-major arithmetic:
- `demo.spec.ts`: `3*22+3`, `y*22+x`, `4*10+x`, `9*22+3`, and `pit.terrain[4*10+5]` read from the
  exported JSON.
- `playpass.spec.ts`: `moveTo(9*22+4)`.

## Weight by file (approximate symbol hits)

| File | Hits | File | Hits |
|---|---|---|---|
| `demo-scene.ts` | 115 | `los.ts` | 28 |
| `world.ts` | 97 | `controller.ts` | 28 |
| `scene-view.ts` | 66 | `runner.ts` | 23 |
| `main.ts` | 62 | `validate.ts` | 23 |
| `session.ts` | 54 | `terrain-mesh.ts` | 20 |
| `party.ts` | 53 | `area.ts` | 18 |
| `pathfinding.ts` | 44 | `grid-from-scene.ts` | 18 |
| `state.ts` | 42 | `layout.ts` | 17 |
| `walk.ts` | 40 | `legacy-import.ts` | 16 |
| `grid.ts` | 39 | `schema.ts` | 15 |
| | | `targeting.ts` | 15 |
