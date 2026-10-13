//! The games on the server (`serve::play`): a game opened for an account, played intent for intent through
//! its own thread exactly as an engine played beside it plays them - the same answers and the same board -
//! kept when its socket closes and resumed; and the websocket at `/__play`, opened only with a session
//! cookie from the page's own origin.

use engine::game::content::Shipped;
use engine::game::session::{HooksFor, Session};
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use futures_util::{SinkExt, StreamExt};
use hooks::QuickJsHooks;
use indexmap::IndexMap;
use serde_json::{json, Value};
use serve::accounts::{write_accounts, write_sessions, Account, Session as Signed, SESSION_COOKIE};
use serve::play::Tables;
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

fn root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-play-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("data")).unwrap();
    root
}

fn fixture() -> Value {
    serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/replica.json")).unwrap()).unwrap()
}

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

/// The intents a short game is played with: walks, the selection, a card, the GM's turn, an answer.
fn intents(session: &mut Session) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    let selected = session.party.selected().unwrap_or_default().to_string();
    let at = session.world.state.entity(&selected).map_or(0, |e| e.tile);
    let width = session.world.state.grid.width;
    for step in [1, 2, width, -1] {
        out.push(("moveSelectedTo".to_string(), json!([at + step])));
    }
    out.push(("selectNext".into(), json!([])));
    out.push(("syncTalks".into(), json!([])));
    // A card that runs the project's code, by whoever holds one: the game's QuickJS runs it on the server.
    let members = session.party.members(&session.world.state);
    let coded = members.iter().find_map(|m| session.abilities_of(m).into_iter().find(|a| a.effects.iter().any(|e| e["kind"] == "run")).map(|a| (m.clone(), a.id)));
    let (holder, card) = coded.expect("a member holding a card that runs the project's code");
    out.push(("select".into(), json!([holder])));
    out.push(("useAbility".into(), json!([holder, card, []])));
    out.push(("useAbility".into(), json!([holder, card, []])));
    // A fight, somebody stood beside a husk, and the turn passed: the GM's swing asks the defender how it lands -
    // the page's table, which the server's game is opened with.
    let husk = session.world.state.entity("group-1-husk-16-8").map(|e| e.tile).expect("the vault's first husk");
    out.push(("startEncounter".into(), json!(["group-1"])));
    out.push(("placeAt".into(), json!([holder, husk - 1])));
    out.push(("select".into(), json!([holder])));
    out.push(("endTurn".into(), json!([])));
    out.push(("takeMotions".into(), json!([])));
    out.push(("takeFloaters".into(), json!([])));
    out.push(("endTurn".into(), json!([])));
    out.push(("answerPending".into(), json!([{ "kind": "continue" }])));
    out
}

/// Where the first game's dice stand when it opens: a GM's swing that lands, so the defender is asked.
const DICE: u32 = 1;

#[tokio::test]
async fn a_game_on_the_server_plays_as_the_engine_plays() {
    let fixture = fixture();
    let shipped: Shipped = serde_json::from_value(fixture["shipped"].clone()).unwrap();
    let project = &fixture["projects"][1];
    // The tests' tables: the intents below start a fight and put somebody beside a husk with the test driver's hands,
    // and the dice are set where the test says, so the GM's swing lands and the defender is asked - whatever the seed.
    let tables = Tables::new(root("host")).for_tests();

    let opened = tables.ask("kara", json!({ "id": 1, "op": "open", "project": project, "shipped": fixture["shipped"], "table": { "animated": true, "askDefender": true }, "rng": DICE })).await;
    assert_eq!(opened["id"], 1, "{opened}");
    let seed = opened["ok"]["seed"].as_str().expect("the server's seed").to_string();
    assert_eq!(seed.len(), 16);

    // The same game, played beside it in this thread: the server's seed, the page's table.
    let mut beside = Session::build(project, Rc::new(shipped), hooks_for(), &seed).unwrap();
    beside.animated = true;
    beside.ask_defender = true;
    beside.dispatch("restoreRng", &[json!(DICE)]).unwrap();
    assert_eq!(opened["ok"]["board"], beside.board(), "stood up the same");

    let mut played = 0;
    let mut defended = false;
    for (n, (call, args)) in intents(&mut beside).into_iter().enumerate() {
        let said = tables.ask("kara", json!({ "id": n + 2, "op": "call", "call": call, "args": args })).await;
        let answer = beside.dispatch(&call, args.as_array().unwrap()).unwrap();
        // What it gave the pages to draw, taken off the queues as the server takes them, and handed on with it.
        let mut views = json!({});
        for (name, take) in [("motions", "takeMotions"), ("floaters", "takeFloaters"), ("rolls", "takeRolls")] {
            views[name] = if call == take { json!([]) } else { beside.dispatch(take, &[]).unwrap() };
        }
        assert_eq!(said["id"], n + 2);
        assert_eq!(said["ok"]["answer"], answer, "{call}: the answer");
        assert_eq!(said["ok"]["board"], beside.board(), "{call}: the board");
        assert_eq!(said["ok"]["views"], views, "{call}: what it gave to draw");
        defended |= said["ok"]["board"]["pending"]["kind"] == "defense";
        played += 1;
    }
    assert!(played >= 8, "{played}");
    // The project's own code ran, on the server as beside it.
    let hooked = ["The place is kept.", "Back to the place that was kept.", "Nobody stands close enough to rally.", "The line steadies."];
    assert!(beside.log.iter().any(|line| hooked.contains(&line.text.as_str())), "a hook's line in the log");
    assert!(defended, "the defender was asked how a GM's swing lands");

    // The pointer's questions, of the server's game.
    let asked = tables.ask("kara", json!({ "id": 99, "op": "ask", "ask": "pressure" })).await;
    assert_eq!(asked["ok"], json!(beside.under_pressure_tiles()));

    // The game is kept, and comes back.
    assert!(tables.has_game("kara"));
    let resumed = tables.ask("kara", json!({ "id": 100, "op": "resume" })).await;
    assert_eq!(resumed["ok"]["board"], beside.board());
    // And which project it is a game of, for a page to come back to it only over the same.
    assert_eq!(resumed["ok"]["project"], project["id"], "{}", resumed["ok"]["project"]);
    assert!(resumed["ok"]["project"].is_string());

    // Never told how a page's game stands: not by a replica, nor its dice, walk, log, views or a save's text.
    assert_eq!(tables.ask("kara", json!({ "id": 101, "op": "restore", "replica": opened["ok"]["board"]["replica"] })).await["error"], "no op \"restore\"");
    for call in serve::play::NEVER_TOLD {
        let said = tables.ask("kara", json!({ "id": 102, "op": "call", "call": call, "args": [] })).await;
        assert_eq!(said["error"], format!("\"{call}\" is never told to the server's game"), "{said}");
    }
    assert_eq!(tables.ask("kara", json!({ "id": 103, "op": "resume" })).await["ok"]["board"], beside.board(), "and none of it moved the game");

    // Refusals: nobody's game, an op nobody knows, an intent nobody knows.
    assert_eq!(tables.ask("finn", json!({ "id": 1, "op": "call", "call": "endTurn", "args": [] })).await, json!({ "id": 1, "error": "no game: open one" }));
    assert_eq!(tables.ask("kara", json!({ "id": 2, "op": "dance" })).await["error"], "no op \"dance\"");
    assert_eq!(tables.ask("kara", json!({ "id": 3, "op": "call", "call": "dance", "args": [] })).await["error"], "no intent \"dance\"");
}

#[tokio::test]
async fn the_play_route_is_a_websocket_for_a_signed_in_page() {
    let root = root("route");
    let account = Account { id: "kara".into(), name: "Kara".into(), salt: "s".into(), hash: "h".into(), admin: false, created: 0, rest: IndexMap::new() };
    write_accounts(&root, &[account]).unwrap();
    let mut sessions = IndexMap::new();
    sessions.insert("good-token".to_string(), Signed { account: "kara".into(), expires: i64::MAX });
    write_sessions(&root, &sessions).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = serve::app(root);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let connect = |cookie: Option<&str>, origin: &str| {
        let mut request = format!("ws://{address}/__play").into_client_request().unwrap();
        let headers = request.headers_mut();
        headers.insert("origin", origin.parse().unwrap());
        if let Some(cookie) = cookie {
            headers.insert("cookie", format!("{SESSION_COOKIE}={cookie}").parse().unwrap());
        }
        tokio_tungstenite::connect_async(request)
    };
    let page = format!("http://{address}");

    // Nobody signed in, an unknown session, another origin: no socket.
    let refused = |e: tokio_tungstenite::tungstenite::Error| match e {
        tokio_tungstenite::tungstenite::Error::Http(response) => response.status().as_u16(),
        other => panic!("{other}"),
    };
    assert_eq!(refused(connect(None, &page).await.unwrap_err()), 401);
    assert_eq!(refused(connect(Some("bad-token"), &page).await.unwrap_err()), 401);
    assert_eq!(refused(connect(Some("good-token"), "http://elsewhere.example").await.unwrap_err()), 403);

    // Signed in, from the page: a game opened and played.
    let fixture = fixture();
    let (mut socket, _) = connect(Some("good-token"), &page).await.unwrap();
    let open = json!({ "id": "a", "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": { "animated": true, "askDefender": true } });
    socket.send(Message::Text(open.to_string().into())).await.unwrap();
    let opened: Value = serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(opened["id"], "a");
    assert!(opened["ok"]["seed"].is_string() && opened["ok"]["board"]["replica"].is_object(), "{opened}");
    socket.send(Message::Text(json!({ "id": "b", "op": "call", "call": "endTurn", "args": [] }).to_string().into())).await.unwrap();
    let ended: Value = serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(ended["id"], "b");
    assert!(ended["ok"]["answer"].is_number(), "{ended}");
    socket.send(Message::Text("not json".into())).await.unwrap();
    let garbled: Value = serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert!(garbled["error"].as_str().unwrap().starts_with("not a message"));
    socket.close(None).await.unwrap();

    // Back again: the game was kept.
    let (mut again, _) = connect(Some("good-token"), &page).await.unwrap();
    again.send(Message::Text(json!({ "id": "c", "op": "resume" }).to_string().into())).await.unwrap();
    let resumed: Value = serde_json::from_str(&again.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(resumed["id"], "c");
    assert_eq!(resumed["ok"]["board"]["replica"]["sceneId"], opened["ok"]["board"]["replica"]["sceneId"], "{resumed}");
}

#[tokio::test]
async fn a_game_left_longer_than_it_is_kept_goes() {
    let fixture = fixture();
    let tables = Tables::keeping(root("swept"), std::time::Duration::ZERO);
    let (conn, mut said) = tables.connect();
    tables.ask_on(conn, "kara", json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} }));
    let opened = said.recv().await.unwrap();
    assert!(opened["ok"].is_object(), "{opened}");
    assert!(tables.has_game("kara"));
    tables.left(conn);
    assert!(!tables.has_game("kara"), "kept for no time, it goes when its socket does");
    assert_eq!(tables.ask("kara", json!({ "id": 2, "op": "resume" })).await["error"], "no game: open one");
}

#[tokio::test]
async fn the_tests_server_takes_the_pages_dice_and_no_other_does() {
    let fixture = fixture();
    let open = json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {}, "rng": 123456789 });
    // A server of its own: its own seed, whatever the page says its dice are.
    let own = Tables::new(root("own-dice")).ask("kara", open.clone()).await;
    assert_ne!(own["ok"]["board"]["rng"], 123456789, "{}", own["ok"]["board"]["rng"]);
    // The tests' server: the page's dice, so a suite written against the page's own seeds rolls what it was written for.
    let tests = Tables::new(root("page-dice")).for_tests();
    let opened = tests.ask("kara", open.clone()).await;
    assert_eq!(opened["ok"]["board"]["rng"], 123456789);
    assert!(opened["ok"]["seed"].is_string(), "the server still says the seed it built with");
    // And without dice to take, its own.
    let mut bare = open;
    bare["rng"] = Value::Null;
    assert_ne!(tests.ask("kara", bare).await["ok"]["board"]["rng"], 123456789);
}

#[tokio::test]
async fn the_test_drivers_hands_are_the_tests_servers_alone() {
    let fixture = fixture();
    let open = json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} });
    let own = Tables::new(root("hands-own"));
    let tests = Tables::new(root("hands-tests")).for_tests();
    let opened = own.ask("kara", open.clone()).await;
    tests.ask("kara", open).await;
    let member = opened["ok"]["board"]["replica"]["party"]["selected"].as_str().expect("somebody selected").to_string();
    for hand in serve::play::TEST_HANDS {
        let said = own.ask("kara", json!({ "id": 2, "op": "call", "call": hand, "args": [member] })).await;
        assert_eq!(said["error"], format!("\"{hand}\" is the tests' alone"), "{said}");
    }
    assert_eq!(own.ask("kara", json!({ "id": 3, "op": "resume" })).await["ok"]["board"], opened["ok"]["board"], "nothing the hands asked was done");
    // The tests' server takes them.
    let wounded = tests.ask("kara", json!({ "id": 4, "op": "call", "call": "wound", "args": [member, 1] })).await;
    assert!(wounded["ok"].is_object(), "{wounded}");
}

#[tokio::test]
async fn a_save_is_loaded_from_the_accounts_own_folder_by_its_slot() {
    let fixture = fixture();
    let tables = Tables::new(root("load"));
    let open = json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} });
    let opened = tables.ask("kara", open).await;
    let saved = tables.ask("kara", json!({ "id": 2, "op": "save", "name": "Here", "where": "the vault" })).await;
    let slot = saved["ok"]["slot"]["id"].as_str().expect("a slot").to_string();
    // The game moves on; the save loaded puts it back where it was saved.
    tables.ask("kara", json!({ "id": 3, "op": "call", "call": "selectNext", "args": [] })).await;
    let loaded = tables.ask("kara", json!({ "id": 4, "op": "load", "slot": slot })).await;
    assert_eq!(loaded["ok"]["answer"], json!({ "ok": true }), "{loaded}");
    assert_eq!(loaded["ok"]["board"]["replica"]["party"], opened["ok"]["board"]["replica"]["party"]);
    // Only the account's own: another's slot, or none, is no save.
    assert_eq!(tables.ask("kara", json!({ "id": 5, "op": "load", "slot": "nope" })).await["error"], "no such save");
    tables.ask("finn", json!({ "id": 6, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} })).await;
    assert_eq!(tables.ask("finn", json!({ "id": 7, "op": "load", "slot": slot })).await["error"], "no such save");
}

#[tokio::test]
async fn a_walk_cut_short_puts_its_walker_down_only_on_the_line_it_walked() {
    let fixture = fixture();
    let tables = Tables::new(root("landing"));
    let open = json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": { "animated": true } });
    let opened = tables.ask("kara", open).await;
    let board = &opened["ok"]["board"]["replica"];
    let member = board["party"]["selected"].as_str().expect("somebody selected").to_string();
    let call = |n: u32, call: &str, args: Value| tables.ask("kara", json!({ "id": n, "op": "call", "call": call, "args": args }));

    // Nobody has walked: nobody is put down anywhere - not even where they stand.
    let stood = board["state"]["entities"][member.as_str()]["at"].clone();
    assert_eq!(call(2, "landWalkers", json!([[[member, stood]]])).await["ok"]["answer"], json!([]));

    // A walk a few tiles east, drawn by a view.
    let tile = board["state"]["entities"][member.as_str()]["tile"].as_i64().expect("the member's tile");
    let walked = call(3, "moveSelectedTo", json!([tile + 3])).await;
    assert_eq!(walked["ok"]["answer"]["moved"], true, "{walked}");
    // The walk to draw comes with the walk's own answer, taken off the game's queue as it was played.
    let motions = walked["ok"]["views"]["motions"].clone();
    let route: Vec<Value> = motions.as_array().unwrap().iter().find(|m| m["id"] == member.as_str()).expect("the walk drawn")["route"].as_array().unwrap().clone();
    let (start, end) = (&route[0], &route[route.len() - 1]);
    let half = json!({ "x": (start["x"].as_f64().unwrap() + end["x"].as_f64().unwrap()) / 2.0, "y": (start["y"].as_f64().unwrap() + end["y"].as_f64().unwrap()) / 2.0 });
    // Ground somebody stands on, a tile from the line: somewhere a walker could be put down, but not this one.
    let far = json!({ "x": start["x"].as_f64().unwrap(), "y": start["y"].as_f64().unwrap() + 1.0 });
    assert!(board["state"]["entities"].as_object().unwrap().values().any(|e| e["at"] == far), "{far} is stood on");

    // Off the line: not put down there.
    assert_eq!(call(5, "landWalkers", json!([[[member, far]]])).await["ok"]["answer"], json!([]));
    // Part-way along it: put down where the page drew them.
    let landed = call(6, "landWalkers", json!([[[member, half]]])).await;
    assert_eq!(landed["ok"]["answer"], json!([member]), "{landed}");
    let stands = landed["ok"]["board"]["replica"]["state"]["entities"][member.as_str()]["at"].clone();
    assert_eq!(stands, half);
    // Landed, the line is spent: not put down again until they walk again.
    assert_eq!(call(7, "landWalkers", json!([[[member, end]]])).await["ok"]["answer"], json!([]));
}

#[tokio::test]
async fn the_play_route_takes_a_page_a_tunnel_brings_from_its_public_host() {
    let root = root("tunnel");
    let account = Account { id: "wren".into(), name: "Wren".into(), salt: "s".into(), hash: "h".into(), admin: false, created: 0, rest: IndexMap::new() };
    write_accounts(&root, &[account]).unwrap();
    let mut sessions = IndexMap::new();
    sessions.insert("good-token".to_string(), Signed { account: "wren".into(), expires: i64::MAX });
    write_sessions(&root, &sessions).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, serve::app(root)).await.unwrap() });

    // The tunnel connects from this machine; the page was loaded from its public host, over HTTPS.
    let connect = |origin: &str, forwarded: Option<&str>| {
        let mut request = format!("ws://{address}/__play").into_client_request().unwrap();
        let headers = request.headers_mut();
        headers.insert("origin", origin.parse().unwrap());
        headers.insert("cookie", format!("{SESSION_COOKIE}=good-token").parse().unwrap());
        if let Some(host) = forwarded {
            headers.insert("x-forwarded-host", host.parse().unwrap());
        }
        tokio_tungstenite::connect_async(request)
    };
    let status = |e: tokio_tungstenite::tungstenite::Error| match e {
        tokio_tungstenite::tungstenite::Error::Http(response) => response.status().as_u16(),
        other => panic!("{other}"),
    };
    assert!(connect("https://friends.example", Some("friends.example")).await.is_ok(), "the page, through the tunnel");
    // A page from another site, through the same tunnel; and a public origin no proxy vouches for.
    assert_eq!(status(connect("https://elsewhere.example", Some("friends.example")).await.unwrap_err()), 403);
    assert_eq!(status(connect("https://friends.example", None).await.unwrap_err()), 403);
}

/// The next thing a connection is told, answer or push - or a failure, when nothing comes.
async fn told(said: &mut tokio::sync::mpsc::UnboundedReceiver<Value>) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(5), said.recv()).await.expect("told something in time").expect("the connection open")
}

/// Whether a connection has been told anything more, once whatever was on its way has come.
async fn nothing_more(said: &mut tokio::sync::mpsc::UnboundedReceiver<Value>) -> bool {
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    said.try_recv().is_err()
}

#[tokio::test]
async fn a_game_is_shared_its_invitation_joins_it_and_each_intent_is_pushed_to_the_others() {
    let fixture = fixture();
    let tables = Tables::new(root("shared")).for_tests();
    let (host, mut to_host) = tables.connect();
    let (guest, mut to_guest) = tables.connect();
    tables.ask_on(host, "kara", json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} }));
    let opened = told(&mut to_host).await;
    let invite = opened["ok"]["invite"].as_str().expect("an invitation").to_string();
    assert_eq!(invite.len(), 32);
    assert_eq!(opened["ok"]["table"]["host"], "kara");
    assert_eq!(opened["ok"]["you"], "kara");
    assert_eq!(opened["ok"]["seq"], 0, "nothing played yet");
    assert_eq!(opened["ok"]["table"]["members"], json!([{ "id": "kara", "name": "kara" }]));

    // A wrong invitation joins nothing.
    tables.ask_on(guest, "finn", json!({ "id": 1, "op": "join", "invite": "nope" }));
    assert_eq!(told(&mut to_guest).await["error"], "no game for that invitation");
    // The right one: the guest stood where the game is, and the host told who is at it now.
    tables.ask_on(guest, "finn", json!({ "id": 2, "op": "join", "invite": invite }));
    let joined = told(&mut to_guest).await;
    assert_eq!(joined["id"], 2);
    // Where the game is - but the guest plays nobody yet, so has nobody selected (`engine::game::seats`).
    let mut theirs = opened["ok"]["board"].clone();
    theirs["replica"]["party"]["selected"] = Value::Null;
    assert_eq!(joined["ok"]["board"], theirs);
    assert_eq!(joined["ok"]["project"], fixture["projects"][0]["id"]);
    assert_eq!(joined["ok"]["table"]["members"].as_array().unwrap().len(), 2);
    assert_eq!(joined["ok"]["you"], "finn");
    assert_eq!(told(&mut to_host).await["table"]["members"][1]["id"], "finn");

    // The host's intent: answered to the host, pushed to the guest - the board it left, and the walk to draw.
    let member = opened["ok"]["board"]["replica"]["party"]["selected"].as_str().unwrap().to_string();
    let tile = opened["ok"]["board"]["replica"]["state"]["entities"][member.as_str()]["tile"].as_i64().unwrap();
    tables.ask_on(host, "kara", json!({ "id": 3, "op": "call", "call": "moveSelectedTo", "args": [tile + 2] }));
    let walked = told(&mut to_host).await;
    assert_eq!(walked["id"], 3);
    let pushed = told(&mut to_guest).await;
    assert!(pushed["id"].is_null(), "{pushed}");
    // The board the walk left, with the guest's own selection on it: nobody, yet.
    let mut theirs = walked["ok"]["board"].clone();
    theirs["replica"]["party"]["selected"] = Value::Null;
    assert_eq!(pushed["push"]["board"], theirs);
    assert_eq!(pushed["push"]["views"], walked["ok"]["views"]);
    assert!(!pushed["push"]["views"]["motions"].as_array().unwrap().is_empty(), "the walk to draw");
    assert_eq!(pushed["push"]["by"], "kara");
    // Numbered as the game played it: the first intent, in the answer and the push alike.
    assert_eq!((walked["ok"]["seq"].clone(), pushed["push"]["seq"].clone()), (json!(1), json!(1)));
    assert!(nothing_more(&mut to_host).await, "the host is not pushed its own intent");
    // Seated in another, the guest's intent is pushed to the host the same way - with the host's own selection.
    let other = walked["ok"]["board"]["replica"]["party"]["order"].as_array().map(|o| o.to_vec()).unwrap_or_default();
    let other = other.iter().filter_map(Value::as_str).chain(walked["ok"]["board"]["replica"]["state"]["entities"].as_object().unwrap().iter().filter(|(_, e)| e["faction"] == "party").map(|(id, _)| id.as_str())).find(|id| *id != member).expect("another in the party").to_string();
    tables.ask_on(host, "kara", json!({ "id": 4, "op": "seat", "character": other, "account": "finn" }));
    told(&mut to_host).await;
    told(&mut to_guest).await;
    let there = walked["ok"]["board"]["replica"]["state"]["entities"][other.as_str()]["tile"].as_i64().unwrap();
    tables.ask_on(guest, "finn", json!({ "id": 4, "op": "call", "call": "moveSelectedTo", "args": [there + 1] }));
    let moved = told(&mut to_guest).await;
    assert_eq!(moved["ok"]["seq"], 2);
    assert_eq!(moved["ok"]["board"]["replica"]["party"]["selected"], other.as_str(), "the guest walks their own");
    let mut pushed = told(&mut to_host).await["push"]["board"].clone();
    assert_eq!(pushed["replica"]["party"]["selected"], member.as_str(), "the host's selection is the host's");
    pushed["replica"]["party"]["selected"] = json!(other);
    assert_eq!(pushed, moved["ok"]["board"]);
    // A question the pointer asks changes nothing, and is pushed to nobody.
    tables.ask_on(host, "kara", json!({ "id": 5, "op": "ask", "ask": "pressure" }));
    told(&mut to_host).await;
    assert!(nothing_more(&mut to_guest).await, "nothing pushed for a question");
    // Nor is what a page sends as it draws itself, whatever mark it leaves (`DRAWN`): it reaches the others with
    // the next intent that is pushed.
    for call in serve::play::DRAWN {
        let args = if *call == "abilityList" { json!([member]) } else if call.starts_with("read") { json!(["nothing"]) } else { json!([]) };
        tables.ask_on(host, "kara", json!({ "id": 6, "op": "call", "call": call, "args": args }));
        told(&mut to_host).await;
    }
    assert!(nothing_more(&mut to_guest).await, "nothing pushed for drawing");
    // The next intent that is pushed carries what the drawing marked.
    tables.ask_on(host, "kara", json!({ "id": 7, "op": "call", "call": "selectNext", "args": [] }));
    assert_ne!(told(&mut to_host).await["ok"]["board"]["replica"]["party"]["selected"], member.as_str());
    assert!(told(&mut to_guest).await["push"].is_object());
    // Nor an intent that leaves the board as it was and gives nothing to draw: a selection, each page's own, among it.
    tables.ask_on(host, "kara", json!({ "id": 8, "op": "call", "call": "select", "args": [member] }));
    assert_eq!(told(&mut to_host).await["ok"]["board"]["replica"]["party"]["selected"], member.as_str());
    assert!(nothing_more(&mut to_guest).await, "nothing pushed when nothing changed");

    // Who plays whom: the host's to say, of somebody at the game; the others told.
    tables.ask_on(guest, "finn", json!({ "id": 7, "op": "seat", "character": member, "account": "finn" }));
    assert_eq!(told(&mut to_guest).await["error"], "only the host says who plays whom");
    tables.ask_on(host, "kara", json!({ "id": 8, "op": "seat", "character": member, "account": "stranger" }));
    assert_eq!(told(&mut to_host).await["error"], "not at this game");
    tables.ask_on(host, "kara", json!({ "id": 9, "op": "seat", "character": member, "account": "finn" }));
    assert_eq!(told(&mut to_host).await["ok"]["table"]["seats"], json!({ other.as_str(): "finn", member.as_str(): "finn" }));
    let table = told(&mut to_guest).await;
    assert_eq!(table["table"]["seats"], json!({ other.as_str(): "finn", member.as_str(): "finn" }));
    assert_eq!(table.as_object().map(|told| told.keys().cloned().collect::<Vec<_>>()), Some(vec!["table".to_string()]), "a table and nothing else: {table}");
    tables.ask_on(host, "kara", json!({ "id": 10, "op": "seat", "character": member, "account": null }));
    assert_eq!(told(&mut to_host).await["ok"]["table"]["seats"], json!({ other.as_str(): "finn" }));
    told(&mut to_guest).await;

    // A save loaded puts everybody somewhere else: not the guest's to do.
    tables.ask_on(guest, "finn", json!({ "id": 11, "op": "save", "name": "Mine", "where": "here" }));
    let slot = told(&mut to_guest).await["ok"]["slot"]["id"].as_str().expect("a slot").to_string();
    tables.ask_on(guest, "finn", json!({ "id": 12, "op": "load", "slot": slot }));
    assert_eq!(told(&mut to_guest).await["error"], "only the host loads a save into a game others are at");

    // The guest's page reloaded: back at the shared game, not one of its own.
    let resumed = tables.ask("finn", json!({ "id": 13, "op": "resume" })).await;
    assert_eq!(resumed["ok"]["table"]["game"], opened["ok"]["table"]["game"]);
}

#[tokio::test]
async fn a_shared_game_is_kept_while_anybody_is_at_it() {
    let fixture = fixture();
    let tables = Tables::keeping(root("kept-shared"), std::time::Duration::ZERO);
    let (host, mut to_host) = tables.connect();
    let (guest, mut to_guest) = tables.connect();
    tables.ask_on(host, "kara", json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} }));
    let invite = told(&mut to_host).await["ok"]["invite"].as_str().unwrap().to_string();
    tables.ask_on(guest, "finn", json!({ "id": 1, "op": "join", "invite": invite }));
    told(&mut to_guest).await;
    // The host goes; the guest is still at it, so it is kept, for the host to come back to.
    tables.left(host);
    assert!(tables.has_game("kara") && tables.has_game("finn"));
    // The last goes: kept for no time, it goes.
    tables.left(guest);
    assert!(!tables.has_game("finn") && !tables.has_game("kara"));
}

#[tokio::test]
async fn a_guests_page_reads_the_games_project_with_its_invitation() {
    let root = root("join-route");
    let account = Account { id: "finn".into(), name: "Finn".into(), salt: "s".into(), hash: "h".into(), admin: false, created: 0, rest: IndexMap::new() };
    write_accounts(&root, &[account]).unwrap();
    let mut sessions = IndexMap::new();
    sessions.insert("good-token".to_string(), Signed { account: "finn".into(), expires: i64::MAX });
    write_sessions(&root, &sessions).unwrap();
    let fixture = fixture();
    let tables = Tables::new(root);
    let opened = tables.ask("kara", json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} })).await;
    let invite = opened["ok"]["invite"].as_str().unwrap().to_string();
    let app = serve::play::router_for(tables);
    let get = |path: String, cookie: Option<&str>| {
        let mut request = axum::http::Request::builder().uri(path);
        if let Some(cookie) = cookie {
            request = request.header("cookie", format!("{SESSION_COOKIE}={cookie}"));
        }
        tower::ServiceExt::oneshot(app.clone(), request.body(axum::body::Body::empty()).unwrap())
    };
    let read = get(format!("/__play/join/{invite}"), Some("good-token")).await.unwrap();
    assert_eq!(read.status(), 200);
    let body: Value = serde_json::from_slice(&http_body_util::BodyExt::collect(read.into_body()).await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["project"], fixture["projects"][0]);
    assert_eq!(get(format!("/__play/join/{invite}"), None).await.unwrap().status(), 401);
    assert_eq!(get("/__play/join/nope".into(), Some("good-token")).await.unwrap().status(), 404);
}

#[tokio::test]
async fn each_player_acts_with_their_own_and_answers_the_questions_put_to_them() {
    let fixture = fixture();
    let tables = Tables::new(root("seats")).for_tests();
    let (host, mut to_host) = tables.connect();
    let (guest, mut to_guest) = tables.connect();
    let open = json!({ "id": 1, "op": "open", "project": fixture["projects"][1], "shipped": fixture["shipped"], "table": { "animated": false, "askDefender": true }, "rng": DICE });
    tables.ask_on(host, "kara", open);
    let opened = told(&mut to_host).await;
    let invite = opened["ok"]["invite"].as_str().unwrap().to_string();
    tables.ask_on(guest, "finn", json!({ "id": 1, "op": "join", "invite": invite }));
    told(&mut to_guest).await;
    told(&mut to_host).await;
    let hosts = opened["ok"]["board"]["replica"]["party"]["selected"].as_str().unwrap().to_string();
    let entities = opened["ok"]["board"]["replica"]["state"]["entities"].as_object().unwrap().clone();
    let guests = entities.iter().filter(|(_, e)| e["faction"] == "party").map(|(id, _)| id.clone()).find(|id| *id != hosts).unwrap();
    tables.ask_on(host, "kara", json!({ "id": 2, "op": "seat", "character": guests, "account": "finn" }));
    told(&mut to_host).await;
    told(&mut to_guest).await;
    // Seated, the guest has their own selected at once: on the next board they are pushed.
    tables.ask_on(host, "kara", json!({ "id": 3, "op": "call", "call": "note", "args": ["The table is set.", "system"] }));
    told(&mut to_host).await;
    assert_eq!(told(&mut to_guest).await["push"]["board"]["replica"]["party"]["selected"], guests.as_str());

    // The guest's own, and theirs alone to choose.
    tables.ask_on(guest, "finn", json!({ "id": 2, "op": "call", "call": "select", "args": [hosts] }));
    let refused = told(&mut to_guest).await;
    assert_eq!(refused["ok"]["answer"], false, "another's is not selected");
    assert_eq!(refused["ok"]["board"]["replica"]["party"]["selected"], guests.as_str());
    // Nor is anything done with another's: refused in its own shape, nothing changed, nothing pushed.
    tables.ask_on(guest, "finn", json!({ "id": 3, "op": "call", "call": "useAbility", "args": [hosts, "anything", []] }));
    assert_eq!(told(&mut to_guest).await["ok"]["answer"], json!({ "status": "refused", "lines": [] }));
    assert!(nothing_more(&mut to_host).await, "nothing pushed for a refusal");
    // And no page tells the server's game whom it plays for: the server does.
    tables.ask_on(guest, "finn", json!({ "id": 4, "op": "call", "call": "restoreSeating", "args": [null] }));
    assert_eq!(told(&mut to_guest).await["error"], "\"restoreSeating\" is never told to the server's game");

    // The host plays on with theirs; the guest's selection is still the guest's after.
    let tile = entities[&hosts]["tile"].as_i64().unwrap();
    tables.ask_on(host, "kara", json!({ "id": 3, "op": "call", "call": "moveSelectedTo", "args": [tile + 1] }));
    assert_eq!(told(&mut to_host).await["ok"]["board"]["replica"]["party"]["selected"], hosts.as_str());
    assert_eq!(told(&mut to_guest).await["push"]["board"]["replica"]["party"]["selected"], guests.as_str());
    let resumed = tables.ask("finn", json!({ "id": 5, "op": "resume" })).await;
    assert_eq!(resumed["ok"]["board"]["replica"]["party"]["selected"], guests.as_str());

    // A fight, and the host's beside a husk when the GM's turn comes: the defender is asked, and only its player answers.
    let husk = entities["group-1-husk-16-8"]["tile"].as_i64().unwrap();
    for (n, (call, args)) in [("startEncounter", json!(["group-1"])), ("placeAt", json!([hosts, husk - 1])), ("placeAt", json!([guests, husk - 3])), ("endTurn", json!([]))].into_iter().enumerate() {
        tables.ask_on(host, "kara", json!({ "id": 10 + n, "op": "call", "call": call, "args": args }));
        told(&mut to_host).await;
    }
    let asked = tables.ask("kara", json!({ "id": 20, "op": "resume" })).await["ok"]["board"]["pending"].clone();
    assert_eq!(asked["kind"], "defense", "{asked}");
    let defender = asked["for"].as_str().expect("whom it is put to").to_string();
    let (answers, other) = if defender == hosts { (("kara", host), ("finn", guest)) } else { (("finn", guest), ("kara", host)) };
    while to_guest.try_recv().is_ok() {}
    tables.ask_on(other.1, other.0, json!({ "id": 21, "op": "call", "call": "answerPending", "args": [{ "kind": "continue" }] }));
    let mut to_other = if other.0 == "kara" { &mut to_host } else { &mut to_guest };
    let not_theirs = told(&mut to_other).await;
    assert_eq!(not_theirs["ok"]["answer"]["status"], "refused", "{not_theirs}");
    assert_eq!(not_theirs["ok"]["board"]["pending"], asked);
    to_other = if answers.0 == "kara" { &mut to_host } else { &mut to_guest };
    tables.ask_on(answers.1, answers.0, json!({ "id": 22, "op": "call", "call": "answerPending", "args": [{ "kind": "continue" }] }));
    let answered = told(&mut to_other).await;
    assert_ne!(answered["ok"]["answer"]["status"], "refused", "{answered}");
    assert_ne!(answered["ok"]["board"]["pending"], asked);
}
