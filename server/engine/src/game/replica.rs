//! A game as a replica holds it (`game/replica.ts`, `docs/SERVER.md` phase 3): enough of it to answer what the
//! pointer asks on every move - the ground a walk reaches, the line a click would walk, where a push or a jump
//! goes, where a card may be aimed and whom it would catch - without playing it.
//!
//! The game is played somewhere else: in the page today, on the server tomorrow. The replica is stood up from
//! the same project and then told, after every intent, how the game stands - the room and its state, the
//! scenario, the sheets, the party's control, the fight and the spotlights, and whether a question is open.
//! What it is not told it does not need: a script paused mid-run has no form to send, and the replica only has
//! to know that one waits (`question_open`).

use super::session::Session;
use crate::character::sheet::CharacterSheet;
use crate::combat::encounter::EncounterRunner;
use serde_json::{json, Value};

impl Session {
    /// How the game stands, as a replica is told it (`replicaOf`).
    pub fn replica_snapshot(&self) -> Value {
        let mut spotlights: Vec<(String, f64)> = self.spotlit.borrow().clone();
        spotlights.sort_by(|a, b| a.0.cmp(&b.0));
        json!({
            "sceneId": self.scene["id"],
            "state": self.world.state.snapshot(),
            "rooms": self.snapshots.entries().iter().map(|(id, room)| json!([id, room])).collect::<Vec<_>>(),
            "scenario": self.world.scenario.snapshot(),
            "sheets": self.sheets.entries().iter().map(|(_, sheet)| serde_json::to_value(sheet).expect("a sheet writes")).collect::<Vec<_>>(),
            "party": self.party.snapshot(),
            "encounter": self.encounter.as_ref().map(EncounterRunner::snapshot),
            "spotlights": spotlights,
            "questionOpen": self.waiting(),
        })
    }

    /// Stand as a snapshot says the game stands (`restoreReplica`): the scenario and the sheets first - the room
    /// is entered with them - then the room as it was left and the rooms left before it, the party's control, the fight and its spotlights,
    /// and whether a question is open. The world is rebuilt last, so it reads them all.
    pub fn restore_replica(&mut self, replica: &Value) -> Result<(), String> {
        self.world.scenario.restore(&replica["scenario"])?;
        for sheet in replica["sheets"].as_array().map_or(&[][..], Vec::as_slice) {
            let sheet: CharacterSheet = serde_json::from_value(sheet.clone()).map_err(|e| format!("a sheet: {e}"))?;
            self.set_sheet(sheet)?;
        }
        let scene_id = replica["sceneId"].as_str().ok_or("a replica names its room")?.to_string();
        if !self.enter_saved_scene(&scene_id, &replica["state"])? {
            return Err(format!("this project has no scene \"{scene_id}\""));
        }
        // The rooms already left, as the replica's game left them.
        self.snapshots = Default::default();
        for pair in replica["rooms"].as_array().map_or(&[][..], Vec::as_slice) {
            let id = pair[0].as_str().ok_or("a room left names itself")?;
            self.snapshots.set(id, pair[1].clone());
        }
        self.party.restore(&replica["party"])?;
        self.encounter = match &replica["encounter"] {
            Value::Null => None,
            fight => Some(EncounterRunner::from_snapshot(fight)?),
        };
        let spotlights: Vec<(String, f64)> = serde_json::from_value(replica["spotlights"].clone()).map_err(|e| format!("spotlights: {e}"))?;
        *self.spotlit.borrow_mut() = spotlights;
        self.question_open = replica["questionOpen"] == true;
        self.refresh_world();
        Ok(())
    }
}
