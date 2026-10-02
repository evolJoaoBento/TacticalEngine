//! Every intent by its name (`docs/SERVER.md`, phase 3, slice 3b): what the page asks its game to do, as the
//! page's `GameClient` names it, with the arguments it passes and the answer it expects - for the engine built
//! to WebAssembly in the page, and for the server's games (slice 3c). Each is a `Session` method, held to the
//! TypeScript's fixtures; this only reads the arguments and writes the answer in the TypeScript's shape.
//!
//! The test driver's hands (`wound`, `setGood`, `placeAt`...) are here too: the page's local powers, which a
//! game played elsewhere is told of as it is told of any intent.

use super::session::Session;
use crate::character::progression::LevelUpPlan;
use crate::grid::tile_grid::Spot;
use crate::scene::state::ConditionDuration;
use serde_json::{json, Value};

/// `{ ok: true, <key>: value }` or `{ ok: false, reason }`, as the TypeScript answers a refusal.
fn ok_or<T: serde::Serialize>(result: Result<T, String>, key: &str) -> Value {
    match result {
        Ok(value) => json!({ "ok": true, key: value }),
        Err(reason) => json!({ "ok": false, "reason": reason }),
    }
}

fn to(value: impl serde::Serialize) -> Value {
    serde_json::to_value(value).expect("an answer writes")
}

/// The arguments, read as the TypeScript passed them: a missing one is `undefined`.
struct Args<'a>(&'a [Value]);

impl Args<'_> {
    fn get(&self, i: usize) -> &Value {
        self.0.get(i).unwrap_or(&Value::Null)
    }
    fn text(&self, i: usize) -> Result<&str, String> {
        self.get(i).as_str().ok_or_else(|| format!("argument {i}: not text"))
    }
    fn opt_text(&self, i: usize) -> Option<&str> {
        self.get(i).as_str()
    }
    fn tile(&self, i: usize) -> Result<i32, String> {
        self.get(i).as_f64().map(|t| t as i32).ok_or_else(|| format!("argument {i}: not a tile"))
    }
    fn number(&self, i: usize) -> Result<f64, String> {
        self.get(i).as_f64().ok_or_else(|| format!("argument {i}: not a number"))
    }
    fn spot(&self, i: usize) -> Result<Option<Spot>, String> {
        match self.get(i) {
            Value::Null => Ok(None),
            value => serde_json::from_value(value.clone()).map(Some).map_err(|e| format!("argument {i}: {e}")),
        }
    }
    fn texts(&self, i: usize) -> Vec<String> {
        self.get(i).as_array().map_or(Vec::new(), |list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
    }
}

impl Session {
    /// Do what an intent names, and answer as the TypeScript would.
    pub fn dispatch(&mut self, call: &str, args: &[Value]) -> Result<Value, String> {
        let a = Args(args);
        Ok(match call {
            // ---- walking, swinging, the turn ----
            "moveSelectedTo" => to(self.move_selected_to(a.tile(0)?, a.spot(1)?)?),
            "attackWithSelected" => to(self.attack_with_selected(a.text(0)?)?),
            "endTurn" => json!(self.end_turn()?),
            "arrive" => json!(self.arrive()),
            "arrived" => json!(self.arrived()?),
            "cancelApproach" => json!(self.cancel_approach()),
            "approachThenUse" => json!(self.approach_then_use(a.text(0)?)?),
            "jumpTo" => to(self.jump_to(a.text(0)?, a.tile(1)?, a.spot(2)?, a.get(3) == &json!(true))?),
            "startEncounter" => {
                self.start_encounter(a.text(0)?);
                Value::Null
            }
            "travelTo" => json!(self.travel_to(a.text(0)?)?),
            // ---- cards, things, answers ----
            "useAbility" => to(self.use_ability(a.text(0)?, a.text(1)?, &a.texts(2), a.get(3)["point"].as_f64().map(|p| p as i32))?),
            "answerPending" => to(self.answer_pending(a.get(0))?),
            "useSelectedOn" => to(self.use_selected_on(a.text(0)?)?),
            "takeFromContainer" => json!(self.take_from_container(a.text(0)?, a.text(1)?)?),
            "syncTalks" => json!(self.sync_talks()),
            "note" => {
                let line = super::log::note(self, a.text(0)?, a.text(1)?);
                to(vec![line])
            }
            // ---- what the party carries, and the sheets ----
            "equipItem" => ok_or(self.equip_item(a.text(0)?, a.text(1)?), "slot"),
            "unequipItem" => ok_or(self.unequip_item(a.text(0)?, a.text(1)?), "slot"),
            "useItem" => to(self.use_item(a.text(0)?)?),
            "swapCard" => ok_or(self.swap_card(a.text(0)?, a.text(1)?, a.opt_text(2), a.get(3)["resting"] == true), "stress"),
            "rest" => ok_or(self.rest(a.text(0)? == "long", a.get(1)), "badGained"),
            "applyLevelUp" => {
                let plan: LevelUpPlan = serde_json::from_value(a.get(1).clone()).map_err(|e| format!("a plan: {e}"))?;
                match self.apply_level_up(a.text(0)?, &plan) {
                    Ok(level) => json!({ "ok": true, "level": level }),
                    Err(issues) => json!({ "ok": false, "issues": issues }),
                }
            }
            "loadGameText" => match self.load_game_text(a.text(0)?) {
                Ok(()) => json!({ "ok": true }),
                Err(reason) => json!({ "ok": false, "reason": reason }),
            },
            // ---- the party's control ----
            "select" => json!(self.party.select(&self.world.state, a.text(0)?)),
            "selectNext" => json!(self.party.select_next(&self.world.state)),
            "link" => json!(self.party.link(&self.world.state, a.text(0)?, a.text(1)?)),
            "unlink" => json!(self.party.unlink(&self.world.state, a.text(0)?)),
            "dropCard" => json!(self.drop_card(a.text(0)?, a.get(1))?),
            "landWalkers" => {
                // Everyone a cut-short walk put down, at once, each where the page drew them: who was landed.
                let mut landed = Vec::new();
                for walker in a.get(0).as_array().map_or(&[][..], Vec::as_slice) {
                    let (Some(id), Ok(at)) = (walker[0].as_str(), serde_json::from_value::<Spot>(walker[1].clone())) else { continue };
                    if self.party.land_at(&mut self.world.state, id, at) {
                        landed.push(id.to_string());
                    }
                }
                json!(landed)
            }
            "readContainer" => {
                // The window drawn reads what is in it, and a seller's stock read makes the seller's state.
                let id = a.text(0)?;
                if self.shop_of(id).is_some() {
                    self.shop_contents(id);
                    self.sellables(id);
                } else {
                    self.container_contents(id)?;
                }
                Value::Null
            }
            "readThing" => {
                // A thing looked at - the right-click card - reads its state, which makes it.
                self.world.state.interactable(a.text(0)?);
                Value::Null
            }
            "closeContainer" => {
                self.close_container();
                Value::Null
            }
            "sellTo" => json!(self.sell_to(a.text(0)?, a.text(1)?)),
            "abilityList" => to(self.ability_list(a.text(0)?)),
            "landAt" => {
                let at = a.spot(1)?.ok_or("argument 1: no spot")?;
                json!(self.party.land_at(&mut self.world.state, a.text(0)?, at))
            }
            // ---- what a view drains ----
            "takeMotions" => Value::Array(std::mem::take(&mut self.motions)),
            "takeFloaters" => to(std::mem::take(&mut self.floaters)),
            "rollShownAt" => {
                let at = a.number(0)? as usize;
                if at < self.rolls.len() {
                    self.rolls.remove(at);
                }
                Value::Null
            }
            "clearRolls" => {
                self.rolls.clear();
                Value::Null
            }
            // ---- the test driver's hands ----
            "placeAt" => {
                self.world.state.move_entity(a.text(0)?, a.tile(1)?)?;
                Value::Null
            }
            "setGood" => {
                if let Some(entity) = self.world.state.entity_mut(a.text(0)?) {
                    if let Some(good) = entity.good {
                        entity.good = Some(crate::rules::resources::Currency { value: crate::js::max(0.0, crate::js::min(good.max, a.number(1)?)), ..good });
                    }
                }
                Value::Null
            }
            "wound" => {
                if let Some(entity) = self.world.state.entity_mut(a.text(0)?) {
                    entity.hit_points.marked = crate::js::min(entity.hit_points.max, crate::js::max(0.0, a.number(1)?));
                }
                Value::Null
            }
            "markStress" => {
                if let Some(entity) = self.world.state.entity_mut(a.text(0)?) {
                    entity.stress.marked = crate::js::min(entity.stress.max, crate::js::max(0.0, a.number(1)?));
                }
                Value::Null
            }
            "setCondition" => {
                let (id, condition) = (a.text(0)?, a.text(1)?);
                json!(if a.get(2) == &json!(true) { self.world.apply_condition(id, condition, ConditionDuration::Scene) } else { self.world.clear_condition(id, condition) })
            }
            "giveItem" => {
                self.world.add_item(a.text(0)?, a.number(1)?);
                Value::Null
            }
            "grantLevel" => {
                self.world.grant_level(a.get(0).as_f64());
                Value::Null
            }
            "setCards" => {
                let id = a.text(0)?;
                let Some(sheet) = self.sheets.get(id).cloned() else { return Ok(Value::Null) };
                let grown = crate::character::sheet::CharacterSheet { domain_cards: Some(a.texts(1)), loadout: None, ..sheet };
                self.set_sheet(grown)?;
                self.refresh_world();
                Value::Null
            }
            // ---- how the game stands ----
            "board" => self.board(),
            // The save as the game would write it now, and why it may not be (`save.rs`).
            "serialiseSave" => json!(self.serialise_save()),
            "saveBlockedBy" => json!(self.save_blocked_by()),
            "restoreWalk" => {
                // What a replica is not told but a game in step must hold: the fight a walk woke, its errand, the
                // container whose window is open, and the dice still to be shown (the board's `rolls`) when given.
                self.opened = a.opt_text(2).map(str::to_string);
                if let Value::Array(_) = a.get(3) {
                    self.rolls = serde_json::from_value(a.get(3).clone()).map_err(|e| format!("the rolls: {e}"))?;
                }
                self.ambush = a.opt_text(0).map(str::to_string);
                self.approaching = match a.get(1) {
                    Value::Null => None,
                    held => Some(serde_json::from_value(held.clone()).map_err(|e| format!("an errand: {e}"))?),
                };
                Value::Null
            }
            "restoreViews" => {
                // What the page's views have still to draw - the walks, the numbers over heads - which the board
                // does not carry: an engine brought into step holds the same, so the next drain is the same.
                self.motions = a.get(0).as_array().cloned().unwrap_or_default();
                self.floaters = serde_json::from_value(a.get(1).clone()).map_err(|e| format!("the floaters: {e}"))?;
                Value::Null
            }
            "restoreLog" => {
                // The log as the page has it: an engine brought into step holds the same, so a load - which
                // replaces it - leaves the two the same as well.
                self.log = a.get(0).as_array().map(|lines| lines.iter().map(super::log::LogLine::read).collect()).unwrap_or_default();
                Value::Null
            }
            "restoreRng" => {
                self.rng.restore(crate::rng::to_uint32(a.number(0)?));
                Value::Null
            }
            other => return Err(format!("no intent \"{other}\"")),
        })
    }

    /// A portrait dropped on another in the HUD (`dropCard`): set aside, linked and put under them, or put
    /// between two - joining them when they walk together. Whether anything changed.
    fn drop_card(&mut self, id: &str, drop: &Value) -> Result<bool, String> {
        let state = &self.world.state;
        Ok(match drop["kind"].as_str() {
            Some("aside") => self.party.unlink(state, id),
            Some("onto") => {
                let onto = drop["id"].as_str().ok_or("a drop onto nobody")?;
                let linked = self.party.link(state, id, onto);
                let members: Vec<String> = self.party.members(state).into_iter().filter(|other| other != id).collect();
                let under = members.iter().position(|m| m == onto).and_then(|at| members.get(at + 1)).cloned();
                self.party.arrange(state, id, under.as_deref()) || linked
            }
            Some("between") => {
                let (above, below) = (drop["above"].as_str(), drop["below"].as_str());
                let moved = self.party.arrange(state, id, below);
                let joins = match (above, below) {
                    (Some(above), Some(below)) => self.party.linked(state, above, below) && self.party.link(state, id, above),
                    _ => false,
                };
                moved || joins
            }
            other => return Err(format!("no drop \"{}\"", other.unwrap_or("?"))),
        })
    }
}
