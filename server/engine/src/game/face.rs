//! The face a game is asked through (`docs/SERVER.md`, phase 3): one JSON message, one answer - whether the
//! game is the engine built to WebAssembly in the page (`server/wasm`) or one of the server's (`serve::play`).
//! The message is one of
//!
//! - `{ "op": "build", "project", "shipped", "seed", "animated", "askDefender" }` - a game stood up from a
//!   project, its walks drawn or not, its defender asked or not;
//! - `{ "op": "restore", "replica" }` - told how the game stands;
//! - `{ "op": "call", "call", "args" }` - an intent, by the page's name for it (`game/dispatch.rs`);
//! - `{ "op": "ask", "ask": ..., ... }` - asked: `reach`, `pressure`, `preview` (`destination`, `aim`, `from`),
//!   `targets`, `tiles` (`id`, `ability`), `shape` (`id`, `ability`, `tile`), `jumpOffered`, `jumpAim`,
//!   `jumpReaches` (`id`, `destination`, `aim`);
//!
//! answered with what the game said, or why not. Whoever holds the game keeps it in a slot of its own and
//! hands it in with the hooks a game is built with: the page's own JavaScript, or QuickJS.

use super::content::Shipped;
use super::session::{HooksFor, Session};
use crate::grid::tile_grid::Spot;
use serde_json::{json, Value};
use std::rc::Rc;

fn text<'a>(message: &'a Value, key: &str) -> Result<&'a str, String> {
    message[key].as_str().ok_or_else(|| format!("no {key}"))
}

fn tile(message: &Value, key: &str) -> Result<i32, String> {
    message[key].as_i64().map(|t| t as i32).ok_or_else(|| format!("no {key}"))
}

fn spot(message: &Value, key: &str) -> Result<Option<Spot>, String> {
    match &message[key] {
        Value::Null => Ok(None),
        value => serde_json::from_value(value.clone()).map(Some).map_err(|e| format!("{key}: {e}")),
    }
}

fn to(value: impl serde::Serialize) -> Value {
    serde_json::to_value(value).expect("an answer writes")
}

/// A message answered, over the game in `slot`: a build puts one there, everything else asks it.
pub fn respond(slot: &mut Option<Session>, message: &Value, hooks_for: HooksFor) -> Result<Value, String> {
    match text(message, "op")? {
        "build" => {
            let shipped: Shipped = serde_json::from_value(message["shipped"].clone()).map_err(|e| format!("shipped: {e}"))?;
            let mut session = Session::build(&message["project"], Rc::new(shipped), hooks_for, text(message, "seed")?)?;
            session.animated = message["animated"] == true;
            session.ask_defender = message["askDefender"] == true;
            *slot = Some(session);
            Ok(Value::Null)
        }
        op => {
            let session = slot.as_mut().ok_or("no game: build one first")?;
            match op {
                "restore" => session.restore_replica(&message["replica"]).map(|()| Value::Null),
                "call" => session.dispatch(text(message, "call")?, message["args"].as_array().map_or(&[][..], Vec::as_slice)),
                "ask" => ask(session, message),
                other => Err(format!("no op \"{other}\"")),
            }
        }
    }
}

/// What the pointer asks, of the replica as it stands.
fn ask(session: &mut Session, message: &Value) -> Result<Value, String> {
    let card = |session: &Session| -> Result<(String, crate::content::abilities::AbilityDef), String> {
        let id = text(message, "id")?.to_string();
        let ability = text(message, "ability")?;
        let def = session.abilities_of(&id).into_iter().find(|a| a.id == ability).ok_or_else(|| format!("{id} has no {ability}"))?;
        Ok((id, def))
    };
    Ok(match text(message, "ask")? {
        "reach" => {
            let field = session.reachable_tiles(message["budget"].as_f64());
            let tiles = field.tiles();
            let number = |n: f64| if n.is_finite() { json!(n) } else { Value::Null };
            let cost: Vec<Value> = tiles.iter().map(|&t| number(field.cost_to(t))).collect();
            json!({ "start": field.start(), "budget": number(field.budget()), "tiles": tiles, "cost": cost })
        }
        "pressure" => json!(session.under_pressure_tiles()),
        "preview" => {
            let aim = spot(message, "aim")?.ok_or("no aim")?;
            to(session.preview_walk(tile(message, "destination")?, aim, spot(message, "from")?))
        }
        "targets" => {
            let (id, def) = card(session)?;
            json!(session.ability_targets(&id, &def))
        }
        "tiles" => {
            let (id, def) = card(session)?;
            json!(session.point_tiles(&id, &def))
        }
        "shape" => {
            let (id, def) = card(session)?;
            json!(session.shape_at(&id, &def, tile(message, "tile")?))
        }
        "jumpOffered" => json!(session.jump_offered()),
        "jumpAim" => json!(session.jump_aim()),
        "jumpReaches" => json!(session.jump_reaches(text(message, "id")?, tile(message, "destination")?, spot(message, "aim")?)),
        other => return Err(format!("no question \"{other}\"")),
    })
}

