//! `server/fixtures/world.json` replayed beside `runner.json`. Every run the runner's fixture holds is run
//! again here by the Rust runner against the Rust world - `SceneScriptWorld`, stood up from the scene, the
//! scenario and the content the TypeScript's world began with - and each call the runner makes is answered
//! by that world and held to what the TypeScript's world answered, in order, with the dice stream where
//! the TypeScript's was after it. Hooks are the one part taped rather than run: every hook the TypeScript
//! ran, from the runner or from inside the world, answers from the tape. After every step the creatures,
//! things, encounters, Shadow and scenario that changed must be the ones the TypeScript's did, changed
//! alike; at the end, the blows and crossings waiting to be heard must be the same. One run in four is then
//! probed: the world asked directly, on a seeded stream, what a fight asks beyond a script - writes between
//! the reads so there is something to read - each answer held to the TypeScript's.

use engine::content::abilities::AbilityDef;
use engine::rng::Rng;
use engine::rules::dice::ParsedDamage;
use engine::rules::range::RangeBand;
use engine::scene::state::{EncounterState, Faction};
use engine::script::conditions::{ConditionContext, DiceHand, HookReads, InteractableState, TargetBindings};
use engine::script::runner::*;
use engine::script::world::{HookReader, Hooks, ScenarioState, SceneScriptWorld, WorldContent};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;

#[macro_use]
#[path = "support/world.rs"]
mod support;
use support::*;

// --- Hooks, taped --------------------------------------------------------------------------------------

struct Step {
    calls: VecDeque<Value>,
    hooks: VecDeque<Value>,
    at: String,
}

type Shared = Rc<RefCell<Step>>;

struct TapedHooks {
    defined: Vec<String>,
    step: Shared,
}

impl TapedHooks {
    fn next(&self, call: &str, reads: &HookReads) -> Value {
        let mut step = self.step.borrow_mut();
        let at = step.at.clone();
        let next = step.hooks.pop_front().unwrap_or_else(|| panic!("{at}: ran a hook the TypeScript did not"));
        assert_eq!(next["call"], call, "{at}: ran a hook as {call}, the TypeScript {next}");
        check!(reads.args.clone(), &next["args"], "{at}: the hook's args");
        check!(json!(reads.actor), &next["actor"], "{at}: the hook's actor");
        check!(json!(reads.targets), &next["targets"], "{at}: the hook's targets");
        check!(json!(reads.hit), &next["hit"], "{at}: the hook's hit");
        check!(json!(reads.in_combat), &next["inCombat"], "{at}: the hook's fight");
        next
    }
}

impl Hooks for TapedHooks {
    fn defined(&self, id: &str) -> bool {
        self.defined.iter().any(|d| d == id)
    }
    fn run(&self, _id: &str, reads: &HookReads, _world: &mut dyn HookReader) -> bool {
        self.next("runHook", reads)["answer"] == true
    }
    fn run_effect(&self, _id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: &mut Rng, _world: &mut dyn HookReader) -> HookRun {
        let next = self.next("runHookEffect", reads);
        check!(json!(last_roll), &next["lastRoll"], "{}: the hook's last roll", self.step.borrow().at);
        *rng = Rng::from_state(from(&next["after"]));
        HookRun { ok: next["ok"] == true, message: next["message"].as_str().unwrap_or_default().to_string(), queued: from(&next["queued"]) }
    }
}

// --- The world, answering and checked -------------------------------------------------------------------

/// The runner's host: every call answered by the real world and held to the TypeScript's answer. The
/// world is shared, so the replay can read it between steps while the runner holds the host.
struct Checked<'w> {
    world: Rc<RefCell<SceneScriptWorld<'w>>>,
    step: Shared,
}

impl<'w> Checked<'w> {
    fn w(&self) -> std::cell::RefMut<'_, SceneScriptWorld<'w>> {
        self.world.borrow_mut()
    }

    fn expect(&self, call: &str, args: &Value) -> Value {
        let mut step = self.step.borrow_mut();
        let at = step.at.clone();
        let next = step.calls.pop_front().unwrap_or_else(|| panic!("{at}: called {call} {args} after the TypeScript had made every call"));
        assert_eq!(next["call"], call, "{at}: called {call} {args}, the TypeScript called {next}");
        assert!(same(args, &next["args"]), "{at}: called {call} with {args}, the TypeScript with {}", next["args"]);
        next
    }

    fn answered<T: serde::Serialize>(&self, call: &str, args: Value, got: T) -> T {
        let next = self.expect(call, &args);
        check!(to(&got), &next["answer"], "{}: {call} {args}", self.step.borrow().at);
        got
    }

    fn answered_with<T: serde::Serialize>(&self, call: &str, args: Value, rng: &Rng, got: T, next: Value) -> T {
        let at = self.step.borrow().at.clone();
        check!(to(&got), &next["answer"], "{at}: {call} {args}");
        assert_eq!(json!(rng.save()), next["after"], "{at}: the dice stream after {call}");
        got
    }
}

fn bindings_json(bindings: &TargetBindings) -> Value {
    to(bindings)
}

fn faction_name(faction: Faction) -> &'static str {
    match faction {
        Faction::Party => "party",
        Faction::Adversary => "adversary",
        Faction::Neutral => "neutral",
    }
}

impl DiceHand for Checked<'_> {
    fn roll(&mut self, _dice: &str) -> f64 {
        unreachable!("the runner throws its own dice")
    }
    fn amount(&mut self, _amount: &Value) -> f64 {
        unreachable!("the runner reads its own amounts")
    }
}

type W<'w> = SceneScriptWorld<'w>;

impl ConditionContext for Checked<'_> {
    fn has_flag(&mut self, flag: &str) -> bool {
        let got = ConditionContext::has_flag(&mut *self.w(), flag);
        self.answered("hasFlag", json!([flag]), got)
    }
    fn has_key(&mut self, key: &str) -> bool {
        let got = ConditionContext::has_key(&mut *self.w(), key);
        self.answered("hasKey", json!([key]), got)
    }
    fn has_item(&mut self, item: &str, quantity: f64) -> bool {
        let got = ConditionContext::has_item(&mut *self.w(), item, quantity);
        self.answered("hasItem", json!([item, quantity]), got)
    }
    fn get_var(&mut self, name: &str) -> Value {
        let got = ConditionContext::get_var(&mut *self.w(), name);
        self.answered("getVar", json!([name]), got)
    }
    fn interactable_state(&mut self, id: &str) -> InteractableState {
        let got = ConditionContext::interactable_state(&mut *self.w(), id);
        self.answered("interactableState", json!([id]), got)
    }
    fn encounter_state(&mut self, id: &str) -> EncounterState {
        let got = ConditionContext::encounter_state(&mut *self.w(), id);
        self.answered("encounterState", json!([id]), got)
    }
    fn count_alive(&mut self, faction: Faction) -> f64 {
        let got = ConditionContext::count_alive(&mut *self.w(), faction);
        self.answered("countAlive", json!([faction_name(faction)]), got)
    }
    fn quest_status(&mut self, quest: &str) -> String {
        let got = ConditionContext::quest_status(&mut *self.w(), quest);
        self.answered("questStatus", json!([quest]), got)
    }
    fn objective_done(&mut self, quest: &str, objective: &str) -> bool {
        let got = ConditionContext::objective_done(&mut *self.w(), quest, objective);
        self.answered("objectiveDone", json!([quest, objective]), got)
    }
    fn actor_id(&mut self) -> Option<String> {
        let got = ConditionContext::actor_id(&mut *self.w());
        self.answered("actorId", json!([]), got)
    }
    fn resolve_targets(&mut self, selector: &Value, bindings: &TargetBindings) -> Vec<String> {
        let got = ConditionContext::resolve_targets(&mut *self.w(), selector, bindings);
        self.answered("resolveTargets", json!([selector, bindings_json(bindings)]), got)
    }
    fn in_combat(&mut self) -> bool {
        let got = ConditionContext::in_combat(&mut *self.w());
        self.answered("inCombat", json!([]), got)
    }
    fn loadout_domain(&mut self, id: &str, domain: &str) -> Option<f64> {
        let got = ConditionContext::loadout_domain(&mut *self.w(), id, domain);
        self.answered("loadoutDomain", json!([id, domain]), got)
    }
    fn has_condition(&mut self, id: &str, condition: &str) -> bool {
        let got = ConditionContext::has_condition(&mut *self.w(), id, condition);
        self.answered("hasCondition", json!([id, condition]), got)
    }
    fn pool_value(&mut self, id: &str, pool: &str, measure: &str) -> Option<f64> {
        let got = ConditionContext::pool_value(&mut *self.w(), id, pool, measure);
        self.answered("poolValue", json!([id, pool, measure]), got)
    }
    fn band_to(&mut self, from_id: &str, to_id: &str) -> Option<RangeBand> {
        let got = ConditionContext::band_to(&mut *self.w(), from_id, to_id);
        self.answered("bandTo", json!([from_id, to_id]), got)
    }
    fn faction_of(&mut self, id: &str) -> Option<Faction> {
        let got = ConditionContext::faction_of(&mut *self.w(), id);
        self.answered("factionOf", json!([id]), got)
    }
    fn hook_defined(&mut self, id: &str) -> bool {
        let got = ConditionContext::hook_defined(&mut *self.w(), id);
        self.answered("hook", json!([id]), got)
    }
    fn run_hook(&mut self, id: &str, reads: &HookReads) -> bool {
        let next = self.step.borrow_mut().calls.pop_front().expect("a hook asked");
        assert_eq!(next["call"], "runHook", "{}: asked a hook, the TypeScript {next}", self.step.borrow().at);
        let got = ConditionContext::run_hook(&mut *self.w(), id, reads);
        assert_eq!(json!(got), next["answer"], "{}: the hook's answer", self.step.borrow().at);
        got
    }
    fn tokens_on(&mut self, id: &str, ability: &str) -> f64 {
        let got = ConditionContext::tokens_on(&mut *self.w(), id, ability);
        self.answered("tokensOn", json!([id, ability]), got)
    }
}

impl ScriptWorld for Checked<'_> {
    fn add_item(&mut self, item: &str, quantity: f64) -> f64 {
        let got = <W as ScriptWorld>::add_item(&mut *self.w(), item, quantity);
        self.answered("addItem", json!([item, quantity]), got)
    }
    fn roll_loot(&mut self, table: Option<&str>, rng: &mut Rng) -> Vec<LootDrop> {
        let args = json!([table, "rng"]);
        let next = self.expect("rollLoot", &args);
        let got = <W as ScriptWorld>::roll_loot(&mut *self.w(), table, rng);
        self.answered_with("rollLoot", args, rng, got, next)
    }
    fn remove_item(&mut self, item: &str, quantity: f64) -> f64 {
        let got = <W as ScriptWorld>::remove_item(&mut *self.w(), item, quantity);
        self.answered("removeItem", json!([item, quantity]), got)
    }
    fn set_flag(&mut self, flag: &str) {
        <W as ScriptWorld>::set_flag(&mut *self.w(), flag);
        self.answered("setFlag", json!([flag]), ())
    }
    fn clear_flag(&mut self, flag: &str) {
        <W as ScriptWorld>::clear_flag(&mut *self.w(), flag);
        self.answered("clearFlag", json!([flag]), ())
    }
    fn give_key(&mut self, key: &str) {
        <W as ScriptWorld>::give_key(&mut *self.w(), key);
        self.answered("giveKey", json!([key]), ())
    }
    fn set_var(&mut self, name: &str, value: &Value) {
        <W as ScriptWorld>::set_var(&mut *self.w(), name, value);
        self.answered("setVar", json!([name, value]), ())
    }
    fn open_interactable(&mut self, id: &str) {
        <W as ScriptWorld>::open_interactable(&mut *self.w(), id);
        self.answered("openInteractable", json!([id]), ())
    }
    fn close_interactable(&mut self, id: &str) {
        <W as ScriptWorld>::close_interactable(&mut *self.w(), id);
        self.answered("closeInteractable", json!([id]), ())
    }
    fn remove_interactable(&mut self, id: &str) {
        <W as ScriptWorld>::remove_interactable(&mut *self.w(), id);
        self.answered("removeInteractable", json!([id]), ())
    }
    fn mark_interactable_used(&mut self, id: &str) {
        <W as ScriptWorld>::mark_interactable_used(&mut *self.w(), id);
        self.answered("markInteractableUsed", json!([id]), ())
    }
    fn start_encounter(&mut self, id: &str) {
        <W as ScriptWorld>::start_encounter(&mut *self.w(), id);
        self.answered("startEncounter", json!([id]), ())
    }
    fn end_encounter(&mut self, id: &str) {
        <W as ScriptWorld>::end_encounter(&mut *self.w(), id);
        self.answered("endEncounter", json!([id]), ())
    }
    fn damage(&mut self, target: &Value, amount: f64, source: Option<&str>, bindings: &TargetBindings) -> f64 {
        let got = <W as ScriptWorld>::damage(&mut *self.w(), target, amount, source, bindings);
        self.answered("damage", json!([target, amount, source, bindings_json(bindings)]), got)
    }
    fn heal(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        let got = <W as ScriptWorld>::heal(&mut *self.w(), target, amount, bindings);
        self.answered("heal", json!([target, amount, bindings_json(bindings)]), got)
    }
    fn heal_shared(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        let got = <W as ScriptWorld>::heal_shared(&mut *self.w(), target, amount, bindings);
        self.answered("healShared", json!([target, amount, bindings_json(bindings)]), got)
    }
    fn check_modifier(&mut self, trait_: &str, as_: &str) -> Option<f64> {
        let got = <W as ScriptWorld>::check_modifier(&mut *self.w(), trait_, as_);
        self.answered("checkModifier", json!([trait_, as_]), got)
    }
    fn advantage_rolling(&mut self) -> Advantage {
        let got = <W as ScriptWorld>::advantage_rolling(&mut *self.w());
        self.answered("advantageRolling", json!([]), got)
    }
    fn advantage_against(&mut self, targets: &[String]) -> Advantage {
        let got = <W as ScriptWorld>::advantage_against(&mut *self.w(), targets);
        self.answered("advantageAgainst", json!([targets]), got)
    }
    fn lift_roll(&mut self, id: &str, trait_: &str, total: f64, difficulty: f64, critical: bool) -> f64 {
        let got = <W as ScriptWorld>::lift_roll(&mut *self.w(), id, trait_, total, difficulty, critical);
        self.answered("liftRoll", json!([id, trait_, total, difficulty, critical]), got)
    }
    fn good_die_sides(&mut self, id: &str) -> u32 {
        let got = <W as ScriptWorld>::good_die_sides(&mut *self.w(), id);
        self.answered("goodDieSides", json!([id]), got)
    }
    fn answers_roll(&mut self, id: &str, roll: &Value) -> bool {
        let got = <W as ScriptWorld>::answers_roll(&mut *self.w(), id, roll);
        self.answered("answersRoll", json!([id, roll]), got)
    }
    fn mark_spot(&mut self, actor: &str, mark: &str) -> bool {
        let got = <W as ScriptWorld>::mark_spot(&mut *self.w(), actor, mark);
        self.answered("markSpot", json!([actor, mark]), got)
    }
    fn recall_spot(&mut self, actor: &str, mark: &str) -> i32 {
        let got = <W as ScriptWorld>::recall_spot(&mut *self.w(), actor, mark);
        self.answered("recallSpot", json!([actor, mark]), got)
    }
    fn forget_spot(&mut self, actor: &str, mark: &str) -> bool {
        let got = <W as ScriptWorld>::forget_spot(&mut *self.w(), actor, mark);
        self.answered("forgetSpot", json!([actor, mark]), got)
    }
    fn experiences(&mut self) -> Vec<Value> {
        let got = <W as ScriptWorld>::experiences(&mut *self.w());
        self.answered("experiences", json!([]), got)
    }
    fn difficulty_of(&mut self, id: &str) -> Option<f64> {
        let got = <W as ScriptWorld>::difficulty_of(&mut *self.w(), id);
        self.answered("difficultyOf", json!([id]), got)
    }
    fn grant_level(&mut self, level: Option<f64>) -> Option<f64> {
        let got = <W as ScriptWorld>::grant_level(&mut *self.w(), level);
        self.answered("grantLevel", json!([level]), got)
    }
    fn gain_good(&mut self) -> bool {
        let got = <W as ScriptWorld>::gain_good(&mut *self.w());
        self.answered("gainGood", json!([]), got)
    }
    fn gain_bad(&mut self) -> bool {
        let got = <W as ScriptWorld>::gain_bad(&mut *self.w());
        self.answered("gainBad", json!([]), got)
    }
    fn start_quest(&mut self, quest: &str) -> bool {
        let got = <W as ScriptWorld>::start_quest(&mut *self.w(), quest);
        self.answered("startQuest", json!([quest]), got)
    }
    fn complete_objective(&mut self, quest: &str, objective: &str) -> bool {
        let got = <W as ScriptWorld>::complete_objective(&mut *self.w(), quest, objective);
        self.answered("completeObjective", json!([quest, objective]), got)
    }
    fn reveal_objective(&mut self, quest: &str, objective: &str) -> bool {
        let got = <W as ScriptWorld>::reveal_objective(&mut *self.w(), quest, objective);
        self.answered("revealObjective", json!([quest, objective]), got)
    }
    fn complete_quest(&mut self, quest: &str) -> bool {
        let got = <W as ScriptWorld>::complete_quest(&mut *self.w(), quest);
        self.answered("completeQuest", json!([quest]), got)
    }
    fn fail_quest(&mut self, quest: &str) -> bool {
        let got = <W as ScriptWorld>::fail_quest(&mut *self.w(), quest);
        self.answered("failQuest", json!([quest]), got)
    }
    fn deal_damage(&mut self, id: &str, damage: &Value, rng: &mut Rng) -> DealtDamage {
        let args = json!([id, damage, "rng"]);
        let next = self.expect("dealDamage", &args);
        let got = <W as ScriptWorld>::deal_damage(&mut *self.w(), id, damage, rng);
        self.answered_with("dealDamage", args, rng, got, next)
    }
    fn mark_stress(&mut self, id: &str, amount: f64) -> StressMarked {
        let got = <W as ScriptWorld>::mark_stress(&mut *self.w(), id, amount);
        self.answered("markStress", json!([id, amount]), got)
    }
    fn clear_stress(&mut self, id: &str, amount: f64) -> f64 {
        let got = <W as ScriptWorld>::clear_stress(&mut *self.w(), id, amount);
        self.answered("clearStress", json!([id, amount]), got)
    }
    fn clear_armor(&mut self, id: &str, amount: f64) -> f64 {
        let got = <W as ScriptWorld>::clear_armor(&mut *self.w(), id, amount);
        self.answered("clearArmor", json!([id, amount]), got)
    }
    fn mark_armor(&mut self, id: &str, amount: f64) -> f64 {
        let got = <W as ScriptWorld>::mark_armor(&mut *self.w(), id, amount);
        self.answered("markArmor", json!([id, amount]), got)
    }
    fn gain_good_for(&mut self, id: &str, amount: f64) -> f64 {
        let got = <W as ScriptWorld>::gain_good_for(&mut *self.w(), id, amount);
        self.answered("gainGoodFor", json!([id, amount]), got)
    }
    fn spend_good(&mut self, id: &str, amount: f64) -> bool {
        let got = <W as ScriptWorld>::spend_good(&mut *self.w(), id, amount);
        self.answered("spendGood", json!([id, amount]), got)
    }
    fn lose_good(&mut self, id: &str, amount: f64) -> f64 {
        let got = <W as ScriptWorld>::lose_good(&mut *self.w(), id, amount);
        self.answered("loseGood", json!([id, amount]), got)
    }
    fn apply_condition(&mut self, id: &str, condition: &str, duration: &str) -> bool {
        let got = <W as ScriptWorld>::apply_condition(&mut *self.w(), id, condition, duration);
        self.answered("applyCondition", json!([id, condition, duration]), got)
    }
    fn clear_condition(&mut self, id: &str, condition: &str) -> bool {
        let got = <W as ScriptWorld>::clear_condition(&mut *self.w(), id, condition);
        self.answered("clearCondition", json!([id, condition]), got)
    }
    fn revive(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        let got = <W as ScriptWorld>::revive(&mut *self.w(), target, bindings);
        self.answered("revive", json!([target, bindings_json(bindings)]), got)
    }
    fn slay(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        let got = <W as ScriptWorld>::slay(&mut *self.w(), target, bindings);
        self.answered("slay", json!([target, bindings_json(bindings)]), got)
    }
    fn set_attitude(&mut self, id: &str, attitude: &str) -> bool {
        let got = <W as ScriptWorld>::set_attitude(&mut *self.w(), id, attitude);
        self.answered("setAttitude", json!([id, attitude]), got)
    }
    fn proficiency_of(&mut self, id: &str) -> f64 {
        let got = <W as ScriptWorld>::proficiency_of(&mut *self.w(), id);
        self.answered("proficiencyOf", json!([id]), got)
    }
    fn add_tokens(&mut self, id: &str, ability: &str, amount: Option<f64>) -> f64 {
        let got = <W as ScriptWorld>::add_tokens(&mut *self.w(), id, ability, amount);
        self.answered("addTokens", json!([id, ability, amount]), got)
    }
    fn spend_tokens(&mut self, id: &str, ability: &str, amount: f64) -> f64 {
        let got = <W as ScriptWorld>::spend_tokens(&mut *self.w(), id, ability, amount);
        self.answered("spendTokens", json!([id, ability, amount]), got)
    }
    fn spellcast_value(&mut self, id: &str) -> Option<f64> {
        let got = <W as ScriptWorld>::spellcast_value(&mut *self.w(), id);
        self.answered("spellcastValue", json!([id]), got)
    }
    fn lose_bad(&mut self) -> bool {
        let got = <W as ScriptWorld>::lose_bad(&mut *self.w());
        self.answered("loseBad", json!([]), got)
    }
    fn trait_value(&mut self, id: &str, trait_: &str) -> Option<f64> {
        let got = <W as ScriptWorld>::trait_value(&mut *self.w(), id, trait_);
        self.answered("traitValue", json!([id, trait_]), got)
    }
    fn weapon_damage(&mut self, id: &str) -> Option<ParsedDamage> {
        let got = <W as ScriptWorld>::weapon_damage(&mut *self.w(), id);
        self.answered("weaponDamage", json!([id]), got)
    }
    fn attack(&mut self, request: &Value, rng: &mut Rng) -> AttackSummary {
        let args = json!([request, "rng"]);
        let next = self.expect("attack", &args);
        let got = <W as ScriptWorld>::attack(&mut *self.w(), request, rng);
        self.answered_with("attack", args, rng, got, next)
    }
    fn push_back(&mut self, from_id: &str, target: &str, band: &str) -> Option<Moved> {
        let got = <W as ScriptWorld>::push_back(&mut *self.w(), from_id, target, band);
        self.answered("pushBack", json!([from_id, target, band]), got)
    }
    fn draw_in(&mut self, mover: &str, toward: &str, band: &str, budget: Option<&str>) -> Option<Moved> {
        let got = <W as ScriptWorld>::draw_in(&mut *self.w(), mover, toward, band, budget);
        self.answered("drawIn", json!([mover, toward, band, budget]), got)
    }
    fn draw_to(&mut self, mover: &str, goal: i32, band: &str, budget: Option<&str>) -> Option<Moved> {
        let got = <W as ScriptWorld>::draw_to(&mut *self.w(), mover, goal, band, budget);
        self.answered("drawTo", json!([mover, goal, band, budget]), got)
    }
    fn blink_to(&mut self, mover: &str, goal: i32, band: Option<&str>) -> Option<Moved> {
        let got = <W as ScriptWorld>::blink_to(&mut *self.w(), mover, goal, band);
        self.answered("blinkTo", json!([mover, goal, band]), got)
    }
    fn break_away(&mut self, mover: &str, from_id: &str, budget: Option<&str>) -> Option<Moved> {
        let got = <W as ScriptWorld>::break_away(&mut *self.w(), mover, from_id, budget);
        self.answered("breakAway", json!([mover, from_id, budget]), got)
    }
    fn summon(&mut self, definition: &str, count: f64, range: &str) -> Arrived {
        let got = <W as ScriptWorld>::summon(&mut *self.w(), definition, count, range);
        self.answered("summon", json!([definition, count, range]), got)
    }
    fn start_countdown(&mut self, countdown: &Value) {
        <W as ScriptWorld>::start_countdown(&mut *self.w(), countdown);
        self.answered("startCountdown", json!([countdown]), ())
    }
    fn place_zone(&mut self, zone: &Value) {
        <W as ScriptWorld>::place_zone(&mut *self.w(), zone);
        self.answered("placeZone", json!([zone]), ())
    }
    fn end_zone(&mut self, id: &str) -> bool {
        let got = <W as ScriptWorld>::end_zone(&mut *self.w(), id);
        self.answered("endZone", json!([id]), got)
    }
    fn refresh_zones(&mut self) {
        <W as ScriptWorld>::refresh_zones(&mut *self.w());
        self.answered("refreshZones", json!([]), ())
    }
    fn tile_of(&mut self, id: &str) -> i32 {
        let got = <W as ScriptWorld>::tile_of(&mut *self.w(), id);
        self.answered("tileOf", json!([id]), got)
    }
    fn spotlight_spent(&mut self, id: &str) -> bool {
        let got = <W as ScriptWorld>::spotlight_spent(&mut *self.w(), id);
        self.answered("spotlightSpent", json!([id]), got)
    }
    fn nearest_first(&mut self, from_id: &str, ids: &[String]) -> Vec<String> {
        let got = <W as ScriptWorld>::nearest_first(&mut *self.w(), from_id, ids);
        self.answered("nearestFirst", json!([from_id, ids]), got)
    }
    fn replace(&mut self, definition: &str, count: f64) -> Arrived {
        let got = <W as ScriptWorld>::replace(&mut *self.w(), definition, count);
        self.answered("replace", json!([definition, count]), got)
    }
    fn roll_reaction(&mut self, id: &str, difficulty: f64, trait_: &str, rng: &mut Rng) -> ReactionRolled {
        let args = json!([id, difficulty, trait_, "rng"]);
        let next = self.expect("rollReaction", &args);
        let got = <W as ScriptWorld>::roll_reaction(&mut *self.w(), id, difficulty, trait_, rng);
        self.answered_with("rollReaction", args, rng, got, next)
    }
    fn run_hook_effect(&mut self, id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: &mut Rng) -> HookRun {
        let next = self.step.borrow_mut().calls.pop_front().expect("a hook run");
        let at = self.step.borrow().at.clone();
        assert_eq!(next["call"], "runHookEffect", "{at}: ran a hook, the TypeScript {next}");
        let got = <W as ScriptWorld>::run_hook_effect(&mut *self.w(), id, reads, last_roll, rng);
        check!(json!({ "ok": got.ok, "message": got.message, "queued": got.queued }), &json!({ "ok": next["ok"], "message": next["message"], "queued": next["queued"] }), "{at}: the hook's run");
        assert_eq!(json!(rng.save()), next["after"], "{at}: the dice stream after the hook");
        got
    }
}

// --- Probes: the world asked directly -------------------------------------------------------------------

fn text(v: &Value) -> &str {
    v.as_str().unwrap_or_else(|| panic!("a string: {v}"))
}

fn number(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("a number: {v}"))
}

fn band(v: &Value) -> RangeBand {
    RangeBand::from_name(text(v)).expect("a band")
}

fn ids_of(abilities: &[&AbilityDef]) -> Value {
    json!(abilities.iter().map(|a| &a.id).collect::<Vec<_>>())
}

/// A creature's defences as the TypeScript writes them: the lists that have something in them.
fn defenses_json(d: &engine::rules::damage::DamageDefenses) -> Value {
    let mut out = serde_json::Map::new();
    if !d.resistances.is_empty() {
        out.insert("resistances".into(), to(&d.resistances));
    }
    if !d.immunities.is_empty() {
        out.insert("immunities".into(), to(&d.immunities));
    }
    if !d.reduce.is_empty() {
        out.insert("reduce".into(), to(&d.reduce));
    }
    Value::Object(out)
}

fn blow_of(note: &Value) -> engine::script::world::Blow {
    engine::script::world::Blow {
        attacker: note.get("attacker").and_then(Value::as_str).map(str::to_string),
        hit_points: note.get("hitPoints").and_then(Value::as_f64),
        damage: note.get("damage").and_then(Value::as_f64),
        types: note.get("types").map(from),
        severe: note.get("severe").and_then(Value::as_bool),
    }
}

fn cue_of(cue: &Value) -> engine::rules::countdown::CountdownCue {
    use engine::rules::countdown::CountdownCue;
    match text(&cue["kind"]) {
        "actionRoll" => CountdownCue::ActionRoll { attack: cue["attack"] == true, outcome: from(&cue["outcome"]) },
        _ => CountdownCue::HpMarked { id: text(&cue["id"]).to_string(), marked: number(&cue["marked"]) },
    }
}

/// One probe: the call made on the Rust world, answered as the TypeScript wrote the answer.
fn probe(world: &mut SceneScriptWorld, call: &str, a: &[Value], dice: &mut Rng) -> Value {
    use engine::content::abilities::Stat;
    use engine::content::conditions::ConditionBlock;
    use engine::scene::state::ConditionDuration;
    let s = |i: usize| text(&a[i]).to_string();
    let n = |i: usize| number(&a[i]);
    let bindings = |i: usize| -> TargetBindings { from(&a[i]) };
    match call {
        "actor" => {
            world.scenario.actor_id = a[0].as_str().map(str::to_string);
            Value::Null
        }
        "applyCondition" => json!(world.apply_condition(&s(0), &s(1), from::<ConditionDuration>(&a[2]))),
        "clearCondition" => json!(world.clear_condition(&s(0), &s(1))),
        "placeZone" => {
            world.place_zone(from(&a[0]));
            Value::Null
        }
        "endZone" => json!(world.end_zone(&s(0))),
        "refreshZones" => {
            world.refresh_zones();
            Value::Null
        }
        "addTokens" => json!(world.add_tokens(&s(0), &s(1), a[2].as_f64())),
        "spendTokens" => json!(world.spend_tokens(&s(0), &s(1), n(2))),
        "markSpot" => json!(world.mark_spot(&s(0), &s(1))),
        "forgetSpot" => json!(world.forget_spot(&s(0), &s(1))),
        "forgetSpots" => {
            world.forget_spots();
            Value::Null
        }
        "noteDamage" => {
            world.note_damage(&s(0), blow_of(&a[1]));
            Value::Null
        }
        "noteSevere" => {
            world.note_severe(&s(0));
            Value::Null
        }
        "drainDamage" => to(&world.drain_damage()),
        "drainEntered" => to(&world.drain_entered()),
        "markStress" => to(&world.mark_stress(&s(0), n(1))),
        "markArmor" => json!(world.mark_armor(&s(0), n(1))),
        "clearArmor" => json!(world.clear_armor(&s(0), n(1))),
        "gainGoodFor" => json!(world.gain_good_for(&s(0), n(1))),
        "loseGood" => json!(world.lose_good(&s(0), n(1))),
        "damage" => json!(world.damage(&a[0], n(1), &bindings(3))),
        "heal" => json!(world.heal(&a[0], n(1), &bindings(2))),
        "healShared" => json!(world.heal_shared(&a[0], n(1), &bindings(2))),
        "slay" => json!(world.slay(&a[0], &bindings(1))),
        "revive" => json!(world.revive(&a[0], &bindings(1))),
        "setAttitude" => json!(world.state.set_attitude(&s(0), &s(1))),
        "endsOnHit" => json!(world.ends_on_hit(&s(0))),
        "endsOnDamage" => json!(world.ends_on_damage(&s(0))),
        "endsOnAttack" => json!(world.ends_on_attack(&s(0))),
        "endsOnRoll" => json!(world.ends_on_roll(&s(0))),
        "startCountdown" => {
            world.start_countdown(from(&a[0]));
            Value::Null
        }
        "advanceCountdowns" => to(&world.advance_countdowns(&cue_of(&a[0]), dice).expect("whole dice")),
        "reapCountdowns" => to(&world.reap_countdowns()),
        "endCreatureCountdowns" => {
            world.end_creature_countdowns();
            Value::Null
        }
        "dealDamage" => to(&world.deal_damage(&s(0), &from(&a[1]), dice)),
        "defend" => {
            let content = world.shared_content();
            let d = world.defend(&content, &s(0), &from(&a[1]), dice);
            let reactions: Vec<Value> = d
                .reactions
                .iter()
                .map(|r| {
                    let mut v = json!({ "ability": r.ability.id, "goodSpent": r.good_spent, "stressMarked": r.stress_marked });
                    if let Some(rolled) = r.rolled {
                        v["rolled"] = json!(rolled);
                    }
                    v
                })
                .collect();
            json!({ "resolved": d.resolved, "armorSlotsMarked": d.armor_slots_marked, "reactions": reactions, "goodSpent": d.good_spent, "stressMarked": d.stress_marked })
        }
        "attack" => to(&world.attack(&from(&a[0]), dice)),
        "rollReaction" => to(&world.roll_reaction(&s(0), n(1), &s(2), dice)),
        "summon" => to(&world.summon(&s(0), n(1), band(&a[2]))),
        "replace" => to(&world.replace(&s(0), n(1))),
        "drawIn" => to(&world.draw_in(&s(0), &s(1), band(&a[2]), band(&a[3]))),
        "drawTo" => to(&world.draw_to(&s(0), n(1) as i32, band(&a[2]), band(&a[3]))),
        "blinkTo" => to(&world.blink_to(&s(0), n(1) as i32, band(&a[2]))),
        "breakAway" => to(&world.break_away(&s(0), &s(1), band(&a[2]))),
        "pushBack" => to(&world.push_back(&s(0), &s(1), band(&a[2]))),
        "placeEntity" => {
            world.state.place_entity(&s(0), n(1), n(2)).expect("a creature in the room");
            Value::Null
        }
        "openInteractable" => {
            world.state.open_interactable(&s(0));
            Value::Null
        }
        "closeInteractable" => json!(world.state.close_interactable(&s(0))),
        "removeInteractable" => {
            world.state.remove_interactable(&s(0));
            Value::Null
        }
        "clearConditions" => json!(world.state.clear_conditions(&s(0)).into_iter().map(|(id, condition)| json!({ "id": id, "condition": condition })).collect::<Vec<_>>()),
        "roundTrip" => {
            let snapshot = world.scenario.snapshot();
            world.scenario.restore(&snapshot).expect("its own snapshot");
            Value::Null
        }
        "setFlag" => {
            world.set_flag(&s(0));
            Value::Null
        }
        "clearFlag" => {
            world.clear_flag(&s(0));
            Value::Null
        }
        "hasFlag" => json!(world.has_flag(&s(0))),
        "addItem" => json!(world.add_item(&s(0), n(1))),
        "removeItem" => json!(world.remove_item(&s(0), n(1))),
        "setVar" => {
            world.set_var(&s(0), a[1].clone());
            Value::Null
        }
        "getVar" => world.get_var(&s(0)),
        "grantLevel" => json!(world.grant_level(a[0].as_f64())),
        "startQuest" => json!(world.start_quest(&s(0))),
        "completeObjective" => json!(world.complete_objective(&s(0), &s(1))),
        "revealObjective" => json!(world.reveal_objective(&s(0), &s(1))),
        "completeQuest" => json!(world.complete_quest(&s(0))),
        "failQuest" => json!(world.fail_quest(&s(0))),
        "questStatus" => json!(world.quest_status(&s(0))),
        "objectiveDone" => json!(world.objective_done(&s(0), &s(1))),
        "startEncounter" => {
            world.start_encounter(&s(0));
            Value::Null
        }
        "hasCondition" => json!(world.has_condition(&s(0), &s(1))),
        "countAlive" => json!(world.count_alive(from::<Faction>(&a[0]))),
        "encounterState" => to(&world.encounter_state(&s(0))),
        "endEncounter" => {
            world.end_encounter(&s(0));
            Value::Null
        }
        "interactableState" => to(&world.interactable_state(&s(0))),
        "markInteractableUsed" => {
            world.mark_interactable_used(&s(0));
            Value::Null
        }
        "hasItem" => json!(world.has_item(&s(0), n(1))),
        "hasKey" => json!(ConditionContext::has_key(world, &s(0))),
        "itemCount" => json!(world.item_count(&s(0))),
        "loadoutDomain" => json!(world.loadout_domain(&s(0), &s(1))),
        "recallSpot" => json!(world.recall_spot(&s(0), &s(1))),
        "clearStress" => json!(world.clear_stress(&s(0), n(1))),
        "spendGood" => json!(world.spend_good(&s(0), n(1))),
        "traitValue" => json!(world.trait_value(&s(0), &s(1))),
        "spellcastValue" => json!(world.spellcast_value(&s(0))),
        "proficiencyOf" => json!(world.proficiency_of(&s(0))),
        "experiences" => json!(world.experiences()),
        "tileOf" => json!(world.tile_of(&s(0))),
        "heldBy" => ids_of(&world.held_by(&s(0))),
        "modifiersOf" => to(&world.modifiers_of(&s(0), s(1) == "pool", &bindings(2))),
        "rollBonus" => json!(world.roll_bonus(&s(0), from::<Stat>(&a[1]), a[2] == true)),
        "poolBonus" => json!(world.pool_bonus(&s(0), from::<Stat>(&a[1]))),
        "defensesOf" => defenses_json(&world.defenses_of(&s(0))),
        "defenderOf" => {
            let entity = world.state.entity(&s(0)).expect("a creature in the room").clone();
            let d = world.defender_of(&entity);
            let mut v = json!({ "difficulty": d.difficulty, "thresholds": d.thresholds });
            if let Some(defenses) = &d.defenses {
                v["defenses"] = defenses_json(defenses);
            }
            v
        }
        "advantageFor" => to(&world.advantage_for(&s(0), &s(1))),
        "advantageRolling" => to(&world.advantage_rolling()),
        "advantageAgainst" => to(&world.advantage_against(&from::<Vec<String>>(&a[0]))),
        "reactionsFor" => {
            let given: Option<TargetBindings> = (!a[2].is_null()).then(|| bindings(2));
            ids_of(&world.reactions_for(&s(0), &s(1), given.as_ref()).iter().collect::<Vec<_>>())
        }
        "standardAttackOf" => {
            let between: Option<(String, String)> = (!a[1].is_null()).then(|| (text(&a[1][0]).to_string(), text(&a[1][1]).to_string()));
            let swing = world.standard_attack_of(&s(0), between.as_ref().map(|(x, y)| (x.as_str(), y.as_str())));
            let mut v = serde_json::Map::new();
            if swing.direct {
                v.insert("direct".into(), json!(true));
            }
            if let Some(damage) = &swing.damage {
                v.insert("damage".into(), to(damage));
            }
            if swing.double {
                v.insert("double".into(), json!(true));
            }
            if let Some(severity) = swing.severity {
                v.insert("severity".into(), to(&severity));
            }
            Value::Object(v)
        }
        "abilitiesForAdversary" => ids_of(&world.abilities_for_adversary(&s(0))),
        "blocking" => json!(world.blocking(&s(0), from::<ConditionBlock>(&a[1]))),
        "armorFor" => to(&world.armor_for(&s(0))),
        "payoutsOn" => to(&world.payouts_on(&s(0), "attacked")),
        "armorAid" => to(&world.armor_aid(&s(0))),
        "insteadOfDeath" => to(&world.instead_of_death(&s(0))),
        "conditionName" => json!(world.condition_name(&s(0))),
        "weaponRange" => to(&world.weapon_range(&s(0))),
        "weaponDamage" => to(&world.weapon_damage(&s(0))),
        "tokenCount" => json!(world.token_count(&s(0), &s(1))),
        "goodDieSides" => json!(world.good_die_sides(&s(0))),
        "liftRoll" => json!(world.lift_roll(&s(0), &s(1), n(2), n(3), a[4] == true)),
        "answersRoll" => json!(world.answers_roll(&s(0), &a[1])),
        "checkModifier" => json!(world.check_modifier(&s(0), &s(1))),
        "resolveTargets" => json!(world.resolve_targets(&a[0], &bindings(1))),
        "nearestFirst" => json!(world.nearest_first(&s(0), &from::<Vec<String>>(&a[1]))),
        "alongPath" => json!(world.along_path(n(0) as i32, n(1) as i32, band(&a[2]), &from::<Vec<String>>(&a[3]))),
        "zoneFootprints" => to(&world.zone_footprints()),
        "marks" => to(&world.marks()),
        "countdowns" => to(&world.countdowns()),
        "poolValue" => json!(world.pool_value(&s(0), &s(1), &s(2))),
        "bandTo" => to(&world.band_to(&s(0), &s(1))),
        "bandBetween" => to(&world.band_between(n(0) as i32, n(1) as i32)),
        "difficultyOf" => json!(world.difficulty_of(&s(0))),
        "factionOf" => to(&world.faction_of(&s(0))),
        "bodyFree" => json!(world.state.body_free(n(0) as i32, &s(1))),
        "isOccupied" => json!(world.state.is_occupied(n(0) as i32)),
        "isOpen" => json!(world.state.is_open(&s(0))),
        other => panic!("no probe {other}"),
    }
}

#[test]
fn every_script_changes_the_world_as_the_typescript_did() {
    let runner_fixture = fixture("runner.json");
    let world_fixture = fixture("world.json");
    let runs = runner_fixture["runs"].as_array().unwrap();
    let worlds = world_fixture["runs"].as_array().unwrap();
    assert_eq!(runs.len(), worlds.len(), "the two fixtures were written together");
    let contents: HashMap<String, (Rc<WorldContent>, Vec<String>)> = world_fixture["contents"].as_object().unwrap().iter().map(|(key, spec)| {
        let (content, defined) = content_of(spec);
        (key.clone(), (Rc::new(content), defined))
    }).collect();
    let (mut steps_replayed, mut probes_asked) = (0, 0);
    for (run, played) in runs.iter().zip(worlds) {
        assert_eq!((&run["source"], &run["seed"]), (&played["source"], &played["seed"]), "the two fixtures were written together");
        let start = &world_fixture["starts"][played["start"].as_str().unwrap()];
        assert_eq!((&start["damaged"], &start["entered"]), (&json!([]), &json!([])), "a run begins with nothing waiting to be heard");
        let grid = &world_fixture["grids"][played["grid"].as_str().unwrap()];
        let (content, defined) = &contents[played["content"].as_str().unwrap()];
        let mut scenario = ScenarioState::default();
        scenario.restore(&start["scenario"]).expect("a scenario");
        let step: Shared = Rc::new(RefCell::new(Step { calls: VecDeque::new(), hooks: VecDeque::new(), at: String::new() }));
        let mut world = SceneScriptWorld::new(scene_of(grid, start), scenario, content.clone(), Rc::new(TapedHooks { defined: defined.clone(), step: step.clone() }));
        let spotlit: Vec<String> = from(&start["spotlit"]);
        world.spotlight_spent = Box::new(move |id| spotlit.iter().any(|s| s == id));
        let world = Rc::new(RefCell::new(world));

        let effects: Vec<Value> = from(&run["effects"]);
        let options: RunnerOptions = from(&run["options"]);
        let seed = run["seed"].as_str().unwrap();
        let mut rng = Rng::new(engine::rng::Seed::Text(&format!("{seed}:dice")));
        let mut host = Checked { world: world.clone(), step: step.clone() };
        let mut runner = ScriptRunner::new(&mut host, &mut rng, &options);
        let mut status = RunStatus::Done;
        let mut seen = 0;
        let mut was = standing(&world.borrow());
        let taped_steps = run["steps"].as_array().unwrap();
        let (hooks, changed) = (played["hooks"].as_array().unwrap(), played["changed"].as_array().unwrap());
        for (i, taped) in taped_steps.iter().enumerate() {
            let at = format!("{} ({seed}) step {i}: {}", run["source"], taped["move"]);
            *step.borrow_mut() = Step { calls: taped["calls"].as_array().unwrap().iter().cloned().collect(), hooks: hooks[i].as_array().unwrap().iter().cloned().collect(), at: at.clone() };
            let mv = &taped["move"];
            if mv["act"] == "run" {
                status = runner.run(&effects);
            } else {
                match runner.resume(&mv["response"]) {
                    Ok(next) => status = next,
                    Err(_) => assert_eq!(mv["threw"], true, "{at}: we refused to resume, the TypeScript did not"),
                }
            }
            assert!(step.borrow().calls.is_empty(), "{at}: the TypeScript also called {:?}", step.borrow().calls);
            assert!(step.borrow().hooks.is_empty(), "{at}: the TypeScript also ran {:?}", step.borrow().hooks);
            check!(status_json(&status, runner.entries(), seen), &taped["status"], "{at}");
            assert_eq!(json!(runner.stream()), taped["after"], "{at}: the dice stream");
            let now = standing(&world.borrow());
            check!(changes(&was, &now), &changed[i], "{at}: what the step changed");
            was = now;
            seen = runner.entries().len();
            steps_replayed += 1;
        }
        drop(runner);
        let at = format!("{} ({seed})", run["source"]);
        let mut world = world.borrow_mut();
        check!(to(&world.drain_damage()), &played["end"]["damaged"], "{at}: the blows waiting to be heard");
        check!(to(&world.drain_entered()), &played["end"]["entered"], "{at}: the crossings waiting to be heard");

        if played["probe"].is_null() {
            continue;
        }
        let mut dice = Rng::new(engine::rng::Seed::Text(&format!("{seed}:probe-dice")));
        for (i, asked) in played["probe"]["calls"].as_array().unwrap().iter().enumerate() {
            let call = text(&asked["call"]);
            let got = probe(&mut world, call, asked["args"].as_array().unwrap(), &mut dice);
            check!(got, &asked["answer"], "{at} probe {i}: {call} {}", asked["args"]);
            if let Some(after) = asked.get("after") {
                assert_eq!(&json!(dice.save()), after, "{at} probe {i}: the dice after {call}");
            }
            probes_asked += 1;
        }
        check!(world.state.snapshot(), &played["probe"]["after"]["scene"], "{at}: the scene after the probes");
        check!(world.scenario.snapshot(), &played["probe"]["after"]["scenario"], "{at}: the scenario after the probes");
    }
    assert!(steps_replayed > 1100, "{steps_replayed}");
    assert!(probes_asked > 15000, "{probes_asked}");
}
