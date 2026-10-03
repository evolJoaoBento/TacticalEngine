//! The grid (`src/engine/grid`): tiles, terrain, sight and cover, reachability and paths, and the walk.
//! What the rules, movement and combat all stand on. Held to `server/fixtures/grid.json`, which
//! `src/engine/grid/grid.golden.test.ts` writes, by `tests/golden_grid.rs`.

pub mod los;
pub mod pathfinding;
pub mod terrain;
pub mod tile_grid;
pub mod walk;

pub use tile_grid::{Spot, TileGrid, NOTHING_STACKED, NO_TILE, SLAB_BLOCKS};
