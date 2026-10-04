//! `server/fixtures/hooks.json` replayed: every hook the default project and the SRD pack carry, and a set
//! written for the rest of what a hook can reach, run in QuickJS as the browser ran them with `new
//! Function` - the world's reads answered from the tape the TypeScript made, in order, none left over; the
//! same outcome, the same effects queued, the dice stream left in the same place. An error in the hook's
//! words or the engine's own shims' must be the same word for word; one the JavaScript engine raises itself
//! is held to its kind, V8 and QuickJS wording it their own ways.

use engine::rng::Rng;
use engine::rules::range::RangeBand;
use engine::scene::state::Faction;
use engine::script::conditions::{HookReads, TargetBindings};
use engine::script::hooks::{unfamiliar_code, CodeSource, HookReader};
use engine::script::runner::LastRoll;
use hooks::QuickJsHooks;
use serde_json::{json, Value};
use std::collections::VecDeque;

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/hooks.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/script/hooks.golden.test.ts")).expect("JSON")
}

/// Two JSON answers the same: numbers by value, objects by their keys whatever the order.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        _ => a == b,
    }
}

macro_rules! check {
    ($got:expr, $wanted:expr, $($what:tt)*) => {{
        let (got, wanted): (Value, &Value) = ($got, $wanted);
        assert!(same(&got, wanted), "{}:\n  rust       {}\n  typescript {}", format!($($what)*), got, wanted);
    }};
}

fn from<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("{e}: {value}"))
}

/// The world as the hook read it in the TypeScript: each read asked in turn, answered from the tape.
struct Tape {
    asked: VecDeque<Value>,
    at: String,
}

impl Tape {
    fn next(&mut self, call: &str, args: Value) -> Value {
        let at = &self.at;
        let next = self.asked.pop_front().unwrap_or_else(|| panic!("{at}: read {call} {args} after the TypeScript had read everything"));
        assert_eq!(next["call"], call, "{at}: read {call} {args}, the TypeScript read {next}");
        check!(args, &next["args"], "{at}: {call}'s arguments");
        next
    }

    fn answer(&mut self, call: &str, args: Value) -> Value {
        self.next(call, args)["answer"].clone()
    }
}

impl HookReader for Tape {
    fn pool(&mut self, id: &str, pool: &str, measure: &str) -> Result<Option<f64>, String> {
        let next = self.next("pool", json!([id, pool, measure]));
        match next.get("threw") {
            Some(kind) => Err(format!("the TypeScript's world threw a {kind}")),
            None => Ok(next["answer"].as_f64()),
        }
    }
    fn has_condition(&mut self, id: &str, condition: &str) -> bool {
        self.answer("hasCondition", json!([id, condition])) == true
    }
    fn band_to(&mut self, from_id: &str, to: &str) -> Option<RangeBand> {
        self.answer("bandTo", json!([from_id, to])).as_str().and_then(RangeBand::from_name)
    }
    fn difficulty_of(&mut self, id: &str) -> Option<f64> {
        self.answer("difficultyOf", json!([id])).as_f64()
    }
    fn select(&mut self, selector: &Value) -> Vec<String> {
        from(&self.answer("select", json!([selector])))
    }
    fn flag(&mut self, name: &str) -> bool {
        self.answer("flag", json!([name])) == true
    }
    fn variable(&mut self, name: &str) -> Value {
        self.answer("variable", json!([name]))
    }
    fn count_alive(&mut self, faction: &str) -> f64 {
        self.answer("countAlive", json!([faction])).as_f64().expect("a count")
    }
    fn faction_of(&mut self, id: &str) -> Option<Faction> {
        let answer = self.answer("factionOf", json!([id]));
        (!answer.is_null()).then(|| from(&answer))
    }
    fn tokens(&mut self, id: &str, ability: &str) -> f64 {
        self.answer("tokens", json!([id, ability])).as_f64().expect("a count")
    }
}

#[test]
fn every_hook_runs_as_the_browser_ran_it() {
    let fixture = fixture();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() > 60);
    for case in cases {
        let at = case["name"].as_str().unwrap().to_string();
        let code: Vec<CodeSource> = from(&case["code"]);
        let (hooks, issues) = QuickJsHooks::compile(&code);
        let ids: Vec<&str> = issues.iter().map(|i| i.id.as_str()).collect();
        check!(json!(ids), &case["issues"], "{at}: the code that would not compile");
        let r = &case["reads"];
        let targets: Vec<String> = from(&r["targets"]);
        let hit: Vec<String> = from(&r["hit"]);
        let reads = HookReads {
            args: r["args"].clone(),
            actor: r["actor"].as_str().map(str::to_string),
            targets: targets.clone(),
            hit: hit.clone(),
            in_combat: r["inCombat"] == true,
            bindings: TargetBindings { targets, hit, ..TargetBindings::default() },
        };
        let last_roll: Option<LastRoll> = (!case["lastRoll"].is_null()).then(|| from(&case["lastRoll"]));
        let effect = case["effect"] == true;
        let mut rng = Rng::from_state(case["seed"].as_u64().unwrap() as u32);
        let mut tape = Tape { asked: case["asked"].as_array().unwrap().iter().cloned().collect(), at: at.clone() };
        let id = case["id"].as_str().unwrap();
        let out = hooks.call(id, &reads, last_roll, effect.then_some(&mut rng), &mut tape);
        assert!(tape.asked.is_empty(), "{at}: the TypeScript also read {:?}", tape.asked);

        let wanted = &case["outcome"];
        assert_eq!(json!(out.ok), wanted["ok"], "{at}: whether it finished ({out:?})");
        if out.ok {
            if !effect {
                assert_eq!(json!(out.value), wanted["value"], "{at}: what it answered");
            }
            check!(json!(out.queued), &wanted["queued"], "{at}: what it queued");
        } else {
            assert!(out.queued.is_empty(), "{at}: a hook that threw queued {:?}", out.queued);
            check!(json!(out.name), wanted.get("name").unwrap_or(&Value::Null), "{at}: what it threw ({})", out.message);
            if wanted["thrown"] != "engine" {
                assert_eq!(json!(out.message), wanted["message"], "{at}: what it said");
            }
        }
        if effect {
            assert_eq!(json!(rng.save()), case["after"], "{at}: the dice stream after");
        }
    }
}

#[test]
fn code_compiles_and_is_known_as_the_browser_does() {
    let fixture = fixture();
    for compiled in fixture["compiled"].as_array().unwrap() {
        let code: Vec<CodeSource> = from(&compiled["code"]);
        let (_, issues) = QuickJsHooks::compile(&code);
        check!(json!(issues.iter().map(|i| &i.id).collect::<Vec<_>>()), &compiled["issues"], "the code that would not compile");
    }
    for case in fixture["unfamiliar"].as_array().unwrap() {
        let incoming: Vec<CodeSource> = from(&case["incoming"]);
        let known: Vec<CodeSource> = from(&case["known"]);
        check!(json!(unfamiliar_code(&incoming, &known).iter().map(|c| &c.id).collect::<Vec<_>>()), &case["unfamiliar"], "the unfamiliar code");
    }
}
