//! The party's swing (`attackWithSelected`, `afterRolled`, `landPartyAttack`): out of reach it closes, the
//! dice are thrown, what the room says about the roll and the damage is heard, and the blow lands - counted
//! again when a card grew it, named its band or forced its Hit Points (`counted`, `atLeast`, `rolled`), and
//! rebuilt when a card threw the dice again (`asAnswered`, `asRerolled`). Minions fall to it
//! (`defeatMinions`).

use super::answer::{bound_roll, Moment};
use super::log::{describe_roll, float, name_of, note, struck, swung_at, the_name_of, RollShow};
use super::rules::DEMO_BAND_TILES;
use super::session::Session;
use crate::character::sheet::{attack_profile, Hand};
use crate::combat::adversary_features::adversary_traits;
use crate::combat::attack::{apply_attack, apply_roll, resolve_attack, AttackOptions, AttackOutcome, AttackRequest};
use crate::combat::targeting::TargetingOptions;
use crate::content::abilities::Stat;
use crate::rules::damage::{hp_for_severity, is_severe, resolve_damage, roll_reduction, DamageSeverity, IncomingDamage, ResolveDamageOptions, ResolvedDamage};
use crate::rules::dice::{roll_dice, DamageType, DiceExpression, ParsedDamage};
use crate::rules::duality::{with_faces, DualityRoll};
use crate::rules::range::{reaches, RangeBand};
use crate::rules::resources::unmarked;
use crate::scene::state::Faction;
use crate::script::world::Blow;
use serde::Serialize;
use serde_json::{Map, Value};

/// A swing of the party's that has hit and not yet been counted, held while the room decides what to put
/// behind it (`HeldSwing`).
#[derive(Clone, Debug, PartialEq)]
pub struct HeldSwing {
    pub attacker: String,
    pub target: String,
    pub outcome: AttackOutcome,
    /// The weapon's name, for the line the log writes when it lands.
    pub weapon: String,
    pub melee: bool,
    pub damage: ParsedDamage,
    pub direct: Option<bool>,
    /// What the room put behind it while it was held.
    pub boost: Option<f64>,
    /// The roll counts twice.
    pub doubled: bool,
    /// And counts as this instead of the weapon's own kind of damage.
    pub types: Option<Vec<DamageType>>,
    /// Hit Points a card fixed outright.
    pub forced: Option<f64>,
    /// Or the band it lands in, which armor can still step down.
    pub severity: Option<DamageSeverity>,
    /// Or the band it lands in at worst.
    pub floor: Option<DamageSeverity>,
    /// Stopped after the Duality Dice and before anything came of them (`stage: 'rolled'`).
    pub stage_rolled: bool,
    /// The roll has paid out already, so landing counts only the blow.
    pub settled: bool,
}

/// What a swing came to (`attackWithSelected`'s answer).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwingResult {
    pub hit: bool,
    pub refused: Option<String>,
    pub hit_points_marked: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting: Option<bool>,
}

fn rank(severity: DamageSeverity) -> u8 {
    match severity {
        DamageSeverity::None => 0,
        DamageSeverity::Minor => 1,
        DamageSeverity::Major => 2,
        DamageSeverity::Severe => 3,
        DamageSeverity::Massive => 4,
    }
}

/// The harder of two bands (`worse`).
pub(super) fn worse(a: Option<DamageSeverity>, b: DamageSeverity) -> DamageSeverity {
    match a {
        Some(a) if rank(a) >= rank(b) => a,
        _ => b,
    }
}

/// What band a blow that skipped the thresholds counts as (`severityOfHitPoints`).
fn severity_of_hit_points(marked: f64) -> DamageSeverity {
    if marked >= 4.0 {
        DamageSeverity::Massive
    } else if marked >= 3.0 {
        DamageSeverity::Severe
    } else if marked >= 2.0 {
        DamageSeverity::Major
    } else {
        DamageSeverity::Minor
    }
}

/// What lifting the lowest die to its highest face is worth (`liftLowest`).
fn lift_lowest(roll: &crate::rules::damage::DamageRollResult) -> f64 {
    match roll.roll.rolls.iter().min() {
        None => 0.0,
        Some(&low) => crate::js::max(0.0, roll.expression.sides - f64::from(low)),
    }
}

pub(super) fn hit_point_word(n: f64) -> String {
    format!("{} Hit Point{}", crate::js::number_to_string(n), if n == 1.0 { "" } else { "s" })
}

/// A band as the log names it.
pub(super) fn band_word(band: DamageSeverity) -> &'static str {
    match band {
        DamageSeverity::None => "nothing",
        DamageSeverity::Minor => "minor",
        DamageSeverity::Major => "major",
        DamageSeverity::Severe => "severe",
        DamageSeverity::Massive => "massive",
    }
}

fn refusal_word(outcome: &AttackOutcome) -> Option<String> {
    outcome.refused.map(|why| serde_json::to_value(why).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default())
}

impl Session {
    /// A creature on nobody's side with something to say (`talksTo`).
    pub(super) fn talks_to(&self, id: &str) -> bool {
        self.world.state.entity(id).is_some_and(|e| e.alive && e.faction == Faction::Neutral) && self.placement_of(id).is_some_and(|(p, _)| !p["interaction"].is_null())
    }

    /// A blow at one who stood down starts the fight again (`resumeOnBlow`).
    pub(super) fn resume_on_blow(&mut self, target: &str) {
        if self.world.state.entity(target).and_then(|e| e.truce) != Some(true) || self.in_combat() {
            return;
        }
        let Some((_, encounter)) = self.placement_of(target) else { return };
        if self.encounter.as_ref().is_some_and(|e| e.encounter_id == encounter) {
            self.encounter = None;
        }
        self.start_encounter(&encounter);
    }

    /// The selected character attacks (`attackWithSelected`): nothing when the swing could not be tried.
    pub fn attack_with_selected(&mut self, target_id: &str) -> Result<Option<SwingResult>, String> {
        if self.busy() {
            return Ok(None);
        }
        let Some(id) = self.party.selected().map(str::to_string) else { return Ok(None) };
        let Some(character) = self.characters.get(&id).cloned() else { return Ok(None) };
        if self.world.state.entity(&id).is_none() || self.world.state.entity(target_id).is_none() {
            return Ok(None);
        }
        if self.in_combat() && !self.encounter.as_ref().expect("a fight").can_act(&self.world.state, &id) {
            return Ok(None);
        }
        if self.talks_to(target_id) {
            let talked = self.talk_to(&id, target_id)?;
            return Ok(Some(SwingResult { hit: false, refused: None, hit_points_marked: 0.0, waiting: Some(talked.status == "waiting") }));
        }
        self.resume_on_blow(target_id);
        let profile = attack_profile(&character, Hand::Primary);
        if self.close_to_strike(&id, target_id, profile.range) == "short" {
            return Ok(Some(SwingResult { hit: false, refused: Some("outOfRange".into()), hit_points_marked: 0.0, waiting: None }));
        }
        let melee = profile.range == RangeBand::Melee;
        let attacker = self.world.state.entity(&id).cloned().expect("standing");
        let target = self.world.state.entity(target_id).cloned().expect("standing");
        let defender = self.world.defender_of(&target);
        let bonus = self.world.roll_bonus(&id, Stat::AttackRoll, melee);
        let damage_bonus = self.world.roll_bonus(&id, Stat::DamageRoll, melee);
        let good_die_sides = self.world.good_die_sides(&id);
        let scales = self.world.advantage_for(&id, target_id);
        let options = AttackOptions {
            targeting: TargetingOptions { band_tiles: Some(DEMO_BAND_TILES), ..TargetingOptions::default() },
            bonus: Some(bonus),
            damage_bonus: Some(damage_bonus),
            good_die_sides: Some(good_die_sides),
            advantage: Some(scales.advantage),
            disadvantage: Some(scales.disadvantage),
            ..AttackOptions::default()
        };
        let outcome = resolve_attack(&mut self.rng, &AttackRequest { grid: &self.world.state.grid, attacker: &attacker, target: &target, profile: &profile, defender: &defender, options: &options }).map_err(|e| e.0)?;
        if outcome.refused.is_some() {
            return Ok(Some(SwingResult { hit: false, refused: refusal_word(&outcome), hit_points_marked: 0.0, waiting: None }));
        }
        let mut held = HeldSwing {
            attacker: id.clone(),
            target: target_id.to_string(),
            weapon: profile.name.clone(),
            melee,
            damage: profile.damage.clone(),
            direct: profile.direct,
            outcome,
            boost: None,
            doubled: false,
            types: None,
            forced: None,
            severity: None,
            floor: None,
            stage_rolled: false,
            settled: false,
        };
        let Some(roll) = held.outcome.duality_roll.clone() else { return self.after_rolled(held).map(Some) };
        let groups = self.rolling_offers(&id, &roll, Some(&mut held), None, profile.trait_.map(|t| t.name().to_string()))?;
        if self.waiting() {
            return Ok(Some(SwingResult { hit: held.outcome.hit, refused: None, hit_points_marked: 0.0, waiting: Some(true) }));
        }
        if !groups.is_empty() && self.ask_defender {
            let mut groups = groups;
            let first = groups.remove(0);
            let hit = held.outcome.hit;
            self.ask_reaction(first, groups, Some(HeldSwing { stage_rolled: true, ..held }), None);
            return Ok(Some(SwingResult { hit, refused: None, hit_points_marked: 0.0, waiting: Some(true) }));
        }
        self.after_rolled(held).map(Some)
    }

    /// Who in the party has something to say about a roll just made, before anything comes of it
    /// (`rollingOffers`).
    pub(super) fn rolling_offers(&mut self, roller: &str, roll: &DualityRoll, mut landing: Option<&mut HeldSwing>, tags: Option<Vec<String>>, trait_: Option<String>) -> Result<Vec<Vec<super::answer::ReactionOffer>>, String> {
        let bound = crate::script::conditions::BoundRoll { tags, trait_, ..bound_roll(roll) };
        let mut groups = Vec::new();
        let members: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
        for member in members {
            if !self.world.state.entity(&member).is_some_and(|e| e.alive) {
                continue;
            }
            let moment = Moment { roll: Some(bound.clone()), swing: Some(roll.clone()), landing: landing.as_deref_mut(), ..Moment::default() };
            let theirs = self.offers_for(&member, &["partyRolling"], &[roller.to_string()], &Map::new(), moment)?;
            if !theirs.is_empty() {
                groups.push(theirs);
            }
        }
        Ok(groups)
    }

    /// The rest of the party's swing once nothing more will change the dice (`afterRolled`).
    pub(super) fn after_rolled(&mut self, mut held: HeldSwing) -> Result<SwingResult, String> {
        if !held.settled {
            apply_roll(&mut self.world.state, &held.outcome);
            held.settled = true;
        }
        let hit = held.outcome.hit;
        let Some(damage_roll) = held.outcome.damage_roll.clone().filter(|_| hit) else { return self.land_party_attack(held) };
        let types = held.damage.types.clone().unwrap_or_else(|| vec![DamageType::Physical]);
        let roll = held.outcome.duality_roll.as_ref().map(bound_roll);
        let (attacker, target) = (held.attacker.clone(), held.target.clone());
        let moment = Moment { last_damage: Some(crate::script::runner::LastDamageOption { total: damage_roll.total, types: Some(types) }), landing: Some(&mut held), roll, ..Moment::default() };
        let offers = self.offers_for(&attacker, &["rollingDamage"], &[target], &Map::new(), moment)?;
        if self.waiting() {
            return Ok(SwingResult { hit, refused: None, hit_points_marked: 0.0, waiting: Some(true) });
        }
        if !offers.is_empty() && self.ask_defender {
            self.ask_reaction(offers, Vec::new(), Some(held), None);
            return Ok(SwingResult { hit, refused: None, hit_points_marked: 0.0, waiting: Some(true) });
        }
        self.land_party_attack(held)
    }

    /// The blow as it finally arrives (`counted`): as the dice and the cards left it, with any floor under it.
    fn counted(&mut self, held: &HeldSwing) -> Result<AttackOutcome, String> {
        let outcome = self.rolled(held)?;
        let Some(floor) = held.floor else { return Ok(outcome) };
        let Some(damage) = outcome.damage else { return Ok(outcome) };
        if rank(damage.final_severity) >= rank(floor) {
            return Ok(outcome);
        }
        let damage = ResolvedDamage { final_severity: floor, hp_marked: hp_for_severity(floor), ..damage };
        Ok(AttackOutcome { hit_points_marked: damage.hp_marked, damage: Some(damage), ..outcome })
    }

    /// The blow as the dice and the cards left it, before any floor under it (`rolled`).
    fn rolled(&mut self, held: &HeldSwing) -> Result<AttackOutcome, String> {
        let outcome = held.outcome.clone();
        let target = self.world.state.entity(&held.target).cloned();
        if let (Some(severity), None, Some(target)) = (held.severity, held.forced, target.as_ref()) {
            let defender = self.world.defender_of(target);
            let incoming = IncomingDamage { amount: 0.0, types: held.damage.types.clone().unwrap_or_default(), direct: held.direct.unwrap_or(false), severity: Some(severity) };
            let options = ResolveDamageOptions { armor_slots_marked: Some(0.0), armor_slots_available: Some(unmarked(&target.armor_slots)), ..ResolveDamageOptions::default() };
            let damage = resolve_damage(&incoming, &defender.thresholds, &options);
            return Ok(AttackOutcome { hit_points_marked: damage.hp_marked, damage: Some(damage), ..outcome });
        }
        if let Some(forced) = held.forced.filter(|&f| f > 0.0) {
            let band = severity_of_hit_points(forced);
            let damage = ResolvedDamage { incoming: 0.0, reduced: 0.0, severity: band, final_severity: band, armor_slots_spent: 0.0, hp_marked: forced };
            return Ok(AttackOutcome { hit_points_marked: forced, damage: Some(damage), ..outcome });
        }
        let changed = held.boost.is_some_and(|b| b > 0.0) || held.doubled || held.types.is_some();
        let (Some(damage_roll), Some(target)) = (outcome.damage_roll.clone(), target) else { return Ok(outcome) };
        if !changed {
            return Ok(outcome);
        }
        let defender = self.world.defender_of(&target);
        let total = damage_roll.total * if held.doubled { 2.0 } else { 1.0 } + held.boost.unwrap_or(0.0);
        let types = held.types.clone().or_else(|| held.damage.types.clone()).unwrap_or_default();
        let defenses = defender.defenses.clone().unwrap_or_default();
        let rolled = roll_reduction(&mut self.rng, &types, &defenses).map_err(|e| e.0)?;
        let incoming = IncomingDamage { amount: total, types, direct: held.direct.unwrap_or(false), severity: None };
        let options = ResolveDamageOptions {
            armor_slots_marked: Some(0.0),
            armor_slots_available: Some(unmarked(&target.armor_slots)),
            defenses,
            rolled_reduction: (rolled != 0.0).then_some(rolled),
            ..ResolveDamageOptions::default()
        };
        let damage = resolve_damage(&incoming, &defender.thresholds, &options);
        Ok(AttackOutcome { damage_roll: Some(crate::rules::damage::DamageRollResult { total, ..damage_roll }), hit_points_marked: damage.hp_marked, damage: Some(damage), ..outcome })
    }

    /// The rest of the party's swing: the damage lands, the log says so, and everything that answers a wound
    /// gets its turn (`landPartyAttack`).
    pub(super) fn land_party_attack(&mut self, held: HeldSwing) -> Result<SwingResult, String> {
        let id = held.attacker.clone();
        let target = held.target.clone();
        let who = self.characters.get(&id).map(|c| c.sheet.name.clone()).unwrap_or_default();
        let outcome = self.counted(&held)?;
        let owed = self.world.payouts_on(&target, "attacked");
        let applied = apply_attack(&mut self.world.state, &outcome, !held.settled);
        self.world.ends_on_attack(&id);
        let rolled_total = outcome.damage_roll.as_ref().map_or(0.0, |d| d.total);
        if outcome.hit {
            let types = held.types.clone().or_else(|| held.damage.types.clone()).unwrap_or_else(|| vec![DamageType::Physical]);
            let severe = outcome.damage.is_some_and(|d| is_severe(d.severity));
            self.world.note_damage(&target, Blow { attacker: Some(id.clone()), hit_points: Some(applied.hit_points_marked), damage: Some(rolled_total), types: Some(types), severe: Some(severe) });
            self.world.ends_on_hit(&target);
            if applied.hit_points_marked > 0.0 {
                self.world.ends_on_damage(&target);
            }
            self.defeat_minions(&target, rolled_total);
        }
        if let Some(roll) = &outcome.duality_roll {
            self.rolls.push(RollShow { who: who.clone(), what: format!("the {}", held.weapon), roll: serde_json::to_value(roll).expect("serializes") });
        }
        let whom = name_of(self, &target);
        if outcome.hit {
            self.note_reduction(&whom, outcome.damage.as_ref());
        }
        let marked = applied.hit_points_marked;
        let line = if outcome.hit {
            format!("{who} {} the {}: {} on {whom}.", if outcome.critical { "lands a critical with" } else { "hits with" }, held.weapon, hit_point_word(marked))
        } else {
            format!("{who} swings the {} at {whom} and misses.", held.weapon)
        };
        note(self, &line, "combat");
        swung_at(self, &id, &target);
        if outcome.hit {
            float(self, &target, format!("-{} HP", crate::js::number_to_string(marked)), "combat");
            struck(self, &target);
        } else {
            float(self, &target, "miss".into(), "system");
        }
        let roll = outcome.duality_roll.clone();
        if outcome.hit {
            self.play_damage_reactions()?;
            self.play_defeat_reactions()?;
            self.play_attack_riders(&id, &target, marked, roll.as_ref())?;
            self.play_attacked_on(&target, &id)?;
        } else {
            self.play_miss_riders(&id, &target, roll.as_ref())?;
        }
        self.play_payouts(&id, &target, owed, roll.as_ref())?;
        if let Some(roll) = &roll {
            self.play_party_rolled(&id, &serde_json::to_value(roll).expect("serializes"))?;
        }
        if self.in_combat() {
            let encounter = self.encounter.as_mut().expect("a fight");
            if encounter.can_act(&self.world.state, &id) {
                encounter.act(&mut self.world.state, &id, outcome.spotlight_to_gm);
            } else {
                encounter.settle_if_decided(&mut self.world.state);
            }
        }
        self.settle_fight()?;
        self.swing_cues(roll.as_ref(), &target, marked)?;
        Ok(SwingResult { hit: outcome.hit, refused: None, hit_points_marked: marked, waiting: None })
    }

    /// "The Knight turns aside 3 of it" (`noteReduction`).
    pub(super) fn note_reduction(&mut self, who: &str, resolved: Option<&ResolvedDamage>) {
        if let Some(resolved) = resolved.filter(|r| r.reduced > 0.0) {
            note(self, &format!("{who} turns aside {} of it.", crate::js::number_to_string(resolved.reduced)), "combat");
        }
    }

    /// Minion (X): down at any damage, and another of its kind nearby for every X (`defeatMinions`).
    fn defeat_minions(&mut self, target: &str, damage: f64) {
        let Some(definition) = self.world.state.entity(target).map(|e| e.definition.clone()) else { return };
        let Some(per) = adversary_traits(&self.stat_block(target).features).minion else { return };
        if damage <= 0.0 {
            return;
        }
        let fell = |session: &mut Session, id: &str| {
            let entity = session.world.state.entity_mut(id).expect("standing");
            entity.hit_points.marked = entity.hit_points.max;
            entity.alive = false;
        };
        if self.world.state.entity(target).is_some_and(|e| e.alive) {
            fell(self, target);
            let who = the_name_of(self, target, false);
            note(self, &format!("{who} goes down at a touch."), "combat");
        }
        let extras = (damage / per).floor();
        if extras <= 0.0 {
            return;
        }
        let nearby: Vec<String> = self
            .world
            .state
            .entities_of(Faction::Adversary)
            .filter(|e| e.alive && e.id != target && e.definition == definition)
            .map(|e| e.id.clone())
            .filter(|id| self.world.band_to(target, id).is_some_and(|band| reaches(band, RangeBand::VeryClose)))
            .take(extras as usize)
            .collect();
        for id in &nearby {
            fell(self, id);
        }
        if !nearby.is_empty() {
            note(self, &format!("The blow carries: {} more go down.", nearby.len()), "combat");
        }
    }

    // ---- what a card said about a held swing -------------------------------------------------------------

    /// The swing, with whatever the card said about it (`asAnswered`).
    pub(super) fn as_answered(&mut self, held: Option<HeldSwing>, journal: &[Value]) -> Option<HeldSwing> {
        let landing = self.as_rerolled(held, journal)?;
        let Some(damage_roll) = landing.outcome.damage_roll.clone() else { return Some(landing) };
        let mut added = 0.0;
        let mut doubled = false;
        let mut types: Option<Vec<DamageType>> = None;
        let mut forced: Option<f64> = None;
        let mut band: Option<DamageSeverity> = None;
        let mut floor: Option<DamageSeverity> = None;
        for entry in journal {
            match entry["kind"].as_str().unwrap_or_default() {
                "damageBoosted" => added += entry["by"].as_f64().unwrap_or(0.0),
                "damageDoubled" => doubled = true,
                "damageRetyped" => types = serde_json::from_value(entry["types"].clone()).ok(),
                "dieMaxed" => added += lift_lowest(&damage_roll),
                "damageRerolled" => added += self.reroll_low(&damage_roll, entry["below"].as_f64().unwrap_or(0.0)),
                "hitPointsForced" => forced = Some(crate::js::max(forced.unwrap_or(0.0), entry["to"].as_f64().unwrap_or(0.0))),
                "severityForced" => {
                    let Ok(severity) = serde_json::from_value::<DamageSeverity>(entry["severity"].clone()) else { continue };
                    if entry["least"] == true {
                        floor = Some(worse(floor, severity));
                    } else {
                        band = Some(worse(band, severity));
                    }
                }
                _ => {}
            }
        }
        if added <= 0.0 && !doubled && types.is_none() && forced.is_none() && band.is_none() && floor.is_none() {
            return Some(landing);
        }
        Some(HeldSwing {
            boost: if added <= 0.0 { landing.boost } else { Some(landing.boost.unwrap_or(0.0) + added) },
            doubled: landing.doubled || doubled,
            types: types.or(landing.types.clone()),
            forced: forced.map(|f| crate::js::max(landing.forced.unwrap_or(0.0), f)).or(landing.forced),
            severity: band.map(|b| worse(landing.severity, b)).or(landing.severity),
            floor: floor.map(|f| worse(landing.floor, f)).or(landing.floor),
            ..landing
        })
    }

    /// What throwing the low faces of a blow again is worth (`rerollLow`).
    fn reroll_low(&mut self, roll: &crate::rules::damage::DamageRollResult, below: f64) -> f64 {
        let mut moved = 0.0;
        for &face in &roll.roll.rolls {
            if f64::from(face) >= below {
                continue;
            }
            let fresh = roll_dice(&mut self.rng, &DiceExpression { count: 1.0, sides: roll.expression.sides, modifier: 0.0 }).expect("a die rolls").total;
            moved += fresh - f64::from(face);
        }
        moved
    }

    /// The swing rebuilt around Duality Dice thrown again (`asRerolled`).
    fn as_rerolled(&mut self, held: Option<HeldSwing>, journal: &[Value]) -> Option<HeldSwing> {
        let held = held?;
        let Some(roll) = held.outcome.duality_roll.clone() else { return Some(held) };
        let mut which: Option<String> = None;
        let mut named = false;
        let mut raised = 0.0;
        for entry in journal {
            match entry["kind"].as_str().unwrap_or_default() {
                "dualityRerolled" => which = entry["which"].as_str().map(str::to_string),
                "rollNamed" => named = true,
                "rollRaised" => raised += entry["by"].as_f64().unwrap_or(0.0),
                _ => {}
            }
        }
        if which.is_none() && !named && raised == 0.0 {
            return Some(held);
        }
        let (Some(attacker), Some(target), Some(character)) = (self.world.state.entity(&held.attacker).cloned(), self.world.state.entity(&held.target).cloned(), self.characters.get(&held.attacker).cloned()) else { return Some(held) };
        let good = which.as_deref().filter(|w| *w != "bad").map(|_| self.rng.die(roll.good_sides.unwrap_or(crate::rules::duality::GOOD_DIE_SIDES)).expect("a die rolls"));
        let bad = which.as_deref().filter(|w| *w != "good").map(|_| self.rng.die(crate::rules::duality::BAD_DIE_SIDES).expect("a die rolls"));
        let mut thrown = with_faces(&roll, good, bad);
        if raised > 0.0 {
            thrown = with_faces(&DualityRoll { modifier: thrown.modifier + raised, ..thrown }, None, None);
        }
        if named && !thrown.success {
            thrown = with_faces(&DualityRoll { modifier: thrown.modifier + (thrown.difficulty - thrown.total), ..thrown }, None, None);
        }
        let who = name_of(self, &held.attacker);
        let described = describe_roll(&serde_json::to_value(&thrown).expect("serializes"));
        note(self, &format!("{who} throws again: {described}"), if thrown.success { "good" } else { "bad" });
        let profile = attack_profile(&character, Hand::Primary);
        let defender = self.world.defender_of(&target);
        let bonus = self.world.roll_bonus(&held.attacker, Stat::AttackRoll, held.melee);
        let damage_bonus = self.world.roll_bonus(&held.attacker, Stat::DamageRoll, held.melee);
        let scales = self.world.advantage_for(&held.attacker, &held.target);
        let options = AttackOptions {
            targeting: TargetingOptions { band_tiles: Some(DEMO_BAND_TILES), ..TargetingOptions::default() },
            bonus: Some(bonus),
            damage_bonus: Some(damage_bonus),
            advantage: Some(scales.advantage),
            disadvantage: Some(scales.disadvantage),
            roll: Some(thrown),
            ..AttackOptions::default()
        };
        let Ok(outcome) = resolve_attack(&mut self.rng, &AttackRequest { grid: &self.world.state.grid, attacker: &attacker, target: &target, profile: &profile, defender: &defender, options: &options }) else { return Some(held) };
        if outcome.refused.is_some() {
            return Some(held);
        }
        Some(HeldSwing { outcome, boost: None, doubled: false, types: None, forced: None, severity: None, floor: None, stage_rolled: false, ..held })
    }
}
