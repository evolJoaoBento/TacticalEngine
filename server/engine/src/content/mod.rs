//! The content a character is made of, as far as `src/engine/character` reads it: the pack's
//! definitions (`content/pack/import.ts`), the abilities' bonuses and ranking (`content/abilities.ts`),
//! what the gear's features plainly say (`content/equipment/features.ts`), and - read as zod reads them -
//! the content schemas (`schema`) and pack documents (`document`); and what the world reads - stat blocks
//! (`adversaries`), condition definitions (`conditions`) and loot tables (`items`). Held to `server/fixtures/character.json`
//! and `server/fixtures/content.json` by `tests/golden_character.rs` and `tests/golden_content.rs`.

pub mod abilities;
pub mod adversaries;
pub mod conditions;
pub mod document;
pub mod features;
pub mod items;
pub mod pack;
pub mod schema;
