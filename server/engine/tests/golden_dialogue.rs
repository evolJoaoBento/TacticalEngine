//! `server/fixtures/dialogue.json` replayed. The walk runs against a host that answers from the tape the
//! TypeScript recorded - every condition, script run and resume, and check modifier the dialogue asked
//! for, step by step - and must ask the same questions in the same order, leave none unasked, and show
//! the same view, prompt and journal. Beside it: the schema's verdicts, the layout and the graph readers.

use engine::dialogue::layout::{dangling_links, layout_dialogue, unreachable_nodes, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT};
use engine::dialogue::runner::{DialogueHost, DialogueRunner, DialogueStatus, ScriptResult};
use engine::dialogue::schema::{parse_dialogue, Dialogue};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/dialogue.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/dialogue/dialogue.golden.test.ts")).expect("JSON")
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

/// Answers from one step's recorded calls, checking each question is the one the TypeScript asked.
struct Tape {
    calls: VecDeque<Value>,
    at: String,
}

impl Tape {
    fn next(&mut self, kind: &str) -> Value {
        let call = self.calls.pop_front().unwrap_or_else(|| panic!("{}: asked {kind} after the TypeScript had asked everything", self.at));
        assert_eq!(call["call"], kind, "{}: asked {kind}, the TypeScript asked {}", self.at, call);
        call
    }
}

fn script_result(value: &Value) -> ScriptResult {
    ScriptResult {
        prompt: (value["status"] == "waiting").then(|| value["prompt"].clone()),
        journal: value["journal"].as_array().expect("a journal").clone(),
    }
}

impl DialogueHost for Tape {
    fn evaluate(&mut self, condition: Option<&Value>) -> bool {
        let call = self.next("evaluate");
        let asked = condition.cloned().unwrap_or(Value::Null);
        assert!(same(&asked, &call["condition"]), "{}: evaluated {asked}, the TypeScript {}", self.at, call["condition"]);
        call["answer"].as_bool().expect("an answer")
    }

    fn check_modifier(&mut self, trait_: Option<&Value>) -> Option<f64> {
        let call = self.next("checkModifier");
        assert_eq!(trait_.cloned().unwrap_or(Value::Null), call["trait"], "{}: modifier of", self.at);
        assert_eq!(call["as"], "party");
        call["answer"].as_f64()
    }

    fn run(&mut self, effects: &[Value], options: &Value) -> ScriptResult {
        let call = self.next("run");
        let at = self.at.clone();
        check!(Value::Array(effects.to_vec()), &call["effects"], "{at}: ran");
        check!(options.clone(), &call["options"], "{at}: ran with");
        script_result(&call["result"])
    }

    fn resume(&mut self, response: &Value) -> ScriptResult {
        let call = self.next("resume");
        let at = self.at.clone();
        check!(response.clone(), &call["response"], "{at}: resumed with");
        script_result(&call["result"])
    }
}

fn status_json(status: &DialogueStatus, runner: &DialogueRunner, dialogue: &Dialogue, since: usize) -> Value {
    let journal = runner.entries();
    let mut out = Map::new();
    match status {
        DialogueStatus::Talking(view) => {
            out.insert("status".into(), json!("talking"));
            out.insert("view".into(), json!({ "node": dialogue.nodes[view.node].id, "lines": runner.lines(view), "options": view.options }));
        }
        DialogueStatus::Script(prompt) => {
            out.insert("status".into(), json!("script"));
            out.insert("prompt".into(), prompt.clone());
        }
        DialogueStatus::Ended => {
            out.insert("status".into(), json!("ended"));
        }
    }
    out.insert("journalLength".into(), json!(journal.len()));
    out.insert("newEntries".into(), Value::Array(journal[since.min(journal.len())..].to_vec()));
    Value::Object(out)
}

#[test]
fn every_conversation_walks_as_the_typescript_walked_it() {
    let fixture = fixture();
    let runs = fixture["runs"].as_array().expect("runs");
    let mut steps_replayed = 0;
    for run in runs {
        let dialogue = parse_dialogue(&run["dialogue"]).unwrap_or_else(|e| panic!("{e:?}: {}", run["dialogue"]["id"]));
        for play in run["plays"].as_array().expect("plays") {
            let options = match play.get("targets") {
                Some(targets) => json!({ "targets": targets }),
                None => json!({}),
            };
            let mut runner = DialogueRunner::new(std::rc::Rc::new(dialogue.clone()), options).expect("no repeated nodes");
            let mut seen = 0;
            for (i, step) in play["steps"].as_array().expect("steps").iter().enumerate() {
                let at = format!("{} seed {} step {i} {}", dialogue.id, play["seed"], step["move"]);
                let mut tape = Tape { calls: step["calls"].as_array().expect("calls").iter().cloned().collect(), at: at.clone() };
                let mv = &step["move"];
                let status = match mv["act"].as_str().expect("an act") {
                    "start" => runner.start(&mut tape),
                    "choose" => runner.choose(mv["index"].as_i64().expect("an index"), &mut tape),
                    "advance" => runner.advance(&mut tape),
                    "resume" => runner.resume(&mv["response"], &mut tape),
                    other => panic!("{at}: no act {other}"),
                };
                assert!(tape.calls.is_empty(), "{at}: the TypeScript also asked {:?}", tape.calls);
                check!(status_json(&status, &runner, &dialogue, seen), &step["status"], "{at}");
                seen = runner.entries().len();
                steps_replayed += 1;
            }
            check!(Value::Array(runner.entries().to_vec()), &play["journal"], "{} seed {}: the journal", dialogue.id, play["seed"]);
        }
    }
    assert!(steps_replayed > 1500, "{steps_replayed} steps");
}

#[test]
fn a_repeated_node_is_refused_in_the_same_words() {
    let fixture = fixture();
    let dialogue: Dialogue = serde_json::from_value(fixture["repeated"]["dialogue"].clone()).expect("a dialogue");
    let refusal = DialogueRunner::new(std::rc::Rc::new(dialogue.clone()), json!({})).err().expect("refused");
    assert_eq!(json!(refusal), fixture["repeated"]["refusal"]);
}

#[test]
fn the_layout_and_the_graph_readers_agree() {
    let fixture = fixture();
    for case in fixture["readers"].as_array().expect("readers") {
        let dialogue: Dialogue = serde_json::from_value(case["dialogue"].clone()).expect("a dialogue");
        check!(json!(dangling_links(&dialogue)), &case["dangling"], "dangling in {}", dialogue.id);
        check!(json!(unreachable_nodes(&dialogue)), &case["unreachable"], "unreachable in {}", dialogue.id);
        let layout = |width, height| Value::Object(layout_dialogue(&dialogue, width, height).into_iter().map(|(id, p)| (id, json!(p))).collect());
        match case.get("layout") {
            Some(wanted) => {
                check!(layout(DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT), wanted, "layout of {}", dialogue.id);
                check!(layout(100.0, 33.5), &case["layoutNarrow"], "narrow layout of {}", dialogue.id);
            }
            None => assert!(dialogue.nodes.iter().enumerate().any(|(i, n)| dialogue.nodes[..i].iter().any(|m| m.id == n.id))),
        }
    }
}

#[test]
fn dialogues_are_let_in_or_turned_away_in_zods_words() {
    let fixture = fixture();
    let cases = fixture["parse"].as_array().expect("parse");
    assert!(cases.iter().filter(|c| c.get("issues").is_some()).count() > 15);
    for case in cases {
        match (parse_dialogue(&case["value"]), case.get("parsed")) {
            (Ok(dialogue), Some(parsed)) => check!(serde_json::to_value(&dialogue).unwrap(), parsed, "parsed {}", case["value"]),
            (Err(issues), None) => check!(json!(issues), &case["issues"], "refused {}", case["value"]),
            (got, _) => panic!("{} parsed as {got:?}, the TypeScript {}", case["value"], if case.get("parsed").is_some() { "let it in" } else { "turned it away" }),
        }
    }
}
