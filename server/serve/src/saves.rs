//! Each player's saved games (`docs/SERVER.md`, phase 3: saves move to the server). In
//! `data/users/<account>/saves/`: `index.json`, the slots as the page lists them (`{ id, name, savedAt, where,
//! project? }`), and each save's text beside it as `<id>.json`, written as the game wrote it.
//!
//! A save is written by the player's game on the server (`play.rs`, the socket's `save`): the game's own text,
//! never one the page sends. What the page asks here, signed in:
//!
//! - `GET /__saves` - the slots;
//! - `GET /__saves/<id>` - one save's text;
//! - `POST /__saves/remove` `{ id }` - a slot gone;
//! - `POST /__saves/import` `{ saves: [{ slot, text }] }` - the slots a browser kept before its player's saves
//!   moved here, taken the first time it signs in: any slot already here is kept as it is.
//!
//! The two POSTs come only from the page (its header, its own origin), as every write the server takes does.

use crate::accounts::{account_of, from_the_page, now_ms, read_accounts, read_sessions};
use crate::files::{read_json, write_json};
use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode, Uri};
use axum::extract::State;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const SAVES_URL: &str = "/__saves";

/// How large a body the routes take: an import carries whole saves.
const LIMIT: usize = 32 * 1024 * 1024;

/// One lock for every account's saves, the routes' and the games' writes alike.
static LOCK: Mutex<()> = Mutex::new(());

/// A slot as the page lists it (`SaveSlot`, `src/game/save-slots.ts`), its keys in the page's order.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Slot {
    pub id: String,
    pub name: String,
    /// Milliseconds since the epoch, a whole number as `Date.now()` gives it.
    #[serde(rename = "savedAt")]
    pub saved_at: i64,
    #[serde(rename = "where")]
    pub place: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub project: Option<String>,
}

/// An id a slot may have: a file's name, nothing that climbs out of the folder, and not the index's.
pub fn is_slot_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id != "index" && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A fresh slot's id, as the page mints one: `s`, the time in base 36, a little at random.
pub fn mint_id(now: i64) -> String {
    let mut bytes = [0u8; 2];
    getrandom::fill(&mut bytes).expect("the system's randomness");
    let random = u16::from_le_bytes(bytes) % 1296;
    format!("s{}{}", base36(now.max(0) as u64), base36(u64::from(random)))
}

fn base36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).expect("ascii")
}

pub fn saves_folder(root: &Path, account: &str) -> PathBuf {
    root.join(format!("data/users/{account}/saves"))
}

fn index_file(root: &Path, account: &str) -> PathBuf {
    saves_folder(root, account).join("index.json")
}

/// The account's slots, as written; none when there is no index or it is not one.
pub fn read_slots(root: &Path, account: &str) -> Vec<Slot> {
    read_json(&index_file(root, account), Vec::new())
}

/// A save's text, if the account has that slot.
pub fn read_save(root: &Path, account: &str, id: &str) -> Option<String> {
    if !is_slot_id(id) || !read_slots(root, account).iter().any(|slot| slot.id == id) {
        return None;
    }
    fs::read_to_string(saves_folder(root, account).join(format!("{id}.json"))).ok()
}

fn write_text(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut partial = path.as_os_str().to_owned();
    partial.push(".partial");
    fs::write(&partial, text)?;
    fs::rename(&partial, path)
}

/// A save written into its slot - a slot with that id overwritten - and the index after.
pub fn write_save(root: &Path, account: &str, slot: Slot, text: &str) -> Result<(), String> {
    if !is_slot_id(&slot.id) {
        return Err("not a slot".into());
    }
    let _held = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    write_text(&saves_folder(root, account).join(format!("{}.json", slot.id)), text).map_err(|e| e.to_string())?;
    let mut slots: Vec<Slot> = read_slots(root, account).into_iter().filter(|s| s.id != slot.id).collect();
    slots.push(slot);
    write_json(&index_file(root, account), &slots).map_err(|e| e.to_string())
}

/// A slot gone, its text with it: whether there was one.
pub fn remove_save(root: &Path, account: &str, id: &str) -> bool {
    let _held = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let slots = read_slots(root, account);
    if !is_slot_id(id) || !slots.iter().any(|slot| slot.id == id) {
        return false;
    }
    let _ = fs::remove_file(saves_folder(root, account).join(format!("{id}.json")));
    let kept: Vec<Slot> = slots.into_iter().filter(|slot| slot.id != id).collect();
    write_json(&index_file(root, account), &kept).is_ok()
}

/// A browser's slots taken in, those the account has not got: how many were.
pub fn import_saves(root: &Path, account: &str, saves: Vec<(Slot, String)>) -> Result<usize, String> {
    let had: Vec<String> = read_slots(root, account).into_iter().map(|slot| slot.id).collect();
    let mut taken = 0;
    for (slot, text) in saves {
        if had.contains(&slot.id) || !is_slot_id(&slot.id) {
            continue;
        }
        write_save(root, account, slot, &text)?;
        taken += 1;
    }
    Ok(taken)
}

/// What an import carries: slots, each with its text.
pub fn judge_import(body: &str) -> Result<Vec<(Slot, String)>, &'static str> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| "not JSON")?;
    let saves = parsed["saves"].as_array().ok_or("no saves")?;
    saves
        .iter()
        .map(|save| {
            let slot: Slot = serde_json::from_value(save["slot"].clone()).map_err(|_| "a slot is not one")?;
            let text = save["text"].as_str().ok_or("a save has no text")?;
            if !is_slot_id(&slot.id) {
                return Err("a slot is not one");
            }
            Ok((slot, text.to_string()))
        })
        .collect()
}

fn header_of(headers: &HeaderMap, name: &str) -> Option<String> {
    let values: Vec<String> = headers.get_all(name).iter().map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned()).collect();
    match (name, values.len()) {
        (_, 0) => None,
        ("cookie", _) => Some(values.join("; ")),
        _ => values.into_iter().next(),
    }
}

enum Answer {
    Json(u16, Value),
    Text(String),
}

fn refuse(status: u16, reason: &str) -> Answer {
    Answer::Json(status, json!({ "reason": reason }))
}

fn respond(root: &Path, method: &str, path: &str, headers: &HeaderMap, body: Result<String, ()>) -> Answer {
    let now = now_ms();
    let Some(account) = account_of(header_of(headers, "cookie").as_deref(), &read_sessions(root, now), &read_accounts(root), now).cloned() else {
        return refuse(401, "sign in first");
    };
    let rest = path.strip_prefix(SAVES_URL).unwrap_or("").trim_start_matches('/');
    if method == "GET" {
        if rest.is_empty() {
            return Answer::Json(200, json!(read_slots(root, &account.id)));
        }
        return match read_save(root, &account.id, rest) {
            Some(text) => Answer::Text(text),
            None => refuse(404, "no such save"),
        };
    }
    if let Some(refused) = from_the_page(method, |name| header_of(headers, name)) {
        return refuse(403, refused);
    }
    let Ok(body) = body else { return refuse(413, "too large") };
    match rest {
        "remove" => {
            let id = serde_json::from_str::<Value>(&body).ok().and_then(|v| v["id"].as_str().map(str::to_string)).unwrap_or_default();
            if remove_save(root, &account.id, &id) {
                Answer::Json(200, json!({}))
            } else {
                refuse(404, "no such save")
            }
        }
        "import" => match judge_import(&body) {
            Err(reason) => refuse(422, reason),
            Ok(saves) => match import_saves(root, &account.id, saves) {
                Ok(taken) => Answer::Json(200, json!({ "imported": taken })),
                Err(reason) => refuse(500, &reason),
            },
        },
        _ => refuse(404, "no such route"),
    }
}

/// The saves' routes as an axum handler, over the repository at `root`.
pub async fn handle(State(root): State<PathBuf>, method: Method, uri: Uri, headers: HeaderMap, body: Body) -> Response<Body> {
    let path = uri.path().to_string();
    let body = to_bytes(body, LIMIT).await.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).map_err(|_| ());
    let method = method.as_str().to_string();
    let done = tokio::task::spawn_blocking(move || respond(&root, &method, &path, &headers, body)).await.expect("the saves task");
    let (status, text) = match done {
        Answer::Json(status, value) => (status, value.to_string()),
        Answer::Text(text) => (200, text),
    };
    let mut response = Response::new(Body::from(text));
    *response.status_mut() = StatusCode::from_u16(status).expect("a status");
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
