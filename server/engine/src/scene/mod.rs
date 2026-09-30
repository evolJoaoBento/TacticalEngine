//! The scene (`src/engine/scene`): the document an author writes and its migration (`document`,
//! `migrate`), a room stood up from it - its grid (`grid_from_scene`, with `building` and `deco_span`), its
//! play state (`state`), the things in it that can be used (`prop_functions`, `interact`) and the ground that
//! wakes an encounter (`triggers`) - and a room grown to reach what was laid outside it (`reshape`).

pub mod building;
pub mod deco_span;
pub mod document;
pub mod grid_from_scene;
pub mod interact;
pub mod migrate;
pub mod prop_functions;
pub mod reshape;
pub mod state;
pub mod triggers;
