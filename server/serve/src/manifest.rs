//! The engine's own models: `tools/model-manifest.ts`'s routes, answered by the Rust server.
//!
//! Every `.glb` in `public/models` is a model every project has; **+ Model to the engine** (`/__models/add`)
//! writes one there from the editor, and the Models page gives a model an **ancestry** for every project
//! (`/__models/ancestry`), kept in the tracked `projects/model-ancestries.json` - which New Game reads to
//! offer an ancestry its models. Both are the page's own POSTs, guarded as the project save is, and both
//! answer a refusal as plain text, as the page reads it.
//!
//! The list of models itself still reaches the page from the dev server (`virtual:shipped-models`),
//! which watches the folder and the ancestries file for what this writes. Held to
//! `server/fixtures/model-manifest.json` by `tests/golden_manifest.rs`, the ancestries file to the byte.

use crate::files::read_json;
use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode, Uri};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const ANCESTRY_FILE: &str = "projects/model-ancestries.json";
pub const ANCESTRY_URL: &str = "/__models/ancestry";
pub const MODEL_ADD_URL: &str = "/__models/add";
pub const MODELS_FOLDER: &str = "public/models";
/// The largest change the ancestry route reads: a model id and an ancestry id are a few dozen bytes.
const ANCESTRY_LIMIT: usize = 4096;
/// The most a model added to the engine may weigh.
pub const MODEL_ADD_LIMIT: usize = 64 * 1024 * 1024;
/// How much a shipped model is scaled on the way in: not at all (`SHIPPED_SCALE`).
pub const SHIPPED_SCALE: u32 = 1;

/// What an id is: lower case, digits and hyphens, a hyphen only between the others.
pub fn is_id(text: &str) -> bool {
    !text.is_empty() && text.split('-').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// A file name as the manifest makes a model id of it (`modelIdOf`): `Stone Golem.glb` is `stone-golem`,
/// and a name with nothing to keep is no id at all.
pub fn model_id_of(name: &str) -> String {
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
    out
}

/// One model the folder holds: its id, where it is served, how big it is drawn, and whose it is.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ShippedModel {
    pub id: String,
    pub url: String,
    pub scale: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ancestry: Option<String>,
}

/// JavaScript's default sort: by UTF-16 code units.
fn js_order(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// The `.glb` and `.gltf` files in `public/models`, as models, sorted as the TypeScript sorts them.
pub fn shipped_models(folder: &Path, ancestries: &Map<String, Value>) -> Vec<ShippedModel> {
    let Ok(entries) = fs::read_dir(folder) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            let lower = name.to_lowercase();
            lower.ends_with(".glb") || lower.ends_with(".gltf")
        })
        .collect();
    names.sort_by(|a, b| js_order(a, b));
    names
        .into_iter()
        .map(|name| {
            let id = model_id_of(&name);
            let ancestry = ancestries.get(&id).and_then(Value::as_str).map(str::to_string);
            ShippedModel { url: format!("/models/{name}"), id, scale: SHIPPED_SCALE, ancestry }
        })
        .collect()
}

/// The ancestries file: model id to ancestry id, anything else in it left out; nothing when there is none.
pub fn read_model_ancestries(root: &Path) -> Map<String, Value> {
    let parsed: Value = read_json(&root.join(ANCESTRY_FILE), Value::Null);
    let Value::Object(map) = parsed else { return Map::new() };
    map.into_iter().filter(|(model, ancestry)| is_id(model) && ancestry.as_str().is_some_and(is_id)).collect()
}

/// The map with one model given an ancestry, or none, its keys in order so the file diffs cleanly.
pub fn assign_ancestry(map: &Map<String, Value>, model: &str, ancestry: Option<&str>) -> Map<String, Value> {
    let mut next = map.clone();
    match ancestry {
        None => {
            next.shift_remove(model);
        }
        Some(ancestry) => {
            next.insert(model.to_string(), Value::String(ancestry.to_string()));
        }
    }
    // `localeCompare`: for ids - lower case, digits, hyphens - the hyphen, then digits, then letters.
    next.sort_keys();
    next
}

pub fn write_model_ancestries(root: &Path, map: &Map<String, Value>) -> std::io::Result<()> {
    crate::files::write_json(&root.join(ANCESTRY_FILE), map)
}

/// A refusal: a status and the words the page shows.
pub type Refusal = (u16, String);

fn guard(method: &str, header: &dyn Fn(&str) -> Option<String>, not_post: &str) -> Result<(), Refusal> {
    if method != "POST" {
        return Err((405, not_post.into()));
    }
    // The project save's guard: the page's header, from the page's own origin.
    match crate::accounts::from_the_page(method, |name| header(name)) {
        Some(reason) => Err((403, reason.into())),
        None => Ok(()),
    }
}

/// Whether a model's ancestry may be set, and to what (`judgeAncestry`).
pub fn judge_ancestry(method: &str, header: &dyn Fn(&str) -> Option<String>, body: &str) -> Result<(String, Option<String>), Refusal> {
    guard(method, header, "a change is a POST")?;
    let parsed: Value = serde_json::from_str(body).map_err(|_| (400, "not JSON".to_string()))?;
    let field = |key: &str| parsed.as_object().and_then(|object| object.get(key));
    let model = field("model").and_then(Value::as_str).filter(|model| is_id(model)).ok_or((422, "no model id".to_string()))?;
    let ancestry = match field("ancestry") {
        Some(Value::Null) => None,
        Some(Value::String(ancestry)) if is_id(ancestry) => Some(ancestry.clone()),
        _ => return Err((422, "the ancestry is not an id, or nothing".into())),
    };
    Ok((model.to_string(), ancestry))
}

/// Whether a model may be added to the engine, and under what id (`judgeModelAdd`): the guard, a `.glb`
/// name that makes an id, a binary glTF's first four bytes, and no model of that id already.
pub fn judge_model_add(method: &str, header: &dyn Fn(&str) -> Option<String>, name: Option<&str>, body: &[u8], taken: &dyn Fn(&str) -> bool) -> Result<String, Refusal> {
    guard(method, header, "an upload is a POST")?;
    if body.len() > MODEL_ADD_LIMIT {
        return Err((413, "larger than a model should be - lighten it first".into()));
    }
    let id = match name {
        Some(name) if name.to_ascii_lowercase().ends_with(".glb") => model_id_of(name),
        _ => String::new(),
    };
    if id.is_empty() {
        return Err((422, "only a .glb can be added to the engine".into()));
    }
    if !body.starts_with(&[0x67, 0x6c, 0x54, 0x46]) {
        return Err((422, "not a binary glTF file".into()));
    }
    // By id, not by file name: `Quim.glb` and `quim.glb` are one model to the engine, whatever the disk thinks.
    if taken(&id) {
        return Err((409, format!("the engine already has a model called {id}")));
    }
    Ok(id)
}

#[derive(Clone)]
pub struct Workshop {
    pub root: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl Workshop {
    pub fn new(root: PathBuf) -> Self {
        Workshop { root, lock: Arc::new(Mutex::new(())) }
    }
}

fn header_of(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get(name).map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned())
}

fn respond(workshop: &Workshop, add: bool, method: &str, name: Option<String>, headers: &HeaderMap, body: Option<Vec<u8>>) -> Result<Value, Refusal> {
    let _held = workshop.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = workshop.root.as_path();
    let header = |key: &str| header_of(headers, key);
    if add {
        let body = body.ok_or((413, "larger than a model should be - lighten it first".to_string()))?;
        let folder = root.join(MODELS_FOLDER);
        let id = judge_model_add(method, &header, name.as_deref(), &body, &|id| shipped_models(&folder, &Map::new()).iter().any(|model| model.id == id))?;
        let file = format!("{id}.glb");
        let written = fs::create_dir_all(&folder)
            .and_then(|()| fs::write(folder.join(format!("{file}.part")), &body))
            .and_then(|()| fs::rename(folder.join(format!("{file}.part")), folder.join(&file)));
        return match written {
            Ok(()) => Ok(json!({ "id": id, "url": format!("/models/{file}") })),
            Err(error) => Err((500, error.to_string())),
        };
    }
    let body = body.ok_or((413, "too large to be one model and its ancestry".to_string()))?;
    let (model, ancestry) = judge_ancestry(method, &header, &String::from_utf8_lossy(&body))?;
    let map = assign_ancestry(&read_model_ancestries(root), &model, ancestry.as_deref());
    write_model_ancestries(root, &map).map_err(|error| (500, error.to_string()))?;
    Ok(Value::Object(map))
}

/// `/__models/add` and `/__models/ancestry`, as an axum handler.
pub async fn handle(State(workshop): State<Workshop>, method: Method, uri: Uri, headers: HeaderMap, body: Body) -> Response<Body> {
    let add = uri.path().starts_with(MODEL_ADD_URL);
    // `searchParams.get('name')`: the first, decoded as a form decodes it.
    let name = uri.query().and_then(|query| url::form_urlencoded::parse(query.as_bytes()).find(|(key, _)| key == "name").map(|(_, value)| value.into_owned()));
    let limit = if add { MODEL_ADD_LIMIT } else { ANCESTRY_LIMIT };
    let body = to_bytes(body, limit).await.ok().map(|bytes| bytes.to_vec());
    let method = method.as_str().to_string();
    let done = tokio::task::spawn_blocking(move || respond(&workshop, add, &method, name, &headers, body)).await.expect("the manifest task");
    match done {
        Ok(value) => {
            let mut response = Response::new(Body::from(value.to_string()));
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
            response
        }
        Err((status, reason)) => {
            let mut response = Response::new(Body::from(reason));
            *response.status_mut() = StatusCode::from_u16(status).expect("a status");
            response
        }
    }
}
