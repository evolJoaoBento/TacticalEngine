//! How the engine's art was made, and the default project: `tools/art-provenance.ts` and
//! `tools/default-project.ts`'s routes, answered by the Rust server.
//!
//! **The art marks** (`/__art/provenance`): the editor marks a piece of art AI generated, AI assisted or
//! human made where it differs from its kind's rule, kept in the tracked `projects/art-provenance.json`,
//! keys sorted as JavaScript's `localeCompare` sorts them (`locale_order`) so the file diffs as it did.
//!
//! **The default project** (`/projects/default.json`, `/__project/save`): the project the page opens,
//! read fresh on every request, and saved back whole - the text as the editor sent it, so the file
//! diffs the way the editor pretty-printed it.
//!
//! Both saves are the page's own POSTs, guarded as every save is, and refuse in plain text. The page
//! still gets the marks as the dev server's virtual module, which watches the file for what this
//! writes. Held to `server/fixtures/art-and-project.json` by `tests/golden_art_and_project.rs`.

use crate::files::read_json;
use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode, Uri};
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const PROVENANCE_FILE: &str = "projects/art-provenance.json";
pub const PROVENANCE_URL: &str = "/__art/provenance";
const PROVENANCE_LIMIT: usize = 4096;
pub const PROVENANCES: [&str; 3] = ["ai-generated", "ai-assisted", "human-made"];

pub const PROJECT_FILE: &str = "projects/default.json";
pub const PROJECT_URL: &str = "/projects/default.json";
pub const SAVE_URL: &str = "/__project/save";
/// The largest save accepted: the demo is half a megabyte; a room forty times its size is still a room.
pub const SAVE_LIMIT: usize = 32 * 1024 * 1024;

/// What a piece of art is called: `model:quim`, `card:bare-bones`, `equipment:broadsword.webp`.
pub fn is_art_key(key: &str) -> bool {
    let Some((kind, id)) = key.split_once(':') else { return false };
    let mut chars = id.chars();
    matches!(kind, "model" | "card" | "equipment")
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && id.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// `localeCompare` for the characters an art key has - letters, digits, `_ - : .` - as the root
/// collation orders them: punctuation `_ - : .`, then digits, then letters with case set aside; and only
/// when all that is equal, case, a lower-case letter before its capital.
pub fn locale_order(a: &str, b: &str) -> Ordering {
    fn primary(c: char) -> u32 {
        match c {
            '_' => 1,
            '-' => 2,
            ':' => 3,
            '.' => 4,
            '0'..='9' => 10 + (c as u32 - '0' as u32),
            'a'..='z' => 100 + (c as u32 - 'a' as u32),
            'A'..='Z' => 100 + (c as u32 - 'A' as u32),
            _ => 1000 + c as u32,
        }
    }
    let first = a.chars().map(primary).cmp(b.chars().map(primary));
    if first != Ordering::Equal {
        return first;
    }
    a.chars().map(|c| c.is_ascii_uppercase()).cmp(b.chars().map(|c| c.is_ascii_uppercase()))
}

/// The marks file: art key to how it was made, anything else in it left out; nothing when there is none.
pub fn read_provenance(root: &Path) -> Map<String, Value> {
    let parsed: Value = read_json(&root.join(PROVENANCE_FILE), Value::Null);
    let Value::Object(map) = parsed else { return Map::new() };
    map.into_iter().filter(|(key, mark)| is_art_key(key) && mark.as_str().is_some_and(|mark| PROVENANCES.contains(&mark))).collect()
}

/// The map with one piece of art marked, or put back to its rule, keys in `localeCompare`'s order.
pub fn mark_provenance(map: &Map<String, Value>, key: &str, provenance: Option<&str>) -> Map<String, Value> {
    let mut next = map.clone();
    match provenance {
        None => {
            next.shift_remove(key);
        }
        Some(mark) => {
            next.insert(key.to_string(), Value::String(mark.to_string()));
        }
    }
    let mut entries: Vec<(String, Value)> = next.into_iter().collect();
    entries.sort_by(|(a, _), (b, _)| locale_order(a, b));
    entries.into_iter().collect()
}

pub fn write_provenance(root: &Path, map: &Map<String, Value>) -> std::io::Result<()> {
    crate::files::write_json(&root.join(PROVENANCE_FILE), map)
}

pub type Refusal = (u16, String);

fn guard(method: &str, header: &dyn Fn(&str) -> Option<String>, not_post: &str) -> Result<(), Refusal> {
    if method != "POST" {
        return Err((405, not_post.into()));
    }
    match crate::accounts::from_the_page(method, |name| header(name)) {
        Some(reason) => Err((403, reason.into())),
        None => Ok(()),
    }
}

/// Whether a piece of art's mark may be changed, and to what (`judgeProvenance`).
pub fn judge_provenance(method: &str, header: &dyn Fn(&str) -> Option<String>, body: &str) -> Result<(String, Option<String>), Refusal> {
    guard(method, header, "a change is a POST")?;
    let parsed: Value = serde_json::from_str(body).map_err(|_| (400, "not JSON".to_string()))?;
    let field = |key: &str| parsed.as_object().and_then(|object| object.get(key));
    let key = field("key").and_then(Value::as_str).filter(|key| is_art_key(key)).ok_or((422, "not a piece of art the engine knows how to name".to_string()))?;
    let provenance = match field("provenance") {
        Some(Value::Null) => None,
        Some(Value::String(mark)) if PROVENANCES.contains(&mark.as_str()) => Some(mark.clone()),
        _ => return Err((422, "not AI generated, AI assisted, human made, or nothing".into())),
    };
    Ok((key.to_string(), provenance))
}

/// Whether a save may be written, and the text to write (`judgeSave`): the text as sent, ending in a newline.
pub fn judge_save(method: &str, header: &dyn Fn(&str) -> Option<String>, body: &str) -> Result<String, Refusal> {
    guard(method, header, "a save is a POST")?;
    let parsed: Value = serde_json::from_str(body).map_err(|_| (400, "not JSON".to_string()))?;
    let project = parsed.as_object();
    let id = project.and_then(|project| project.get("id")).is_some_and(Value::is_string);
    let scenes = project.and_then(|project| project.get("scenes")).and_then(Value::as_array).is_some_and(|scenes| !scenes.is_empty());
    if !id || !scenes {
        return Err((422, "not a project: no id, or no scenes".into()));
    }
    Ok(if body.ends_with('\n') { body.to_string() } else { format!("{body}\n") })
}

#[derive(Clone)]
pub struct Archive {
    pub root: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl Archive {
    pub fn new(root: PathBuf) -> Self {
        Archive { root, lock: Arc::new(Mutex::new(())) }
    }
}

enum Answer {
    Json(Vec<u8>),
    Saved,
    Missing,
    Refused(Refusal),
}

fn respond(archive: &Archive, path: &str, method: &str, headers: &HeaderMap, body: Option<Vec<u8>>) -> Answer {
    let _held = archive.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = archive.root.as_path();
    let header = |key: &str| headers.get(key).map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned());
    if path == PROJECT_URL {
        // Read fresh on every request: the point is that a reload shows the last save.
        return match fs::read(root.join(PROJECT_FILE)) {
            Ok(bytes) => Answer::Json(bytes),
            Err(_) => Answer::Missing,
        };
    }
    if path.starts_with(SAVE_URL) {
        let Some(body) = body else { return Answer::Refused((413, "too large to be a project".into())) };
        return match judge_save(method, &header, &String::from_utf8_lossy(&body)) {
            Ok(text) => {
                let target = root.join(PROJECT_FILE);
                let partial = root.join(format!("{PROJECT_FILE}.partial"));
                let written = target.parent().map_or(Ok(()), fs::create_dir_all).and_then(|()| fs::write(&partial, text)).and_then(|()| fs::rename(&partial, &target));
                match written {
                    Ok(()) => Answer::Saved,
                    Err(error) => Answer::Refused((500, error.to_string())),
                }
            }
            Err(refusal) => Answer::Refused(refusal),
        };
    }
    let Some(body) = body else { return Answer::Refused((413, "too large to be one mark".into())) };
    match judge_provenance(method, &header, &String::from_utf8_lossy(&body)) {
        Ok((key, provenance)) => {
            let map = mark_provenance(&read_provenance(root), &key, provenance.as_deref());
            match write_provenance(root, &map) {
                Ok(()) => Answer::Json(Value::Object(map).to_string().into_bytes()),
                Err(error) => Answer::Refused((500, error.to_string())),
            }
        }
        Err(refusal) => Answer::Refused(refusal),
    }
}

/// Where the page asks for the art marks when it opens.
pub const MARKS_URL: &str = "/__art/marks";

/// The art marks as the page loads them (`GET /__art/marks`): read on every request, so a change is in
/// the next page's marks without building the client again.
pub async fn marks(State(archive): State<Archive>) -> Response<Body> {
    let root = archive.root.clone();
    let map = tokio::task::spawn_blocking(move || read_provenance(&root)).await.expect("the marks");
    let mut response = Response::new(Body::from(Value::Object(map).to_string()));
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// `/__art/provenance`, `/projects/default.json` and `/__project/save`, as an axum handler.
pub async fn handle(State(archive): State<Archive>, method: Method, uri: Uri, headers: HeaderMap, body: Body) -> Response<Body> {
    let path = uri.path().to_string();
    let project = path == PROJECT_URL;
    if project && method != Method::GET && method != Method::HEAD {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::NOT_FOUND;
        return response;
    }
    let limit = if path.starts_with(SAVE_URL) { SAVE_LIMIT } else { PROVENANCE_LIMIT };
    let body = to_bytes(body, limit).await.ok().map(|bytes| bytes.to_vec());
    let method_text = method.as_str().to_string();
    let done = tokio::task::spawn_blocking(move || respond(&archive, &path, &method_text, &headers, body)).await.expect("the archive task");
    match done {
        Answer::Json(bytes) => {
            let mut response = Response::new(Body::from(if method == Method::HEAD { Vec::new() } else { bytes }));
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
            if project {
                response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            }
            response
        }
        Answer::Saved => {
            let mut response = Response::new(Body::empty());
            *response.status_mut() = StatusCode::NO_CONTENT;
            response
        }
        Answer::Missing => {
            let mut response = Response::new(Body::empty());
            *response.status_mut() = StatusCode::NOT_FOUND;
            response
        }
        Answer::Refused((status, reason)) => {
            let mut response = Response::new(Body::from(reason));
            *response.status_mut() = StatusCode::from_u16(status).expect("a status");
            response
        }
    }
}
