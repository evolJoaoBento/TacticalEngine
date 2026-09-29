//! The game served by the Rust server alone: the page and its scripts from the built client, the assets
//! live from `public/` (and ahead of the build's), the page for any path that is neither - and nothing
//! else on the disk, whatever the path asks for. The routes still answer beneath it.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use std::path::{Path, PathBuf};
use tower::ServiceExt;

const PAGE: &str = "<!doctype html><title>Tactical Engine</title>";

fn folder(name: &str) -> (PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("tactical-site-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let site = root.join("dist-server");
    for dir in ["public/models", "public/cards", "dist-server/assets", "dist-server/models", "dist-server/cards", "data", "projects"] {
        std::fs::create_dir_all(root.join(dir)).unwrap();
    }
    std::fs::write(site.join("index.html"), PAGE).unwrap();
    std::fs::write(site.join("assets/main-abc123.js"), "console.log('game')").unwrap();
    std::fs::write(root.join("public/models/Quim.glb"), b"glTF live").unwrap();
    // The same model as the build copied it once: the live one wins.
    std::fs::write(site.join("models/Quim.glb"), b"glTF stale").unwrap();
    std::fs::write(root.join("data/accounts.json"), r#"[{"id":"admin","hash":"secret"}]"#).unwrap();
    std::fs::write(root.join("public/cards/index.json"), r#"{"bard":"bard.webp"}"#).unwrap();
    std::fs::write(root.join("public/cards/bard.webp"), b"private art").unwrap();
    std::fs::write(site.join("cards/index.json"), "{}
").unwrap();
    std::fs::write(root.join("projects/default.json"), r#"{"id":"p","scenes":[{}]}"#).unwrap();
    (root, site)
}

async fn get(root: &Path, site: &Path, path: &str) -> (StatusCode, String, String) {
    fetch(root, site, path, true).await
}

async fn fetch(root: &Path, site: &Path, path: &str, private_art: bool) -> (StatusCode, String, String) {
    let request = Request::builder().uri(path).body(Body::empty()).unwrap();
    let response = serve::site(root.to_path_buf(), site.to_path_buf(), private_art).oneshot(request).await.unwrap();
    let kind = response.headers().get("content-type").map(|v| v.to_str().unwrap().to_string()).unwrap_or_default();
    let status = response.status();
    (status, kind, String::from_utf8_lossy(&response.into_body().collect().await.unwrap().to_bytes()).into_owned())
}

#[tokio::test]
async fn the_game_is_served_from_the_build_and_the_assets_live() {
    let (root, site) = folder("game");
    let page = get(&root, &site, "/").await;
    assert_eq!((page.0, page.2.as_str()), (StatusCode::OK, PAGE));
    assert!(page.1.starts_with("text/html"), "{}", page.1);
    let script = get(&root, &site, "/assets/main-abc123.js").await;
    assert_eq!((script.0, script.2.as_str()), (StatusCode::OK, "console.log('game')"));
    assert!(script.1.contains("javascript"), "{}", script.1);
    let model = get(&root, &site, "/models/Quim.glb").await;
    assert_eq!((model.0, model.2.as_str()), (StatusCode::OK, "glTF live"));
    // A path that is no file is the page, which reads its own query.
    assert_eq!(get(&root, &site, "/somewhere/else").await.2, PAGE);
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn nothing_outside_the_two_folders_is_served() {
    let (root, site) = folder("outside");
    for path in ["/data/accounts.json", "/../data/accounts.json", "/models/../../data/accounts.json", "/%2e%2e/data/accounts.json", "/..%2fdata%2faccounts.json", "/models/..%5c..%5cdata%5caccounts.json"] {
        let (_, _, body) = get(&root, &site, path).await;
        assert!(!body.contains("secret"), "{path} served the accounts: {body}");
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn the_routes_still_answer_beneath_it() {
    let (root, site) = folder("routes");
    let project = get(&root, &site, "/projects/default.json").await;
    assert_eq!((project.0, project.1.as_str(), project.2.as_str()), (StatusCode::OK, "application/json", r#"{"id":"p","scenes":[{}]}"#));
    let me = get(&root, &site, "/__accounts/me").await;
    assert_eq!((me.0, me.1.as_str()), (StatusCode::UNAUTHORIZED, "application/json"));
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn the_private_card_art_is_served_only_to_this_machine() {
    let (root, site) = folder("cards");
    assert_eq!(fetch(&root, &site, "/cards/bard.webp", true).await.2, "private art");
    assert_eq!(fetch(&root, &site, "/cards/index.json", true).await.2, r#"{"bard":"bard.webp"}"#);
    // Beyond this machine: the build's empty index, and no picture at all.
    assert_eq!(fetch(&root, &site, "/cards/index.json", false).await.2, "{}
");
    assert!(!fetch(&root, &site, "/cards/bard.webp", false).await.2.contains("private art"));
    // Everything else is served alike.
    assert_eq!(fetch(&root, &site, "/models/Quim.glb", false).await.2, "glTF live");
    let _ = std::fs::remove_dir_all(&root);
}
