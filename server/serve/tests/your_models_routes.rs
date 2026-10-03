//! The your-models routes end to end, over a folder of their own: a player's list, a file imported and
//! imported again, a model copied from another player's folder, the file served to anybody signed in,
//! and every refusal the TypeScript gives.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tower::ServiceExt;

const GLB: &[u8] = &[0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0, 42];
/// The same bytes, as base64 and as a data URL.
const GLB64: &str = "Z2xURgIAAAAMAAAAKg==";
const PAGE: [(&str, &str); 3] = [("x-tactical-save", "1"), ("origin", "http://127.0.0.1:8420"), ("host", "127.0.0.1:8420")];

fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-yours-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

struct Reply {
    status: StatusCode,
    body: Vec<u8>,
    kind: String,
    cache: String,
    cookie: Option<String>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

async fn send(root: &Path, method: &str, path: &str, body: &str, cookie: Option<&str>, page: bool) -> Reply {
    let mut request = Request::builder().method(method).uri(path);
    if page {
        for (name, value) in PAGE {
            request = request.header(name, value);
        }
    }
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    let response = serve::app(root.to_path_buf()).oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let header = |name: &str| response.headers().get(name).map(|v| v.to_str().unwrap().to_string());
    let (status, kind, cache, cookie) = (response.status(), header("content-type").unwrap_or_default(), header("cache-control").unwrap_or_default(), header("set-cookie"));
    Reply { status, body: response.into_body().collect().await.unwrap().to_bytes().to_vec(), kind, cache, cookie }
}

async fn player(root: &Path, name: &str) -> String {
    let made = send(root, "POST", "/__accounts/register", &json!({ "name": name, "password": "hunter22" }).to_string(), None, true).await;
    made.cookie.unwrap().split(';').next().unwrap().to_string()
}

async fn import(root: &Path, body: Value, cookie: &str) -> Reply {
    send(root, "POST", "/__models/import", &body.to_string(), Some(cookie), true).await
}

#[tokio::test]
async fn a_players_models_come_in_once_and_are_served_to_anybody_signed_in() {
    let root = folder("life");
    let a = player(&root, "rt-a").await;
    let b = player(&root, "rt-b").await;

    let none = send(&root, "GET", "/__models/mine", "", Some(&a), false).await;
    assert_eq!((none.status, none.json(), none.cache.as_str()), (StatusCode::OK, json!([]), "no-store"));

    let first = import(&root, json!({ "name": "Carried Thing.glb", "data": format!("data:model/gltf-binary;base64,{GLB64}") }), &a).await;
    assert_eq!(first.status, StatusCode::OK);
    let model = first.json();
    assert_eq!((model["model"]["id"].clone(), model["model"]["url"].clone(), model["fresh"].clone()), (json!("carried-thing"), json!("/__models/u/rt-a/imported/carried-thing.glb"), json!(true)));
    // The same bytes again, under another name: the same model.
    let again = import(&root, json!({ "name": "x.glb", "data": GLB64 }), &a).await.json();
    assert_eq!((again["model"]["id"].clone(), again["fresh"].clone()), (json!("carried-thing"), json!(false)));

    // Served to anybody signed in, not to nobody.
    let url = "/__models/u/rt-a/imported/carried-thing.glb";
    let served = send(&root, "GET", url, "", Some(&b), false).await;
    assert_eq!((served.status, served.kind.as_str(), served.cache.as_str(), served.body.as_slice()), (StatusCode::OK, "model/gltf-binary", "no-cache", GLB));
    let nobody = send(&root, "GET", url, "", None, false).await;
    assert_eq!((nobody.status, nobody.json()["reason"].clone()), (StatusCode::UNAUTHORIZED, json!("sign in first")));
    assert_eq!(send(&root, "GET", "/__models/u/rt-a/imported/missing.glb", "", Some(&b), false).await.status, StatusCode::NOT_FOUND);
    assert_eq!(send(&root, "GET", "/__models/u/rt-a/imported/../../../accounts.json", "", Some(&b), false).await.status, StatusCode::NOT_FOUND);

    // Copied from another player's folder into one's own.
    let copied = import(&root, json!({ "url": url }), &b).await.json();
    assert_eq!((copied["model"]["url"].clone(), copied["fresh"].clone()), (json!("/__models/u/rt-b/imported/carried-thing.glb"), json!(true)));
    assert_eq!(std::fs::read(root.join("data/users/rt-b/models/imported/carried-thing.glb")).unwrap(), GLB);
    let missing = import(&root, json!({ "url": "/__models/u/rt-a/imported/nothing.glb" }), &b).await;
    assert_eq!((missing.status, missing.json()["reason"].clone()), (StatusCode::NOT_FOUND, json!("no such model")));

    let mine = send(&root, "GET", "/__models/mine", "", Some(&b), false).await.json();
    assert_eq!(mine.as_array().unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn refusals_come_as_the_typescript_gives_them() {
    let root = folder("refusals");
    let a = player(&root, "rt-a").await;
    let nobody = send(&root, "GET", "/__models/mine", "", None, false).await;
    assert_eq!((nobody.status, nobody.json()["reason"].clone()), (StatusCode::UNAUTHORIZED, json!("sign in first")));
    let not_post = send(&root, "GET", "/__models/import", "", Some(&a), true).await;
    assert_eq!((not_post.status, not_post.json()["reason"].clone()), (StatusCode::FORBIDDEN, json!("not a POST")));
    let not_page = send(&root, "POST", "/__models/import", "{}", Some(&a), false).await;
    assert_eq!((not_page.status, not_page.json()["reason"].clone()), (StatusCode::FORBIDDEN, json!("not sent by the page")));
    let signed_out = send(&root, "POST", "/__models/import", "{}", None, true).await;
    assert_eq!((signed_out.status, signed_out.json()["reason"].clone()), (StatusCode::UNAUTHORIZED, json!("sign in first")));
    for (body, reason) in [
        (json!({ "url": "/etc/passwd" }), "that is not a model in a player\u{2019}s folder"),
        (json!({ "name": "p.png", "data": "iVBORw0KGgo=" }), "a model is a binary glTF (.glb)"),
        (json!({ "name": "g.glb" }), "an import is a file\u{2019}s name and its data"),
        // What hung the TypeScript: answered as for {}.
        (Value::Null, "an import is a file\u{2019}s name and its data"),
    ] {
        let refused = import(&root, body.clone(), &a).await;
        assert_eq!((refused.status, refused.json()["reason"].clone()), (StatusCode::UNPROCESSABLE_ENTITY, json!(reason)), "{body}");
    }
    let _ = std::fs::remove_dir_all(&root);
}
