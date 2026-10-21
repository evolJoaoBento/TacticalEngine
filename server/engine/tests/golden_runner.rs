//! `server/fixtures/runner.json` replayed. Every script the demo project and the SRD pack carry, and a set
//! written for the corners, run as the TypeScript ran them in the game's own demo scene: the Rust runner
//! walks the same effects against a host that answers from the tape - every world call the TypeScript
//! runner made, in order, with its answer, and where the dice stream stood after a call that was handed it
//! - and must make the same calls in the same order, leave none unmade, reach the same prompts, write the
//! same journal, and leave its own dice stream where the TypeScript's was.

use engine::rng::Rng;
use engine::rules::dice::ParsedDamage;
use engine::rules::range::RangeBand;
use engine::scene::state::{EncounterState, Faction};
use engine::script::conditions::{ConditionContext, DiceHand, HookReads, InteractableState, TargetBindings};
use engine::script::runner::*;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/runner.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/script/runner.golden.test.ts")).expect("JSON")
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

/// One step's world calls, answered in order. Shared, so the next step's calls can be loaded while the
/// runner holds the host.
struct Tape {
    calls: VecDeque<Value>,
    at: String,
}

#[derive(Clone)]
struct Host(Rc<RefCell<Tape>>);

impl Host {
    fn next(&self, call: &str, args: Value) -> Value {
        let mut tape = self.0.borrow_mut();
        let at = tape.at.clone();
        let next = tape.calls.pop_front().unwrap_or_else(|| panic!("{at}: called {call} {args} after the TypeScript had made every call"));
        assert_eq!(next["call"], call, "{at}: called {call} {args}, the TypeScript called {next}");
        assert!(same(&args, &next["args"]), "{at}: called {call} with {args}, the TypeScript with {}", next["args"]);
        next
    }

    fn ask(&self, call: &str, args: Value) -> Value {
        self.next(call, args)["answer"].clone()
    }

    /// A call handed the dice stream: the stream is left where the TypeScript's was after it.
    fn ask_with(&self, call: &str, args: Value, rng: &mut Rng) -> Value {
        let next = self.next(call, args);
        *rng = Rng::from_state(from(&next["after"]));
        next["answer"].clone()
    }

    fn yes(&self, call: &str, args: Value) -> bool {
        self.ask(call, args) == true
    }

    fn num(&self, call: &str, args: Value) -> f64 {
        self.ask(call, args).as_f64().unwrap_or_else(|| panic!("{call}: a number"))
    }

    fn some_num(&self, call: &str, args: Value) -> Option<f64> {
        self.ask(call, args).as_f64()
    }

    fn at(&self) -> String {
        self.0.borrow().at.clone()
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

fn optional<T: serde::de::DeserializeOwned>(value: Value) -> Option<T> {
    (!value.is_null()).then(|| from(&value))
}

impl DiceHand for Host {
    fn roll(&mut self, _dice: &str) -> f64 {
        unreachable!("the runner throws its own dice")
    }
    fn amount(&mut self, _amount: &Value) -> f64 {
        unreachable!("the runner reads its own amounts")
    }
}

impl ConditionContext for Host {
    fn has_flag(&mut self, flag: &str) -> bool {
        self.yes("hasFlag", json!([flag]))
    }
    fn has_key(&mut self, key: &str) -> bool {
        self.yes("hasKey", json!([key]))
    }
    fn has_item(&mut self, item: &str, quantity: f64) -> bool {
        self.yes("hasItem", json!([item, quantity]))
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
        self.num("countAlive", json!([faction_name(faction)]))
    }
    fn quest_status(&mut self, quest: &str) -> String {
        self.ask("questStatus", json!([quest])).as_str().unwrap().to_string()
    }
    fn objective_done(&mut self, quest: &str, objective: &str) -> bool {
        self.yes("objectiveDone", json!([quest, objective]))
    }
    fn actor_id(&mut self) -> Option<String> {
        self.ask("actorId", json!([])).as_str().map(str::to_string)
    }
    fn resolve_targets(&mut self, selector: &Value, bindings: &TargetBindings) -> Vec<String> {
        from(&self.ask("resolveTargets", json!([selector, bindings_json(bindings)])))
    }
    fn in_combat(&mut self) -> bool {
        self.yes("inCombat", json!([]))
    }
    fn loadout_domain(&mut self, id: &str, domain: &str) -> Option<f64> {
        self.some_num("loadoutDomain", json!([id, domain]))
    }
    fn has_condition(&mut self, id: &str, condition: &str) -> bool {
        self.yes("hasCondition", json!([id, condition]))
    }
    fn pool_value(&mut self, id: &str, pool: &str, measure: &str) -> Option<f64> {
        self.some_num("poolValue", json!([id, pool, measure]))
    }
    fn band_to(&mut self, from_id: &str, to: &str) -> Option<RangeBand> {
        self.ask("bandTo", json!([from_id, to])).as_str().and_then(RangeBand::from_name)
    }
    fn faction_of(&mut self, id: &str) -> Option<Faction> {
        optional(self.ask("factionOf", json!([id])))
    }
    fn hook_defined(&mut self, id: &str) -> bool {
        self.yes("hook", json!([id]))
    }
    fn run_hook(&mut self, _id: &str, reads: &HookReads) -> bool {
        let next = self.0.borrow_mut().calls.pop_front().expect("a hook asked");
        assert_eq!(next["call"], "runHook", "{}: asked a hook, the TypeScript {next}", self.at());
        check!(reads.args.clone(), &next["args"], "{}: the hook's args", self.at());
        check!(json!(reads.actor), &next["actor"], "{}: the hook's actor", self.at());
        next["answer"] == true
    }
    fn tokens_on(&mut self, id: &str, ability: &str) -> f64 {
        self.num("tokensOn", json!([id, ability]))
    }
}

impl ScriptWorld for Host {
    fn add_item(&mut self, item: &str, quantity: f64) -> f64 {
        self.num("addItem", json!([item, quantity]))
    }
    fn roll_loot(&mut self, table: Option<&str>, rng: &mut Rng) -> Vec<LootDrop> {
        from(&self.ask_with("rollLoot", json!([table, "rng"]), rng))
    }
    fn remove_item(&mut self, item: &str, quantity: f64) -> f64 {
        self.num("removeItem", json!([item, quantity]))
    }
    fn set_flag(&mut self, flag: &str) {
        self.ask("setFlag", json!([flag]));
    }
    fn clear_flag(&mut self, flag: &str) {
        self.ask("clearFlag", json!([flag]));
    }
    fn give_key(&mut self, key: &str) {
        self.ask("giveKey", json!([key]));
    }
    fn set_var(&mut self, name: &str, value: &Value) {
        self.ask("setVar", json!([name, value]));
    }
    fn open_interactable(&mut self, id: &str) {
        self.ask("openInteractable", json!([id]));
    }
    fn close_interactable(&mut self, id: &str) {
        self.ask("closeInteractable", json!([id]));
    }
    fn remove_interactable(&mut self, id: &str) {
        self.ask("removeInteractable", json!([id]));
    }
    fn mark_interactable_used(&mut self, id: &str) {
        self.ask("markInteractableUsed", json!([id]));
    }
    fn start_encounter(&mut self, id: &str) {
        self.ask("startEncounter", json!([id]));
    }
    fn end_encounter(&mut self, id: &str) {
        self.ask("endEncounter", json!([id]));
    }
    fn damage(&mut self, target: &Value, amount: f64, source: Option<&str>, bindings: &TargetBindings) -> f64 {
        self.num("damage", json!([target, amount, source, bindings_json(bindings)]))
    }
    fn heal(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        self.num("heal", json!([target, amount, bindings_json(bindings)]))
    }
    fn heal_shared(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        self.num("healShared", json!([target, amount, bindings_json(bindings)]))
    }
    fn check_modifier(&mut self, trait_: &str, as_: &str) -> Option<f64> {
        self.some_num("checkModifier", json!([trait_, as_]))
    }
    fn advantage_rolling(&mut self) -> Advantage {
        from(&self.ask("advantageRolling", json!([])))
    }
    fn advantage_against(&mut self, targets: &[String]) -> Advantage {
        from(&self.ask("advantageAgainst", json!([targets])))
    }
    fn lift_roll(&mut self, id: &str, trait_: &str, total: f64, difficulty: f64, critical: bool) -> f64 {
        self.num("liftRoll", json!([id, trait_, total, difficulty, critical]))
    }
    fn good_die_sides(&mut self, id: &str) -> u32 {
        self.num("goodDieSides", json!([id])) as u32
    }
    fn answers_roll(&mut self, id: &str, roll: &Value) -> bool {
        self.yes("answersRoll", json!([id, roll]))
    }
    fn mark_spot(&mut self, actor: &str, mark: &str) -> bool {
        self.yes("markSpot", json!([actor, mark]))
    }
    fn recall_spot(&mut self, actor: &str, mark: &str) -> i32 {
        self.num("recallSpot", json!([actor, mark])) as i32
    }
    fn forget_spot(&mut self, actor: &str, mark: &str) -> bool {
        self.yes("forgetSpot", json!([actor, mark]))
    }
    fn experiences(&mut self) -> Vec<Value> {
        from(&self.ask("experiences", json!([])))
    }
    fn difficulty_of(&mut self, id: &str) -> Option<f64> {
        self.some_num("difficultyOf", json!([id]))
    }
    fn grant_level(&mut self, level: Option<f64>) -> Option<f64> {
        self.some_num("grantLevel", json!([level]))
    }
    fn gain_good(&mut self) -> bool {
        self.yes("gainGood", json!([]))
    }
    fn gain_bad(&mut self) -> bool {
        self.yes("gainBad", json!([]))
    }
    fn start_quest(&mut self, quest: &str) -> bool {
        self.yes("startQuest", json!([quest]))
    }
    fn complete_objective(&mut self, quest: &str, objective: &str) -> bool {
        self.yes("completeObjective", json!([quest, objective]))
    }
    fn reveal_objective(&mut self, quest: &str, objective: &str) -> bool {
        self.yes("revealObjective", json!([quest, objective]))
    }
    fn complete_quest(&mut self, quest: &str) -> bool {
        self.yes("completeQuest", json!([quest]))
    }
    fn fail_quest(&mut self, quest: &str) -> bool {
        self.yes("failQuest", json!([quest]))
    }
    fn deal_damage(&mut self, id: &str, damage: &Value, rng: &mut Rng) -> DealtDamage {
        from(&self.ask_with("dealDamage", json!([id, damage, "rng"]), rng))
    }
    fn mark_stress(&mut self, id: &str, amount: f64) -> StressMarked {
        from(&self.ask("markStress", json!([id, amount])))
    }
    fn clear_stress(&mut self, id: &str, amount: f64) -> f64 {
        self.num("clearStress", json!([id, amount]))
    }
    fn clear_armor(&mut self, id: &str, amount: f64) -> f64 {
        self.num("clearArmor", json!([id, amount]))
    }
    fn mark_armor(&mut self, id: &str, amount: f64) -> f64 {
        self.num("markArmor", json!([id, amount]))
    }
    fn gain_good_for(&mut self, id: &str, amount: f64) -> f64 {
        self.num("gainGoodFor", json!([id, amount]))
    }
    fn spend_good(&mut self, id: &str, amount: f64) -> bool {
        self.yes("spendGood", json!([id, amount]))
    }
    fn lose_good(&mut self, id: &str, amount: f64) -> f64 {
        self.num("loseGood", json!([id, amount]))
    }
    fn apply_condition(&mut self, id: &str, condition: &str, duration: &str) -> bool {
        self.yes("applyCondition", json!([id, condition, duration]))
    }
    fn clear_condition(&mut self, id: &str, condition: &str) -> bool {
        self.yes("clearCondition", json!([id, condition]))
    }
    fn revive(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        from(&self.ask("revive", json!([target, bindings_json(bindings)])))
    }
    fn slay(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        from(&self.ask("slay", json!([target, bindings_json(bindings)])))
    }
    fn set_attitude(&mut self, id: &str, attitude: &str) -> bool {
        self.yes("setAttitude", json!([id, attitude]))
    }
    fn proficiency_of(&mut self, id: &str) -> f64 {
        self.num("proficiencyOf", json!([id]))
    }
    fn add_tokens(&mut self, id: &str, ability: &str, amount: Option<f64>) -> f64 {
        self.num("addTokens", json!([id, ability, amount]))
    }
    fn spend_tokens(&mut self, id: &str, ability: &str, amount: f64) -> f64 {
        self.num("spendTokens", json!([id, ability, amount]))
    }
    fn spellcast_value(&mut self, id: &str) -> Option<f64> {
        self.some_num("spellcastValue", json!([id]))
    }
    fn lose_bad(&mut self) -> bool {
        self.yes("loseBad", json!([]))
    }
    fn trait_value(&mut self, id: &str, trait_: &str) -> Option<f64> {
        self.some_num("traitValue", json!([id, trait_]))
    }
    fn weapon_damage(&mut self, id: &str) -> Option<ParsedDamage> {
        optional(self.ask("weaponDamage", json!([id])))
    }
    fn attack(&mut self, request: &Value, rng: &mut Rng) -> AttackSummary {
        from(&self.ask_with("attack", json!([request, "rng"]), rng))
    }
    fn push_back(&mut self, from_id: &str, target: &str, band: &str) -> Option<Moved> {
        optional(self.ask("pushBack", json!([from_id, target, band])))
    }
    fn draw_in(&mut self, mover: &str, toward: &str, band: &str, budget: Option<&str>) -> Option<Moved> {
        optional(self.ask("drawIn", json!([mover, toward, band, budget])))
    }
    fn draw_to(&mut self, mover: &str, goal: i32, band: &str, budget: Option<&str>) -> Option<Moved> {
        optional(self.ask("drawTo", json!([mover, goal, band, budget])))
    }
    fn blink_to(&mut self, mover: &str, goal: i32, band: Option<&str>) -> Option<Moved> {
        optional(self.ask("blinkTo", json!([mover, goal, band])))
    }
    fn break_away(&mut self, mover: &str, from_id: &str, budget: Option<&str>) -> Option<Moved> {
        optional(self.ask("breakAway", json!([mover, from_id, budget])))
    }
    fn summon(&mut self, definition: &str, count: f64, range: &str) -> Arrived {
        from(&self.ask("summon", json!([definition, count, range])))
    }
    fn start_countdown(&mut self, countdown: &Value) {
        self.ask("startCountdown", json!([countdown]));
    }
    fn place_zone(&mut self, zone: &Value) {
        self.ask("placeZone", json!([zone]));
    }
    fn end_zone(&mut self, id: &str) -> bool {
        self.yes("endZone", json!([id]))
    }
    fn refresh_zones(&mut self) {
        self.ask("refreshZones", json!([]));
    }
    fn tile_of(&mut self, id: &str) -> i32 {
        self.num("tileOf", json!([id])) as i32
    }
    fn spotlight_spent(&mut self, id: &str) -> bool {
        self.yes("spotlightSpent", json!([id]))
    }
    fn nearest_first(&mut self, from_id: &str, ids: &[String]) -> Vec<String> {
        from(&self.ask("nearestFirst", json!([from_id, ids])))
    }
    fn replace(&mut self, definition: &str, count: f64) -> Arrived {
        from(&self.ask("replace", json!([definition, count])))
    }
    fn roll_reaction(&mut self, id: &str, difficulty: f64, trait_: &str, rng: &mut Rng) -> ReactionRolled {
        from(&self.ask_with("rollReaction", json!([id, difficulty, trait_, "rng"]), rng))
    }
    fn run_hook_effect(&mut self, _id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: &mut Rng) -> HookRun {
        let next = self.0.borrow_mut().calls.pop_front().expect("a hook run");
        let at = self.at();
        assert_eq!(next["call"], "runHookEffect", "{at}: ran a hook, the TypeScript {next}");
        check!(reads.args.clone(), &next["args"], "{at}: the hook's args");
        check!(json!(reads.actor), &next["actor"], "{at}: the hook's actor");
        check!(json!(reads.targets), &next["targets"], "{at}: the hook's targets");
        check!(json!(reads.hit), &next["hit"], "{at}: the hook's hit");
        check!(json!(reads.in_combat), &next["inCombat"], "{at}: the hook's fight");
        check!(json!(last_roll), &next["lastRoll"], "{at}: the hook's last roll");
        *rng = Rng::from_state(from(&next["after"]));
        HookRun { ok: next["ok"] == true, message: next["message"].as_str().unwrap_or_default().to_string(), queued: from(&next["queued"]) }
    }
}

fn status_json(status: &RunStatus, journal: &[Value], since: usize) -> Value {
    let mut out = match status {
        RunStatus::Done => json!({ "status": "done" }),
        RunStatus::Waiting(prompt) => json!({ "status": "waiting", "prompt": prompt }),
    };
    out["journalLength"] = json!(journal.len());
    out["newEntries"] = Value::Array(journal[since.min(journal.len())..].to_vec());
    out
}

#[test]
fn every_script_runs_as_the_typescript_ran_it() {
    let fixture = fixture();
    let runs = fixture["runs"].as_array().unwrap();
    assert!(runs.len() > 800);
    let mut steps_replayed = 0;
    for run in runs {
        let effects: Vec<Value> = from(&run["effects"]);
        let options: RunnerOptions = from(&run["options"]);
        let tape = Rc::new(RefCell::new(Tape { calls: VecDeque::new(), at: String::new() }));
        let mut host = Host(tape.clone());
        let seed = format!("{}:dice", run["seed"].as_str().unwrap());
        let mut rng = Rng::new(engine::rng::Seed::Text(&seed));
        let mut runner = ScriptRunner::new(&mut host, &mut rng, &options);
        let mut status = RunStatus::Done;
        let mut seen = 0;
        for (i, step) in run["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("{} ({}) step {i}: {}", run["source"], run["seed"], step["move"]);
            *tape.borrow_mut() = Tape { calls: step["calls"].as_array().unwrap().iter().cloned().collect(), at: at.clone() };
            let mv = &step["move"];
            if mv["act"] == "run" {
                status = runner.run(&effects);
            } else {
                match runner.resume(&mv["response"]) {
                    Ok(next) => {
                        assert!(mv.get("threw") != Some(&json!(true)), "{at}: the TypeScript threw, we resumed");
                        status = next;
                    }
                    Err(_) => assert_eq!(mv["threw"], true, "{at}: we refused to resume, the TypeScript did not"),
                }
            }
            assert!(tape.borrow().calls.is_empty(), "{at}: the TypeScript also called {:?}", tape.borrow().calls);
            check!(status_json(&status, runner.entries(), seen), &step["status"], "{at}");
            let flags = json!({
                "spotlightToGm": runner.spotlight_to_gm, "rolled": runner.rolled, "cancelled": runner.cancelled, "vaulted": runner.vaulted,
                "lastActionRoll": runner.last_action_roll(),
            });
            check!(flags, &step["flags"], "{at}: the runner's flags");
            assert_eq!(json!(runner.stream()), step["after"], "{at}: the dice stream");
            seen = runner.entries().len();
            steps_replayed += 1;
        }
    }
    assert!(steps_replayed > 1100, "{steps_replayed}");
}
