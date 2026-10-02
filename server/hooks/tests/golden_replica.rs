//! `server/fixtures/replica.json` replayed: how the TypeScript's game stood after every step of sessions played
//! in it - the room, the scenario, the sheets, the party's control, the fight and its spotlights, whether a
//! question was open - each stood up in a fresh Rust session, which must then say the game stands the same
//! (`replica_snapshot`) and answer what the pointer asks as the TypeScript answered it: the ground a walk
//! reaches and where a push would ask a roll, the line a click would walk, whom each card may be aimed at,
//! where one aimed at the ground may land and whom it would catch, and where a jump goes.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::game::content::Shipped;
use engine::game::session::{HooksFor, Session};
use engine::grid::tile_grid::Spot;
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

fn spot(value: &Value) -> Option<Spot> {
    value.is_object().then(|| from(value))
}

fn tile(value: &Value) -> i32 {
    value.as_i64().expect("a tile") as i32
}

#[test]
fn a_replica_stands_and_answers_as_the_game_it_was_sent() {
    let fixture = fixture("replica.json");
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let projects = fixture["projects"].as_array().unwrap();
    let hooks = hooks_for();
    let (mut steps, mut asked, mut fighting) = (0, 0, 0);
    for played in fixture["sessions"].as_array().unwrap() {
        let name = played["name"].as_str().unwrap();
        let project = &projects[played["project"].as_u64().unwrap() as usize];
        for (n, step) in played["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, step {n}");
            // Fresh every step: a restore that left anything to the session it landed in would pass on a
            // continued one and fail here.
            let mut session = Session::build(project, Rc::clone(&shipped), Rc::clone(&hooks), &format!("replica:{name}")).expect("a game");
            session.restore_replica(&step["replica"]).unwrap_or_else(|e| panic!("{at}: {e}"));
            held!(session.replica_snapshot(), &step["replica"], "{at}: stands as it was sent");
            if session.encounter.is_some() {
                fighting += 1;
            }
            let asks = &step["asks"];
            let field = session.reachable_tiles(None);
            let tiles = field.tiles();
            let cost: Vec<Value> = tiles.iter().map(|&t| field.cost_to(t)).map(|c| if c.is_finite() { json!(c) } else { Value::Null }).collect();
            let budget = if field.budget().is_finite() { json!(field.budget()) } else { Value::Null };
            held!(json!({ "start": field.start(), "budget": budget, "tiles": tiles, "cost": cost }), &asks["reach"], "{at}: reach");
            held!(json!(session.under_pressure_tiles()), &asks["pressure"], "{at}: under pressure");
            for preview in asks["previews"].as_array().unwrap() {
                held!(to(&session.preview_walk(tile(&preview["destination"]), spot(&preview["aim"]).unwrap(), None)), &preview["result"], "{at}: preview");
                asked += 1;
            }
            for card in asks["cards"].as_array().unwrap() {
                let who = card["id"].as_str().unwrap();
                let def = session.abilities_of(who).into_iter().find(|a| a.id == card["ability"]).unwrap_or_else(|| panic!("{at}: {} has {}", who, card["ability"]));
                held!(json!(session.ability_targets(who, &def)), &card["targets"], "{at}: whom {} may be aimed at", card["ability"]);
                held!(json!(session.point_tiles(who, &def)), &card["tiles"], "{at}: where {} may land", card["ability"]);
                for shape in card["shapes"].as_array().unwrap() {
                    held!(json!(session.shape_at(who, &def, tile(&shape["tile"]))), &shape["caught"], "{at}: whom {} catches", card["ability"]);
                }
                asked += 1;
            }
            let jump = &asks["jump"];
            held!(json!(session.jump_offered()), &jump["offered"], "{at}: a jump offered");
            held!(json!(session.jump_aim()), &jump["aim"], "{at}: a jump's tiles");
            if let Some(who) = session.party.selected().map(str::to_string) {
                for reach in jump["reaches"].as_array().unwrap() {
                    held!(json!(session.jump_reaches(&who, tile(&reach["destination"]), spot(&reach["aim"]))), &reach["result"], "{at}: a jump reaches");
                }
            }
            steps += 1;
        }
    }
    assert!(steps > 300 && asked > 1000 && fighting > 100, "{steps} {asked} {fighting}");
}

/// A game brought into step is told the dice still waiting to be shown, as the board gives them, and keeps its
/// own when it is not told any.
#[test]
fn a_game_brought_into_step_is_told_the_dice_waiting() {
    let fixture = fixture("replica.json");
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let mut session = Session::build(&fixture["projects"][0], shipped, hooks_for(), "rolls").expect("a game");
    let roll = json!({ "advantageDie": 0, "bad": 7, "good": 8, "outcome": "successWithGood" });
    let waiting = json!([{ "who": "Kara", "what": "the chest", "roll": roll }, { "who": "Mira", "what": "the longsword", "roll": roll }]);
    session.dispatch("restoreWalk", &[Value::Null, Value::Null, Value::Null, waiting.clone()]).unwrap();
    assert_eq!(session.board()["rolls"], waiting);
    session.dispatch("restoreWalk", &[Value::Null, Value::Null, Value::Null]).unwrap();
    assert_eq!(session.board()["rolls"], waiting, "not told, kept");
    session.dispatch("rollShownAt", &[json!(0)]).unwrap();
    assert_eq!(session.board()["rolls"], json!([waiting[1]]));
    session.dispatch("restoreWalk", &[Value::Null, Value::Null, Value::Null, json!([])]).unwrap();
    assert_eq!(session.board()["rolls"], json!([]));
    assert!(session.dispatch("restoreWalk", &[Value::Null, Value::Null, Value::Null, json!([{ "who": 1 }])]).is_err(), "a roll with no dice");
}
