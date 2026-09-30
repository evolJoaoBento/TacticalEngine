//! What the world answers without changing anything - flags, items, quests, variables, a thing's or an
//! encounter's state, what a condition says, a creature's side, pools, bands, traits - and the few reads
//! that keep a count as they go: marked spots, tokens, conditions spent when their moment comes.

use super::{PayoutOwed, SceneScriptWorld};
use crate::character::sheet::{wielded_trait, DerivedCharacter, UNARMED_RANGE, UNARMED_TRAIT};
use crate::content::abilities::loadout_of;
use crate::content::conditions::{ConditionBlock, ConditionDef, EndsWhen};
use crate::grid::los::trace_line;
use crate::grid::tile_grid::NO_TILE;
use crate::js;
use crate::rng::{RangeError, Rng};
use crate::rules::countdown::CountdownCue;
use crate::rules::dice::ParsedDamage;
use crate::rules::duality::GOOD_DIE_SIDES;
use crate::rules::jump::Trait;
use crate::rules::range::{band_between_standing, band_for_span, reaches, RangeBand, Standing};
use crate::rules::resources::unmarked;
use crate::scene::state::{EncounterState, EntityState, Faction};
use crate::script::conditions::{InteractableState, TargetBindings};
use crate::script::countdowns::{advance_board, end_creature_countdowns, reap_board, CountdownMoved, OwnerStatus, RunningCountdown};
use crate::script::marks::{mark_key, parse_mark_key};
use crate::script::world::scenario::use_key;
use crate::content::abilities::{Stat, TokenAmount};
use serde_json::{json, Value};
use std::cmp::Ordering;

/// A mark someone has made, for a board that draws them.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Mark {
    pub mark: String,
    pub owner: String,
    pub tile: f64,
}

/// What a condition answers a fall with, in place of a death move.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Instead {
    pub condition: String,
    pub clears: f64,
    pub says: String,
}

/// What the conditions on a creature add to an Armor Slot it just marked.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorAidOn {
    pub steps: f64,
    pub ends_when_it_saves: Vec<String>,
}

/// JavaScript's `Array.prototype.sort()` with no comparator: by UTF-16 code unit.
pub(super) fn sorted(names: &[String]) -> Vec<String> {
    let mut names = names.to_vec();
    names.sort_by(|a, b| js::utf16_cmp(a, b));
    names
}

impl<'w> SceneScriptWorld<'w> {
    pub fn has_flag(&self, flag: &str) -> bool {
        self.scenario.flags.iter().any(|f| f == flag)
    }

    pub fn has_item(&self, item: &str, quantity: f64) -> bool {
        self.item_count(item) >= quantity
    }

    pub fn item_count(&self, item: &str) -> f64 {
        self.scenario.items.get(item).copied().unwrap_or(0.0)
    }

    pub fn quest_status(&self, quest: &str) -> String {
        self.scenario.quests.get(quest).map_or_else(|| "inactive".to_string(), |p| p.status.clone())
    }

    pub fn objective_done(&self, quest: &str, objective: &str) -> bool {
        self.scenario.quests.get(quest).is_some_and(|p| p.done.iter().any(|o| o == objective))
    }

    /// An unset variable reads as null, so conditions comparing against null behave as content expects.
    pub fn get_var(&self, name: &str) -> Value {
        self.scenario.variables.get(name).cloned().unwrap_or(Value::Null)
    }

    pub fn interactable_state(&mut self, id: &str) -> InteractableState {
        let s = self.state.interactable(id);
        InteractableState { used: s.used, open: s.open, removed: s.removed }
    }

    pub fn encounter_state(&mut self, id: &str) -> EncounterState {
        *self.state.encounter(id)
    }

    fn condition(&self, name: &str) -> Option<&'w ConditionDef> {
        self.content.condition_defs.get(name)
    }

    /// What a creature bears that answers a fall in place of a death move, and the condition spent doing it.
    pub fn instead_of_death(&self, id: &str) -> Option<Instead> {
        let conditions = self.state.entity(id).map(|e| sorted(&e.conditions)).unwrap_or_default();
        conditions.into_iter().find_map(|name| {
            let instead = self.condition(&name)?.instead_of_death.as_ref()?;
            Some(Instead { condition: name, clears: instead.clears, says: instead.says.clone() })
        })
    }

    /// What a condition is called, for a line the log writes about it.
    pub fn condition_name(&self, condition: &str) -> String {
        self.condition(condition).map_or_else(|| condition.to_string(), |def| def.name.clone())
    }

    pub fn condition_def(&self, condition: &str) -> Option<&'w ConditionDef> {
        self.condition(condition)
    }

    /// What the conditions on a creature owe whoever just did this to them, in a stable order.
    pub fn payouts_on(&self, id: &str, on: &str) -> Vec<PayoutOwed> {
        let Some(entity) = self.state.entity(id) else { return Vec::new() };
        let mut owed = Vec::new();
        for name in sorted(&entity.conditions) {
            let Some(payout) = self.condition(&name).and_then(|def| def.payout.as_ref()) else { continue };
            if payout.on != on || payout.effects.is_empty() {
                continue;
            }
            owed.push(PayoutOwed { condition: name, effects: payout.effects.clone(), when: payout.when.clone(), auto: payout.auto, keeps: payout.keeps });
        }
        owed
    }

    /// What the conditions on a creature add to an Armor Slot they just marked, and which are spent if that
    /// is what saved them.
    pub fn armor_aid(&self, id: &str) -> ArmorAidOn {
        let Some(entity) = self.state.entity(id) else { return ArmorAidOn { steps: 0.0, ends_when_it_saves: Vec::new() } };
        let mut aid = ArmorAidOn { steps: 0.0, ends_when_it_saves: Vec::new() };
        for name in &entity.conditions {
            let Some(armor) = self.condition(name).and_then(|def| def.armor) else { continue };
            aid.steps += armor.steps;
            if armor.ends_when_it_saves == Some(true) {
                aid.ends_when_it_saves.push(name.clone());
            }
        }
        aid
    }

    pub fn faction_of(&self, id: &str) -> Option<Faction> {
        self.state.entity(id).map(|e| e.faction).filter(|f| *f != Faction::Neutral)
    }

    pub fn count_alive(&self, faction: Faction) -> f64 {
        self.state.entities_of(faction).filter(|e| e.alive).count() as f64
    }

    pub fn start_countdown(&mut self, countdown: RunningCountdown) {
        self.scenario.countdowns.set(countdown);
    }

    /// Creatures ordered by how close they are to another, ties by id - the GM's own targeting order, so a
    /// feature that takes "up to five allies" takes the same five on every replay.
    pub fn nearest_first(&self, from: &str, ids: &[String]) -> Vec<String> {
        let here = self.tile_of(from);
        let mut ids = ids.to_vec();
        if here == NO_TILE {
            ids.sort_by(|a, b| js::locale_cmp(a, b));
            return ids;
        }
        let away = |id: &str| -> f64 {
            let tile = self.tile_of(id);
            if tile == NO_TILE {
                f64::INFINITY
            } else {
                f64::from(self.state.grid.manhattan_distance(here, tile))
            }
        };
        // `away(a) - away(b)` is NaN for two nowhere, which reads as a tie.
        ids.sort_by(|a, b| away(a).partial_cmp(&away(b)).unwrap_or(Ordering::Equal).then_with(|| js::locale_cmp(a, b)));
        ids
    }

    /// The same order measured from a tile rather than a creature.
    pub(super) fn nearest_to_tile(&self, at: i32, ids: &[String]) -> Vec<String> {
        let mut ids = ids.to_vec();
        let away = |id: &str| self.state.grid.manhattan_distance(at, self.tile_of(id));
        ids.sort_by(|a, b| away(a).cmp(&away(b)).then_with(|| js::locale_cmp(a, b)));
        ids
    }

    /// Where a creature is standing, or `NO_TILE` for one that is nowhere.
    pub fn tile_of(&self, id: &str) -> i32 {
        self.state.entity(id).map_or(NO_TILE, |e| e.tile)
    }

    /// The clocks the fight is carrying, in the order they were armed.
    pub fn countdowns(&self) -> Vec<&RunningCountdown> {
        self.scenario.countdowns.entries().iter().map(|(_, c)| c).collect()
    }

    /// Something happened at the table: advance whatever was waiting on it. Playing what fired is the caller's.
    pub fn advance_countdowns(&mut self, cue: &CountdownCue, rng: &mut Rng) -> Result<Vec<CountdownMoved>, RangeError> {
        advance_board(&mut self.scenario.countdowns, cue, rng)
    }

    /// Countdowns whose owner has fallen: ended, or set off where the feature says. Not in this room is not
    /// dead: a clock the scenario carries on outlives the creature that did not follow it.
    pub fn reap_countdowns(&mut self) -> Vec<CountdownMoved> {
        let state = &self.state;
        reap_board(&mut self.scenario.countdowns, |id| match state.entity(id) {
            None => OwnerStatus::Gone,
            Some(e) if e.alive => OwnerStatus::Alive,
            Some(_) => OwnerStatus::Fallen,
        })
    }

    /// The fight is over: the clocks its creatures were counting stop.
    pub fn end_creature_countdowns(&mut self) {
        end_creature_countdowns(&mut self.scenario.countdowns);
    }

    /// How many of a domain's cards a character has active; nothing for anyone without a sheet.
    pub fn loadout_domain(&self, id: &str, domain: &str) -> Option<f64> {
        let character = self.content.characters.get(id)?;
        let active = loadout_of(character.sheet.loadout.as_deref(), &character.cards);
        Some(character.cards.iter().filter(|card| active.contains(&card.id) && card.domain.as_deref() == Some(domain)).count() as f64)
    }

    pub fn fighting(&self) -> bool {
        match &self.in_combat {
            Some(fighting) => fighting(&self.state),
            None => self.state.encounter_running(),
        }
    }

    /// The acting character's sheet, when the actor is a party member with one.
    pub(super) fn actor_character(&self) -> Option<&'w DerivedCharacter> {
        self.content.characters.get(self.scenario.actor_id.as_deref()?)
    }

    pub fn trait_modifier(&self, trait_: &str) -> f64 {
        Trait::from_name(trait_).and_then(|t| self.content.traits.get(&t).copied()).unwrap_or(0.0)
    }

    /// The modifier a check adds: the sheet's trait for a roll made as the actor, the party's best
    /// otherwise, and what the actor's cards add to any action roll - read from the actor's chair even when
    /// the trait is the party's. Spellcast and weapon checks are the actor's alone.
    pub fn check_modifier(&mut self, trait_: &str, as_: &str) -> Option<f64> {
        let character = self.actor_character();
        let actor = self.scenario.actor_id.clone();
        let any = match &actor {
            None => 0.0,
            Some(actor) => self.roll_bonus(actor, Stat::ActionRoll, false),
        };
        let score = |character: &DerivedCharacter, t: Option<Trait>| t.map_or(f64::NAN, |t| character.traits.of(t));
        if trait_ == "spellcast" {
            let (character, actor) = (character?, actor?);
            let cast = character.spellcast_trait?;
            return Some(character.traits.of(cast) + self.roll_bonus(&actor, Stat::SpellcastRoll, false));
        }
        if trait_ == "weapon" {
            let (character, actor) = (character?, actor?);
            let weapon = character.primary_weapon.as_ref();
            let wielded = weapon.map_or(UNARMED_TRAIT, |w| wielded_trait(character.spellcast_trait, w.trait_));
            let melee = weapon.map_or(UNARMED_RANGE, |w| w.range) == RangeBand::Melee;
            return Some(character.traits.of(wielded) + self.roll_bonus(&actor, Stat::AttackRoll, melee));
        }
        if let (Some(character), "actor") = (character, as_) {
            return Some(score(character, Trait::from_name(trait_)) + any);
        }
        Some(self.trait_modifier(trait_) + any)
    }

    /// The faces on a creature's Light Die: twelve, unless something it carries says more.
    pub fn good_die_sides(&self, id: &str) -> u32 {
        let Some(entity) = self.state.entity(id) else { return GOOD_DIE_SIDES };
        let mut sides = f64::from(GOOD_DIE_SIDES);
        for name in &entity.conditions {
            if let Some(die) = self.condition(name).and_then(|def| def.good_die) {
                sides = js::max(sides, die.sides);
            }
        }
        sides as u32
    }

    // ---- marked spots --------------------------------------------------------------------------------

    pub fn mark_spot(&mut self, actor: &str, mark: &str) -> bool {
        let tile = self.tile_of(actor);
        if tile == NO_TILE {
            return false;
        }
        self.scenario.variables.set(&mark_key(mark, actor), json!(tile));
        true
    }

    /// Where a mark was made, or `NO_TILE`. The TypeScript hands back any number on the map's range; a
    /// fractional one, which only a script writing the variable itself makes, comes back truncated here.
    pub fn recall_spot(&self, actor: &str, mark: &str) -> i32 {
        match self.scenario.variables.get(&mark_key(mark, actor)).and_then(Value::as_f64) {
            Some(tile) if tile >= 0.0 && tile < f64::from(self.state.grid.size()) => tile as i32,
            _ => NO_TILE,
        }
    }

    pub fn forget_spot(&mut self, actor: &str, mark: &str) -> bool {
        self.scenario.variables.delete(&mark_key(mark, actor))
    }

    /// Every spot anybody has marked, in the variables' order.
    pub fn marks(&self) -> Vec<Mark> {
        self.scenario
            .variables
            .entries()
            .iter()
            .filter_map(|(name, value)| {
                let (mark, owner) = parse_mark_key(name)?;
                Some(Mark { mark: mark.into(), owner: owner.into(), tile: value.as_f64()? })
            })
            .collect()
    }

    /// Forget every mark: the party rested, or left the room the tiles were in.
    pub fn forget_spots(&mut self) {
        let names: Vec<String> = self.scenario.variables.entries().iter().map(|(k, _)| k.clone()).filter(|k| parse_mark_key(k).is_some()).collect();
        for name in names {
            self.scenario.variables.delete(&name);
        }
    }

    /// Whether anybody in the party holds a card that answers a roll this creature has just made, its gate
    /// read with the roller bound.
    pub fn answers_roll(&mut self, id: &str, roll: &Value) -> bool {
        if self.state.entity(id).map(|e| e.faction) != Some(Faction::Party) {
            return false;
        }
        let bindings = TargetBindings { targets: vec![id.into()], hit: vec![id.into()], roll: serde_json::from_value(roll.clone()).ok(), ..TargetBindings::default() };
        let members: Vec<String> = self.state.entities_of(Faction::Party).filter(|e| e.alive).map(|e| e.id.clone()).collect();
        members.iter().any(|member| self.reactions_for(member, "partyRolling", Some(&bindings)).iter().any(|a| !a.effects.is_empty()))
    }

    /// What the roller's own cards put behind a roll that can be saved: the least tokens that carry it over
    /// the Difficulty, card by card, and nothing when even the whole card would not be enough.
    pub fn lift_roll(&mut self, id: &str, trait_: &str, total: f64, difficulty: f64, critical: bool) -> f64 {
        if critical || total >= difficulty || !difficulty.is_finite() {
            return 0.0;
        }
        let mut lifted = 0.0;
        for ability in self.held_by(id) {
            let Some(lift) = &ability.lift else { continue };
            if lift.only == "spellcast" && trait_ != "spellcast" {
                continue;
            }
            let held = self.tokens_on(id, &ability.id);
            if held == 0.0 {
                continue;
            }
            let short = difficulty - (total + lifted);
            if short <= 0.0 {
                break;
            }
            let wanted = (short / lift.each).ceil();
            if wanted > held {
                continue;
            }
            lifted += self.spend_tokens(id, &ability.id, wanted) * lift.each;
        }
        lifted
    }

    pub fn hook_defined(&self, id: &str) -> bool {
        self.hooks.defined(id)
    }

    // ---- what stops a creature -----------------------------------------------------------------------

    /// The conditions on a creature that stop it from doing this.
    pub fn blocking(&self, id: &str, what: ConditionBlock) -> Vec<String> {
        let Some(entity) = self.state.entity(id) else { return Vec::new() };
        entity.conditions.iter().filter(|c| self.condition(c).is_some_and(|def| def.blocks.contains(&what))).cloned().collect()
    }

    pub fn blocks(&self, id: &str, what: ConditionBlock) -> bool {
        !self.blocking(id, what).is_empty()
    }

    /// The Armor Slots a creature can mark: all of them marked, as far as a defence goes, under a condition
    /// that forbids armour.
    pub fn armor_for(&self, id: &str) -> crate::rules::resources::MarkPool {
        let Some(entity) = self.state.entity(id) else { return crate::rules::resources::create_mark_pool(0.0, 0.0) };
        let mut slots = entity.armor_slots;
        if self.blocks(id, ConditionBlock::Armor) {
            slots.marked = slots.max;
        }
        slots
    }

    /// Conditions that end when an attack succeeds against their bearer.
    pub fn ends_on_hit(&mut self, id: &str) -> Vec<String> {
        self.end_conditions(id, EndsWhen::Hit)
    }

    /// Conditions that end when damage marks something of their bearer's.
    pub fn ends_on_damage(&mut self, id: &str) -> Vec<String> {
        self.end_conditions(id, EndsWhen::Damaged)
    }

    /// Conditions that end when their bearer makes an attack.
    pub fn ends_on_attack(&mut self, id: &str) -> Vec<String> {
        self.end_conditions(id, EndsWhen::Attacks)
    }

    /// Conditions that end when their bearer makes an action roll of any kind.
    pub fn ends_on_roll(&mut self, id: &str) -> Vec<String> {
        self.end_conditions(id, EndsWhen::Rolls)
    }

    fn end_conditions(&mut self, id: &str, when: EndsWhen) -> Vec<String> {
        let defs = &self.content.condition_defs;
        let Some(entity) = self.state.entity_mut(id) else { return Vec::new() };
        let ended: Vec<String> = entity.conditions.iter().filter(|c| defs.get(*c).and_then(|def| def.ends_when) == Some(when)).cloned().collect();
        entity.conditions.retain(|c| !ended.contains(c));
        entity.condition_durations.retain(|(c, _)| !ended.contains(c));
        ended
    }

    // ---- sheets and stat blocks ----------------------------------------------------------------------

    /// How far a character's weapon reaches, or nothing for anyone without one.
    pub fn weapon_range(&self, id: &str) -> Option<RangeBand> {
        let character = self.content.characters.get(id)?;
        Some(character.primary_weapon.as_ref().map_or(UNARMED_RANGE, |w| w.range))
    }

    /// A character's primary weapon dice (unarmed when they carry none); an adversary's attack.
    pub fn weapon_damage(&self, id: &str) -> Option<ParsedDamage> {
        if let Some(character) = self.content.characters.get(id) {
            return Some(crate::character::sheet::attack_profile(character, crate::character::sheet::Hand::Primary).damage);
        }
        let entity = self.state.entity(id)?;
        Some(self.content.adversaries.get(&entity.definition)?.attack_damage.clone())
    }

    pub fn experiences(&self) -> Vec<Value> {
        self.actor_character().map(|c| c.experiences.iter().map(|e| json!({ "name": e.name, "modifier": e.modifier })).collect()).unwrap_or_default()
    }

    pub fn difficulty_of(&mut self, id: &str) -> Option<f64> {
        let entity = self.state.entity(id)?.clone();
        Some(self.defender_of(&entity).difficulty)
    }

    pub fn has_condition(&self, id: &str, condition: &str) -> bool {
        self.state.entity(id).is_some_and(|e| e.has_condition(condition))
    }

    pub fn pool_value(&self, id: &str, pool: &str, measure: &str) -> Option<f64> {
        let entity = self.state.entity(id)?;
        if pool == "good" {
            let good = entity.good?;
            return Some(match measure {
                "max" => good.max,
                "marked" => good.max - good.value,
                _ => good.value,
            });
        }
        let track = match pool {
            "hitPoints" => entity.hit_points,
            "stress" => entity.stress,
            "armorSlots" => entity.armor_slots,
            _ => return None,
        };
        Some(match measure {
            "max" => track.max,
            "marked" => track.marked,
            _ => unmarked(&track),
        })
    }

    /// The band between two creatures, from where one stands to where the other does.
    pub fn band_to(&self, from: &str, to: &str) -> Option<RangeBand> {
        let standing = |e: Option<&EntityState>| e.map(|e| Standing { tile: e.tile, x: e.at.x, y: e.at.y });
        band_between_standing(standing(self.state.entity(from)), standing(self.state.entity(to)), self.content.table())
    }

    /// The same measure between two tiles: as the crow flies, to the nearest tile.
    pub fn band_between(&self, a: i32, b: i32) -> Option<RangeBand> {
        if a == NO_TILE || b == NO_TILE {
            return None;
        }
        Some(band_for_span(self.state.grid.euclidean_distance(a, b), self.content.table()))
    }

    pub(super) fn within(&self, from: &str, to: &str, range: RangeBand) -> bool {
        self.band_to(from, to).is_some_and(|band| reaches(band, range))
    }

    /// Every living creature within `range` of the straight line from a tile to a tile: the far end in, the
    /// near one out, the line the one sight is traced along.
    pub fn along_path(&self, from: i32, to: i32, range: RangeBand, except: &[String]) -> Vec<String> {
        if from == NO_TILE || to == NO_TILE {
            return Vec::new();
        }
        let mut walked = Vec::new();
        trace_line(&self.state.grid, from, to, |tile, _| {
            walked.push(tile);
            true
        });
        let line: Vec<i32> = walked.into_iter().filter(|&tile| tile != from).collect();
        let standing: Vec<&EntityState> = self.state.entities_of(Faction::Party).chain(self.state.entities_of(Faction::Adversary)).collect();
        standing
            .into_iter()
            .filter(|e| e.alive && e.tile != NO_TILE && !except.contains(&e.id))
            .filter(|e| line.iter().any(|&tile| self.band_between(tile, e.tile).is_some_and(|band| reaches(band, range))))
            .map(|e| e.id.clone())
            .collect()
    }

    pub fn proficiency_of(&self, id: &str) -> f64 {
        self.content.characters.get(id).map_or(1.0, |c| c.proficiency)
    }

    /// A trait off a creature's sheet, the one they cast with, or their Proficiency; nothing for a stat block.
    pub fn trait_value(&self, id: &str, trait_: &str) -> Option<f64> {
        match trait_ {
            "spellcast" => self.spellcast_value(id),
            "proficiency" => self.content.characters.contains_key(id).then(|| self.proficiency_of(id)),
            _ => {
                let character = self.content.characters.get(id)?;
                Trait::from_name(trait_).map(|t| character.traits.of(t))
            }
        }
    }

    pub fn spellcast_value(&self, id: &str) -> Option<f64> {
        let character = self.content.characters.get(id)?;
        Some(character.traits.of(character.spellcast_trait?))
    }

    // ---- tokens --------------------------------------------------------------------------------------

    pub fn tokens_on(&self, id: &str, ability: &str) -> f64 {
        self.scenario.ability_tokens.get(&use_key(id, ability)).copied().unwrap_or(0.0)
    }

    /// Put tokens on a card; with no amount, the card's own count.
    pub fn add_tokens(&mut self, id: &str, ability: &str, amount: Option<f64>) -> f64 {
        let key = use_key(id, ability);
        let placed = amount.unwrap_or_else(|| self.token_count(id, ability));
        let left = js::max(0.0, self.scenario.ability_tokens.get(&key).copied().unwrap_or(0.0) + placed);
        self.scenario.ability_tokens.set(&key, left);
        left
    }

    pub fn spend_tokens(&mut self, id: &str, ability: &str, amount: f64) -> f64 {
        let key = use_key(id, ability);
        let held = self.scenario.ability_tokens.get(&key).copied().unwrap_or(0.0);
        let spent = js::min(held, js::max(0.0, amount));
        self.scenario.ability_tokens.set(&key, held - spent);
        spent
    }

    /// How many tokens the card places at once, for whoever holds it, with its minimum.
    pub fn token_count(&self, id: &str, ability: &str) -> f64 {
        let Some(tokens) = self.content.abilities.iter().find(|a| a.id == ability).and_then(|a| a.tokens.as_ref()) else { return 0.0 };
        let amount = match &tokens.amount {
            TokenAmount::Count(n) => *n,
            TokenAmount::Read(what) if what == "spellcast" => self.spellcast_value(id).unwrap_or(0.0),
            TokenAmount::Read(what) if what == "domainCards" => self.loadout_domain(id, tokens.domain.as_deref().unwrap_or("")).unwrap_or(0.0),
            TokenAmount::Read(what) => self.trait_value(id, what).unwrap_or(0.0),
        };
        js::max(tokens.minimum, amount)
    }
}
