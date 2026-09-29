//! Scripts (`src/engine/script`): the one effect vocabulary. So far its shape (`schema`), held to
//! `server/fixtures/script.json`, which `src/engine/script/script.golden.test.ts` writes, by
//! `tests/golden_script.rs`. The conditions' evaluation, the runner, the world and hooks follow.

pub mod schema;
