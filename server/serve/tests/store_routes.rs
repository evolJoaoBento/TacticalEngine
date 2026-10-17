//! The `/__store` routes end to end, over a folder of their own: a listing published with nothing shown
//! and marked AI, its work shown later, sold only when shown and got only by its creator, voted on, its
//! pictures served; an engine model listed, got into a player's own models, never taken down; and every
//! refusal in the order the TypeScript gives it.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64_like::encode;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tower::ServiceExt;

/// Base64 for the tests' own uploads (standard alphabet, padded).
mod base64_like {
    pub fn encode(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
            for i in 0..4 {
                out.push(if i <= chunk.len() { ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
            }
        }
        out
    }
}

const GLB: &[u8] = &[0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0, 42];
const PNG: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1];
const PAGE: [(&str, &str); 3] = [("x-tactical-save", "1"), ("origin", "http://127.0.0.1:8420"), ("host", "127.0.0.1:8420")];

fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-store-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("public/models")).unwrap();
    std::fs::create_dir_all(root.join("projects")).unwrap();
    root
}

struct Reply {
    status: StatusCode,
    body: Vec<u8>,
    kind: String,
    disposition: Option<String>,
    cookie: Option<String>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

async fn send(root: &Path, method: &str, path: &str, body: &str, cookie: Option<&str>) -> Reply {
    let mut request = Request::builder().method(method).uri(path);
    for (name, value) in PAGE {
        request = request.header(name, value);
    }
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    let response = serve::app(root.to_path_buf()).oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let header = |name: &str| response.headers().get(name).map(|v| v.to_str().unwrap().to_string());
    let (status, kind, disposition, cookie) = (response.status(), header("content-type").unwrap_or_default(), header("content-disposition"), header("set-cookie"));
    assert_eq!(header("cache-control").as_deref(), Some("no-store"), "{method} {path}");
    let body = response.into_body().collect().await.unwrap().to_bytes().to_vec();
    Reply { status, body, kind, disposition, cookie }
}

async fn player(root: &Path, name: &str) -> String {
    let made = send(root, "POST", "/__accounts/register", &json!({ "name": name, "password": "hunter22" }).to_string(), None).await;
    assert_eq!(made.status, StatusCode::OK);
    made.cookie.unwrap().split(';').next().unwrap().to_string()
}

async fn post(root: &Path, route: &str, body: Value, cookie: &str) -> Reply {
    send(root, "POST", &format!("/__store/{route}"), &body.to_string(), Some(cookie)).await
}

#[tokio::test]
async fn a_listing_shows_its_work_later_and_is_sold_only_then() {
    let root = folder("work");
    let ash = player(&root, "Ash").await;
    let bramble = player(&root, "Bramble").await;

    // Published free with nothing shown: marked AI, whatever it says.
    let bare = post(&root, "publish", json!({ "title": "Stone Golem", "claim": "human-made", "asset": { "name": "golem.glb", "data": encode(GLB) } }), &ash).await;
    assert_eq!(bare.status, StatusCode::OK);
    let bare = bare.json();
    assert_eq!((bare["mark"].clone(), bare["supported"].clone(), bare["claim"].clone(), bare["own"].clone()), (json!("ai-generated"), json!(false), json!("human-made"), json!(true)));
    assert!(bare.get("file").is_none() && bare.get("votes").is_none() && bare.get("proofs").is_none());
    let id = bare["id"].as_str().unwrap().to_string();

    // For sale with nothing shown, or AI generated: refused.
    let unshown = post(&root, "publish", json!({ "title": "T", "claim": "ai-assisted", "forSale": true, "asset": { "data": encode(PNG) } }), &ash).await;
    assert_eq!((unshown.status, unshown.json()["reason"].clone()), (StatusCode::UNPROCESSABLE_ENTITY, json!("to be for sale, show your work: How I Made It and at least one Process Proof")));

    // Nothing to judge yet; nobody else shows its work.
    let early = post(&root, "vote", json!({ "id": id, "vote": "like" }), &bramble).await;
    assert_eq!((early.status, early.json()["reason"].clone()), (StatusCode::FORBIDDEN, json!("there is nothing to judge until its creator shows their work")));
    let theirs = post(&root, "update", json!({ "id": id, "how": "mine now" }), &bramble).await;
    assert_eq!((theirs.status, theirs.json()["reason"].clone()), (StatusCode::FORBIDDEN, json!("only its creator shows its work")));

    // Shown later, for sale.
    let shown = post(&root, "update", json!({ "id": id, "how": "Blender; the AI drafted the texture.", "claim": "ai-assisted", "forSale": true, "addProofs": [{ "data": encode(PNG) }, { "data": encode(PNG) }] }), &ash).await;
    assert_eq!(shown.status, StatusCode::OK);
    let shown = shown.json();
    assert_eq!((shown["mark"].clone(), shown["supported"].clone(), shown["forSale"].clone(), shown["proofCount"].clone()), (json!("ai-assisted"), json!(true), json!(true), json!(2)));

    // Its pictures, by Number(n): "01" is 1, "5" is nothing.
    let proof = send(&root, "GET", &format!("/__store/file/{id}/proof/01"), "", Some(&bramble)).await;
    assert_eq!((proof.status, proof.kind.as_str(), proof.body.as_slice()), (StatusCode::OK, "image/png", PNG));
    assert_eq!(send(&root, "GET", &format!("/__store/file/{id}/proof/5"), "", Some(&bramble)).await.status, StatusCode::NOT_FOUND);

    // For sale: its creator gets it, nobody else yet.
    assert_eq!(send(&root, "GET", &format!("/__store/file/{id}/asset?download"), "", Some(&bramble)).await.status, StatusCode::PAYMENT_REQUIRED);
    let got = send(&root, "GET", &format!("/__store/file/{id}/asset?download"), "", Some(&ash)).await;
    assert_eq!((got.status, got.kind.as_str(), got.disposition.as_deref()), (StatusCode::OK, "model/gltf-binary", Some("attachment; filename=\"golem.glb\"")));
    // Seen - not downloaded - by anybody.
    assert_eq!(send(&root, "GET", &format!("/__store/file/{id}/asset"), "", None).await.status, StatusCode::OK);

    // Emptying How I Made It while for sale: refused.
    let unshow = post(&root, "update", json!({ "id": id, "how": "" }), &ash).await;
    assert_eq!(unshow.status, StatusCode::UNPROCESSABLE_ENTITY);

    // Believed, then taken back; never by its creator.
    let liked = post(&root, "vote", json!({ "id": id, "vote": "like" }), &bramble).await.json();
    assert_eq!((liked["likes"].clone(), liked["authenticity"].clone(), liked["mine"].clone()), (json!(1), json!(100), json!("like")));
    assert_eq!(post(&root, "vote", json!({ "id": id, "vote": "like" }), &ash).await.status, StatusCode::FORBIDDEN);
    let back = post(&root, "vote", json!({ "id": id, "vote": null }), &bramble).await.json();
    assert_eq!((back["likes"].clone(), back["authenticity"].clone()), (json!(0), Value::Null));

    // Too many pictures.
    let crowd: Vec<Value> = (0..5).map(|_| json!({ "data": encode(PNG) })).collect();
    let crowded = post(&root, "update", json!({ "id": id, "addProofs": crowd }), &ash).await;
    assert_eq!(crowded.json()["reason"], "a listing shows 6 pictures of the work at most");

    // Taken down by its creator: the listing and its files go.
    let files = std::fs::read_dir(root.join("data/store/files")).unwrap().count();
    assert_eq!(files, 3);
    assert_eq!(post(&root, "remove", json!({ "id": id }), &bramble).await.status, StatusCode::FORBIDDEN);
    assert_eq!(post(&root, "remove", json!({ "id": id }), &ash).await.json(), json!({}));
    assert_eq!(std::fs::read_dir(root.join("data/store/files")).unwrap().count(), 0);
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn the_engines_models_are_listed_got_and_never_taken_down() {
    let root = folder("engine");
    std::fs::write(root.join("public/models/bandit-cutter.glb"), GLB).unwrap();
    std::fs::write(root.join("public/models/Arty.glb"), [GLB, &[7]].concat()).unwrap();
    std::fs::write(root.join("public/models/notes.txt"), b"not a model").unwrap();
    std::fs::write(root.join("projects/art-provenance.json"), r#"{ "model:arty": "ai-assisted" }"#).unwrap();
    let bramble = player(&root, "Bramble").await;

    let listings = send(&root, "GET", "/__store/list", "", Some(&bramble)).await.json();
    let listings = listings.as_array().unwrap();
    assert_eq!(listings.len(), 2);
    let arty = listings.iter().find(|l| l["title"] == "Arty").unwrap();
    assert_eq!((arty["claim"].clone(), arty["mark"].clone(), arty["creatorName"].clone(), arty["engine"].clone()), (json!("ai-assisted"), json!("ai-generated"), json!("The engine"), json!(true)));
    let cutter = listings.iter().find(|l| l["title"] == "Bandit Cutter").unwrap();
    let id = cutter["id"].as_str().unwrap();
    assert_eq!(cutter["inYours"], false);

    // Get: into the player's own models, once however often.
    let got = post(&root, "get", json!({ "id": id }), &bramble).await.json();
    assert_eq!((got["listing"]["inYours"].clone(), got["model"]["id"].clone(), got["model"]["url"].clone()), (json!(true), json!("bandit-cutter"), json!("/__models/u/bramble/imported/bandit-cutter.glb")));
    post(&root, "get", json!({ "id": id }), &bramble).await;
    let index: Value = serde_json::from_str(&std::fs::read_to_string(root.join("data/users/bramble/models/imported.json")).unwrap()).unwrap();
    assert_eq!(index.as_array().unwrap().len(), 1);
    assert_eq!(index[0]["listing"], id);
    assert_eq!(std::fs::read(root.join("data/users/bramble/models/imported/bandit-cutter.glb")).unwrap(), GLB);
    let again = send(&root, "GET", "/__store/list", "", Some(&bramble)).await.json();
    assert!(again.as_array().unwrap().iter().any(|l| l["id"] == id && l["inYours"] == true));

    // Its file, served from public/models.
    let file = send(&root, "GET", &format!("/__store/file/{id}/asset"), "", None).await;
    assert_eq!((file.status, file.body.as_slice()), (StatusCode::OK, GLB));

    // Never taken down, not by admin: it goes with its file.
    let admin = send(&root, "POST", "/__accounts/login", r#"{"name":"admin","password":"admin"}"#, None).await.cookie.unwrap();
    let admin = admin.split(';').next().unwrap();
    let kept = post(&root, "remove", json!({ "id": id }), admin).await;
    assert_eq!((kept.status, kept.json()["reason"].clone()), (StatusCode::FORBIDDEN, json!("it is the engine\u{2019}s own: it goes when its file leaves public/models")));
    std::fs::remove_file(root.join("public/models/bandit-cutter.glb")).unwrap();
    let after = send(&root, "GET", "/__store/list", "", None).await.json();
    assert_eq!(after.as_array().unwrap().len(), 1);

    // A picture is downloaded, not got.
    let picture = post(&root, "publish", json!({ "title": "Shrine", "asset": { "name": "s.png", "data": encode(PNG) } }), &bramble).await.json();
    let refused = post(&root, "get", json!({ "id": picture["id"] }), &bramble).await;
    assert_eq!(refused.json()["reason"], "a picture is downloaded, not put into your models");
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn refusals_come_in_the_order_they_come_in_typescript() {
    let root = folder("refusals");
    let bramble = player(&root, "Bramble").await;
    // Not a GET the store answers: not a POST.
    let other = send(&root, "GET", "/__store/elsewhere", "", Some(&bramble)).await;
    assert_eq!((other.status, other.json()["reason"].clone()), (StatusCode::FORBIDDEN, json!("not a POST")));
    // Nobody signed in, before the body is read.
    let nobody = send(&root, "POST", "/__store/vote", &"x".repeat(9000), None).await;
    assert_eq!((nobody.status, nobody.json()["reason"].clone()), (StatusCode::UNAUTHORIZED, json!("sign in first")));
    // Too large, before the route is known.
    let big = send(&root, "POST", "/__store/elsewhere", &"x".repeat(9000), Some(&bramble)).await;
    assert_eq!((big.status, big.json()["reason"].clone()), (StatusCode::PAYLOAD_TOO_LARGE, json!("too large")));
    let unknown = send(&root, "POST", "/__store/elsewhere", "{}", Some(&bramble)).await;
    assert_eq!((unknown.status, unknown.json()["reason"].clone()), (StatusCode::NOT_FOUND, json!("no such route")));
    // A publish of `null` - which hung the TypeScript - is answered.
    let null = send(&root, "POST", "/__store/publish", "null", Some(&bramble)).await;
    assert_eq!(null.json()["reason"], "a listing needs a title, of 80 characters at most");
    assert_eq!(send(&root, "GET", "/__store/file/0123456789abcdef/asset", "", None).await.status, StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(&root);
}
