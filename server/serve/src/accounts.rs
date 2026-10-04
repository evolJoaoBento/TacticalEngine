//! Accounts on this machine: `tools/accounts.ts`, answered by the Rust server.
//!
//! Who is playing, so their games and saves are theirs, and so the Store knows who published a piece and
//! who voted on it. Kept in `data/accounts.json` - a folder git ignores - each password hashed with
//! scrypt (Node's `scryptSync` defaults: N 2^14, r 8, p 1, 32 bytes) and a salt of its own, the salt's
//! hex text itself being the salt, as Node hashes it. Signing in hands the browser a session: a random
//! token in an HttpOnly cookie, kept in `data/sessions.json`, good for thirty days. The first read makes
//! `admin` (password `admin`, the user's choice for their own machine).
//!
//! The files are the very ones the dev plugins read while the rest of their routes are still theirs,
//! so everything here answers as `tools/accounts.ts` does - held to `server/fixtures/accounts.json` by
//! `tests/golden_accounts.rs` - and writes what it would write.
//!
//! Routes, under `/__accounts/`: `me` (who the cookie says, or 401), and `register`, `login`, `logout`
//! (POST, the page's own: its header, from its own origin).
//!
//! **Through a tunnel** (`docs/HOSTING.md`, phase 5, slice 2). Friends reach the server through a proxy that
//! answers at a public hostname over HTTPS and connects to it on this machine, so a request's `Host` may be
//! the proxy's, not the page's. The host the page was loaded from (`page_host`) is the first
//! `X-Forwarded-Host` a proxy set, else `Host`; a request is from beyond this machine
//! (`beyond_this_machine`) when that host is not this machine's own name. Trusting `X-Forwarded-Host` for the
//! origin check is sound: a page on another site cannot set it on a request without a preflight the server
//! never answers, a websocket carries no headers a page sets, and the session cookie is `SameSite=Strict`
//! besides. From beyond this machine, `admin` does not sign in with the password it was made with, and nobody
//! signs up unless the server was started to let them (`--sign-up`). The session cookie is `Secure` when the
//! page came over HTTPS (`over_https`).

use crate::files::{read_json, write_json};
use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode, Uri};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const ACCOUNTS_FILE: &str = "data/accounts.json";
pub const SESSIONS_FILE: &str = "data/sessions.json";
pub const ACCOUNTS_URL: &str = "/__accounts";
pub const SESSION_COOKIE: &str = "tactical-session";
/// The password `admin` is made with: the user's for their own machine, never good from beyond it.
pub const ADMIN_PASSWORD: &str = "admin";
/** The header the page sends with everything it posts: `SAVE_HEADER` in `tools/default-project.ts`. */
pub const SAVE_HEADER: &str = "x-tactical-save";
const SESSION_DAYS: i64 = 30;
const LIMIT: usize = 4096;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Account {
    /// The name, lower-cased: what is compared, and what games and saves are kept under.
    pub id: String,
    /// As it was typed.
    pub name: String,
    pub salt: String,
    pub hash: String,
    pub admin: bool,
    pub created: i64,
    /// Anything else a later version wrote, kept as it was.
    #[serde(flatten)]
    pub rest: IndexMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub account: String,
    pub expires: i64,
}

pub type Sessions = IndexMap<String, Session>;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the system's random source");
    hex::encode(buffer)
}

fn scrypt_of(password: &str, salt: &str, length: usize) -> Vec<u8> {
    let params = scrypt::Params::new(14, 8, 1, length).expect("Node's scrypt parameters");
    let mut out = vec![0u8; length];
    scrypt::scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut out).expect("an output length scrypt takes");
    out
}

/// A password, hashed with a salt: the hash's hex. What is kept, never the password.
pub fn hash_password(password: &str, salt: &str) -> String {
    hex::encode(scrypt_of(password, salt, 32))
}

/// A new salt: sixteen random bytes as hex, as `randomBytes(16).toString('hex')`.
pub fn new_salt() -> String {
    random_hex(16)
}

/// Hex as Node's `Buffer.from(text, 'hex')` reads it: pair by pair, stopping at the first that is not hex.
fn lenient_hex(text: &str) -> Vec<u8> {
    let digits = text.as_bytes();
    let mut out = Vec::new();
    for pair in digits.chunks_exact(2) {
        match (char::from(pair[0]).to_digit(16), char::from(pair[1]).to_digit(16)) {
            (Some(high), Some(low)) => out.push((high * 16 + low) as u8),
            _ => break,
        }
    }
    out
}

/// Whether a password is the one an account was made with, compared in constant time. A hash of no bytes
/// matches nothing (Node would compare two empty buffers and say yes).
pub fn check_password(salt: &str, hash: &str, password: &str) -> bool {
    use subtle::ConstantTimeEq;
    let wanted = lenient_hex(hash);
    if wanted.len() < 10 || wanted.len() > 64 {
        return false;
    }
    let given = scrypt_of(password, salt, wanted.len());
    given.ct_eq(&wanted).into()
}

fn is_name(name: &str) -> bool {
    (3..=24).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A name and a password, from a body, or why not: `judgeCredentials`.
pub fn judge_credentials(body: &str) -> Result<(String, String), &'static str> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| "not JSON")?;
    let field = |key: &str| parsed.as_object().and_then(|object| object.get(key)).and_then(Value::as_str);
    let name = field("name").filter(|name| is_name(name)).ok_or("a name is 3 to 24 letters, digits, _ or -")?;
    // The length JavaScript counts: UTF-16 units.
    let password = field("password")
        .filter(|password| (4..=200).contains(&password.encode_utf16().count()))
        .ok_or("a password is 4 to 200 characters")?;
    Ok((name.to_string(), password.to_string()))
}

/// The accounts on this machine; the first read makes `admin` when there are none.
pub fn read_accounts(root: &Path) -> Vec<Account> {
    let file = root.join(ACCOUNTS_FILE);
    let accounts: Vec<Account> = read_json(&file, Vec::new());
    if !accounts.is_empty() {
        return accounts;
    }
    let salt = new_salt();
    let admin = Account {
        id: "admin".into(),
        name: "admin".into(),
        hash: hash_password(ADMIN_PASSWORD, &salt),
        salt,
        admin: true,
        created: now_ms(),
        rest: IndexMap::new(),
    };
    let _ = write_json(&file, &vec![admin.clone()]);
    vec![admin]
}

pub fn write_accounts(root: &Path, accounts: &[Account]) -> std::io::Result<()> {
    write_json(&root.join(ACCOUNTS_FILE), &accounts)
}

/// The sessions still good at `now`.
pub fn read_sessions(root: &Path, now: i64) -> Sessions {
    let sessions: Sessions = read_json(&root.join(SESSIONS_FILE), IndexMap::new());
    sessions.into_iter().filter(|(_, session)| session.expires > now).collect()
}

pub fn write_sessions(root: &Path, sessions: &Sessions) -> std::io::Result<()> {
    write_json(&root.join(SESSIONS_FILE), sessions)
}

/// The session token a cookie header carries: the first `tactical-session=` part.
pub fn token_of(cookie: Option<&str>) -> Option<&str> {
    let prefix = format!("{SESSION_COOKIE}=");
    cookie?.split(';').map(str::trim).find(|part| part.starts_with(&prefix)).map(|part| &part[prefix.len()..])
}

/// Who a request's cookie says it is, if anybody, among these accounts and sessions.
pub fn account_of<'a>(cookie: Option<&str>, sessions: &Sessions, accounts: &'a [Account], now: i64) -> Option<&'a Account> {
    let session = sessions.get(token_of(cookie)?)?;
    if session.expires <= now {
        return None;
    }
    accounts.iter().find(|account| account.id == session.account)
}

/// An origin's host as the URL standard gives it: lower case, the port only when it is not the default.
pub fn host_of(origin: &str) -> Option<String> {
    let url = url::Url::parse(origin).ok()?;
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    })
}

/// The host the page was loaded from: the first `X-Forwarded-Host` a proxy in front of the server set (a
/// list, when several did: the first is the browser's), else `Host`. Lower case, as `host_of` gives an origin's.
pub fn page_host(header: impl Fn(&str) -> Option<String>) -> Option<String> {
    let forwarded = header("x-forwarded-host").and_then(|hosts| hosts.split(',').next().map(|host| host.trim().to_string())).filter(|host| !host.is_empty());
    forwarded.or_else(|| header("host")).map(|host| host.to_ascii_lowercase())
}

/// Whether a request came from beyond this machine: the page was loaded from a host that is not this
/// machine's own name - `localhost`, a `127.*` address or `::1`, on any port. A request with no host at all is
/// one made here, as the tests make them.
pub fn beyond_this_machine(header: impl Fn(&str) -> Option<String>) -> bool {
    let Some(host) = page_host(header) else { return false };
    let name = match host.strip_prefix('[') {
        Some(bracketed) => bracketed.split(']').next().unwrap_or(""),
        None => host.rsplit_once(':').map_or(host.as_str(), |(name, port)| if port.chars().all(|c| c.is_ascii_digit()) { name } else { host.as_str() }),
    };
    !(name == "localhost" || name == "::1" || name.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback()))
}

/// Whether the page came over HTTPS: its origin is `https:`, or the proxy in front says the browser used it.
pub fn over_https(header: impl Fn(&str) -> Option<String>) -> bool {
    header("origin").is_some_and(|origin| origin.starts_with("https://")) || header("x-forwarded-proto").is_some_and(|proto| proto.split(',').next().is_some_and(|p| p.trim().eq_ignore_ascii_case("https")))
}

/// Whether a request's `Origin` is the page's own: the host the page was loaded from (`page_host`). Where
/// either is missing there is nothing to hold one to the other, and it is let be, as the TypeScript did.
pub fn same_origin(header: impl Fn(&str) -> Option<String>) -> bool {
    match (header("origin"), page_host(&header)) {
        (Some(origin), Some(host)) => host_of(&origin).as_deref() == Some(host.as_str()),
        _ => true,
    }
}

/// Why a POST is not the page's own, or nothing when it is: the project save's guard (`fromThePage`).
pub fn from_the_page(method: &str, header: impl Fn(&str) -> Option<String>) -> Option<&'static str> {
    if method != "POST" {
        return Some("not a POST");
    }
    if header(SAVE_HEADER).as_deref() != Some("1") {
        return Some("not sent by the page");
    }
    if !same_origin(&header) {
        return Some("sent from another origin");
    }
    None
}

/// The session cookie, or its clearing (`None`): `Secure` when the page came over HTTPS, so a browser never
/// sends it over plain HTTP.
fn session_cookie(token: Option<&str>, secure: bool) -> String {
    let secure = if secure { "; Secure" } else { "" };
    match token {
        Some(token) => format!("{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{secure}", SESSION_DAYS * 24 * 60 * 60),
        None => format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"),
    }
}

/// What the page is told about who is signed in: never the hash.
pub fn public_account(account: &Account) -> Value {
    json!({ "name": account.name, "id": account.id, "admin": account.admin })
}

/// Everything under one lock: the dev plugins were one thread, and a read-then-write must not interleave.
#[derive(Clone)]
pub struct Keeper {
    pub root: PathBuf,
    lock: Arc<Mutex<()>>,
    /// Whether somebody from beyond this machine may make an account (`--sign-up`).
    sign_up: bool,
}

impl Keeper {
    pub fn new(root: PathBuf) -> Self {
        Keeper { root, lock: Arc::new(Mutex::new(())), sign_up: false }
    }

    /// The accounts, letting somebody from beyond this machine make one (`--sign-up`).
    pub fn with_sign_up(self, sign_up: bool) -> Self {
        Keeper { sign_up, ..self }
    }
}

/// A request as the accounts see it, with the body read (or found too large).
struct Asked {
    method: String,
    route: String,
    headers: HeaderMap,
    body: Result<String, ()>,
}

struct Answer {
    status: StatusCode,
    body: Value,
    cookie: Option<String>,
}

fn answer(status: u16, body: Value) -> Answer {
    Answer { status: StatusCode::from_u16(status).expect("a status"), body, cookie: None }
}

fn header_of(headers: &HeaderMap, name: &str) -> Option<String> {
    let values: Vec<String> = headers.get_all(name).iter().map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned()).collect();
    match (name, values.len()) {
        (_, 0) => None,
        // Node joins cookie headers with '; '; any other it hands over first.
        ("cookie", _) => Some(values.join("; ")),
        _ => values.into_iter().next(),
    }
}

fn respond(keeper: &Keeper, asked: Asked) -> Answer {
    let _held = keeper.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = keeper.root.as_path();
    let now = now_ms();
    let mut all = read_accounts(root);
    let mut sessions = read_sessions(root, now);
    let cookie = header_of(&asked.headers, "cookie");
    if asked.route == "me" {
        return match account_of(cookie.as_deref(), &sessions, &all, now) {
            Some(account) => answer(200, public_account(account)),
            None => answer(401, json!({ "reason": "nobody is signed in" })),
        };
    }
    let header = |name: &str| header_of(&asked.headers, name);
    if let Some(refused) = from_the_page(&asked.method, header) {
        return answer(403, json!({ "reason": refused }));
    }
    let beyond = beyond_this_machine(header);
    let secure = over_https(header);
    if asked.route == "logout" {
        if let Some(token) = token_of(cookie.as_deref()) {
            sessions.shift_remove(token);
            let _ = write_sessions(root, &sessions);
        }
        let mut done = answer(200, json!({}));
        done.cookie = Some(session_cookie(None, secure));
        return done;
    }
    if asked.route != "login" && asked.route != "register" {
        return answer(404, json!({ "reason": "no such route" }));
    }
    let Ok(body) = asked.body else {
        return answer(413, json!({ "reason": "too large" }));
    };
    let (name, password) = match judge_credentials(&body) {
        Ok(credentials) => credentials,
        Err(reason) => return answer(422, json!({ "reason": reason })),
    };
    let id = name.to_lowercase();
    // The machine's own admin, with the password it was made with, signs in on this machine alone.
    if beyond && id == "admin" && password == ADMIN_PASSWORD {
        return answer(403, json!({ "reason": "admin signs in with that password only on the machine the server runs on" }));
    }
    let account = if asked.route == "register" {
        if beyond && !keeper.sign_up {
            return answer(403, json!({ "reason": "new accounts are made on the machine the server runs on" }));
        }
        if all.iter().any(|entry| entry.id == id) {
            return answer(409, json!({ "reason": "that name is taken" }));
        }
        let salt = new_salt();
        let account = Account { id, name, hash: hash_password(&password, &salt), salt, admin: false, created: now_ms(), rest: IndexMap::new() };
        all.push(account.clone());
        let _ = write_accounts(root, &all);
        account
    } else {
        match all.iter().find(|entry| entry.id == id) {
            Some(account) if check_password(&account.salt, &account.hash, &password) => account.clone(),
            _ => return answer(401, json!({ "reason": "that name and password do not match" })),
        }
    };
    let token = random_hex(24);
    sessions.insert(token.clone(), Session { account: account.id.clone(), expires: now_ms() + SESSION_DAYS * 24 * 60 * 60 * 1000 });
    let _ = write_sessions(root, &sessions);
    let mut done = answer(200, public_account(&account));
    done.cookie = Some(session_cookie(Some(&token), secure));
    done
}

/// The `/__accounts` routes, as an axum handler.
pub async fn handle(State(keeper): State<Keeper>, method: Method, uri: Uri, headers: HeaderMap, body: Body) -> Response<Body> {
    let route = uri.path().strip_prefix(ACCOUNTS_URL).unwrap_or("").trim_start_matches('/').to_string();
    let body = to_bytes(body, LIMIT).await.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).map_err(|_| ());
    let asked = Asked { method: method.as_str().to_string(), route, headers, body };
    let done = tokio::task::spawn_blocking(move || respond(&keeper, asked)).await.expect("the accounts task");
    let mut response = Response::new(Body::from(done.body.to_string()));
    *response.status_mut() = done.status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(cookie) = done.cookie {
        headers.insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("a cookie of hex and ASCII"));
    }
    response
}
