//! The `/__peer` relay end to end, over a folder of its own (`peer.rs`): a room opened by somebody signed in, and only
//! from the page; a guest with no account knocking with their code; the host taking it with the room's secret and
//! answering; the guest taking the answer, once.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::path::PathBuf;
use tower::ServiceExt;

fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-peer-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

const PAGE: [(&str, &str); 3] = [("x-tactical-save", "1"), ("origin", "http://127.0.0.1:8420"), ("host", "127.0.0.1:8420")];

async fn send(app: &axum::Router, method: &str, path: &str, body: &str, headers: &[(&str, &str)], page: bool) -> (StatusCode, Value, Option<String>) {
    let mut request = Request::builder().method(method).uri(path);
    if page {
        for (name, value) in PAGE {
            request = request.header(name, value);
        }
    }
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = app.clone().oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = response.status();
    let cookie = response.headers().get("set-cookie").map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null), cookie)
}

#[tokio::test]
async fn a_guest_with_no_account_meets_the_host_through_a_room() {
    let app = serve::app(folder("meet"));
    // Nobody signed in opens no room; nor does a request the page did not send.
    let (status, said, _) = send(&app, "POST", "/__peer/rooms", "{}", &[], true).await;
    assert_eq!((status, said), (StatusCode::UNAUTHORIZED, json!({ "error": "not signed in" })));
    let (status, said, cookie) = send(&app, "POST", "/__accounts/register", &json!({ "name": "hana", "password": "hunter22" }).to_string(), &[], true).await;
    assert_eq!(status, StatusCode::OK, "{said}");
    let cookie = cookie.unwrap();
    let (status, _, _) = send(&app, "POST", "/__peer/rooms", "{}", &[("cookie", &cookie)], false).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, opened, _) = send(&app, "POST", "/__peer/rooms", "{}", &[("cookie", &cookie)], true).await;
    assert_eq!(status, StatusCode::OK, "{opened}");
    let (room, secret) = (opened["room"].as_str().unwrap().to_string(), opened["secret"].as_str().unwrap().to_string());

    // The guest knocks - no account, from the page.
    let (status, knocked, _) = send(&app, "POST", &format!("/__peer/rooms/{room}/knock"), &json!({ "code": "TE1.guest" }).to_string(), &[], true).await;
    assert_eq!(status, StatusCode::OK, "{knocked}");
    let knock = knocked["knock"].as_str().unwrap().to_string();
    let (status, _, _) = send(&app, "POST", &format!("/__peer/rooms/{room}/knock"), &json!({ "code": "TE1.guest" }).to_string(), &[], false).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, said, _) = send(&app, "POST", "/__peer/rooms/nowhere/knock", &json!({ "code": "TE1.guest" }).to_string(), &[], true).await;
    assert_eq!((status, said), (StatusCode::NOT_FOUND, json!({ "error": "no such room" })));

    // The host takes it, with the secret alone.
    let (status, _, _) = send(&app, "GET", &format!("/__peer/rooms/{room}/knocks"), "", &[("x-peer-secret", "wrong")], false).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, taken, _) = send(&app, "GET", &format!("/__peer/rooms/{room}/knocks"), "", &[("x-peer-secret", &secret)], false).await;
    assert_eq!((status, taken), (StatusCode::OK, json!({ "knocks": [{ "knock": knock, "code": "TE1.guest" }] })));

    // Not answered yet; then answered, and the answer given once.
    let (_, waiting, _) = send(&app, "GET", &format!("/__peer/rooms/{room}/answers/{knock}"), "", &[], false).await;
    assert_eq!(waiting, json!({ "code": null }));
    let (status, _, _) = send(&app, "POST", &format!("/__peer/rooms/{room}/answers/{knock}"), &json!({ "code": "TE1.host" }).to_string(), &[("x-peer-secret", "wrong")], true).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, _) = send(&app, "POST", &format!("/__peer/rooms/{room}/answers/{knock}"), &json!({ "code": "TE1.host" }).to_string(), &[("x-peer-secret", &secret)], true).await;
    assert_eq!(status, StatusCode::OK);
    let (_, answered, _) = send(&app, "GET", &format!("/__peer/rooms/{room}/answers/{knock}"), "", &[], false).await;
    assert_eq!(answered, json!({ "code": "TE1.host" }));
    let (_, again, _) = send(&app, "GET", &format!("/__peer/rooms/{room}/answers/{knock}"), "", &[], false).await;
    assert_eq!(again, json!({ "code": null }));

    // Another knocks, and the host turns them away: they are told so.
    let (_, knocked, _) = send(&app, "POST", &format!("/__peer/rooms/{room}/knock"), &json!({ "code": "TE1.stranger" }).to_string(), &[], true).await;
    let stranger = knocked["knock"].as_str().unwrap().to_string();
    let (status, _, _) = send(&app, "POST", &format!("/__peer/rooms/{room}/answers/{stranger}"), &json!({ "refused": "yes" }).to_string(), &[("x-peer-secret", &secret)], true).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _, _) = send(&app, "POST", &format!("/__peer/rooms/{room}/answers/{stranger}"), &json!({ "refused": true }).to_string(), &[("x-peer-secret", &secret)], true).await;
    assert_eq!(status, StatusCode::OK);
    let (_, told, _) = send(&app, "GET", &format!("/__peer/rooms/{room}/answers/{stranger}"), "", &[], false).await;
    assert_eq!(told, json!({ "refused": true }));
}
