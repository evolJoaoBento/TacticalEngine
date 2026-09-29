//! Tactical Engine's rules, in Rust (`docs/SERVER.md`).
//!
//! Ported module by module from `src/engine`, each held to golden fixtures the TypeScript engine
//! writes (`server/fixtures/`), so a module here does exactly what its TypeScript original does. The
//! crate touches no files, no clock and no network: the server that runs it is another crate, and it
//! builds to WebAssembly for the editor's playtest.

pub mod rng;
