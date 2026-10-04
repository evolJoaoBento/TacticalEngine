//! Dialogue (`src/engine/dialogue`): conversations as authored data, the walk that runs one, and the
//! editor's layout and graph readers. The walk asks `script/` its questions through a `DialogueHost`;
//! held to `server/fixtures/dialogue.json`, which `src/engine/dialogue/dialogue.golden.test.ts` writes, by
//! `tests/golden_dialogue.rs`.

pub mod layout;
pub mod runner;
pub mod schema;
