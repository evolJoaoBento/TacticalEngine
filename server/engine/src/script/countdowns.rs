//! Countdowns a scenario is running (`src/engine/script/countdowns.ts`): each ticks down on the cues it
//! waits for - any action roll, an attack, a roll with Shadow, a creature marking Hit Points, the party's
//! successes or failures - fires its effects at zero, and loops, re-rolling its start when that was dice.
//! A countdown a creature holds ends, or fires, when the creature falls or leaves.

use crate::rng::{RangeError, Rng};
use crate::js;
use crate::rules::countdown::{advance_countdown, steps_for, CountdownAdvance, CountdownClock, CountdownCue, CountdownLoop};
use crate::rules::dice::{parse_dice, roll_dice};
use crate::script::schema::effect;
use crate::zod::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CountdownOnDeath {
    End,
    Trigger,
}

/// A countdown that is running.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningCountdown {
    /// The id the feature gave it: arming it again under this id restarts it.
    pub id: String,
    pub name: String,
    /// The creature counting it, or nothing for a countdown the scene armed.
    pub owner: Option<String>,
    /// The starting value as written, so a loop can re-roll "Loop 1d6".
    pub dice: String,
    pub value: f64,
    pub start: f64,
    pub advance: CountdownAdvance,
    #[serde(default, rename = "loop", skip_serializing_if = "Option::is_none")]
    pub looping: Option<CountdownLoop>,
    pub on_death: CountdownOnDeath,
    #[serde(default)]
    pub effects: Vec<Value>,
}

/// `runningCountdownSchema`: a running countdown as a save holds it.
pub fn running_countdown_schema() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        object(vec![
            req("id", string().min(1.0)),
            req("name", string().min(1.0)),
            req("owner", nullable(string().min(1.0))),
            req("dice", string().min(1.0)),
            req("value", int().min(0.0)),
            req("start", int().min(0.0)),
            req("advance", one_of(&["standard", "attackRoll", "withBad", "hpMarked", "progress", "consequence"])),
            opt("loop", one_of(&["reset", "increasing", "decreasing"])),
            req("onDeath", one_of(&["end", "trigger"])),
            def("effects", array(lazy(effect)), || json!([])),
        ])
    })
}

/// A countdown that moved, as it stood at that moment.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CountdownMoved {
    pub countdown: RunningCountdown,
    /// The value it reached, before any loop reset it: 0 when it triggered.
    pub value: f64,
    pub fired: bool,
}

/// The clocks a scenario is carrying, by id, in the order they were armed - a `Map`, which re-arming one
/// keeps in its place.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CountdownBoard(Vec<(String, RunningCountdown)>);

impl CountdownBoard {
    pub fn get(&self, id: &str) -> Option<&RunningCountdown> {
        self.0.iter().find(|(key, _)| key == id).map(|(_, c)| c)
    }

    /// `Map.set`: a new id goes on the end, a known one is replaced where it stands.
    pub fn set(&mut self, countdown: RunningCountdown) {
        match self.0.iter_mut().find(|(key, _)| *key == countdown.id) {
            Some(entry) => entry.1 = countdown,
            None => self.0.push((countdown.id.clone(), countdown)),
        }
    }

    pub fn remove(&mut self, id: &str) {
        self.0.retain(|(key, _)| key != id);
    }

    pub fn entries(&self) -> &[(String, RunningCountdown)] {
        &self.0
    }
}

impl Serialize for CountdownBoard {
    /// As `[...board.entries()]`: `[id, countdown]` pairs, in order.
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.0.iter().map(|(id, c)| (id, c)))
    }
}

/// Advance every countdown waiting on this cue: a snapshot of the ids first, so a clock an effect arms
/// does not advance on the cue that armed it. Returns every one that moved.
pub fn advance_board(board: &mut CountdownBoard, cue: &CountdownCue, rng: &mut Rng) -> Result<Vec<CountdownMoved>, RangeError> {
    let mut moved = Vec::new();
    let ids: Vec<String> = board.0.iter().map(|(id, _)| id.clone()).collect();
    for id in ids {
        let Some(countdown) = board.get(&id).cloned() else { continue };
        if let CountdownCue::HpMarked { id: who, .. } = cue {
            if countdown.owner.as_deref() != Some(who.as_str()) {
                continue;
            }
        }
        let steps = steps_for(countdown.advance, cue);
        if steps == 0.0 {
            continue;
        }
        let tick = advance_countdown(&CountdownClock { value: countdown.value, start: countdown.start, looping: countdown.looping }, steps);
        moved.push(CountdownMoved { countdown: countdown.clone(), value: tick.value, fired: tick.fired });
        let Some(clock) = tick.clock else {
            board.remove(&id);
            continue;
        };
        let looped = if tick.fired { rolled_start(&countdown, clock.start, rng)? } else { clock.start };
        board.set(RunningCountdown { value: if tick.fired { looped } else { clock.value }, start: looped, ..countdown });
    }
    Ok(moved)
}

/// A looping countdown whose start was dice rolls a fresh start; otherwise the loop's own.
fn rolled_start(countdown: &RunningCountdown, worked: f64, rng: &mut Rng) -> Result<f64, RangeError> {
    match parse_dice(&countdown.dice) {
        Some(parsed) if parsed.expression.count != 0.0 => Ok(js::max(1.0, roll_dice(rng, &parsed.expression)?.total)),
        _ => Ok(worked),
    }
}

/// Where a countdown's owner is: standing, down, or not in this room at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OwnerStatus {
    Alive,
    Fallen,
    Gone,
}

/// End every countdown whose owner is no longer standing; the ones set to fire on their owner's death
/// fire. Returns those.
pub fn reap_board(board: &mut CountdownBoard, status: impl Fn(&str) -> OwnerStatus) -> Vec<CountdownMoved> {
    let mut fired = Vec::new();
    for (id, countdown) in board.0.clone() {
        let Some(owner) = &countdown.owner else { continue };
        let where_ = status(owner);
        if where_ == OwnerStatus::Alive {
            continue;
        }
        board.remove(&id);
        if where_ == OwnerStatus::Fallen && countdown.on_death == CountdownOnDeath::Trigger {
            fired.push(CountdownMoved { countdown, value: 0.0, fired: true });
        }
    }
    fired
}

/// End every countdown a creature holds - the scene is over for them.
pub fn end_creature_countdowns(board: &mut CountdownBoard) {
    board.0.retain(|(_, countdown)| countdown.owner.is_none());
}
