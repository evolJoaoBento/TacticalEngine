//! Running a script (`src/engine/script/runner.ts`): a stack of effect lists walked one effect at a time,
//! stopping for the player - a choice, a check, a roll somebody can answer, a conversation - and resumed
//! with their answer. Every effect asks the world what it needs and tells it what happened, through
//! `ScriptWorld`, in the TypeScript's order; the dice the runner throws itself come off its own stream,
//! and the world draws from the same stream when it is handed it, so a seed replays the whole script.
//!
//! What happened is the journal, entries in the TypeScript's shapes. Effects are the JSON the script's
//! schema read; prompts and responses are JSON too, as the page sends and shows them.

use crate::grid::tile_grid::{Spot, NO_TILE};
use crate::js;
use crate::rng::Rng;
use crate::rules::damage::{roll_damage, CriticalRule, DamageRollOptions};
use crate::rules::dice::{format_dice, parse_dice, roll_dice, with_proficiency, DamageType, DiceExpression, ParsedDamage};
use crate::rules::duality::{roll_duality, with_faces, DualityRoll, DualityRollOptions, RollOutcome, BAD_DIE_SIDES, GOOD_DIE_SIDES};
use crate::scene::state::Faction;
use crate::script::conditions::{evaluate_optional, BoundRoll, ConditionContext, DiceHand, HookReads, TargetBindings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// How many options a `howMany` offers at most.
const HOW_MANY_LIMIT: f64 = 12.0;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LootDrop {
    pub item: String,
    pub quantity: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Advantage {
    pub advantage: f64,
    pub disadvantage: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StressMarked {
    pub stress_marked: f64,
    pub hp_marked: f64,
    pub fell: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefendedWith {
    pub name: String,
    pub good_spent: f64,
    pub stress_marked: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rolled: Option<f64>,
}

/// What one damage event did to one creature.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DealtDamage {
    pub incoming: f64,
    pub reduced: f64,
    pub hp_marked: f64,
    pub armor_slots_spent: f64,
    pub fell: bool,
    pub reactions: Vec<DefendedWith>,
}

/// An attack made from inside a script, as the world reports it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackSummary {
    pub refused: Option<String>,
    pub weapon: String,
    pub hit: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduced: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joined: Option<Vec<String>>,
    pub critical: bool,
    pub hit_points_marked: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roll: Option<DualityRoll>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage_dice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage_types: Option<Vec<DamageType>>,
    pub good_gained: f64,
    pub bad_gained: f64,
    pub stress_cleared: f64,
    pub spotlight_to_gm: bool,
}

/// A creature moved: from where, to where, and along what line when it walked.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Moved {
    pub from: i32,
    pub to: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<Vec<Spot>>,
}

/// Who arrived, who they replaced, or why nobody did.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Arrived {
    pub ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub was: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refused: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReactionRolled {
    pub success: bool,
    pub total: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roll: Option<DualityRoll>,
}

/// The last action roll, as a hook may read it.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct LastRoll {
    pub total: f64,
    pub critical: bool,
    pub outcome: RollOutcome,
}

/// What running a hook as an effect came to: what it queued, or why it failed.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HookRun {
    pub ok: bool,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub queued: Vec<Value>,
}

/// What the world must let a script do (`ScriptWorld`): its reads beyond a condition's, and its writes.
/// Implemented over the scene in the world's port; until then, over a recording.
pub trait ScriptWorld: ConditionContext {
    fn add_item(&mut self, item: &str, quantity: f64) -> f64;
    fn roll_loot(&mut self, table: Option<&str>, rng: &mut Rng) -> Vec<LootDrop>;
    fn remove_item(&mut self, item: &str, quantity: f64) -> f64;
    fn set_flag(&mut self, flag: &str);
    fn clear_flag(&mut self, flag: &str);
    fn give_key(&mut self, key: &str);
    fn set_var(&mut self, name: &str, value: &Value);
    fn open_interactable(&mut self, id: &str);
    fn close_interactable(&mut self, id: &str);
    fn remove_interactable(&mut self, id: &str);
    fn mark_interactable_used(&mut self, id: &str);
    fn start_encounter(&mut self, id: &str);
    fn end_encounter(&mut self, id: &str);
    fn damage(&mut self, target: &Value, amount: f64, source: Option<&str>, bindings: &TargetBindings) -> f64;
    fn heal(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64;
    fn heal_shared(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64;
    fn check_modifier(&mut self, trait_: &str, as_: &str) -> Option<f64>;
    fn advantage_rolling(&mut self) -> Advantage;
    fn advantage_against(&mut self, targets: &[String]) -> Advantage;
    fn lift_roll(&mut self, id: &str, trait_: &str, total: f64, difficulty: f64, critical: bool) -> f64;
    fn good_die_sides(&mut self, id: &str) -> u32;
    fn answers_roll(&mut self, id: &str, roll: &Value) -> bool;
    fn mark_spot(&mut self, actor: &str, mark: &str) -> bool;
    fn recall_spot(&mut self, actor: &str, mark: &str) -> i32;
    fn forget_spot(&mut self, actor: &str, mark: &str) -> bool;
    fn experiences(&mut self) -> Vec<Value>;
    fn difficulty_of(&mut self, id: &str) -> Option<f64>;
    fn grant_level(&mut self, level: Option<f64>) -> Option<f64>;
    fn gain_good(&mut self) -> bool;
    fn gain_bad(&mut self) -> bool;
    fn start_quest(&mut self, quest: &str) -> bool;
    fn complete_objective(&mut self, quest: &str, objective: &str) -> bool;
    fn reveal_objective(&mut self, quest: &str, objective: &str) -> bool;
    fn complete_quest(&mut self, quest: &str) -> bool;
    fn fail_quest(&mut self, quest: &str) -> bool;
    fn deal_damage(&mut self, id: &str, damage: &Value, rng: &mut Rng) -> DealtDamage;
    fn mark_stress(&mut self, id: &str, amount: f64) -> StressMarked;
    fn clear_stress(&mut self, id: &str, amount: f64) -> f64;
    fn clear_armor(&mut self, id: &str, amount: f64) -> f64;
    fn mark_armor(&mut self, id: &str, amount: f64) -> f64;
    fn gain_good_for(&mut self, id: &str, amount: f64) -> f64;
    fn spend_good(&mut self, id: &str, amount: f64) -> bool;
    fn lose_good(&mut self, id: &str, amount: f64) -> f64;
    fn apply_condition(&mut self, id: &str, condition: &str, duration: &str) -> bool;
    fn clear_condition(&mut self, id: &str, condition: &str) -> bool;
    fn revive(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String>;
    fn slay(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String>;
    fn set_attitude(&mut self, id: &str, attitude: &str) -> bool;
    fn proficiency_of(&mut self, id: &str) -> f64;
    fn add_tokens(&mut self, id: &str, ability: &str, amount: Option<f64>) -> f64;
    fn spend_tokens(&mut self, id: &str, ability: &str, amount: f64) -> f64;
    fn spellcast_value(&mut self, id: &str) -> Option<f64>;
    fn lose_bad(&mut self) -> bool;
    fn trait_value(&mut self, id: &str, trait_: &str) -> Option<f64>;
    fn weapon_damage(&mut self, id: &str) -> Option<ParsedDamage>;
    fn attack(&mut self, request: &Value, rng: &mut Rng) -> AttackSummary;
    fn push_back(&mut self, from: &str, target: &str, band: &str) -> Option<Moved>;
    fn draw_in(&mut self, mover: &str, toward: &str, band: &str, budget: Option<&str>) -> Option<Moved>;
    fn draw_to(&mut self, mover: &str, goal: i32, band: &str, budget: Option<&str>) -> Option<Moved>;
    fn blink_to(&mut self, mover: &str, goal: i32, band: Option<&str>) -> Option<Moved>;
    fn break_away(&mut self, mover: &str, from: &str, budget: Option<&str>) -> Option<Moved>;
    fn summon(&mut self, definition: &str, count: f64, range: &str) -> Arrived;
    fn start_countdown(&mut self, countdown: &Value);
    fn place_zone(&mut self, zone: &Value);
    fn end_zone(&mut self, id: &str) -> bool;
    fn refresh_zones(&mut self);
    fn tile_of(&mut self, id: &str) -> i32;
    fn spotlight_spent(&mut self, id: &str) -> bool;
    fn nearest_first(&mut self, from: &str, ids: &[String]) -> Vec<String>;
    fn replace(&mut self, definition: &str, count: f64) -> Arrived;
    fn roll_reaction(&mut self, id: &str, difficulty: f64, trait_: &str, rng: &mut Rng) -> ReactionRolled;
    /// Run a hook as an effect: it reads the scene, may throw dice off the stream, and queues effects.
    fn run_hook_effect(&mut self, id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: &mut Rng) -> HookRun;
}

/// What the caller hands a script: the thing it was started from, who and where it was aimed at, and
/// what it answers (`ScriptRunnerOptions`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerOptions {
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub targets: Option<Vec<String>>,
    #[serde(default)]
    pub point: Option<i32>,
    #[serde(default)]
    pub hit: Option<Vec<String>>,
    #[serde(default)]
    pub roll_as: Option<String>,
    #[serde(default)]
    pub counts: Option<Map<String, Value>>,
    #[serde(default)]
    pub last_damage: Option<LastDamageOption>,
    #[serde(default)]
    pub roll: Option<BoundRoll>,
    #[serde(default)]
    pub swing: Option<DualityRoll>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LastDamageOption {
    pub total: f64,
    #[serde(default)]
    pub types: Option<Vec<DamageType>>,
}

#[derive(Clone, Debug, PartialEq)]
struct LastDamage {
    total: f64,
    dice: String,
    types: Vec<DamageType>,
}

/// A check whose dice have been read and whose arms have not run yet.
#[derive(Clone, Debug, PartialEq)]
struct RolledCheck {
    roll: DualityRoll,
    targets: Vec<String>,
    difficulties: Vec<f64>,
}

#[derive(Clone, Debug)]
struct Pending {
    effect: Value,
    rolled: Option<RolledCheck>,
}

/// A list of effects part-way through, and what `hit` meant when it was pushed.
#[derive(Clone, Debug)]
struct Frame {
    effects: Vec<Value>,
    index: usize,
    hit: Option<Vec<String>>,
}

/// Where a script stands: done, or waiting on a prompt.
#[derive(Clone, Debug, PartialEq)]
pub enum RunStatus {
    Done,
    Waiting(Value),
}

const COUNT_NAMES: [&str; 3] = ["hitPointsTaken", "hitPointsDealt", "targetsHit"];

fn s<'v>(value: &'v Value, key: &str) -> Option<&'v str> {
    value.get(key).and_then(Value::as_str)
}

fn n(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn list(value: &Value, key: &str) -> Option<Vec<Value>> {
    value.get(key).and_then(Value::as_array).cloned()
}

fn selector(value: &Value, key: &str, default: &str) -> Value {
    value.get(key).cloned().unwrap_or_else(|| json!({ "kind": default }))
}

fn text(x: f64) -> String {
    js::number_to_string(x)
}

fn thrown(rng: &mut Rng, expression: &DiceExpression) -> f64 {
    roll_dice(rng, expression).expect("dice the schema let through roll").total
}

fn damage_total(rng: &mut Rng, expression: &DiceExpression, proficiency: f64, critical: bool) -> (f64, DiceExpression) {
    let rolled = roll_damage(rng, expression, &DamageRollOptions { proficiency, critical, critical_rule: CriticalRule::MaxDicePlusRoll, bonus: 0.0 }).expect("dice the schema let through roll");
    (rolled.total, rolled.expression)
}

/// Read an amount the way the script reads one: a number, a count kept, or a read of the scene.
fn amount_of<W: ScriptWorld + ?Sized>(world: &mut W, rng: &mut Rng, bindings: &TargetBindings, hit: &[String], counts: &[f64; 3], amount: Option<&Value>, fallback: f64) -> f64 {
    let Some(amount) = amount else { return fallback };
    if let Some(x) = amount.as_f64() {
        return x;
    }
    if amount.is_object() {
        if let Some(count) = amount.get("count") {
            return world.resolve_targets(count, bindings).len() as f64;
        }
        if let Some(dice) = s(amount, "dice") {
            let actor = world.actor_id();
            let Some(parsed) = parse_dice(dice) else { return 0.0 };
            let expression = match (s(amount, "using"), &actor) {
                (Some("proficiency"), Some(actor)) => with_proficiency(&parsed.expression, world.proficiency_of(actor)),
                _ => parsed.expression,
            };
            let roll = roll_dice(rng, &expression).expect("dice the schema let through roll");
            return if s(amount, "pick") == Some("highest") {
                roll.rolls.iter().max().map_or(0.0, |&top| f64::from(top) + expression.modifier)
            } else {
                roll.total
            };
        }
        let Some(who) = world.resolve_targets(&selector(amount, "of", "actor"), bindings).into_iter().next() else { return 0.0 };
        if let Some(tokens) = s(amount, "tokens") {
            return world.tokens_on(&who, tokens);
        }
        if let Some(trait_) = s(amount, "trait") {
            return world.trait_value(&who, trait_).unwrap_or(0.0) * n(amount, "times").unwrap_or(1.0);
        }
        return world.pool_value(&who, s(amount, "pool").unwrap_or_default(), s(amount, "measure").unwrap_or("marked")).unwrap_or(0.0);
    }
    match amount.as_str() {
        Some("targetsHit") => hit.len() as f64,
        Some("spent") => 0.0,
        Some(name) => COUNT_NAMES.iter().position(|c| *c == name).map_or(0.0, |i| counts[i]),
        None => fallback,
    }
}

/// The world and the runner's dice, as a condition gate reads them: every read the world's own, `chance`
/// thrown off the runner's stream, an amount read as the runner reads one.
struct Gate<'g, W: ScriptWorld + ?Sized> {
    world: &'g mut W,
    rng: &'g mut Rng,
    bindings: TargetBindings,
    hit: &'g [String],
    counts: &'g [f64; 3],
}

impl<W: ScriptWorld + ?Sized> DiceHand for Gate<'_, W> {
    fn roll(&mut self, dice: &str) -> f64 {
        parse_dice(dice).map_or(0.0, |parsed| thrown(self.rng, &parsed.expression))
    }

    fn amount(&mut self, amount: &Value) -> f64 {
        amount_of(self.world, self.rng, &self.bindings, self.hit, self.counts, Some(amount), 0.0)
    }
}

impl<W: ScriptWorld + ?Sized> ConditionContext for Gate<'_, W> {
    fn has_flag(&mut self, flag: &str) -> bool {
        self.world.has_flag(flag)
    }
    fn has_key(&mut self, key: &str) -> bool {
        self.world.has_key(key)
    }
    fn has_item(&mut self, item: &str, quantity: f64) -> bool {
        self.world.has_item(item, quantity)
    }
    fn get_var(&mut self, name: &str) -> Value {
        self.world.get_var(name)
    }
    fn interactable_state(&mut self, id: &str) -> crate::script::conditions::InteractableState {
        self.world.interactable_state(id)
    }
    fn encounter_state(&mut self, id: &str) -> crate::scene::state::EncounterState {
        self.world.encounter_state(id)
    }
    fn count_alive(&mut self, faction: Faction) -> f64 {
        self.world.count_alive(faction)
    }
    fn quest_status(&mut self, quest: &str) -> String {
        self.world.quest_status(quest)
    }
    fn objective_done(&mut self, quest: &str, objective: &str) -> bool {
        self.world.objective_done(quest, objective)
    }
    fn actor_id(&mut self) -> Option<String> {
        self.world.actor_id()
    }
    fn resolve_targets(&mut self, selector: &Value, bindings: &TargetBindings) -> Vec<String> {
        self.world.resolve_targets(selector, bindings)
    }
    fn in_combat(&mut self) -> bool {
        self.world.in_combat()
    }
    fn loadout_domain(&mut self, id: &str, domain: &str) -> Option<f64> {
        self.world.loadout_domain(id, domain)
    }
    fn has_condition(&mut self, id: &str, condition: &str) -> bool {
        self.world.has_condition(id, condition)
    }
    fn pool_value(&mut self, id: &str, pool: &str, measure: &str) -> Option<f64> {
        self.world.pool_value(id, pool, measure)
    }
    fn band_to(&mut self, from: &str, to: &str) -> Option<crate::rules::range::RangeBand> {
        self.world.band_to(from, to)
    }
    fn faction_of(&mut self, id: &str) -> Option<Faction> {
        self.world.faction_of(id)
    }
    fn hook_defined(&mut self, id: &str) -> bool {
        self.world.hook_defined(id)
    }
    fn run_hook(&mut self, id: &str, reads: &HookReads) -> bool {
        self.world.run_hook(id, reads)
    }
    fn tokens_on(&mut self, id: &str, ability: &str) -> f64 {
        self.world.tokens_on(id, ability)
    }
}

/// `answered`: a `howMany` option's effects with its number written in - `{n}` in every string, and an
/// `amount` or `times` of `spent` made the number itself.
fn answered(value: &Value, key: &str, n: f64) -> Value {
    match value {
        Value::String(text) if (key == "amount" || key == "times") && text == "spent" => json!(n),
        Value::String(text) => Value::String(text.replace("{n}", &js::number_to_string(n))),
        Value::Array(items) => Value::Array(items.iter().map(|item| answered(item, key, n)).collect()),
        Value::Object(fields) => Value::Object(fields.iter().map(|(k, v)| (k.clone(), answered(v, k, n))).collect()),
        other => other.clone(),
    }
}

/// `outcomeEffects`: the arm a check's outcome runs, falling back to its neighbour when unwritten.
fn outcome_effects(check: &Value, outcome: RollOutcome) -> Vec<Value> {
    let order: [&str; 3] = match outcome {
        RollOutcome::CriticalSuccess => ["onCriticalSuccess", "onSuccessWithGood", "onSuccessWithBad"],
        RollOutcome::SuccessWithGood => ["onSuccessWithGood", "onSuccessWithBad", ""],
        RollOutcome::SuccessWithBad => ["onSuccessWithBad", "onSuccessWithGood", ""],
        RollOutcome::FailureWithGood => ["onFailureWithGood", "onFailureWithBad", ""],
        RollOutcome::FailureWithBad => ["onFailureWithBad", "onFailureWithGood", ""],
    };
    order.iter().find_map(|key| list(check, key)).unwrap_or_default()
}

pub struct ScriptRunner<'a, W: ScriptWorld + ?Sized> {
    world: &'a mut W,
    rng: &'a mut Rng,
    journal: Vec<Value>,
    stack: Vec<Frame>,
    pending: Option<Pending>,
    subject: Option<String>,
    targets: Vec<String>,
    roll_as: String,
    /// The creatures the last roll beat.
    hit: Vec<String>,
    /// The last action roll made, for a critical's extra damage and `difficulty: 'roll'`.
    last_roll: Option<DualityRoll>,
    /// The last damage rolled in this script, for `dice: 'same'`.
    last_damage: Option<LastDamage>,
    counts: [f64; 3],
    /// The roll that called for this script, when something did.
    answering: Option<BoundRoll>,
    /// The tile this script was aimed at, or `NO_TILE`.
    point: i32,
    /// Whether any action roll in this script hands the spotlight to the GM.
    pub spotlight_to_gm: bool,
    /// Whether an action roll was made at all.
    pub rolled: bool,
    /// Whether a roll or choice it asked for was declined.
    pub cancelled: bool,
    /// "Then place this card in your vault": whether this script said so.
    pub vaulted: bool,
}

impl<'a, W: ScriptWorld + ?Sized> ScriptRunner<'a, W> {
    pub fn new(world: &'a mut W, rng: &'a mut Rng, options: &RunnerOptions) -> Self {
        let mut counts = [0.0; 3];
        for (i, name) in COUNT_NAMES.iter().enumerate() {
            counts[i] = options.counts.as_ref().and_then(|c| c.get(*name)).and_then(Value::as_f64).unwrap_or(0.0);
        }
        ScriptRunner {
            world,
            rng,
            journal: Vec::new(),
            stack: Vec::new(),
            pending: None,
            subject: options.subject.clone(),
            targets: options.targets.clone().unwrap_or_default(),
            roll_as: options.roll_as.clone().unwrap_or_else(|| "party".into()),
            hit: options.hit.clone().unwrap_or_default(),
            last_roll: options.swing.clone(),
            last_damage: options.last_damage.as_ref().map(|d| LastDamage { total: d.total, dice: String::new(), types: d.types.clone().unwrap_or_default() }),
            counts,
            answering: options.roll.clone(),
            point: options.point.unwrap_or(NO_TILE),
            spotlight_to_gm: false,
            rolled: false,
            cancelled: false,
            vaulted: false,
        }
    }

    /// Everything that has happened so far.
    pub fn entries(&self) -> &[Value] {
        &self.journal
    }

    /// The last action roll this script made, for a caller that reuses it.
    pub fn last_action_roll(&self) -> Option<&DualityRoll> {
        self.last_roll.as_ref()
    }

    /// Where the runner's dice stream stands, for a save or a replay to keep its place.
    pub fn stream(&self) -> crate::rng::RngState {
        self.rng.save()
    }

    /// Start a script. Returns as soon as it finishes or needs an answer.
    pub fn run(&mut self, effects: &[Value]) -> RunStatus {
        self.stack.push(Frame { effects: effects.to_vec(), index: 0, hit: None });
        self.step()
    }

    /// Answer the outstanding prompt and continue. `Err` when nothing was waiting.
    pub fn resume(&mut self, response: &Value) -> Result<RunStatus, String> {
        let Some(waiting) = self.pending.take() else { return Err("resume() was called while the script was not waiting for anything".into()) };
        match s(&waiting.effect, "kind") {
            Some("choice") => self.apply_choice(&waiting.effect["options"], response),
            Some("check") => {
                let check = waiting.effect["check"].clone();
                match waiting.rolled {
                    Some(rolled) => self.settle_check(&check, rolled, Some(response)),
                    None => {
                        if let Some(again) = self.apply_check(&check, response) {
                            return Ok(RunStatus::Waiting(again));
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(self.step())
    }

    /// What `target` and `hit` mean right now.
    pub fn bindings(&self) -> TargetBindings {
        let mut counts = Map::new();
        counts.insert("hitPointsTaken".into(), json!(self.counts[0]));
        counts.insert("hitPointsDealt".into(), json!(self.counts[1]));
        counts.insert("targetsHit".into(), json!(self.hit.len()));
        TargetBindings {
            targets: self.targets.clone(),
            hit: self.hit.clone(),
            counts: Some(counts),
            roll: self.answering.clone(),
            point: (self.point != NO_TILE).then_some(self.point),
        }
    }

    fn resolve(&mut self, selector: &Value) -> Vec<String> {
        let bindings = self.bindings();
        self.world.resolve_targets(selector, &bindings)
    }

    fn amount(&mut self, amount: Option<&Value>, fallback: f64) -> f64 {
        let bindings = self.bindings();
        amount_of(self.world, self.rng, &bindings, &self.hit, &self.counts, amount, fallback)
    }

    fn holds(&mut self, condition: Option<&Value>) -> bool {
        let bindings = self.bindings();
        let mut gate = Gate { world: &mut *self.world, rng: &mut *self.rng, bindings: bindings.clone(), hit: &self.hit, counts: &self.counts };
        evaluate_optional(condition, &mut gate, &bindings, true)
    }

    fn refuse(&mut self, reason: String) -> Option<Value> {
        self.journal.push(json!({ "kind": "refused", "reason": reason }));
        None
    }

    fn push(&mut self, effects: Vec<Value>, hit: Option<Vec<String>>) {
        self.stack.push(Frame { effects, index: 0, hit });
    }

    fn apply_choice(&mut self, options: &Value, response: &Value) {
        if s(response, "kind") != Some("choose") {
            // Cancelling a choice picks nothing; the caller may put the card back.
            if s(response, "kind") == Some("cancel") {
                self.cancelled = true;
            }
            return;
        }
        let index = response["index"].as_f64().unwrap_or(f64::NAN);
        let option = options.as_array().and_then(|all| (index >= 0.0 && index.fract() == 0.0).then(|| all.get(index as usize)).flatten()).cloned();
        let Some(option) = option else { return };
        if !self.holds(option.get("available")) {
            return;
        }
        self.journal.push(json!({ "kind": "chose", "label": option["label"], "index": response["index"] }));
        self.push(list(&option, "effects").unwrap_or_default(), None);
    }

    /// `roll: 'last'`: the last action roll read again against this check's targets.
    fn reuse_roll(&mut self, check: &Value) -> Option<Value> {
        let Some(roll) = self.last_roll.clone() else { return self.refuse("no roll to reuse".into()) };
        let targets = match check.get("targets") {
            None => self.targets.clone(),
            Some(selector) => self.resolve(selector),
        };
        let beats = |difficulty: f64| roll.critical || roll.total >= difficulty;
        let hit: Vec<String> = if check["difficulty"] == "target" {
            let mut hit = Vec::new();
            for id in &targets {
                if beats(self.world.difficulty_of(id).unwrap_or(f64::INFINITY)) {
                    hit.push(id.clone());
                }
            }
            hit
        } else if beats(check["difficulty"].as_f64().unwrap_or(f64::INFINITY)) {
            targets.clone()
        } else {
            Vec::new()
        };
        let outcome = if !hit.is_empty() || targets.is_empty() {
            roll.outcome
        } else if roll.good > roll.bad {
            RollOutcome::FailureWithGood
        } else {
            RollOutcome::FailureWithBad
        };
        self.hit = hit.clone();
        self.journal.push(json!({ "kind": "check", "outcome": outcome, "roll": roll, "targets": targets, "hit": hit, "reused": true }));
        if let Some(always) = list(check, "always") {
            self.push(always, Some(hit.clone()));
        }
        self.push(outcome_effects(check, outcome), Some(hit));
        None
    }

    fn apply_check(&mut self, check: &Value, response: &Value) -> Option<Value> {
        if s(response, "kind") != Some("roll") {
            if s(response, "kind") == Some("cancel") {
                self.cancelled = true;
            }
            return None;
        }
        let trait_ = s(check, "trait").unwrap_or_default().to_string();
        let roll_as = self.roll_as.clone();
        let Some(base) = self.world.check_modifier(&trait_, &roll_as) else {
            return self.refuse(format!("no {trait_} trait to roll with"));
        };
        let mut modifier = base;

        // Utilize an Experience: a Light for its modifier, before the dice.
        let actor = self.world.actor_id();
        if let Some(wanted) = s(response, "experience") {
            let found = self.world.experiences().into_iter().find(|e| s(e, "name") == Some(wanted));
            if let (Some(found), Some(actor)) = (found, &actor) {
                if self.world.spend_good(actor, 1.0) {
                    modifier += n(&found, "modifier").unwrap_or(0.0);
                    self.journal.push(json!({ "kind": "goodSpent", "amount": 1 }));
                    self.journal.push(json!({ "kind": "experience", "name": found["name"], "modifier": found["modifier"] }));
                }
            }
        }

        // One roll, however many targets: against targets, the lowest Difficulty decides success and
        // each is beaten on its own number; against a fixed one, they stand or fall together.
        let targets = match check.get("targets") {
            None => self.targets.clone(),
            Some(selector) => self.resolve(selector),
        };
        let difficulties: Vec<f64> = if check["difficulty"] == "target" {
            targets.iter().map(|id| self.world.difficulty_of(id).unwrap_or(f64::INFINITY)).collect()
        } else {
            vec![check["difficulty"].as_f64().unwrap_or(f64::INFINITY)]
        };
        let difficulty = difficulties.iter().copied().fold(f64::INFINITY, js::min);

        let carried = self.world.advantage_rolling();
        let aimed = self.world.advantage_against(&targets);
        let net = n(response, "advantage").unwrap_or(0.0) - n(response, "disadvantage").unwrap_or(0.0) + carried.advantage - carried.disadvantage + aimed.advantage - aimed.disadvantage;
        let good_die_sides = actor.as_ref().map(|actor| self.world.good_die_sides(actor));
        let rolled = roll_duality(
            self.rng,
            &DualityRollOptions {
                difficulty,
                modifier: Some(modifier),
                good_die_sides,
                advantage: (net > 0.0).then_some(net),
                disadvantage: (net < 0.0).then_some(-net),
                help_dice: n(response, "helpDice"),
                reaction: None,
            },
        )
        .expect("the Duality Dice roll");
        // What the roller's own cards put behind a roll that has been read and not yet decided anything.
        let lifted = match &actor {
            None => 0.0,
            Some(actor) => self.world.lift_roll(actor, &trait_, rolled.total, difficulty, rolled.critical),
        };
        let roll = if lifted == 0.0 { rolled } else { with_faces(&DualityRoll { modifier: rolled.modifier + lifted, ..rolled }, None, None) };
        if lifted > 0.0 {
            self.journal.push(json!({ "kind": "lifted", "by": lifted, "total": roll.total }));
        }

        // And the moment somebody else can reach it, only when a card that answers a roll is in a hand.
        let stopped = RolledCheck { roll: roll.clone(), targets: targets.clone(), difficulties };
        let mut said = Map::new();
        if let Some(tags) = check.get("tags") {
            said.insert("tags".into(), tags.clone());
        }
        said.insert("trait".into(), json!(trait_));
        if let Some(actor) = &actor {
            let mut asked = said.clone();
            asked.insert("total".into(), json!(roll.total));
            asked.insert("outcome".into(), json!(roll.outcome));
            if self.world.answers_roll(actor, &Value::Object(asked)) {
                self.pending = Some(Pending { effect: json!({ "kind": "check", "check": check }), rolled: Some(stopped) });
                let mut prompt = said;
                prompt.insert("kind".into(), json!("rolled"));
                prompt.insert("roll".into(), json!(roll));
                prompt.insert("targets".into(), json!(targets));
                return Some(Value::Object(prompt));
            }
        }
        self.settle_check(check, stopped, None);
        None
    }

    /// A check's dice settled - rerolled, raised or named by whoever answered - and its arms pushed.
    fn settle_check(&mut self, check: &Value, stopped: RolledCheck, response: Option<&Value>) {
        let RolledCheck { targets, difficulties, mut roll } = stopped;
        let answered = response.filter(|r| s(r, "kind") == Some("answered"));
        if let Some(which) = answered.and_then(|r| s(r, "reroll")) {
            let good = (which != "bad").then(|| self.rng.die(roll.good_sides.unwrap_or(GOOD_DIE_SIDES)).expect("a die"));
            let bad = (which != "good").then(|| self.rng.die(BAD_DIE_SIDES).expect("a die"));
            roll = with_faces(&roll, good, bad);
            self.journal.push(json!({ "kind": "dualityRerolled", "which": which }));
        }
        // A number put behind it goes on before a named total, which then only makes up what is short.
        if let Some(raise) = answered.and_then(|r| n(r, "raise")).filter(|&raise| raise > 0.0) {
            roll = with_faces(&DualityRoll { modifier: roll.modifier + raise, ..roll }, None, None);
            self.journal.push(json!({ "kind": "lifted", "by": raise, "total": roll.total }));
        }
        if answered.is_some_and(|r| r["name"] == true) && !roll.success {
            roll = with_faces(&DualityRoll { modifier: roll.modifier + (roll.difficulty - roll.total), ..roll }, None, None);
            self.journal.push(json!({ "kind": "rollNamed", "total": roll.total }));
        }
        let hit: Vec<String> = if check["difficulty"] == "target" {
            targets.iter().zip(&difficulties).filter(|(_, &d)| roll.critical || roll.total >= d).map(|(id, _)| id.clone()).collect()
        } else if roll.success {
            targets.clone()
        } else {
            Vec::new()
        };
        self.hit = hit.clone();
        self.last_roll = Some(roll.clone());
        self.rolled = true;
        self.spotlight_to_gm = self.spotlight_to_gm || roll.spotlight_to_gm;
        self.journal.push(json!({ "kind": "check", "outcome": roll.outcome, "roll": roll, "targets": targets, "hit": hit }));

        // The core loop: a roll with Light hands the roller a Light, one with Shadow the GM a Shadow, and a
        // critical clears a Stress - from whoever is acting when the dice are settled.
        if roll.good_gained > 0 && self.world.gain_good() {
            self.journal.push(json!({ "kind": "good", "gained": roll.good_gained }));
        }
        if roll.bad_gained > 0 && self.world.gain_bad() {
            self.journal.push(json!({ "kind": "bad", "gained": roll.bad_gained }));
        }
        let roller = self.world.actor_id();
        if roll.stress_cleared > 0 {
            if let Some(roller) = roller {
                let cleared = self.world.clear_stress(&roller, f64::from(roll.stress_cleared));
                if cleared > 0.0 {
                    self.journal.push(json!({ "kind": "stress", "id": roller, "marked": 0, "cleared": cleared, "hitPoints": 0 }));
                }
            }
        }
        // `always` runs after the outcome branch, so it is pushed first.
        if let Some(always) = list(check, "always") {
            self.push(always, Some(hit.clone()));
        }
        self.push(outcome_effects(check, roll.outcome), Some(hit));
    }

    /// Effects that can move somebody, after which what everybody bears must match where they stand.
    fn moves(effect: &Value) -> bool {
        matches!(s(effect, "kind"), Some("move" | "push" | "summon" | "replace" | "attack"))
    }

    fn step(&mut self) -> RunStatus {
        while let Some(frame) = self.stack.last_mut() {
            if frame.index >= frame.effects.len() {
                self.stack.pop();
                continue;
            }
            // A frame pushed with its own `hit` reads that list, however the roll after it went.
            if let Some(hit) = &frame.hit {
                self.hit = hit.clone();
            }
            let effect = frame.effects[frame.index].clone();
            frame.index += 1;
            let prompt = self.apply(&effect);
            if Self::moves(&effect) {
                self.world.refresh_zones();
            }
            if let Some(prompt) = prompt {
                self.pending = Some(Pending { effect, rolled: None });
                return RunStatus::Waiting(prompt);
            }
        }
        RunStatus::Done
    }

    fn apply_thing(&mut self, effect: &Value, kind: &str) -> Option<Value> {
        if kind == "teleport" {
            self.journal.push(json!({ "kind": "teleport", "pair": effect["pair"], "from": self.subject }));
            return None;
        }
        // No id means whatever the script was started from; nothing started it, nothing happens.
        let id = s(effect, "interactable").map(str::to_string).or_else(|| self.subject.clone())?;
        match kind {
            "openContainer" => self.journal.push(json!({ "kind": "openContainer", "id": id })),
            "remove" => {
                self.world.remove_interactable(&id);
                self.journal.push(json!({ "kind": "interactable", "id": id, "change": "removed" }));
            }
            "markUsed" => {
                self.world.mark_interactable_used(&id);
                self.journal.push(json!({ "kind": "interactable", "id": id, "change": "used" }));
            }
            _ => {
                let opening = kind == "open" || (kind == "toggleOpen" && !self.world.interactable_state(&id).open);
                if opening {
                    self.world.open_interactable(&id);
                    self.journal.push(json!({ "kind": "interactable", "id": id, "change": "open" }));
                } else {
                    self.world.close_interactable(&id);
                    // It will not shut on somebody standing in it, and says so.
                    if self.world.interactable_state(&id).open {
                        self.journal.push(json!({ "kind": "log", "text": "It will not shut with somebody in the way.", "tone": "system" }));
                    } else {
                        self.journal.push(json!({ "kind": "interactable", "id": id, "change": "closed" }));
                    }
                }
            }
        }
        None
    }

    fn quest_started(&mut self, quest: &str) {
        if self.world.start_quest(quest) {
            self.journal.push(json!({ "kind": "quest", "quest": quest, "change": "started" }));
        }
    }

    /// Run one effect. Returns a prompt when it needs the player.
    fn apply(&mut self, effect: &Value) -> Option<Value> {
        let kind = s(effect, "kind").unwrap_or_default().to_string();
        match kind.as_str() {
            "none" => None,
            "log" => {
                self.journal.push(json!({ "kind": "log", "text": effect["text"], "tone": s(effect, "tone").unwrap_or("narration") }));
                None
            }
            "story" => {
                self.journal.push(json!({ "kind": "story", "title": effect["title"], "paragraphs": effect["paragraphs"], "button": s(effect, "button").unwrap_or("Continue") }));
                None
            }
            "setFlag" | "clearFlag" => {
                let flag = s(effect, "flag").unwrap_or_default();
                if kind == "setFlag" {
                    self.world.set_flag(flag);
                } else {
                    self.world.clear_flag(flag);
                }
                self.journal.push(json!({ "kind": "flag", "flag": flag, "set": kind == "setFlag" }));
                None
            }
            "giveKey" => {
                self.world.give_key(s(effect, "key").unwrap_or_default());
                self.journal.push(json!({ "kind": "key", "key": effect["key"] }));
                None
            }
            "levelUp" => {
                if let Some(reached) = self.world.grant_level(n(effect, "level")) {
                    self.journal.push(json!({ "kind": "levelUp", "level": reached }));
                }
                None
            }
            "startQuest" => {
                self.quest_started(s(effect, "quest").unwrap_or_default());
                None
            }
            "completeObjective" | "revealObjective" => {
                // Ticking a step off a quest nobody started starts it.
                let (quest, objective) = (s(effect, "quest").unwrap_or_default(), s(effect, "objective").unwrap_or_default());
                self.quest_started(quest);
                let done = if kind == "completeObjective" { self.world.complete_objective(quest, objective) } else { self.world.reveal_objective(quest, objective) };
                if done {
                    self.journal.push(json!({ "kind": if kind == "completeObjective" { "objective" } else { "revealed" }, "quest": quest, "objective": objective }));
                }
                None
            }
            "completeQuest" | "failQuest" => {
                let quest = s(effect, "quest").unwrap_or_default();
                let done = if kind == "completeQuest" { self.world.complete_quest(quest) } else { self.world.fail_quest(quest) };
                if done {
                    self.journal.push(json!({ "kind": "quest", "quest": quest, "change": if kind == "completeQuest" { "completed" } else { "failed" } }));
                }
                None
            }
            "addItem" => {
                let quantity = n(effect, "quantity").unwrap_or(1.0);
                self.world.add_item(s(effect, "item").unwrap_or_default(), quantity);
                self.journal.push(json!({ "kind": "item", "item": effect["item"], "change": quantity }));
                None
            }
            "removeItem" => {
                // What actually went, not what was asked for.
                let taken = self.world.remove_item(s(effect, "item").unwrap_or_default(), n(effect, "quantity").unwrap_or(1.0));
                self.journal.push(json!({ "kind": "item", "item": effect["item"], "change": -taken }));
                None
            }
            "setVar" => {
                self.world.set_var(s(effect, "name").unwrap_or_default(), &effect["value"]);
                self.journal.push(json!({ "kind": "var", "name": effect["name"], "value": effect["value"] }));
                None
            }
            "addVar" => {
                let name = s(effect, "name").unwrap_or_default();
                let current = self.world.get_var(name);
                let next = current.as_f64().filter(|_| current.is_number()).unwrap_or(0.0) + n(effect, "by").unwrap_or(0.0);
                self.world.set_var(name, &json!(next));
                self.journal.push(json!({ "kind": "var", "name": name, "value": next }));
                None
            }
            "open" | "close" | "toggleOpen" | "remove" | "markUsed" | "openContainer" | "teleport" => self.apply_thing(effect, &kind),
            "loot" => {
                let table = s(effect, "table");
                let found = self.world.roll_loot(table, self.rng);
                for drop in &found {
                    self.world.add_item(&drop.item, drop.quantity);
                }
                let mut entry = json!({ "kind": "loot", "found": found });
                if let Some(table) = table {
                    entry["table"] = json!(table);
                }
                self.journal.push(entry);
                None
            }
            "damage" => {
                if effect.get("dice").is_none() {
                    self.apply_flat_damage(effect)
                } else {
                    self.apply_rolled_damage(effect)
                }
            }
            "heal" => {
                // Rolled once, then the same number for each, the way rolled damage lands one total.
                let amount = match effect.get("amount") {
                    Some(amount) => self.amount(Some(amount), 1.0),
                    None => {
                        let dice = s(effect, "dice").unwrap_or_default();
                        let Some(parsed) = parse_dice(dice) else { return self.refuse(format!("cannot read healing dice \"{dice}\"")) };
                        js::max(1.0, damage_total(self.rng, &parsed.expression, 1.0, false).0)
                    }
                };
                // A count that came to nothing clears nothing, and says nothing.
                if amount <= 0.0 {
                    return None;
                }
                let healed = selector(effect, "target", "actor");
                let bindings = self.bindings();
                let spread = effect["spread"] == true;
                let cleared = if spread { self.world.heal_shared(&healed, amount, &bindings) } else { self.world.heal(&healed, amount, &bindings) };
                let ids = self.resolve(&healed);
                let mut entry = json!({ "kind": "heal", "amount": amount, "cleared": cleared, "ids": ids });
                if spread {
                    entry["spread"] = json!(true);
                }
                self.journal.push(entry);
                None
            }
            "startEncounter" => {
                self.world.start_encounter(s(effect, "encounter").unwrap_or_default());
                let mut entry = json!({ "kind": "encounter", "id": effect["encounter"], "change": "started" });
                if let Some(intro) = effect.get("intro") {
                    entry["intro"] = intro.clone();
                }
                self.journal.push(entry);
                None
            }
            "endEncounter" => {
                self.world.end_encounter(s(effect, "encounter").unwrap_or_default());
                self.journal.push(json!({ "kind": "encounter", "id": effect["encounter"], "change": "ended" }));
                None
            }
            "goto" => {
                self.journal.push(json!({ "kind": "goto", "scene": effect["scene"] }));
                None
            }
            "startDialogue" => {
                // A conversation stops the script, like a choice; the caller plays it out and resumes.
                self.journal.push(json!({ "kind": "dialogue", "dialogue": effect["dialogue"] }));
                Some(json!({ "kind": "dialogue", "dialogue": effect["dialogue"] }))
            }
            "branch" => {
                let taken = if self.holds(effect.get("when")) { list(effect, "then") } else { list(effect, "otherwise") };
                if let Some(taken) = taken.filter(|t| !t.is_empty()) {
                    self.push(taken, None);
                }
                None
            }
            "choice" => {
                let mut options = Vec::new();
                for (index, option) in effect["options"].as_array().into_iter().flatten().enumerate() {
                    if self.holds(option.get("available")) {
                        let mut shown = json!({ "index": index, "label": option["label"] });
                        if let Some(detail) = option.get("detail") {
                            shown["detail"] = detail.clone();
                        }
                        options.push(shown);
                    }
                }
                // A choice with nothing to choose is simply skipped.
                if options.is_empty() {
                    return None;
                }
                let mut prompt = json!({ "kind": "choice", "options": options });
                for key in ["title", "body"] {
                    if let Some(value) = effect.get(key) {
                        prompt[key] = value.clone();
                    }
                }
                Some(prompt)
            }
            "check" => {
                let check = &effect["check"];
                if check["roll"] == "last" {
                    return self.reuse_roll(check);
                }
                let trait_ = s(check, "trait").unwrap_or_default();
                let roll_as = self.roll_as.clone();
                // A roll the actor cannot make is refused here, before a prompt that could only be declined.
                let Some(modifier) = self.world.check_modifier(trait_, &roll_as) else { return self.refuse(format!("no {trait_} trait to roll with")) };
                let targets = match check.get("targets") {
                    None => self.targets.clone(),
                    Some(selector) => self.resolve(selector),
                };
                let mut prompt = json!({ "kind": "check", "trait": trait_, "difficulty": check["difficulty"], "modifier": modifier });
                if let Some(said) = check.get("prompt") {
                    prompt["prompt"] = said.clone();
                }
                prompt["targets"] = json!(targets);
                prompt["experiences"] = json!(self.world.experiences());
                Some(prompt)
            }
            "markStress" | "clearStress" => {
                let amount = self.amount(effect.get("amount"), 1.0);
                if amount <= 0.0 {
                    return None;
                }
                for id in self.resolve(&selector(effect, "target", "actor")) {
                    if kind == "markStress" {
                        let result = self.world.mark_stress(&id, amount);
                        self.journal.push(json!({ "kind": "stress", "id": id, "marked": result.stress_marked, "cleared": 0, "hitPoints": result.hp_marked }));
                    } else {
                        let cleared = self.world.clear_stress(&id, amount);
                        if cleared > 0.0 {
                            self.journal.push(json!({ "kind": "stress", "id": id, "marked": 0, "cleared": cleared, "hitPoints": 0 }));
                        }
                    }
                }
                None
            }
            "clearArmor" => {
                let amount = n(effect, "amount").unwrap_or(1.0);
                for id in self.resolve(&selector(effect, "target", "actor")) {
                    let cleared = self.world.clear_armor(&id, amount);
                    if cleared > 0.0 {
                        self.journal.push(json!({ "kind": "armor", "id": id, "cleared": cleared }));
                    }
                }
                None
            }
            "gainGood" => {
                let amount = self.amount(effect.get("amount"), 1.0);
                let actor = self.world.actor_id();
                for id in self.resolve(&selector(effect, "target", "actor")) {
                    let gained = self.world.gain_good_for(&id, amount);
                    if gained > 0.0 {
                        let mut entry = json!({ "kind": "good", "gained": gained });
                        if Some(&id) != actor.as_ref() {
                            entry["id"] = json!(id);
                        }
                        self.journal.push(entry);
                    }
                }
                None
            }
            "loseGood" => {
                let amount = self.amount(effect.get("amount"), 1.0);
                if amount <= 0.0 {
                    return None;
                }
                for id in self.resolve(&selector(effect, "target", "hit")) {
                    let lost = self.world.lose_good(&id, amount);
                    if lost > 0.0 {
                        self.journal.push(json!({ "kind": "goodLost", "lost": lost, "id": id }));
                    }
                }
                None
            }
            "spendGood" => {
                let amount = self.amount(effect.get("amount"), 1.0);
                let actor = self.world.actor_id();
                let spent = match &actor {
                    Some(actor) => self.world.spend_good(actor, amount),
                    None => false,
                };
                if !spent {
                    return self.refuse(format!("not enough Light to spend {}", text(amount)));
                }
                self.journal.push(json!({ "kind": "goodSpent", "amount": amount }));
                None
            }
            "applyCondition" | "clearCondition" => {
                let condition = s(effect, "condition").unwrap_or_default();
                for id in self.resolve(&selector(effect, "target", "target")) {
                    let changed = if kind == "applyCondition" {
                        self.world.apply_condition(&id, condition, s(effect, "duration").unwrap_or("temporary"))
                    } else {
                        self.world.clear_condition(&id, condition)
                    };
                    if changed {
                        self.journal.push(json!({ "kind": "condition", "id": id, "condition": condition, "applied": kind == "applyCondition" }));
                    }
                }
                None
            }
            "slay" | "revive" => {
                let bindings = self.bindings();
                if kind == "slay" {
                    for id in self.world.slay(&selector(effect, "target", "hit"), &bindings) {
                        self.journal.push(json!({ "kind": "slain", "id": id }));
                    }
                } else {
                    for id in self.world.revive(&selector(effect, "target", "target"), &bindings) {
                        self.journal.push(json!({ "kind": "revived", "id": id }));
                    }
                }
                None
            }
            "openShop" => {
                let seller = s(effect, "of").map(str::to_string).or_else(|| self.targets.first().cloned()).or_else(|| self.subject.clone());
                let Some(seller) = seller else { return self.refuse("nobody to buy from".into()) };
                self.journal.push(json!({ "kind": "shop", "id": seller }));
                None
            }
            "setAttitude" => {
                let attitude = s(effect, "attitude").unwrap_or_default();
                for id in self.resolve(&selector(effect, "target", "target")) {
                    if self.world.set_attitude(&id, attitude) {
                        self.journal.push(json!({ "kind": "attitude", "id": id, "attitude": attitude }));
                    }
                }
                None
            }
            "attack" => self.apply_attack(effect),
            "summon" => {
                let count = s(effect, "count");
                let Some(parsed) = parse_dice(count.unwrap_or("1")) else { return self.refuse(format!("cannot read a count of \"{}\"", count.unwrap_or_default())) };
                let each = js::max(0.0, thrown(self.rng, &parsed.expression));
                let wanted = if effect["perPc"] == true { each * self.world.count_alive(Faction::Party) } else { each };
                if wanted == 0.0 {
                    return self.refuse("nothing to summon".into());
                }
                let arrived = self.world.summon(s(effect, "adversary").unwrap_or_default(), wanted, s(effect, "range").unwrap_or("close"));
                if arrived.ids.is_empty() {
                    return self.refuse(arrived.refused.unwrap_or_else(|| "nobody arrived".into()));
                }
                self.journal.push(json!({ "kind": "summoned", "adversary": effect["adversary"], "ids": arrived.ids, "spotlight": effect["spotlight"] == true }));
                None
            }
            "replace" => {
                let Some(actor) = self.world.actor_id() else { return self.refuse("nobody to replace".into()) };
                let count = s(effect, "count");
                let Some(parsed) = parse_dice(count.unwrap_or("1")) else { return self.refuse(format!("cannot read \"{}\" of them", count.unwrap_or_default())) };
                let wanted = js::max(0.0, thrown(self.rng, &parsed.expression));
                if wanted == 0.0 {
                    return self.refuse("nothing to replace them with".into());
                }
                let stood = self.world.replace(s(effect, "adversary").unwrap_or_default(), wanted);
                if stood.ids.is_empty() {
                    return self.refuse(stood.refused.unwrap_or_else(|| "nothing took their place".into()));
                }
                self.journal.push(json!({ "kind": "replaced", "was": stood.was.unwrap_or(actor), "adversary": effect["adversary"], "ids": stood.ids, "spotlight": effect["spotlight"] == true }));
                None
            }
            "spotlight" => {
                let actor = self.world.actor_id();
                // Never the one acting, and never one that has already had this turn's.
                let named = self.resolve(&effect.get("targets").cloned().unwrap_or_else(|| json!({ "kind": "adversaries", "range": "far" })));
                let mut standing = Vec::new();
                for id in named {
                    if Some(&id) != actor.as_ref() && !self.world.spotlight_spent(&id) {
                        standing.push(id);
                    }
                }
                if standing.is_empty() {
                    return self.refuse("nobody left to spotlight".into());
                }
                let mut chosen = standing.clone();
                if let Some(count) = s(effect, "count") {
                    let Some(parsed) = parse_dice(count) else { return self.refuse(format!("cannot read \"{count}\" allies")) };
                    let wanted = js::max(0.0, thrown(self.rng, &parsed.expression));
                    if wanted == 0.0 {
                        return self.refuse("nobody to spotlight".into());
                    }
                    // The nearest of them, the rule the GM's own targeting uses.
                    let ordered = match &actor {
                        None => standing,
                        Some(actor) => self.world.nearest_first(actor, &standing),
                    };
                    chosen = ordered.into_iter().take(wanted as usize).collect();
                }
                self.journal.push(json!({ "kind": "spotlighted", "ids": chosen, "halfDamage": effect["halfDamage"] == true }));
                None
            }
            "boostDamage" => {
                let actor = self.world.actor_id();
                let mut by = if effect.get("amount").is_some() { self.amount(effect.get("amount"), 0.0) } else { 0.0 };
                if let Some(dice) = s(effect, "dice") {
                    let expression = if dice == "weapon" {
                        actor.as_ref().and_then(|a| self.world.weapon_damage(a)).map(|d| d.expression)
                    } else {
                        parse_dice(dice).map(|d| d.expression)
                    };
                    let Some(expression) = expression else { return self.refuse(format!("cannot read damage dice \"{dice}\"")) };
                    // One roll for each of them, rolled separately, because that is what a handful of dice is.
                    let times = if effect.get("times").is_some() { self.amount(effect.get("times"), 0.0) } else { 1.0 };
                    let mut i = 0.0;
                    while i < times {
                        by += damage_total(self.rng, &expression, 1.0, false).0;
                        i += 1.0;
                    }
                }
                // The blow's shape before its size.
                if effect["double"] == true {
                    self.journal.push(json!({ "kind": "damageDoubled", "id": actor }));
                }
                if let Some(type_) = effect.get("type") {
                    self.journal.push(json!({ "kind": "damageRetyped", "id": actor, "types": [type_] }));
                }
                if by <= 0.0 {
                    return None;
                }
                self.journal.push(json!({ "kind": "damageBoosted", "id": actor, "by": by }));
                None
            }
            "diceCheck" => {
                let times = if effect.get("times").is_some() { self.amount(effect.get("times"), 0.0) } else { 1.0 };
                let dice = s(effect, "dice").unwrap_or_default();
                let Some(parsed) = parse_dice(dice) else { return self.refuse(format!("cannot read dice \"{dice}\"")) };
                if times <= 0.0 {
                    // Nothing rolled, nothing said: a card whose holder spent nothing has not failed a roll.
                    if let Some(otherwise) = list(effect, "otherwise").filter(|o| !o.is_empty()) {
                        self.push(otherwise, None);
                    }
                    return None;
                }
                let mut results = Vec::new();
                let mut i = 0.0;
                while i < times {
                    results.push(thrown(self.rng, &parsed.expression));
                    i += 1.0;
                }
                let at_least = n(effect, "atLeast").unwrap_or(0.0);
                let came = results.iter().filter(|&&r| r >= at_least).count() as f64;
                let passed = came >= n(effect, "needed").unwrap_or(1.0);
                let id = self.world.actor_id();
                self.journal.push(json!({ "kind": "diceChecked", "id": id, "dice": dice, "results": results, "passed": passed }));
                if let Some(taken) = list(effect, if passed { "then" } else { "otherwise" }).filter(|t| !t.is_empty()) {
                    self.push(taken, None);
                }
                None
            }
            "softenBlow" | "dodgeBy" => {
                let mut by = if effect.get("amount").is_some() { self.amount(effect.get("amount"), 0.0) } else { 0.0 };
                if let Some(dice) = s(effect, "dice") {
                    let Some(parsed) = parse_dice(dice) else {
                        return self.refuse(if kind == "softenBlow" { format!("cannot read damage dice \"{dice}\"") } else { format!("cannot read dice \"{dice}\"") });
                    };
                    by += thrown(self.rng, &parsed.expression);
                }
                if by <= 0.0 {
                    return None;
                }
                let id = self.world.actor_id();
                if kind == "softenBlow" {
                    // What the thorns rolled is what the thorns are worth, both ways.
                    self.last_damage = Some(LastDamage { total: by, dice: s(effect, "dice").unwrap_or_default().to_string(), types: Vec::new() });
                    self.journal.push(json!({ "kind": "blowSoftened", "id": id, "by": by }));
                } else {
                    self.journal.push(json!({ "kind": "evasionRaised", "id": id, "by": by }));
                }
                None
            }
            "avoidBlow" => {
                let id = self.world.actor_id();
                self.journal.push(json!({ "kind": "blowAvoided", "id": id }));
                None
            }
            "stepSeverity" => {
                let id = self.world.actor_id();
                self.journal.push(json!({ "kind": "severityStepped", "id": id, "steps": n(effect, "steps").unwrap_or(1.0) }));
                None
            }
            "forceSeverity" => {
                let id = self.world.actor_id();
                let mut entry = json!({ "kind": "severityForced", "id": id, "severity": effect["severity"] });
                if effect["least"] == true {
                    entry["least"] = json!(true);
                }
                self.journal.push(entry);
                None
            }
            "forceHitPoints" => {
                let to = self.amount(effect.get("amount"), 0.0);
                if to <= 0.0 {
                    return None;
                }
                let id = self.world.actor_id();
                self.journal.push(json!({ "kind": "hitPointsForced", "id": id, "to": to }));
                None
            }
            "howMany" => {
                // One option per number they could give, each carrying its own copy of the effects, pushed as
                // an ordinary choice.
                let least = n(effect, "least").unwrap_or(1.0);
                let most = js::min(self.amount(effect.get("most"), 0.0), HOW_MANY_LIMIT);
                if most < js::max(least, 1.0) {
                    return self.refuse("there is none of it to spend".into());
                }
                let mut options = Vec::new();
                let mut i = least;
                while i <= most {
                    let label = if i == 0.0 { "None".to_string() } else { text(i) };
                    options.push(json!({ "label": label, "effects": answered(&effect["each"], "", i) }));
                    i += 1.0;
                }
                let mut asking = json!({ "kind": "choice" });
                for key in ["title", "body"] {
                    if let Some(value) = effect.get(key) {
                        asking[key] = value.clone();
                    }
                }
                asking["options"] = json!(options);
                self.push(vec![asking], None);
                None
            }
            "rerollDamage" => {
                self.journal.push(json!({ "kind": "damageRerolled", "below": effect["below"] }));
                None
            }
            "markSpot" => {
                let Some(actor) = self.world.actor_id() else { return self.refuse("nobody to mark the ground".into()) };
                let mark = s(effect, "mark").unwrap_or_default();
                if !self.world.mark_spot(&actor, mark) {
                    return self.refuse("no ground to mark".into());
                }
                self.journal.push(json!({ "kind": "marked", "id": actor, "mark": mark }));
                None
            }
            "forgetSpot" => {
                if let Some(actor) = self.world.actor_id() {
                    self.world.forget_spot(&actor, s(effect, "mark").unwrap_or_default());
                }
                None
            }
            "raiseRoll" => {
                let by = self.amount(effect.get("amount"), 0.0);
                if by > 0.0 {
                    self.journal.push(json!({ "kind": "rollRaised", "by": by }));
                }
                None
            }
            "nameRoll" => {
                self.journal.push(json!({ "kind": "rollNamed" }));
                None
            }
            "rerollDuality" => {
                self.journal.push(json!({ "kind": "dualityRerolled", "which": effect["which"] }));
                None
            }
            "maxOneDie" => {
                self.journal.push(json!({ "kind": "dieMaxed" }));
                None
            }
            "vaultCard" => {
                self.vaulted = true;
                None
            }
            "spotlightAgain" | "endSpotlight" => {
                let id = self.world.actor_id();
                self.journal.push(json!({ "kind": if kind == "spotlightAgain" { "spotlightedAgain" } else { "spotlightEnded" }, "id": id }));
                None
            }
            "zone" => {
                let actor = self.world.actor_id();
                // The tile aimed at, or the one the caster is on; nowhere to put it is nothing put there.
                let at = if effect["at"] == "point" {
                    self.point
                } else {
                    match &actor {
                        None => NO_TILE,
                        Some(actor) => self.world.tile_of(actor),
                    }
                };
                if at == NO_TILE {
                    return None;
                }
                let mut zone = json!({ "id": effect["zone"], "name": effect["name"], "owner": actor, "condition": effect["condition"], "anchor": at, "band": effect["band"] });
                if let Some(side) = effect.get("side") {
                    zone["side"] = side.clone();
                }
                zone["onDeath"] = json!(s(effect, "onDeath").unwrap_or("keep"));
                for key in ["value", "grows"] {
                    if let Some(value) = effect.get(key) {
                        zone[key] = value.clone();
                    }
                }
                self.world.place_zone(&zone);
                self.journal.push(json!({ "kind": "zone", "id": effect["zone"], "name": effect["name"], "standing": true }));
                None
            }
            "endZone" => {
                if self.world.end_zone(s(effect, "zone").unwrap_or_default()) {
                    self.journal.push(json!({ "kind": "zone", "id": effect["zone"], "name": effect["zone"], "standing": false }));
                }
                None
            }
            "countdown" => {
                let start_text = s(effect, "start").unwrap_or_default();
                let Some(parsed) = parse_dice(start_text) else { return self.refuse(format!("cannot read a countdown of \"{start_text}\"")) };
                // Rolled here, off the runner's seeded stream.
                let start = thrown(self.rng, &parsed.expression);
                if start <= 0.0 {
                    return self.refuse(format!("a countdown of \"{start_text}\" starts at {}", text(start)));
                }
                let owner = self.world.actor_id();
                let mut countdown = json!({
                    "id": effect["countdown"], "name": effect["name"], "owner": owner, "dice": start_text, "value": start, "start": start,
                    "advance": s(effect, "advance").unwrap_or("standard"), "onDeath": s(effect, "onDeath").unwrap_or("end"),
                });
                if let Some(looping) = effect.get("loop") {
                    countdown["loop"] = looping.clone();
                }
                countdown["effects"] = effect.get("effects").cloned().unwrap_or_else(|| json!([]));
                self.world.start_countdown(&countdown);
                self.journal.push(json!({ "kind": "countdown", "countdown": effect["countdown"], "name": effect["name"], "value": start }));
                None
            }
            "push" => {
                let Some(actor) = self.world.actor_id() else { return self.refuse("nobody to push from".into()) };
                let to = s(effect, "to").unwrap_or_default();
                for id in self.resolve(&selector(effect, "target", "target")) {
                    if let Some(moved) = self.world.push_back(&actor, &id, to) {
                        self.journal.push(json!({ "kind": "moved", "id": id, "from": moved.from, "to": moved.to }));
                    }
                }
                None
            }
            "move" => self.apply_move(effect),
            "run" => {
                let hook = s(effect, "hook").unwrap_or_default();
                if !self.world.hook_defined(hook) {
                    return self.refuse(format!("no hook named \"{hook}\""));
                }
                // What the hook reads is gathered first, as the TypeScript gathers it: the actor, the fight.
                let bindings = self.bindings();
                let actor = self.world.actor_id();
                let in_combat = self.world.in_combat();
                let reads = HookReads { args: effect.get("args").cloned().unwrap_or_else(|| json!({})), actor, targets: bindings.targets.clone(), hit: bindings.hit.clone(), in_combat, bindings };
                let last_roll = self.last_roll.as_ref().map(|r| LastRoll { total: r.total, critical: r.critical, outcome: r.outcome });
                let run = self.world.run_hook_effect(hook, &reads, last_roll, self.rng);
                if !run.ok {
                    return self.refuse(format!("hook \"{hook}\" failed: {}", run.message));
                }
                // Whatever it queued runs here, before the rest of the list it sits in.
                if !run.queued.is_empty() {
                    self.push(run.queued, None);
                }
                None
            }
            "markArmor" => {
                let amount = n(effect, "amount").unwrap_or(1.0);
                for id in self.resolve(&selector(effect, "target", "target")) {
                    let marked = self.world.mark_armor(&id, amount);
                    if marked > 0.0 {
                        self.journal.push(json!({ "kind": "armor", "id": id, "cleared": -marked }));
                    }
                }
                None
            }
            "gainBad" => {
                // The amount is read again each time round, as the TypeScript's loop reads it.
                let mut i = 0.0;
                while i < self.amount(effect.get("amount"), 1.0) {
                    if self.world.gain_bad() {
                        self.journal.push(json!({ "kind": "bad", "gained": 1 }));
                    }
                    i += 1.0;
                }
                None
            }
            "loseBad" => {
                let mut taken = 0.0;
                let mut i = 0.0;
                while i < self.amount(effect.get("amount"), 1.0) {
                    if self.world.lose_bad() {
                        taken += 1.0;
                    }
                    i += 1.0;
                }
                if taken > 0.0 {
                    self.journal.push(json!({ "kind": "badLost", "lost": taken }));
                }
                None
            }
            "addToken" => {
                // No amount at all is the card's own count - not the same as a count that came to nothing.
                let amount = effect.get("amount").map(|a| self.amount(Some(a), 1.0));
                if amount.is_some_and(|a| a <= 0.0) {
                    return None;
                }
                let ability = s(effect, "ability").unwrap_or_default();
                for id in self.resolve(&selector(effect, "target", "actor")) {
                    let before = self.world.tokens_on(&id, ability);
                    let left = self.world.add_tokens(&id, ability, amount);
                    self.journal.push(json!({ "kind": "tokens", "id": id, "ability": ability, "added": left - before, "spent": 0, "left": left }));
                }
                None
            }
            "spendToken" => {
                let ability = s(effect, "ability").unwrap_or_default();
                for id in self.resolve(&selector(effect, "target", "actor")) {
                    // "Then clear all tokens": an empty card is not a refusal.
                    let amount = if effect["all"] == true { self.world.tokens_on(&id, ability) } else { self.amount(effect.get("amount"), 1.0) };
                    if amount <= 0.0 {
                        continue;
                    }
                    let spent = self.world.spend_tokens(&id, ability, amount);
                    if spent < amount {
                        self.refuse(format!("not enough tokens on {ability}"));
                        continue;
                    }
                    let left = self.world.tokens_on(&id, ability);
                    self.journal.push(json!({ "kind": "tokens", "id": id, "ability": ability, "added": 0, "spent": spent, "left": left }));
                }
                None
            }
            "reactionRoll" => {
                // The damage is rolled first and once, however the rolls to avoid it go.
                if let Some(damage) = effect.get("damage") {
                    let dice = s(damage, "dice").unwrap_or_default();
                    let Some(parsed) = parse_dice(dice) else { return self.refuse(format!("cannot read damage dice \"{dice}\"")) };
                    let (total, rolled) = damage_total(self.rng, &parsed.expression, 1.0, false);
                    let types = match s(damage, "type").and_then(DamageType::parse) {
                        Some(t) => vec![t],
                        None => parsed.types.clone().unwrap_or_default(),
                    };
                    self.last_damage = Some(LastDamage { total, dice: format_dice(&rolled), types });
                }
                let difficulty = if effect["difficulty"] == "roll" { self.last_roll.as_ref().map_or(0.0, |r| r.total) } else { n(effect, "difficulty").unwrap_or(0.0) };
                let trait_ = s(effect, "trait").unwrap_or("agility");
                let mut failed = Vec::new();
                let mut passed = Vec::new();
                for id in self.resolve(&selector(effect, "targets", "hit")) {
                    let result = self.world.roll_reaction(&id, difficulty, trait_, self.rng);
                    let mut entry = json!({ "kind": "reaction", "id": id, "success": result.success, "total": result.total, "difficulty": difficulty });
                    if let Some(roll) = &result.roll {
                        entry["roll"] = json!(roll);
                    }
                    self.journal.push(entry);
                    if result.success {
                        passed.push(id);
                    } else {
                        failed.push(id);
                    }
                }
                // Failures resolve first, so `onSuccess` is pushed first.
                if let Some(effects) = list(effect, "onSuccess") {
                    self.push(effects, Some(passed));
                }
                if let Some(effects) = list(effect, "onFail") {
                    self.push(effects, Some(failed));
                }
                None
            }
            _ => None,
        }
    }

    fn apply_move(&mut self, effect: &Value) -> Option<Value> {
        let actor = self.world.actor_id();
        // Whoever is moving: the one acting, or everybody a selector names.
        let movers = match effect.get("who") {
            None => actor.clone().into_iter().collect::<Vec<_>>(),
            Some(who) => self.resolve(who),
        };
        if movers.is_empty() {
            return if effect.get("who").is_none() { self.refuse("nobody to move".into()) } else { None };
        }
        let teleport = effect["teleport"] == true;
        let to = s(effect, "to");
        if to == Some("point") || to == Some("mark") {
            let at = if to == Some("point") {
                self.point
            } else {
                match &actor {
                    None => NO_TILE,
                    Some(actor) => self.world.recall_spot(actor, s(effect, "mark").unwrap_or_default()),
                }
            };
            if at == NO_TILE {
                return None;
            }
            let budget = s(effect, "budget").unwrap_or(if to == Some("mark") { "outOfRange" } else if teleport { "far" } else { "close" }).to_string();
            for mover in movers {
                let ran = if teleport { self.world.blink_to(&mover, at, Some(&budget)) } else { self.world.draw_to(&mover, at, s(effect, "range").unwrap_or("melee"), Some(&budget)) };
                if let Some(ran) = ran {
                    let mut entry = json!({ "kind": "moved", "id": mover, "from": ran.from, "to": ran.to, "walked": !teleport });
                    if let Some(route) = ran.route {
                        entry["route"] = json!(route);
                    }
                    self.journal.push(entry);
                }
            }
            return None;
        }
        let Some(actor) = actor else { return self.refuse("nobody to move".into()) };
        let _ = actor;
        // Whoever the walk is measured against; nobody there is standing still, not a refusal.
        let Some(other) = self.resolve(&selector(effect, "of", "target")).into_iter().next() else { return None };
        let budget = s(effect, "budget").unwrap_or("close").to_string();
        for mover in movers {
            if mover == other {
                continue;
            }
            let walked = if effect["how"] == "away" {
                self.world.break_away(&mover, &other, Some(&budget))
            } else {
                self.world.draw_in(&mover, &other, s(effect, "range").unwrap_or("melee"), Some(&budget))
            };
            if let Some(walked) = walked {
                let mut entry = json!({ "kind": "moved", "id": mover, "from": walked.from, "to": walked.to, "walked": true });
                if let Some(route) = walked.route {
                    entry["route"] = json!(route);
                }
                self.journal.push(entry);
            }
        }
        None
    }

    fn apply_flat_damage(&mut self, effect: &Value) -> Option<Value> {
        let target = selector(effect, "target", "actor");
        let amount = self.amount(effect.get("amount"), 1.0);
        if amount <= 0.0 {
            return None;
        }
        let bindings = self.bindings();
        let source = s(effect, "source");
        let marked = self.world.damage(&target, amount, source, &bindings);
        self.counts[1] += marked;
        let mut entry = json!({ "kind": "damage", "amount": amount, "marked": marked });
        if let Some(source) = source {
            entry["source"] = json!(source);
        }
        self.journal.push(entry);
        None
    }

    fn apply_rolled_damage(&mut self, effect: &Value) -> Option<Value> {
        let actor = self.world.actor_id();
        let dice = s(effect, "dice").unwrap_or_default().to_string();
        // `same` is the damage already rolled in this script, not a second roll of the same dice.
        if dice == "same" {
            let Some(last) = self.last_damage.clone() else { return self.refuse("no damage to carry over".into()) };
            let targets = self.resolve(&selector(effect, "target", "hit"));
            if targets.is_empty() {
                return None;
            }
            let amount = if effect["half"] == true { (last.total / 2.0).ceil() } else { last.total };
            return self.deal_to(&targets, amount, effect, &last.dice, Some(last.types));
        }
        // `weapon` is what the actor swings; `theirs` what the one bound as the target swings.
        let expression = if dice == "weapon" || dice == "theirs" {
            let swinging = if dice == "theirs" { self.resolve(&json!({ "kind": "target" })).into_iter().next() } else { actor.clone() };
            swinging.and_then(|who| self.world.weapon_damage(&who))
        } else {
            parse_dice(&dice)
        };
        let Some(expression) = expression else {
            return self.refuse(if dice == "weapon" || dice == "theirs" { "no weapon to roll damage with".into() } else { format!("cannot read damage dice \"{dice}\"") });
        };
        let targets = self.resolve(&selector(effect, "target", "hit"));
        if targets.is_empty() {
            return None;
        }
        let mut multiplier = 1.0;
        match s(effect, "using") {
            Some("proficiency") => multiplier = actor.as_ref().map_or(1.0, |a| self.world.proficiency_of(a)),
            Some("halfProficiency") => multiplier = actor.as_ref().map_or(1.0, |a| js::max(1.0, (self.world.proficiency_of(a) / 2.0).ceil())),
            Some("spellcast") => {
                let value = actor.as_ref().and_then(|a| self.world.spellcast_value(a));
                let Some(value) = value else { return self.refuse("no Spellcast trait to deal damage with".into()) };
                multiplier = js::max(0.0, value);
            }
            _ => {}
        }
        let critical = self.last_roll.as_ref().is_some_and(|r| r.critical);
        let (total, rolled) = damage_total(self.rng, &expression.expression, multiplier, critical);
        let amount = if effect["half"] == true { (total / 2.0).ceil() } else { total };
        let written = format_dice(&rolled);
        self.last_damage = Some(LastDamage { total, dice: written.clone(), types: expression.types.clone().unwrap_or_default() });
        self.deal_to(&targets, amount, effect, &written, expression.types)
    }

    /// Hand the same number to each target, journalling the whole event once.
    fn deal_to(&mut self, targets: &[String], amount: f64, effect: &Value, dice: &str, stated: Option<Vec<DamageType>>) -> Option<Value> {
        let types: Vec<DamageType> = match s(effect, "type").and_then(DamageType::parse) {
            Some(t) => vec![t],
            None => stated.unwrap_or_default(),
        };
        let mut marked = 0.0;
        let mut reduced = 0.0;
        let mut defended = Vec::new();
        for id in targets {
            let mut damage = json!({ "amount": amount, "types": types });
            if let Some(direct) = effect.get("direct") {
                damage["direct"] = direct.clone();
            }
            let dealt = self.world.deal_damage(id, &damage, self.rng);
            marked += dealt.hp_marked;
            self.counts[1] += dealt.hp_marked;
            reduced += dealt.reduced;
            for r in dealt.reactions {
                let mut entry = json!({ "kind": "defended", "id": id, "ability": r.name, "goodSpent": r.good_spent, "stressMarked": r.stress_marked });
                if let Some(rolled) = r.rolled {
                    entry["rolled"] = json!(rolled);
                }
                defended.push(entry);
            }
        }
        let mut entry = json!({ "kind": "damage", "amount": amount, "marked": marked, "targets": targets, "dice": dice });
        if reduced != 0.0 {
            entry["reduced"] = json!(reduced);
        }
        if let Some(source) = effect.get("source") {
            entry["source"] = source.clone();
        }
        self.journal.push(entry);
        self.journal.extend(defended);
        None
    }

    /// The dice behind an attack's extra damage: written out, or the attacker's weapon or one of its dice.
    fn dice_behind(&mut self, expression: &str, actor: &str) -> Option<DiceExpression> {
        if expression != "weapon" && expression != "weaponDie" {
            return parse_dice(expression).map(|p| p.expression);
        }
        let damage = self.world.weapon_damage(actor)?.expression;
        if expression == "weapon" {
            return Some(damage);
        }
        (damage.count != 0.0).then_some(DiceExpression { count: 1.0, sides: damage.sides, modifier: 0.0 })
    }

    fn apply_attack(&mut self, effect: &Value) -> Option<Value> {
        // Whose swing it is: the one acting, or the one bound as the target. Nobody swings at themselves.
        let attacker = if effect["by"] == "target" { self.resolve(&json!({ "kind": "target" })).into_iter().next() } else { self.world.actor_id() };
        let Some(attacker) = attacker else { return self.refuse("nobody to attack with".into()) };
        let targets: Vec<String> = self.resolve(&selector(effect, "target", "target")).into_iter().filter(|id| *id != attacker).collect();
        if targets.is_empty() {
            return self.refuse("nothing to attack".into());
        }
        // Read once, before the first swing: who stands where now, not after the first one moved.
        let joined_by = effect.get("joinedBy").map(|who| self.resolve(who));
        let mut extra = 0.0;
        if let Some(damage_dice) = s(effect, "damageDice") {
            let Some(expression) = self.dice_behind(damage_dice, &attacker) else { return self.refuse(format!("cannot read damage dice \"{damage_dice}\"")) };
            extra = damage_total(self.rng, &expression, 1.0, false).0;
        }
        let behind = n(effect, "damageBonus").unwrap_or(0.0) + extra;

        let mut hit = Vec::new();
        let mut swung = false;
        for target in targets {
            let mut request = json!({ "attacker": attacker, "target": target, "weapon": s(effect, "weapon").unwrap_or("primary") });
            if let Some(advantage) = effect.get("advantage") {
                request["advantage"] = advantage.clone();
            }
            if behind != 0.0 {
                request["damageBonus"] = json!(behind);
            }
            for key in ["damage", "range", "direct"] {
                if let Some(value) = effect.get(key) {
                    request[key] = value.clone();
                }
            }
            if let Some(joined_by) = &joined_by {
                request["joinedBy"] = json!(joined_by);
            }
            let summary = self.world.attack(&request, self.rng);
            if let Some(refused) = summary.refused {
                self.refuse(refused);
                continue;
            }
            swung = true;
            self.rolled = true;
            self.counts[1] += summary.hit_points_marked;
            self.spotlight_to_gm = self.spotlight_to_gm || summary.spotlight_to_gm;
            if let Some(roll) = &summary.roll {
                self.last_roll = Some(roll.clone());
            }
            if let Some(damage) = summary.damage {
                self.last_damage = Some(LastDamage { total: damage, dice: summary.damage_dice.clone().unwrap_or_default(), types: summary.damage_types.clone().unwrap_or_default() });
            }
            let mut entry = json!({ "kind": "attack", "attacker": attacker, "target": target, "weapon": summary.weapon, "hit": summary.hit, "critical": summary.critical, "hitPointsMarked": summary.hit_points_marked });
            if let Some(reduced) = summary.reduced.filter(|&r| r != 0.0) {
                entry["reduced"] = json!(reduced);
            }
            if let Some(joined) = summary.joined.as_ref().filter(|j| !j.is_empty()) {
                entry["joined"] = json!(joined);
            }
            if let Some(roll) = &summary.roll {
                entry["roll"] = json!(roll);
            }
            self.journal.push(entry);
            if summary.good_gained > 0.0 {
                self.journal.push(json!({ "kind": "good", "gained": summary.good_gained }));
            }
            if summary.bad_gained > 0.0 {
                self.journal.push(json!({ "kind": "bad", "gained": summary.bad_gained }));
            }
            if summary.stress_cleared > 0.0 {
                self.journal.push(json!({ "kind": "stress", "id": attacker, "marked": 0, "cleared": summary.stress_cleared, "hitPoints": 0 }));
            }
            if summary.hit {
                hit.push(target);
            }
        }
        if !swung {
            return None;
        }
        self.hit = hit.clone();
        let branch = list(effect, if hit.is_empty() { "onMiss" } else { "onHit" });
        if let Some(branch) = branch {
            self.push(branch, Some(hit));
        }
        None
    }
}
