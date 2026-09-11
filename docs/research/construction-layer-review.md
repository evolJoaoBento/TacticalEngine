# The construction layer: what the review found, and what part 2 needs from it

Taken at commit `40832da` (2026-09-11). Codex (OpenAI) wrote the sparse construction layer in one
overnight pass with no spec or plan; it was committed unchanged as `7c6afa5`, reviewed, and fixed in
`f28da67`, `2848ee2` and `40832da`. The spec's §15 records the rulings that shaped the fixes
(`docs/superpowers/specs/2026-09-10-editor-shell-design.md`). This note keeps the parts of the review
that outlive the fixes: the shape of the format, and what the multi-level world engine (part 2 of the
rebuild) will have to add to it. `docs/research/multilevel-dependency-map.md` is its companion: the
2D assumptions the engine still makes.

## The format, as it stands

- `scene.buildingTiles`: a sparse record keyed `x,y,level`, with `#n` suffixes for overlapping pieces
  (`src/engine/scene/building.ts`). Empty space allocates nothing; coordinates reach ±1,000,000.
  Each piece: `shape` (block · floor · wall · stairs), `material` (stone · wood · grass), `rotation`
  (0–3 quarter turns), `level` (vertical position in tiles, quarter steps), optional `height`
  (vertical size in tiles, 0.25–16).
- `buildingParts(shape, simplified)` returns the boxes the renderer draws for a shape, in a one-tile
  footprint; rotation is applied by the renderer. Floors are a quarter tile thick; a wall sits on
  one edge and moves around the four edges with rotation; stairs are four steps ascending along +Z at
  rotation 0.
- `render/building-view.ts` indexes 16³ chunks in a `Map<column, Map<y, chunk>>`, so the per-frame
  cost depends on the view distance, not the world's extent; instance matrices are chunk-local, which
  is what keeps float32 precise at ±1,000,000.
- `editor/building.ts`'s `BuildingEdit` is a reversible, mergeable edit; erasing peels the most
  recently inserted piece at a position.
- Decos, interactables and adversary placements accept signed coordinates and an optional
  `position.z` in the same tile unit.
- `heights[]` (the tactical ground) is untouched: integer levels of `levelHeight` (0.35 world units).

## Two vertical units

`heights[]` counts levels (0.35); `buildingTiles.level` and `position.z` count tiles (1.0). Codex had
bridged them by writing `z / 0.35` into `heights[]`; that was reverted (ruling C1), because a renderer
constant must not enter saved content and part 2 cannot build one navigation model over two scales.

Part 2's first decision is one unit. The candidate with no data migration: **redefine a level as a
quarter tile** (`levelHeight` 0.35 → 0.25), so `heights[]`, `buildingTiles.level` and `position.z`
are all integer quarter-tiles. It changes only a render constant, but it changes what every map
looks like (the demo's walls drop from 1.4 to 1.0 world units, the plateau from 0.7 to 0.5), and three
things must be checked first: `maxStepHeight = 1` becomes a quarter-tile step, so a floor piece is
walkable and a full block needs stairs; the demo rooms' e2e screenshots may shift;
`los.blockingHeightMargin` is in levels and must still block sight where it should. The alternatives
are construction in 0.35 levels (blocks stop being cubes) or `heights[]` in tile units (a migration of
every scene and of `legacy-import`).

## What a navigation model needs that the format does not yet give

- **A walkable-surface query per column.** "The top surface at (x, y) at or below z" is a scan of
  the whole record today. A per-column sorted index in `engine/scene/` (the renderer already builds one
  for chunks) or a secondary index maintained by `BuildingEdit`.
- **Navigation semantics per shape and rotation, not boxes.** For each piece: does it provide a
  standing surface, at what height (floor: `level + 0.25`; block: `level + height`; stairs: a ramp
  from `level` to `level + 1`; wall: none), and which of the four edges does it block for movement and
  for sight (a wall: one edge, by rotation). A `nav` descriptor beside `buildingParts`, so part 2
  extends rather than rewrites.
- **A stairs direction contract.** The four boxes ascend along +Z at rotation 0; nothing records it,
  so a pathfinder would re-derive it from the box list.
- **`height` against stacking.** A block at `level 0, height 4` and a floor at `level 2` overlap with
  no schema objection. Either forbid the overlap in `superRefine`, or compute the highest surface from
  spans rather than keys.
- **Stack order.** Erase peels by record insertion order, which undo re-orders (a re-inserted key
  goes last). An explicit ordering field if part 2 needs the stack to be deterministic.
- **Off-board content.** Placements outside the board are authored but take no part in play
  (ruling C5) until a constructed surface can be a navigation node.
- **What the dependency map already lists** still applies: one dense index space, positions with no
  level, occupancy keyed by column, 2D range and line of sight, and a heightfield renderer.

## Deferred from the review, by ruling

Small items the fix wave did not take, for whoever touches these files next: 441 template-literal
map keys per camera move in `BuildingView.update` (a numeric key would remove the allocation); the
LOD test's hardcoded distances (wide margins, not brittle today); `BuildingView` owning the placement
preview and guide grid, which are editor chrome living in `engine/render/`.
