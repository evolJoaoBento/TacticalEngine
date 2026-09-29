//! Tactical Engine's server (`docs/SERVER.md`, phase 1).
//!
//! It answers the dev plugins' routes under their own paths, one at a time, while the Vite dev server
//! passes each moved route through to it (`tools/rust-server.ts`). So far: the accounts.

pub mod accounts;
pub mod files;

use axum::routing::any;
use axum::Router;
use std::path::PathBuf;

/// The server, keeping its files under `root` - the repository, where `data/` is.
pub fn app(root: PathBuf) -> Router {
    let keeper = accounts::Keeper::new(root);
    Router::new()
        .route(accounts::ACCOUNTS_URL, any(accounts::handle))
        .route(&format!("{}/{{*rest}}", accounts::ACCOUNTS_URL), any(accounts::handle))
        .with_state(keeper)
}
