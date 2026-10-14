//! Projects (`engine::game::projects`): a plan learned through an effect - here a blueprint whose use teaches it -
//! is worked on by Work on a Project moves on a long rest, one unit each, the party's together; the move that does
//! the last of it finishes it and runs its reward, the finisher acting. Refused on a short rest and for a plan the
//! party cannot work on; the work done kept in a save.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::game::content::Shipped;
use engine::game::session::Session;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use serde_json::{json, Value};
use std::rc::Rc;
use support::fixture;

/// The demo, with a plan to forge a blade in two moves - its reward the blade and a flag the story reads later - and
/// a blueprint whose use teaches it.
fn demo() -> Session {
    let replica = fixture("replica.json");
    let shipped: Shipped = serde_json::from_value(replica["shipped"].clone()).unwrap();
    let mut project = replica["projects"][1].clone();
    let blade = project["items"][0]["id"].as_str().expect("an item in the demo").to_string();
    project["projectPlans"] = json!([{
        "id": "masterwork-blade",
        "name": "Masterwork Blade",
        "description": "A blade worth the forging.",
        "work": 2,
        "reward": [{ "kind": "addItem", "item": blade }, { "kind": "setFlag", "flag": "blade-forged" }],
    }]);
    project["items"].as_array_mut().unwrap().push(json!({ "id": "blueprint", "name": "Blueprint", "kind": "consumable", "glyph": "book", "use": [{ "kind": "learnPlan", "plan": "masterwork-blade" }] }));
    let hooks: engine::game::session::HooksFor = Rc::new(|_: &[CodeSource]| -> Rc<dyn Hooks> { Rc::new(NoHooks) });
    let mut session = Session::build(&project, Rc::new(shipped), hooks, "projects").unwrap();
    session.dispatch("restoreRng", &[json!(3)]).unwrap();
    session
}

fn call(session: &mut Session, intent: &str, args: Value) -> Value {
    session.dispatch(intent, args.as_array().unwrap()).unwrap()
}

fn party(session: &Session) -> Vec<String> {
    session.party.members(&session.world.state)
}

/// Every one of the party resting with two moves; `workers`' first move on the blade.
fn plan(session: &Session, workers: &[&str], kind: &str) -> Value {
    Value::Object(
        party(session)
            .into_iter()
            .map(|id| {
                let first = if workers.contains(&id.as_str()) { json!({ "kind": "workOnProject", "project": "masterwork-blade" }) } else { json!({ "kind": kind }) };
                (id, json!([first, { "kind": "clearStress" }]))
            })
            .collect(),
    )
}

/// A rest called by a player alone, `workers` at the blade.
fn rest(session: &mut Session, kind: &str, workers: &[&str]) -> Value {
    let moves = plan(session, workers, "prepare");
    call(session, "callRest", json!([kind, moves]))
}

fn lines(session: &mut Session) -> Vec<String> {
    session.board()["log"].as_array().unwrap().iter().filter_map(|l| l["text"].as_str().map(str::to_string)).collect()
}

fn learn(session: &mut Session) {
    call(session, "giveItem", json!(["blueprint", 1]));
    let used = call(session, "useItem", json!(["blueprint"]));
    assert_ne!(used["status"], "refused", "{used}");
}

#[test]
fn a_plan_learned_is_worked_on_at_long_rests_and_its_reward_given_when_the_work_is_done() {
    let mut session = demo();
    let everybody = party(&session);
    // Not learned: no work on it.
    let refused = rest(&mut session, "long", &[&everybody[0]]);
    assert_eq!(refused["reason"], "that is no project the party can work on", "{refused}");
    // The blueprint, drawn as a book, teaches it, and says so.
    assert_eq!(session.gear_card("blueprint").unwrap()["glyph"], "book");
    assert!(session.gear_card("gold").map_or(true, |card| card.get("glyph").is_none()));
    learn(&mut session);
    assert_eq!(session.world.scenario.projects.get("masterwork-blade"), Some(&0.0));
    assert!(lines(&mut session).iter().any(|l| l == "A project to work on at a long rest: Masterwork Blade."));
    // Not on a short rest.
    let short = rest(&mut session, "short", &[&everybody[0]]);
    assert_eq!(short["reason"], "work on a project is a long rest's");
    // One long rest, one worker: one of two.
    assert_eq!(rest(&mut session, "long", &[&everybody[0]])["rested"], true);
    assert_eq!(session.world.scenario.projects.get("masterwork-blade"), Some(&1.0));
    assert!(!session.world.scenario.flags.contains(&"blade-forged".to_string()));
    // The next: done, the reward given.
    let carried = session.world.scenario.items.entries().len();
    assert_eq!(rest(&mut session, "long", &[&everybody[1]])["rested"], true);
    assert_eq!(session.world.scenario.projects.get("masterwork-blade"), Some(&2.0), "finished, and kept");
    assert!(session.world.scenario.flags.contains(&"blade-forged".to_string()));
    assert!(session.world.scenario.items.entries().len() >= carried, "the blade carried");
    let said = lines(&mut session);
    assert!(said.iter().any(|l| l.ends_with("works on Masterwork Blade: 2 of 2.")), "{said:?}");
    assert!(said.iter().any(|l| l == "Masterwork Blade is finished."));
    // Finished: no more work on it, nor taught again.
    assert_eq!(rest(&mut session, "long", &[&everybody[0]])["ok"], false);
    learn(&mut session);
    assert_eq!(session.world.scenario.projects.get("masterwork-blade"), Some(&2.0));
}

#[test]
fn the_party_works_together_and_a_save_keeps_the_work_done() {
    let mut session = demo();
    let everybody = party(&session);
    let fresh = session.serialise_save().unwrap();
    assert!(!fresh.contains("\"projects\""), "no plan learned: a save as it always was");
    learn(&mut session);
    // Two at work in one rest: both units, and it is finished.
    let both = [everybody[0].as_str(), everybody[1].as_str()];
    let mut half = demo();
    learn(&mut half);
    assert_eq!(rest(&mut session, "long", &both)["rested"], true);
    assert!(session.world.scenario.flags.contains(&"blade-forged".to_string()));
    // Half done, saved and loaded elsewhere: the half holds.
    rest(&mut half, "long", &both[..1]);
    let save = half.serialise_save().unwrap();
    assert!(save.contains("\"projects\":[[\"masterwork-blade\",1]]"), "{save}");
    let mut other = demo();
    call(&mut other, "loadGameText", json!([save]));
    assert_eq!(other.world.scenario.projects.get("masterwork-blade"), Some(&1.0));
    call(&mut other, "loadGameText", json!([fresh]));
    assert!(other.world.scenario.projects.entries().is_empty());
}
