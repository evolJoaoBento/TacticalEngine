//! Messages between friends (`docs/SERVER.md`, phase 6, slice 6): what one friend writes another, outside any game.
//!
//! Kept in `data/messages.json`, beside the friends (`friends.rs`, whose lock keeps both): every message, numbered as
//! it came (`{ next, messages: [{ n, from, to, text, at }], read: { reader: { friend: n } } }`), and how far each
//! player has read each friend. A pair keeps its last `KEPT` messages; when two stop being friends, what they wrote
//! each other goes with it. What the page asks here goes through `friends.rs`:
//!
//! - `GET /__friends/messages/<id>` - `{ with: { id, name }, messages: [{ n, from, text, at }] }`, oldest first: a
//!   conversation with a friend, nobody else's;
//! - `POST /__friends/say` `{ to, text }` - the conversation after (trimmed, 1 to `LONGEST` characters);
//! - `POST /__friends/read` `{ id, upTo }` - read up to message `upTo`: the friends as they stand after, whose
//!   `unread` (`{ <id>: count }`, nobody with none) is what each friend wrote that the player has not read.

use crate::files::{read_json, write_json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

pub const MESSAGES_FILE: &str = "data/messages.json";
/// The longest message, in characters.
pub const LONGEST: usize = 500;
/// How many messages a pair of friends keeps: the newest.
pub const KEPT: usize = 200;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub n: u64,
    pub from: String,
    pub to: String,
    pub text: String,
    pub at: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Messages {
    #[serde(default)]
    pub next: u64,
    #[serde(default)]
    pub messages: Vec<Message>,
    /// How far each player has read each friend: the last message read, by number.
    #[serde(default)]
    pub read: BTreeMap<String, BTreeMap<String, u64>>,
}

fn between(message: &Message, a: &str, b: &str) -> bool {
    (message.from == a && message.to == b) || (message.from == b && message.to == a)
}

impl Messages {
    /// What two friends wrote each other, oldest first.
    pub fn between(&self, a: &str, b: &str) -> Vec<&Message> {
        self.messages.iter().filter(|message| between(message, a, b)).collect()
    }

    /// Something written: the text it keeps, or why not. The pair's oldest forgotten past `KEPT`.
    pub fn say(&mut self, from: &str, to: &str, text: &str, at: i64) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("nothing said".to_string());
        }
        if text.chars().count() > LONGEST {
            return Err(format!("a message is {LONGEST} characters at most"));
        }
        self.next += 1;
        self.messages.push(Message { n: self.next, from: from.to_string(), to: to.to_string(), text: text.to_string(), at });
        let over = self.between(from, to).len().saturating_sub(KEPT);
        let mut dropped = 0;
        self.messages.retain(|message| {
            let drop = dropped < over && between(message, from, to);
            dropped += usize::from(drop);
            !drop
        });
        Ok(())
    }

    /// A player has read a friend's messages up to `up_to` (never back).
    pub fn read(&mut self, reader: &str, friend: &str, up_to: u64) {
        let mark = self.read.entry(reader.to_string()).or_default().entry(friend.to_string()).or_default();
        *mark = (*mark).max(up_to);
    }

    /// How many messages each friend has written a player that the player has not read: nobody with none.
    pub fn unread(&self, reader: &str) -> BTreeMap<String, usize> {
        let marks = self.read.get(reader);
        let mut unread = BTreeMap::new();
        for message in self.messages.iter().filter(|message| message.to == reader) {
            if message.n > marks.and_then(|marks| marks.get(&message.from)).copied().unwrap_or(0) {
                *unread.entry(message.from.clone()).or_insert(0) += 1;
            }
        }
        unread
    }

    /// Two players no longer friends: what they wrote each other forgotten, and how far either had read it.
    pub fn forget(&mut self, a: &str, b: &str) {
        self.messages.retain(|message| !between(message, a, b));
        for (reader, friend) in [(a, b), (b, a)] {
            if let Some(marks) = self.read.get_mut(reader) {
                marks.remove(friend);
            }
        }
        self.read.retain(|_, marks| !marks.is_empty());
    }

    /// A conversation as the page is told it.
    pub fn conversation(&self, account: &str, with: Value) -> Value {
        let friend = with["id"].as_str().unwrap_or("").to_string();
        let messages: Vec<Value> = self.between(account, &friend).iter().map(|m| json!({ "n": m.n, "from": m.from, "text": m.text, "at": m.at })).collect();
        json!({ "with": with, "messages": messages })
    }
}

pub fn read_messages(root: &Path) -> Messages {
    read_json(&root.join(MESSAGES_FILE), Messages::default())
}

pub fn write_messages(root: &Path, messages: &Messages) -> std::io::Result<()> {
    write_json(&root.join(MESSAGES_FILE), messages)
}
