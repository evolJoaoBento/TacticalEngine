//! `server/fixtures/walk.json` replayed: every session of clicks the TypeScript walked - moves aimed and
//! beyond reach, into triggers that began their fights and on inside the fights, the lines a click would
//! walk, the ground reached, walks up to things and creatures - walked again by a Rust session with the
//! project's hooks compiled in QuickJS. After each step, its answer, and the fight, the room, everybody in
//! it and what a view is handed, as the TypeScript had them; the view's queues drained after every step as
//! a view drains them.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::game::content::Shipped;
use engine::game::session::{HooksFor, Session};
use engine::grid::tile_grid::{Spot, NO_TILE};
use engine::rules::range::RangeBand;
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
    let open = session.open_container();
    let state = session.state();
    let fight = session.encounter.as_ref().map_or(Value::Null, |e| {
        let circles: Vec<Value> = e.circles().iter().map(|(id, c)| json!([id, c.anchor, c.band])).collect();
        json!({ "id": e.encounter_id, "view": to(&e.view(state)), "log": to(&e.log()), "circles": circles })
    });
    let pending = session.pending.as_ref().map_or(Value::Null, |p| json!({ "prompt": p.prompt, "dialogue": p.dialogue.as_ref().map(|d| d.runner.id().to_string()) }));
    let entities: Vec<Value> = state.all_entities().iter().map(|e| json!([e.id, e.faction, e.tile, e.at.x, e.at.y, e.alive, e.hit_points, e.stress, e.conditions, e.truce])).collect();
    let members = session.party.members(state);
    let seen = json!({
        "scene": session.scene["id"],
        "fight": fight,
        "pending": pending,
        "open": open,
        "aside": session.talking_aside(),
        "selected": session.party.selected(),
        "held": members.iter().filter(|id| session.party.is_held(id)).collect::<Vec<_>>(),
        "entities": entities,
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

fn spot(value: &Value) -> Option<Spot> {
    value.is_object().then(|| from(value))
}

#[test]
fn every_walk_is_walked_as_the_browser_walked_it() {
    let fixture = fixture("walk.json");
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let projects = fixture["projects"].as_array().unwrap();
    let (mut steps, mut fought) = (0, 0);
    for played in fixture["sessions"].as_array().unwrap() {
        let name = played["name"].as_str().unwrap();
        let project = &projects[played["project"].as_u64().unwrap() as usize];
        let mut session = Session::build(project, Rc::clone(&shipped), hooks_for(), &format!("walk:{name}")).expect("a game");
        held!(view(&mut session, 0), &played["start"], "{name}: stood up");
        for (n, step) in played["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, step {n}: {}", step["step"]);
            let since = session.log.len();
            let fighting = session.in_combat();
            let selected = session.party.selected().map(str::to_string);
            let destination = step["destination"].as_i64().map_or(NO_TILE, |t| t as i32);
            let aim = spot(&step["aim"]);
            let result = match step["step"].as_str().unwrap() {
                "probe" => json!(session.aim_of_move(selected.as_deref().unwrap(), destination, aim, fighting).run),
                "move" => {
                    if step["probed"] == true {
                        session.aim_of_move(selected.as_deref().unwrap(), destination, aim, fighting);
                    }
                    to(&session.move_selected_to(destination, aim).unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "preview" => to(&session.preview_walk(destination, aim.unwrap(), None)),
                "reach" => {
                    let field = session.reachable_tiles(step["budget"].as_f64());
                    let tiles = field.tiles();
                    let cost: Vec<Value> = tiles.iter().map(|&t| field.cost_to(t)).map(|c| if c.is_finite() { json!(c) } else { Value::Null }).collect();
                    let budget = if field.budget().is_finite() { json!(field.budget()) } else { Value::Null };
                    let reached = json!({ "start": field.start(), "budget": budget, "tiles": tiles, "cost": cost });
                    held!(json!(session.under_pressure_tiles()), &step["pressure"], "{at}: under pressure");
                    reached
                }
                "approach" => json!(session.approach_then_use(step["id"].as_str().unwrap()).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "talk" => match step["actor"].as_str() {
                    None => Value::Null,
                    Some(actor) => to(&session.talk_to(actor, step["id"].as_str().unwrap()).unwrap_or_else(|e| panic!("{at}: {e}"))),
                },
                "strike" => match (selected.as_deref(), step["id"].as_str()) {
                    (Some(who), Some(id)) => json!(session.close_to_strike(who, id, RangeBand::from_name(step["band"].as_str().unwrap()).unwrap())),
                    _ => Value::Null,
                },
                "previewStrike" => to(&session.preview_strike(step["id"].as_str().unwrap())),
                "use" => to(&session.use_selected_on(step["id"].as_str().unwrap()).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "answer" => to(&session.answer_pending(&step["response"]).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "select" => {
                    let next = session.party.select_next(&session.world.state);
                    held!(json!(next), &step["selected"], "{at}: selected");
                    json!(session.sync_talks())
                }
                "travel" => json!(session.travel_to(step["scene"].as_str().unwrap()).expect("a room")),
                "close" => {
                    session.close_container();
                    Value::Null
                }
                "jumpProbe" => {
                    let leap = session.plan_running_jump(selected.as_deref().unwrap(), destination, aim);
                    json!(leap.map(|l| l.fall_dice))
                }
                "jump" => {
                    if step["probed"] == true {
                        session.plan_running_jump(selected.as_deref().unwrap(), destination, aim);
                    }
                    match selected.as_deref() {
                        None => Value::Null,
                        Some(id) => to(&session.jump_to(id, destination, aim, step["auto"] == true).unwrap_or_else(|e| panic!("{at}: {e}"))),
                    }
                }
                "arc" => match selected.as_deref() {
                    None => Value::Null,
                    Some(id) => to(&session.jump_arc(id, destination, aim)),
                },
                "jumpAim" => json!(session.jump_aim()),
                "shove" => {
                    if let (Some(id), Some(at)) = (step["id"].as_str(), spot(&step["at"])) {
                        session.world.state.place_entity(id, at.x, at.y).expect("a member");
                    }
                    Value::Null
                }
                other => panic!("{at}: a step nobody knows: {other}"),
            };
            let wanted = match step["step"].as_str().unwrap() {
                "select" => &step["moved"],
                "probe" => &step["run"],
                "jumpProbe" => &step["fall"],
                _ => step.get("result").unwrap_or(&Value::Null),
            };
            held!(result, wanted, "{at}");
            held!(view(&mut session, since), &step["after"], "{at}: after");
            if session.in_combat() {
                fought += 1;
            }
            steps += 1;
        }
    }
    assert!(steps > 700 && fought > 50, "{steps} {fought}");
}
