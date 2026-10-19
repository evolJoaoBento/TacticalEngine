//! A companion taken along (`engine::game::party_join`, the `joinParty` effect): one of the project's companions asked
//! to come joins the party - in the project, on the board beside the party, in the log - and the figure that stood for
//! them is taken away. Four is a party: a fifth asked stays, and the log says why. One already in the party, or one the
//! project has not got, changes nothing. A save keeps them.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::game::content::Shipped;
use engine::game::session::Session;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use serde_json::{json, Value};
use std::rc::Rc;
use support::fixture;

/// The demo with two in its party and the other four waiting as companions, each asked along by an item's use - the
/// first standing as a crate, which goes when they join.
fn demo() -> Session {
    let replica = fixture("replica.json");
    let shipped: Shipped = serde_json::from_value(replica["shipped"].clone()).unwrap();
    let hooks: engine::game::session::HooksFor = Rc::new(|_: &[CodeSource]| -> Rc<dyn Hooks> { Rc::new(NoHooks) });
    let mut project = replica["projects"][1].clone();
    let everyone = project["party"].as_array().unwrap().clone();
    project["party"] = json!(everyone[..2]);
    project["companions"] = json!(everyone[2..]);
    let items = project["items"].as_array_mut().unwrap();
    for (i, sheet) in everyone[2..].iter().enumerate() {
        let id = sheet["id"].as_str().unwrap();
        let mut join = json!({ "kind": "joinParty", "companion": id });
        if i == 0 {
            join["figure"] = json!("crate-prop-15-14");
        }
        items.push(json!({ "id": format!("ask-{id}"), "name": "Ask", "kind": "consumable", "use": [join] }));
    }
    items.push(json!({ "id": "ask-nobody", "name": "Ask", "kind": "consumable", "use": [{ "kind": "joinParty", "companion": "nobody" }] }));
    let mut session = Session::build(&project, Rc::new(shipped), hooks, "joining").unwrap();
    session.dispatch("restoreRng", &[json!(5)]).unwrap();
    session
}

fn call(session: &mut Session, intent: &str, args: Value) -> Value {
    session.dispatch(intent, args.as_array().unwrap()).unwrap()
}

fn ask(session: &mut Session, who: &str) {
    let item = format!("ask-{who}");
    call(session, "giveItem", json!([item, 1]));
    call(session, "useItem", json!([item]));
}

fn listed(session: &Session) -> Vec<String> {
    session.project["party"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap().to_string()).collect()
}

fn lines(session: &mut Session) -> Vec<String> {
    session.board()["log"].as_array().unwrap().iter().filter_map(|l| l["text"].as_str().map(str::to_string)).collect()
}

#[test]
fn a_companion_asked_joins_the_party_and_their_figure_goes() {
    let mut session = demo();
    let waiting: Vec<String> = session.project["companions"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap().to_string()).collect();
    let first = waiting[0].clone();
    let name = session.project["companions"][0]["name"].as_str().unwrap().to_string();
    assert!(!session.world.interactable_state("crate-prop-15-14").removed);
    ask(&mut session, &first);
    assert_eq!(listed(&session)[2], first, "in the project's party");
    assert!(session.world.state.entity(&first).is_some(), "on the board");
    assert!(session.party.members(&session.world.state).contains(&first));
    assert!(session.sheets.get(&first).is_some());
    assert!(lines(&mut session).iter().any(|l| *l == format!("{name} joins the party.")));
    assert!(session.world.interactable_state("crate-prop-15-14").removed, "the figure that stood for them is gone");
    // Asked again: nothing more.
    ask(&mut session, &first);
    assert_eq!(listed(&session).len(), 3);
    // One the project has not got: nothing.
    ask(&mut session, "nobody");
    assert_eq!(listed(&session).len(), 3);
}

#[test]
fn four_is_a_party_and_a_fifth_asked_stays_where_they_are() {
    let mut session = demo();
    let waiting: Vec<String> = session.project["companions"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap().to_string()).collect();
    ask(&mut session, &waiting[0]);
    ask(&mut session, &waiting[1]);
    assert_eq!(listed(&session).len(), 4);
    let fifth = session.project["companions"][2]["name"].as_str().unwrap().to_string();
    ask(&mut session, &waiting[2]);
    assert_eq!(listed(&session).len(), 4);
    assert!(session.world.state.entity(&waiting[2]).is_none());
    assert!(lines(&mut session).iter().any(|l| *l == format!("{fifth} would come, but the party is 4 already.")));
}

#[test]
fn a_save_keeps_whoever_joined() {
    let mut session = demo();
    let first = session.project["companions"][0]["id"].as_str().unwrap().to_string();
    ask(&mut session, &first);
    let save = session.serialise_save().unwrap();
    let mut other = demo();
    call(&mut other, "loadGameText", json!([save]));
    assert!(listed(&other).contains(&first));
    assert!(other.party.members(&other.world.state).contains(&first));
}
