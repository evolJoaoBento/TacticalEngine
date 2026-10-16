//! The games, on the server (`docs/SERVER.md`, phase 3, slice 3c; phase 5, slices 1, 3, 4 and 5).
//!
//! A signed-in player plays at `/__play`: a websocket, opened only with the session cookie the accounts gave
//! them and from the page's own origin. A game is **shared** (phase 5, slice 3): it has an id of its own, the
//! player who opened it is its host, and others join it with its invitation; each player is at one game at a
//! time. Each game is a thread of its own - the engine's `Session` and QuickJS are not `Send`, and a game is
//! played one intent after another anyway - asked over a channel. The game answers through the same face as
//! the engine built to WebAssembly in the page (`engine::game::face`), so the server and the page play the same
//! intents through the same dispatcher.
//!
//! Messages are JSON, each with an `id` the answer carries back:
//!
//! - `{ id, op: "open", project, shipped, table: { animated, askDefender }, rng?, lobby? }` - a game stood up, its
//!   host the one who opened it, the seed the server's own: `{ id, ok: { seed, board, game, invite, table } }`. A
//!   server started for the tests (`--for-tests`) sets its game's dice where the page's are (`rng`), so a suite
//!   written against the page's own seeds rolls what it was written for; any other ignores it. Opened as a
//!   `lobby`, it is not started: the players gather and take their seats first (slice 5);
//! - `{ id, op: "join", invite }` - the game that invitation is to, joined: `{ id, ok: { board, project, table, you } }`,
//!   `you` the account the page is signed in as, as an opened or resumed game says it too;
//! - `{ id, op: "call", call, args }` - an intent: `{ id, ok: { answer, board, views, seq } }`, `views` what it gave
//!   the pages to draw (`{ motions, floaters, rolls }`), taken off the game's queues as it is played. Never one
//!   that tells the game how the page's stands (`NEVER_TOLD`), and the test driver's hands (`TEST_HANDS`) only on
//!   a server started for the tests;
//! - `{ id, op: "load", slot }` - the account's save in that slot (`saves.rs`) loaded, as `loadGameText` loads
//!   one: as a `call`. The text is the server's own, never one the page sends; the host's alone at a game others
//!   have joined. Who played whom when it was saved (the slot's `seats`) is the game's again: each player at it
//!   now seated in their own, and the others' kept for them, seated as they join (`kept`), every page told;
//! - `{ id, op: "seat", character, account }` - who plays a character (`null`: nobody), the host's to say, and a
//!   member of the game: `{ id, ok: { table } }`. Before the game has started, anybody at it takes a seat nobody
//!   has, or leaves their own;
//! - `{ id, op: "start" }` - a game opened as a lobby started, the host's to say: `{ id, ok: { table } }`. Until
//!   then nobody plays anybody (`engine::game::seats`), though the host may load a save;
//! - `{ id, op: "ask", ask, ... }` - what the pointer asks: `{ id, ok: <answer> }`;
//! - `{ id, op: "save", slot?, name, where, project? }` - the game saved by itself into the account's own
//!   folder (`saves.rs`): its own text, in the slot named or a fresh one, `{ id, ok: { slot, text } }`, or why
//!   it may not be saved now. Only the host saves a shared game, and the save is everybody's who played it: the same
//!   slot written into each one's folder, with who played (`players`) and the project beside it (`saves.rs`). The
//!   slot keeps who plays whom (`seats`), the seats kept for players not back yet among them;
//! - `{ id, op: "resume" }` - the game the account is at, kept since its socket last closed:
//!   `{ id, ok: { board, project, table } }`;
//!
//! and `{ id, error }` for anything refused. Without an `id`, what the server **pushes** to every other page at
//! the game: `{ push: { board, views, by, seq } }` after an intent that changed the board or gave something to draw,
//! and `{ table }` when who is at the game, or who plays whom, changes, or it starts. `seq` counts the intents the game has
//! played - in an intent's answer, a push, and the board a page is stood at when it opens, joins or comes back -
//! so a page holds an answer to what it predicted only when no other page's intent came in between. A connection's answers and pushes leave
//! the game's thread into one queue, so a page is told them in the order the game played them. A table says
//! `{ game, host, invite, members: [{ id, name }], seats: { character: account }, started, kept: { character:
//! { id, name } }, here: [account] }` - `kept` the seats a loaded save gave players not at the game yet, `here` who
//! is at it now (phase 6, who is online): the others told the table whenever somebody's last page there goes, or
//! somebody's page comes back (a page that joins is told it as it joins). And from outside any game, to an account's
//! own connections alone - its pages at a game, and its menu, which opens the socket and sends nothing, to be told:
//! `{ friends: { from } }` when a friend asked, answered, removed or wrote to it (`friends.rs`, `Tables::tell`), or
//! came to a game, left one or came online (`told_around`), or went - its last connection closed a while, none
//! opened since (`gone`, `GONE_AFTER`) - the page asks its friends again at once.
//!
//! Every socket is beaten (`BEAT_EVERY`): a ping, which the browser answers of itself, and `{ beat: <ms> }`, which
//! the page hears - so a proxy or a tunnel in between never finds it idle and shuts it, and either side knows a
//! connection a network has left half open: the server closes a socket it has heard nothing on, not even the answer
//! to a ping, for `SILENT_BEATS` beats, and the page one it has not been beaten on for as long (`play-socket.ts`).
//!
//! A game outlives the last socket at it for a while (`KEPT_FOR`), so a page that lost its connection comes back
//! to it; past that it goes. A guest's page opens over the game's project, read before it is built
//! (`GET /__play/join/<invite>`: `{ project }`, for anybody signed in who holds the invitation).
//!
//! **Anybody opens a game for others** (phase 6, slice 3), and says who may find it (`visibility`): everybody signed
//! in (`public`), the host's friends (`friends`, `friends.rs`), or nobody - only those sent its invitation
//! (`invite`, a game opened the ordinary way). The games a player may join are listed for them (`GET /__play/games`:
//! `{ games: [{ invite, host, project, players, started, visibility, kept }] }`): those they may find, and any that
//! keeps a seat for them (`kept`, the characters' names) whoever may find it - never one they host, nor one nobody is
//! at now (`players`, how many are). The host changes
//! who may find it (`{ id, op: "visibility", visibility }`, `{ id, ok: { table } }`), and the table says it.
//!
//! **Chat at the table** (phase 6, slice 5): anybody at a game says something (`{ id, op: "say", text }`, 1 to
//! `CHAT_LONGEST` characters): `{ id, ok: { line } }`, and every other page told it (`{ chat: line }`), a line being
//! `{ from, name, text, at }`. The game keeps the last `CHAT_KEPT` lines, handed to a page as it opens the game, joins
//! it or comes back to it (`chat`). Nothing said is the game's: it is not saved, and numbers no intent.
//!
//! **The running of a game is handed on** when its host has been gone a while (`HAND_ON_AFTER`; a page reloaded comes
//! back well within it): to the first member, in the order they came, whose page is at the game - checked by the
//! game's thread as it waits for its next message. The host it was is a member when they come back; every page is
//! told the table, and the hand-on is numbered as a change of seats is (`seq`).
//!
//! Each player acts with their own (phase 5, slice 4): before anything of an account's is asked of its game, the
//! game is told whom it plays for (`restoreSeating`, which no page may send) - the account, the host, who plays
//! whom, and whom the account last had selected - and refuses an intent for a character that account does not
//! play, in that intent's own answer, nothing changed (`engine::game::seats`). Each account's selection is its
//! own, kept here between its intents (`Shared::selected`): every board an account is handed - an answer, a push,
//! the game it joins or comes back to - has its own selection on it, and a change of selection alone is pushed to
//! nobody. A question is put to whoever plays the character it is about (the board's `pending.for`), and answered
//! by them alone.
//!
//! The server's game is trusted alone (phase 5, slice 1): once opened it is never told how a page's game stands -
//! a page out of step is stood where the server's board says - and a walk cut short is held to the line the
//! game gave it (`engine::game::landing`). The project and the content a game is played over come from its host's
//! page, once, at `open`; a guest's page is given the project by the server.

use crate::accounts::{account_of, now_ms, page_host, read_accounts, read_sessions, same_origin};
use crate::friends::read_friends;
use crate::saves::{is_slot_id, mint_id, read_save, read_slots, write_project, write_save, Slot};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as Route, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use engine::game::face;
use engine::game::session::{HooksFor, Session};
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use hooks::QuickJsHooks;
use indexmap::IndexMap;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc as queue, oneshot};

pub const PLAY_URL: &str = "/__play";

/// How long a game is kept after the last socket at it closes, for the pages to come back to it.
pub const KEPT_FOR: Duration = Duration::from_secs(10 * 60);

/// How long a host may be gone - their page closed, nothing come back - before the running of their game is handed
/// on to somebody still at it. Long enough for a page reloaded to come back.
pub const HAND_ON_AFTER: Duration = Duration::from_secs(30);

/// How long a player is counted online after their page last asked the server something (`saw`, `presence`): the
/// menu asks for the friends every 10 seconds (`FRIENDS_EVERY`, `friends.ts`).
pub const ONLINE_FOR: Duration = Duration::from_secs(25);

/// How long after an account's last connection closes it is gone - online no more, its friends told - unless one has
/// opened again: long enough for a page going from the menu to a game, or connecting again, to open its own.
pub const GONE_AFTER: Duration = Duration::from_secs(10);

/// How often a socket is beaten - a ping, and `{ beat }` for the page - well inside the minute or so a proxy or a
/// tunnel lets a connection sit idle.
pub const BEAT_EVERY: Duration = Duration::from_secs(20);

/// How many beats a socket may go without anything heard on it before it is closed as gone.
pub const SILENT_BEATS: u32 = 3;

/// How often a game's thread, waiting for a message, looks whether its host is gone.
const TICK: Duration = Duration::from_millis(500);

/// The most a line said at the table may be, in characters; and how many lines a game keeps for a page that comes.
const CHAT_LONGEST: usize = 500;
const CHAT_KEPT: usize = 100;

/// Who may find a game in the list of games to join: everybody, the host's friends, or nobody (its invitation alone).
const VISIBILITIES: [&str; 3] = ["public", "friends", "invite"];

/// The intents that tell a game how another stands - its dice, its walk, its log, its views' queues - which the
/// page's own engine is told after the editor's changes, and the server's game never is. And a save's text,
/// which the server loads from the account's own folder (`load`).
pub const NEVER_TOLD: &[&str] = &["restoreRng", "restoreWalk", "restoreLog", "restoreViews", "restoreWalked", "restoreAside", "restoreSeating", "loadGameText"];

/// The test driver's hands (`window.__engine`): somebody put somewhere, wounded, handed a card or a level, a
/// fight started or a room entered by fiat. Only a server started for the tests (`--for-tests`) takes them.
pub const TEST_HANDS: &[&str] = &["placeAt", "setGood", "wound", "markStress", "setCondition", "giveItem", "grantLevel", "setCards", "startEncounter", "travelTo"];

/// What the game holds for the pages to draw, taken off its queues after every intent and handed on
/// (`views`): the walks, the numbers over heads, the dice.
const VIEWS: [(&str, &str); 3] = [("motions", "takeMotions"), ("floaters", "takeFloaters"), ("rolls", "takeRolls")];

/// The intents a page sends as it draws itself - a container or a thing looked at, the conversations put where their
/// talkers' players' selections say. A page sends one only when it marked the page's game (`client.ts`, `did`):
/// numbered, each page's drawings stood the other where the game was, which drew again - some twenty round trips a
/// second. The bar's read of the cards (`abilityList`) leaves no mark, and is never sent.
pub const DRAWN: &[&str] = &["readContainer", "readThing", "syncTalks"];

/// The drawings whose marks are the drawing page's (`DRAWN`): played and numbered, never pushed - what they changed
/// reaches the others with the next intent that is. A conversation set aside or brought back is pushed: whether one
/// is on screen is whether everybody else waits on it (`engine::game::play`, `sync_talks`), and only its talker's
/// player moves it, so no other page's drawing answers back.
pub const UNTOLD: &[&str] = &["readContainer", "readThing"];

/// A connection: one socket, its answers and the pushes it is given leaving through one queue.
pub type Conn = u64;

/// Where an answer goes: back to a caller waiting on it (`ask`), or into a connection's queue (`ask_on`).
enum Reply {
    Once(oneshot::Sender<Value>),
    To(Conn, queue::UnboundedSender<Value>),
}

impl Reply {
    fn send(self, said: Value) {
        match self {
            Reply::Once(answer) => {
                let _ = answer.send(said);
            }
            Reply::To(_, to) => {
                let _ = to.send(said);
            }
        }
    }

    fn conn(&self) -> Option<Conn> {
        match self {
            Reply::Once(_) => None,
            Reply::To(conn, _) => Some(*conn),
        }
    }
}

/// One message for a game, from whom, and where its answer goes.
struct Job {
    message: Value,
    account: String,
    reply: Reply,
}

/// What everybody at a game shares beside its thread: who opened it, who is at it, who plays whom.
struct Shared {
    id: String,
    host: String,
    invite: String,
    /// The id of the project it was opened over, and the project itself, for a guest's page to open over.
    project: Value,
    document: Value,
    members: Vec<String>,
    seats: IndexMap<String, String>,
    /// Whom each account last had selected: its own, the game holding one at a time (`engine::game::seats`).
    selected: HashMap<String, Value>,
    /// The sockets at it now, and whose.
    watching: Vec<(Conn, String, queue::UnboundedSender<Value>)>,
    /// Since when nobody has been at it.
    left: Option<Instant>,
    /// Whether it is played yet: a game opened as a lobby is not, until its host starts it.
    started: bool,
    /// The seats a loaded save gave players not at the game yet, each theirs as they join, nobody else's to take.
    kept: IndexMap<String, String>,
    /// The board last handed on, so an intent that changed nothing pushes nothing.
    seen: String,
    /// Who may find it in the list of games to join (`VISIBILITIES`).
    visibility: String,
    /// Since when the host's page has not been at it, and how long that may go on before the running of it is
    /// handed on.
    host_gone: Option<Instant>,
    hand_on_after: Duration,
    /// The last lines said at the table, oldest first.
    chat: Vec<Value>,
}

/// A socket's connection as the tables know it: its queue, whose it is, and the game it is at, if any.
#[derive(Clone)]
struct Connection {
    to: queue::UnboundedSender<Value>,
    account: String,
    game: Option<String>,
}

/// A game being played: the way into its thread, and what is shared about it.
struct Game {
    door: mpsc::Sender<Job>,
    shared: Arc<Mutex<Shared>>,
}

#[derive(Default)]
struct Inner {
    games: HashMap<String, Game>,
    /// The game each account is at.
    at: HashMap<String, String>,
    /// Each connection: its queue, whose it is, and the game it watches - none for a menu's, which listens alone.
    conns: HashMap<Conn, Connection>,
    next: Conn,
    /// When each account's page last asked the server something outside a game (`saw`).
    seen: HashMap<String, Instant>,
}

/// Every game on the server.
#[derive(Clone)]
pub struct Tables {
    root: PathBuf,
    inner: Arc<Mutex<Inner>>,
    /// How long a game is kept after the last socket at it closes.
    kept_for: Duration,
    /// The tests' server (`--for-tests`): a game opened with its dice where the page's are, and the test driver's
    /// hands taken.
    for_tests: bool,
    /// How long a host may be gone before their game is handed on.
    hand_on_after: Duration,
    /// How long an account is online after it was last seen.
    online_for: Duration,
    /// How often each socket is beaten.
    beat_every: Duration,
    /// How long after an account's last connection closes it is gone.
    gone_after: Duration,
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

/// Random hex of the system's own: a seed for a game's dice, a game's id, an invitation.
fn fresh_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the system's randomness");
    hex::encode(buffer)
}

/// What an account is to its friends now (`Tables::presence`): `playing` with a page at a game, else `online` seen
/// within `online_for`, else nothing.
fn presence_in(inner: &Inner, account: &str, online_for: Duration) -> Option<&'static str> {
    if inner.games.values().any(|game| game.shared.lock().expect("the game").watching.iter().any(|(_, who, _)| who == account)) {
        Some("playing")
    } else if inner.seen.get(account).is_some_and(|seen| seen.elapsed() < online_for) {
        Some("online")
    } else {
        None
    }
}

/// Who is at a game now, each once, by id.
fn here(shared: &Shared) -> Vec<String> {
    let mut here: Vec<String> = shared.watching.iter().map(|(_, who, _)| who.clone()).collect();
    here.sort_unstable();
    here.dedup();
    here
}

/// Who is at a game and who plays whom, as the pages are told it: the members by name, as the accounts know them.
fn table_of(shared: &Shared, root: &Path) -> Value {
    let accounts = read_accounts(root);
    let name = |id: &str| accounts.iter().find(|account| account.id == id).map_or_else(|| id.to_string(), |account| account.name.clone());
    json!({
        "game": shared.id,
        "host": shared.host,
        "invite": shared.invite,
        "members": shared.members.iter().map(|id| json!({ "id": id, "name": name(id) })).collect::<Vec<_>>(),
        "seats": shared.seats,
        "started": shared.started,
        "visibility": shared.visibility,
        "kept": shared.kept.iter().map(|(character, id)| (character.clone(), json!({ "id": id, "name": name(id) }))).collect::<serde_json::Map<_, _>>(),
        "here": here(shared),
    })
}

/// Something handed on to every page at the game but the one whose message it answers: a board with each
/// page's own selection on it.
fn push(shared: &Shared, except: Option<Conn>, message: &Value) {
    for (conn, account, to) in &shared.watching {
        if Some(*conn) != except {
            let mut message = message.clone();
            // Read, not indexed: indexing a message that has no push writes `"push": null` into it.
            if let (Some(board), Some(chosen)) = (message.get_mut("push").and_then(|pushed| pushed.get_mut("board")), shared.selected.get(account)) {
                board["replica"]["party"]["selected"] = chosen.clone();
            }
            let _ = to.send(message);
        }
    }
}

/// A board as it is compared with the last one handed on: whoever is selected is each page's own.
fn unselected(board: &Value) -> String {
    let mut board = board.clone();
    if let Some(party) = board["replica"].get_mut("party") {
        party["selected"] = Value::Null;
    }
    board.to_string()
}

/// The game told whom it plays for, before it is asked anything of an account's (`restoreSeating`): the account,
/// the host, who plays whom, and whom the account last had selected - so it refuses what that account does not
/// play, and acts through the account's own selection.
fn play_for(slot: &mut Option<Session>, shared: &Arc<Mutex<Shared>>, account: &str, hooks: &HooksFor) {
    if slot.is_none() {
        return;
    }
    let seating = {
        let held = shared.lock().expect("the game");
        let mut seating = json!({ "you": account, "host": held.host, "seats": held.seats, "started": held.started });
        if let Some(chosen) = held.selected.get(account) {
            seating["selected"] = chosen.clone();
        }
        seating
    };
    let _ = face::respond(slot, &json!({ "op": "call", "call": "restoreSeating", "args": [seating] }), Rc::clone(hooks));
}

/// A game's thread: messages answered, one after another, until the way in is dropped; each answer, and what
/// it hands on to the other pages, leaving here in the order the game played them.
fn play_thread(shared: Arc<Mutex<Shared>>, root: PathBuf) -> mpsc::Sender<Job> {
    let (door, jobs) = mpsc::channel::<Job>();
    std::thread::spawn(move || {
        let mut slot: Option<Session> = None;
        let hooks = hooks_for();
        // How many intents the game has played: a page holds an answer to its prediction only when none of another
        // page's came in between since the board it predicted on (`seq`).
        let mut played: u64 = 0;
        loop {
            let job = match jobs.recv_timeout(TICK) {
                Ok(job) => job,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                // Nothing asked: whether the host is gone long enough for the game to be handed on - numbered, and
                // everybody's selection kept among their own, as a change of seats is; every page told.
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if hand_on(&shared) {
                        played += 1;
                        let members = shared.lock().expect("the game").members.clone();
                        for member in members {
                            play_for(&mut slot, &shared, &member, &hooks);
                            let chosen = slot.as_ref().map_or(Value::Null, |session| json!(session.party.selected()));
                            shared.lock().expect("the game").selected.insert(member, chosen);
                        }
                        let held = shared.lock().expect("the game");
                        push(&held, None, &json!({ "table": table_of(&held, &root) }));
                    }
                    continue;
                }
            };
            let op = job.message["op"].as_str().unwrap_or("").to_string();
            if !matches!(op.as_str(), "open" | "seat" | "start" | "visibility" | "say") {
                play_for(&mut slot, &shared, &job.account, &hooks);
            }
            let mut said = match op.as_str() {
                "seat" => seat(&shared, &job.account, &job.message, &root),
                "start" => start(&shared, &job.account, &root),
                "visibility" => visibility(&shared, &job.account, &job.message, &root),
                "say" => say(&shared, &job.account, &job.message, &root),
                // A page that joined, or came back: where the game is, as for one resumed.
                "join" => respond(&mut slot, &json!({ "op": "resume" }), &hooks),
                _ => respond(&mut slot, &job.message, &hooks),
            };
            if op == "call" && said["ok"].is_object() {
                played += 1;
            }
            // Opened, the game told whom it plays for at once: in a lobby, nobody yet.
            if op == "open" && said["ok"].is_object() {
                play_for(&mut slot, &shared, &job.account, &hooks);
                said["ok"]["board"] = slot.as_mut().map_or(Value::Null, |session| session.board());
            }
            if matches!(op.as_str(), "call" | "open" | "join" | "resume") && said["ok"].is_object() {
                said["ok"]["seq"] = json!(played);
                // Whom the account has selected now, kept for its next intent and the boards it is pushed.
                let chosen = said["ok"]["board"]["replica"]["party"]["selected"].clone();
                shared.lock().expect("the game").selected.insert(job.account.clone(), chosen);
            }
            match op.as_str() {
                "save" => {
                    let held = shared.lock().expect("the game");
                    let mut seats = held.kept.clone();
                    seats.extend(held.seats.clone());
                    // Everybody who played it: whoever came to it, and whoever a seat is kept for.
                    let mut players = held.members.clone();
                    for account in seats.values() {
                        if !players.contains(account) {
                            players.push(account.clone());
                        }
                    }
                    let project = held.document.clone();
                    drop(held);
                    said = saved(&root, &job.account, &job.message, said, seats, players, &project);
                    // Numbered as the game stood when it was saved: another page's intent played since the saver's
                    // last answer - a drawing one too, never pushed (`UNTOLD`) - is no parting of the saver's page.
                    if said["ok"].is_object() {
                        said["ok"]["seq"] = json!(played);
                    }
                }
                "open" | "join" | "resume" if said["ok"].is_object() => {
                    let held = shared.lock().expect("the game");
                    said["ok"]["project"] = held.project.clone();
                    said["ok"]["table"] = table_of(&held, &root);
                    said["ok"]["you"] = json!(job.account);
                    said["ok"]["chat"] = json!(held.chat);
                    if op == "open" {
                        said["ok"]["game"] = json!(held.id);
                        said["ok"]["invite"] = json!(held.invite);
                    }
                }
                _ => {}
            }
            said["id"] = job.message["id"].clone();
            let from = job.reply.conn();
            job.reply.send(said.clone());
            // A save loaded with who played whom: theirs again for the players at the game, kept for the others.
            let reseated = op == "call" && said["ok"].is_object() && job.message["keep"].is_object() && keep(&shared, &job.message["keep"]);
            // Who plays whom changed, or the game started: each account's selection kept among its own, as it is pushed.
            if (reseated || matches!(op.as_str(), "seat" | "start")) && said["ok"].is_object() {
                // Numbered as an intent is: what any account's game answers from here may differ from what a page
                // predicted before it heard, which is no parting (`seq`).
                played += 1;
                let members = shared.lock().expect("the game").members.clone();
                for member in members {
                    play_for(&mut slot, &shared, &member, &hooks);
                    let chosen = slot.as_ref().map_or(Value::Null, |session| json!(session.party.selected()));
                    shared.lock().expect("the game").selected.insert(member, chosen);
                }
            }
            // What the others are told: the board an intent left and what it gave them to draw; who is at the game.
            let mut held = shared.lock().expect("the game");
            match op.as_str() {
                "call" | "open" if said["ok"].is_object() && !UNTOLD.contains(&job.message["call"].as_str().unwrap_or("")) => {
                    let board = unselected(&said["ok"]["board"]);
                    let views = &said["ok"]["views"];
                    let drawn = VIEWS.iter().any(|(name, _)| views[name].as_array().is_some_and(|queue| !queue.is_empty()));
                    if board != held.seen || drawn {
                        held.seen = board;
                        if op == "call" {
                            push(&held, from, &json!({ "push": { "board": said["ok"]["board"], "views": views, "by": job.account, "seq": played } }));
                        }
                    }
                }
                "join" | "seat" | "start" | "visibility" if said["ok"].is_object() => push(&held, from, &json!({ "table": table_of(&held, &root) })),
                "say" if said["ok"].is_object() => push(&held, from, &json!({ "chat": said["ok"]["line"] })),
                _ => {}
            }
            // And everybody told who plays whom after the save, the one who loaded it too.
            if reseated {
                push(&held, None, &json!({ "table": table_of(&held, &root) }));
            }
        }
    });
    door
}

/// One message, answered by the game in `slot`, as `{ ok }` or `{ error }`.
fn respond(slot: &mut Option<Session>, message: &Value, hooks: &HooksFor) -> Value {
    match answer(slot, message, hooks) {
        Ok(ok) => json!({ "ok": ok }),
        Err(why) => json!({ "error": why }),
    }
}

/// One message, answered by the game in `slot`.
fn answer(slot: &mut Option<Session>, message: &Value, hooks: &HooksFor) -> Result<Value, String> {
    let board = |slot: &mut Option<Session>| slot.as_mut().map_or(Value::Null, |s| s.board());
    match message["op"].as_str() {
        Some("open") => {
            let seed = fresh_hex(8);
            let table = &message["table"];
            let build = json!({ "op": "build", "project": message["project"], "shipped": message["shipped"], "seed": seed, "animated": table["animated"], "askDefender": table["askDefender"] });
            face::respond(slot, &build, Rc::clone(hooks))?;
            if message["rng"].is_number() {
                face::respond(slot, &json!({ "op": "call", "call": "restoreRng", "args": [message["rng"]] }), Rc::clone(hooks))?;
            }
            Ok(json!({ "seed": seed, "board": board(slot) }))
        }
        Some("call") => {
            let call = message["call"].as_str().unwrap_or("");
            let said = face::respond(slot, &json!({ "op": "call", "call": call, "args": message["args"] }), Rc::clone(hooks))?;
            // What it gave the pages to draw, taken off the game's queues - the walks through `takeMotions`, which
            // keeps the line each walker was given (`landing.rs`) - and handed on with its answer.
            let mut views = json!({});
            for (name, take) in VIEWS {
                views[name] = if call == take { json!([]) } else { face::respond(slot, &json!({ "op": "call", "call": take, "args": [] }), Rc::clone(hooks))? };
            }
            Ok(json!({ "answer": said, "board": board(slot), "views": views }))
        }
        Some("ask") => face::respond(slot, message, Rc::clone(hooks)),
        Some("save") => {
            let session = slot.as_ref().ok_or("no game: open one")?;
            if let Some(why) = session.save_blocked_by() {
                return Err(why.into());
            }
            Ok(json!({ "text": session.serialise_save().ok_or("nothing to save")? }))
        }
        Some("resume") => match slot {
            Some(session) => Ok(json!({ "board": session.board() })),
            None => Err("no game to resume".into()),
        },
        Some(other) => Err(format!("no op \"{other}\"")),
        None => Err("no op".into()),
    }
}

/// Who plays a character, set by the host: a member of the game, or nobody (`null`). Before the game has started,
/// anybody at it takes a seat nobody has, or leaves their own.
fn seat(shared: &Arc<Mutex<Shared>>, account: &str, message: &Value, root: &Path) -> Value {
    let mut held = shared.lock().expect("the game");
    let Some(character) = message["character"].as_str().filter(|c| !c.is_empty()) else { return json!({ "error": "no character" }) };
    if held.host != account {
        if held.started {
            return json!({ "error": "only the host says who plays whom" });
        }
        let taking = message["account"].as_str() == Some(account) && !held.seats.contains_key(character) && !held.kept.contains_key(character);
        let leaving = message["account"].is_null() && held.seats.get(character).is_some_and(|seated| seated == account);
        if !taking && !leaving {
            return json!({ "error": "only a seat nobody has is yours to take" });
        }
    }
    // The host's word, or a player's own choice, over a seat a save kept.
    held.kept.shift_remove(character);
    match message["account"].as_str() {
        None => {
            held.seats.shift_remove(character);
        }
        Some(who) if held.members.iter().any(|member| member == who) => {
            held.seats.insert(character.to_string(), who.to_string());
        }
        Some(_) => return json!({ "error": "not at this game" }),
    }
    json!({ "ok": { "table": table_of(&held, root) } })
}

/// Who played whom in a save just loaded (`keep`, its slot's seats): each character the save names is theirs again
/// if they are at the game, and kept for them until they join if not. Whether there was anybody to seat.
fn keep(shared: &Arc<Mutex<Shared>>, keep: &Value) -> bool {
    let mut held = shared.lock().expect("the game");
    let Some(keep) = keep.as_object().filter(|keep| !keep.is_empty()) else { return false };
    for (character, account) in keep {
        let Some(account) = account.as_str() else { continue };
        held.seats.shift_remove(character);
        held.kept.shift_remove(character);
        if held.members.iter().any(|member| member == account) {
            held.seats.insert(character.clone(), account.to_string());
        } else {
            held.kept.insert(character.clone(), account.to_string());
        }
    }
    true
}

/// The seats kept for an account, theirs now that it has joined - those nobody has been given since.
fn seat_the_kept(held: &mut Shared, account: &str) {
    let theirs: Vec<String> = held.kept.iter().filter(|(_, kept)| *kept == account).map(|(character, _)| character.clone()).collect();
    for character in theirs {
        held.kept.shift_remove(&character);
        if !held.seats.contains_key(&character) {
            held.seats.insert(character, account.to_string());
        }
    }
}

/// A game opened as a lobby started, by its host: played from now on, by everybody at it.
fn start(shared: &Arc<Mutex<Shared>>, account: &str, root: &Path) -> Value {
    let mut held = shared.lock().expect("the game");
    if held.host != account {
        return json!({ "error": "only the host starts the game" });
    }
    if held.started {
        return json!({ "error": "the game has started" });
    }
    held.started = true;
    json!({ "ok": { "table": table_of(&held, root) } })
}

/// Who may find the game in the list of games to join, as its host says.
fn visibility(shared: &Arc<Mutex<Shared>>, account: &str, message: &Value, root: &Path) -> Value {
    let mut held = shared.lock().expect("the game");
    if held.host != account {
        return json!({ "error": "only the host says who may find the game" });
    }
    let Some(visibility) = message["visibility"].as_str().filter(|v| VISIBILITIES.contains(v)) else {
        return json!({ "error": "public, friends or invite" });
    };
    held.visibility = visibility.to_string();
    json!({ "ok": { "table": table_of(&held, root) } })
}

/// Something said at the table by an account at the game: kept, and the line it made given back.
fn say(shared: &Arc<Mutex<Shared>>, account: &str, message: &Value, root: &Path) -> Value {
    let text = message["text"].as_str().unwrap_or("").trim();
    if text.is_empty() {
        return json!({ "error": "nothing said" });
    }
    if text.chars().count() > CHAT_LONGEST {
        return json!({ "error": format!("a line is {CHAT_LONGEST} characters at most") });
    }
    let name = read_accounts(root).into_iter().find(|known| known.id == account).map_or_else(|| account.to_string(), |known| known.name);
    let line = json!({ "from": account, "name": name, "text": text, "at": now_ms() });
    let mut held = shared.lock().expect("the game");
    held.chat.push(line.clone());
    let over = held.chat.len().saturating_sub(CHAT_KEPT);
    held.chat.drain(..over);
    json!({ "ok": { "line": line } })
}

/// The running of a game handed on, when its host has been gone longer than they may be: to the first member whose
/// page is at it. Whether it was.
fn hand_on(shared: &Arc<Mutex<Shared>>) -> bool {
    let mut held = shared.lock().expect("the game");
    let Some(gone) = held.host_gone else { return false };
    if gone.elapsed() < held.hand_on_after {
        return false;
    }
    // The host is gone, so never among those whose page is at it.
    let next = held.members.iter().find(|member| held.watching.iter().any(|(_, account, _)| account == *member)).cloned();
    let Some(next) = next else { return false };
    held.host = next;
    held.host_gone = None;
    true
}

/// The text a game saved, written into the account's slot - the slot named, or a fresh one - with who plays whom.
/// At a game more than one played, the same slot goes to everybody who played it (`players`), the project it was
/// played over beside it: the game's save, not its host's alone.
fn saved(root: &Path, account: &str, asked: &Value, said: Value, seats: IndexMap<String, String>, players: Vec<String>, project: &Value) -> Value {
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
        seats,
        players: if players.len() > 1 { players } else { Vec::new() },
    };
    if let Err(why) = write_save(root, account, slot.clone(), text) {
        return json!({ "error": format!("the save could not be written: {why}") });
    }
    // Everybody else who played it, given the same slot; and each the project beside it.
    for player in &slot.players {
        if player != account {
            if let Err(why) = write_save(root, player, slot.clone(), text) {
                return json!({ "error": format!("the save could not be written for {player}: {why}") });
            }
        }
        if let Err(why) = write_project(root, player, &slot.id, project) {
            return json!({ "error": format!("the game's project could not be kept with its save: {why}") });
        }
    }
    json!({ "ok": { "slot": slot, "text": text } })
}

impl Tables {
    pub fn new(root: PathBuf) -> Tables {
        Tables::keeping(root, KEPT_FOR)
    }

    /// Tables whose games are kept for `kept_for` after the last socket at them closes.
    pub fn keeping(root: PathBuf, kept_for: Duration) -> Tables {
        Tables { root, inner: Arc::new(Mutex::new(Inner::default())), kept_for, for_tests: false, hand_on_after: HAND_ON_AFTER, online_for: ONLINE_FOR, beat_every: BEAT_EVERY, gone_after: GONE_AFTER }
    }

    /// Tables counting an account online for `online_for` after it was last seen.
    pub fn online_for(self, online_for: Duration) -> Tables {
        Tables { online_for, ..self }
    }

    /// Tables beating each socket every `every`.
    pub fn beating(self, every: Duration) -> Tables {
        Tables { beat_every: every, ..self }
    }

    /// Tables counting an account gone `after` its last connection closes, none opened since.
    pub fn going_after(self, after: Duration) -> Tables {
        Tables { gone_after: after, ..self }
    }

    /// Something for an account's connections, from outside any game (`friends.rs`: a friend asked, answered,
    /// removed or wrote to it; `told_around`): its pages at a game, and its menu listening. Nothing for an account
    /// with none.
    pub fn tell(&self, account: &str, message: &Value) {
        for connection in self.inner.lock().expect("the tables").conns.values() {
            if connection.account == account {
                let _ = connection.to.send(message.clone());
            }
        }
    }

    /// An account's page asked the server something outside a game (`friends.rs`): online a while.
    /// Come online, its friends at a game are told.
    pub fn saw(&self, account: &str) {
        let before = {
            let mut inner = self.inner.lock().expect("the tables");
            let before = presence_in(&inner, account, self.online_for);
            inner.seen.insert(account.to_string(), Instant::now());
            before
        };
        self.told_around(account, before);
    }

    /// An account's friends told at their games (`tell`) if it is around otherwise than it was `before` - come to a
    /// game or gone from one, come online, gone (`gone`). Gone quiet a while (`online_for`) - a page with no socket - is
    /// nothing happening, and told nobody: a friend's page asks again in a while for that.
    fn told_around(&self, account: &str, before: Option<&'static str>) {
        if presence_in(&self.inner.lock().expect("the tables"), account, self.online_for) == before {
            return;
        }
        for friend in read_friends(&self.root).of(account) {
            self.tell(&friend, &json!({ "friends": { "from": account } }));
        }
    }

    /// Who of `accounts` is around now: `playing` with a page at a game (theirs alone too), else `online` seen within
    /// the while; nobody else.
    pub fn presence(&self, accounts: &[String]) -> std::collections::BTreeMap<String, &'static str> {
        let mut inner = self.inner.lock().expect("the tables");
        let online_for = self.online_for;
        inner.seen.retain(|_, seen| seen.elapsed() < online_for);
        accounts.iter().filter_map(|account| presence_in(&inner, account, online_for).map(|presence| (account.clone(), presence))).collect()
    }

    /// Tables whose games are handed on once their host has been gone for `after`.
    pub fn handing_on_after(self, after: Duration) -> Tables {
        Tables { hand_on_after: after, ..self }
    }

    /// The tests' tables: each game opened with its dice where the page's are, not at the server's own seed, and
    /// the test driver's hands taken.
    pub fn for_tests(self) -> Tables {
        Tables { for_tests: true, hand_on_after: Duration::from_secs(3), beat_every: Duration::from_secs(5), gone_after: Duration::from_secs(3), ..self }
    }

    /// Why a message is refused before its game is asked, if it is: an intent that would tell the game how the
    /// page's stands, a test hand on a server not started for the tests, a save the account does not have.
    fn refused(&self, account: &str, message: &mut Value) -> Option<String> {
        match message["op"].as_str() {
            Some("call") => {
                let call = message["call"].as_str().unwrap_or("");
                if NEVER_TOLD.contains(&call) {
                    return Some(format!("\"{call}\" is never told to the server's game"));
                }
                if TEST_HANDS.contains(&call) && !self.for_tests {
                    return Some(format!("\"{call}\" is the tests' alone"));
                }
                None
            }
            Some("load") => {
                let slot = message["slot"].as_str().unwrap_or("");
                let Some(text) = read_save(&self.root, account, slot) else { return Some("no such save".into()) };
                // Who played whom when it was saved, for the game's thread to seat again once it is loaded.
                let seats = read_slots(&self.root, account).into_iter().find(|kept| kept.id == slot).map(|kept| kept.seats).unwrap_or_default();
                *message = json!({ "id": message["id"], "op": "call", "call": "loadGameText", "args": [text], "keep": seats });
                None
            }
            _ => None,
        }
    }

    /// An account's socket's connection: its queue, which its answers and whatever it is told leave through.
    pub fn connect(&self, account: &str) -> (Conn, queue::UnboundedReceiver<Value>) {
        let (to, from) = queue::unbounded_channel();
        let mut inner = self.inner.lock().expect("the tables");
        inner.next += 1;
        let conn = inner.next;
        inner.conns.insert(conn, Connection { to, account: account.to_string(), game: None });
        (conn, from)
    }

    /// A connection now at `game`: no longer at the one it was at, which nobody may be at any more. The others told
    /// the table if the account was not at it - unless `joining`, whose table the game's thread tells them.
    fn watch(inner: &mut Inner, root: &Path, conn: Conn, account: &str, game: &str, joining: bool) {
        let Some(Connection { to, game: was, .. }) = inner.conns.get(&conn).cloned() else { return };
        if was.as_deref() == Some(game) {
            return;
        }
        if let Some(was) = was {
            Tables::unwatch(inner, root, conn, &was);
        }
        if let Some(found) = inner.games.get(game) {
            let mut held = found.shared.lock().expect("the game");
            let came = !held.watching.iter().any(|(_, who, _)| who == account);
            held.watching.push((conn, account.to_string(), to.clone()));
            if came && !joining {
                push(&held, Some(conn), &json!({ "table": table_of(&held, root) }));
            }
            held.left = None;
            if held.host == account {
                held.host_gone = None;
            }
        }
        inner.conns.insert(conn, Connection { to, account: account.to_string(), game: Some(game.to_string()) });
    }

    /// A connection no longer at `game`: the others told the table if it was its account's last there.
    fn unwatch(inner: &mut Inner, root: &Path, conn: Conn, game: &str) {
        if let Some(found) = inner.games.get(game) {
            let mut held = found.shared.lock().expect("the game");
            let before = here(&held);
            held.watching.retain(|(watcher, _, _)| *watcher != conn);
            if here(&held) != before && !held.watching.is_empty() {
                push(&held, None, &json!({ "table": table_of(&held, root) }));
            }
            if held.watching.is_empty() {
                held.left = Some(Instant::now());
            }
            let host = held.host.clone();
            if held.host_gone.is_none() && !held.watching.iter().any(|(_, account, _)| *account == host) {
                held.host_gone = Some(Instant::now());
            }
        }
    }

    /// Games nobody has been at for longer than they are kept, gone: their threads end when the way in is dropped.
    fn sweep(&self, inner: &mut Inner) {
        let kept_for = self.kept_for;
        inner.games.retain(|_, game| game.shared.lock().expect("the game").left.is_none_or(|left| left.elapsed() < kept_for));
        let games = &inner.games;
        inner.at.retain(|_, game| games.contains_key(game));
    }

    /// A message from an account, its answer waited for here: the tests', and any caller with no socket.
    pub async fn ask(&self, account: &str, message: Value) -> Value {
        let (answer, answered) = oneshot::channel();
        self.route(account, message, Reply::Once(answer));
        answered.await.unwrap_or_else(|_| json!({ "error": "the game has ended" }))
    }

    /// A message from an account's connection: its answer goes into the connection's queue.
    pub fn ask_on(&self, conn: Conn, account: &str, message: Value) {
        let Some(to) = self.inner.lock().expect("the tables").conns.get(&conn).map(|connection| connection.to.clone()) else { return };
        self.route(account, message, Reply::To(conn, to));
    }

    /// A message to the game it is for - a new one for `open`, the invitation's for `join`, else the account's own.
    fn route(&self, account: &str, mut message: Value, reply: Reply) {
        let id = message["id"].clone();
        let refuse = |reply: Reply, why: &str| reply.send(json!({ "id": id, "error": why }));
        // The page's dice are taken only by the tests' server.
        if !self.for_tests && message["op"] == "open" {
            message["rng"] = Value::Null;
        }
        let loading = message["op"] == "load";
        if let Some(why) = self.refused(account, &mut message) {
            return refuse(reply, &why);
        }
        let mut inner = self.inner.lock().expect("the tables");
        self.sweep(&mut inner);
        let game = match message["op"].as_str() {
            Some("open") => {
                let game = fresh_hex(8);
                let shared = Arc::new(Mutex::new(Shared {
                    id: game.clone(),
                    host: account.to_string(),
                    invite: fresh_hex(16),
                    project: message["project"]["id"].clone(),
                    document: message["project"].clone(),
                    members: vec![account.to_string()],
                    seats: IndexMap::new(),
                    selected: HashMap::new(),
                    watching: Vec::new(),
                    left: None,
                    seen: String::new(),
                    started: message["lobby"] != true,
                    kept: IndexMap::new(),
                    visibility: message["visibility"].as_str().filter(|v| VISIBILITIES.contains(v)).unwrap_or("invite").to_string(),
                    host_gone: None,
                    hand_on_after: self.hand_on_after,
                    chat: Vec::new(),
                }));
                let door = play_thread(Arc::clone(&shared), self.root.clone());
                inner.games.insert(game.clone(), Game { door, shared });
                game
            }
            Some("join") => {
                let invite = message["invite"].as_str().unwrap_or("");
                let found = inner.games.iter().find(|(_, game)| !invite.is_empty() && game.shared.lock().expect("the game").invite == invite).map(|(id, _)| id.clone());
                let Some(game) = found else { return refuse(reply, "no game for that invitation") };
                let mut held = inner.games[&game].shared.lock().expect("the game");
                if !held.members.iter().any(|member| member == account) {
                    held.members.push(account.to_string());
                }
                seat_the_kept(&mut held, account);
                game
            }
            _ => match inner.at.get(account) {
                Some(game) if inner.games.contains_key(game) => game.clone(),
                _ => return refuse(reply, "no game: open one"),
            },
        };
        // Loading a save puts every page at the game somewhere else: the host's to do. A shared game's saves are its
        // host's.
        let hosting = inner.games[&game].shared.lock().expect("the game").host == account;
        if loading && !hosting {
            return refuse(reply, "only the host loads a save into a game others are at");
        }
        if message["op"] == "save" && !hosting {
            return refuse(reply, "the host keeps this game's saves");
        }
        inner.at.insert(account.to_string(), game.clone());
        let before = presence_in(&inner, account, self.online_for);
        if let Some(conn) = reply.conn() {
            Tables::watch(&mut inner, &self.root, conn, account, &game, matches!(message["op"].as_str(), Some("open" | "join")));
        }
        let door = inner.games[&game].door.clone();
        drop(inner);
        self.told_around(account, before);
        if let Err(mpsc::SendError(job)) = door.send(Job { message, account: account.to_string(), reply }) {
            refuse(job.reply, "the game has ended");
        }
    }

    /// A socket closed: its game is kept for a while once nobody is at it, and goes after. The account's last, it is
    /// gone in a while (`gone_after`) unless another opens.
    pub fn left(&self, conn: Conn) {
        let mut inner = self.inner.lock().expect("the tables");
        let (mut gone, mut last) = (None, None);
        if let Some(Connection { account, game, .. }) = inner.conns.remove(&conn) {
            if let Some(game) = game {
                let before = presence_in(&inner, &account, self.online_for);
                Tables::unwatch(&mut inner, &self.root, conn, &game);
                gone = Some((account.clone(), before));
            }
            if !inner.conns.values().any(|connection| connection.account == account) {
                last = Some(account);
            }
        }
        self.sweep(&mut inner);
        drop(inner);
        if let Some((account, before)) = gone {
            self.told_around(&account, before);
        }
        if let (Some(account), Ok(runtime)) = (last, tokio::runtime::Handle::try_current()) {
            let (tables, after) = (self.clone(), self.gone_after);
            runtime.spawn(async move {
                tokio::time::sleep(after).await;
                tables.gone(&account);
            });
        }
    }

    /// An account whose last connection closed a while ago: online no more - its page closed, or its network gone -
    /// unless one has opened since, and its friends told, rather than left to find it gone quiet.
    fn gone(&self, account: &str) {
        let before = {
            let mut inner = self.inner.lock().expect("the tables");
            if inner.conns.values().any(|connection| connection.account == account) {
                return;
            }
            let before = presence_in(&inner, account, self.online_for);
            inner.seen.remove(account);
            before
        };
        self.told_around(account, before);
    }

    /// Whether an account is at a game kept.
    pub fn has_game(&self, account: &str) -> bool {
        let mut inner = self.inner.lock().expect("the tables");
        self.sweep(&mut inner);
        inner.at.contains_key(account)
    }

    /// The games an account may join: those it may find - every public one, and its friends' friends-only ones - and
    /// any that keeps a seat for it, whoever may find it; never one it hosts, nor one nobody's page is at. Each with its
    /// invitation, its host's name, its project's, how many are at it now, whether it has started, who may find it,
    /// and the names of the characters it keeps for the account. Those keeping a seat first.
    pub fn joinable_for(&self, account: &str) -> Vec<Value> {
        let mut inner = self.inner.lock().expect("the tables");
        self.sweep(&mut inner);
        let accounts = read_accounts(&self.root);
        let friends = read_friends(&self.root);
        let name = |id: &str| accounts.iter().find(|known| known.id == id).map_or_else(|| id.to_string(), |known| known.name.clone());
        let mut joinable: Vec<Value> = inner
            .games
            .values()
            .filter_map(|game| {
                let held = game.shared.lock().expect("the game");
                // Who is at it now: a game nobody's page is at - kept for them to come back to - is nobody's to join.
                let here = here(&held);
                if held.host == account || here.is_empty() {
                    return None;
                }
                let theirs: Vec<&String> = held.kept.iter().filter(|(_, kept)| *kept == account).map(|(character, _)| character).collect();
                let findable = match held.visibility.as_str() {
                    "public" => true,
                    "friends" => friends.are_friends(&held.host, account),
                    _ => false,
                };
                if !findable && theirs.is_empty() {
                    return None;
                }
                let board: Value = serde_json::from_str(&held.seen).unwrap_or(Value::Null);
                Some(json!({
                    "invite": held.invite,
                    "host": name(&held.host),
                    "project": held.document["name"].as_str().unwrap_or(""),
                    "players": here.len(),
                    "started": held.started,
                    "visibility": held.visibility,
                    "kept": theirs.iter().map(|character| character_name(&board, character)).collect::<Vec<_>>(),
                }))
            })
            .collect();
        let order = |game: &Value| (game["kept"].as_array().is_none_or(Vec::is_empty), game["host"].as_str().unwrap_or("").to_string(), game["invite"].as_str().unwrap_or("").to_string());
        joinable.sort_by_key(order);
        joinable
    }

    /// The project a game was opened over, for a page joining it with its invitation to open over.
    pub fn project_of(&self, invite: &str) -> Option<Value> {
        let inner = self.inner.lock().expect("the tables");
        inner.games.values().map(|game| game.shared.lock().expect("the game")).find(|held| !invite.is_empty() && held.invite == invite).map(|held| held.document.clone())
    }
}

/// A character's name on a board: its sheet's, else its own id.
fn character_name(board: &Value, character: &str) -> String {
    let sheets = board["replica"]["sheets"].as_array().map_or(&[][..], Vec::as_slice);
    sheets.iter().find(|sheet| sheet["id"] == character).and_then(|sheet| sheet["name"].as_str()).unwrap_or(character).to_string()
}

/// Who is signed in, by the session cookie the accounts know.
fn signed_in(tables: &Tables, headers: &HeaderMap) -> Result<String, (StatusCode, &'static str)> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let now = now_ms();
    let accounts = read_accounts(&tables.root);
    let sessions = read_sessions(&tables.root, now);
    account_of(header("cookie").as_deref(), &sessions, &accounts, now).map(|account| account.id.clone()).ok_or((StatusCode::UNAUTHORIZED, "not signed in"))
}

/// Who may play: a session cookie the accounts know, from the page's own origin.
fn player(tables: &Tables, headers: &HeaderMap) -> Result<String, (StatusCode, &'static str)> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    // From the page's own origin: the host it was loaded from, which a proxy in front of the server says
    // (`page_host`). A socket with no origin at all is not a page's.
    if header("origin").is_none() || page_host(header).is_none() || !same_origin(header) {
        return Err((StatusCode::FORBIDDEN, "not from the page"));
    }
    signed_in(tables, headers)
}

async fn handle(State(tables): State<Tables>, headers: HeaderMap, upgrade: WebSocketUpgrade) -> Response {
    match player(&tables, &headers) {
        Err(refused) => refused.into_response(),
        Ok(account) => upgrade.on_upgrade(move |socket| play(socket, tables, account)),
    }
}

/// The project of the game an invitation is to: what a guest's page opens over before it joins.
async fn joining(State(tables): State<Tables>, headers: HeaderMap, Route(invite): Route<String>) -> Response {
    if let Err(refused) = signed_in(&tables, &headers) {
        return refused.into_response();
    }
    match tables.project_of(&invite) {
        Some(project) => Json(json!({ "project": project })).into_response(),
        None => (StatusCode::NOT_FOUND, "no game for that invitation").into_response(),
    }
}

/// The games whoever is signed in may join: those they may find, and those keeping a seat for them.
async fn joinable(State(tables): State<Tables>, headers: HeaderMap) -> Response {
    match signed_in(&tables, &headers) {
        Err(refused) => refused.into_response(),
        Ok(account) => Json(json!({ "games": tables.joinable_for(&account) })).into_response(),
    }
}

/// A socket's life: each message handed to the account's game, and whatever the game says - its answers, and
/// what the other pages' intents changed - sent on as it comes, the socket beaten, until it closes or goes silent.
async fn play(mut socket: WebSocket, tables: Tables, account: String) {
    let (conn, mut said) = tables.connect(&account);
    let every = tables.beat_every;
    let mut beat = tokio::time::interval_at(tokio::time::Instant::now() + every, every);
    let mut heard = Instant::now();
    loop {
        tokio::select! {
            message = socket.recv() => {
                let Some(Ok(message)) = message else { break };
                heard = Instant::now();
                let text = match message {
                    Message::Text(text) => text.to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                match serde_json::from_str::<Value>(&text) {
                    Ok(message) => tables.ask_on(conn, &account, message),
                    Err(e) => {
                        let refused = json!({ "id": null, "error": format!("not a message: {e}") });
                        if socket.send(Message::Text(refused.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
            out = said.recv() => {
                let Some(out) = out else { break };
                if socket.send(Message::Text(out.to_string().into())).await.is_err() {
                    break;
                }
            }
            _ = beat.tick() => {
                // Nothing heard - not even the browser's answer to a ping - for so long: a connection left half open.
                if heard.elapsed() >= every * SILENT_BEATS {
                    break;
                }
                let told = json!({ "beat": every.as_millis() as u64 });
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() || socket.send(Message::Text(told.to_string().into())).await.is_err() {
                    break;
                }
            }
        }
    }
    tables.left(conn);
}

/// The play route, keeping its games under `root`'s accounts.
pub fn router(root: PathBuf) -> Router {
    router_for(Tables::new(root))
}

/// The play route over tables made as they are wanted - the tests' (`Tables::for_tests`).
pub fn router_for(tables: Tables) -> Router {
    Router::new().route(PLAY_URL, get(handle)).route(&format!("{PLAY_URL}/join/{{invite}}"), get(joining)).route(&format!("{PLAY_URL}/games"), get(joinable)).with_state(tables)
}
