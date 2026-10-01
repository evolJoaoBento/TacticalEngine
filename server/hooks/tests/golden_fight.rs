//! `server/fixtures/fight.json` and `ask.json` replayed: every fight the TypeScript played, with nobody at the
//! table asked and with the table asked - the defence, a card offered, the death move -
//! swings closed on, rolled and landed with everything they set off, the GM's turns (adversaries walking up
//! and swinging, features, reactions to wounds, falls and rolls, countdowns, death moves), walks, the
//! selection, things used and prompts answered - played again by a Rust session with the project's hooks
//! compiled in QuickJS. After each step, its answer, the GM's turn as it stands, the fight, everybody's
//! pools and conditions, the Shadow, the scars and what a view is handed, as the TypeScript had them.

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
    let turn = session.gm_turn.as_ref().map_or(Value::Null, |t| {
        let spotlights: Vec<Value> = session.spotlit.borrow().iter().map(|(id, n)| json!([id, n])).collect();
        json!({ "remaining": t.remaining, "acted": t.acted, "spotlights": spotlights, "features": t.features, "granted": t.granted, "halved": t.halved })
    });
    let pending = match (&session.pending, &session.asked) {
        (Some(p), _) => json!({ "prompt": p.prompt, "dialogue": p.dialogue.as_ref().map(|d| d.runner.id().to_string()) }),
        (None, Some(asked)) => json!({ "kind": asked.kind(), "prompt": asked.prompt() }),
        (None, None) => Value::Null,
    };
    let entities: Vec<Value> = state
        .all_entities()
        .iter()
        .map(|e| json!([e.id, e.faction, e.tile, e.at.x, e.at.y, e.alive, e.dead, e.hit_points, e.stress, e.armor_slots, e.good, e.conditions, e.truce, e.interacted]))
        .collect();
    let scars: Vec<Value> = session.sheets.entries().iter().map(|(id, s)| json!([id, s.scars.unwrap_or(0.0), s.loadout])).collect();
    let seen = json!({
        "scene": session.scene["id"],
        "fight": fight,
        "turn": turn,
        "pending": pending,
        "selected": session.party.selected(),
        "bad": to(&state.bad),
        "entities": entities,
        "scars": scars,
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

#[test]
fn every_fight_is_fought_as_the_browser_fought_it() {
    let (steps, turns, swings) = replay("fight.json");
    assert!(steps > 1000 && turns > 200 && swings > 300, "{steps} {turns} {swings}");
}

#[test]
fn every_question_is_answered_as_the_browser_answered_it() {
    let (steps, turns, swings) = replay("ask.json");
    assert!(steps > 1000 && turns > 80 && swings > 150, "{steps} {turns} {swings}");
}

/// Play every session of a fixture again, step by step: how many steps, turns ended and swings it took.
fn replay(name: &str) -> (usize, usize, usize) {
    let fixture = fixture(name);
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let projects = fixture["projects"].as_array().unwrap();
    let (mut steps, mut turns, mut swings) = (0, 0, 0);
    for played in fixture["sessions"].as_array().unwrap() {
        let name = played["name"].as_str().unwrap();
        let project = &projects[played["project"].as_u64().unwrap() as usize];
        let mut session = Session::build(project, Rc::clone(&shipped), hooks_for(), &format!("fight:{name}")).expect("a game");
        session.ask_defender = played["asks"] == true;
        held!(view(&mut session, 0), &played["start"], "{name}: stood up");
        for (n, step) in played["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, step {n}: {}", step["step"]);
            let since = session.log.len();
            let result = match step["step"].as_str().unwrap() {
                "setup" => {
                    let stand = step["stand"].as_str().unwrap();
                    session.world.state.entity_mut(stand).expect("a member").add_condition("last-stand");
                    session.world.state.entity_mut(step["warded"].as_str().unwrap()).expect("a member").add_condition("pit-aura");
                    session.world.state.entity_mut(step["lucky"].as_str().unwrap()).expect("a member").add_condition("pit-luck");
                    session.world.state.entity_mut(step["bait"].as_str().unwrap()).expect("a member").add_condition("pit-bait");
                    session.world.state.bad.value = step["bad"].as_f64().unwrap();
                    session.start_encounter("the-pit");
                    Value::Null
                }
                "wound" => {
                    for id in step["ids"].as_array().unwrap().iter().filter_map(Value::as_str) {
                        let member = session.world.state.entity_mut(id).expect("a member");
                        member.hit_points.marked = member.hit_points.max - 1.0;
                    }
                    Value::Null
                }
                "hold" => {
                    if let Some(held) = session.world.state.entity_mut(step["id"].as_str().unwrap()) {
                        held.add_condition("restrained");
                        held.condition_durations.retain(|(c, _)| c != "restrained");
                        held.condition_durations.push(("restrained".into(), engine::scene::state::ConditionDuration::Temporary));
                    }
                    Value::Null
                }
                "fight" => {
                    if let Some(id) = step["id"].as_str() {
                        session.start_encounter(id);
                    }
                    Value::Null
                }
                "attack" => {
                    swings += 1;
                    to(&session.attack_with_selected(step["id"].as_str().unwrap()).unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "endTurn" => {
                    turns += 1;
                    json!(session.end_turn().unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "move" => {
                    let destination = step["destination"].as_i64().map_or(NO_TILE, |t| t as i32);
                    to(&session.move_selected_to(destination, None).unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "approach" | "lever" => json!(session.approach_then_use(step["id"].as_str().unwrap()).unwrap_or_else(|e| panic!("{at}: {e}"))),
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
    (steps, turns, swings)
}
