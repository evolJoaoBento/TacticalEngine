//! The `/__friends` routes end to end, over a folder of their own: a request by name, accepted or declined; two who
//! ask each other friends at once; either removing the other; and an account made with a player's invitation that
//! player's friend from the start.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::path::PathBuf;
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
    let app = serve::app(root.clone());
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
    assert_eq!(mine(&wren).await, json!({ "friends": [], "asking": [], "asked": [] }));

    // Wren asks Pip by name, whatever its case: Wren has asked, Pip is asked.
    let (status, asked, _) = post(&wren, "ask", json!({ "name": "PIP" })).await;
    assert_eq!((status, asked), (StatusCode::OK, json!({ "friends": [], "asking": [], "asked": people(&[("pip", "Pip")]) })));
    assert_eq!(mine(&pip).await["asking"], people(&[("wren", "Wren")]));
    // Asked again, nothing more; nobody of that name, oneself, refused.
    assert_eq!(post(&wren, "ask", json!({ "name": "Pip" })).await.1["asked"], people(&[("pip", "Pip")]));
    assert_eq!(post(&wren, "ask", json!({ "name": "nobody" })).await.0, StatusCode::NOT_FOUND);
    assert_eq!(post(&wren, "ask", json!({ "name": "wren" })).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    // Pip accepts: friends, both ways, the request gone.
    let (status, answered, _) = post(&pip, "answer", json!({ "from": "wren", "accept": true })).await;
    assert_eq!((status, answered), (StatusCode::OK, json!({ "friends": people(&[("wren", "Wren")]), "asking": [], "asked": [] })));
    assert_eq!(mine(&wren).await, json!({ "friends": people(&[("pip", "Pip")]), "asking": [], "asked": [] }));
    assert_eq!(post(&wren, "ask", json!({ "name": "pip" })).await.0, StatusCode::CONFLICT);
    // An answer to nobody's request is refused.
    assert_eq!(post(&pip, "answer", json!({ "from": "moth", "accept": true })).await.0, StatusCode::NOT_FOUND);

    // Moth asks Wren; Wren declines: nothing between them.
    post(&moth, "ask", json!({ "name": "wren" })).await;
    let (_, declined, _) = post(&wren, "answer", json!({ "from": "moth", "accept": false })).await;
    assert_eq!(declined["asking"], json!([]));
    assert_eq!(mine(&moth).await, json!({ "friends": [], "asking": [], "asked": [] }));
    // Two who ask each other are friends at once.
    post(&moth, "ask", json!({ "name": "pip" })).await;
    let (_, both, _) = post(&pip, "ask", json!({ "name": "moth" })).await;
    assert_eq!(both, json!({ "friends": people(&[("wren", "Wren"), ("moth", "Moth")]), "asking": [], "asked": [] }));
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
