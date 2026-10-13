//! A rest called (`engine::game::rest_call`): a player alone calls it with everybody's moves and it is taken at once,
//! exactly as a rest always was; at a shared game it is voted on by everybody who plays a character - one who would
//! rather not calls it off - each chooses their own characters' moves, and it is taken once all are in.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::game::content::Shipped;
use engine::game::session::Session;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use serde_json::{json, Value};
use std::rc::Rc;
use support::fixture;

fn demo() -> Session {
    let replica = fixture("replica.json");
    let shipped: Shipped = serde_json::from_value(replica["shipped"].clone()).unwrap();
    let hooks: engine::game::session::HooksFor = Rc::new(|_: &[CodeSource]| -> Rc<dyn Hooks> { Rc::new(NoHooks) });
    let mut session = Session::build(&replica["projects"][1], Rc::new(shipped), hooks, "rest").unwrap();
    session.dispatch("restoreRng", &[json!(7)]).unwrap();
    session
}

fn party(session: &Session) -> Vec<String> {
    session.party.members(&session.world.state)
}

/// Whom the game plays for: `you`, the host `host`, and the first of the party seated in `guest`.
fn seat(session: &mut Session, you: &str) {
    let guests = party(session)[0].clone();
    session.dispatch("restoreSeating", &[json!({ "you": you, "host": "host", "seats": { guests: "guest" } })]).unwrap();
}

fn call(session: &mut Session, intent: &str, args: Value) -> Value {
    session.dispatch(intent, args.as_array().unwrap()).unwrap()
}

/// Two moves for each of these characters.
fn moves(ids: &[String], kind: &str) -> Value {
    Value::Object(ids.iter().map(|id| (id.clone(), json!([{ "kind": kind }, { "kind": kind }]))).collect())
}

/// Every log line's words.
fn lines(session: &mut Session) -> Vec<String> {
    session.board()["log"].as_array().unwrap().iter().filter_map(|l| l["text"].as_str().map(str::to_string)).collect()
}

#[test]
fn a_player_alone_calls_a_rest_with_everybodys_moves_and_it_is_taken_at_once_as_a_rest_always_was() {
    let mut called = demo();
    let mut rested = demo();
    for session in [&mut called, &mut rested] {
        let first = party(session)[0].clone();
        session.dispatch("wound", &[json!(first), json!(3)]).unwrap();
    }
    let everybody = party(&called);
    let plan = moves(&everybody, "tendWounds");
    let answer = call(&mut called, "callRest", json!(["short", plan]));
    assert_eq!(answer["rested"], true, "{answer}");
    let answer_rest = call(&mut rested, "rest", json!(["short", { "moves": plan }]));
    assert_eq!(answer["badGained"], answer_rest["badGained"]);
    assert_eq!(called.board(), rested.board(), "the same dice, the same rest");
    assert!(called.rest_call.is_none());
}

#[test]
fn at_a_shared_game_a_rest_is_voted_on_then_each_player_chooses_their_own() {
    let mut session = demo();
    let everybody = party(&session);
    let (guests, hosts) = (vec![everybody[0].clone()], everybody[1..].to_vec());
    // The host calls a short rest with their own characters' moves: it waits on the guest.
    seat(&mut session, "host");
    let answer = call(&mut session, "callRest", json!(["short", moves(&hosts, "clearStress")]));
    assert_eq!(answer, json!({ "ok": true, "rested": false }));
    let board = session.board();
    assert_eq!(board["rest"]["voters"], json!(["guest", "host"]), "everybody who plays a character, in the party's order");
    assert_eq!(board["rest"]["agreed"], json!(["host"]));
    assert_eq!(board["rest"]["by"], "host");
    // Nobody calls a second one; the host's choice for the guest's character is refused.
    assert_eq!(call(&mut session, "callRest", json!(["long", {}]))["ok"], false);
    let refused = call(&mut session, "chooseRest", json!([moves(&guests, "prepare")]));
    assert!(refused["reason"].as_str().unwrap().ends_with("is not yours to play"), "{refused}");
    // The guest would rather not: it is called off, and said so.
    seat(&mut session, "guest");
    assert_eq!(call(&mut session, "voteRest", json!([false])), json!({ "ok": true, "rested": false }));
    assert!(session.rest_call.is_none());
    assert!(lines(&mut session).last().unwrap().contains("does not rest"));
    // Called again; the guest agrees, and chooses their own: then it is taken.
    seat(&mut session, "host");
    call(&mut session, "callRest", json!(["short", moves(&hosts, "clearStress")]));
    seat(&mut session, "guest");
    assert_eq!(call(&mut session, "voteRest", json!([true]))["rested"], false, "the guest's moves still to come");
    assert_eq!(session.board()["rest"]["agreed"], json!(["host", "guest"]));
    let shadow = session.board()["replica"]["state"]["bad"].clone();
    let rested = call(&mut session, "chooseRest", json!([moves(&guests, "repairArmor")]));
    assert_eq!(rested["rested"], true, "{rested}");
    assert!(session.rest_call.is_none());
    assert_ne!(session.board()["replica"]["state"]["bad"], shadow, "the GM gains Shadow");
}

#[test]
fn moves_chosen_before_everybody_agrees_wait_for_them() {
    let mut session = demo();
    let everybody = party(&session);
    let (guests, hosts) = (vec![everybody[0].clone()], everybody[1..].to_vec());
    seat(&mut session, "host");
    call(&mut session, "callRest", json!(["short", moves(&hosts, "clearStress")]));
    seat(&mut session, "guest");
    assert_eq!(call(&mut session, "chooseRest", json!([moves(&guests, "clearStress")]))["rested"], false, "not agreed yet");
    assert_eq!(call(&mut session, "voteRest", json!([true]))["rested"], true);
}

#[test]
fn preparing_together_counts_across_players() {
    let mut session = demo();
    let everybody = party(&session);
    let (guests, hosts) = (vec![everybody[0].clone()], everybody[1..].to_vec());
    seat(&mut session, "host");
    call(&mut session, "callRest", json!(["short", moves(&hosts, "prepare")]));
    seat(&mut session, "guest");
    call(&mut session, "voteRest", json!([true]));
    call(&mut session, "chooseRest", json!([moves(&guests, "prepare")]));
    let prepared: Vec<String> = lines(&mut session).into_iter().filter(|l| l.contains(" prepares: ")).collect();
    assert!(!prepared.is_empty());
    assert!(prepared.iter().all(|l| l.ends_with("prepares: 2 Light.")), "{prepared:?}");
}

#[test]
fn only_somebody_who_plays_a_character_calls_a_rest_and_its_caller_or_the_host_calls_it_off() {
    let mut session = demo();
    // A watcher plays nobody; nor does anybody before a lobby's game starts.
    session.dispatch("restoreSeating", &[json!({ "you": "watcher", "host": "host", "seats": {} })]).unwrap();
    assert_eq!(call(&mut session, "callRest", json!(["short", {}]))["reason"], "only somebody who plays a character calls a rest");
    session.dispatch("restoreSeating", &[json!({ "you": "host", "host": "host", "seats": {}, "started": false })]).unwrap();
    assert_eq!(call(&mut session, "callRest", json!(["short", {}]))["ok"], false);
    // The guest calls one; the host calls it off. The host calls one; the guest may not call it off, the host may.
    seat(&mut session, "guest");
    call(&mut session, "callRest", json!(["short", {}]));
    seat(&mut session, "host");
    assert_eq!(call(&mut session, "cancelRest", json!([]))["ok"], true);
    assert!(session.rest_call.is_none());
    call(&mut session, "callRest", json!(["long", {}]));
    seat(&mut session, "guest");
    assert_eq!(call(&mut session, "cancelRest", json!([]))["ok"], false, "the host's call is not the guest's to call off");
    seat(&mut session, "host");
    assert_eq!(call(&mut session, "cancelRest", json!([]))["ok"], true);
    // Nor is a rest called in a fight; and a fight beginning drops one called.
    call(&mut session, "callRest", json!(["short", {}]));
    session.dispatch("startEncounter", &[json!("group-1")]).unwrap();
    assert!(session.rest_call.is_none());
    assert_eq!(call(&mut session, "callRest", json!(["short", {}]))["reason"], "not in the middle of a fight");
}

#[test]
fn a_rest_called_is_told_to_an_engine_brought_into_step_and_dropped_by_a_save_loaded() {
    let mut session = demo();
    let hosts = party(&session)[1..].to_vec();
    seat(&mut session, "host");
    let save = session.serialise_save().unwrap();
    call(&mut session, "callRest", json!(["short", moves(&hosts, "prepare")]));
    let held = session.board()["rest"].clone();
    assert!(held.is_object());
    // Another engine, told the walk as the page tells its own: holding the same call.
    let mut other = demo();
    other.dispatch("restoreWalk", &[Value::Null, json!([]), Value::Null, Value::Null, held.clone()]).unwrap();
    assert_eq!(other.board()["rest"], held);
    // A save loaded: no rest called.
    call(&mut session, "loadGameText", json!([save]));
    assert!(session.rest_call.is_none());
}
