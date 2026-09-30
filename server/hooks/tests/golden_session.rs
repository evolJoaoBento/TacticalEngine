//! `server/fixtures/session.json` replayed: every game the TypeScript stood up from a project and played
//! between actions - travel, the roster, sheets written back, wounds, the party gathered, a save loaded, the
//! world rebuilt, the log written - played again by a Rust session handed the same shipped content, with the
//! project's hooks compiled in QuickJS by a factory that keeps its last compile, as `hooksFor` does. After
//! each step, the room, everybody in it, the party, the rooms remembered, the log's new lines, the world's
//! content and the scenario, as the TypeScript had them.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::character::sheet::CharacterSheet;
use engine::game::content::Shipped;
use engine::game::log::note;
use engine::game::session::{HooksFor, Session};
use engine::js;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use hooks::QuickJsHooks;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;
use support::{fixture, from, same, to};

/// Hooks as the page keeps them: nothing for a project with no code, else compiled once per what the code says.
fn hooks_for() -> HooksFor {
    let last: RefCell<Option<(String, Rc<dyn Hooks>)>> = RefCell::new(None);
    Rc::new(move |code: &[CodeSource]| -> Rc<dyn Hooks> {
        if code.is_empty() {
            return Rc::new(NoHooks);
        }
        let signature = code.iter().map(|c| format!("{}\u{0}{}", c.id, c.source)).collect::<Vec<_>>().join("\u{1}");
        if let Some((seen, hooks)) = last.borrow().as_ref() {
            if *seen == signature {
                return Rc::clone(hooks);
            }
        }
        let (hooks, _) = QuickJsHooks::compile(code);
        let hooks: Rc<dyn Hooks> = Rc::new(hooks);
        *last.borrow_mut() = Some((signature, Rc::clone(&hooks)));
        hooks
    })
}

/// Where two answers first part: the path to it, and each side there.
fn first_difference(a: &Value, b: &Value, at: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for key in x.keys().chain(y.keys()) {
                let (p, q) = (x.get(key).unwrap_or(&Value::Null), y.get(key).unwrap_or(&Value::Null));
                if let Some(found) = first_difference(p, q, &format!("{at}.{key}")) {
                    return Some(found);
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x.iter().zip(y).enumerate().find_map(|(i, (p, q))| first_difference(p, q, &format!("{at}[{i}]"))),
        _ if same(a, b) => None,
        _ => Some(format!("{at}: rust {a} / typescript {b}")),
    }
}

macro_rules! held {
    ($got:expr, $wanted:expr, $($what:tt)*) => {{
        let (got, wanted): (Value, &Value) = ($got, $wanted);
        if let Some(found) = first_difference(&got, wanted, "") {
            panic!("{}: {}", format!($($what)*), found);
        }
    }};
}

fn content_view(session: &Session) -> Value {
    let content = session.world.content();
    let mut listed: Vec<&String> = content.characters.keys().collect();
    let mut ours: Vec<&String> = session.characters.entries().iter().map(|(id, _)| id).collect();
    listed.sort();
    ours.sort();
    assert_eq!(listed, ours, "the world reads the party the session holds");
    let traits: serde_json::Map<String, Value> = content.traits.iter().map(|(t, v)| (t.name().to_string(), json!(v))).collect();
    let mut adversaries: Vec<(&String, &String, f64)> = content.adversaries.iter().map(|(id, a)| (id, &a.name, a.hit_points)).collect();
    adversaries.sort_by(|a, b| js::utf16_cmp(a.0, b.0));
    let characters: Vec<Value> = session
        .characters
        .entries()
        .iter()
        .map(|(id, _)| {
            let c = &content.characters[id];
            json!([id, c.evasion, c.armor_score, c.hit_points, c.stress])
        })
        .collect();
    let mut conditions: Vec<(&String, &String)> = content.condition_defs.iter().map(|(id, def)| (id, &def.name)).collect();
    conditions.sort_by(|a, b| js::utf16_cmp(a.0, b.0));
    let movement = content.movement.map(|m| json!({ "maxStepHeight": if m.max_step_height.is_finite() { json!(m.max_step_height) } else { Value::Null }, "diagonals": m.diagonals, "diagonalCostMultiplier": m.diagonal_cost_multiplier }));
    json!({
        "traits": traits,
        "characters": characters,
        "adversaries": adversaries.iter().map(|(id, name, hp)| json!([id, name, hp])).collect::<Vec<_>>(),
        "bandTiles": content.band_tiles.map(|b| json!({ "melee": b.melee, "veryClose": b.very_close, "close": b.close, "far": b.far, "veryFar": b.very_far })),
        "conditions": conditions.iter().map(|(id, name)| json!([id, name])).collect::<Vec<_>>(),
        "abilities": content.abilities.iter().map(|a| &a.id).collect::<Vec<_>>(),
        "cards": content.cards.as_ref().map(|cards| cards.iter().map(|c| &c.id).collect::<Vec<_>>()),
        "movement": movement,
    })
}

/// A view held to the TypeScript's, its content written `same` where it has not changed since the last one
/// written - which the Rust's must not have either.
fn hold_view(session: &Session, since: usize, wanted: &Value, last: &mut Value, at: &str) {
    let mut got = view(session, since);
    let content = got["content"].take();
    if wanted["content"] == "same" {
        held!(content, last, "{at}: the world's content, unchanged");
    } else {
        held!(content.clone(), &wanted["content"], "{at}: the world's content");
        *last = content;
    }
    let mut wanted = wanted.clone();
    wanted["content"] = Value::Null;
    held!(got, &wanted, "{at}");
}

fn view(session: &Session, since: usize) -> Value {
    let state = session.state();
    let entities: Vec<Value> = state
        .all_entities()
        .iter()
        .map(|e| json!([e.id, e.faction, e.definition, e.tile, e.at.x, e.at.y, e.alive, e.hit_points, e.stress, e.armor_slots, e.good, e.name]))
        .collect();
    let derived: Vec<Value> = session.characters.values().map(|c| json!([c.sheet.id, c.evasion, c.hit_points, c.stress, c.armor_score, c.proficiency])).collect();
    json!({
        "scene": session.scene["id"],
        "entities": entities,
        "selected": session.party.selected(),
        "reach": session.party.options().combat_reach,
        "members": session.party.members(state),
        "derived": derived,
        "sheets": session.sheets.entries().iter().map(|(id, _)| id).collect::<Vec<_>>(),
        "party": session.project["party"].as_array().unwrap().iter().map(|s| json!([s["id"], s["armorId"], s["traits"]["agility"], s["traits"]["strength"]])).collect::<Vec<_>>(),
        "snapshots": session.snapshots.entries().iter().map(|(id, _)| id).collect::<Vec<_>>(),
        "synced": session.synced_placements.entries().iter().map(|(scene, ids)| json!([scene, ids])).collect::<Vec<_>>(),
        "triggers": (0..state.grid.size()).filter_map(|t| session.triggers.at(t).map(|e| json!([t, e]))).collect::<Vec<_>>(),
        "bad": state.bad,
        "log": to(&session.log[since.min(session.log.len())..].to_vec()),
        "content": content_view(session),
        "scenario": session.world.scenario.snapshot(),
    })
}

#[test]
fn every_game_plays_as_the_browser_played_it() {
    let fixture = fixture("session.json");
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let projects = fixture["projects"].as_array().unwrap();
    let mut steps = 0;
    for played in fixture["sessions"].as_array().unwrap() {
        let name = played["name"].as_str().unwrap();
        let project = &projects[played["project"].as_u64().unwrap() as usize];
        let mut session = Session::build(project, Rc::clone(&shipped), hooks_for(), &format!("session:{name}")).expect("a game");
        let mut last = Value::Null;
        hold_view(&session, 0, &played["start"], &mut last, &format!("{name}: stood up"));
        for (n, op) in played["ops"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, step {n}: {}", op["op"]);
            let since = session.log.len();
            let result = match op["op"].as_str().unwrap() {
                "travel" => json!(session.travel_to(op["scene"].as_str().unwrap()).expect("a room")),
                "join" => {
                    session.project["party"].as_array_mut().unwrap().push(op["sheet"].clone());
                    let (joined, left) = session.sync_roster().expect("a roster");
                    json!({ "joined": joined, "left": left })
                }
                "leave" => {
                    let index = op["index"].as_i64().unwrap();
                    if index >= 0 {
                        session.project["party"].as_array_mut().unwrap().remove(index as usize);
                    }
                    let (joined, left) = session.sync_roster().expect("a roster");
                    json!({ "joined": joined, "left": left })
                }
                "setSheet" => {
                    if let Some(id) = op["marked"].as_str() {
                        let entity = session.world.state.entity_mut(id).unwrap();
                        entity.armor_slots.marked = entity.armor_slots.max;
                    }
                    let sheet: CharacterSheet = from(&op["sheet"]);
                    session.set_sheet(sheet).expect("a sheet");
                    session.sync_pools();
                    Value::Null
                }
                "wound" => {
                    if let Some(id) = op["id"].as_str() {
                        let entity = session.world.state.entity_mut(id).unwrap();
                        entity.hit_points.marked = op["hitPoints"].as_f64().unwrap();
                        entity.stress.marked = op["stress"].as_f64().unwrap();
                        entity.armor_slots.marked = op["armorSlots"].as_f64().unwrap();
                        session.world.state.bad.value = op["bad"].as_f64().unwrap();
                    }
                    Value::Null
                }
                "gather" => {
                    session.gather_party(op["tile"].as_i64().unwrap() as i32);
                    Value::Null
                }
                "save" => Value::Null,
                "overlap" => {
                    for sheet in op["sheets"].as_array().unwrap() {
                        session.set_sheet(from(sheet)).expect("a sheet");
                    }
                    note(&mut session, "Ünïcø Bo Rin Ek", "narration");
                    Value::Null
                }
                "disband" => {
                    session.project["party"] = json!([]);
                    let (joined, left) = session.sync_roster().expect("a roster");
                    let gone = json!({ "joined": joined, "left": left });
                    if op["sheet"].is_null() {
                        held!(json!([gone, null]), &op["result"], "{at}");
                        hold_view(&session, since, &op["after"], &mut last, &format!("{at}: after"));
                        steps += 1;
                        continue;
                    }
                    session.project["party"].as_array_mut().unwrap().push(op["sheet"].clone());
                    let (joined, left) = session.sync_roster().expect("a roster");
                    json!([gone, { "joined": joined, "left": left }])
                }
                "edit" => {
                    // The room's document, as the game and the project both hold it.
                    let id = session.scene["id"].clone();
                    session.scene["encounters"] = op["encounters"].clone();
                    for scene in session.project["scenes"].as_array_mut().unwrap() {
                        if scene["id"] == id {
                            scene["encounters"] = op["encounters"].clone();
                        }
                    }
                    session.sync_authored_encounters().expect("the room agrees");
                    Value::Null
                }
                "load" => json!(session.enter_saved_scene(op["scene"].as_str().unwrap(), &op["snapshot"]).expect("a save")),
                "refresh" => {
                    session.refresh_world();
                    Value::Null
                }
                "note" => {
                    note(&mut session, op["text"].as_str().unwrap(), op["tone"].as_str().unwrap());
                    Value::Null
                }
                "select" => {
                    let state = &session.world.state;
                    json!(session.party.select_next(state))
                }
                "place" => {
                    if let (Some(id), Some(at)) = (op["id"].as_str(), op["at"].as_object()) {
                        session.world.state.place_entity(id, at["x"].as_f64().unwrap(), at["y"].as_f64().unwrap()).unwrap();
                    }
                    Value::Null
                }
                other => panic!("{at}: a step nobody knows: {other}"),
            };
            held!(result, op.get("result").unwrap_or(&Value::Null), "{at}");
            hold_view(&session, since, &op["after"], &mut last, &format!("{at}: after"));
            steps += 1;
        }
    }
    assert!(steps > 250, "{steps}");
}
