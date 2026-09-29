//! The SRD's rules as the engine implements them (`src/engine/rules`): the dice, the Duality Dice and the
//! GM's Die, ranges, countdowns, cover, damage, the pools, and jumps. Held to `server/fixtures/rules.json`,
//! which `src/engine/rules/rules.golden.test.ts` writes, by `tests/golden_rules.rs`.

pub mod countdown;
pub mod cover;
pub mod damage;
pub mod dice;
pub mod duality;
pub mod gm_die;
pub mod jump;
pub mod range;
pub mod resources;
