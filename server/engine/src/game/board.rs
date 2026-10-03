//! The board (`game/board.ts`, `docs/SERVER.md` phase 3, slice 3b): how the game stands, as the page reads it
//! and as a game played elsewhere is compared with it - the replica (`game/replica.rs`), and what a replica is
//! not told because nothing is answered from it: the fight's view and log, the question open as the panel
//! draws it, the walk's held fight and errand, the log, the container open, the conversations set aside, and
//! where the dice had got to. What a view drains - the motions, the numbers over heads - is not on it: those
//! are taken (`takeMotions`, `takeFloaters`), and the dice still to be shown are, as `rolls`.

use super::session::Session;
use serde_json::{json, Value};

impl Session {
    /// The question open, as the panel draws it: its kind and prompt, and for a script the conversation it
    /// opened - which dialogue, the node shown and its replies, a reply's own roll, and who is having it - and
    /// whom or what it is with.
    fn board_pending(&self) -> Value {
        if let Some(asked) = &self.asked {
            return json!({ "kind": asked.kind(), "prompt": asked.prompt() });
        }
        let Some(pending) = &self.pending else { return Value::Null };
        let dialogue = pending.dialogue.as_ref().map_or(Value::Null, |d| {
            let view = d.view.as_ref().map_or(Value::Null, |v| json!({ "node": d.runner.node_id(v), "options": v.options }));
            json!({ "id": d.runner.id(), "view": view, "prompt": d.prompt, "by": d.by })
        });
        json!({ "kind": "script", "prompt": pending.prompt, "interactable": pending.interactable, "with": pending.with, "dialogue": dialogue })
    }

    /// How the game stands, as the page reads it (`boardOf`).
    pub fn board(&mut self) -> Value {
        let fight = self.encounter.as_ref().map_or(Value::Null, |e| json!({ "view": e.view(&self.world.state), "log": e.log() }));
        let opened = self.open_container();
        let rolls: Vec<Value> = self.rolls.iter().map(|r| json!({ "who": r.who, "what": r.what, "roll": r.roll })).collect();
        json!({
            "replica": self.replica_snapshot(),
            "fight": fight,
            "pending": self.board_pending(),
            "ambush": self.ambush,
            "approaching": self.approaching,
            "log": self.log,
            "rolls": rolls,
            "opened": opened,
            "aside": self.talking_aside(),
            "rng": self.rng.save(),
        })
    }
}
