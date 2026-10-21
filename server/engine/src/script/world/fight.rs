//! What an ability does to a creature in a fight: how it is attacked - its sheet's or stat block's numbers
//! with what its conditions and features add - the defence it puts up against one blow, the damage that
//! lands, an attack made from a script (a swarm piling in behind it), creatures summoned or stood in the
//! place of another, and a reaction roll.

use super::{Blow, SceneScriptWorld, WorldContent, FALLBACK_DIFFICULTY, FALLBACK_THRESHOLDS};
use crate::character::sheet::{attack_profile, Hand};
use crate::combat::attack::{apply_attack, resolve_attack, AttackOptions, AttackProfile, AttackRequest, AttackerKind, DefenderProfile};
use crate::combat::defense::{resolve_defense, ArmorPolicy, Defender, Defense};
use crate::combat::targeting::TargetingOptions;
use crate::content::abilities::Stat;
use crate::grid::tile_grid::NO_TILE;
use crate::js;
use crate::rng::Rng;
use crate::rules::damage::{is_severe, resolve_damage, DamageSeverity, DamageThresholds, IncomingDamage, ResolveDamageOptions};
use crate::rules::dice::{format_dice, parse_dice};
use crate::rules::duality::{roll_duality, DualityRollOptions};
use crate::rules::gm_die::{roll_gm_die, GmRollOptions};
use crate::rules::jump::Trait;
use crate::rules::range::{band_for_span, RangeBand, RANGE_BANDS};
use crate::rules::resources::unmarked;
use crate::scene::state::{create_adversary_entity, EntityState, Faction};
use crate::script::runner::{Arrived, AttackSummary, DealtDamage, DefendedWith, ReactionRolled};
use serde::Deserialize;

/// An attack a script asks for: who swings at whom, with what, and whatever the feature says beyond it.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackAsked {
    pub attacker: String,
    pub target: String,
    /// `primary` or `secondary`.
    pub weapon: String,
    #[serde(default)]
    pub advantage: Option<f64>,
    #[serde(default)]
    pub damage_bonus: Option<f64>,
    /// Dice in place of the weapon's.
    #[serde(default)]
    pub damage: Option<String>,
    /// Reach for this swing, when a feature says further than the block does.
    #[serde(default)]
    pub range: Option<RangeBand>,
    /// Damage no Armor Slot reduces.
    #[serde(default)]
    pub direct: Option<bool>,
    /// Creatures that pile in behind this one, resolved already.
    #[serde(default)]
    pub joined_by: Option<Vec<String>>,
}

fn refused(weapon: &str, why: &str) -> AttackSummary {
    AttackSummary {
        refused: Some(why.to_string()),
        weapon: weapon.to_string(),
        hit: false,
        reduced: None,
        joined: None,
        critical: false,
        hit_points_marked: 0.0,
        roll: None,
        damage: None,
        damage_dice: None,
        damage_types: None,
        good_gained: 0.0,
        bad_gained: 0.0,
        stress_cleared: 0.0,
        spotlight_to_gm: false,
    }
}

impl<'w> SceneScriptWorld<'w> {
    /// How a creature is attacked: its sheet's Evasion and thresholds, or its stat block's, with whatever its
    /// conditions and scene-gated features add.
    pub fn defender_of(&mut self, entity: &EntityState) -> DefenderProfile {
        let (difficulty, thresholds) = match self.content.characters.get(&entity.id) {
            Some(character) => (character.evasion, character.thresholds),
            None => match self.content.adversaries.get(&entity.definition) {
                Some(def) => (def.difficulty, def.thresholds),
                None => (FALLBACK_DIFFICULTY, FALLBACK_THRESHOLDS),
            },
        };
        let both = self.pool_bonus(&entity.id, Stat::Thresholds);
        let defenses = self.defenses_of(&entity.id);
        let empty = defenses.resistances.is_empty() && defenses.immunities.is_empty() && defenses.reduce.is_empty();
        let difficulty = difficulty + self.pool_bonus(&entity.id, Stat::Evasion);
        let major = thresholds.major + self.pool_bonus(&entity.id, Stat::MajorThreshold) + both;
        let severe = thresholds.severe + self.pool_bonus(&entity.id, Stat::SevereThreshold) + both;
        DefenderProfile { difficulty, thresholds: DamageThresholds { major, severe }, defenses: (!empty).then_some(defenses) }
    }

    /// Decide and pay the defence against one blow - Armor Slots and reactions under the world's policy -
    /// paying the Light and Stress the reactions cost. The caller marks what the result says. The reactions
    /// are read out of `content`, the world's own (`shared_content`), held by the caller.
    pub fn defend<'c>(&mut self, content: &'c WorldContent, id: &str, damage: &IncomingDamage, rng: &mut Rng) -> Defense<'c> {
        let Some(entity) = self.state.entity(id).cloned() else {
            return Defense { resolved: resolve_damage(damage, &FALLBACK_THRESHOLDS, &ResolveDamageOptions::default()), armor_slots_marked: 0.0, reactions: Vec::new(), good_spent: 0.0, stress_marked: 0.0 };
        };
        let against = self.defender_of(&entity);
        let armor_slots = self.armor_for(id);
        let reactions = self.reactions_for_in(content, id, "incomingDamage", None);
        let defender = Defender { thresholds: against.thresholds, defenses: against.defenses, armor_slots, stress: entity.stress, good: entity.good, reactions };
        let defense = resolve_defense(rng, damage, &defender, self.content.defense).expect("a defence's dice are whole");
        if defense.good_spent > 0.0 {
            self.spend_good(id, defense.good_spent);
        }
        if defense.stress_marked > 0.0 {
            self.mark_stress(id, defense.stress_marked);
        }
        defense
    }

    /// One damage event on one creature, out of a script: defended, marked, and heard with nobody named.
    pub fn deal_damage(&mut self, id: &str, damage: &IncomingDamage, rng: &mut Rng) -> DealtDamage {
        if !self.state.entity(id).is_some_and(|e| e.alive) {
            return DealtDamage { incoming: 0.0, reduced: 0.0, hp_marked: 0.0, armor_slots_spent: 0.0, fell: false, reactions: Vec::new() };
        }
        let content = self.shared_content();
        let defense = self.defend(&content, id, damage, rng);
        let resolved = defense.resolved;
        let entity = self.state.entity_mut(id).expect("still here");
        if resolved.armor_slots_spent > 0.0 {
            entity.armor_slots.marked += resolved.armor_slots_spent;
        }
        let marked = crate::rules::resources::mark_hit_points(&entity.hit_points, resolved.hp_marked);
        entity.hit_points = marked.hit_points;
        if marked.fell {
            entity.alive = false;
        }
        if resolved.hp_marked > 0.0 || resolved.armor_slots_spent > 0.0 {
            self.ends_on_damage(id);
        }
        if resolved.hp_marked > 0.0 || resolved.severity != DamageSeverity::None {
            self.note_damage(id, Blow { hit_points: Some(resolved.hp_marked), damage: Some(resolved.incoming), types: Some(damage.types.clone()), severe: Some(is_severe(resolved.severity)), ..Blow::default() });
        }
        DealtDamage {
            incoming: resolved.incoming,
            reduced: resolved.reduced,
            hp_marked: marked.hp_marked,
            armor_slots_spent: resolved.armor_slots_spent,
            fell: marked.fell,
            reactions: defense.reactions.iter().map(|r| DefendedWith { name: r.ability.name.clone(), good_spent: r.good_spent, stress_marked: r.stress_marked, rolled: r.rolled }).collect(),
        }
    }

    /// An attack made from a script: a character swings a weapon, a creature what its block prints, with
    /// what the feature says on top; the rest of its kind pile in first, one roll and the damage once each.
    pub fn attack(&mut self, asked: &AttackAsked, rng: &mut Rng) -> AttackSummary {
        let Some(attacker) = self.state.entity(&asked.attacker).cloned() else { return refused("", "no weapon to attack with") };
        if !self.state.entity(&asked.target).is_some_and(|t| t.alive) {
            return refused("", "nothing to attack");
        }
        let stated = asked.damage.as_deref().and_then(parse_dice);
        let own = match self.content.characters.get(&asked.attacker) {
            Some(character) => Some(attack_profile(character, if asked.weapon == "secondary" { Hand::Secondary } else { Hand::Primary })),
            None => self.adversary_profile(&attacker.definition, Some((&asked.attacker, &asked.target))),
        };
        let Some(own) = own else { return refused("", "no weapon to attack with") };
        let mut profile = AttackProfile { damage: stated.unwrap_or(own.damage.clone()), range: asked.range.unwrap_or(own.range), direct: asked.direct.or(own.direct), ..own };
        let joined = match &asked.joined_by {
            None => Vec::new(),
            Some(ids) => self.walk_in(ids, &asked.attacker, &asked.target, profile.range),
        };
        if !joined.is_empty() {
            let times = joined.len() as f64 + 1.0;
            profile.damage.expression.count *= times;
            profile.damage.expression.modifier *= times;
        }
        let melee = profile.range == RangeBand::Melee;
        let target_now = self.state.entity(&asked.target).cloned().expect("still here");
        let defender = self.defender_of(&target_now);
        let bonus = self.roll_bonus(&asked.attacker, Stat::AttackRoll, melee);
        let damage_bonus = asked.damage_bonus.unwrap_or(0.0) + self.roll_bonus(&asked.attacker, Stat::DamageRoll, melee);
        let armor_slots_marked = if self.content.defense.armor == ArmorPolicy::Auto { js::min(1.0, unmarked(&target_now.armor_slots)) } else { 0.0 };
        let good_die_sides = self.good_die_sides(&asked.attacker);
        let scales = self.advantage_with(&asked.attacker, &asked.target, asked.advantage.unwrap_or(0.0));
        let options = AttackOptions {
            targeting: TargetingOptions { band_tiles: self.content.band_tiles, ..TargetingOptions::default() },
            bonus: Some(bonus),
            damage_bonus: Some(damage_bonus),
            armor_slots_marked: Some(armor_slots_marked),
            good_die_sides: Some(good_die_sides),
            advantage: Some(scales.advantage),
            disadvantage: Some(scales.disadvantage),
            ..AttackOptions::default()
        };
        let attacker_now = self.state.entity(&asked.attacker).cloned().expect("still here");
        let outcome = resolve_attack(rng, &AttackRequest { grid: &self.state.grid, attacker: &attacker_now, target: &target_now, profile: &profile, defender: &defender, options: &options }).expect("an attack's dice are whole");
        if let Some(why) = outcome.refused {
            let why = serde_json::to_value(why).expect("serializes");
            return refused(&profile.name, &format!("{}: {}", outcome.targeting.band_label, why.as_str().unwrap_or_default()));
        }
        let applied = apply_attack(&mut self.state, &outcome, true);
        self.ends_on_attack(&asked.attacker);
        if outcome.hit {
            self.ends_on_hit(&asked.target);
            if applied.hit_points_marked > 0.0 {
                self.ends_on_damage(&asked.target);
            }
            let severe = outcome.damage.is_some_and(|d| is_severe(d.severity));
            let blow = Blow {
                attacker: Some(asked.attacker.clone()),
                hit_points: Some(applied.hit_points_marked),
                damage: Some(outcome.damage_roll.as_ref().map_or(0.0, |r| r.total)),
                types: Some(profile.damage.types.clone().unwrap_or_default()),
                severe: Some(severe),
            };
            self.note_damage(&asked.target, blow);
        }
        AttackSummary {
            refused: None,
            weapon: profile.name.clone(),
            hit: outcome.hit,
            critical: outcome.critical,
            hit_points_marked: applied.hit_points_marked,
            reduced: outcome.damage.map(|d| d.reduced).filter(|r| *r != 0.0),
            joined: (!joined.is_empty()).then_some(joined),
            damage: outcome.damage_roll.as_ref().map(|r| r.total),
            damage_dice: outcome.damage_roll.as_ref().map(|r| format_dice(&r.expression)),
            damage_types: outcome.damage_roll.as_ref().map(|_| profile.damage.types.clone().unwrap_or_default()),
            roll: outcome.duality_roll.clone(),
            good_gained: applied.good_gained,
            bad_gained: applied.bad_gained,
            stress_cleared: applied.stress_cleared,
            spotlight_to_gm: outcome.spotlight_to_gm,
        }
    }

    /// Bring a swarm to the target - the one swinging among it - and keep the ones who got within reach.
    /// A creature that cannot move or act, or has had its turn, is left out.
    fn walk_in(&mut self, ids: &[String], attacker: &str, target: &str, reach: RangeBand) -> Vec<String> {
        let mut joined = Vec::new();
        if !self.within(attacker, target, reach) {
            self.draw_in(attacker, target, reach, RangeBand::Close);
        }
        for id in ids {
            if id == attacker || id == target {
                continue;
            }
            if !self.state.entity(id).is_some_and(|e| e.alive && e.tile != NO_TILE) {
                continue;
            }
            if self.blocks(id, crate::content::conditions::ConditionBlock::Act) || (self.spotlight_spent)(id) {
                continue;
            }
            if !self.within(id, target, reach) {
                self.draw_in(id, target, reach, RangeBand::Close);
            }
            if self.within(id, target, reach) {
                joined.push(id.clone());
            }
        }
        joined
    }

    /// What an adversary swings, from its stat block, with what its passives say against this target.
    fn adversary_profile(&mut self, definition: &str, between: Option<(&str, &str)>) -> Option<AttackProfile> {
        let content = self.shared_content();
        let def = content.adversaries.get(definition)?;
        let swing = self.standard_attack_of(definition, between);
        Some(AttackProfile {
            kind: AttackerKind::Adversary,
            name: def.attack_name.clone(),
            modifier: def.attack_modifier,
            range: def.attack_range,
            damage: swing.damage.unwrap_or_else(|| def.attack_damage.clone()),
            proficiency: None,
            direct: swing.direct.then_some(true),
            trait_: None,
            double: swing.double.then_some(true),
        })
    }

    /// Put creatures on the map at a band from whoever summoned them - a ring, falling inward when full.
    pub fn summon(&mut self, definition: &str, count: f64, range: RangeBand) -> Arrived {
        let summoner = self.scenario.actor_id.as_deref().and_then(|id| self.state.entity(id)).map(|e| e.tile);
        let Some(block) = self.content.adversaries.get(definition) else { return Arrived { refused: Some(format!("nothing is a \"{definition}\"")), ..Arrived::default() } };
        let Some(from) = summoner.filter(|&tile| tile != NO_TILE) else { return Arrived { refused: Some("nobody to summon them".into()), ..Arrived::default() } };
        let wanted = js::max(0.0, js::trunc(count));
        if wanted == 0.0 {
            return Arrived::default();
        }
        let mut placed = Vec::new();
        let mut i = 0.0;
        while i < wanted {
            i += 1.0;
            let Some(tile) = self.standing_room(from, range) else { break };
            let id = self.free_id(definition);
            self.state.add_entity(create_adversary_entity(&id, definition, tile, block.hit_points, block.stress, Faction::Adversary)).expect("a free id");
            placed.push(id);
        }
        if placed.is_empty() {
            return Arrived { refused: Some(format!("nowhere for a {} to stand", block.name)), ..Arrived::default() };
        }
        Arrived { ids: placed, ..Arrived::default() }
    }

    /// Take the creature acting off the map and stand others where it was, nothing marked. Only the GM's.
    pub fn replace(&mut self, definition: &str, count: f64) -> Arrived {
        let actor = self.scenario.actor_id.as_deref().and_then(|id| self.state.entity(id)).cloned();
        let Some(block) = self.content.adversaries.get(definition) else { return Arrived { refused: Some(format!("nothing is a \"{definition}\"")), ..Arrived::default() } };
        let Some(actor) = actor.filter(|a| a.tile != NO_TILE) else { return Arrived { refused: Some("nobody to replace".into()), ..Arrived::default() } };
        if actor.faction != Faction::Adversary {
            return Arrived { refused: Some("only the GM replaces a creature".into()), ..Arrived::default() };
        }
        let wanted = js::max(0.0, js::trunc(count));
        if wanted == 0.0 {
            return Arrived::default();
        }
        let was = self.content.adversaries.get(&actor.definition).map_or_else(|| actor.id.clone(), |def| def.name.clone());
        let tile = actor.tile;
        self.state.remove_entity(&actor.id);
        let mut placed = Vec::new();
        let mut i = 0.0;
        while i < wanted {
            let first = i == 0.0;
            i += 1.0;
            let Some(at) = (if first { Some(tile) } else { self.standing_room(tile, RangeBand::Melee) }) else { break };
            let id = self.free_id(definition);
            self.state.add_entity(create_adversary_entity(&id, definition, at, block.hit_points, block.stress, Faction::Adversary)).expect("a free id");
            placed.push(id);
        }
        if placed.is_empty() {
            return Arrived { refused: Some(format!("nowhere for a {} to stand", block.name)), ..Arrived::default() };
        }
        Arrived { ids: placed, was: Some(was), refused: None }
    }

    /// A free tile in that band around a tile, nearest first and lowest index on a tie; falls inward a
    /// band at a time when the band is full or off the map.
    fn standing_room(&self, from: i32, range: RangeBand) -> Option<i32> {
        let bands: Vec<RangeBand> = RANGE_BANDS.iter().copied().filter(|b| *b != RangeBand::OutOfRange).collect();
        let wanted = bands.iter().position(|b| *b == range)?;
        for band in bands[..=wanted].iter().rev() {
            let mut best: Option<i32> = None;
            let mut best_distance = f64::INFINITY;
            for tile in 0..self.state.grid.size() {
                if !self.state.body_free(tile, "") {
                    continue;
                }
                let distance = self.state.grid.euclidean_distance(from, tile);
                if distance == 0.0 || band_for_span(distance, self.content.table()) != *band {
                    continue;
                }
                if distance < best_distance || (distance == best_distance && best.is_none_or(|b| tile < b)) {
                    best = Some(tile);
                    best_distance = distance;
                }
            }
            if best.is_some() {
                return best;
            }
        }
        None
    }

    /// An id nothing in the room is using - the fallen keep theirs.
    fn free_id(&self, definition: &str) -> String {
        (1..).map(|n| format!("{definition}-s{n}")).find(|id| self.state.entity(id).is_none()).expect("ids run on")
    }

    /// A reaction roll: a d20 for a creature without a sheet, the Duality Dice - both faces handed back -
    /// for a party member.
    pub fn roll_reaction(&self, id: &str, difficulty: f64, trait_: &str, rng: &mut Rng) -> ReactionRolled {
        let Some(entity) = self.state.entity(id) else { return ReactionRolled { success: false, total: 0.0, roll: None } };
        match self.content.characters.get(id) {
            Some(character) if entity.faction != Faction::Adversary => {
                let modifier = Trait::from_name(trait_).map_or(f64::NAN, |t| character.traits.of(t));
                let roll = roll_duality(rng, &DualityRollOptions { difficulty, modifier: Some(modifier), reaction: Some(true), ..DualityRollOptions::default() }).expect("a d12 is whole");
                ReactionRolled { success: roll.success, total: roll.total, roll: Some(roll) }
            }
            _ => {
                let roll = roll_gm_die(rng, &GmRollOptions { difficulty, reaction: Some(true), ..GmRollOptions::default() }).expect("a d20 is whole");
                ReactionRolled { success: roll.success, total: roll.total, roll: None }
            }
        }
    }
}
