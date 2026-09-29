//! Tactical Engine's server (`docs/SERVER.md`, phase 1).
//!
//! It answers the dev plugins' routes under their own paths, one at a time, while the Vite dev server
//! passes each moved route through to it (`tools/rust-server.ts`). So far: the accounts, the Store and
//! your models.

pub mod accounts;
pub mod files;
pub mod js;
pub mod store;
pub mod your_models;

use axum::routing::any;
use axum::Router;
use std::path::PathBuf;

/// The server, keeping its files under `root` - the repository, where `data/` is.
pub fn app(root: PathBuf) -> Router {
    let keeper = accounts::Keeper::new(root.clone());
    let shop = store::Shop::new(root.clone());
    let shelf = your_models::Shelf::new(root);
    let accounts = Router::new()
        .route(accounts::ACCOUNTS_URL, any(accounts::handle))
        .route(&format!("{}/{{*rest}}", accounts::ACCOUNTS_URL), any(accounts::handle))
        .with_state(keeper);
    let store = Router::new()
        .route(store::STORE_URL, any(store::handle))
        .route(&format!("{}/{{*rest}}", store::STORE_URL), any(store::handle))
        .with_state(shop);
    let mut models = Router::new();
    for base in [your_models::YOUR_MODELS_URL, your_models::IMPORT_MODEL_URL, your_models::USER_MODELS_URL] {
        models = models.route(base, any(your_models::handle)).route(&format!("{base}/{{*rest}}"), any(your_models::handle));
    }
    accounts.merge(store).merge(models.with_state(shelf))
}
