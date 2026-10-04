//! `server/fixtures/accounts.json` replayed: what `tools/accounts.ts` answered for passwords, sign-in
//! bodies, cookies and request headers, answered again here - the hashes to the byte, so either side
//! checks a password the other kept.

use indexmap::IndexMap;
use serde_json::Value;
use serve::accounts::{account_of, check_password, from_the_page, hash_password, judge_credentials, Account, Sessions};

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/accounts.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by tests/unit/accounts.golden.test.ts")).expect("JSON")
}

#[test]
fn passwords_hash_to_the_byte() {
    let golden = fixture();
    let hashes = golden["hashes"].as_array().unwrap();
    assert!(hashes.len() >= 15);
    for case in hashes {
        let (password, salt, hash) = (case["password"].as_str().unwrap(), case["salt"].as_str().unwrap(), case["hash"].as_str().unwrap());
        assert_eq!(hash_password(password, salt), hash, "hash of {password:?} with {salt:?}");
        assert!(check_password(salt, hash, password));
        assert!(!check_password(salt, hash, &format!("{password}!")));
    }
}

#[test]
fn sign_in_bodies_are_judged_alike() {
    for case in fixture()["credentials"].as_array().unwrap() {
        let body = case["body"].as_str().unwrap();
        let verdict = &case["verdict"];
        match judge_credentials(body) {
            Ok((name, password)) => {
                assert_eq!(verdict["ok"], true, "{body:?}");
                assert_eq!(verdict["name"], name.as_str());
                assert_eq!(verdict["password"], password.as_str());
            }
            Err(reason) => {
                assert_eq!(verdict["ok"], false, "{body:?}");
                assert_eq!(verdict["reason"], reason, "{body:?}");
            }
        }
    }
}

#[test]
fn cookies_are_read_back_alike() {
    let golden = fixture();
    let accounts: Vec<Account> = serde_json::from_value(golden["accounts"].clone()).unwrap();
    let sessions: Sessions = serde_json::from_value(golden["sessions"].clone()).unwrap();
    let now = golden["now"].as_i64().unwrap();
    for case in golden["cookies"].as_array().unwrap() {
        let found = account_of(case["cookie"].as_str(), &sessions, &accounts, now).map(|account| account.id.as_str());
        assert_eq!(found, case["account"].as_str(), "cookie {:?}", case["cookie"]);
    }
}

#[test]
fn only_the_page_itself_may_post_alike() {
    for case in fixture()["requests"].as_array().unwrap() {
        let headers: IndexMap<String, String> = serde_json::from_value(case["headers"].clone()).unwrap();
        let refused = from_the_page(case["method"].as_str().unwrap(), |name| headers.get(name).cloned());
        assert_eq!(refused, case["refused"].as_str(), "{case}");
    }
}
