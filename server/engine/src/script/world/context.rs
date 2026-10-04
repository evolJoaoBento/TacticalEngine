//! The world as the runner and the conditions ask it: `ConditionContext`, `ScriptWorld`, and a `DiceHand`
//! nothing rolls - the world reads its own gates with no dice, so a `chance` in one is false. The words the
//! scripts carry - bands, durations, attitudes - are read here into what the world's own methods take.

use super::fight::AttackAsked;
use super::{HookReader, SceneScriptWorld};
use crate::rng::Rng;
use crate::rules::damage::IncomingDamage;
use crate::rules::dice::ParsedDamage;
use crate::rules::range::RangeBand;
use crate::scene::state::{ConditionDuration, EncounterState, Faction};
use crate::script::conditions::{ConditionContext, DiceHand, HookReads, InteractableState, TargetBindings};
use crate::script::countdowns::RunningCountdown;
use crate::script::runner::*;
use crate::script::zones::RunningZone;
use serde_json::Value;

fn read<T: serde::de::DeserializeOwned>(value: &Value, what: &str) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("{what} as the script's schema reads it: {e}: {value}"))
}

fn band(name: &str) -> RangeBand {
    RangeBand::from_name(name).unwrap_or_else(|| panic!("a range band, not {name:?}"))
}

fn band_or(name: Option<&str>, otherwise: RangeBand) -> RangeBand {
    name.map_or(otherwise, band)
}

impl DiceHand for SceneScriptWorld<'_> {
    fn roll(&mut self, _dice: &str) -> f64 {
        unreachable!("the world reads its gates without dice")
    }
    fn amount(&mut self, _amount: &Value) -> f64 {
        unreachable!("the world reads its gates without dice")
    }
}

impl ConditionContext for SceneScriptWorld<'_> {
    fn has_flag(&mut self, flag: &str) -> bool {
        SceneScriptWorld::has_flag(self, flag)
    }
    fn has_key(&mut self, key: &str) -> bool {
        SceneScriptWorld::has_item(self, key, 1.0)
    }
    fn has_item(&mut self, item: &str, quantity: f64) -> bool {
        SceneScriptWorld::has_item(self, item, quantity)
    }
    fn get_var(&mut self, name: &str) -> Value {
        SceneScriptWorld::get_var(self, name)
    }
    fn interactable_state(&mut self, id: &str) -> InteractableState {
        SceneScriptWorld::interactable_state(self, id)
    }
    fn encounter_state(&mut self, id: &str) -> EncounterState {
        SceneScriptWorld::encounter_state(self, id)
    }
    fn count_alive(&mut self, faction: Faction) -> f64 {
        SceneScriptWorld::count_alive(self, faction)
    }
    fn quest_status(&mut self, quest: &str) -> String {
        SceneScriptWorld::quest_status(self, quest)
    }
    fn objective_done(&mut self, quest: &str, objective: &str) -> bool {
        SceneScriptWorld::objective_done(self, quest, objective)
    }
    fn actor_id(&mut self) -> Option<String> {
        self.scenario.actor_id.clone()
    }
    fn resolve_targets(&mut self, selector: &Value, bindings: &TargetBindings) -> Vec<String> {
        SceneScriptWorld::resolve_targets(self, selector, bindings)
    }
    fn in_combat(&mut self) -> bool {
        self.fighting()
    }
    fn loadout_domain(&mut self, id: &str, domain: &str) -> Option<f64> {
        SceneScriptWorld::loadout_domain(self, id, domain)
    }
    fn has_condition(&mut self, id: &str, condition: &str) -> bool {
        SceneScriptWorld::has_condition(self, id, condition)
    }
    fn pool_value(&mut self, id: &str, pool: &str, measure: &str) -> Option<f64> {
        SceneScriptWorld::pool_value(self, id, pool, measure)
    }
    fn band_to(&mut self, from: &str, to: &str) -> Option<RangeBand> {
        SceneScriptWorld::band_to(self, from, to)
    }
    fn faction_of(&mut self, id: &str) -> Option<Faction> {
        SceneScriptWorld::faction_of(self, id)
    }
    fn hook_defined(&mut self, id: &str) -> bool {
        SceneScriptWorld::hook_defined(self, id)
    }
    fn run_hook(&mut self, id: &str, reads: &HookReads) -> bool {
        let hooks = self.hooks.clone();
        hooks.run(id, reads, &mut Reading { world: self, bindings: &reads.bindings })
    }
    fn tokens_on(&mut self, id: &str, ability: &str) -> f64 {
        SceneScriptWorld::tokens_on(self, id, ability)
    }
}

impl ScriptWorld for SceneScriptWorld<'_> {
    fn add_item(&mut self, item: &str, quantity: f64) -> f64 {
        SceneScriptWorld::add_item(self, item, quantity)
    }
    fn roll_loot(&mut self, table: Option<&str>, rng: &mut Rng) -> Vec<LootDrop> {
        SceneScriptWorld::roll_loot(self, table, rng)
    }
    fn remove_item(&mut self, item: &str, quantity: f64) -> f64 {
        SceneScriptWorld::remove_item(self, item, quantity)
    }
    fn set_flag(&mut self, flag: &str) {
        SceneScriptWorld::set_flag(self, flag)
    }
    fn clear_flag(&mut self, flag: &str) {
        SceneScriptWorld::clear_flag(self, flag)
    }
    fn give_key(&mut self, key: &str) {
        SceneScriptWorld::add_item(self, key, 1.0);
    }
    fn set_var(&mut self, name: &str, value: &Value) {
        SceneScriptWorld::set_var(self, name, value.clone())
    }
    fn open_interactable(&mut self, id: &str) {
        self.state.open_interactable(id)
    }
    fn close_interactable(&mut self, id: &str) {
        self.state.close_interactable(id);
    }
    fn remove_interactable(&mut self, id: &str) {
        self.state.remove_interactable(id)
    }
    fn mark_interactable_used(&mut self, id: &str) {
        SceneScriptWorld::mark_interactable_used(self, id)
    }
    fn start_encounter(&mut self, id: &str) {
        SceneScriptWorld::start_encounter(self, id)
    }
    fn end_encounter(&mut self, id: &str) {
        SceneScriptWorld::end_encounter(self, id)
    }
    fn damage(&mut self, target: &Value, amount: f64, _source: Option<&str>, bindings: &TargetBindings) -> f64 {
        SceneScriptWorld::damage(self, target, amount, bindings)
    }
    fn heal(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        SceneScriptWorld::heal(self, target, amount, bindings)
    }
    fn heal_shared(&mut self, target: &Value, amount: f64, bindings: &TargetBindings) -> f64 {
        SceneScriptWorld::heal_shared(self, target, amount, bindings)
    }
    fn check_modifier(&mut self, trait_: &str, as_: &str) -> Option<f64> {
        SceneScriptWorld::check_modifier(self, trait_, as_)
    }
    fn advantage_rolling(&mut self) -> Advantage {
        SceneScriptWorld::advantage_rolling(self)
    }
    fn advantage_against(&mut self, targets: &[String]) -> Advantage {
        SceneScriptWorld::advantage_against(self, targets)
    }
    fn lift_roll(&mut self, id: &str, trait_: &str, total: f64, difficulty: f64, critical: bool) -> f64 {
        SceneScriptWorld::lift_roll(self, id, trait_, total, difficulty, critical)
    }
    fn good_die_sides(&mut self, id: &str) -> u32 {
        SceneScriptWorld::good_die_sides(self, id)
    }
    fn answers_roll(&mut self, id: &str, roll: &Value) -> bool {
        SceneScriptWorld::answers_roll(self, id, roll)
    }
    fn mark_spot(&mut self, actor: &str, mark: &str) -> bool {
        SceneScriptWorld::mark_spot(self, actor, mark)
    }
    fn recall_spot(&mut self, actor: &str, mark: &str) -> i32 {
        SceneScriptWorld::recall_spot(self, actor, mark)
    }
    fn forget_spot(&mut self, actor: &str, mark: &str) -> bool {
        SceneScriptWorld::forget_spot(self, actor, mark)
    }
    fn experiences(&mut self) -> Vec<Value> {
        SceneScriptWorld::experiences(self)
    }
    fn difficulty_of(&mut self, id: &str) -> Option<f64> {
        SceneScriptWorld::difficulty_of(self, id)
    }
    fn grant_level(&mut self, level: Option<f64>) -> Option<f64> {
        SceneScriptWorld::grant_level(self, level)
    }
    fn gain_good(&mut self) -> bool {
        SceneScriptWorld::gain_good(self)
    }
    fn gain_bad(&mut self) -> bool {
        SceneScriptWorld::gain_bad(self)
    }
    fn start_quest(&mut self, quest: &str) -> bool {
        SceneScriptWorld::start_quest(self, quest)
    }
    fn complete_objective(&mut self, quest: &str, objective: &str) -> bool {
        SceneScriptWorld::complete_objective(self, quest, objective)
    }
    fn reveal_objective(&mut self, quest: &str, objective: &str) -> bool {
        SceneScriptWorld::reveal_objective(self, quest, objective)
    }
    fn complete_quest(&mut self, quest: &str) -> bool {
        SceneScriptWorld::complete_quest(self, quest)
    }
    fn fail_quest(&mut self, quest: &str) -> bool {
        SceneScriptWorld::fail_quest(self, quest)
    }
    fn deal_damage(&mut self, id: &str, damage: &Value, rng: &mut Rng) -> DealtDamage {
        let damage: IncomingDamage = read(damage, "damage");
        SceneScriptWorld::deal_damage(self, id, &damage, rng)
    }
    fn mark_stress(&mut self, id: &str, amount: f64) -> StressMarked {
        SceneScriptWorld::mark_stress(self, id, amount)
    }
    fn clear_stress(&mut self, id: &str, amount: f64) -> f64 {
        SceneScriptWorld::clear_stress(self, id, amount)
    }
    fn clear_armor(&mut self, id: &str, amount: f64) -> f64 {
        SceneScriptWorld::clear_armor(self, id, amount)
    }
    fn mark_armor(&mut self, id: &str, amount: f64) -> f64 {
        SceneScriptWorld::mark_armor(self, id, amount)
    }
    fn gain_good_for(&mut self, id: &str, amount: f64) -> f64 {
        SceneScriptWorld::gain_good_for(self, id, amount)
    }
    fn spend_good(&mut self, id: &str, amount: f64) -> bool {
        SceneScriptWorld::spend_good(self, id, amount)
    }
    fn lose_good(&mut self, id: &str, amount: f64) -> f64 {
        SceneScriptWorld::lose_good(self, id, amount)
    }
    fn apply_condition(&mut self, id: &str, condition: &str, duration: &str) -> bool {
        let duration: ConditionDuration = read(&Value::String(duration.into()), "a condition's duration");
        SceneScriptWorld::apply_condition(self, id, condition, duration)
    }
    fn clear_condition(&mut self, id: &str, condition: &str) -> bool {
        SceneScriptWorld::clear_condition(self, id, condition)
    }
    fn revive(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        SceneScriptWorld::revive(self, target, bindings)
    }
    fn slay(&mut self, target: &Value, bindings: &TargetBindings) -> Vec<String> {
        SceneScriptWorld::slay(self, target, bindings)
    }
    fn set_attitude(&mut self, id: &str, attitude: &str) -> bool {
        self.state.set_attitude(id, attitude)
    }
    fn proficiency_of(&mut self, id: &str) -> f64 {
        SceneScriptWorld::proficiency_of(self, id)
    }
    fn add_tokens(&mut self, id: &str, ability: &str, amount: Option<f64>) -> f64 {
        SceneScriptWorld::add_tokens(self, id, ability, amount)
    }
    fn spend_tokens(&mut self, id: &str, ability: &str, amount: f64) -> f64 {
        SceneScriptWorld::spend_tokens(self, id, ability, amount)
    }
    fn spellcast_value(&mut self, id: &str) -> Option<f64> {
        SceneScriptWorld::spellcast_value(self, id)
    }
    fn lose_bad(&mut self) -> bool {
        SceneScriptWorld::lose_bad(self)
    }
    fn trait_value(&mut self, id: &str, trait_: &str) -> Option<f64> {
        SceneScriptWorld::trait_value(self, id, trait_)
    }
    fn weapon_damage(&mut self, id: &str) -> Option<ParsedDamage> {
        SceneScriptWorld::weapon_damage(self, id)
    }
    fn attack(&mut self, request: &Value, rng: &mut Rng) -> AttackSummary {
        let asked: AttackAsked = read(request, "an attack");
        SceneScriptWorld::attack(self, &asked, rng)
    }
    fn push_back(&mut self, from: &str, target: &str, band_name: &str) -> Option<Moved> {
        SceneScriptWorld::push_back(self, from, target, band(band_name))
    }
    fn draw_in(&mut self, mover: &str, toward: &str, band_name: &str, budget: Option<&str>) -> Option<Moved> {
        SceneScriptWorld::draw_in(self, mover, toward, band(band_name), band_or(budget, RangeBand::Close))
    }
    fn draw_to(&mut self, mover: &str, goal: i32, band_name: &str, budget: Option<&str>) -> Option<Moved> {
        SceneScriptWorld::draw_to(self, mover, goal, band(band_name), band_or(budget, RangeBand::Close))
    }
    fn blink_to(&mut self, mover: &str, goal: i32, band_name: Option<&str>) -> Option<Moved> {
        SceneScriptWorld::blink_to(self, mover, goal, band_or(band_name, RangeBand::Far))
    }
    fn break_away(&mut self, mover: &str, from: &str, budget: Option<&str>) -> Option<Moved> {
        SceneScriptWorld::break_away(self, mover, from, band_or(budget, RangeBand::Close))
    }
    fn summon(&mut self, definition: &str, count: f64, range: &str) -> Arrived {
        SceneScriptWorld::summon(self, definition, count, band(range))
    }
    fn start_countdown(&mut self, countdown: &Value) {
        let countdown: RunningCountdown = read(countdown, "a countdown");
        SceneScriptWorld::start_countdown(self, countdown)
    }
    fn place_zone(&mut self, zone: &Value) {
        let zone: RunningZone = read(zone, "a zone");
        SceneScriptWorld::place_zone(self, zone)
    }
    fn end_zone(&mut self, id: &str) -> bool {
        SceneScriptWorld::end_zone(self, id)
    }
    fn refresh_zones(&mut self) {
        SceneScriptWorld::refresh_zones(self)
    }
    fn tile_of(&mut self, id: &str) -> i32 {
        SceneScriptWorld::tile_of(self, id)
    }
    fn spotlight_spent(&mut self, id: &str) -> bool {
        (self.spotlight_spent)(id)
    }
    fn nearest_first(&mut self, from: &str, ids: &[String]) -> Vec<String> {
        SceneScriptWorld::nearest_first(self, from, ids)
    }
    fn replace(&mut self, definition: &str, count: f64) -> Arrived {
        SceneScriptWorld::replace(self, definition, count)
    }
    fn roll_reaction(&mut self, id: &str, difficulty: f64, trait_: &str, rng: &mut Rng) -> ReactionRolled {
        SceneScriptWorld::roll_reaction(self, id, difficulty, trait_, rng)
    }
    fn run_hook_effect(&mut self, id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: &mut Rng) -> HookRun {
        let hooks = self.hooks.clone();
        hooks.run_effect(id, reads, last_roll, rng, &mut Reading { world: self, bindings: &reads.bindings })
    }
}

/// The world as a hook reads it, `select` against the bindings the hook was run under.
struct Reading<'r, 'w> {
    world: &'r mut SceneScriptWorld<'w>,
    bindings: &'r TargetBindings,
}

impl HookReader for Reading<'_, '_> {
    fn pool(&mut self, id: &str, pool: &str, measure: &str) -> Result<Option<f64>, String> {
        if self.world.state.entity(id).is_some() && !matches!(pool, "hitPoints" | "stress" | "armorSlots" | "good") {
            return Err(format!("Cannot read properties of undefined (reading '{pool}')"));
        }
        Ok(self.world.pool_value(id, pool, measure))
    }
    fn has_condition(&mut self, id: &str, condition: &str) -> bool {
        self.world.has_condition(id, condition)
    }
    fn band_to(&mut self, from: &str, to: &str) -> Option<RangeBand> {
        self.world.band_to(from, to)
    }
    fn difficulty_of(&mut self, id: &str) -> Option<f64> {
        self.world.difficulty_of(id)
    }
    fn select(&mut self, selector: &Value) -> Vec<String> {
        self.world.resolve_targets(selector, self.bindings)
    }
    fn flag(&mut self, name: &str) -> bool {
        self.world.has_flag(name)
    }
    fn variable(&mut self, name: &str) -> Value {
        self.world.get_var(name)
    }
    fn count_alive(&mut self, faction: &str) -> f64 {
        match faction {
            "party" => self.world.count_alive(Faction::Party),
            "adversary" => self.world.count_alive(Faction::Adversary),
            "neutral" => self.world.count_alive(Faction::Neutral),
            _ => 0.0,
        }
    }
    fn faction_of(&mut self, id: &str) -> Option<Faction> {
        self.world.faction_of(id)
    }
    fn tokens(&mut self, id: &str, ability: &str) -> f64 {
        self.world.tokens_on(id, ability)
    }
}
