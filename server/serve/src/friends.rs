//! Friends (`docs/SERVER.md`, phase 6, slice 2): who each player counts as theirs - for the lobbies only friends
//! may join, and the messages only friends send each other (`messages.rs`, slice 6).
//!
//! Kept in `data/friends.json`: the pairs that are friends, and the requests not answered yet (`{ friends: [[a, b]],
//! asked: [{ from, to }] }`, accounts' ids). A player asks another by name; the other accepts or declines; either
//! removes the other, or takes back a request of their own. Asking somebody who has asked you makes you friends at
//! once. An account made with a player's invitation is that player's friend from the start (`accounts.rs`,
//! `befriend`). What the page asks here, signed in:
//!
//! - `GET /__friends` - `{ friends, asking, asked, unread, online }`, the first three `[{ id, name }]`: the player's
//!   friends, who has asked them, and whom they have asked; how many messages each friend has written them unread;
//!   and which friends are around (`{ <id>: "playing" | "online" }`, `play.rs`'s `presence`: a page at a game, or
//!   one that asked here within the while) - friends' alone, nobody who has only asked;
//! - `POST /__friends/ask` `{ name }`, `POST /__friends/answer` `{ from, accept }`, `POST /__friends/remove` `{ id }`
//!   - each answered with the same, as it stands after; a friend removed, what the two wrote each other goes too;
//! - a friend's messages: `GET /__friends/messages/<id>`, `POST /__friends/say`, `POST /__friends/read`
//!   (`messages.rs`).
//!
//! The POSTs come only from the page (its header, its own origin), as every write the server takes does. Whatever a
//! signed-in page asks here, its player is seen online (`Tables::saw`). A request, an answer, a friend removed or a message
//! written is told at once to the other's pages at a game (`{ friends: { from } }`, `Tables::tell`), which ask again;
//! a message read is told to nobody. So is a friend come to a game, gone from one or come online (`play.rs`,
//! `told_around`); one gone quiet a while is not. The menu's page is told the same, over the games' socket opened to
//! listen (`play.rs`); every page asks again every few seconds besides, which is what keeps it seen.

use crate::accounts::{account_of, from_the_page, now_ms, read_accounts, read_sessions, Account};
use crate::files::{read_json, write_json};
use crate::messages::{read_messages, write_messages, Messages};
use crate::play::Tables;
use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode, Uri};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const FRIENDS_URL: &str = "/__friends";
pub const FRIENDS_FILE: &str = "data/friends.json";
const LIMIT: usize = 4096;

/// One lock for the friends file: the routes' writes, and an account made with an invitation.
static LOCK: Mutex<()> = Mutex::new(());

/// A request not answered yet: who asked whom.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Request {
    pub from: String,
    pub to: String,
}

/// Every friendship, and every request not answered yet.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Friends {
    #[serde(default)]
    pub friends: Vec<[String; 2]>,
    #[serde(default)]
    pub asked: Vec<Request>,
}

impl Friends {
    pub fn are_friends(&self, a: &str, b: &str) -> bool {
        self.friends.iter().any(|[x, y]| (x == a && y == b) || (x == b && y == a))
    }

    /// An account's friends, in the order they became friends.
    pub fn of(&self, account: &str) -> Vec<String> {
        self.friends.iter().filter_map(|[x, y]| if x == account { Some(y.clone()) } else if y == account { Some(x.clone()) } else { None }).collect()
    }

    fn has_asked(&self, from: &str, to: &str) -> bool {
        self.asked.iter().any(|request| request.from == from && request.to == to)
    }

    /// Two accounts made friends, whatever either had asked the other.
    fn befriend(&mut self, a: &str, b: &str) {
        self.asked.retain(|request| !((request.from == a && request.to == b) || (request.from == b && request.to == a)));
        if a != b && !self.are_friends(a, b) {
            self.friends.push([a.to_string(), b.to_string()]);
        }
    }

    /// Whatever was between two accounts - a friendship, a request either way - gone. Whether there was any.
    fn part(&mut self, a: &str, b: &str) -> bool {
        let before = (self.friends.len(), self.asked.len());
        self.friends.retain(|[x, y]| !((x == a && y == b) || (x == b && y == a)));
        self.asked.retain(|request| !((request.from == a && request.to == b) || (request.from == b && request.to == a)));
        before != (self.friends.len(), self.asked.len())
    }
}

pub fn read_friends(root: &Path) -> Friends {
    read_json(&root.join(FRIENDS_FILE), Friends::default())
}

fn write_friends(root: &Path, friends: &Friends) -> std::io::Result<()> {
    write_json(&root.join(FRIENDS_FILE), friends)
}

/// Two accounts made friends: the player whose invitation made an account, and the account it made.
pub fn befriend(root: &Path, a: &str, b: &str) -> std::io::Result<()> {
    let _held = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut friends = read_friends(root);
    friends.befriend(a, b);
    write_friends(root, &friends)
}

/// An account as the page is told it: its id, and its name.
fn person(accounts: &[Account], id: &str) -> Value {
    let name = accounts.iter().find(|known| known.id == id).map_or(id, |known| known.name.as_str());
    json!({ "id": id, "name": name })
}

/// The friends' routes' state: the repository, and the games - who is at one, who has been seen.
#[derive(Clone)]
pub struct Place {
    pub root: PathBuf,
    pub tables: Tables,
}

/// A player's friends as the page is told them: each friend, each who asked them, each they asked, by name; how
/// many messages each friend has written them unread; and which friends are around.
fn view(friends: &Friends, messages: &Messages, tables: &Tables, account: &str, accounts: &[Account]) -> Value {
    let person = |id: &str| person(accounts, id);
    json!({
        "friends": friends.of(account).iter().map(|id| person(id)).collect::<Vec<_>>(),
        "asking": friends.asked.iter().filter(|request| request.to == account).map(|request| person(&request.from)).collect::<Vec<_>>(),
        "asked": friends.asked.iter().filter(|request| request.from == account).map(|request| person(&request.to)).collect::<Vec<_>>(),
        "unread": messages.unread(account),
        "online": tables.presence(&friends.of(account)),
    })
}

fn header_of(headers: &HeaderMap, name: &str) -> Option<String> {
    let values: Vec<String> = headers.get_all(name).iter().map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned()).collect();
    match (name, values.len()) {
        (_, 0) => None,
        ("cookie", _) => Some(values.join("; ")),
        _ => values.into_iter().next(),
    }
}

fn refuse(status: u16, reason: &str) -> (u16, Value) {
    (status, json!({ "reason": reason }))
}

fn respond(root: &Path, tables: &Tables, method: &str, path: &str, headers: &HeaderMap, body: Result<String, ()>) -> (u16, Value) {
    let now = now_ms();
    let accounts = read_accounts(root);
    let Some(account) = account_of(header_of(headers, "cookie").as_deref(), &read_sessions(root, now), &accounts, now).map(|account| account.id.clone()) else {
        return refuse(401, "sign in first");
    };
    tables.saw(&account);
    let rest = path.strip_prefix(FRIENDS_URL).unwrap_or("").trim_start_matches('/');
    let _held = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut friends = read_friends(root);
    let mut messages = read_messages(root);
    if method == "GET" {
        return match rest.strip_prefix("messages/") {
            None if rest.is_empty() => (200, view(&friends, &messages, tables, &account, &accounts)),
            Some(other) if friends.are_friends(&account, &other.to_lowercase()) => (200, messages.conversation(&account, person(&accounts, &other.to_lowercase()))),
            Some(_) => refuse(404, "you can only read a friend's messages"),
            None => refuse(404, "no such route"),
        };
    }
    if let Some(refused) = from_the_page(method, |name| header_of(headers, name)) {
        return refuse(403, refused);
    }
    let Ok(body) = body else { return refuse(413, "too large") };
    let asked: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let field = |key: &str| asked[key].as_str().map(str::to_lowercase).unwrap_or_default();
    // Whom the change is told to at their game, once it is kept: the other of the two, never the one who made it.
    let told: String;
    match rest {
        // Asked by name: friends at once if they had asked first.
        "ask" => {
            let other = field("name");
            if !accounts.iter().any(|known| known.id == other) {
                return refuse(404, "there is no player of that name");
            }
            if other == account {
                return refuse(422, "you cannot ask yourself");
            }
            if friends.are_friends(&account, &other) {
                return refuse(409, "you are friends already");
            }
            if friends.has_asked(&other, &account) {
                friends.befriend(&account, &other);
            } else if !friends.has_asked(&account, &other) {
                friends.asked.push(Request { from: account.clone(), to: other.clone() });
            }
            told = other;
        }
        "answer" => {
            let from = field("from");
            if !friends.has_asked(&from, &account) {
                return refuse(404, "nobody of that name has asked you");
            }
            if asked["accept"] == true {
                friends.befriend(&account, &from);
            } else {
                friends.part(&account, &from);
            }
            told = from;
        }
        "remove" => {
            if !friends.part(&account, &field("id")) {
                return refuse(404, "nothing between you to remove");
            }
            messages.forget(&account, &field("id"));
            if let Err(why) = write_messages(root, &messages) {
                return refuse(500, &format!("the messages could not be kept: {why}"));
            }
            told = field("id");
        }
        // Written to a friend: the conversation after. The text as written - not lowercased as the ids are.
        "say" => {
            let to = field("to");
            if !friends.are_friends(&account, &to) {
                return refuse(404, "you can only write to a friend");
            }
            if let Err(why) = messages.say(&account, &to, asked["text"].as_str().unwrap_or(""), now) {
                return refuse(422, &why);
            }
            if let Err(why) = write_messages(root, &messages) {
                return refuse(500, &format!("the messages could not be kept: {why}"));
            }
            tables.tell(&to, &json!({ "friends": { "from": account } }));
            return (200, messages.conversation(&account, person(&accounts, &to)));
        }
        // A friend's messages read, up to one: the friends after, what is unread with them. Told to nobody - a page
        // shown a conversation reads it, and the friend told would read theirs again, and so on.
        "read" => {
            let friend = field("id");
            if !friends.are_friends(&account, &friend) {
                return refuse(404, "you can only read a friend's messages");
            }
            messages.read(&account, &friend, asked["upTo"].as_u64().unwrap_or(0));
            if let Err(why) = write_messages(root, &messages) {
                return refuse(500, &format!("the messages could not be kept: {why}"));
            }
            return (200, view(&friends, &messages, tables, &account, &accounts));
        }
        _ => return refuse(404, "no such route"),
    }
    if let Err(why) = write_friends(root, &friends) {
        return refuse(500, &format!("the friends could not be kept: {why}"));
    }
    tables.tell(&told, &json!({ "friends": { "from": account } }));
    (200, view(&friends, &messages, tables, &account, &accounts))
}

/// The friends' routes as an axum handler, over the repository at `root`.
pub async fn handle(State(place): State<Place>, method: Method, uri: Uri, headers: HeaderMap, body: Body) -> Response<Body> {
    let path = uri.path().to_string();
    let body = to_bytes(body, LIMIT).await.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).map_err(|_| ());
    let method = method.as_str().to_string();
    let (status, value) = tokio::task::spawn_blocking(move || respond(&place.root, &place.tables, &method, &path, &headers, body)).await.expect("the friends task");
    let mut response = Response::new(Body::from(value.to_string()));
    *response.status_mut() = StatusCode::from_u16(status).expect("a status");
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
