//! **Your models**: each player's own `.glb` files - `tools/your-models.ts`, answered by the Rust server.
//!
//! Kept in `data/users/<account>/models/imported/`, with `imported.json` beside it, and offered in the
//! editor under every project the player opens. A model comes in by Get in the Store (`store.rs`), or by
//! a project opened with models it carries - an embedded file, or one in another player's folder -
//! which the page imports on the fly. The same file is kept once, known by its SHA-256, under an id
//! tidied from its name and never one the folder gave a different file. Entries are written as the
//! TypeScript wrote them, in its order, so a folder it filled is this folder; held to
//! `server/fixtures/your-models.json` by `tests/golden_your_models.rs`, the index to the byte.
//!
//! Routes: `/__models/mine` (your models, signed in), `/__models/u/<account>/imported/<file>` (the file,
//! for anybody signed in: a project that uses it draws it for whoever opens it), and `/__models/import`
//! (the page's own POST, signed in: a file, or a model in another player's folder). Where the
//! TypeScript would have hung - an import body of JSON `null` threw outside its try - this answers as
//! for `{}`.

use crate::accounts::{account_of, from_the_page, now_ms, read_accounts, read_sessions};
use crate::files::{read_json, write_json};
use crate::js::node_base64;
use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode, Uri};
use serde_json::json;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// One of a player's models: `id`, `file`, `url`, `hash` (its SHA-256, hex), `listing` when it was got
/// from the Store, `added`. Kept as the object it is, keys in the order they came - as JavaScript keeps
/// them - since that order is its history: a model got from the Store after it was imported has
/// `listing` after `added`, one got from the Store first has it before.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(transparent)]
pub struct YourModel(pub Map<String, Value>);

impl YourModel {
    fn text(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(Value::as_str)
    }
    pub fn id(&self) -> &str {
        self.text("id").unwrap_or("")
    }
    pub fn hash(&self) -> &str {
        self.text("hash").unwrap_or("")
    }
    /// The Store listing it was got from, if it was.
    pub fn listing(&self) -> Option<&str> {
        self.text("listing")
    }
    /// A model by its id alone, as a test names what a folder has taken.
    pub fn named(id: &str) -> YourModel {
        let mut fields = Map::new();
        fields.insert("id".into(), Value::String(id.into()));
        YourModel(fields)
    }
}

pub fn is_account(account: &str) -> bool {
    (3..=24).contains(&account.len()) && account.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

pub fn models_folder(root: &Path, account: &str) -> PathBuf {
    root.join(format!("data/users/{account}/models/imported"))
}

fn index_file(root: &Path, account: &str) -> PathBuf {
    root.join(format!("data/users/{account}/models/imported.json"))
}

pub fn model_url(account: &str, file: &str) -> String {
    format!("/__models/u/{account}/imported/{file}")
}

/// A file's name as a model id, as the engine tidies the names in `public/models` (`tidyId`).
pub fn tidy_id(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    let base = [".glb", ".gltf"].iter().find(|ext| lower.ends_with(*ext)).map_or(name, |ext| &name[..name.len() - ext.len()]);
    let mut out = String::new();
    let mut gap = false;
    for c in base.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if gap && !out.is_empty() {
                out.push('-');
            }
            gap = false;
            out.push(c);
        } else {
            gap = true;
        }
    }
    if out.is_empty() {
        "model".into()
    } else {
        out
    }
}

/// The wanted id, or the first `-2`, `-3`... the folder has not given out.
pub fn free_model_id(wanted: &str, taken: &[YourModel]) -> String {
    let has = |id: &str| taken.iter().any(|model| model.id() == id);
    if !has(wanted) {
        return wanted.to_string();
    }
    (2..).map(|n| format!("{wanted}-{n}")).find(|id| !has(id)).expect("an id is free")
}

pub fn is_glb(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x67, 0x6c, 0x54, 0x46])
}

pub fn read_your_models(root: &Path, account: &str) -> Vec<YourModel> {
    read_json(&index_file(root, account), Vec::new())
}

/// Put a `.glb` into a player's folder, or find it already there: the model, and whether it is new.
pub fn import_model(root: &Path, account: &str, name: &str, bytes: &[u8], listing: Option<&str>) -> Result<(YourModel, bool), String> {
    if !is_account(account) {
        return Err("no such account".into());
    }
    if !is_glb(bytes) {
        return Err("a model is a binary glTF (.glb)".into());
    }
    let mut models = read_your_models(root, account);
    let hash = hex::encode(Sha256::digest(bytes));
    if let Some(known) = models.iter_mut().find(|model| model.hash() == hash) {
        // Got from the Store after it was imported some other way: it is that listing's too - at the end,
        // where JavaScript puts a key an object did not have.
        if let (Some(listing), None) = (listing, known.listing()) {
            known.0.insert("listing".into(), Value::String(listing.to_string()));
            let known = known.clone();
            write_json(&index_file(root, account), &models).map_err(|error| error.to_string())?;
            return Ok((known, false));
        }
        return Ok((known.clone(), false));
    }
    let id = free_model_id(&tidy_id(name), &models);
    let file = format!("{id}.glb");
    let folder = models_folder(root, account);
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    fs::write(folder.join(&file), bytes).map_err(|error| error.to_string())?;
    // id, file, url, hash, listing, added: the order the TypeScript writes a new one in.
    let url = model_url(account, &file);
    let mut fields = Map::new();
    fields.insert("id".into(), Value::String(id));
    fields.insert("file".into(), Value::String(file));
    fields.insert("url".into(), Value::String(url));
    fields.insert("hash".into(), Value::String(hash));
    if let Some(listing) = listing {
        fields.insert("listing".into(), Value::String(listing.to_string()));
    }
    fields.insert("added".into(), Value::from(now_ms()));
    let model = YourModel(fields);
    models.push(model.clone());
    write_json(&index_file(root, account), &models).map_err(|error| error.to_string())?;
    Ok((model, true))
}

/// Copy a file on disk into a player's folder - a Store listing's, or the engine's own.
pub fn import_file(root: &Path, account: &str, name: &str, path: &Path, listing: Option<&str>) -> Result<(YourModel, bool), String> {
    let bytes = fs::read(path).map_err(|_| "no such file".to_string())?;
    import_model(root, account, name, &bytes, listing)
}

pub const YOUR_MODELS_URL: &str = "/__models/mine";
pub const USER_MODELS_URL: &str = "/__models/u";
pub const IMPORT_MODEL_URL: &str = "/__models/import";
/// The most an import may weigh, sent as base64.
pub const IMPORT_LIMIT: usize = 128 * 1024 * 1024;

fn is_model_file(file: &str) -> bool {
    let Some(stem) = file.strip_suffix(".glb") else { return false };
    !stem.is_empty() && stem.split('-').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// Which account and file a served url names, or nothing: `/__models/u/<account>/imported/<file>`.
pub fn file_of_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("/__models/u/")?;
    let (account, rest) = rest.split_once('/')?;
    let file = rest.strip_prefix("imported/")?;
    if file.contains(['/', '?', '#']) || !is_account(account) || !is_model_file(file) {
        return None;
    }
    Some((account.to_string(), file.to_string()))
}

/// What an import body asks for: a file (its name and bytes), or a model in a player's folder.
#[derive(Clone, Debug, PartialEq)]
pub enum Import {
    File { name: String, bytes: Vec<u8> },
    Url { account: String, file: String },
}

/// An import, from its body (`judgeImport`): a url wins when it is a string; else a name and data.
pub fn judge_import(body: &str) -> Result<Import, &'static str> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| "not JSON")?;
    let field = |key: &str| parsed.as_object().and_then(|object| object.get(key));
    if let Some(url) = field("url").and_then(Value::as_str) {
        return file_of_url(url).map(|(account, file)| Import::Url { account, file }).ok_or("that is not a model in a player\u{2019}s folder");
    }
    match (field("name").and_then(Value::as_str), field("data").and_then(Value::as_str)) {
        (Some(name), Some(data)) => Ok(Import::File { name: name.to_string(), bytes: node_base64(data.find(',').map_or(data, |at| &data[at + 1..])) }),
        _ => Err("an import is a file\u{2019}s name and its data"),
    }
}

#[derive(Clone)]
pub struct Shelf {
    pub root: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl Shelf {
    pub fn new(root: PathBuf) -> Self {
        Shelf { root, lock: Arc::new(Mutex::new(())) }
    }
}

enum Answer {
    Json(u16, Value),
    Model(Vec<u8>),
}

fn refuse(status: u16, reason: &str) -> Answer {
    Answer::Json(status, json!({ "reason": reason }))
}

fn header_of(headers: &HeaderMap, name: &str) -> Option<String> {
    let values: Vec<String> = headers.get_all(name).iter().map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned()).collect();
    match (name, values.len()) {
        (_, 0) => None,
        ("cookie", _) => Some(values.join("; ")),
        _ => values.into_iter().next(),
    }
}

/// Whether a path is a route, or under it - as a dev plugin mounted at the route answered both.
fn under(path: &str, route: &str) -> bool {
    path == route || path.strip_prefix(route).is_some_and(|rest| rest.starts_with('/'))
}

fn respond(shelf: &Shelf, method: &str, path: &str, headers: &HeaderMap, body: Result<String, ()>) -> Answer {
    let _held = shelf.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = shelf.root.as_path();
    let now = now_ms();
    let signed_in = || account_of(header_of(headers, "cookie").as_deref(), &read_sessions(root, now), &read_accounts(root), now).cloned();
    if under(path, YOUR_MODELS_URL) {
        return match signed_in() {
            Some(account) => Answer::Json(200, json!(read_your_models(root, &account.id))),
            None => refuse(401, "sign in first"),
        };
    }
    if under(path, USER_MODELS_URL) {
        if signed_in().is_none() {
            return refuse(401, "sign in first");
        }
        return match file_of_url(path).and_then(|(account, file)| fs::read(models_folder(root, &account).join(file)).ok()) {
            Some(bytes) => Answer::Model(bytes),
            None => refuse(404, "no such model"),
        };
    }
    // The import.
    if let Some(refused) = from_the_page(method, |name| header_of(headers, name)) {
        return refuse(403, refused);
    }
    let Some(account) = signed_in() else { return refuse(401, "sign in first") };
    let Ok(body) = body else { return refuse(413, "too large") };
    let (name, bytes) = match judge_import(&body) {
        Err(reason) => return refuse(422, reason),
        Ok(Import::File { name, bytes }) => (name, bytes),
        Ok(Import::Url { account: owner, file }) => match fs::read(models_folder(root, &owner).join(&file)) {
            Ok(bytes) => (file, bytes),
            Err(_) => return refuse(404, "no such model"),
        },
    };
    match import_model(root, &account.id, &name, &bytes, None) {
        Ok((model, fresh)) => Answer::Json(200, json!({ "model": model, "fresh": fresh })),
        Err(reason) => refuse(422, &reason),
    }
}

/// The your-models routes - `/__models/mine`, `/__models/u/...`, `/__models/import` - as an axum handler.
pub async fn handle(State(shelf): State<Shelf>, method: Method, uri: Uri, headers: HeaderMap, body: Body) -> Response<Body> {
    let path = uri.path().to_string();
    let limit = if under(&path, IMPORT_MODEL_URL) { IMPORT_LIMIT } else { 8192 };
    let body = to_bytes(body, limit).await.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).map_err(|_| ());
    let method = method.as_str().to_string();
    let done = tokio::task::spawn_blocking(move || respond(&shelf, &method, &path, &headers, body)).await.expect("the your-models task");
    let (mut response, cache) = match done {
        Answer::Json(status, value) => {
            let mut response = Response::new(Body::from(value.to_string()));
            *response.status_mut() = StatusCode::from_u16(status).expect("a status");
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
            (response, "no-store")
        }
        Answer::Model(bytes) => {
            let mut response = Response::new(Body::from(bytes));
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("model/gltf-binary"));
            (response, "no-cache")
        }
    };
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    response
}
