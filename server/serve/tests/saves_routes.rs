//! Each player's saves on the server (`serve::saves`): written by the player's game itself through the socket
//! (`save`, `serve::play`) - its own text, the same a session played beside it saves - into the account's own
//! folder; listed, read, removed and a browser's slots imported over `/__saves`, signed in, the writes only
//! from the page; and nothing outside the folder reachable by a slot's id.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use engine::game::content::Shipped;
use engine::game::session::Session;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use serve::play::Tables;
use serve::saves::{import_saves, is_slot_id, read_save, read_slots, remove_save, saves_folder, write_save, Slot};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use tower::ServiceExt;

const PAGE: [(&str, &str); 3] = [("x-tactical-save", "1"), ("origin", "http://127.0.0.1:8420"), ("host", "127.0.0.1:8420")];

fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-saves-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("data")).unwrap();
    root
}

fn fixture() -> Value {
    serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/replica.json")).unwrap()).unwrap()
}

fn slot(id: &str, name: &str) -> Slot {
    Slot { id: id.into(), name: name.into(), saved_at: 1, place: "The Husk Vault".into(), project: None }
}

async fn send(root: &Path, method: &str, path: &str, body: &str, cookie: Option<&str>, page: bool) -> (StatusCode, Value, String) {
    let mut request = Request::builder().method(method).uri(path);
    if page {
        for (name, value) in PAGE {
            request = request.header(name, value);
        }
    }
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    let response = serve::app(root.to_path_buf()).oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = response.status();
    let text = String::from_utf8(response.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap();
    (status, serde_json::from_str(&text).unwrap_or(Value::Null), text)
}

async fn player(root: &Path, name: &str) -> String {
    let mut request = Request::builder().method("POST").uri("/__accounts/register");
    for (header, value) in PAGE {
        request = request.header(header, value);
    }
    let body = json!({ "name": name, "password": "hunter22" }).to_string();
    let response = serve::app(root.to_path_buf()).oneshot(request.body(Body::from(body)).unwrap()).await.unwrap();
    response.headers().get("set-cookie").unwrap().to_str().unwrap().split(';').next().unwrap().to_string()
}

#[test]
fn a_folder_of_saves_keeps_its_slots_and_nothing_outside_it() {
    let root = folder("files");
    assert!(read_slots(&root, "kara").is_empty());
    write_save(&root, "kara", slot("quick", "Quick save"), "{\"one\":1}").unwrap();
    write_save(&root, "kara", slot("s1", "Before the vault"), "{\"two\":2}").unwrap();
    write_save(&root, "kara", Slot { saved_at: 2, ..slot("quick", "Quick save") }, "{\"three\":3}").unwrap();
    // A fixed slot overwritten, in place of the old in the list.
    let slots = read_slots(&root, "kara");
    assert_eq!(slots.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["s1", "quick"]);
    assert_eq!(read_save(&root, "kara", "quick").as_deref(), Some("{\"three\":3}"));
    // Another player's saves are theirs.
    assert!(read_slots(&root, "finn").is_empty());
    assert_eq!(read_save(&root, "finn", "quick"), None);
    // The index's own keys, as the page lists them.
    let index: Value = serde_json::from_str(&std::fs::read_to_string(saves_folder(&root, "kara").join("index.json")).unwrap()).unwrap();
    // Written as the page writes it: `savedAt` a whole number, as `Date.now()` is.
    assert_eq!(index[0], json!({ "id": "s1", "name": "Before the vault", "savedAt": 1, "where": "The Husk Vault" }));
    assert!(std::fs::read_to_string(saves_folder(&root, "kara").join("index.json")).unwrap().contains("\"savedAt\": 1,"));
    // A file in the folder its index does not list is not a save to read.
    std::fs::write(saves_folder(&root, "kara").join("ghost.json"), "{}").unwrap();
    assert_eq!(read_save(&root, "kara", "ghost"), None);
    // No id climbs out of the folder, nor names the index.
    std::fs::write(root.join("data/users/kara/secret.json"), "{}").unwrap();
    for id in ["../secret", "..", "a/b", "", "index"] {
        assert_eq!(read_save(&root, "kara", id), None, "{id}");
    }
    assert!(!is_slot_id("../secret") && !is_slot_id(&"x".repeat(65)) && !is_slot_id("index") && is_slot_id("auto-camp_2"));
    assert!(write_save(&root, "kara", slot("index", "x"), "[]").is_err(), "the index is not a slot");
    assert_eq!(read_slots(&root, "kara").len(), 2);
    assert!(write_save(&root, "kara", slot("../secret", "x"), "{}").is_err());
    // Removed, and an import takes only what the account has not got.
    assert!(remove_save(&root, "kara", "s1"));
    assert!(!remove_save(&root, "kara", "s1"));
    assert!(!saves_folder(&root, "kara").join("s1.json").exists());
    let taken = import_saves(&root, "kara", vec![(slot("quick", "Old quick"), "{\"old\":1}".into()), (slot("s9", "Old named"), "{\"old\":2}".into())]).unwrap();
    assert_eq!(taken, 1);
    assert_eq!(read_save(&root, "kara", "quick").as_deref(), Some("{\"three\":3}"), "kept as it was");
    assert_eq!(read_save(&root, "kara", "s9").as_deref(), Some("{\"old\":2}"));
}

#[tokio::test]
async fn the_saves_routes_are_a_signed_in_players_own() {
    let root = folder("routes");
    let kara = player(&root, "kara").await;
    let finn = player(&root, "finn").await;
    assert_eq!(send(&root, "GET", "/__saves", "", None, false).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(send(&root, "GET", "/__saves", "", Some(&kara), false).await.1, json!([]));
    let import = json!({ "saves": [
        { "slot": { "id": "quick", "name": "Quick save", "savedAt": 5, "where": "The camp", "project": "camp" }, "text": "{\"version\":5}" },
        { "slot": { "id": "s1", "name": "Named", "savedAt": 6, "where": "The vault" }, "text": "{\"version\":4}" },
    ] })
    .to_string();
    // Only from the page.
    assert_eq!(send(&root, "POST", "/__saves/import", &import, Some(&kara), false).await.0, StatusCode::FORBIDDEN);
    let (status, said, _) = send(&root, "POST", "/__saves/import", &import, Some(&kara), true).await;
    assert_eq!((status, said), (StatusCode::OK, json!({ "imported": 2 })));
    assert_eq!(send(&root, "POST", "/__saves/import", &import, Some(&kara), true).await.1, json!({ "imported": 0 }), "a second time, nothing");
    let (_, slots, _) = send(&root, "GET", "/__saves", "", Some(&kara), false).await;
    assert_eq!(slots[0], json!({ "id": "quick", "name": "Quick save", "savedAt": 5, "where": "The camp", "project": "camp" }));
    let (status, _, text) = send(&root, "GET", "/__saves/s1", "", Some(&kara), false).await;
    assert_eq!((status, text.as_str()), (StatusCode::OK, "{\"version\":4}"));
    // Kara's, not Finn's.
    assert_eq!(send(&root, "GET", "/__saves/s1", "", Some(&finn), false).await.0, StatusCode::NOT_FOUND);
    assert_eq!(send(&root, "GET", "/__saves", "", Some(&finn), false).await.1, json!([]));
    let bad = json!({ "saves": [{ "slot": { "id": "../x", "name": "x", "savedAt": 1, "where": "" }, "text": "{}" }] }).to_string();
    assert_eq!(send(&root, "POST", "/__saves/import", &bad, Some(&kara), true).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(send(&root, "POST", "/__saves/import", "not json", Some(&kara), true).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    // Removed, from the page only.
    assert_eq!(send(&root, "POST", "/__saves/remove", "{\"id\":\"s1\"}", Some(&kara), false).await.0, StatusCode::FORBIDDEN);
    assert_eq!(send(&root, "POST", "/__saves/remove", "{\"id\":\"s1\"}", Some(&kara), true).await.0, StatusCode::OK);
    assert_eq!(send(&root, "POST", "/__saves/remove", "{\"id\":\"s1\"}", Some(&kara), true).await.0, StatusCode::NOT_FOUND);
    assert_eq!(send(&root, "GET", "/__saves/s1", "", Some(&kara), false).await.0, StatusCode::NOT_FOUND);
}

fn hooks() -> engine::game::session::HooksFor {
    Rc::new(|code: &[CodeSource]| -> Rc<dyn Hooks> {
        if code.is_empty() {
            Rc::new(NoHooks)
        } else {
            Rc::new(hooks::QuickJsHooks::compile(code).0)
        }
    })
}

#[tokio::test]
async fn a_game_on_the_server_saves_itself_into_its_players_folder() {
    let root = folder("game");
    let fixture = fixture();
    let project = &fixture["projects"][0];
    // The tests' tables: a fight is started below with the test driver's hand.
    let tables = Tables::new(root.clone()).for_tests();
    let opened = tables.ask("kara", json!({ "id": 1, "op": "open", "project": project, "shipped": fixture["shipped"], "table": { "animated": true, "askDefender": true } })).await;
    let seed = opened["ok"]["seed"].as_str().unwrap().to_string();
    let shipped: Shipped = serde_json::from_value(fixture["shipped"].clone()).unwrap();
    let mut beside = Session::build(project, Rc::new(shipped), hooks(), &seed).unwrap();
    beside.animated = true;
    beside.ask_defender = true;
    for (n, call) in ["selectNext", "selectNext", "syncTalks"].into_iter().enumerate() {
        tables.ask("kara", json!({ "id": n + 2, "op": "call", "call": call, "args": [] })).await;
        beside.dispatch(call, &[]).unwrap();
    }

    // Into a fresh slot: the game's own text, the same as the session beside it saves.
    let saved = tables.ask("kara", json!({ "id": 10, "op": "save", "name": "Before the vault", "where": "The Husk Vault", "project": "demo" })).await;
    assert_eq!(saved["id"], 10, "{saved}");
    let text = beside.serialise_save().unwrap();
    assert_eq!(saved["ok"]["text"], json!(text));
    let fresh = saved["ok"]["slot"].clone();
    let id = fresh["id"].as_str().unwrap().to_string();
    assert!(id.starts_with('s') && is_slot_id(&id), "{fresh}");
    assert_eq!((fresh["name"].clone(), fresh["where"].clone(), fresh["project"].clone()), (json!("Before the vault"), json!("The Husk Vault"), json!("demo")));
    assert_eq!(read_save(&root, "kara", &id).as_deref(), Some(text.as_str()), "written into kara's folder");

    // Into a slot named - the quick save - and over it again.
    for n in 0..2 {
        let quick = tables.ask("kara", json!({ "id": 20 + n, "op": "save", "slot": "quick", "name": "Quick save", "where": "The Husk Vault" })).await;
        assert_eq!(quick["ok"]["slot"]["id"], "quick", "{quick}");
    }
    assert_eq!(read_slots(&root, "kara").len(), 2);
    assert_eq!(read_slots(&root, "finn").len(), 0);
    let refused = tables.ask("kara", json!({ "id": 30, "op": "save", "slot": "../out", "name": "x", "where": "" })).await;
    assert_eq!(refused["error"], "not a slot");

    // In a fight a game may not be saved: the reason the game gives, and nothing written.
    tables.ask("kara", json!({ "id": 40, "op": "call", "call": "startEncounter", "args": ["group-1"] })).await;
    beside.dispatch("startEncounter", &[json!("group-1")]).unwrap();
    let blocked = tables.ask("kara", json!({ "id": 41, "op": "save", "slot": "auto", "name": "Autosave", "where": "" })).await;
    assert_eq!(blocked["error"], json!(beside.save_blocked_by().expect("a fight blocks a save")), "{blocked}");
    assert_eq!(read_slots(&root, "kara").len(), 2);
}
