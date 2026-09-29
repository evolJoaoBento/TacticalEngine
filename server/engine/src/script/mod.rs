//! Scripts (`src/engine/script`): the one effect vocabulary - its shape (`schema`), evaluating its
//! conditions (`conditions`), and what a scenario carries for it: marked spots (`marks`), standing zones
//! (`zones`) and running countdowns (`countdowns`); running a script (`runner`) and the scene it runs in
//! (`world`). Held to `server/fixtures/script.json`, `conditions.json`, `runner.json` and `world.json` by
//! the golden tests of the same names. Hooks follow.

pub mod conditions;
pub mod countdowns;
pub mod marks;
pub mod runner;
pub mod schema;
pub mod world;
pub mod zones;
