//! A rest called (`docs/SERVER.md`, phase 5): the party rests together, so a rest is first a vote and then each
//! player's own choice. Anybody who plays a character calls it, short or long (`callRest`), choosing their own
//! characters' two downtime moves as they do; everybody who plays a character then says whether they agree
//! (`voteRest`) - all of them, and one who would rather not calls it off - and chooses their own characters' moves
//! (`chooseRest`). Once everybody has agreed and every one of the party has their moves, the rest is taken as it
//! always was (`kit.rs`, `rest`), the moves in the party's order so the dice fall alike on every engine. Its caller
//! or the host calls it off (`cancelRest`), and a fight beginning or a save loaded drops it.
//!
//! Who votes is fixed when it is called: the players of the party's members, each the account seated in one or the
//! host for one nobody is (`engine::game::seats`). A game nobody shares has one player, who agrees in calling it:
//! a player alone calls a rest with everybody's moves and it is taken at once.

use super::log::{name_of, note};
use super::session::Session;
use crate::scene::state::Faction;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// A rest called and not yet taken: what kind, by whom, who votes on it, who has agreed, and the moves chosen so
/// far (a character's id to its two moves).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RestCall {
    pub kind: String,
    pub by: String,
    pub voters: Vec<String>,
    pub agreed: Vec<String>,
    pub moves: Map<String, Value>,
}

impl Session {
    /// The account the game plays for: nobody in particular (`""`) in a game nobody shares.
    fn account(&self) -> String {
        self.seating.as_ref().map(|seating| seating.you.clone()).unwrap_or_default()
    }

    /// Everybody who plays one of the party: each member's player, in the party's order.
    fn players(&self) -> Vec<String> {
        let Some(seating) = &self.seating else { return vec![String::new()] };
        let mut players: Vec<String> = Vec::new();
        for id in self.resting_party() {
            let player = seating.seats.get(&id).cloned().unwrap_or_else(|| seating.host.clone());
            if !players.contains(&player) {
                players.push(player);
            }
        }
        players
    }

    /// The party a rest is taken by, in order: every one of it standing in the room.
    fn resting_party(&self) -> Vec<String> {
        self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect()
    }

    /// Why the party may not rest now, as a rest itself refuses.
    fn rest_refused(&self) -> Option<&'static str> {
        if self.in_combat() {
            return Some("not in the middle of a fight");
        }
        if self.waiting() || !self.talking_aside().is_empty() {
            return Some("not in the middle of a conversation");
        }
        if self.resting_party().is_empty() {
            return Some("nobody to rest");
        }
        None
    }

    /// Call a rest (`callRest`), with the caller's own characters' moves: `{ ok, rested }`, `rested` when it was
    /// taken at once - everybody agreed and everybody chosen, as for a player alone.
    pub fn call_rest(&mut self, kind: &str, moves: &Value) -> Result<Value, String> {
        if self.rest_call.is_some() {
            return Err("a rest has been called already".into());
        }
        if kind != "short" && kind != "long" {
            return Err("a rest is short or long".into());
        }
        if !self.plays_anybody() {
            return Err("only somebody who plays a character calls a rest".into());
        }
        if let Some(why) = self.rest_refused() {
            return Err(why.into());
        }
        let you = self.account();
        self.rest_call = Some(RestCall { kind: kind.into(), by: you.clone(), voters: self.players(), agreed: vec![you], moves: Map::new() });
        if let Err(why) = self.take_moves(moves) {
            self.rest_call = None;
            return Err(why);
        }
        self.settle_rest()
    }

    /// Agree to the rest called, or not (`voteRest`): one who would rather not calls it off.
    pub fn vote_rest(&mut self, agree: bool) -> Result<Value, String> {
        let you = self.account();
        let Some(call) = self.rest_call.as_mut() else { return Err("no rest has been called".into()) };
        if !call.voters.contains(&you) {
            return Err("only somebody who plays a character votes on a rest".into());
        }
        if !agree {
            self.rest_call = None;
            note(self, "The party does not rest: not everybody is ready.", "system");
            return Ok(json!({ "ok": true, "rested": false }));
        }
        if !call.agreed.contains(&you) {
            call.agreed.push(you);
        }
        self.settle_rest()
    }

    /// The account's own characters' moves for the rest called (`chooseRest`), until it is taken.
    pub fn choose_rest(&mut self, moves: &Value) -> Result<Value, String> {
        if self.rest_call.is_none() {
            return Err("no rest has been called".into());
        }
        self.take_moves(moves)?;
        self.settle_rest()
    }

    /// The rest called, called off by its caller or the host (`cancelRest`).
    pub fn cancel_rest(&mut self) -> Result<Value, String> {
        let Some(call) = &self.rest_call else { return Err("no rest has been called".into()) };
        if call.by != self.account() && !self.may_play_unseated() {
            return Err("only whoever called it, or the host, calls it off".into());
        }
        self.rest_call = None;
        note(self, "The party does not rest after all.", "system");
        Ok(json!({ "ok": true, "rested": false }))
    }

    /// Moves for characters the account plays, two each, kept on the call; none for anybody else's.
    fn take_moves(&mut self, moves: &Value) -> Result<(), String> {
        let Some(moves) = moves.as_object() else { return Ok(()) };
        let party = self.resting_party();
        for id in moves.keys() {
            if !party.contains(id) {
                return Err(format!("{} is not resting with the party", name_of(self, id)));
            }
            if !self.may_play(id) {
                return Err(format!("{} is not yours to play", name_of(self, id)));
            }
        }
        let call = self.rest_call.as_mut().expect("a rest called");
        for (id, chosen) in moves {
            let two: Vec<Value> = chosen.as_array().map_or(Vec::new(), |pair| pair.iter().take(2).cloned().collect());
            call.moves.insert(id.clone(), json!(two));
        }
        Ok(())
    }

    /// The rest taken once everybody has agreed and every one of the party has their moves - or the call dropped,
    /// with a word in the log, if the party can no longer rest.
    fn settle_rest(&mut self) -> Result<Value, String> {
        let party = self.resting_party();
        let call = self.rest_call.as_ref().expect("a rest called");
        let agreed = call.voters.iter().all(|voter| call.agreed.contains(voter));
        if !agreed || !party.iter().all(|id| call.moves.contains_key(id)) {
            return Ok(json!({ "ok": true, "rested": false }));
        }
        let call = self.rest_call.take().expect("a rest called");
        let mut moves = Map::new();
        for id in &party {
            moves.insert(id.clone(), call.moves[id].clone());
        }
        match self.rest(call.kind == "long", &json!({ "moves": moves })) {
            Ok(bad) => Ok(json!({ "ok": true, "rested": true, "badGained": bad })),
            Err(why) => {
                note(self, &format!("The party cannot rest: {why}."), "system");
                Err(why)
            }
        }
    }
}
