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

#[tokio::test]
async fn a_game_on_the_server_plays_as_the_engine_plays() {
    let fixture = fixture();
    let shipped: Shipped = serde_json::from_value(fixture["shipped"].clone()).unwrap();
    let project = &fixture["projects"][1];
    let tables = Tables::new(root("host"));

    let opened = tables.ask("kara", json!({ "id": 1, "op": "open", "project": project, "shipped": fixture["shipped"], "table": { "animated": true, "askDefender": true } })).await;
    assert_eq!(opened["id"], 1, "{opened}");
    let seed = opened["ok"]["seed"].as_str().expect("the server's seed").to_string();
    assert_eq!(seed.len(), 16);

    // The same game, played beside it in this thread: the server's seed, the page's table.
    let mut beside = Session::build(project, Rc::new(shipped), hooks_for(), &seed).unwrap();
    beside.animated = true;
    beside.ask_defender = true;
    assert_eq!(opened["ok"]["board"], beside.board(), "stood up the same");

    let mut played = 0;
    let mut defended = false;
    for (n, (call, args)) in intents(&mut beside).into_iter().enumerate() {
        let said = tables.ask("kara", json!({ "id": n + 2, "op": "call", "call": call, "args": args })).await;
        let answer = beside.dispatch(&call, args.as_array().unwrap()).unwrap();
        assert_eq!(said["id"], n + 2);
        assert_eq!(said["ok"]["answer"], answer, "{call}: the answer");
        assert_eq!(said["ok"]["board"], beside.board(), "{call}: the board");
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

    // The socket goes; the game is kept, and comes back.
    tables.left("kara");
    assert!(tables.has_game("kara"));
    let resumed = tables.ask("kara", json!({ "id": 100, "op": "resume" })).await;
    assert_eq!(resumed["ok"]["board"], beside.board());

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
    let opened = tables.ask("kara", json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} })).await;
    assert!(opened["ok"].is_object(), "{opened}");
    assert!(tables.has_game("kara"));
    tables.left("kara");
    assert!(!tables.has_game("kara"), "kept for no time, it goes when its socket does");
    assert_eq!(tables.ask("kara", json!({ "id": 2, "op": "resume" })).await["error"], "no game: open one");
}
