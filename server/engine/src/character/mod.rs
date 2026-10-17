//! Characters (`src/engine/character`): sheets, what they derive to, and levelling up. Held to
//! `server/fixtures/character.json`, which `src/engine/character/character.golden.test.ts` writes, by
//! `tests/golden_character.rs`.

pub mod progression;
pub mod schema;
pub mod sheet;
