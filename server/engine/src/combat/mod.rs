//! Combat (`src/engine/combat`): targeting and areas, what a stat block's features add up to, attacks
//! rolled and landed, defences by policy or by plan, and whose turn it is. Held to
//! `server/fixtures/combat.json`, which `src/engine/combat/combat.golden.test.ts` writes, by
//! `tests/golden_combat.rs`.

pub mod adversary_features;
pub mod area;
pub mod attack;
pub mod defense;
pub mod encounter;
pub mod targeting;
