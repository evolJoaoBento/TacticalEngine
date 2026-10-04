//! The `/__accounts` routes end to end, over a folder of their own: admin made on the first start, an
//! account made, signed in and out by its cookie, and every refusal `tools/accounts.ts` gives - with the
//! files it writes read back as the dev plugins would read them.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::path::PathBuf;
use tower::ServiceExt;

fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-serve-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

struct Reply {
    status: StatusCode,
    body: Value,
    cookie: Option<String>,
    cache: Option<String>,
}

async fn send(root: &PathBuf, method: &str, path: &str, body: &str, headers: &[(&str, &str)]) -> Reply {
    let mut request = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = serve::app(root.clone()).oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = response.status();
    let cookie = response.headers().get("set-cookie").map(|v| v.to_str().unwrap().to_string());
    let cache = response.headers().get("cache-control").map(|v| v.to_str().unwrap().to_string());
    assert_eq!(response.headers().get("content-type").unwrap(), "application/json");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply { status, body: serde_json::from_slice(&bytes).unwrap(), cookie, cache }
}

const PAGE: [(&str, &str); 3] = [("x-tactical-save", "1"), ("origin", "http://127.0.0.1:8420"), ("host", "127.0.0.1:8420")];

fn with_cookie<'a>(cookie: &'a str) -> Vec<(&'a str, &'a str)> {
    let mut headers = PAGE.to_vec();
    headers.push(("cookie", cookie));
    headers
}

/// The `name=value` a Set-Cookie hands the browser.
fn pair(set_cookie: &str) -> String {
    set_cookie.split(';').next().unwrap().to_string()
}

#[tokio::test]
async fn an_account_is_made_signed_in_and_out() {
    let root = folder("life");
    // Nobody yet; the first read made admin.
    let nobody = send(&root, "GET", "/__accounts/me", "", &[]).await;
    assert_eq!((nobody.status, nobody.body.clone()), (StatusCode::UNAUTHORIZED, json!({ "reason": "nobody is signed in" })));
    assert_eq!(nobody.cache.as_deref(), Some("no-store"));
    let kept: Value = serde_json::from_str(&std::fs::read_to_string(root.join("data/accounts.json")).unwrap()).unwrap();
    assert_eq!(kept[0]["id"], "admin");
    assert!(!kept[0]["hash"].as_str().unwrap().contains("admin"));

    let made = send(&root, "POST", "/__accounts/register", r#"{"name":"Bramble","password":"hunter22"}"#, &PAGE).await;
    assert_eq!(made.status, StatusCode::OK);
    assert_eq!(made.body, json!({ "name": "Bramble", "id": "bramble", "admin": false }));
    let set = made.cookie.unwrap();
    assert!(set.starts_with("tactical-session=") && set.ends_with("; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000"), "{set}");
    let cookie = pair(&set);
    assert_eq!(cookie.len(), "tactical-session=".len() + 48);

    let me = send(&root, "GET", "/__accounts/me", "", &[("cookie", &format!("theme=dark; {cookie}"))]).await;
    assert_eq!(me.body, json!({ "name": "Bramble", "id": "bramble", "admin": false }));

    // The name is taken, whatever its case.
    let again = send(&root, "POST", "/__accounts/register", r#"{"name":"BRAMBLE","password":"other22"}"#, &PAGE).await;
    assert_eq!((again.status, again.body), (StatusCode::CONFLICT, json!({ "reason": "that name is taken" })));

    let out = send(&root, "POST", "/__accounts/logout", "", &with_cookie(&cookie)).await;
    assert_eq!((out.status, out.body), (StatusCode::OK, json!({})));
    assert_eq!(out.cookie.as_deref(), Some("tactical-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"));
    assert_eq!(send(&root, "GET", "/__accounts/me", "", &[("cookie", &cookie)]).await.status, StatusCode::UNAUTHORIZED);

    // Signed in again by name, any case, and the password it was made with only.
    let wrong = send(&root, "POST", "/__accounts/login", r#"{"name":"bramble","password":"hunter23"}"#, &PAGE).await;
    assert_eq!((wrong.status, wrong.body), (StatusCode::UNAUTHORIZED, json!({ "reason": "that name and password do not match" })));
    let right = send(&root, "POST", "/__accounts/login", r#"{"name":"bramble","password":"hunter22"}"#, &PAGE).await;
    assert_eq!(right.status, StatusCode::OK);
    let admin = send(&root, "POST", "/__accounts/login", r#"{"name":"admin","password":"admin"}"#, &PAGE).await;
    assert_eq!(admin.body, json!({ "name": "admin", "id": "admin", "admin": true }));

    // The sessions file is what the dev plugins read: a token to an account and an expiry.
    let sessions: Value = serde_json::from_str(&std::fs::read_to_string(root.join("data/sessions.json")).unwrap()).unwrap();
    assert_eq!(sessions.as_object().unwrap().len(), 2);
    assert!(sessions.as_object().unwrap().values().all(|s| s["expires"].as_i64().unwrap() > 0 && s["account"].is_string()));
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn refusals_come_in_the_order_they_come_in_typescript() {
    let root = folder("refusals");
    let big = format!(r#"{{"name":"Bramble","password":"{}"}}"#, "x".repeat(5000));
    let cases: Vec<(&str, &str, String, Vec<(&str, &str)>, u16, &str)> = vec![
        ("GET", "/__accounts/login", String::new(), PAGE.to_vec(), 403, "not a POST"),
        ("POST", "/__accounts/login", String::new(), vec![("origin", "http://127.0.0.1:8420"), ("host", "127.0.0.1:8420")], 403, "not sent by the page"),
        ("POST", "/__accounts/login", String::new(), vec![("x-tactical-save", "1"), ("origin", "https://elsewhere.example"), ("host", "127.0.0.1:8420")], 403, "sent from another origin"),
        // The guard before the size: a large body from elsewhere is refused for where it came from.
        ("POST", "/__accounts/login", big.clone(), vec![("x-tactical-save", "1"), ("origin", "https://elsewhere.example"), ("host", "127.0.0.1:8420")], 403, "sent from another origin"),
        ("POST", "/__accounts/elsewhere", String::new(), PAGE.to_vec(), 404, "no such route"),
        ("POST", "/__accounts", String::new(), PAGE.to_vec(), 404, "no such route"),
        ("POST", "/__accounts/login", big, PAGE.to_vec(), 413, "too large"),
        ("POST", "/__accounts/register", "not json".into(), PAGE.to_vec(), 422, "not JSON"),
        ("POST", "/__accounts/register", r#"{"name":"../admin","password":"hunter22"}"#.into(), PAGE.to_vec(), 422, "a name is 3 to 24 letters, digits, _ or -"),
        ("POST", "/__accounts/login", r#"{"name":"nobody","password":"hunter22"}"#.into(), PAGE.to_vec(), 401, "that name and password do not match"),
    ];
    for (method, path, body, headers, status, reason) in cases {
        let reply = send(&root, method, path, &body, &headers).await;
        assert_eq!((reply.status.as_u16(), reply.body["reason"].as_str()), (status, Some(reason)), "{method} {path}");
        assert!(reply.cookie.is_none());
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn an_account_kept_by_the_typescript_signs_in_here() {
    // The dev plugins wrote this admin, salt and all, before the server was Rust.
    let root = folder("kept");
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/accounts.json")).unwrap()).unwrap();
    let kept = fixture["hashes"].as_array().unwrap().iter().find(|c| c["password"] == "hunter22").unwrap();
    std::fs::create_dir_all(root.join("data")).unwrap();
    let account = json!([{ "id": "ash", "name": "Ash", "salt": kept["salt"], "hash": kept["hash"], "admin": false, "created": 5, "future": { "kept": true } }]);
    std::fs::write(root.join("data/accounts.json"), serde_json::to_string_pretty(&account).unwrap()).unwrap();
    let signed = send(&root, "POST", "/__accounts/login", r#"{"name":"Ash","password":"hunter22"}"#, &PAGE).await;
    assert_eq!(signed.body, json!({ "name": "Ash", "id": "ash", "admin": false }));
    // A field a later version wrote survives a write.
    send(&root, "POST", "/__accounts/register", r#"{"name":"Violet","password":"hunter22"}"#, &PAGE).await;
    let file: Value = serde_json::from_str(&std::fs::read_to_string(root.join("data/accounts.json")).unwrap()).unwrap();
    assert_eq!(file[0]["future"], json!({ "kept": true }));
    assert_eq!(file[1]["id"], "violet");
    let _ = std::fs::remove_dir_all(&root);
}

/// A request through a tunnel: from this machine, the page loaded from `friends.example` over HTTPS.
const TUNNEL: [(&str, &str); 5] = [
    ("x-tactical-save", "1"),
    ("origin", "https://friends.example"),
    ("host", "127.0.0.1:8430"),
    ("x-forwarded-host", "friends.example"),
    ("x-forwarded-proto", "https"),
];

/// As `send`, to a server started as `settings` say.
async fn send_to(root: &PathBuf, settings: serve::Settings, path: &str, body: &str, headers: &[(&str, &str)]) -> Reply {
    let mut request = Request::builder().method("POST").uri(path);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = serve::app_with(root.clone(), settings).oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = response.status();
    let cookie = response.headers().get("set-cookie").map(|v| v.to_str().unwrap().to_string());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply { status, body: serde_json::from_slice(&bytes).unwrap(), cookie, cache: None }
}

#[test]
fn the_page_host_is_the_one_a_proxy_says_and_this_machine_is_its_own_names() {
    use serve::accounts::{beyond_this_machine, over_https, page_host, same_origin};
    let headers = |pairs: &'static [(&'static str, &'static str)]| move |name: &str| pairs.iter().find(|(n, _)| *n == name).map(|(_, v)| v.to_string());
    assert_eq!(page_host(headers(&[("host", "127.0.0.1:8430")])).as_deref(), Some("127.0.0.1:8430"));
    assert_eq!(page_host(headers(&[("host", "127.0.0.1:8430"), ("x-forwarded-host", "Friends.Example, inner.proxy")])).as_deref(), Some("friends.example"));
    for here in ["localhost", "localhost:8430", "127.0.0.1:8420", "127.9.9.9", "[::1]:8430"] {
        let pairs: &'static [(&'static str, &'static str)] = Box::leak(Box::new([("host", here)]));
        assert!(!beyond_this_machine(headers(pairs)), "{here}");
    }
    for there in ["friends.example", "192.168.1.20:8430", "[2001:db8::1]:443", "localhost.example"] {
        let pairs: &'static [(&'static str, &'static str)] = Box::leak(Box::new([("host", "127.0.0.1:8430"), ("x-forwarded-host", there)]));
        assert!(beyond_this_machine(headers(pairs)), "{there}");
    }
    assert!(!beyond_this_machine(headers(&[])), "no host at all is a request made here");
    assert!(over_https(headers(&[("origin", "https://friends.example")])));
    assert!(over_https(headers(&[("x-forwarded-proto", "https")])));
    assert!(!over_https(headers(&[("origin", "http://127.0.0.1:8420")])));
    assert!(same_origin(headers(&TUNNEL)));
    assert!(!same_origin(headers(&[("origin", "https://elsewhere.example"), ("host", "127.0.0.1:8430"), ("x-forwarded-host", "friends.example")])));
    assert!(same_origin(headers(&[("host", "127.0.0.1:8430")])), "no origin: not a browser's, let be");
}

#[tokio::test]
async fn through_a_tunnel_the_cookie_is_secure_and_the_origin_is_the_page_hosts() {
    let root = folder("tunnel");
    let settings = serve::Settings { sign_up: true, ..serve::Settings::default() };
    let made = send_to(&root, settings, "/__accounts/register", r#"{"name":"Wren","password":"hunter22"}"#, &TUNNEL).await;
    assert_eq!(made.status, StatusCode::OK, "{}", made.body);
    let set = made.cookie.unwrap();
    assert!(set.ends_with("; Secure"), "{set}");
    // Signed out the same way: the clearing is Secure too.
    let mut out = TUNNEL.to_vec();
    let cookie = pair(&set);
    out.push(("cookie", cookie.as_str()));
    assert!(send_to(&root, settings, "/__accounts/logout", "", &out).await.cookie.unwrap().ends_with("; Secure"));
    // Over plain HTTP on this machine: not Secure, or the browser would never send it back.
    let here = send_to(&root, settings, "/__accounts/login", r#"{"name":"Wren","password":"hunter22"}"#, &PAGE).await;
    assert!(!here.cookie.unwrap().contains("Secure"));
    // Another site posting through the same tunnel is not the page.
    let mut forged = TUNNEL.to_vec();
    forged[1] = ("origin", "https://elsewhere.example");
    let refused = send_to(&root, settings, "/__accounts/login", r#"{"name":"Wren","password":"hunter22"}"#, &forged).await;
    assert_eq!((refused.status, refused.body["reason"].clone()), (StatusCode::FORBIDDEN, json!("sent from another origin")));
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn from_beyond_this_machine_admin_keeps_its_first_password_home_and_nobody_signs_up_unasked() {
    let root = folder("beyond");
    let closed = serve::Settings::default();
    let admin = send_to(&root, closed, "/__accounts/login", r#"{"name":"admin","password":"admin"}"#, &TUNNEL).await;
    assert_eq!(admin.status, StatusCode::FORBIDDEN, "{}", admin.body);
    assert!(admin.cookie.is_none());
    // On this machine it signs in as it always has.
    assert_eq!(send_to(&root, closed, "/__accounts/login", r#"{"name":"admin","password":"admin"}"#, &PAGE).await.status, StatusCode::OK);
    // Nor is an account made from beyond, unless the server was started to let one be.
    let made = send_to(&root, closed, "/__accounts/register", r#"{"name":"Stranger","password":"hunter22"}"#, &TUNNEL).await;
    assert_eq!((made.status, made.body["reason"].clone()), (StatusCode::FORBIDDEN, json!("new accounts are made on the machine the server runs on")));
    // Made here, it signs in from beyond.
    assert_eq!(send_to(&root, closed, "/__accounts/register", r#"{"name":"Wren","password":"hunter22"}"#, &PAGE).await.status, StatusCode::OK);
    assert_eq!(send_to(&root, closed, "/__accounts/login", r#"{"name":"Wren","password":"hunter22"}"#, &TUNNEL).await.status, StatusCode::OK);
    let open = serve::Settings { sign_up: true, ..serve::Settings::default() };
    assert_eq!(send_to(&root, open, "/__accounts/register", r#"{"name":"Stranger","password":"hunter22"}"#, &TUNNEL).await.status, StatusCode::OK);
    let _ = std::fs::remove_dir_all(&root);
}
