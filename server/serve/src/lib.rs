//! Tactical Engine's server (`docs/SERVER.md`, phase 1).
//!
//! It answers the dev plugins' routes under their own paths, one at a time, while the Vite dev server
//! passes each moved route through to it (`tools/rust-server.ts`). So far: the accounts, the Store, your
//! models, the engine's models (adding one, and their ancestries), the art marks and the default project.

pub mod accounts;
pub mod art_and_project;
pub mod files;
pub mod js;
pub mod manifest;
pub mod store;
pub mod your_models;

use axum::routing::any;
use axum::Router;
use std::path::PathBuf;

/// The server, keeping its files under `root` - the repository, where `data/` is.
pub fn app(root: PathBuf) -> Router {
    let keeper = accounts::Keeper::new(root.clone());
    let shop = store::Shop::new(root.clone());
    let shelf = your_models::Shelf::new(root.clone());
    let workshop = manifest::Workshop::new(root.clone());
    let archive = art_and_project::Archive::new(root);
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
    let engine = Router::new()
        .route(manifest::MODEL_ADD_URL, any(manifest::handle))
        .route(manifest::ANCESTRY_URL, any(manifest::handle))
        .with_state(workshop);
    let mut saves = Router::new();
    for route in [art_and_project::PROVENANCE_URL, art_and_project::PROJECT_URL, art_and_project::SAVE_URL] {
        saves = saves.route(route, any(art_and_project::handle));
    }
    accounts.merge(store).merge(models.with_state(shelf)).merge(engine).merge(saves.with_state(archive))
}
