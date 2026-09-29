//! Scripts (`src/engine/script`): the one effect vocabulary - its shape (`schema`), evaluating its
//! conditions (`conditions`), and what a scenario carries for it: marked spots (`marks`), standing zones
//! (`zones`) and running countdowns (`countdowns`). Held to `server/fixtures/script.json` and
//! `server/fixtures/conditions.json` by `tests/golden_script.rs` and `tests/golden_conditions.rs`. The
//! runner, the world and hooks follow.

pub mod conditions;
pub mod countdowns;
pub mod marks;
pub mod runner;
pub mod schema;
pub mod zones;
