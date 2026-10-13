//! Who may act (`engine::game::seats`): a game told whom it plays for refuses an intent for a character that
//! account does not play - in its answer's shape, the game unchanged - keeps the selection among the account's
//! own, and says whom a question is put to. Told nobody, it plays for everyone.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::game::content::Shipped;
use engine::game::session::Session;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use serde_json::{json, Value};
use std::rc::Rc;
use support::fixture;

/// The demo, as the server's tests play it: its fight's first husk, and dice that land the GM's swing.
fn demo() -> Session {
    let replica = fixture("replica.json");
    let shipped: Shipped = serde_json::from_value(replica["shipped"].clone()).unwrap();
    let hooks: engine::game::session::HooksFor = Rc::new(|_: &[CodeSource]| -> Rc<dyn Hooks> { Rc::new(NoHooks) });
    let mut session = Session::build(&replica["projects"][1], Rc::new(shipped), hooks, "seats").unwrap();
    session.animated = false;
    session.ask_defender = true;
    session.dispatch("restoreRng", &[json!(1)]).unwrap();
    session
}

fn members(session: &Session) -> Vec<String> {
    session.party.members(&session.world.state)
}

/// Whom the game plays for: the account, its host, who plays whom.
fn seat(session: &mut Session, you: &str, seats: Value) {
    session.dispatch("restoreSeating", &[json!({ "you": you, "host": "host", "seats": seats })]).unwrap();
}

/// An intent played, and the game's board after it.
fn play(session: &mut Session, call: &str, args: Value) -> (Value, Value) {
    let answer = session.dispatch(call, args.as_array().unwrap()).unwrap();
    (answer, session.board())
}

#[test]
fn told_nobody_the_game_plays_for_everyone() {
    let mut session = demo();
    let party = members(&session);
    assert!(party.len() >= 2, "{party:?}");
    for id in &party {
        assert_eq!(play(&mut session, "select", json!([id])).0, json!(true));
        assert_eq!(session.party.selected(), Some(id.as_str()));
    }
}

#[test]
fn an_intent_for_a_character_another_plays_is_refused_in_its_own_shape_the_game_unchanged() {
    let mut session = demo();
    let party = members(&session);
    let (theirs, mine) = (&party[0], &party[1]);
    seat(&mut session, "guest", json!({ theirs: "host", mine: "guest" }));
    let before = session.board();
    // The selection is the guest's own at once, and another's is not taken.
    assert_eq!(session.party.selected(), Some(mine.as_str()));
    let refusals = [
        ("select", json!([theirs]), json!(false)),
        ("useAbility", json!([theirs, "anything", []]), json!({ "status": "refused", "lines": [] })),
        ("jumpTo", json!([theirs, 0, null, true]), json!({ "moved": false, "path": [] })),
        ("link", json!([theirs, mine]), json!(false)),
        ("unlink", json!([theirs]), json!(false)),
        ("dropCard", json!([theirs, { "kind": "aside" }]), json!(false)),
        ("rest", json!(["short", {}]), json!({ "ok": false, "reason": "the party rests on the host's word" })),
    ];
    for (call, args, refused) in refusals {
        let (answer, board) = play(&mut session, call, args);
        assert_eq!(answer, refused, "{call}");
        assert_eq!(board, before, "{call}: the game unchanged");
    }
    let (equipped, _) = play(&mut session, "equipItem", json!([theirs, "anything"]));
    assert_eq!(equipped["ok"], false);
    assert!(equipped["reason"].as_str().unwrap().ends_with("is not yours to play"), "{equipped}");
    let (levelled, _) = play(&mut session, "applyLevelUp", json!([theirs, {}]));
    assert_eq!(levelled["issues"][0]["field"], "character", "{levelled}");
    // Their own is theirs: selected, and the next of their own is themselves again.
    assert_eq!(play(&mut session, "select", json!([mine])).0, json!(true));
    assert_eq!(play(&mut session, "selectNext", json!([])).0, json!(mine));
}

#[test]
fn the_host_plays_whoever_nobody_is_seated_in_and_nobody_else_does() {
    let mut session = demo();
    let party = members(&session);
    seat(&mut session, "host", json!({ party[1].clone(): "guest" }));
    assert_eq!(play(&mut session, "select", json!([party[0]])).0, json!(true));
    assert_eq!(play(&mut session, "select", json!([party[1]])).0, json!(false));
    // The selection cycles among the host's own: never the guest's.
    for _ in 0..party.len() * 2 {
        let next = play(&mut session, "selectNext", json!([])).0;
        assert_ne!(next, json!(party[1]), "the guest's is not the host's next");
    }
    // Somebody seated in nobody, who is not the host, plays nobody: nothing selected, and no turn to hand over.
    seat(&mut session, "watcher", json!({ party[1].clone(): "guest" }));
    assert_eq!(session.party.selected(), None);
    assert_eq!(play(&mut session, "selectNext", json!([])).0, Value::Null);
    // In a fight, nobody who plays nobody hands the party's spotlight to the GM; somebody who plays somebody does.
    session.dispatch("startEncounter", &[json!("group-1")]).unwrap();
    let before = session.board();
    assert_eq!(play(&mut session, "endTurn", json!([])).0, json!(0));
    assert_eq!(session.board(), before, "the party's spotlight still");
    seat(&mut session, "guest", json!({ party[1].clone(): "guest" }));
    play(&mut session, "endTurn", json!([]));
    assert_ne!(session.board()["fight"], before["fight"], "the GM's turn played");
}

#[test]
fn whatever_an_intent_selects_the_selection_is_kept_among_the_accounts_own() {
    let mut session = demo();
    let party = members(&session);
    // A save made with the host's selected.
    session.dispatch("select", &[json!(party[0])]).unwrap();
    let text = session.serialise_save().expect("a save");
    // Loaded at a game where the guest plays another: the guest's own still selected after.
    seat(&mut session, "guest", json!({ party[1].clone(): "guest" }));
    assert_eq!(session.party.selected(), Some(party[1].as_str()));
    let (loaded, board) = play(&mut session, "loadGameText", json!([text]));
    assert_eq!(loaded["ok"], true, "{loaded}");
    assert_eq!(board["replica"]["party"]["selected"], json!(party[1]));
}

#[test]
fn the_accounts_own_choice_is_selected_when_it_is_theirs() {
    let mut session = demo();
    let party = members(&session);
    session.dispatch("restoreSeating", &[json!({ "you": "host", "host": "host", "seats": {}, "selected": party[1] })]).unwrap();
    assert_eq!(session.party.selected(), Some(party[1].as_str()));
    // Another's is no choice of theirs: their own is kept.
    session.dispatch("restoreSeating", &[json!({ "you": "host", "host": "host", "seats": { party[0].clone(): "guest" }, "selected": party[0] })]).unwrap();
    assert_eq!(session.party.selected(), Some(party[1].as_str()));
    // Told nobody again: the game plays for everyone.
    session.dispatch("restoreSeating", &[Value::Null]).unwrap();
    assert_eq!(play(&mut session, "select", json!([party[0]])).0, json!(true));
}

#[test]
fn a_walk_cut_short_puts_down_only_the_accounts_own_walkers() {
    // The guest's walk, which the rest of the party follows - the host's among them - each drawn halfway.
    let walked = |seated: bool| {
        let mut session = demo();
        session.animated = true;
        let party = members(&session);
        let guests = party[1].clone();
        // Only the guest's seated: everybody else is the host's.
        if seated {
            seat(&mut session, "guest", json!({ guests.clone(): "guest" }));
        } else {
            session.dispatch("select", &[json!(guests)]).unwrap();
        }
        let tile = session.world.state.entity(&guests).unwrap().tile;
        let (moved, _) = play(&mut session, "moveSelectedTo", json!([tile + 3]));
        assert_eq!(moved["moved"], true, "{moved}");
        let (motions, _) = play(&mut session, "takeMotions", json!([]));
        let drawn: Vec<Value> = motions
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                let route = m["route"].as_array().unwrap();
                let (start, end) = (&route[0], &route[route.len() - 1]);
                json!([m["id"], { "x": (start["x"].as_f64().unwrap() + end["x"].as_f64().unwrap()) / 2.0, "y": (start["y"].as_f64().unwrap() + end["y"].as_f64().unwrap()) / 2.0 }])
            })
            .collect();
        assert!(drawn.len() >= 2, "the party followed: {motions}");
        let walkers: Vec<Value> = drawn.iter().map(|d| d[0].clone()).collect();
        let (landed, _) = play(&mut session, "landWalkers", json!([drawn]));
        (landed, walkers, guests)
    };
    let (everyone, walkers, _) = walked(false);
    assert_eq!(everyone, json!(walkers), "told nobody, everybody walking is put down");
    let (own, _, guests) = walked(true);
    assert_eq!(own, json!([guests]), "the guest's click puts down the guest's own");
}

#[test]
fn a_question_is_put_to_whoever_plays_the_character_it_is_about() {
    let mut session = demo();
    let party = members(&session);
    // A fight, somebody beside a husk, and the GM's turn: its swing asks the defender how it lands.
    let husk = session.world.state.entity("group-1-husk-16-8").map(|e| e.tile).expect("the vault's first husk");
    let defender = party[0].clone();
    session.dispatch("startEncounter", &[json!("group-1")]).unwrap();
    session.dispatch("placeAt", &[json!(defender), json!(husk - 1)]).unwrap();
    session.dispatch("endTurn", &[]).unwrap();
    let board = session.board();
    assert_eq!(board["pending"]["kind"], "defense", "{}", board["pending"]);
    let asked = board["pending"]["for"].as_str().expect("whom it is put to").to_string();
    assert!(party.contains(&asked), "{asked}");
    let other = party.iter().find(|id| **id != asked).unwrap().clone();

    // Another's player answers nothing: refused, the question still open.
    seat(&mut session, "guest", json!({ asked.clone(): "host", other.clone(): "guest" }));
    let (answer, after) = play(&mut session, "answerPending", json!([{ "kind": "continue" }]));
    assert_eq!(answer, json!({ "status": "refused", "lines": [] }));
    assert_eq!(after["pending"], board["pending"]);
    // Its own player answers it.
    seat(&mut session, "host", json!({ asked.clone(): "host", other: "guest" }));
    let (answer, after) = play(&mut session, "answerPending", json!([{ "kind": "continue" }]));
    assert_ne!(answer["status"], "refused", "{answer}");
    assert_ne!(after["pending"], board["pending"]);
}

#[test]
fn an_errand_is_finished_or_called_off_by_its_walkers_player_alone() {
    let mut session = demo();
    session.animated = true;
    let party = members(&session);
    let walker = party[0].clone();
    session.dispatch("select", &[json!(walker)]).unwrap();
    // A walk up to a door, to use it: held until the walk is drawn ending.
    let door = engine::scene::prop_functions::interactables_of(&session.scene).into_iter().filter_map(|t| t["id"].as_str().map(str::to_string)).find(|id| id.contains("door")).expect("a door");
    let (status, _) = play(&mut session, "approachThenUse", json!([door]));
    assert_eq!(status, "walking", "{status}");
    let errand = session.approaching.as_ref().map(|a| a.who.clone());
    assert_eq!(errand.as_deref(), Some(walker.as_str()));
    // Another's player neither finishes it nor calls it off: the errand stands.
    seat(&mut session, "guest", json!({ party[1].clone(): "guest" }));
    assert_eq!(play(&mut session, "arrived", json!([])).0, json!(false));
    assert_eq!(play(&mut session, "cancelApproach", json!([])).0, json!(false));
    assert!(session.approaching.is_some(), "the walker's errand still stands");
    // Its walker's player finishes it.
    seat(&mut session, "host", json!({ party[1].clone(): "guest" }));
    assert_eq!(play(&mut session, "arrived", json!([])).0, json!(true));
    assert!(session.approaching.is_none());
}
