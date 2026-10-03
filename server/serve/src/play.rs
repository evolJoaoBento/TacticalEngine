//! The games, on the server (`docs/SERVER.md`, phase 3, slice 3c).
//!
//! A signed-in player plays one game at a time, at `/__play`: a websocket, opened only with the session
//! cookie the accounts gave them and from the page's own origin. Each game is a thread of its own - the
//! engine's `Session` and QuickJS are not `Send`, and a game is played one intent after another anyway -
//! asked over a channel and answering on a oneshot the socket waits on. The game answers through the same
//! face as the engine built to WebAssembly in the page (`engine::game::face`), so the server and the page
//! play the same intents through the same dispatcher.
//!
//! Messages are JSON, each with an `id` the answer carries back:
//!
//! - `{ id, op: "open", project, shipped, table: { animated, askDefender }, rng? }` - a game stood up, the seed
//!   the server's own: `{ id, ok: { seed, board } }`. A server started for the tests (`--dice-from-page`) sets
//!   its game's dice where the page's are (`rng`), so a suite written against the page's own seeds rolls what
//!   it was written for; any other ignores it;
//! - `{ id, op: "call", call, args }` - an intent: `{ id, ok: { answer, board } }`;
//! - `{ id, op: "ask", ask, ... }` - what the pointer asks: `{ id, ok: <answer> }`;
//! - `{ id, op: "save", slot?, name, where, project? }` - the game saved by itself into the account's own
//!   folder (`saves.rs`): its own text, in the slot named or a fresh one, `{ id, ok: { slot, text } }`, or why
//!   it may not be saved now;
//! - `{ id, op: "restore", replica }` - told how the game stands, the page's being the one the server's is
//!   held to while it is brought into step: `{ id, ok: { board } }`;
//! - `{ id, op: "resume" }` - the game kept since the socket last closed, and the id of the project it was
//!   opened over: `{ id, ok: { board, project } }`;
//!
//! and `{ id, error }` for anything refused. A game outlives its socket for a while (`KEPT_FOR`), so a page
//! that lost its connection comes back to it; past that it goes. The content a game is played over still
//! comes from the page (`shipped`), which in single play is the player's own; the server's own copy of it is
//! for later.

use crate::accounts::{account_of, host_of, now_ms, read_accounts, read_sessions};
use crate::saves::{is_slot_id, mint_id, write_save, Slot};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use engine::game::face;
use engine::game::session::{HooksFor, Session};
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use hooks::QuickJsHooks;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::oneshot;

pub const PLAY_URL: &str = "/__play";

/// How long a game is kept after its socket closes, for the page to come back to it.
pub const KEPT_FOR: Duration = Duration::from_secs(10 * 60);

/// One message for a game, and where its answer goes.
struct Job {
    message: Value,
    answer: oneshot::Sender<Value>,
}

/// A game being played: the way into its thread, since when nobody has been at it, and its project's id.
struct Table {
    door: mpsc::Sender<Job>,
    left: Option<Instant>,
    project: Value,
}

/// Every game on the server, one per account.
#[derive(Clone)]
pub struct Tables {
    root: PathBuf,
    games: Arc<Mutex<HashMap<String, Table>>>,
    /// How long a game is kept after its socket closes.
    kept_for: Duration,
    /// The tests' server: a game opened with its dice where the page's are (`--dice-from-page`).
    dice_from_page: bool,
}

/// A project's code run in QuickJS, compiled once for each body of code a game is built with.
fn hooks_for() -> HooksFor {
    let last: RefCell<Option<(String, Rc<dyn Hooks>)>> = RefCell::new(None);
    Rc::new(move |code: &[CodeSource]| -> Rc<dyn Hooks> {
        if code.is_empty() {
            return Rc::new(NoHooks);
        }
        let signature = code.iter().map(|c| format!("{}\u{0}{}", c.id, c.source)).collect::<Vec<_>>().join("\u{1}");
        if let Some((seen, hooks)) = last.borrow().as_ref() {
            if *seen == signature {
                return Rc::clone(hooks);
            }
        }
        let (hooks, _) = QuickJsHooks::compile(code);
        let hooks: Rc<dyn Hooks> = Rc::new(hooks);
        *last.borrow_mut() = Some((signature, Rc::clone(&hooks)));
        hooks
    })
}

/// A seed of the server's own, for a game's dice.
fn fresh_seed() -> String {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).expect("the system's randomness");
    hex::encode(bytes)
}

/// A game's thread: messages answered, one after another, until the way in is dropped.
fn play_thread() -> mpsc::Sender<Job> {
    let (door, jobs) = mpsc::channel::<Job>();
    std::thread::spawn(move || {
        let mut slot: Option<Session> = None;
        let hooks = hooks_for();
        while let Ok(job) = jobs.recv() {
            let said = match answer(&mut slot, &job.message, &hooks) {
                Ok(ok) => json!({ "ok": ok }),
                Err(why) => json!({ "error": why }),
            };
            let _ = job.answer.send(said);
        }
    });
    door
}

/// One message, answered by the game in `slot`.
fn answer(slot: &mut Option<Session>, message: &Value, hooks: &HooksFor) -> Result<Value, String> {
    let board = |slot: &mut Option<Session>| slot.as_mut().map_or(Value::Null, |s| s.board());
    match message["op"].as_str() {
        Some("open") => {
            let seed = fresh_seed();
            let table = &message["table"];
            let build = json!({ "op": "build", "project": message["project"], "shipped": message["shipped"], "seed": seed, "animated": table["animated"], "askDefender": table["askDefender"] });
            face::respond(slot, &build, Rc::clone(hooks))?;
            if message["rng"].is_number() {
                face::respond(slot, &json!({ "op": "call", "call": "restoreRng", "args": [message["rng"]] }), Rc::clone(hooks))?;
            }
            Ok(json!({ "seed": seed, "board": board(slot) }))
        }
        Some("call") => {
            let said = face::respond(slot, &json!({ "op": "call", "call": message["call"], "args": message["args"] }), Rc::clone(hooks))?;
            Ok(json!({ "answer": said, "board": board(slot) }))
        }
        Some("ask") => face::respond(slot, message, Rc::clone(hooks)),
        Some("save") => {
            let session = slot.as_ref().ok_or("no game: open one")?;
            if let Some(why) = session.save_blocked_by() {
                return Err(why.into());
            }
            Ok(json!({ "text": session.serialise_save().ok_or("nothing to save")? }))
        }
        Some("restore") => {
            face::respond(slot, &json!({ "op": "restore", "replica": message["replica"] }), Rc::clone(hooks))?;
            Ok(json!({ "board": board(slot) }))
        }
        Some("resume") => match slot {
            Some(session) => Ok(json!({ "board": session.board() })),
            None => Err("no game to resume".into()),
        },
        Some(other) => Err(format!("no op \"{other}\"")),
        None => Err("no op".into()),
    }
}

impl Tables {
    pub fn new(root: PathBuf) -> Tables {
        Tables::keeping(root, KEPT_FOR)
    }

    /// Tables whose games are kept for `kept_for` after their socket closes.
    pub fn keeping(root: PathBuf, kept_for: Duration) -> Tables {
        Tables { root, games: Arc::new(Mutex::new(HashMap::new())), kept_for, dice_from_page: false }
    }

    /// The tests' tables: each game opened with its dice where the page's are, not at the server's own seed.
    pub fn with_dice_from_page(self) -> Tables {
        Tables { dice_from_page: true, ..self }
    }

    /// Games left longer than they are kept, gone: their threads end when the way in is dropped.
    fn sweep(&self) {
        let mut games = self.games.lock().expect("the tables");
        games.retain(|_, table| table.left.is_none_or(|left| left.elapsed() < self.kept_for));
    }

    /// A message from an account, answered by its game - a new one for `open`.
    pub async fn ask(&self, account: &str, mut message: Value) -> Value {
        let id = message["id"].clone();
        // The page's dice are taken only by the tests' server.
        if !self.dice_from_page && message["op"] == "open" {
            message["rng"] = Value::Null;
        }
        let message_op = message["op"].as_str().unwrap_or("").to_string();
        let asked = if message_op == "save" { message.clone() } else { Value::Null };
        let mut project = Value::Null;
        let door = {
            let mut games = self.games.lock().expect("the tables");
            if message["op"] == "open" {
                let door = play_thread();
                games.insert(account.to_string(), Table { door: door.clone(), left: None, project: message["project"]["id"].clone() });
                Some(door)
            } else {
                games.get_mut(account).map(|table| {
                    table.left = None;
                    project = table.project.clone();
                    table.door.clone()
                })
            }
        };
        let Some(door) = door else { return json!({ "id": id, "error": "no game: open one" }) };
        let (answer, answered) = oneshot::channel();
        if door.send(Job { message, answer }).is_err() {
            return json!({ "id": id, "error": "the game has ended" });
        }
        let mut said = answered.await.unwrap_or_else(|_| json!({ "error": "the game has ended" }));
        if message_op == "save" {
            said = self.saved(account, &asked, said);
        }
        if message_op == "resume" && said["ok"].is_object() {
            said["ok"]["project"] = project;
        }
        said["id"] = id;
        said
    }

    /// The text a game saved, written into the account's slot: the slot named, or a fresh one.
    fn saved(&self, account: &str, asked: &Value, said: Value) -> Value {
        let Some(text) = said["ok"]["text"].as_str() else { return said };
        let id = match asked["slot"].as_str() {
            Some(id) if is_slot_id(id) => id.to_string(),
            Some(_) => return json!({ "error": "not a slot" }),
            None => mint_id(now_ms()),
        };
        let slot = Slot {
            id,
            name: asked["name"].as_str().unwrap_or("Save").to_string(),
            saved_at: now_ms(),
            place: asked["where"].as_str().unwrap_or("").to_string(),
            project: asked["project"].as_str().map(str::to_string),
        };
        match write_save(&self.root, account, slot.clone(), text) {
            Ok(()) => json!({ "ok": { "slot": slot, "text": text } }),
            Err(why) => json!({ "error": format!("the save could not be written: {why}") }),
        }
    }

    /// The account's socket closed: its game is kept for a while, and goes after.
    pub fn left(&self, account: &str) {
        if let Some(table) = self.games.lock().expect("the tables").get_mut(account) {
            table.left = Some(Instant::now());
        }
        self.sweep();
    }

    /// Whether an account has a game kept.
    pub fn has_game(&self, account: &str) -> bool {
        self.games.lock().expect("the tables").contains_key(account)
    }
}

/// Who may play: a session cookie the accounts know, from the page's own origin.
fn player(tables: &Tables, headers: &HeaderMap) -> Result<String, (StatusCode, &'static str)> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    match (header("origin"), header("host")) {
        (Some(origin), Some(host)) if host_of(&origin).as_deref() == Some(host.as_str()) => {}
        _ => return Err((StatusCode::FORBIDDEN, "not from the page")),
    }
    let now = now_ms();
    let accounts = read_accounts(&tables.root);
    let sessions = read_sessions(&tables.root, now);
    let cookie = header("cookie");
    account_of(cookie.as_deref(), &sessions, &accounts, now).map(|account| account.id.clone()).ok_or((StatusCode::UNAUTHORIZED, "not signed in"))
}

async fn handle(State(tables): State<Tables>, headers: HeaderMap, upgrade: WebSocketUpgrade) -> Response {
    match player(&tables, &headers) {
        Err(refused) => refused.into_response(),
        Ok(account) => upgrade.on_upgrade(move |socket| play(socket, tables, account)),
    }
}

/// A socket's life: each message answered by the account's game, until it closes.
async fn play(mut socket: WebSocket, tables: Tables, account: String) {
    while let Some(Ok(message)) = socket.recv().await {
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let said = match serde_json::from_str::<Value>(&text) {
            Ok(message) => tables.ask(&account, message).await,
            Err(e) => json!({ "id": null, "error": format!("not a message: {e}") }),
        };
        if socket.send(Message::Text(said.to_string().into())).await.is_err() {
            break;
        }
    }
    tables.left(&account);
}

/// The play route, keeping its games under `root`'s accounts.
pub fn router(root: PathBuf) -> Router {
    router_for(Tables::new(root))
}

/// The play route over tables made as they are wanted - the tests' (`Tables::with_dice_from_page`).
pub fn router_for(tables: Tables) -> Router {
    Router::new().route(PLAY_URL, get(handle)).with_state(tables)
}
