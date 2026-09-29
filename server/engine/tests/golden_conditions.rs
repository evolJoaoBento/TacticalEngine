//! `server/fixtures/conditions.json` replayed. Every condition the content carries, and one of every kind
//! written out, is evaluated in three worlds under several bindings against the tape the TypeScript
//! recorded - each question the evaluation asked the world or the dice, with its answer - and must ask the
//! same questions in the same order, leave none unasked, and come to the same verdict. Beside it: mark
//! keys, the zone and countdown snapshot schemas, and countdown boards advanced, reaped and ended.

use engine::rng::Rng;
use engine::rules::countdown::CountdownCue;
use engine::rules::range::RangeBand;
use engine::scene::state::{EncounterState, Faction};
use engine::script::conditions::{evaluate, evaluate_optional, variables_used, ConditionContext, DiceHand, HookReads, InteractableState, TargetBindings};
use engine::script::countdowns::{advance_board, end_creature_countdowns, reap_board, running_countdown_schema, CountdownBoard, OwnerStatus, RunningCountdown};
use engine::script::marks::{mark_key, parse_mark_key};
use engine::script::zones::running_zone_schema;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/conditions.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/script/conditions.golden.test.ts")).expect("JSON")
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

/// The recorded questions of one evaluation, answered in order.
struct Tape {
    calls: VecDeque<Value>,
    at: String,
}

impl Tape {
    /// The next question, which must be this one, asked with these arguments.
    fn answer(&mut self, call: &str, args: Value) -> Value {
        let next = self.calls.pop_front().unwrap_or_else(|| panic!("{}: asked {call} {args} after the TypeScript had asked everything", self.at));
        assert_eq!(next["call"], call, "{}: asked {call} {args}, the TypeScript asked {next}", self.at);
        if !args.is_null() {
            assert!(same(&args, &next["args"]), "{}: asked {call} {args}, the TypeScript asked it {}", self.at, next["args"]);
        }
        next
    }
}

/// The world's view of the tape and the dice's view of it: one tape, two borrowers.
#[derive(Clone)]
struct Recorded(Rc<RefCell<Tape>>);

impl Recorded {
    fn ask(&self, call: &str, args: Value) -> Value {
        self.0.borrow_mut().answer(call, args)["answer"].clone()
    }
}

fn faction_name(faction: Faction) -> &'static str {
    match faction {
        Faction::Party => "party",
        Faction::Adversary => "adversary",
        Faction::Neutral => "neutral",
    }
}

fn bindings_json(bindings: &TargetBindings) -> Value {
    serde_json::to_value(bindings).unwrap()
}

impl ConditionContext for Recorded {
    fn has_flag(&mut self, flag: &str) -> bool {
        self.ask("hasFlag", json!([flag])) == true
    }
    fn has_key(&mut self, key: &str) -> bool {
        self.ask("hasKey", json!([key])) == true
    }
    fn has_item(&mut self, item: &str, quantity: f64) -> bool {
        self.ask("hasItem", json!([item, quantity])) == true
    }
    fn get_var(&mut self, name: &str) -> Value {
        self.ask("getVar", json!([name]))
    }
    fn interactable_state(&mut self, id: &str) -> InteractableState {
        from(&self.ask("interactableState", json!([id])))
    }
    fn encounter_state(&mut self, id: &str) -> EncounterState {
        from(&self.ask("encounterState", json!([id])))
    }
    fn count_alive(&mut self, faction: Faction) -> f64 {
        self.ask("countAlive", json!([faction_name(faction)])).as_f64().unwrap()
    }
    fn quest_status(&mut self, quest: &str) -> String {
        self.ask("questStatus", json!([quest])).as_str().unwrap().to_string()
    }
    fn objective_done(&mut self, quest: &str, objective: &str) -> bool {
        self.ask("objectiveDone", json!([quest, objective])) == true
    }
    fn actor_id(&mut self) -> Option<String> {
        self.ask("actorId", json!([])).as_str().map(str::to_string)
    }
    fn resolve_targets(&mut self, selector: &Value, bindings: &TargetBindings) -> Vec<String> {
        from(&self.ask("resolveTargets", json!([selector, bindings_json(bindings)])))
    }
    fn in_combat(&mut self) -> bool {
        self.ask("inCombat", json!([])) == true
    }
    fn loadout_domain(&mut self, id: &str, domain: &str) -> Option<f64> {
        self.ask("loadoutDomain", json!([id, domain])).as_f64()
    }
    fn has_condition(&mut self, id: &str, condition: &str) -> bool {
        self.ask("hasCondition", json!([id, condition])) == true
    }
    fn pool_value(&mut self, id: &str, pool: &str, measure: &str) -> Option<f64> {
        self.ask("poolValue", json!([id, pool, measure])).as_f64()
    }
    fn band_to(&mut self, from_id: &str, to: &str) -> Option<RangeBand> {
        self.ask("bandTo", json!([from_id, to])).as_str().and_then(RangeBand::from_name)
    }
    fn faction_of(&mut self, id: &str) -> Option<Faction> {
        let answer = self.ask("factionOf", json!([id]));
        (!answer.is_null()).then(|| from(&answer))
    }
    fn hook_defined(&mut self, id: &str) -> bool {
        self.ask("hook", json!([id])) == true
    }
    fn run_hook(&mut self, _id: &str, reads: &HookReads) -> bool {
        let next = self.0.borrow_mut().answer("runHook", Value::Null);
        let at = self.0.borrow().at.clone();
        check!(reads.args.clone(), &next["args"], "{at}: the hook's args");
        check!(json!(reads.actor), &next["actor"], "{at}: the hook's actor");
        check!(json!(reads.targets), &next["targets"], "{at}: the hook's targets");
        check!(json!(reads.hit), &next["hit"], "{at}: the hook's hit");
        check!(json!(reads.in_combat), &next["inCombat"], "{at}: the hook's fight");
        next["answer"] == true
    }
    fn tokens_on(&mut self, id: &str, ability: &str) -> f64 {
        self.ask("tokensOn", json!([id, ability])).as_f64().unwrap()
    }
}

impl DiceHand for Recorded {
    fn roll(&mut self, dice: &str) -> f64 {
        let next = self.0.borrow_mut().answer("roll", Value::Null);
        assert_eq!(next["dice"], dice, "{}: rolled", self.0.borrow().at);
        next["answer"].as_f64().unwrap()
    }
    fn amount(&mut self, amount: &Value) -> f64 {
        let next = self.0.borrow_mut().answer("amount", Value::Null);
        assert!(same(amount, &next["amount"]), "{}: read the amount {amount}, the TypeScript {}", self.0.borrow().at, next["amount"]);
        next["answer"].as_f64().unwrap()
    }
}

#[test]
fn conditions_ask_the_same_questions_to_the_same_verdicts() {
    let fixture = fixture();
    let bindings: Vec<TargetBindings> = from(&fixture["bindings"]);
    let cases = fixture["evaluations"].as_array().unwrap();
    assert!(cases.len() > 3000);
    for (i, case) in cases.iter().enumerate() {
        let at = format!("evaluation {i}: {} as {} under bindings {}{}", case["condition"], case["actor"], case["bindings"], if case["dice"] == true { " with dice" } else { "" });
        let tape = Rc::new(RefCell::new(Tape { calls: case["calls"].as_array().unwrap().iter().cloned().collect(), at: at.clone() }));
        let mut context = Recorded(tape.clone());
        let bound = &bindings[case["bindings"].as_u64().unwrap() as usize];
        let verdict = evaluate(&case["condition"], &mut context, bound, case["dice"] == true);
        assert!(tape.borrow().calls.is_empty(), "{at}: the TypeScript also asked {:?}", tape.borrow().calls);
        assert_eq!(json!(verdict), case["verdict"], "{at}");
    }
}

#[test]
fn nothing_to_check_holds_and_variables_are_found() {
    let fixture = fixture();
    let tape = Rc::new(RefCell::new(Tape { calls: VecDeque::new(), at: "optional".into() }));
    assert_eq!(json!(evaluate_optional(None, &mut Recorded(tape), &TargetBindings::default(), false)), fixture["optional"]);
    for case in fixture["variables"].as_array().unwrap() {
        let mut found = Vec::new();
        variables_used(&case[0], &mut found);
        check!(json!(found), &case[1], "variables in {}", case[0]);
    }
}

#[test]
fn marks_are_keyed_alike() {
    let fixture = fixture();
    for case in fixture["marks"]["keys"].as_array().unwrap() {
        assert_eq!(json!(mark_key(case[0].as_str().unwrap(), case[1].as_str().unwrap())), case[2]);
    }
    for case in fixture["marks"]["parsed"].as_array().unwrap() {
        let parsed = parse_mark_key(case[0].as_str().unwrap()).map(|(mark, actor)| json!({ "mark": mark, "actor": actor }));
        assert_eq!(parsed.unwrap_or(Value::Null), case[1], "{}", case[0]);
    }
}

#[test]
fn snapshots_are_read_as_zod_reads_them() {
    let fixture = fixture();
    for case in fixture["snapshots"].as_array().unwrap() {
        let schema = if case["kind"] == "zone" { running_zone_schema() } else { running_countdown_schema() };
        match (schema.parse(&case["value"]), case.get("ok")) {
            (Ok(read), Some(ok)) => check!(read, ok, "{} {}", case["kind"], case["value"]),
            (Err(issues), None) => check!(json!(issues), &case["issues"], "{} {}", case["kind"], case["value"]),
            (got, _) => panic!("{} {}: {got:?}, the TypeScript {}", case["kind"], case["value"], case),
        }
    }
}

fn board_of(entries: &Value) -> CountdownBoard {
    let mut board = CountdownBoard::default();
    for entry in entries.as_array().unwrap() {
        board.set(from::<RunningCountdown>(&entry[1]));
    }
    board
}

fn cue_of(value: &Value) -> CountdownCue {
    match value["kind"].as_str().unwrap() {
        "actionRoll" => CountdownCue::ActionRoll { attack: value["attack"] == true, outcome: from(&value["outcome"]) },
        _ => CountdownCue::HpMarked { id: value["id"].as_str().unwrap().into(), marked: value["marked"].as_f64().unwrap() },
    }
}

#[test]
fn countdown_boards_tick_loop_and_end_alike() {
    let fixture = fixture();
    for (r, run) in fixture["countdowns"].as_array().unwrap().iter().enumerate() {
        let mut board = board_of(&run["initial"]);
        for (s, step) in run["steps"].as_array().unwrap().iter().enumerate() {
            let mut rng = Rng::from_state(from(&step["before"]));
            let moved = advance_board(&mut board, &cue_of(&step["cue"]), &mut rng).expect("rolled");
            check!(serde_json::to_value(&moved).unwrap(), &step["moved"], "run {r} step {s}: moved on {}", step["cue"]);
            check!(serde_json::to_value(&board).unwrap(), &step["board"], "run {r} step {s}: the board");
            assert_eq!(json!(rng.save()), step["after"], "run {r} step {s}: the dice stream");
        }
        check!(serde_json::to_value(&board).unwrap(), &run["beforeReap"], "run {r}: before the reaping");
        let status = &run["status"];
        let reaped = reap_board(&mut board, |id| status.get(id).map_or(OwnerStatus::Gone, from));
        check!(serde_json::to_value(&reaped).unwrap(), &run["reaped"], "run {r}: reaped");
        check!(serde_json::to_value(&board).unwrap(), &run["afterReap"], "run {r}: after the reaping");
        end_creature_countdowns(&mut board);
        check!(serde_json::to_value(&board).unwrap(), &run["afterEnd"], "run {r}: after the scene ended");
    }
}
