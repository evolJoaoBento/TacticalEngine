//! A card given (`engine::game::cards`, the `grantCard` effect): a project plan's reward puts a card in its
//! finisher's hands, an item's use in its user's, or in a party member's the effect names; the log says so. A card
//! already held, or one no content has, changes nothing.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::character::progression::held_cards;
use engine::game::content::{character_content_for, Shipped};
use engine::game::session::Session;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use serde_json::{json, Value};
use std::rc::Rc;
use support::fixture;

/// The demo, with a card nobody in the party holds given three ways: as a one-move plan's reward, by an item's use,
/// and by an item that names who receives it.
fn demo() -> (Session, String) {
    let replica = fixture("replica.json");
    let shipped: Shipped = serde_json::from_value(replica["shipped"].clone()).unwrap();
    let hooks: engine::game::session::HooksFor = Rc::new(|_: &[CodeSource]| -> Rc<dyn Hooks> { Rc::new(NoHooks) });
    let plain = Session::build(&replica["projects"][1], Rc::new(shipped.clone()), hooks.clone(), "cards").unwrap();
    let held: Vec<String> = plain.sheets.entries().iter().flat_map(|(_, sheet)| held_cards(sheet)).collect();
    let card = character_content_for(plain.shipped(), &plain.project).cards.iter().map(|c| c.id.clone()).find(|id| !held.contains(id)).expect("a card nobody holds");
    let second = plain.party.members(&plain.world.state)[1].clone();
    let mut project = replica["projects"][1].clone();
    project["projectPlans"] = json!([{ "id": "lesson", "name": "A lesson", "work": 1, "reward": [{ "kind": "grantCard", "card": card }] }]);
    let items = project["items"].as_array_mut().unwrap();
    items.push(json!({ "id": "primer", "name": "Primer", "kind": "consumable", "use": [{ "kind": "learnPlan", "plan": "lesson" }] }));
    items.push(json!({ "id": "relic", "name": "Relic", "kind": "consumable", "use": [{ "kind": "grantCard", "card": card }] }));
    items.push(json!({ "id": "gift", "name": "Gift", "kind": "consumable", "use": [{ "kind": "grantCard", "card": card, "to": second }] }));
    items.push(json!({ "id": "nonsense", "name": "Nonsense", "kind": "consumable", "use": [{ "kind": "grantCard", "card": "no-such-card" }] }));
    let mut session = Session::build(&project, Rc::new(shipped), hooks, "cards").unwrap();
    session.dispatch("restoreRng", &[json!(5)]).unwrap();
    (session, card)
}

fn call(session: &mut Session, intent: &str, args: Value) -> Value {
    session.dispatch(intent, args.as_array().unwrap()).unwrap()
}

fn holds(session: &Session, id: &str, card: &str) -> bool {
    held_cards(session.sheets.get(id).unwrap()).iter().any(|held| held == card)
}

fn use_item(session: &mut Session, item: &str) {
    call(session, "giveItem", json!([item, 1]));
    call(session, "useItem", json!([item]));
}

fn lines(session: &mut Session) -> Vec<String> {
    session.board()["log"].as_array().unwrap().iter().filter_map(|l| l["text"].as_str().map(str::to_string)).collect()
}

#[test]
fn a_project_plans_reward_gives_its_finisher_a_card() {
    let (mut session, card) = demo();
    let party = session.party.members(&session.world.state);
    use_item(&mut session, "primer");
    let finisher = party[2].clone();
    let moves = Value::Object(party.iter().map(|id| (id.clone(), if *id == finisher { json!([{ "kind": "workOnProject", "project": "lesson" }, { "kind": "prepare" }]) } else { json!([{ "kind": "prepare" }, { "kind": "prepare" }]) })).collect());
    assert_eq!(call(&mut session, "callRest", json!(["long", moves]))["rested"], true);
    assert!(holds(&session, &finisher, &card), "the finisher holds it");
    assert!(party.iter().filter(|id| **id != finisher).all(|id| !holds(&session, id, &card)), "nobody else does");
    let name = character_content_for(session.shipped(), &session.project).cards.get(&card).unwrap().name.clone();
    assert!(lines(&mut session).iter().any(|l| l.ends_with(&format!("learns {name}."))));
    // On the board, and in a save, as the sheet is.
    let save = session.serialise_save().unwrap();
    let mut other = demo().0;
    call(&mut other, "loadGameText", json!([save]));
    assert!(holds(&other, &finisher, &card));
}

#[test]
fn an_items_use_gives_its_user_a_card_or_the_one_it_names_and_nothing_twice() {
    let (mut session, card) = demo();
    let party = session.party.members(&session.world.state);
    let user = session.party.selected().unwrap().to_string();
    use_item(&mut session, "relic");
    assert!(holds(&session, &user, &card));
    let learned = lines(&mut session).iter().filter(|l| l.contains(" learns ")).count();
    // Given again: nothing more, and nothing said.
    use_item(&mut session, "relic");
    assert_eq!(session.sheets.get(&user).unwrap().domain_cards.as_ref().unwrap().iter().filter(|c| **c == card).count(), 1);
    assert_eq!(lines(&mut session).iter().filter(|l| l.contains(" learns ")).count(), learned);
    // Named: the one named, whoever uses it.
    use_item(&mut session, "gift");
    assert!(holds(&session, &party[1], &card));
    // A card no content has: nothing.
    let before = session.sheets.get(&user).unwrap().clone();
    use_item(&mut session, "nonsense");
    assert_eq!(session.sheets.get(&user).unwrap(), &before);
}
