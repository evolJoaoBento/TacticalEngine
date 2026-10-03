//! Tactical Engine's server (`docs/SERVER.md`, phase 1).
//!
//! It answers every route the dev plugins answered, under their own paths - the accounts, the Store,
//! your models, the engine's models (adding one, and their ancestries), the art marks and the default
//! project, the two lists the page loads when it opens: the engine's models and the art marks, and the
//! games themselves, played at `/__play` (`play.rs`, phase 3) (`app`) -
//! and, given a built client, serves the game itself (`site`): the page and its
//! scripts from the build, and the models, card art and pictures live from `public/`, so a model added
//! to the engine is there without building again. Behind the Vite dev server only `app` is reached: the
//! dev server passes the routes through (`tools/rust-server.ts`) and serves the page itself.

pub mod accounts;
pub mod art_and_project;
pub mod files;
pub mod js;
pub mod manifest;
pub mod play;
pub mod saves;
pub mod store;
pub mod your_models;

use axum::routing::{any, get};
use axum::Router;
use std::path::PathBuf;

/// How a server was asked to run beyond where it keeps its files.
#[derive(Clone, Copy, Debug, Default)]
pub struct Settings {
    /// The tests' server: a game opened with its dice where the page's are (`--dice-from-page`, `play.rs`).
    pub dice_from_page: bool,
}

/// The server, keeping its files under `root` - the repository, where `data/` is.
pub fn app(root: PathBuf) -> Router {
    app_with(root, Settings::default())
}

/// The server, as `app`, run as `settings` say.
pub fn app_with(root: PathBuf, settings: Settings) -> Router {
    let keeper = accounts::Keeper::new(root.clone());
    let shop = store::Shop::new(root.clone());
    let shelf = your_models::Shelf::new(root.clone());
    let workshop = manifest::Workshop::new(root.clone());
    let root_for_play = root.clone();
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
        .route(manifest::SHIPPED_URL, get(manifest::shipped))
        .with_state(workshop);
    let mut saves = Router::new();
    for route in [art_and_project::PROVENANCE_URL, art_and_project::PROJECT_URL, art_and_project::SAVE_URL] {
        saves = saves.route(route, any(art_and_project::handle));
    }
    saves = saves.route(art_and_project::MARKS_URL, get(art_and_project::marks));
    let saved = Router::new()
        .route(saves::SAVES_URL, any(saves::handle))
        .route(&format!("{}/{{*rest}}", saves::SAVES_URL), any(saves::handle))
        .with_state(root_for_play.clone());
    let tables = play::Tables::new(root_for_play);
    let play = play::router_for(if settings.dice_from_page { tables.with_dice_from_page() } else { tables });
    accounts.merge(store).merge(models.with_state(shelf)).merge(engine).merge(saves.with_state(archive)).merge(saved).merge(play)
}

/// Where the built client is, from the repository: `npm run build:server` writes it.
pub const SITE: &str = "dist-server";
/// Where the assets the build leaves out are served from, live.
pub const ASSETS: &str = "public";

/// The routes, and under them the game: a file in `public/` (a model, a card's picture, a font), else one
/// in the built client (`site`: the page and its scripts), else the page - which reads the query itself.
/// Nothing outside those two folders is ever served: `data/` - the accounts, the saves - is not in
/// either, and a path that climbs out of them (`..`) is refused before any file is looked at.
///
/// **The card art in `public/cards/` is private** - reference art for this machine, never to be handed
/// on (`tools/build-public-assets.ts` keeps it out of every build). It is served only with `private_art`,
/// which the binary sets only when it listens on this machine alone; otherwise `/cards/` is the build's,
/// which carries an empty index and nothing else, as a built site does.
pub fn site(root: PathBuf, site: PathBuf, private_art: bool) -> Router {
    use tower_http::services::{ServeDir, ServeFile};
    let page = ServeFile::new(site.join("index.html"));
    let files = ServeDir::new(root.join(ASSETS)).fallback(ServeDir::new(&site).fallback(page.clone()));
    let router = app(root).fallback_service(files);
    if private_art {
        router
    } else {
        router.nest_service("/cards", ServeDir::new(site.join("cards")).fallback(page))
    }
}
