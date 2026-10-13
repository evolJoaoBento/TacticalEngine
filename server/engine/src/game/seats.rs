//! Who may act (`docs/SERVER.md`, phase 5, slice 4). At a shared game each character is played by the account
//! seated in it, and one nobody is seated in by the game's host. The game is told whom it plays for before each
//! intent (`restoreSeating`): on the server by the game's own thread, from the table it keeps - never by a page;
//! in the page by the page, from the table the server told it. An intent for a character that account does not
//! play is refused as the engine refuses anything, in the answer's own shape, with nothing changed and nothing
//! written in the log - so the page's own engine, told the same, refuses it the same, and its prediction and the
//! server's answer agree. Told nobody, the game plays for everyone: a game nobody shares, and the engine's tests.
//!
//! The selection is the account's own: kept among the characters it plays (`keep_selection_own`), the next one
//! chosen among them (`selectNext`), and nobody for an account that plays nobody. Every intent that acts through
//! the selection - a walk, a swing, a thing used or taken, an errand begun - is then the account's own, and an
//! errand is finished or called off by its walker's player alone (`arrived`, `cancelApproach`). Each account's
//! choice is the server's to keep between its intents (`serve::play`), the game holding one at a time.
//!
//! A question is put to whoever's character it is (`pending_for`): the defender asked how a hit lands, the one a
//! reaction is offered to, the one making a death move, the one having a conversation or rolling for a script.
//! A question for nobody in particular is the host's. The fight's turns are the encounter's (`can_act`): the
//! spotlight is the party's or the GM's, and while it is the party's each player acts with their own; handing it
//! to the GM is for anybody who plays somebody. A rest is the whole party's, on the host's word.

use super::session::Session;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Whom the game plays for: the account, the game's host, and who plays whom (a character's id to an account's).
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Seating {
    pub you: String,
    pub host: String,
    #[serde(default)]
    pub seats: HashMap<String, String>,
}

/// A card, a jump, the gear, a level, a place in the party: the intents that name their character first.
const NAMED_FIRST: [&str; 10] = ["useAbility", "jumpTo", "equipItem", "unequipItem", "swapCard", "applyLevelUp", "dropCard", "link", "unlink", "landAt"];

impl Session {
    /// Whether the account the game plays for plays this character: the one seated in it, or the host for one
    /// nobody is seated in. Everybody, told nobody.
    pub fn may_play(&self, id: &str) -> bool {
        let Some(seating) = &self.seating else { return true };
        match seating.seats.get(id) {
            Some(account) => *account == seating.you,
            None => seating.you == seating.host,
        }
    }

    /// Whether the account plays anybody in the party.
    fn plays_anybody(&self) -> bool {
        self.party.members(&self.world.state).iter().any(|id| self.may_play(id))
    }

    /// Whom the question open is put to: the character it is about, or nobody in particular.
    pub fn pending_for(&self) -> Option<String> {
        use super::ask::Asked;
        if let Some(asked) = &self.asked {
            return match asked {
                Asked::Defense { attack, .. } => Some(attack.defender.clone()),
                Asked::Reaction { offers, .. } => offers.first().map(|offer| offer.by.clone()),
                Asked::Death { who, .. } => Some(who.clone()),
            };
        }
        let pending = self.pending.as_ref()?;
        if let Some(by) = pending.dialogue.as_ref().and_then(|d| d.by.clone()) {
            return Some(by);
        }
        // A script waiting on a roll rolls as whoever set it going, as long as it waits.
        self.world.scenario.actor_id.clone().filter(|id| self.world.state.entity(id).is_some_and(|e| e.faction == crate::scene::state::Faction::Party))
    }

    /// Whom the game plays for, told (`restoreSeating`): `null` for everybody; else the account, the host, the
    /// seats, and the account's own choice of whom to select (`selected`), when it has made one.
    pub fn restore_seating(&mut self, told: &Value) -> Result<(), String> {
        self.seating = match told {
            Value::Null => None,
            seating => Some(serde_json::from_value(seating.clone()).map_err(|e| format!("a seating: {e}"))?),
        };
        if let Some(chosen) = told["selected"].as_str() {
            if self.may_play(chosen) {
                self.party.select(&self.world.state, chosen);
            }
        }
        self.keep_selection_own();
        Ok(())
    }

    /// The selection kept among the account's own: the one selected if theirs, else the first of theirs standing,
    /// else nobody.
    pub(super) fn keep_selection_own(&mut self) {
        if self.seating.is_none() || self.party.selected().is_some_and(|id| self.may_play(id)) {
            return;
        }
        match self.party.living(&self.world.state).into_iter().find(|id| self.may_play(id)) {
            Some(own) => {
                self.party.select(&self.world.state, &own);
            }
            None => self.party.deselect(),
        }
    }

    /// The next of the account's own standing, wrapping (`selectNext`).
    pub(super) fn select_next_own(&mut self) -> Option<String> {
        if self.seating.is_none() {
            return self.party.select_next(&self.world.state);
        }
        let own: Vec<String> = self.party.living(&self.world.state).into_iter().filter(|id| self.may_play(id)).collect();
        if own.is_empty() {
            return None;
        }
        let at = self.party.selected().and_then(|s| own.iter().position(|o| o == s)).map_or(0, |i| i + 1);
        let next = own[at % own.len()].clone();
        self.party.select(&self.world.state, &next);
        Some(next)
    }

    /// The answer an intent is refused with, when it is for somebody the account does not play - in the shape its
    /// answer takes, nothing changed. Nothing, when it may be played.
    pub(super) fn not_yours(&self, call: &str, args: &[Value]) -> Option<Value> {
        self.seating.as_ref()?;
        let first = args.first().and_then(Value::as_str);
        let yours = match call {
            "select" => first.is_some_and(|id| self.may_play(id)),
            "answerPending" => self.pending_for().map_or_else(|| self.may_play_unseated(), |id| self.may_play(&id)),
            // An errand - a walk up to something, to use it or to talk - is its walker's to finish or call off.
            "cancelApproach" | "arrived" => self.approaching.as_ref().is_none_or(|errand| self.may_play(&errand.who)),
            "endTurn" => self.plays_anybody(),
            "rest" => self.may_play_unseated(),
            _ if NAMED_FIRST.contains(&call) => first.is_some_and(|id| self.may_play(id)),
            _ => true,
        };
        if yours {
            return None;
        }
        let reason = format!("{} is not yours to play", first.map_or_else(|| "that".to_string(), |id| super::log::name_of(self, id)));
        Some(match call {
            "useAbility" | "answerPending" => json!({ "status": "refused", "lines": [] }),
            "jumpTo" => json!({ "moved": false, "path": [] }),
            "equipItem" | "unequipItem" | "swapCard" => json!({ "ok": false, "reason": reason }),
            "rest" => json!({ "ok": false, "reason": "the party rests on the host's word" }),
            "applyLevelUp" => json!({ "ok": false, "issues": [{ "field": "character", "message": reason }] }),
            "endTurn" => json!(0),
            _ => json!(false),
        })
    }

    /// Whether the account is the host, who plays every character nobody is seated in, and answers for nobody.
    fn may_play_unseated(&self) -> bool {
        self.seating.as_ref().is_none_or(|seating| seating.you == seating.host)
    }

    /// The walkers a page put down that the account plays: nobody else's walk is cut short by another's click.
    pub(super) fn own_walkers<'a>(&self, walkers: &'a [Value]) -> Vec<&'a Value> {
        walkers.iter().filter(|walker| walker[0].as_str().is_some_and(|id| self.may_play(id))).collect()
    }
}
