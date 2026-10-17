//! `server/fixtures/play.json` replayed: every session the TypeScript played with a room's things and its
//! creatures out of a fight - things used, prompts answered, conversations had, set aside and brought back,
//! containers read and taken from, travel by script, portal and door - played again by a Rust session with
//! the project's hooks compiled in QuickJS. After each step, its answer, the prompt waiting, where the
//! party is sent, the window open, everybody's place and pools, the log's new lines, what a view is handed,
//! the room's things and the scenario, as the TypeScript had them.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::game::content::Shipped;
use engine::game::session::{HooksFor, Session};
use engine::grid::tile_grid::NO_TILE;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use hooks::QuickJsHooks;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;
use support::{fixture, from, same, to};

/// Hooks as the page keeps them: nothing for a project with no code, else compiled once per what it says.
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

struct Marks {
    log: usize,
    floaters: usize,
    motions: usize,
    rolls: usize,
}

fn marks(session: &Session) -> Marks {
    Marks { log: session.log.len(), floaters: session.floaters.len(), motions: session.motions.len(), rolls: session.rolls.len() }
}

fn pending_view(session: &Session) -> Value {
    let Some(p) = &session.pending else { return Value::Null };
    let dialogue = p.dialogue.as_ref().map_or(Value::Null, |d| {
        let view = d.view.as_ref().map_or(Value::Null, |v| json!({ "node": d.runner.node_id(v), "options": to(&v.options) }));
        json!({ "id": d.runner.id(), "recorded": d.recorded, "by": d.by, "spokenNode": d.spoken_node, "prompt": d.prompt, "view": view })
    });
    json!({ "prompt": p.prompt, "interactable": p.interactable, "recorded": p.recorded, "with": p.with, "dialogue": dialogue })
}

fn view(session: &mut Session, since: &Marks) -> Value {
    let open = session.open_container();
    let contents = match &open {
        Some(id) if session.shop_of(id).is_none() => json!(session.container_contents(id).expect("a container").iter().map(|(item, name, count)| json!([item, name, count])).collect::<Vec<_>>()),
        _ => Value::Null,
    };
    let state = session.state();
    let entities: Vec<Value> = state.all_entities().iter().map(|e| json!([e.id, e.faction, e.tile, e.at.x, e.at.y, e.alive, e.hit_points, e.stress, e.good, e.conditions])).collect();
    let members = session.party.members(state);
    json!({
        "scene": session.scene["id"],
        "pending": pending_view(session),
        "destination": session.destination,
        "open": open,
        "contents": contents,
        "aside": session.talking_aside(),
        "selected": session.party.selected(),
        "held": members.iter().filter(|id| session.party.is_held(id)).collect::<Vec<_>>(),
        "entities": entities,
        "log": to(&session.log[since.log..].to_vec()),
        "floaters": to(&session.floaters[since.floaters..].to_vec()),
        "motions": session.motions[since.motions..].to_vec(),
        "rolls": to(&session.rolls[since.rolls..].to_vec()),
        "things": state.snapshot()["interactables"],
        "scenario": session.world.scenario.snapshot(),
    })
}

fn tile(value: &Value) -> Option<i32> {
    value.as_i64().map(|t| t as i32).filter(|&t| t != NO_TILE)
}

#[test]
fn every_thing_is_used_as_the_browser_used_it() {
    let fixture = fixture("play.json");
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let projects = fixture["projects"].as_array().unwrap();
    let mut steps = 0;
    for played in fixture["sessions"].as_array().unwrap() {
        let name = played["name"].as_str().unwrap();
        let project = &projects[played["project"].as_u64().unwrap() as usize];
        let mut session = Session::build(project, Rc::clone(&shipped), hooks_for(), &format!("play:{name}")).expect("a game");
        let start = marks(&session);
        held!(view(&mut session, &start), &played["start"], "{name}: stood up");
        for (n, step) in played["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, step {n}: {}", step["step"]);
            let since = marks(&session);
            let result = match step["step"].as_str().unwrap() {
                "use" => {
                    if let Some(tile) = tile(&step["gather"]) {
                        session.gather_party(tile);
                    }
                    to(&session.use_selected_on(step["id"].as_str().unwrap()).unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "answer" => to(&session.answer_pending(&step["response"]).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "talk" => {
                    if let Some(tile) = tile(&step["gather"]) {
                        session.gather_party(tile);
                    }
                    match step["actor"].as_str() {
                        None => Value::Null,
                        Some(actor) => to(&session.talk_now(actor, step["id"].as_str().unwrap()).unwrap_or_else(|e| panic!("{at}: {e}"))),
                    }
                }
                "select" => {
                    let selected = session.party.select_next(&session.world.state);
                    let moved = session.sync_talks();
                    held!(json!(selected), &step["selected"], "{at}: selected");
                    json!(moved)
                }
                "pick" => {
                    let picked = session.party.select(&session.world.state, step["id"].as_str().unwrap());
                    held!(json!(picked), &step["result"], "{at}: picked");
                    json!(session.sync_talks())
                }
                "take" => match step["id"].as_str() {
                    Some(id) if session.shop_of(id).is_none() => json!(session.take_from_container(id, step["item"].as_str().unwrap()).expect("a container")),
                    _ => Value::Null,
                },
                "close" => {
                    session.close_container();
                    Value::Null
                }
                "travel" => json!(session.travel_to(step["scene"].as_str().unwrap()).expect("a room")),
                other => panic!("{at}: a step nobody knows: {other}"),
            };
            let wanted = if step["step"] == "select" || step["step"] == "pick" { &step["moved"] } else { step.get("result").unwrap_or(&Value::Null) };
            held!(result, wanted, "{at}");
            held!(view(&mut session, &since), &step["after"], "{at}: after");
            steps += 1;
        }
    }
    assert!(steps > 500, "{steps}");
}
