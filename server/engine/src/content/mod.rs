//! The content a character is made of, as far as `src/engine/character` reads it: the pack's
//! definitions (`content/pack/import.ts`), the abilities' bonuses and ranking (`content/abilities.ts`),
//! and what the gear's features plainly say (`content/equipment/features.ts`). Held to
//! `server/fixtures/character.json` by `tests/golden_character.rs`.

pub mod abilities;
pub mod features;
pub mod pack;
