//! The GM's swing at a party member (`attackPartyMember`): the dice, what the room adds to the damage before
//! it lands (`boostDamage`), a rally's half (`halveIfRallied`), and the blow taken - the defence the engine
//! decides for the defender, an aura's help, a card's step down, the log's words, and what a landed blow
//! sets off (`landAttack`, `landedFeatures`). Asking the defender how they take it is `ask`'s.

use super::log::{name_of, note, the_name_of};
use super::rules::DEMO_BAND_TILES;
use super::session::Session;
use super::swing::{band_word, hit_point_word, worse};
use crate::combat::adversary_features::{adversary_traits, attack_damage_of};
use crate::combat::attack::{apply_attack, resolve_attack, AttackOptions, AttackOutcome, AttackProfile, AttackRequest, AttackerKind};
use crate::combat::targeting::TargetingOptions;
use crate::content::abilities::AbilityDef;
use crate::content::adversaries::AdversaryDef;
use crate::js;
use crate::rules::damage::{hp_for_severity, is_severe, reduce_severity, DamageSeverity, IncomingDamage, ResolvedDamage};
use crate::rules::range::{reaches, RangeBand};
use crate::rules::resources::gain;
use crate::scene::state::Faction;
use crate::script::conditions::TargetBindings;
use crate::script::runner::{RunnerOptions, ScriptRunner};
use crate::script::world::Blow;

/// One hit, as it stands while the defender decides (`IncomingAttack`).
#[derive(Clone, Debug, PartialEq)]
pub struct IncomingAttack {
    pub attacker: String,
    /// Who takes it.
    pub defender: String,
    pub outcome: AttackOutcome,
    /// The adversary's stat block, for the lines the log writes.
    pub def: AdversaryDef,
    /// The band a feature named for it mid-swing, in place of the dice.
    pub severity: Option<DamageSeverity>,
    /// Bands a card of the defender's stepped it down, after the armor.
    pub stepped: Option<f64>,
    /// Cards already spent against this hit, so one card fires once.
    pub used: Vec<String>,
}

/// What a reaction costs, as the log writes it (`costOf`).
pub(super) fn cost_of(ability: &AbilityDef) -> String {
    let good = ability.cost.good.map(|g| format!("{} Light", js::number_to_string(g))).unwrap_or_default();
    let stress = ability.cost.stress.map(|s| format!("{} Stress", js::number_to_string(s))).unwrap_or_default();
    [good, stress].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" and ")
}

impl Session {
    /// The GM's swing at a party member (`attackPartyMember`): whether it was made at all.
    pub(super) fn attack_party_member(&mut self, adversary_id: &str, target_id: &str) -> Result<bool, String> {
        let (Some(adversary), Some(target)) = (self.world.state.entity(adversary_id).cloned(), self.world.state.entity(target_id).cloned()) else { return Ok(false) };
        let character = self.characters.get(&target.id).map(|c| c.sheet.name.clone());
        let def = self.stat_block(adversary_id);
        let swing = self.world.standard_attack_of(&def.id, Some((adversary_id, target_id)));
        let profile = AttackProfile {
            kind: AttackerKind::Adversary,
            name: def.attack_name.clone(),
            modifier: def.attack_modifier,
            range: def.attack_range,
            damage: swing.damage.clone().unwrap_or_else(|| attack_damage_of(&def.features, &def.attack_damage, adversary.hit_points.marked, adversary.hit_points.max)),
            proficiency: None,
            direct: swing.direct.then_some(true),
            trait_: None,
            double: swing.double.then_some(true),
        };
        let defender = self.world.defender_of(&target);
        let scales = self.world.advantage_for(adversary_id, target_id);
        let options = AttackOptions {
            targeting: TargetingOptions { band_tiles: Some(DEMO_BAND_TILES), ..TargetingOptions::default() },
            armor_slots_marked: Some(0.0),
            advantage: Some(scales.advantage),
            disadvantage: Some(scales.disadvantage),
            ..AttackOptions::default()
        };
        let rolled = resolve_attack(&mut self.rng, &AttackRequest { grid: &self.world.state.grid, attacker: &adversary, target: &target, profile: &profile, defender: &defender, options: &options }).map_err(|e| e.0)?;
        if rolled.refused.is_some() {
            return Ok(false);
        }
        let owed = self.world.payouts_on(target_id, "attacked");
        self.play_payouts(adversary_id, target_id, owed, None)?;
        let (answered, severity) = self.boost_damage(adversary_id, target_id, rolled)?;
        let outcome = if severity.is_none() { self.halve_if_rallied(adversary_id, answered) } else { answered };
        let hit = outcome.hit && outcome.damage_roll.is_some();
        if !hit || character.is_none() {
            apply_attack(&mut self.world.state, &outcome, true);
            self.world.ends_on_attack(adversary_id);
            let who = the_name_of(self, adversary_id, false);
            note(self, &format!("{who}'s {} misses {}.", def.attack_name, character.unwrap_or_else(|| target.id.clone())), "combat");
            self.play_attacked_on(target_id, adversary_id)?;
            self.offer_miss(IncomingAttack { attacker: adversary_id.to_string(), defender: target_id.to_string(), outcome, def, severity: None, stepped: None, used: Vec::new() });
            return Ok(true);
        }
        let attack = IncomingAttack { attacker: adversary_id.to_string(), defender: target_id.to_string(), outcome, def, severity, stepped: None, used: Vec::new() };
        self.offer_or_land(attack)?;
        Ok(true)
    }

    /// Half the damage of a swing the creature only got to make because an ally said so (`halveIfRallied`).
    fn halve_if_rallied(&mut self, id: &str, outcome: AttackOutcome) -> AttackOutcome {
        let halved = self.gm_turn.as_ref().is_some_and(|t| t.halved.iter().any(|h| h == id));
        let Some(damage_roll) = outcome.damage_roll.clone().filter(|_| halved) else { return outcome };
        let total = (damage_roll.total / 2.0).ceil();
        let who = name_of(self, id);
        note(self, &format!("{who} strikes on somebody else's word, for half."), "combat");
        AttackOutcome { damage_roll: Some(crate::rules::damage::DamageRollResult { total, ..damage_roll }), ..outcome }
    }

    /// What the room adds to a blow that has landed and has not been counted yet (`boostDamage`).
    fn boost_damage(&mut self, attacker: &str, target: &str, outcome: AttackOutcome) -> Result<(AttackOutcome, Option<DamageSeverity>), String> {
        let Some(damage_roll) = outcome.damage_roll.clone().filter(|_| outcome.hit) else { return Ok((outcome, None)) };
        let bound = TargetBindings { targets: vec![target.to_string()], hit: vec![target.to_string()], ..TargetBindings::default() };
        let standing: Vec<String> = self.world.state.entities_of(Faction::Adversary).filter(|e| e.alive && e.id != attacker).map(|e| e.id.clone()).collect();
        let mut answering = vec![(attacker.to_string(), "rollingDamage")];
        answering.extend(standing.into_iter().map(|id| (id, "allyRollingDamage")));
        let mut added = 0.0;
        let mut band: Option<DamageSeverity> = None;
        for (id, trigger) in answering {
            for ability in self.world.reactions_for(&id, trigger, Some(&bound)) {
                if ability.effects.is_empty() || !self.affordable_reaction(&id, &ability) {
                    continue;
                }
                self.spend_feature_cost(&id, &ability, true);
                let was = self.world.scenario.actor_id.replace(id.clone());
                let options = RunnerOptions { targets: Some(vec![target.to_string()]), hit: Some(vec![target.to_string()]), roll_as: Some("actor".into()), ..RunnerOptions::default() };
                let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
                runner.run(&ability.effects);
                let journal = runner.entries().to_vec();
                drop(runner);
                self.record(&journal)?;
                self.world.scenario.actor_id = was;
                for entry in &journal {
                    if entry["kind"] == "damageBoosted" {
                        added += entry["by"].as_f64().unwrap_or(0.0);
                    }
                    if entry["kind"] == "severityForced" {
                        if let Ok(severity) = serde_json::from_value::<DamageSeverity>(entry["severity"].clone()) {
                            band = Some(worse(band, severity));
                        }
                    }
                }
                self.after_adversary_script(&journal);
            }
        }
        if let Some(band) = band {
            note(self, &format!("The blow lands as {} damage.", band_word(band)), "bad");
            return Ok((outcome, Some(band)));
        }
        if added <= 0.0 {
            return Ok((outcome, None));
        }
        note(self, &format!("The blow lands harder by {}.", js::number_to_string(added)), "bad");
        let total = damage_roll.total + added;
        Ok((AttackOutcome { damage_roll: Some(crate::rules::damage::DamageRollResult { total, ..damage_roll }), ..outcome }, None))
    }

    /// The damage a hit is carrying right now (`incomingOf`).
    pub(super) fn incoming_of(&mut self, attack: &IncomingAttack) -> IncomingDamage {
        let swing = self.world.standard_attack_of(&attack.def.id, Some((&attack.attacker, &attack.defender)));
        IncomingDamage {
            amount: attack.outcome.damage_roll.as_ref().map_or(0.0, |d| d.total),
            types: attack.def.attack_damage.types.clone().unwrap_or_default(),
            direct: swing.direct,
            severity: attack.severity.or(swing.severity),
        }
    }

    /// Take the hit (`landAttack`): with the plan the defender chose - Armor Slots and reactions - or with the
    /// one the engine decides when nobody was asked.
    pub(super) fn land_attack(&mut self, attack: IncomingAttack, plan: Option<(f64, Vec<crate::content::abilities::AbilityDef>)>) -> Result<(), String> {
        if self.world.state.entity(&attack.defender).is_none() {
            return Ok(());
        }
        let Some(holder) = self.holder(&attack.defender) else { return Ok(()) };
        let who = name_of(self, &attack.defender);
        let damage = self.incoming_of(&attack);
        let content = self.world.shared_content();
        let defense = match &plan {
            None => self.world.defend(&content, &attack.defender, &damage, &mut self.rng),
            Some((armor_slots, reactions)) => {
                let chosen = crate::combat::defense::DefensePlan { armor_slots: *armor_slots, reactions: reactions.iter().collect() };
                let defense = crate::combat::defense::resolve_defense_plan(&mut self.rng, &damage, &holder.defender(), &chosen).map_err(|e| e.0)?;
                let (good, stress) = (defense.good_spent, defense.stress_marked);
                if good > 0.0 {
                    self.world.spend_good(&attack.defender, good);
                }
                if stress > 0.0 {
                    self.world.mark_stress(&attack.defender, stress);
                }
                defense
            }
        };
        for used in &defense.reactions {
            let cost = cost_of(used.ability);
            let rolled = used.rolled.map(|r| format!(" ({})", js::number_to_string(r))).unwrap_or_default();
            let cost = if cost.is_empty() { String::new() } else { format!(", {cost}") };
            note(self, &format!("{who}: {}{rolled}{cost}.", used.ability.name), "good");
        }
        let resolved = defense.resolved;
        let aid = self.world.armor_aid(&attack.defender);
        let aided = if aid.steps <= 0.0 || resolved.armor_slots_spent <= 0.0 || resolved.hp_marked <= 0.0 {
            resolved
        } else {
            let band = reduce_severity(resolved.final_severity, aid.steps);
            note(self, &format!("The aura around {who} takes it down to {}.", band_word(band)), "good");
            ResolvedDamage { final_severity: band, hp_marked: hp_for_severity(band), ..resolved }
        };
        if !aid.ends_when_it_saves.is_empty() && resolved.hp_marked > 0.0 && aided.hp_marked == 0.0 {
            for name in &aid.ends_when_it_saves {
                self.world.clear_condition(&attack.defender, name);
            }
            note(self, &format!("The aura around {who} goes out."), "good");
        }
        let resolved = match attack.stepped.filter(|&s| s > 0.0) {
            None => aided,
            Some(stepped) => {
                let band = reduce_severity(aided.final_severity, stepped);
                note(self, &format!("{who} rides it down to {}.", band_word(band)), "good");
                ResolvedDamage { final_severity: band, hp_marked: hp_for_severity(band), ..aided }
            }
        };
        let hit_points = resolved.hp_marked;
        let critical = attack.outcome.critical;
        let last = AttackOutcome { target_id: attack.defender.clone(), damage: Some(resolved), hit_points_marked: hit_points, ..attack.outcome.clone() };
        apply_attack(&mut self.world.state, &last, true);
        self.world.ends_on_attack(&attack.attacker);
        self.world.note_damage(&attack.defender, Blow { attacker: Some(attack.attacker.clone()), hit_points: Some(hit_points), damage: Some(damage.amount), types: Some(damage.types.clone()), severe: Some(is_severe(resolved.final_severity)) });
        self.landed_features(&attack, hit_points)?;
        self.play_attacked_on(&attack.defender, &attack.attacker)?;
        let mut ended = self.world.ends_on_hit(&attack.defender);
        if hit_points > 0.0 {
            ended.extend(self.world.ends_on_damage(&attack.defender));
        }
        for condition in ended {
            note(self, &format!("{who} is no longer {condition}."), "system");
        }
        self.note_reduction(&who, Some(&resolved));
        let by = the_name_of(self, &attack.attacker, false);
        let line = if hit_points == 0.0 {
            format!("{by}'s {} hits {who}, and is turned aside.", attack.def.attack_name)
        } else {
            format!("{by}'s {} {} {who}: {}.", attack.def.attack_name, if critical { "tears into" } else { "hits" }, hit_point_word(hit_points))
        };
        note(self, &line, "combat");
        self.settle_fight()
    }

    /// What a successful attack does beyond its damage (`landedFeatures`): Momentum, Terrifying, the riders.
    fn landed_features(&mut self, attack: &IncomingAttack, hit_points: f64) -> Result<(), String> {
        let traits = adversary_traits(&attack.def.features);
        let mut bad = 0.0;
        if traits.momentum {
            bad += 1.0;
        }
        if traits.terrifying {
            bad += 1.0;
            let mut shaken = Vec::new();
            let members: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
            for member in members {
                let Some(entity) = self.world.state.entity(&member).filter(|e| e.alive && e.good.is_some()) else { continue };
                let good = entity.good.expect("carries Light");
                let near = self.world.band_to(&attack.attacker, &member).is_some_and(|band| reaches(band, RangeBand::Close));
                if !near || good.value <= 0.0 {
                    continue;
                }
                self.world.state.entity_mut(&member).expect("standing").good = Some(crate::rules::resources::Currency { value: good.value - 1.0, ..good });
                shaken.push(name_of(self, &member));
            }
            if !shaken.is_empty() {
                note(self, &format!("Terrifying: {} lose a Light.", shaken.join(", ")), "bad");
            }
        }
        if bad > 0.0 {
            let gained = gain(&self.world.state.bad, bad);
            self.world.state.bad = gained.currency;
            if gained.applied > 0.0 {
                note(self, &format!("The GM gains {} Shadow.", js::number_to_string(gained.applied)), "bad");
            }
        }
        self.play_attack_riders(&attack.attacker, &attack.defender, hit_points, None)
    }
}

