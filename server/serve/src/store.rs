//! The Store: `tools/store.ts`, answered by the Rust server.
//!
//! Art creators publish - a model or a picture - and **show their work**, and everybody signed in says
//! whether they believe it. A listing says how it was made (`claim`) and whether it is free or for sale;
//! its evidence is **How I Made It** and up to six **Process Proof** pictures. Without evidence it is
//! marked AI, whatever it claims, and there is nothing to vote on; for sale needs the evidence and is
//! never AI generated; there are no payments yet, so one for sale is its creator's alone to get. Every
//! `.glb` in `public/models` is a free listing by The engine. **Get** puts a model into the player's own
//! models (`your_models.rs`).
//!
//! Kept in `data/store/listings.json` and the files beside it - the same files the dev plugin kept, so
//! a store published before the move is this store. Held to `server/fixtures/store.json` by
//! `tests/golden_store.rs`; `tests/store_routes.rs` drives the routes.
//!
//! Where the TypeScript would have hung - a body of JSON `null` to `publish` or `update` threw outside
//! its try, and no answer was sent - this answers as it would for `{}`.

use crate::accounts::{account_of, from_the_page, now_ms, read_accounts, read_sessions, Account};
use crate::files::{read_json, write_json};
use crate::js::{js_number, js_number_of, js_trim, node_base64, utf16_len};
use crate::your_models::{import_file, read_your_models, tidy_id};
use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode, Uri};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const STORE_URL: &str = "/__store";
pub const LISTINGS_FILE: &str = "data/store/listings.json";
const FILES: &str = "data/store/files";
pub const ENGINE_MODELS: &str = "public/models";
/// The most a publish or an update may weigh: the file and the proof, sent as base64.
pub const PUBLISH_LIMIT: usize = 128 * 1024 * 1024;
const SMALL: usize = 8192;
/// How many pictures of the work a listing may show.
pub const MOST_PROOFS: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Claim {
    HumanMade,
    AiAssisted,
    AiGenerated,
}

impl Claim {
    pub fn parse(text: &str) -> Option<Claim> {
        match text {
            "human-made" => Some(Claim::HumanMade),
            "ai-assisted" => Some(Claim::AiAssisted),
            "ai-generated" => Some(Claim::AiGenerated),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Vote {
    Like,
    Dislike,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Model,
    Image,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Listing {
    pub id: String,
    pub title: String,
    pub description: String,
    pub claim: Claim,
    #[serde(rename = "forSale")]
    pub for_sale: bool,
    pub how: String,
    pub kind: AssetKind,
    pub file: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    pub proofs: Vec<String>,
    pub creator: String,
    #[serde(rename = "creatorName")]
    pub creator_name: String,
    pub created: Number,
    pub votes: IndexMap<String, Vote>,
    /// One of the engine's own models: `file` is its name in `public/models`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<bool>,
    #[serde(flatten)]
    pub rest: IndexMap<String, Value>,
}

impl Listing {
    fn is_engine(&self) -> bool {
        self.engine == Some(true)
    }
    fn created_f64(&self) -> f64 {
        self.created.as_f64().unwrap_or(0.0)
    }
}

/// Whether a listing shows its work: How I Made It, and at least one picture of it.
pub fn supported(how: &str, proofs: usize) -> bool {
    !js_trim(how).is_empty() && proofs > 0
}

/// How the store marks a listing: as it claims, once it shows its work; AI generated until then.
pub fn mark_of(listing: &Listing) -> Claim {
    if supported(&listing.how, listing.proofs.len()) {
        listing.claim
    } else {
        Claim::AiGenerated
    }
}

/// Why a listing may not be for sale, or nothing when it may.
pub fn judge_sale(how: &str, proofs: usize, claim: Claim, for_sale: bool) -> Option<&'static str> {
    if !for_sale {
        return None;
    }
    if claim == Claim::AiGenerated {
        return Some("AI generated work is not for sale");
    }
    if !supported(how, proofs) {
        return Some("to be for sale, show your work: How I Made It and at least one Process Proof");
    }
    None
}

/// The share of votes that are likes, as a whole percent; nothing when nobody has voted.
pub fn authenticity(likes: usize, dislikes: usize) -> Option<i64> {
    let all = likes + dislikes;
    if all == 0 {
        return None;
    }
    Some(((likes as f64 / all as f64) * 100.0).round() as i64)
}

/// A listing as the page sees it, for this asker, who has these listings in their own models: its own
/// fields but the votes and the file names, and the mark, the counts and the asker's own vote.
pub fn view_of(listing: &Listing, asker: Option<&str>, yours: &HashSet<String>) -> Value {
    let likes = listing.votes.values().filter(|vote| **vote == Vote::Like).count();
    let dislikes = listing.votes.len() - likes;
    let Value::Object(mut view) = serde_json::to_value(listing).expect("a listing") else { unreachable!() };
    for hidden in ["votes", "file", "proofs"] {
        view.shift_remove(hidden);
    }
    view.insert("mark".into(), json!(mark_of(listing)));
    view.insert("supported".into(), json!(supported(&listing.how, listing.proofs.len())));
    view.insert("proofCount".into(), json!(listing.proofs.len()));
    view.insert("likes".into(), json!(likes));
    view.insert("dislikes".into(), json!(dislikes));
    view.insert("authenticity".into(), json!(authenticity(likes, dislikes)));
    view.insert("mine".into(), json!(asker.and_then(|asker| listing.votes.get(asker))));
    view.insert("own".into(), json!(asker == Some(listing.creator.as_str())));
    view.insert("inYours".into(), json!(yours.contains(&listing.id)));
    Value::Object(view)
}

/// A model file's name as a title: `bandit-cutter.glb` is Bandit Cutter.
pub fn title_of(file: &str) -> String {
    tidy_id(file)
        .split('-')
        .map(|word| {
            let mut chars = word.chars();
            chars.next().map(|first| first.to_uppercase().chain(chars).collect::<String>()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// An engine model's listing id: the same for its file every time, so its votes stay with it.
pub fn engine_listing_id(file: &str) -> String {
    hex::encode(Sha256::digest(format!("engine:{file}").as_bytes()))[..16].to_string()
}

/// The listings with the engine's models brought up to date; and whether anything changed.
pub fn engine_listings(listings: Vec<Listing>, files: &[(String, f64)], provenance: &Map<String, Value>) -> (Vec<Listing>, bool) {
    let before = listings.len();
    let present: HashSet<&str> = files.iter().map(|(file, _)| file.as_str()).collect();
    let mut kept: Vec<Listing> = listings.into_iter().filter(|listing| !listing.is_engine() || present.contains(listing.file.as_str())).collect();
    let mut changed = kept.len() != before;
    let listed: HashSet<String> = kept.iter().filter(|listing| listing.is_engine()).map(|listing| listing.file.clone()).collect();
    for (file, created) in files {
        if listed.contains(file) {
            continue;
        }
        let mark = provenance.get(&format!("model:{}", tidy_id(file))).and_then(Value::as_str);
        kept.push(Listing {
            id: engine_listing_id(file),
            title: title_of(file),
            description: "One of the engine\u{2019}s own models: every project has it.".into(),
            claim: match mark {
                Some("human-made") => Claim::HumanMade,
                Some("ai-assisted") => Claim::AiAssisted,
                _ => Claim::AiGenerated,
            },
            for_sale: false,
            how: String::new(),
            kind: AssetKind::Model,
            file: file.clone(),
            file_name: file.clone(),
            proofs: Vec::new(),
            creator: "admin".into(),
            creator_name: "The engine".into(),
            created: js_number(*created),
            votes: IndexMap::new(),
            engine: Some(true),
            rest: IndexMap::new(),
        });
        changed = true;
    }
    (kept, changed)
}

/// The `.glb` files in `public/models`, with when each was last written, as Node's `mtimeMs`.
fn engine_files(root: &Path) -> Vec<(String, f64)> {
    let Ok(entries) = fs::read_dir(root.join(ENGINE_MODELS)) else { return Vec::new() };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file = entry.file_name().to_string_lossy().into_owned();
            if !file.to_lowercase().ends_with(".glb") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
            Some((file, modified.as_secs() as f64 * 1000.0 + f64::from(modified.subsec_nanos()) / 1e6))
        })
        .collect()
}

fn read_provenance(root: &Path) -> Map<String, Value> {
    read_json(&root.join("projects/art-provenance.json"), Map::new())
}

/// What a file is, from its first bytes: a binary glTF, a PNG, a JPEG, a WebP - or nothing the store takes.
pub fn sniff(bytes: &[u8]) -> Option<(AssetKind, &'static str, &'static str)> {
    let at = |i: usize, values: &[u8]| bytes.get(i..i + values.len()) == Some(values);
    if at(0, &[0x67, 0x6c, 0x54, 0x46]) {
        return Some((AssetKind::Model, "glb", "model/gltf-binary"));
    }
    if at(0, &[0x89, 0x50, 0x4e, 0x47]) {
        return Some((AssetKind::Image, "png", "image/png"));
    }
    if at(0, &[0xff, 0xd8, 0xff]) {
        return Some((AssetKind::Image, "jpg", "image/jpeg"));
    }
    if at(0, &[0x52, 0x49, 0x46, 0x46]) && at(8, &[0x57, 0x45, 0x42, 0x50]) {
        return Some((AssetKind::Image, "webp", "image/webp"));
    }
    None
}

/// A file sent as base64 or a data URL, read as Node reads base64: leniently. Nothing for a non-string.
pub fn decode(value: Option<&Value>) -> Option<Vec<u8>> {
    let text = value?.as_str()?;
    Some(node_base64(text.find(',').map_or(text, |at| &text[at + 1..])))
}

/// `text()`: a string whose JavaScript-trimmed length is at most `most`, trimmed.
fn text(value: Option<&Value>, most: usize) -> Option<String> {
    let trimmed = js_trim(value?.as_str()?);
    (utf16_len(trimmed) <= most).then(|| trimmed.to_string())
}

/// A field of a parsed body: nothing for a field it does not have, or a body that is not an object.
fn field<'a>(parsed: &'a Value, key: &str) -> Option<&'a Value> {
    parsed.as_object()?.get(key)
}

/// A present field that is not `null`: what `??` keeps.
fn given<'a>(parsed: &'a Value, key: &str) -> Option<&'a Value> {
    field(parsed, key).filter(|value| !value.is_null())
}

#[derive(Clone, Debug, PartialEq)]
pub struct Upload {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
}

/// Pictures of the work, from a body: each a PNG, JPEG or WebP - or why not.
fn judge_proofs(value: Option<&Value>, room: i64) -> Result<Vec<Upload>, String> {
    let Some(value) = value.filter(|value| !value.is_null()) else { return Ok(Vec::new()) };
    let Some(list) = value.as_array() else { return Err("the Process Proof is a list of pictures".into()) };
    if list.len() as i64 > room {
        return Err(format!("a listing shows {MOST_PROOFS} pictures of the work at most"));
    }
    list.iter()
        .map(|proof| {
            let bytes = decode(proof.as_object().and_then(|proof| proof.get("data")));
            match bytes.as_deref().and_then(sniff) {
                Some((AssetKind::Image, ext, _)) => Ok(Upload { bytes: bytes.unwrap(), ext }),
                _ => Err("the Process Proof is PNG, JPEG or WebP pictures".to_string()),
            }
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct PublishDraft {
    pub title: String,
    pub description: String,
    pub claim: Claim,
    pub for_sale: bool,
    pub how: String,
    pub asset: (Vec<u8>, AssetKind, &'static str, String),
    pub proofs: Vec<Upload>,
}

/// A publish, from its body - or why not (`judgePublish`).
pub fn judge_publish(body: &str) -> Result<PublishDraft, String> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| "not JSON".to_string())?;
    let title = text(field(&parsed, "title"), 80).filter(|title| !title.is_empty()).ok_or("a listing needs a title, of 80 characters at most")?;
    let blank = Value::String(String::new());
    let description = text(Some(given(&parsed, "description").unwrap_or(&blank)), 2000);
    let how = text(Some(given(&parsed, "how").unwrap_or(&blank)), 2000);
    let (Some(description), Some(how)) = (description, how) else {
        return Err("the description and How I Made It are 2000 characters at most".into());
    };
    let claim = match given(&parsed, "claim") {
        None => Some(Claim::AiGenerated),
        Some(value) => value.as_str().and_then(Claim::parse),
    }
    .ok_or("a listing is human made, AI assisted or AI generated")?;
    let for_sale = field(&parsed, "forSale") == Some(&Value::Bool(true));
    let asset = field(&parsed, "asset").and_then(Value::as_object);
    let bytes = decode(asset.and_then(|asset| asset.get("data")));
    let Some((bytes, (kind, ext, _))) = bytes.and_then(|bytes| sniff(&bytes).map(|sniffed| (bytes, sniffed))) else {
        return Err("the asset is a .glb model or a PNG, JPEG or WebP picture".into());
    };
    let name = match asset.and_then(|asset| asset.get("name")).and_then(Value::as_str) {
        Some(name) => {
            let kept: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ' ' | '.' | '-')).take(80).collect();
            if kept.is_empty() {
                format!("asset.{ext}")
            } else {
                kept
            }
        }
        None => format!("asset.{ext}"),
    };
    let proofs = judge_proofs(field(&parsed, "proofs"), MOST_PROOFS as i64)?;
    if let Some(sale) = judge_sale(&how, proofs.len(), claim, for_sale) {
        return Err(sale.into());
    }
    Ok(PublishDraft { title, description, claim, for_sale, how, asset: (bytes, kind, ext, name), proofs })
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct UpdateDraft {
    pub id: String,
    pub how: Option<String>,
    pub claim: Option<Claim>,
    pub for_sale: Option<bool>,
    pub add_proofs: Vec<Upload>,
}

fn is_listing_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Showing the work later, from its body - or why not (`judgeUpdate`); `has` is how many pictures a listing shows, or nothing.
pub fn judge_update(body: &str, has: impl Fn(&str) -> Option<usize>) -> Result<UpdateDraft, String> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| "not JSON".to_string())?;
    let id = field(&parsed, "id").and_then(Value::as_str).filter(|id| is_listing_id(id)).ok_or("no such listing")?;
    let shown = has(id).ok_or("no such listing")?;
    let mut draft = UpdateDraft { id: id.to_string(), ..UpdateDraft::default() };
    if let Some(how) = field(&parsed, "how") {
        draft.how = Some(text(Some(how), 2000).ok_or("How I Made It is 2000 characters at most")?);
    }
    if let Some(claim) = field(&parsed, "claim") {
        draft.claim = Some(claim.as_str().and_then(Claim::parse).ok_or("a listing is human made, AI assisted or AI generated")?);
    }
    if let Some(for_sale) = field(&parsed, "forSale") {
        draft.for_sale = Some(*for_sale == Value::Bool(true));
    }
    draft.add_proofs = judge_proofs(field(&parsed, "addProofs"), MOST_PROOFS as i64 - shown as i64)?;
    Ok(draft)
}

/// A vote, from its body: a listing, and like, dislike or nothing (`judgeVote`).
pub fn judge_vote(body: &str) -> Result<(String, Option<Vote>), &'static str> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| "not JSON")?;
    // Destructuring `null` throws in JavaScript, inside the try: not JSON.
    if parsed.is_null() {
        return Err("not JSON");
    }
    let id = field(&parsed, "id").and_then(Value::as_str).filter(|id| is_listing_id(id)).ok_or("no such listing")?;
    let vote = match field(&parsed, "vote") {
        Some(Value::Null) => None,
        Some(Value::String(vote)) if vote == "like" => Some(Vote::Like),
        Some(Value::String(vote)) if vote == "dislike" => Some(Vote::Dislike),
        _ => return Err("a vote is like, dislike, or nothing"),
    };
    Ok((id.to_string(), vote))
}

/// Which listing a body names (`judgeListingId`).
pub fn judge_listing_id(body: &str) -> Result<String, &'static str> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| "not JSON")?;
    if parsed.is_null() {
        return Err("not JSON");
    }
    field(&parsed, "id").and_then(Value::as_str).filter(|id| is_listing_id(id)).map(str::to_string).ok_or("no such listing")
}

/// Put a vote on a listing, or take one off; never the creator's own, and only on work shown.
pub fn cast_vote(listing: &mut Listing, voter: &str, vote: Option<Vote>) -> Option<&'static str> {
    if voter == listing.creator {
        return Some("your own listing is not yours to vote on");
    }
    if vote.is_some() && !supported(&listing.how, listing.proofs.len()) {
        return Some("there is nothing to judge until its creator shows their work");
    }
    match vote {
        None => {
            listing.votes.shift_remove(voter);
        }
        Some(vote) => {
            listing.votes.insert(voter.to_string(), vote);
        }
    }
    None
}

/// Whether an account may take a listing down: its creator, or admin - never one of the engine's.
pub fn may_remove(listing: &Listing, account: &Account) -> bool {
    !listing.is_engine() && (account.admin || account.id == listing.creator)
}

/// Whether an account may get a listing's file: anybody for a free one; for one for sale, its creator.
pub fn may_get(listing: &Listing, account: Option<&Account>) -> bool {
    !listing.for_sale || account.is_some_and(|account| account.id == listing.creator)
}

/// The listings, brought forward from before claims: one `proof` becomes `proofs`, AI generated, free.
pub fn read_listings(root: &Path) -> Vec<Listing> {
    let parsed: Value = read_json(&root.join(LISTINGS_FILE), Value::Null);
    let Value::Array(entries) = parsed else { return Vec::new() };
    entries
        .into_iter()
        .filter_map(|entry| {
            let Value::Object(mut listing) = entry else { return None };
            let proof = listing.shift_remove("proof");
            if !listing.get("claim").is_some_and(|claim| !claim.is_null()) {
                listing.insert("claim".into(), json!("ai-generated"));
            }
            if !listing.get("forSale").is_some_and(|sale| !sale.is_null()) {
                listing.insert("forSale".into(), json!(false));
            }
            if !listing.get("proofs").is_some_and(|proofs| !proofs.is_null()) {
                let proofs = match proof {
                    Some(Value::String(proof)) => vec![Value::String(proof)],
                    _ => Vec::new(),
                };
                listing.insert("proofs".into(), Value::Array(proofs));
            }
            serde_json::from_value(Value::Object(listing)).ok()
        })
        .collect()
}

pub fn write_listings(root: &Path, listings: &[Listing]) -> std::io::Result<()> {
    write_json(&root.join(LISTINGS_FILE), &listings)
}

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the system's random source");
    hex::encode(buffer)
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit('.').next() {
        Some("glb") => "model/gltf-binary",
        Some("png") => "image/png",
        Some("jpg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

#[derive(Clone)]
pub struct Shop {
    pub root: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl Shop {
    pub fn new(root: PathBuf) -> Self {
        Shop { root, lock: Arc::new(Mutex::new(())) }
    }
}

enum Answer {
    Json(u16, Value),
    File { bytes: Vec<u8>, kind: &'static str, attachment: Option<String> },
}

fn refuse(status: u16, reason: impl Into<String>) -> Answer {
    Answer::Json(status, json!({ "reason": reason.into() }))
}

struct Asked {
    method: String,
    route: Vec<String>,
    download: bool,
    headers: HeaderMap,
    body: Result<String, ()>,
}

fn header_of(headers: &HeaderMap, name: &str) -> Option<String> {
    let values: Vec<String> = headers.get_all(name).iter().map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned()).collect();
    match (name, values.len()) {
        (_, 0) => None,
        ("cookie", _) => Some(values.join("; ")),
        _ => values.into_iter().next(),
    }
}

fn respond(shop: &Shop, asked: Asked) -> Answer {
    let _held = shop.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = shop.root.as_path();
    let now = now_ms();
    let accounts = read_accounts(root);
    let account = account_of(header_of(&asked.headers, "cookie").as_deref(), &read_sessions(root, now), &accounts, now).cloned();
    let (mut listings, changed) = engine_listings(read_listings(root), &engine_files(root), &read_provenance(root));
    if changed {
        let _ = write_listings(root, &listings);
    }
    let yours: HashSet<String> = account.as_ref().map_or_else(HashSet::new, |account| read_your_models(root, &account.id).iter().filter_map(|model| model.listing().map(str::to_string)).collect());
    let asker = account.as_ref().map(|account| account.id.as_str());
    let file_of = |listing: &Listing, name: &str| -> PathBuf {
        if listing.is_engine() && name == listing.file {
            root.join(ENGINE_MODELS).join(name)
        } else {
            root.join(FILES).join(name)
        }
    };
    let keep = |id: &str, bytes: &[u8], ext: &str, what: &str| -> String {
        let name = format!("{id}-{what}.{ext}");
        let _ = fs::create_dir_all(root.join(FILES));
        let _ = fs::write(root.join(FILES).join(&name), bytes);
        name
    };
    let route = |i: usize| asked.route.get(i).map(String::as_str);

    if asked.method == "GET" && route(0) == Some("list") {
        let mut sorted: Vec<&Listing> = listings.iter().collect();
        sorted.sort_by(|a, b| b.created_f64().partial_cmp(&a.created_f64()).unwrap_or(std::cmp::Ordering::Equal));
        return Answer::Json(200, Value::Array(sorted.into_iter().map(|listing| view_of(listing, asker, &yours)).collect()));
    }
    if asked.method == "GET" && route(0) == Some("file") {
        let Some(listing) = listings.iter().find(|entry| Some(entry.id.as_str()) == route(1)) else {
            return refuse(404, "no such file");
        };
        let asset = route(2) == Some("asset");
        let name = if asset {
            Some(listing.file.clone())
        } else if route(2) == Some("proof") {
            // `proofs[Number(n)]`: a whole number within the list, or nothing.
            let n = route(3).map_or(f64::NAN, js_number_of);
            (n.fract() == 0.0 && n >= 0.0 && (n as usize) < listing.proofs.len()).then(|| listing.proofs[n as usize].clone())
        } else {
            None
        };
        let Some(bytes) = name.as_ref().and_then(|name| fs::read(file_of(listing, name)).ok()) else {
            return refuse(404, "no such file");
        };
        if asset && asked.download && !may_get(listing, account.as_ref()) {
            return refuse(402, "it is for sale, and payments are not open yet");
        }
        let attachment = (asset && asked.download).then(|| listing.file_name.replace('"', ""));
        return Answer::File { bytes, kind: content_type(name.as_deref().unwrap()), attachment };
    }

    if let Some(refused) = from_the_page(&asked.method, |name| header_of(&asked.headers, name)) {
        return refuse(403, refused);
    }
    let Some(account) = account.clone() else { return refuse(401, "sign in first") };
    let Ok(body) = &asked.body else { return refuse(413, "too large") };

    match route(0) {
        Some("publish") => {
            let draft = match judge_publish(body) {
                Ok(draft) => draft,
                Err(reason) => return refuse(422, reason),
            };
            let id = random_hex(8);
            let (bytes, kind, ext, name) = &draft.asset;
            let listing = Listing {
                title: draft.title.clone(),
                description: draft.description.clone(),
                claim: draft.claim,
                for_sale: draft.for_sale,
                how: draft.how.clone(),
                kind: *kind,
                file: keep(&id, bytes, ext, "asset"),
                file_name: name.clone(),
                proofs: draft.proofs.iter().enumerate().map(|(i, proof)| keep(&id, &proof.bytes, proof.ext, &format!("proof-{i}"))).collect(),
                creator: account.id.clone(),
                creator_name: account.name.clone(),
                created: Number::from(now_ms()),
                votes: IndexMap::new(),
                engine: None,
                rest: IndexMap::new(),
                id,
            };
            listings.push(listing.clone());
            let _ = write_listings(root, &listings);
            Answer::Json(200, view_of(&listing, Some(&account.id), &yours))
        }
        Some("update") => {
            let draft = match judge_update(body, |id| listings.iter().find(|entry| entry.id == id).map(|entry| entry.proofs.len())) {
                Ok(draft) => draft,
                Err(reason) => return refuse(422, reason),
            };
            let index = listings.iter().position(|entry| entry.id == draft.id).expect("judged to be there");
            if listings[index].creator != account.id {
                return refuse(403, "only its creator shows its work");
            }
            let mut next = listings[index].clone();
            if let Some(how) = draft.how {
                next.how = how;
            }
            if let Some(claim) = draft.claim {
                next.claim = claim;
            }
            if let Some(for_sale) = draft.for_sale {
                next.for_sale = for_sale;
            }
            if let Some(sale) = judge_sale(&next.how, next.proofs.len() + draft.add_proofs.len(), next.claim, next.for_sale) {
                return refuse(422, sale);
            }
            let start = next.proofs.len();
            for (i, proof) in draft.add_proofs.iter().enumerate() {
                let name = keep(&next.id, &proof.bytes, proof.ext, &format!("proof-{}-{}", start + i, random_hex(3)));
                next.proofs.push(name);
            }
            listings[index] = next.clone();
            let _ = write_listings(root, &listings);
            Answer::Json(200, view_of(&next, Some(&account.id), &yours))
        }
        Some("get") => {
            let id = match judge_listing_id(body) {
                Ok(id) => id,
                Err(reason) => return refuse(422, reason),
            };
            let Some(listing) = listings.iter().find(|entry| entry.id == id) else { return refuse(404, "no such listing") };
            if listing.kind != AssetKind::Model {
                return refuse(422, "a picture is downloaded, not put into your models");
            }
            if !may_get(listing, Some(&account)) {
                return refuse(402, "it is for sale, and payments are not open yet");
            }
            match import_file(root, &account.id, &listing.file_name, &file_of(listing, &listing.file), Some(&listing.id)) {
                Ok((model, _)) => {
                    let mut now_yours = yours.clone();
                    now_yours.insert(listing.id.clone());
                    Answer::Json(200, json!({ "listing": view_of(listing, Some(&account.id), &now_yours), "model": model }))
                }
                Err(reason) => refuse(422, reason),
            }
        }
        Some("vote") => {
            let (id, vote) = match judge_vote(body) {
                Ok(verdict) => verdict,
                Err(reason) => return refuse(422, reason),
            };
            let Some(index) = listings.iter().position(|entry| entry.id == id) else { return refuse(404, "no such listing") };
            if let Some(refused) = cast_vote(&mut listings[index], &account.id, vote) {
                return refuse(403, refused);
            }
            let _ = write_listings(root, &listings);
            Answer::Json(200, view_of(&listings[index], Some(&account.id), &yours))
        }
        Some("remove") => {
            let id = match judge_listing_id(body) {
                Ok(id) => id,
                Err(reason) => return refuse(422, reason),
            };
            let Some(listing) = listings.iter().find(|entry| entry.id == id).cloned() else { return refuse(404, "no such listing") };
            if !may_remove(&listing, &account) {
                return refuse(
                    403,
                    if listing.is_engine() { "it is the engine\u{2019}s own: it goes when its file leaves public/models" } else { "only its creator, or admin, can take it down" },
                );
            }
            listings.retain(|entry| entry.id != listing.id);
            let _ = write_listings(root, &listings);
            for name in std::iter::once(&listing.file).chain(listing.proofs.iter()) {
                let _ = fs::remove_file(root.join(FILES).join(name));
            }
            Answer::Json(200, json!({}))
        }
        _ => refuse(404, "no such route"),
    }
}

/// The `/__store` routes, as an axum handler.
pub async fn handle(State(shop): State<Shop>, method: Method, uri: Uri, headers: HeaderMap, body: Body) -> Response<Body> {
    let rest = uri.path().strip_prefix(STORE_URL).unwrap_or("").trim_start_matches('/');
    let route: Vec<String> = rest.split('/').map(str::to_string).collect();
    let download = uri.query().is_some_and(|query| query.split('&').any(|pair| pair.split('=').next() == Some("download")));
    let big = matches!(route.first().map(String::as_str), Some("publish" | "update"));
    let body = to_bytes(body, if big { PUBLISH_LIMIT } else { SMALL }).await.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).map_err(|_| ());
    let asked = Asked { method: method.as_str().to_string(), route, download, headers, body };
    let done = tokio::task::spawn_blocking(move || respond(&shop, asked)).await.expect("the store task");
    let mut response = match done {
        Answer::Json(status, body) => {
            let mut response = Response::new(Body::from(body.to_string()));
            *response.status_mut() = StatusCode::from_u16(status).expect("a status");
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
            response
        }
        Answer::File { bytes, kind, attachment } => {
            let mut response = Response::new(Body::from(bytes));
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(kind));
            if let Some(name) = attachment {
                let ascii: String = name.chars().filter(|c| c.is_ascii() && !c.is_ascii_control()).collect();
                if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{ascii}\"")) {
                    response.headers_mut().insert(header::CONTENT_DISPOSITION, value);
                }
            }
            response
        }
    };
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
