//! The peer games' relay (`docs/PEER.md`, "A link instead of codes"): the server carrying the codes two pages trade to
//! meet over WebRTC, so a guest joins a peer game - and comes back to it - by opening a link, nobody pasting anything.
//! Nothing of the game passes through here: only the codes, and only until they are taken.
//!
//! A host - signed in, from the page's own origin - opens a **room** (`POST /__peer/rooms`: `{ room, secret }`), and
//! sends the link to it. A guest's page knocks with its own code (`POST /__peer/rooms/<room>/knock` `{ code }`:
//! `{ knock }`); the host's page takes the knocks (`GET /__peer/rooms/<room>/knocks`, the secret in `x-peer-secret`:
//! `{ knocks: [{ knock, code }] }`, each given once), answers each (`POST /__peer/rooms/<room>/answers/<knock>`
//! `{ code }`, the secret again), and the guest's page takes the answer (`GET /__peer/rooms/<room>/answers/<knock>`:
//! `{ code }`, given once, or `{ code: null }` until there is one). A guest needs no account: the room's id and the
//! knock's are as hard to guess as a game's invitation, which is what the server's own games ask of a guest too.
//!
//! Kept in memory alone, never in `data/`. A room is gone once its host has not taken its knocks for `ROOM_FOR` -
//! the host's page asks every second or so while it is open, and once a minute behind other tabs. Each code is at most `CODE_LONGEST` bytes, a room holds
//! at most `KNOCKS` knocks not yet taken and `ISSUED` knocks in all, and there are at most `ROOMS` rooms.

use crate::accounts::{account_of, from_the_page, now_ms, read_accounts, read_sessions};
use axum::body::{to_bytes, Body};
use axum::extract::{Path as Route, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const PEER_URL: &str = "/__peer";
/// The header the host's page proves a room its own with.
pub const SECRET_HEADER: &str = "x-peer-secret";
/// How long a room outlives its host's last taking of its knocks: long enough for a host's page in a tab behind
/// others, whose timers the browser slows to one a minute.
pub const ROOM_FOR: Duration = Duration::from_secs(10 * 60);
/// The longest code, in bytes: a WebRTC description and its ways in, deflated, are a kilobyte or two.
pub const CODE_LONGEST: usize = 16 * 1024;
/// How many knocks a room holds that its host has not taken; how many it hands out in all; how many rooms there are.
pub const KNOCKS: usize = 32;
pub const ISSUED: usize = 256;
pub const ROOMS: usize = 500;

fn fresh_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the system's randomness");
    hex::encode(buffer)
}

/// Why the relay would not: a status and what to tell the page.
#[derive(Debug, PartialEq, Eq)]
pub struct Refused(pub StatusCode, pub &'static str);

struct Room {
    secret: String,
    /// When the host's page last took the knocks.
    seen: Instant,
    /// Knocks the host has not taken yet, oldest first.
    knocks: Vec<(String, String)>,
    /// Every knock handed out, and the answer to it once the host has given one.
    answers: HashMap<String, Option<String>>,
}

/// Every room, kept in memory.
#[derive(Default)]
pub struct Rooms {
    rooms: HashMap<String, Room>,
}

impl Rooms {
    /// The rooms whose hosts have gone, forgotten.
    fn sweep(&mut self, now: Instant) {
        self.rooms.retain(|_, room| now.duration_since(room.seen) < ROOM_FOR);
    }

    fn room(&mut self, room: &str, now: Instant) -> Result<&mut Room, Refused> {
        self.sweep(now);
        self.rooms.get_mut(room).ok_or(Refused(StatusCode::NOT_FOUND, "no such room"))
    }

    fn hosted(&mut self, room: &str, secret: &str, now: Instant) -> Result<&mut Room, Refused> {
        let found = self.room(room, now)?;
        if found.secret != secret {
            return Err(Refused(StatusCode::FORBIDDEN, "not this room's host"));
        }
        Ok(found)
    }

    /// A room opened: its id and the secret its host proves it theirs with.
    pub fn open(&mut self, now: Instant) -> Result<(String, String), Refused> {
        self.sweep(now);
        if self.rooms.len() >= ROOMS {
            return Err(Refused(StatusCode::SERVICE_UNAVAILABLE, "too many rooms open"));
        }
        let (room, secret) = (fresh_hex(16), fresh_hex(16));
        self.rooms.insert(room.clone(), Room { secret: secret.clone(), seen: now, knocks: Vec::new(), answers: HashMap::new() });
        Ok((room, secret))
    }

    /// A guest's code left for the host: the knock it is known by.
    pub fn knock(&mut self, room: &str, code: &str, now: Instant) -> Result<String, Refused> {
        check(code)?;
        let found = self.room(room, now)?;
        if found.knocks.len() >= KNOCKS {
            return Err(Refused(StatusCode::TOO_MANY_REQUESTS, "too many knocks waiting"));
        }
        if found.answers.len() >= ISSUED {
            return Err(Refused(StatusCode::TOO_MANY_REQUESTS, "too many knocks at this room"));
        }
        let knock = fresh_hex(16);
        found.knocks.push((knock.clone(), code.to_string()));
        found.answers.insert(knock.clone(), None);
        Ok(knock)
    }

    /// The knocks the host has not taken, taken; the room kept open a while longer.
    pub fn knocks(&mut self, room: &str, secret: &str, now: Instant) -> Result<Vec<(String, String)>, Refused> {
        let found = self.hosted(room, secret, now)?;
        found.seen = now;
        Ok(std::mem::take(&mut found.knocks))
    }

    /// The host's answer to a knock, left for the guest.
    pub fn answer(&mut self, room: &str, secret: &str, knock: &str, code: &str, now: Instant) -> Result<(), Refused> {
        check(code)?;
        let found = self.hosted(room, secret, now)?;
        let slot = found.answers.get_mut(knock).ok_or(Refused(StatusCode::NOT_FOUND, "no such knock"))?;
        *slot = Some(code.to_string());
        Ok(())
    }

    /// The answer to a knock, given once; `None` until the host has given one.
    pub fn answered(&mut self, room: &str, knock: &str, now: Instant) -> Result<Option<String>, Refused> {
        let found = self.room(room, now)?;
        let slot = found.answers.get_mut(knock).ok_or(Refused(StatusCode::NOT_FOUND, "no such knock"))?;
        Ok(slot.take())
    }
}

/// A code the relay carries: something, and not too long.
fn check(code: &str) -> Result<(), Refused> {
    if code.is_empty() {
        return Err(Refused(StatusCode::BAD_REQUEST, "no code"));
    }
    if code.len() > CODE_LONGEST {
        return Err(Refused(StatusCode::PAYLOAD_TOO_LARGE, "that code is too long"));
    }
    Ok(())
}

/// The relay's state: the rooms, and the folder whose accounts say who is signed in.
#[derive(Clone)]
pub struct Relay {
    root: PathBuf,
    rooms: Arc<Mutex<Rooms>>,
}

fn reply(status: StatusCode, value: Value) -> Response {
    let mut response = Response::new(Body::from(value.to_string()));
    *response.status_mut() = status;
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn refused(Refused(status, why): Refused) -> Response {
    reply(status, json!({ "error": why }))
}

fn header_of(headers: &HeaderMap) -> impl Fn(&str) -> Option<String> + '_ {
    |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

/// A POST the page sent, and the code in its body.
async fn posted(method: &Method, headers: &HeaderMap, body: Body) -> Result<String, Refused> {
    if from_the_page(method.as_str(), header_of(headers)).is_some() {
        return Err(Refused(StatusCode::FORBIDDEN, "not from the page"));
    }
    let bytes = to_bytes(body, CODE_LONGEST * 2).await.map_err(|_| Refused(StatusCode::PAYLOAD_TOO_LARGE, "that code is too long"))?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| Refused(StatusCode::BAD_REQUEST, "not a code"))?;
    value["code"].as_str().map(str::to_string).ok_or(Refused(StatusCode::BAD_REQUEST, "no code"))
}

impl Relay {
    fn rooms(&self) -> std::sync::MutexGuard<'_, Rooms> {
        self.rooms.lock().expect("the rooms")
    }
}

async fn open(State(relay): State<Relay>, method: Method, headers: HeaderMap) -> Response {
    let header = header_of(&headers);
    if from_the_page(method.as_str(), &header).is_some() {
        return refused(Refused(StatusCode::FORBIDDEN, "not from the page"));
    }
    let now = now_ms();
    let signed_in = account_of(header("cookie").as_deref(), &read_sessions(&relay.root, now), &read_accounts(&relay.root), now).is_some();
    if !signed_in {
        return refused(Refused(StatusCode::UNAUTHORIZED, "not signed in"));
    }
    match relay.rooms().open(Instant::now()) {
        Ok((room, secret)) => reply(StatusCode::OK, json!({ "room": room, "secret": secret })),
        Err(why) => refused(why),
    }
}

async fn knock(State(relay): State<Relay>, Route(room): Route<String>, method: Method, headers: HeaderMap, body: Body) -> Response {
    let code = match posted(&method, &headers, body).await {
        Ok(code) => code,
        Err(why) => return refused(why),
    };
    match relay.rooms().knock(&room, &code, Instant::now()) {
        Ok(knock) => reply(StatusCode::OK, json!({ "knock": knock })),
        Err(why) => refused(why),
    }
}

async fn knocks(State(relay): State<Relay>, Route(room): Route<String>, headers: HeaderMap) -> Response {
    let secret = header_of(&headers)(SECRET_HEADER).unwrap_or_default();
    match relay.rooms().knocks(&room, &secret, Instant::now()) {
        Ok(knocks) => reply(StatusCode::OK, json!({ "knocks": knocks.into_iter().map(|(knock, code)| json!({ "knock": knock, "code": code })).collect::<Vec<_>>() })),
        Err(why) => refused(why),
    }
}

async fn answer(State(relay): State<Relay>, Route((room, knock)): Route<(String, String)>, method: Method, headers: HeaderMap, body: Body) -> Response {
    let secret = header_of(&headers)(SECRET_HEADER).unwrap_or_default();
    let code = match posted(&method, &headers, body).await {
        Ok(code) => code,
        Err(why) => return refused(why),
    };
    match relay.rooms().answer(&room, &secret, &knock, &code, Instant::now()) {
        Ok(()) => reply(StatusCode::OK, json!({ "ok": true })),
        Err(why) => refused(why),
    }
}

async fn answered(State(relay): State<Relay>, Route((room, knock)): Route<(String, String)>) -> Response {
    match relay.rooms().answered(&room, &knock, Instant::now()) {
        Ok(code) => reply(StatusCode::OK, json!({ "code": code })),
        Err(why) => refused(why),
    }
}

/// The relay's routes, over the folder whose accounts say who may open a room.
pub fn router(root: PathBuf) -> Router {
    let relay = Relay { root, rooms: Arc::new(Mutex::new(Rooms::default())) };
    Router::new()
        .route(&format!("{PEER_URL}/rooms"), post(open))
        .route(&format!("{PEER_URL}/rooms/{{room}}/knock"), post(knock))
        .route(&format!("{PEER_URL}/rooms/{{room}}/knocks"), get(knocks))
        .route(&format!("{PEER_URL}/rooms/{{room}}/answers/{{knock}}"), post(answer).get(answered))
        .with_state(relay)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_knock_is_taken_once_answered_once_and_only_by_the_host() {
        let mut rooms = Rooms::default();
        let now = Instant::now();
        let (room, secret) = rooms.open(now).unwrap();
        assert_eq!(room.len(), 32);
        let knock = rooms.knock(&room, "TE1.mine", now).unwrap();
        assert_eq!(rooms.knocks(&room, "wrong", now), Err(Refused(StatusCode::FORBIDDEN, "not this room's host")));
        assert_eq!(rooms.knocks(&room, &secret, now).unwrap(), vec![(knock.clone(), "TE1.mine".to_string())]);
        assert_eq!(rooms.knocks(&room, &secret, now).unwrap(), vec![]);
        assert_eq!(rooms.answered(&room, &knock, now), Ok(None));
        assert_eq!(rooms.answer(&room, "wrong", &knock, "TE1.yours", now), Err(Refused(StatusCode::FORBIDDEN, "not this room's host")));
        assert_eq!(rooms.answer(&room, &secret, "nobody", "TE1.yours", now), Err(Refused(StatusCode::NOT_FOUND, "no such knock")));
        rooms.answer(&room, &secret, &knock, "TE1.yours", now).unwrap();
        assert_eq!(rooms.answered(&room, &knock, now), Ok(Some("TE1.yours".to_string())));
        assert_eq!(rooms.answered(&room, &knock, now), Ok(None));
        assert_eq!(rooms.knock("nowhere", "TE1.x", now), Err(Refused(StatusCode::NOT_FOUND, "no such room")));
    }

    #[test]
    fn a_room_goes_once_its_host_has_not_asked_for_a_while() {
        let mut rooms = Rooms::default();
        let now = Instant::now();
        let (room, secret) = rooms.open(now).unwrap();
        let later = now + ROOM_FOR - Duration::from_secs(1);
        rooms.knocks(&room, &secret, later).unwrap();
        // Asked since: kept a while from then.
        rooms.knock(&room, "TE1.x", later + ROOM_FOR - Duration::from_secs(1)).unwrap();
        assert_eq!(rooms.knock(&room, "TE1.x", later + ROOM_FOR), Err(Refused(StatusCode::NOT_FOUND, "no such room")));
    }

    #[test]
    fn a_code_too_long_or_too_many_knocks_or_rooms_are_refused() {
        let mut rooms = Rooms::default();
        let now = Instant::now();
        let (room, secret) = rooms.open(now).unwrap();
        assert_eq!(rooms.knock(&room, &"x".repeat(CODE_LONGEST + 1), now), Err(Refused(StatusCode::PAYLOAD_TOO_LARGE, "that code is too long")));
        assert_eq!(rooms.knock(&room, "", now), Err(Refused(StatusCode::BAD_REQUEST, "no code")));
        rooms.knock(&room, &"x".repeat(CODE_LONGEST), now).unwrap();
        for _ in 1..KNOCKS {
            rooms.knock(&room, "TE1.x", now).unwrap();
        }
        assert_eq!(rooms.knock(&room, "TE1.x", now), Err(Refused(StatusCode::TOO_MANY_REQUESTS, "too many knocks waiting")));
        // Taken, there is room for more - up to the room's knocks in all.
        let mut issued = KNOCKS;
        while issued < ISSUED {
            rooms.knocks(&room, &secret, now).unwrap();
            for _ in 0..(ISSUED - issued).min(KNOCKS) {
                rooms.knock(&room, "TE1.x", now).unwrap();
                issued += 1;
            }
        }
        rooms.knocks(&room, &secret, now).unwrap();
        assert_eq!(rooms.knock(&room, "TE1.x", now), Err(Refused(StatusCode::TOO_MANY_REQUESTS, "too many knocks at this room")));
        let mut full = Rooms::default();
        for _ in 0..ROOMS {
            full.open(now).unwrap();
        }
        assert_eq!(full.open(now).err(), Some(Refused(StatusCode::SERVICE_UNAVAILABLE, "too many rooms open")));
        // Gone, their places are free again.
        assert!(full.open(now + ROOM_FOR).is_ok());
    }
}
