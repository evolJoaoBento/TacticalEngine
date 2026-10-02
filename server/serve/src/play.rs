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
//! - `{ id, op: "open", project, shipped, table: { animated, askDefender } }` - a game stood up, the seed the
//!   server's own: `{ id, ok: { seed, board } }`;
//! - `{ id, op: "call", call, args }` - an intent: `{ id, ok: { answer, board } }`;
//! - `{ id, op: "ask", ask, ... }` - what the pointer asks: `{ id, ok: <answer> }`;
//! - `{ id, op: "restore", replica }` - told how the game stands, the page's being the one the server's is
//!   held to while it is brought into step: `{ id, ok: { board } }`;
//! - `{ id, op: "resume" }` - the game kept since the socket last closed: `{ id, ok: { board } }`;
//!
//! and `{ id, error }` for anything refused. A game outlives its socket for a while (`KEPT_FOR`), so a page
//! that lost its connection comes back to it; past that it goes. The content a game is played over still
//! comes from the page (`shipped`), which in single play is the player's own; the server's own copy of it is
//! for later.

use crate::accounts::{account_of, host_of, now_ms, read_accounts, read_sessions};
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

/// A game being played: the way into its thread, and since when nobody has been at it.
struct Table {
    door: mpsc::Sender<Job>,
    left: Option<Instant>,
}

/// Every game on the server, one per account.
#[derive(Clone)]
pub struct Tables {
    root: PathBuf,
    games: Arc<Mutex<HashMap<String, Table>>>,
    /// How long a game is kept after its socket closes.
    kept_for: Duration,
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
            Ok(json!({ "seed": seed, "board": board(slot) }))
        }
        Some("call") => {
            let said = face::respond(slot, &json!({ "op": "call", "call": message["call"], "args": message["args"] }), Rc::clone(hooks))?;
            Ok(json!({ "answer": said, "board": board(slot) }))
        }
        Some("ask") => face::respond(slot, message, Rc::clone(hooks)),
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
        Tables { root, games: Arc::new(Mutex::new(HashMap::new())), kept_for }
    }

    /// Games left longer than they are kept, gone: their threads end when the way in is dropped.
    fn sweep(&self) {
        let mut games = self.games.lock().expect("the tables");
        games.retain(|_, table| table.left.is_none_or(|left| left.elapsed() < self.kept_for));
    }

    /// A message from an account, answered by its game - a new one for `open`.
    pub async fn ask(&self, account: &str, message: Value) -> Value {
        let id = message["id"].clone();
        let door = {
            let mut games = self.games.lock().expect("the tables");
            if message["op"] == "open" {
                let door = play_thread();
                games.insert(account.to_string(), Table { door: door.clone(), left: None });
                Some(door)
            } else {
                games.get_mut(account).map(|table| {
                    table.left = None;
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
        said["id"] = id;
        said
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
    Router::new().route(PLAY_URL, get(handle)).with_state(Tables::new(root))
}
