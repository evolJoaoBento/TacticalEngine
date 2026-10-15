//! The `/__friends` routes end to end, over a folder of their own: a request by name, accepted or declined; two who
//! ask each other friends at once; either removing the other; an account made with a player's invitation that
//! player's friend from the start; what friends write each other; and which friends are around.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use serve::play::Tables;
use std::path::PathBuf;
use std::time::Duration;
use tower::ServiceExt;

fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-friends-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

const PAGE: [(&str, &str); 3] = [("x-tactical-save", "1"), ("origin", "http://127.0.0.1:8420"), ("host", "127.0.0.1:8420")];

async fn send(app: &axum::Router, method: &str, path: &str, body: &str, cookie: Option<&str>, page: bool) -> (StatusCode, Value, Option<String>) {
    let mut request = Request::builder().method(method).uri(path);
    if page {
        for (name, value) in PAGE {
            request = request.header(name, value);
        }
    }
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    let response = app.clone().oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = response.status();
    let cookie = response.headers().get("set-cookie").map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null), cookie)
}

/// An account made on this machine, signed in: its cookie.
async fn player(app: &axum::Router, name: &str) -> String {
    let (status, body, cookie) = send(app, "POST", "/__accounts/register", &json!({ "name": name, "password": "hunter22" }).to_string(), None, true).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    cookie.unwrap()
}

fn people(names: &[(&str, &str)]) -> Value {
    json!(names.iter().map(|(id, name)| json!({ "id": id, "name": name })).collect::<Vec<_>>())
}

#[tokio::test]
async fn friends_ask_by_name_and_accept_decline_or_remove() {
    let root = folder("life");
    // Nobody counted online, so each view is the same whoever asked last.
    let app = serve::app_over(root.clone(), serve::Settings::default(), Tables::new(root.clone()).online_for(Duration::ZERO));
    let (wren, pip, moth) = (player(&app, "Wren").await, player(&app, "Pip").await, player(&app, "Moth").await);
    let post = |cookie: &str, route: &str, body: Value| {
        let (app, cookie, path) = (app.clone(), cookie.to_string(), format!("/__friends/{route}"));
        async move { send(&app, "POST", &path, &body.to_string(), Some(&cookie), true).await }
    };
    let mine = |cookie: &str| {
        let (app, cookie) = (app.clone(), cookie.to_string());
        async move { send(&app, "GET", "/__friends", "", Some(&cookie), false).await.1 }
    };
    // Nobody signed in has none; a player has none to start.
    assert_eq!(send(&app, "GET", "/__friends", "", None, false).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(mine(&wren).await, json!({ "friends": [], "asking": [], "asked": [], "unread": {}, "online": {} }));

    // Wren asks Pip by name, whatever its case: Wren has asked, Pip is asked.
    let (status, asked, _) = post(&wren, "ask", json!({ "name": "PIP" })).await;
    assert_eq!((status, asked), (StatusCode::OK, json!({ "friends": [], "asking": [], "asked": people(&[("pip", "Pip")]), "unread": {}, "online": {} })));
    assert_eq!(mine(&pip).await["asking"], people(&[("wren", "Wren")]));
    // Asked again, nothing more; nobody of that name, oneself, refused.
    assert_eq!(post(&wren, "ask", json!({ "name": "Pip" })).await.1["asked"], people(&[("pip", "Pip")]));
    assert_eq!(post(&wren, "ask", json!({ "name": "nobody" })).await.0, StatusCode::NOT_FOUND);
    assert_eq!(post(&wren, "ask", json!({ "name": "wren" })).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    // Pip accepts: friends, both ways, the request gone.
    let (status, answered, _) = post(&pip, "answer", json!({ "from": "wren", "accept": true })).await;
    assert_eq!((status, answered), (StatusCode::OK, json!({ "friends": people(&[("wren", "Wren")]), "asking": [], "asked": [], "unread": {}, "online": {} })));
    assert_eq!(mine(&wren).await, json!({ "friends": people(&[("pip", "Pip")]), "asking": [], "asked": [], "unread": {}, "online": {} }));
    assert_eq!(post(&wren, "ask", json!({ "name": "pip" })).await.0, StatusCode::CONFLICT);
    // An answer to nobody's request is refused.
    assert_eq!(post(&pip, "answer", json!({ "from": "moth", "accept": true })).await.0, StatusCode::NOT_FOUND);

    // Moth asks Wren; Wren declines: nothing between them.
    post(&moth, "ask", json!({ "name": "wren" })).await;
    let (_, declined, _) = post(&wren, "answer", json!({ "from": "moth", "accept": false })).await;
    assert_eq!(declined["asking"], json!([]));
    assert_eq!(mine(&moth).await, json!({ "friends": [], "asking": [], "asked": [], "unread": {}, "online": {} }));
    // Two who ask each other are friends at once.
    post(&moth, "ask", json!({ "name": "pip" })).await;
    let (_, both, _) = post(&pip, "ask", json!({ "name": "moth" })).await;
    assert_eq!(both, json!({ "friends": people(&[("wren", "Wren"), ("moth", "Moth")]), "asking": [], "asked": [], "unread": {}, "online": {} }));
    // A request taken back, and a friend removed - by either.
    post(&moth, "ask", json!({ "name": "wren" })).await;
    assert_eq!(post(&moth, "remove", json!({ "id": "wren" })).await.1["asked"], json!([]));
    assert_eq!(mine(&wren).await["asking"], json!([]));
    let (status, removed, _) = post(&wren, "remove", json!({ "id": "pip" })).await;
    assert_eq!((status, removed["friends"].clone()), (StatusCode::OK, json!([])));
    assert_eq!(mine(&pip).await["friends"], people(&[("moth", "Moth")]));
    assert_eq!(post(&wren, "remove", json!({ "id": "pip" })).await.0, StatusCode::NOT_FOUND);
    // Only the page writes.
    assert_eq!(send(&app, "POST", "/__friends/ask", r#"{"name":"pip"}"#, Some(&wren), false).await.0, StatusCode::FORBIDDEN);
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn an_account_made_with_an_invitation_is_its_holders_friend() {
    let root = folder("invited");
    let app = serve::app(root.clone());
    let wren = player(&app, "Wren").await;
    let code = send(&app, "GET", "/__accounts/invitation", "", Some(&wren), false).await.1["code"].as_str().unwrap().to_string();
    let (status, _, pip) = send(&app, "POST", "/__accounts/register", &json!({ "name": "Pip", "password": "hunter22", "invite": code }).to_string(), None, true).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(send(&app, "GET", "/__friends", "", Some(&wren), false).await.1["friends"], people(&[("pip", "Pip")]));
    assert_eq!(send(&app, "GET", "/__friends", "", pip.as_deref(), false).await.1["friends"], people(&[("wren", "Wren")]));
    // Made without one, nobody's friend.
    let moth = player(&app, "Moth").await;
    assert_eq!(send(&app, "GET", "/__friends", "", Some(&moth), false).await.1["friends"], json!([]));
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn friends_write_each_other_and_nobody_else() {
    let root = folder("messages");
    let app = serve::app(root.clone());
    let (wren, pip, moth) = (player(&app, "Wren").await, player(&app, "Pip").await, player(&app, "Moth").await);
    let post = |cookie: &str, route: &str, body: Value| {
        let (app, cookie, path) = (app.clone(), cookie.to_string(), format!("/__friends/{route}"));
        async move {
            let (status, body, _) = send(&app, "POST", &path, &body.to_string(), Some(&cookie), true).await;
            (status, body)
        }
    };
    let get = |cookie: &str, path: &str| {
        let (app, cookie, path) = (app.clone(), cookie.to_string(), path.to_string());
        async move {
            let (status, body, _) = send(&app, "GET", &path, "", Some(&cookie), false).await;
            (status, body)
        }
    };
    let texts = |conversation: &Value| conversation["messages"].as_array().unwrap().iter().map(|m| m["text"].as_str().unwrap().to_string()).collect::<Vec<_>>();
    post(&wren, "ask", json!({ "name": "pip" })).await;
    post(&pip, "answer", json!({ "from": "wren", "accept": true })).await;

    // Nothing written yet; written, trimmed, its case and its accents as written.
    assert_eq!(get(&pip, "/__friends/messages/wren").await, (StatusCode::OK, json!({ "with": { "id": "wren", "name": "Wren" }, "messages": [] })));
    let (status, said) = post(&wren, "say", json!({ "to": "Pip", "text": "  Hello, Pip! Ça va?  " })).await;
    assert_eq!(status, StatusCode::OK, "{said}");
    assert_eq!(said["with"], json!({ "id": "pip", "name": "Pip" }));
    assert_eq!((said["messages"][0]["n"].clone(), said["messages"][0]["from"].clone()), (json!(1), json!("wren")));
    assert_eq!(texts(&said), ["Hello, Pip! Ça va?"]);
    assert!(said["messages"][0]["at"].as_i64().unwrap() > 0);
    // The other has it, unread; the writer has nothing unread.
    assert_eq!(texts(&get(&pip, "/__friends/messages/WREN").await.1), ["Hello, Pip! Ça va?"]);
    assert_eq!(get(&pip, "/__friends").await.1["unread"], json!({ "wren": 1 }));
    assert_eq!(get(&wren, "/__friends").await.1["unread"], json!({}));
    // Read, it is not unread; read again up to less, still not.
    let (status, read) = post(&pip, "read", json!({ "id": "wren", "upTo": 1 })).await;
    assert_eq!((status, read["unread"].clone()), (StatusCode::OK, json!({})));
    assert_eq!(post(&pip, "read", json!({ "id": "wren", "upTo": 0 })).await.1["unread"], json!({}));
    // Answered: the first has it unread, the conversation in order.
    let (_, answered) = post(&pip, "say", json!({ "to": "wren", "text": "Fine. You?" })).await;
    assert_eq!(texts(&answered), ["Hello, Pip! Ça va?", "Fine. You?"]);
    assert_eq!(get(&wren, "/__friends").await.1["unread"], json!({ "pip": 1 }));

    // Nothing, too much and a stranger refused; five hundred accented characters taken.
    assert_eq!(post(&wren, "say", json!({ "to": "pip", "text": "   " })).await, (StatusCode::UNPROCESSABLE_ENTITY, json!({ "reason": "nothing said" })));
    assert_eq!(post(&wren, "say", json!({ "to": "pip", "text": "a".repeat(501) })).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(post(&wren, "say", json!({ "to": "pip", "text": "é".repeat(500) })).await.0, StatusCode::OK);
    assert_eq!(post(&moth, "say", json!({ "to": "wren", "text": "Hi" })).await, (StatusCode::NOT_FOUND, json!({ "reason": "you can only write to a friend" })));
    assert_eq!(get(&moth, "/__friends/messages/wren").await.0, StatusCode::NOT_FOUND);
    assert_eq!(post(&moth, "read", json!({ "id": "wren", "upTo": 9 })).await.0, StatusCode::NOT_FOUND);
    assert_eq!(get(&wren, "/__friends/elsewhere").await.0, StatusCode::NOT_FOUND);
    assert_eq!(send(&app, "POST", "/__friends/say", r#"{"to":"pip","text":"Hi"}"#, Some(&wren), false).await.0, StatusCode::FORBIDDEN);

    // A pair keeps its newest two hundred, and another pair's are not counted among them.
    post(&moth, "ask", json!({ "name": "wren" })).await;
    post(&wren, "answer", json!({ "from": "moth", "accept": true })).await;
    post(&moth, "say", json!({ "to": "wren", "text": "Moth here" })).await;
    for i in 0..200 {
        post(&wren, "say", json!({ "to": "pip", "text": format!("line {i}") })).await;
    }
    let kept = texts(&get(&pip, "/__friends/messages/wren").await.1);
    assert_eq!((kept.len(), kept[0].as_str(), kept[199].as_str()), (200, "line 0", "line 199"));
    assert_eq!(texts(&get(&wren, "/__friends/messages/moth").await.1), ["Moth here"]);
    assert_eq!(get(&pip, "/__friends").await.1["unread"], json!({ "wren": 200 }));

    // Friends no more: what they wrote each other gone, friends again or not; another pair's kept.
    post(&pip, "remove", json!({ "id": "wren" })).await;
    assert_eq!(get(&pip, "/__friends/messages/wren").await.0, StatusCode::NOT_FOUND);
    post(&pip, "ask", json!({ "name": "wren" })).await;
    post(&wren, "answer", json!({ "from": "pip", "accept": true })).await;
    assert_eq!(get(&pip, "/__friends/messages/wren").await.1["messages"], json!([]));
    assert_eq!((get(&pip, "/__friends").await.1["unread"].clone(), get(&wren, "/__friends").await.1["unread"].clone()), (json!({}), json!({ "moth": 1 })));
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn friends_are_told_which_of_them_are_around_and_nobody_else_is() {
    let root = folder("around");
    let tables = Tables::new(root.clone()).online_for(Duration::from_millis(400));
    let app = serve::app_over(root.clone(), serve::Settings::default(), tables.clone());
    let (wren, pip, moth) = (player(&app, "Wren").await, player(&app, "Pip").await, player(&app, "Moth").await);
    let post = |cookie: &str, route: &str, body: Value| {
        let (app, cookie, path) = (app.clone(), cookie.to_string(), format!("/__friends/{route}"));
        async move { send(&app, "POST", &path, &body.to_string(), Some(&cookie), true).await.1 }
    };
    let online = |cookie: &str| {
        let (app, cookie) = (app.clone(), cookie.to_string());
        async move { send(&app, "GET", "/__friends", "", Some(&cookie), false).await.1["online"].clone() }
    };
    post(&wren, "ask", json!({ "name": "pip" })).await;
    post(&pip, "answer", json!({ "from": "wren", "accept": true })).await;
    // Moth has asked Wren, and is seen: nobody's friend, so nobody is told Moth is around.
    post(&moth, "ask", json!({ "name": "wren" })).await;
    assert_eq!(online(&wren).await, json!({ "pip": "online" }));
    assert_eq!(online(&pip).await, json!({ "wren": "online" }));
    assert_eq!(online(&moth).await, json!({}));
    // A while with nothing asked: Wren is gone; Pip, who asked again just now, is not.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(online(&pip).await, json!({}));
    assert_eq!(online(&wren).await, json!({ "pip": "online" }));
    // Wren at a game - their own, nobody else's - is playing, whether or not seen on the menu.
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/replica.json")).unwrap()).unwrap();
    let (conn, mut to_wren) = tables.connect();
    tables.ask_on(conn, "wren", json!({ "id": 1, "op": "open", "project": fixture["projects"][0], "shipped": fixture["shipped"], "table": {} }));
    assert!(tokio::time::timeout(Duration::from_secs(5), to_wren.recv()).await.unwrap().unwrap()["ok"].is_object());
    assert_eq!(online(&pip).await, json!({ "wren": "playing" }));
    online(&wren).await;
    assert_eq!(online(&pip).await, json!({ "wren": "playing" }));
    // The game's page gone, and a while after: around no more.
    tables.left(conn);
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(online(&pip).await, json!({}));
    let _ = std::fs::remove_dir_all(&root);
}
