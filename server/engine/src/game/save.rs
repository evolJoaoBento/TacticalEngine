//! Saving and loading a campaign in progress (`game/save.ts`).
//!
//! A save is state over a project, not a copy of one: it names the project it belongs to and carries only
//! what play changed - where the party stands, what it carries, the flags, how each room was left, and where
//! the dice had got to. A fight and a script waiting on an answer refuse to save, being live things with no
//! form on disk; so would an approaching ambush, but headless there is none - what a walk wakes begins at
//! once (`game/movement.rs`). A save is read through its schema (`saveSchema`), migrated at the door first.

use super::content::{abilities_of, character_content_for};
use super::log::LogLine;
use super::session::Session;
use crate::character::schema::sheet_schema;
use crate::character::sheet::{derive_character, CharacterSheet};
use crate::content::document::CURRENT_FORMAT_VERSION;
use crate::scene::migrate::migrate_document;
use crate::script::countdowns::running_countdown_schema;
use crate::script::zones::running_zone_schema;
use crate::zod::*;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// How much scrollback a save carries (`SAVED_LOG_LINES`).
pub const SAVED_LOG_LINES: usize = 200;

const LOG_TONES: &[&str] = &["narration", "system", "good", "bad", "combat", "success"];

/// `scenarioSnapshotSchema`: the scenario as a save holds it, what came later defaulted.
pub fn scenario_snapshot_schema() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let counts = || array(tuple(vec![string(), int().min(0.0)]));
        object(vec![
            req("variables", record(string(), union(vec![string(), number(), boolean(), null()]))),
            req("flags", array(string())),
            req("items", counts()),
            req("actorId", nullable(string())),
            def(
                "quests",
                array(object(vec![
                    req("quest", string()),
                    req("status", one_of(&["active", "completed", "failed"])),
                    req("done", array(string())),
                    def("revealed", array(string()), || json!([])),
                ])),
                || json!([]),
            ),
            def("partyLevel", int().min(1.0).max(10.0), || json!(1)),
            def("abilityUses", counts(), || json!([])),
            def("abilityTokens", counts(), || json!([])),
            def("countdowns", array(lazy(running_countdown_schema)), || json!([])),
            def("zones", array(lazy(running_zone_schema)), || json!([])),
        ])
    })
}

/// `sceneSnapshotSchema`: a room as it was left.
pub fn scene_snapshot_schema() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let pool = || object(vec![req("marked", int().min(0.0)), req("max", int().min(0.0))]);
        let currency = || object(vec![req("value", int().min(0.0)), req("max", int().min(0.0))]);
        object(vec![
            req("sceneId", string()),
            opt("room", object(vec![req("width", int().positive()), req("x", int()), req("y", int())])),
            req(
                "entities",
                record(
                    string(),
                    object(vec![
                        req("id", string()),
                        req("faction", one_of(&["party", "adversary", "neutral"])),
                        req("definition", string()),
                        req("tile", int()),
                        opt("at", object(vec![req("x", number()), req("y", number())])),
                        req("hitPoints", pool()),
                        req("stress", pool()),
                        req("armorSlots", pool()),
                        opt("good", currency()),
                        req("conditions", array(string())),
                        def("conditionDurations", record(string(), one_of(&["temporary", "scene", "rest", "permanent"])), || json!({})),
                        req("alive", boolean()),
                        opt("dead", boolean()),
                        opt("interacted", boolean()),
                        opt("truce", boolean()),
                        opt("name", string()),
                    ]),
                ),
            ),
            req(
                "interactables",
                record(
                    string(),
                    object(vec![
                        req("used", boolean()),
                        req("open", boolean()),
                        req("removed", boolean()),
                        req("data", record(string(), union(vec![string(), number(), boolean()]))),
                    ]),
                ),
            ),
            req("encounters", record(string(), object(vec![req("started", boolean()), req("ended", boolean()), req("triggered", boolean())]))),
            req("bad", currency()),
        ])
    })
}

/// `saveSchema`. Every format version this build knows is let in - a save is migrated before it is read,
/// and one from a newer build is refused here rather than guessed at.
pub fn save_schema() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        object(vec![
            // `z.union` of the literals 1 to 6: compared as numbers, since a migrated save's 6 may be 6.0.
            req("formatVersion", int().min(1.0).max(6.0)),
            req("projectId", string()),
            req("sceneId", string()),
            req("rng", number()),
            req("scenario", lazy(scenario_snapshot_schema)),
            req("scenes", record(string(), lazy(scene_snapshot_schema))),
            req("selected", nullable(string())),
            def("sheets", array(lazy(sheet_schema)), || json!([])),
            req("log", array(object(vec![req("text", string()), req("tone", one_of(LOG_TONES))]))),
        ])
    })
}

/// A value as `JSON.stringify` writes it: a whole number without `.0`, and no minus on a nought.
pub fn stringify(value: &Value) -> String {
    fn plain(value: &Value) -> Value {
        match value {
            Value::Number(n) => match n.as_f64() {
                Some(x) if x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 => json!(x as i64),
                _ => value.clone(),
            },
            Value::Array(items) => Value::Array(items.iter().map(plain).collect()),
            Value::Object(fields) => Value::Object(fields.iter().map(|(k, v)| (k.clone(), plain(v))).collect()),
            _ => value.clone(),
        }
    }
    serde_json::to_string(&plain(value)).expect("a value writes")
}

impl Session {
    /// Why a save is refused now, or nothing when it can go ahead (`saveBlockedBy`).
    pub fn save_blocked_by(&self) -> Option<&'static str> {
        if self.in_combat() {
            return Some("Not in the middle of a fight.");
        }
        if self.waiting() || !self.talking_aside().is_empty() {
            return Some("Not in the middle of a conversation.");
        }
        None
    }

    /// The campaign as it stands, or nothing when this moment refuses (`saveGame`).
    pub fn save_game(&self) -> Option<Value> {
        if self.save_blocked_by().is_some() {
            return None;
        }
        // The rooms already left, and the one being played, which is only in the live state.
        let mut scenes = Map::new();
        for (id, snapshot) in self.snapshots.entries() {
            scenes.insert(id.clone(), snapshot.clone());
        }
        scenes.insert(self.scene["id"].as_str().unwrap_or_default().to_string(), self.world.state.snapshot());
        let sheets: Vec<Value> = self
            .sheets
            .entries()
            .iter()
            .map(|(_, sheet)| sheet_schema().parse(&serde_json::to_value(sheet).expect("a sheet writes")).expect("a sheet in play is a sheet"))
            .collect();
        let from = self.log.len().saturating_sub(SAVED_LOG_LINES);
        Some(json!({
            "formatVersion": CURRENT_FORMAT_VERSION,
            "projectId": self.project["id"],
            "sceneId": self.scene["id"],
            "rng": self.rng.save(),
            "scenario": self.world.scenario.snapshot(),
            "scenes": scenes,
            "selected": self.party.selected(),
            "sheets": sheets,
            "log": serde_json::to_value(&self.log[from..]).expect("lines write"),
        }))
    }

    /// The save as text, as `JSON.stringify` writes it (`serialiseSave`).
    pub fn serialise_save(&self) -> Option<String> {
        self.save_game().map(|save| stringify(&save))
    }

    /// Put a saved campaign back (`loadGame`). Every refusal gets its chance before the game being played is
    /// touched - but for a sheet that will not derive, which is found after the scenario is refilled, as the
    /// TypeScript finds it.
    pub fn load_game(&mut self, save: &Value) -> Result<(), String> {
        let project_id = save["projectId"].as_str().unwrap_or_default();
        if Some(project_id) != self.project["id"].as_str() {
            return Err(format!("this save belongs to project \"{project_id}\""));
        }
        let scene_id = save["sceneId"].as_str().unwrap_or_default().to_string();
        let Some(current) = save["scenes"].get(&scene_id).cloned() else { return Err(format!("the save has no state for scene \"{scene_id}\"")) };
        let known = self.project["scenes"].as_array().is_some_and(|scenes| scenes.iter().any(|s| s["id"] == scene_id.as_str()));
        if !known {
            return Err(format!("this project has no scene \"{scene_id}\""));
        }

        self.world.scenario.restore(&save["scenario"])?;
        let sheets: Vec<CharacterSheet> = save["sheets"].as_array().map_or(Ok(Vec::new()), |list| list.iter().map(|s| serde_json::from_value(s.clone())).collect()).map_err(|e| e.to_string())?;
        let content = character_content_for(self.shipped(), &self.project);
        let abilities = abilities_of(&self.project);
        for sheet in &sheets {
            let (_, issues) = derive_character(sheet, &content, &abilities);
            if let Some(issue) = issues.first() {
                return Err(format!("{}'s sheet: {}", sheet.name, issue.message));
            }
        }
        for sheet in sheets {
            // Somebody who joined after the project was written is on the saved board with no sheet in this
            // document: the save's sheet is the one they have, and it goes into the document.
            if self.sheets.get(&sheet.id).is_none() {
                self.sheets.set(&sheet.id.clone(), sheet.clone());
                let listed = self.project["party"].as_array().is_some_and(|party| party.iter().any(|s| s["id"] == sheet.id.as_str()));
                if !listed {
                    let parsed = sheet_schema().parse(&serde_json::to_value(&sheet).map_err(|e| e.to_string())?).map_err(|issues| format!("{issues:?}"))?;
                    if let Some(party) = self.project["party"].as_array_mut() {
                        party.push(parsed);
                    }
                }
            }
            self.set_sheet(sheet)?;
        }
        self.enter_saved_scene(&scene_id, &current)?;

        self.snapshots = Default::default();
        if let Some(scenes) = save["scenes"].as_object() {
            for (id, snapshot) in scenes {
                if *id != scene_id {
                    self.snapshots.set(id, snapshot.clone());
                }
            }
        }
        self.rng.restore(crate::rng::to_uint32(save["rng"].as_f64().unwrap_or(0.0)));
        self.log = save["log"].as_array().map_or(Vec::new(), |lines| lines.iter().map(LogLine::read).collect());
        if let Some(selected) = save["selected"].as_str() {
            if self.party.members(&self.world.state).iter().any(|m| m == selected) {
                self.party.select(&self.world.state, selected);
            }
        }
        Ok(())
    }

    /// Parse, migrate and load in one step, a malformed save reported rather than thrown (`loadGameText`).
    pub fn load_game_text(&mut self, text: &str) -> Result<(), String> {
        let Ok(parsed) = serde_json::from_str::<Value>(text) else { return Err("this is not a save file".into()) };
        let Ok(save) = save_schema().parse(&migrate_document(&parsed)) else { return Err("this save is damaged or from a newer build".into()) };
        self.load_game(&save)
    }
}
