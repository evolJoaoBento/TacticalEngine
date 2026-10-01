//! `server/fixtures/bar.json` replayed: every card the TypeScript's party used from the action bar - the
//! bar as it stood, whom a card aimed at the ground would catch, the card used on a pick, a tile or nothing,
//! its roll answered or stepped back from, tokens placed again - with the fight going on around it, played
//! again by a Rust session with the project's hooks compiled in QuickJS, step for step.

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

/// What happened, and then the view's queues drained.
fn view(session: &mut Session, since: usize) -> Value {
    let state = session.state();
    let fight = session.encounter.as_ref().map_or(Value::Null, |e| {
        let circles: Vec<Value> = e.circles().iter().map(|(id, c)| json!([id, c.anchor, c.band])).collect();
        json!({ "id": e.encounter_id, "view": to(&e.view(state)), "log": to(&e.log()), "circles": circles })
    });
    let pending = match (&session.pending, &session.asked) {
        (Some(p), _) => json!({ "prompt": p.prompt, "dialogue": p.dialogue.as_ref().map(|d| d.runner.id().to_string()) }),
        (None, Some(asked)) => json!({ "kind": asked.kind(), "prompt": asked.prompt() }),
        (None, None) => Value::Null,
    };
    let entities: Vec<Value> = state
        .all_entities()
        .iter()
        .map(|e| json!([e.id, e.faction, e.tile, e.at.x, e.at.y, e.alive, e.dead, e.hit_points, e.stress, e.armor_slots, e.good, e.conditions, e.truce]))
        .collect();
    let sheets: Vec<Value> = session.sheets.entries().iter().map(|(id, s)| json!([id, s.loadout])).collect();
    let seen = json!({
        "scene": session.scene["id"],
        "fight": fight,
        "pending": pending,
        "selected": session.party.selected(),
        "bad": to(&state.bad),
        "entities": entities,
        "sheets": sheets,
        "log": to(&session.log[since..].to_vec()),
        "floaters": to(&session.floaters),
        "motions": session.motions,
        "rolls": to(&session.rolls),
        "things": state.snapshot()["interactables"],
        "scenario": session.world.scenario.snapshot(),
    });
    session.floaters.clear();
    session.motions.clear();
    session.rolls.clear();
    seen
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().map_or(Vec::new(), |list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
}

#[test]
fn every_card_is_used_as_the_browser_used_it() {
    let fixture = fixture("bar.json");
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let projects = fixture["projects"].as_array().unwrap();
    let (mut steps, mut used) = (0, 0);
    for played in fixture["sessions"].as_array().unwrap() {
        let name = played["name"].as_str().unwrap();
        let project = &projects[played["project"].as_u64().unwrap() as usize];
        let mut session = Session::build(project, Rc::clone(&shipped), hooks_for(), &format!("bar:{name}")).expect("a game");
        session.ask_defender = played["asks"] == true;
        held!(view(&mut session, 0), &played["start"], "{name}: stood up");
        for (n, step) in played["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, step {n}: {}", step["step"]);
            let since = session.log.len();
            let result = match step["step"].as_str().unwrap() {
                "list" => match step["id"].as_str() {
                    None => Value::Null,
                    Some(id) => to(&session.ability_list(id)),
                },
                "use" => match (step["id"].as_str(), step["ability"].as_str()) {
                    (Some(id), Some(ability)) => {
                        used += 1;
                        // The writer reads the bar for a pick first, and the bar's reads leave the actor set.
                        session.ability_list(id);
                        let point = step["point"].as_i64().map(|p| p as i32);
                        to(&session.use_ability(id, ability, &strings(&step["targets"]), point).unwrap_or_else(|e| panic!("{at}: {e}")))
                    }
                    _ => Value::Null,
                },
                "shape" => match (step["id"].as_str(), step["ability"].as_str()) {
                    (Some(id), Some(ability)) => {
                        let def = session.abilities_of(id).into_iter().find(|a| a.id == ability).expect("a card of theirs");
                        held!(json!(session.point_tiles(id, &def).len()), &step["tiles"], "{at}: tiles");
                        match step["tile"].as_i64() {
                            None => Value::Null,
                            Some(tile) => json!(session.shape_at(id, &def, tile as i32)),
                        }
                    }
                    _ => Value::Null,
                },
                "strain" => {
                    let body = session.world.state.entity_mut(step["id"].as_str().unwrap()).expect("a member");
                    body.stress.marked = body.stress.max;
                    Value::Null
                }
                "fell" => {
                    let body = session.world.state.entity_mut(step["id"].as_str().unwrap()).expect("a member");
                    body.hit_points.marked = body.hit_points.max;
                    body.alive = false;
                    Value::Null
                }
                "refill" => {
                    let events = strings(&step["events"]);
                    session.refill_tokens(&events.iter().map(String::as_str).collect::<Vec<_>>());
                    Value::Null
                }
                "fight" => {
                    if let Some(id) = step["id"].as_str() {
                        session.start_encounter(id);
                    }
                    Value::Null
                }
                "attack" => to(&session.attack_with_selected(step["id"].as_str().unwrap()).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "endTurn" => json!(session.end_turn().unwrap_or_else(|e| panic!("{at}: {e}"))),
                "move" => {
                    let destination = step["destination"].as_i64().map_or(NO_TILE, |t| t as i32);
                    to(&session.move_selected_to(destination, None).unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "answer" => to(&session.answer_pending(&step["response"]).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "select" => {
                    let next = session.party.select_next(&session.world.state);
                    held!(json!(next), &step["selected"], "{at}: selected");
                    json!(session.sync_talks())
                }
                other => panic!("{at}: a step nobody knows: {other}"),
            };
            let wanted = match step["step"].as_str().unwrap() {
                "select" => &step["moved"],
                _ => step.get("result").unwrap_or(&Value::Null),
            };
            held!(result, wanted, "{at}");
            held!(view(&mut session, since), &step["after"], "{at}: after");
            steps += 1;
        }
    }
    assert!(steps > 800 && used > 200, "{steps} {used}");
}
