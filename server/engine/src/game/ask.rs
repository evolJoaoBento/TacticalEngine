//! The questions a fight puts to a table that asks (`askDefender`): how a hit is taken (`defenseChoices`,
//! `offerOrLand`, `offerMiss`, `applyDefenseChoice`, `answeredWith`), what a party member plays about
//! something that has happened (`askReaction`), and the death move (`askDeathMove`, `applyDeathMove` -
//! Avoid Death, Risk It All, Blaze of Glory - and a card played instead). Each is put in the session's
//! `asked`, the other half of the TypeScript's one `pending`, and answered by `answer_pending`.

use super::answer::ReactionOffer;
use super::blow::{cost_of, IncomingAttack};
use super::log::{name_of, note, the_name_of};
use super::play::{OnDone, PendingScript, UseOutcome};
use super::rules::DEMO_BAND_TILES;
use super::session::Session;
use super::swing::{hit_point_word, HeldSwing};
use crate::character::sheet::{attack_profile, Hand};
use crate::combat::attack::{apply_attack, resolve_attack, AttackOptions, AttackOutcome, AttackProfile, AttackRequest, AttackerKind, Automatic};
use crate::combat::defense::{preview_plan, DefensePlan, Defender};
use crate::combat::targeting::TargetingOptions;
use crate::content::abilities::{AbilityDef, DamageReaction, Stat};
use crate::js;
use crate::rules::damage::{roll_damage, DamageRollOptions};
use crate::rules::duality::{roll_duality, DualityRollOptions};
use crate::rules::range::{reaches, RangeBand};
use crate::rules::resources::unmarked;
use crate::scene::state::Faction;
use crate::script::conditions::TargetBindings;
use crate::script::runner::{LastDamageOption, RunStatus, RunnerOptions, ScriptRunner};
use serde_json::{json, Map, Value};

/// Something the defender's side can do about a hit (`DefenseChoice`).
#[derive(Clone, Debug, PartialEq)]
pub enum DefenseChoice {
    /// Armor Slots and reactions, as a plan.
    Plan { label: String, armor_slots: f64, reactions: Vec<AbilityDef> },
    /// Nothing to answer with, or nothing chosen: the blow simply misses.
    None { label: String },
    /// A card whose own effects answer the attack - Vanishing Dodge on a miss.
    React { label: String, by: String, ability: AbilityDef },
    /// A card that answers the blow with a script of its own, the blow put again once it has.
    Script { label: String, by: String, ability: AbilityDef },
    /// An ally standing in the way.
    Redirect { label: String, by: String, ability: AbilityDef },
    /// An ally's card that makes the GM roll again.
    Reroll { label: String, by: String, ability: AbilityDef, what: String },
}

impl DefenseChoice {
    pub fn label(&self) -> &str {
        match self {
            DefenseChoice::Plan { label, .. }
            | DefenseChoice::None { label }
            | DefenseChoice::React { label, .. }
            | DefenseChoice::Script { label, .. }
            | DefenseChoice::Redirect { label, .. }
            | DefenseChoice::Reroll { label, .. } => label,
        }
    }
}

/// A script stopped mid-roll, waiting on whatever the room says about it (`ResumingScript`).
pub struct Resuming {
    pub script: Box<PendingScript>,
    pub said: Vec<Value>,
}

/// A question the fight has put to the table (`PendingDefense`, `PendingReaction`, `PendingDeath`).
pub enum Asked {
    Defense { prompt: Value, attack: IncomingAttack, choices: Vec<DefenseChoice> },
    Reaction { prompt: Value, offers: Vec<ReactionOffer>, queued: Vec<Vec<ReactionOffer>>, landing: Option<HeldSwing>, resuming: Option<Resuming> },
    Death { prompt: Value, who: String, offers: Vec<ReactionOffer> },
}

impl Asked {
    pub fn kind(&self) -> &'static str {
        match self {
            Asked::Defense { .. } => "defense",
            Asked::Reaction { .. } => "reaction",
            Asked::Death { .. } => "death",
        }
    }

    pub fn prompt(&self) -> &Value {
        match self {
            Asked::Defense { prompt, .. } | Asked::Reaction { prompt, .. } | Asked::Death { prompt, .. } => prompt,
        }
    }
}

/// The three death moves, in the order they are offered.
const DEATH_MOVES: [&str; 3] = ["avoid", "blaze", "risk"];

/// Everything the defence rules need to know about whoever takes a hit (`defenderFor`), owned.
pub(super) struct Holder {
    thresholds: crate::rules::damage::DamageThresholds,
    defenses: Option<crate::rules::damage::DamageDefenses>,
    armor_slots: crate::rules::resources::MarkPool,
    stress: crate::rules::resources::MarkPool,
    good: Option<crate::rules::resources::Currency>,
    reactions: Vec<AbilityDef>,
}

impl Holder {
    pub(super) fn defender(&self) -> Defender<'_> {
        Defender { thresholds: self.thresholds, defenses: self.defenses.clone(), armor_slots: self.armor_slots, stress: self.stress, good: self.good, reactions: self.reactions.iter().collect() }
    }
}

fn labelled(ability: &AbilityDef) -> String {
    let cost = cost_of(ability);
    if cost.is_empty() {
        ability.name.clone()
    } else {
        format!("{} ({cost})", ability.name)
    }
}

fn index_of(response: &Value) -> i64 {
    if response["kind"] == "choose" {
        response["index"].as_f64().map_or(-1, |i| if i.fract() == 0.0 { i as i64 } else { -1 })
    } else {
        0
    }
}

impl Session {
    /// The defender as the defence rules see them (`defenderFor`).
    pub(super) fn holder(&mut self, id: &str) -> Option<Holder> {
        let entity = self.world.state.entity(id)?.clone();
        let against = self.world.defender_of(&entity);
        let armor_slots = self.world.armor_for(id);
        let reactions = self.world.reactions_of(id);
        Some(Holder { thresholds: against.thresholds, defenses: against.defenses, armor_slots, stress: entity.stress, good: entity.good, reactions })
    }

    /// Put a question to the table: the one slot it shares with a waiting script.
    pub(super) fn ask(&mut self, asked: Asked) {
        self.pending = None;
        self.asked = Some(asked);
    }

    // ---- the defence ---------------------------------------------------------------------------------------

    /// What the defender's side can do about this hit (`defenseChoices`): take it, an Armor Slot, the
    /// reactions they can pay for, their own cards' scripts, and what an ally in range holds.
    pub(super) fn defense_choices(&mut self, attack: &IncomingAttack) -> Vec<DefenseChoice> {
        let Some(holder) = self.holder(&attack.defender) else { return Vec::new() };
        let damage = self.incoming_of(attack);
        let defender = holder.defender();
        let bare_hp = preview_plan(&damage, &defender, &DefensePlan { armor_slots: 0.0, reactions: Vec::new() });
        let straight = bare_hp.unwrap_or(0.0);
        let mut choices = vec![DefenseChoice::Plan { label: bare_hp.map_or("Take it".into(), |hp| format!("Take it \u{2014} {}", hit_point_word(hp))), armor_slots: 0.0, reactions: Vec::new() }];
        let room = unmarked(&defender.armor_slots) > 0.0;
        let with_armor = if room { preview_plan(&damage, &defender, &DefensePlan { armor_slots: 1.0, reactions: Vec::new() }) } else { None };
        if let Some(hp) = with_armor.filter(|&hp| hp < straight) {
            choices.push(DefenseChoice::Plan { label: format!("Mark an Armor Slot \u{2014} {}", hit_point_word(hp)), armor_slots: 1.0, reactions: Vec::new() });
        }
        let own: Vec<AbilityDef> = self.world.reactions_for(&attack.defender, "incomingDamage", None).into_iter().filter(|a| a.reaction.is_some() && !attack.used.contains(&a.id) && self.can_play(&attack.defender, a)).collect();
        for ability in &own {
            if matches!(ability.reaction, Some(DamageReaction::Redirect)) {
                continue;
            }
            for slots in if room { vec![0.0, 1.0] } else { vec![0.0] } {
                let after = preview_plan(&damage, &defender, &DefensePlan { armor_slots: slots, reactions: vec![ability] });
                let bar = if slots == 1.0 { with_armor.unwrap_or(straight) } else { straight };
                if after.is_some_and(|hp| hp >= bar) {
                    continue;
                }
                let armor_part = if slots == 1.0 { "Armor Slot and " } else { "" };
                let result = after.map(|hp| format!(" \u{2014} {}", hit_point_word(hp))).unwrap_or_default();
                choices.push(DefenseChoice::Plan { label: format!("{armor_part}{}{result}", labelled(ability)), armor_slots: slots, reactions: vec![ability.clone()] });
            }
        }
        let bound = TargetBindings { targets: vec![attack.attacker.clone()], hit: vec![attack.attacker.clone()], ..TargetBindings::default() };
        for ability in self.world.reactions_for(&attack.defender, "incomingDamage", Some(&bound)) {
            if ability.reaction.is_some() || ability.effects.is_empty() || attack.used.contains(&ability.id) || !self.can_play(&attack.defender, &ability) {
                continue;
            }
            choices.push(DefenseChoice::Script { label: labelled(&ability), by: attack.defender.clone(), ability });
        }
        let members: Vec<String> = self.world.state.entities_of(Faction::Party).filter(|e| e.alive && e.id != attack.defender).map(|e| e.id.clone()).collect();
        for member in members {
            if self.world.state.entity(&member).is_none() {
                continue;
            }
            let name = name_of(self, &member);
            for ability in self.world.reactions_for(&member, "incomingDamage", None) {
                if !matches!(ability.reaction, Some(DamageReaction::Redirect)) || attack.used.contains(&ability.id) || !self.can_play(&member, &ability) {
                    continue;
                }
                if !self.world.band_to(&member, &attack.defender).is_some_and(|band| reaches(band, ability.target.range)) {
                    continue;
                }
                choices.push(DefenseChoice::Redirect { label: format!("{name}: {} ({})", ability.name, cost_of(&ability)), by: member.clone(), ability });
            }
            for ability in self.world.reactions_for(&member, "attackHit", None) {
                let Some(DamageReaction::Reroll { what }) = ability.reaction.clone() else { continue };
                if attack.used.contains(&ability.id) || !self.can_play(&member, &ability) {
                    continue;
                }
                if !self.world.band_to(&member, &attack.attacker).is_some_and(|band| reaches(band, ability.target.range)) {
                    continue;
                }
                let cost = cost_of(&ability);
                if what != "damage" {
                    choices.push(DefenseChoice::Reroll { label: format!("{name}: {} \u{2014} reroll the attack ({cost})", ability.name), by: member.clone(), ability: ability.clone(), what: "attack".into() });
                }
                if what != "attack" {
                    choices.push(DefenseChoice::Reroll { label: format!("{name}: {} \u{2014} reroll the damage ({cost})", ability.name), by: member.clone(), ability: ability.clone(), what: "damage".into() });
                }
            }
        }
        choices
    }

    /// Ask, if there is anything to ask; otherwise take the hit the engine's way (`offerOrLand`).
    pub(super) fn offer_or_land(&mut self, attack: IncomingAttack) -> Result<(), String> {
        if self.ask_defender {
            let choices = self.defense_choices(&attack);
            if choices.len() > 1 {
                let damage = self.incoming_of(&attack);
                let what = match damage.severity {
                    Some(band) => super::swing::band_word(band).to_string(),
                    None => js::number_to_string(damage.amount),
                };
                let types: Vec<String> = damage.types.iter().map(|t| serde_json::to_value(t).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()).collect();
                let types = if types.is_empty() { "physical".to_string() } else { types.join(" and ") };
                let whom = name_of(self, &attack.defender);
                let prompt = json!({
                    "kind": "choice",
                    "title": format!("{} on {whom}", attack.def.attack_name),
                    "body": format!("{what} {types} damage{}. How does it land?", if damage.direct { ", direct" } else { "" }),
                    "options": choices.iter().enumerate().map(|(index, c)| json!({ "index": index, "label": c.label() })).collect::<Vec<_>>(),
                });
                self.ask(Asked::Defense { prompt, attack, choices });
                return Ok(());
            }
        }
        self.land_attack(attack, None)
    }

    /// A blow that went wide, and somebody who can do something about it (`offerMiss`).
    pub(super) fn offer_miss(&mut self, attack: IncomingAttack) {
        if !self.ask_defender || self.world.state.entity(&attack.defender).is_none() {
            return;
        }
        let bound = TargetBindings { targets: vec![attack.attacker.clone()], hit: vec![attack.attacker.clone()], ..TargetBindings::default() };
        let cards: Vec<AbilityDef> = self.world.reactions_for(&attack.defender, "attackMissed", Some(&bound)).into_iter().filter(|a| !a.effects.is_empty() && self.can_play(&attack.defender, a)).collect();
        if cards.is_empty() {
            return;
        }
        let mut choices = vec![DefenseChoice::None { label: "Let it go wide".into() }];
        choices.extend(cards.into_iter().map(|ability| DefenseChoice::React { label: labelled(&ability), by: attack.defender.clone(), ability }));
        let whom = name_of(self, &attack.defender);
        let prompt = json!({
            "kind": "choice",
            "title": format!("{} goes wide", attack.def.attack_name),
            "body": format!("{whom} can answer it."),
            "options": choices.iter().enumerate().map(|(index, c)| json!({ "index": index, "label": c.label() })).collect::<Vec<_>>(),
        });
        self.ask(Asked::Defense { prompt, attack, choices });
    }

    /// Do what the defender's side chose (`applyDefenseChoice`). A plan ends the hit; an interrupt changes it
    /// and asks again.
    fn apply_defense_choice(&mut self, attack: IncomingAttack, choice: DefenseChoice) -> Result<(), String> {
        match choice {
            DefenseChoice::None { .. } => Ok(()),
            DefenseChoice::Plan { armor_slots, reactions, .. } => self.land_attack(attack, Some((armor_slots, reactions))),
            DefenseChoice::Script { by, ability, .. } => {
                if !self.pay_for(&by, &ability) {
                    return self.land_attack(attack, None);
                }
                let damage = self.incoming_of(&attack);
                let was = self.world.scenario.actor_id.replace(by.clone());
                let options = RunnerOptions {
                    targets: Some(vec![attack.attacker.clone()]),
                    hit: Some(vec![attack.attacker.clone()]),
                    roll_as: Some("actor".into()),
                    last_damage: Some(LastDamageOption { total: damage.amount, types: Some(damage.types.clone()) }),
                    ..RunnerOptions::default()
                };
                let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
                let status = runner.run(&ability.effects);
                let journal = runner.entries().to_vec();
                let runner = runner.suspend();
                self.record(&journal)?;
                let mut carried = attack;
                carried.used.push(ability.id.clone());
                if let RunStatus::Waiting(prompt) = status {
                    self.pending = Some(PendingScript::new(runner, prompt, journal.len(), OnDone::Answered { attack: Box::new(carried), was }));
                    return Ok(());
                }
                self.world.scenario.actor_id = was;
                self.answered_with(carried, &journal)
            }
            DefenseChoice::React { by, ability, .. } => {
                if !self.pay_for(&by, &ability) {
                    return Ok(());
                }
                let was = self.world.scenario.actor_id.replace(by.clone());
                let options = RunnerOptions { targets: Some(vec![attack.attacker.clone()]), roll_as: Some("actor".into()), ..RunnerOptions::default() };
                let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
                let status = runner.run(&ability.effects);
                let journal = runner.entries().to_vec();
                let runner = runner.suspend();
                self.record(&journal)?;
                if let RunStatus::Waiting(prompt) = status {
                    self.pending = Some(PendingScript::new(runner, prompt, journal.len(), OnDone::Dodged { was }));
                    return Ok(());
                }
                self.world.scenario.actor_id = was;
                Ok(())
            }
            DefenseChoice::Redirect { by, ability, .. } => {
                if !self.pay_for(&by, &ability) {
                    return self.land_attack(attack, None);
                }
                let (helper, whom) = (name_of(self, &by), name_of(self, &attack.defender));
                note(self, &format!("{helper} steps in front of {whom}: {}.", ability.name), "good");
                let mut moved = attack;
                moved.defender = by;
                moved.used.push(ability.id.clone());
                self.offer_or_land(moved)
            }
            DefenseChoice::Reroll { by, ability, what, .. } => {
                if !self.pay_for(&by, &ability) {
                    return self.land_attack(attack, None);
                }
                let helper = name_of(self, &by);
                let (Some(adversary), Some(target)) = (self.world.state.entity(&attack.attacker).cloned(), self.world.state.entity(&attack.defender).cloned()) else { return self.land_attack(attack, None) };
                let mut attack = attack;
                attack.used.push(ability.id.clone());
                if what == "damage" {
                    let rolled = roll_damage(&mut self.rng, &attack.def.attack_damage.expression, &DamageRollOptions::default()).map_err(|e| e.0)?;
                    note(self, &format!("{helper}: {}. The blow rolls again \u{2014} {}.", ability.name, js::number_to_string(rolled.total)), "good");
                    attack.outcome = AttackOutcome { damage_roll: Some(rolled), ..attack.outcome };
                    return self.offer_or_land(attack);
                }
                let profile = AttackProfile {
                    kind: AttackerKind::Adversary,
                    name: attack.def.attack_name.clone(),
                    modifier: attack.def.attack_modifier,
                    range: attack.def.attack_range,
                    damage: attack.def.attack_damage.clone(),
                    proficiency: None,
                    direct: None,
                    trait_: None,
                    double: None,
                };
                let defender = self.world.defender_of(&target);
                let options = AttackOptions { targeting: TargetingOptions { band_tiles: Some(DEMO_BAND_TILES), ..TargetingOptions::default() }, armor_slots_marked: Some(0.0), ..AttackOptions::default() };
                let again = resolve_attack(&mut self.rng, &AttackRequest { grid: &self.world.state.grid, attacker: &adversary, target: &target, profile: &profile, defender: &defender, options: &options }).map_err(|e| e.0)?;
                let by = the_name_of(self, &attack.attacker, false);
                note(self, &format!("{helper}: {}. {by} swings again.", ability.name), "good");
                if again.refused.is_some() || !again.hit || again.damage_roll.is_none() {
                    apply_attack(&mut self.world.state, &again, true);
                    self.world.ends_on_attack(&attack.attacker);
                    let whom = name_of(self, &attack.defender);
                    note(self, &format!("{by}'s {} misses {whom}.", attack.def.attack_name), "combat");
                    return self.settle_fight();
                }
                attack.outcome = again;
                self.offer_or_land(attack)
            }
        }
    }

    /// The blow, with what the defender's own card said about it (`answeredWith`).
    pub(super) fn answered_with(&mut self, attack: IncomingAttack, journal: &[Value]) -> Result<(), String> {
        let (mut softened, mut avoided, mut stepped, mut raised) = (0.0, false, 0.0, 0.0);
        for entry in journal {
            match entry["kind"].as_str().unwrap_or_default() {
                "blowSoftened" => softened += entry["by"].as_f64().unwrap_or(0.0),
                "blowAvoided" => avoided = true,
                "severityStepped" => stepped += entry["steps"].as_f64().unwrap_or(0.0),
                "evasionRaised" => raised += entry["by"].as_f64().unwrap_or(0.0),
                _ => {}
            }
        }
        let who = name_of(self, &attack.defender);
        if let Some(gm) = attack.outcome.gm_roll.clone().filter(|_| raised > 0.0) {
            note(self, &format!("{who} sees it coming: {} more to beat.", js::number_to_string(raised)), "good");
            if !gm.critical && gm.total < gm.difficulty + raised {
                self.world.ends_on_attack(&attack.attacker);
                let by = the_name_of(self, &attack.attacker, false);
                note(self, &format!("{by}'s {} misses {who}.", attack.def.attack_name), "combat");
                self.play_attacked_on(&attack.defender, &attack.attacker)?;
                return self.settle_fight();
            }
        }
        if avoided {
            self.world.ends_on_attack(&attack.attacker);
            let by = the_name_of(self, &attack.attacker, false);
            note(self, &format!("{by}'s {} finds nothing where {who} was.", attack.def.attack_name), "combat");
            self.play_attacked_on(&attack.defender, &attack.attacker)?;
            return self.settle_fight();
        }
        let mut softer = attack;
        if softened > 0.0 {
            if let Some(roll) = softer.outcome.damage_roll.clone() {
                softer.outcome.damage_roll = Some(crate::rules::damage::DamageRollResult { total: js::max(0.0, roll.total - softened), ..roll });
            }
            note(self, &format!("{who} turns aside {} of it.", js::number_to_string(softened)), "good");
        }
        if stepped > 0.0 {
            softer.stepped = Some(softer.stepped.unwrap_or(0.0) + stepped);
        }
        self.offer_or_land(softer)
    }

    // ---- a card offered ------------------------------------------------------------------------------------

    /// Put the question: one character, their cards, and letting it pass (`askReaction`).
    pub(super) fn ask_reaction(&mut self, offers: Vec<ReactionOffer>, queued: Vec<Vec<ReactionOffer>>, landing: Option<HeldSwing>, resuming: Option<Resuming>) {
        let who = name_of(self, &offers[0].by);
        let mut options = vec![json!({ "index": 0, "label": "Let it pass" })];
        options.extend(offers.iter().enumerate().map(|(index, offer)| json!({ "index": index + 1, "label": labelled(&offer.ability) })));
        let prompt = json!({
            "kind": "choice",
            "title": format!("{who} can answer that"),
            "body": offers.iter().map(|o| o.ability.name.clone()).collect::<Vec<_>>().join(", "),
            "options": options,
        });
        self.ask(Asked::Reaction { prompt, offers, queued, landing, resuming });
    }

    // ---- the death move --------------------------------------------------------------------------------------

    /// The question itself: one character, the three ways out of it, and any card (`askDeathMove`).
    pub(super) fn ask_death_move(&mut self, id: &str, offers: Vec<ReactionOffer>) {
        let who = name_of(self, id);
        let mut options = vec![
            json!({ "index": 0, "label": "Avoid Death", "detail": "Drop unconscious until an ally clears a Hit Point. Roll the Light Die: on your level or under, a scar." }),
            json!({ "index": 1, "label": "Blaze of Glory", "detail": "One final action. It automatically critically succeeds, and then you cross through the veil." }),
            json!({ "index": 2, "label": "Risk It All", "detail": "Roll the Duality Dice. Light higher and you stay up; Shadow higher and you die; matching and you stand with everything cleared." }),
        ];
        options.extend(offers.iter().enumerate().map(|(at, offer)| json!({ "index": DEATH_MOVES.len() + at, "label": offer.ability.name, "detail": offer.ability.text })));
        let prompt = json!({ "kind": "choice", "title": format!("{who} must make a death move"), "options": options });
        self.ask(Asked::Death { prompt, who: id.to_string(), offers });
    }

    /// The cards a character holds that answer their own fall (`deathOffers`).
    pub(super) fn death_offers(&mut self, id: &str) -> Result<Vec<ReactionOffer>, String> {
        self.offers_for(id, &["defeated"], &[id.to_string()], &Map::new(), super::answer::Moment::default())
    }

    /// Do what was chosen (`applyDeathMove`).
    fn apply_death_move(&mut self, id: &str, which: &str) -> Result<(), String> {
        match which {
            "avoid" => self.avoid_death(id),
            "risk" => self.risk_it_all(id),
            _ => self.blaze_of_glory(id),
        }
    }

    /// "Roll your Duality Dice" (`riskItAll`).
    fn risk_it_all(&mut self, id: &str) -> Result<(), String> {
        let Some(who) = self.characters.get(id).map(|c| c.sheet.name.clone()) else { return Ok(()) };
        let Some(entity) = self.world.state.entity(id).cloned() else { return Ok(()) };
        let roll = roll_duality(&mut self.rng, &DualityRollOptions { difficulty: 0.0, reaction: Some(true), ..DualityRollOptions::default() }).map_err(|e| e.0)?;
        note(self, &format!("{who} risks it all: Light {}, Shadow {}.", roll.good, roll.bad), if roll.bad > roll.good { "bad" } else { "good" });
        if roll.bad > roll.good {
            self.veil(id);
            return Ok(());
        }
        let target = json!({ "kind": "entity", "id": id });
        if roll.good == roll.bad {
            self.world.heal(&target, entity.hit_points.max, &TargetBindings::default());
            self.world.clear_stress(id, entity.stress.max);
            note(self, &format!("The dice match. {who} stands up with nothing marked at all."), "good");
            return Ok(());
        }
        let hit_points = self.world.heal(&target, f64::from(roll.good), &TargetBindings::default());
        let stress = self.world.clear_stress(id, f64::from(roll.good) - hit_points);
        let more = if stress > 0.0 { format!(" and {} Stress", js::number_to_string(stress)) } else { String::new() };
        note(self, &format!("{who} stays on their feet: {} cleared{more}.", hit_point_word(hit_points)), "good");
        Ok(())
    }

    /// "Take one final action. It automatically critically succeeds" (`blazeOfGlory`).
    fn blaze_of_glory(&mut self, id: &str) -> Result<(), String> {
        let Some(character) = self.characters.get(id).cloned() else { return Ok(()) };
        if self.world.state.entity(id).is_none() {
            return Ok(());
        }
        note(self, &format!("{} goes out in a blaze of glory.", character.sheet.name), "good");
        let profile = attack_profile(&character, Hand::Primary);
        let melee = profile.range == RangeBand::Melee;
        let foes: Vec<String> = self.world.state.entities_of(Faction::Adversary).filter(|e| e.alive).map(|e| e.id.clone()).collect();
        for target_id in self.by_distance(id, &foes) {
            let attacker = self.world.state.entity(id).cloned().expect("standing");
            let target = self.world.state.entity(&target_id).cloned().expect("standing");
            let defender = self.world.defender_of(&target);
            let bonus = self.world.roll_bonus(id, Stat::AttackRoll, melee);
            let damage_bonus = self.world.roll_bonus(id, Stat::DamageRoll, melee);
            let scales = self.world.advantage_for(id, &target_id);
            let options = AttackOptions {
                targeting: TargetingOptions { band_tiles: Some(DEMO_BAND_TILES), ..TargetingOptions::default() },
                automatic: Some(Automatic::CriticalSuccess),
                bonus: Some(bonus),
                damage_bonus: Some(damage_bonus),
                advantage: Some(scales.advantage),
                disadvantage: Some(scales.disadvantage),
                ..AttackOptions::default()
            };
            let outcome = resolve_attack(&mut self.rng, &AttackRequest { grid: &self.world.state.grid, attacker: &attacker, target: &target, profile: &profile, defender: &defender, options: &options }).map_err(|e| e.0)?;
            if outcome.refused.is_some() {
                continue;
            }
            self.veil(id);
            let held = HeldSwing {
                attacker: id.to_string(),
                target: target_id,
                outcome,
                weapon: profile.name.clone(),
                melee,
                damage: profile.damage.clone(),
                direct: profile.direct,
                boost: None,
                doubled: false,
                types: None,
                forced: None,
                severity: None,
                floor: None,
                stage_rolled: false,
                settled: false,
            };
            self.land_party_attack(held)?;
            return Ok(());
        }
        note(self, &format!("{} looks for one last swing and finds nothing in reach.", character.sheet.name), "system");
        self.veil(id);
        Ok(())
    }

    /// A card played in place of the death move (`playDeathCard`): not enough, and the three are put again.
    fn play_death_card(&mut self, id: &str, offer: ReactionOffer) -> Result<(), String> {
        self.play_reaction(offer, false, None, Vec::new(), None)?;
        if self.waiting() || self.world.state.entity(id).is_some_and(|e| e.alive) {
            return Ok(());
        }
        self.ask_death_move(id, Vec::new());
        Ok(())
    }

    /// Crossing through (`veil`): down, and past anything that clears a Hit Point.
    pub(super) fn veil(&mut self, id: &str) {
        let Some(entity) = self.world.state.entity_mut(id) else { return };
        entity.alive = false;
        entity.dead = Some(true);
        let who = name_of(self, id);
        note(self, &format!("{who} crosses through the veil of death."), "bad");
    }

    // ---- the answers -----------------------------------------------------------------------------------------

    /// Answer a question the fight put (`answerPending`'s defence, reaction and death halves).
    pub(super) fn answer_asked(&mut self, asked: Asked, response: &Value) -> Result<UseOutcome, String> {
        let index = index_of(response);
        let before = self.log.len();
        match asked {
            Asked::Defense { attack, choices, .. } => {
                let choice = usize::try_from(index).ok().and_then(|i| choices.get(i)).or_else(|| choices.first()).cloned();
                if let Some(choice) = choice {
                    self.apply_defense_choice(attack, choice)?;
                }
                if !self.waiting() {
                    self.run_gm_turn()?;
                }
            }
            Asked::Reaction { offers, queued, landing, resuming, .. } => {
                let chosen = usize::try_from(index - 1).ok().filter(|_| index > 0).and_then(|i| offers.get(i)).cloned();
                match chosen {
                    None => self.after_reaction(queued, landing, resuming)?,
                    Some(offer) => {
                        self.play_reaction(offer, true, landing, queued, resuming)?;
                    }
                }
            }
            Asked::Death { who, offers, .. } => {
                let card = usize::try_from(index - DEATH_MOVES.len() as i64).ok().filter(|_| index >= DEATH_MOVES.len() as i64).and_then(|i| offers.get(i)).cloned();
                match card {
                    None => {
                        let which = usize::try_from(index).ok().and_then(|i| DEATH_MOVES.get(i)).copied().unwrap_or(DEATH_MOVES[0]);
                        self.apply_death_move(&who, which)?;
                    }
                    Some(card) => self.play_death_card(&who, card)?,
                }
                self.play_death_moves()?;
                if !self.waiting() {
                    self.run_gm_turn()?;
                }
            }
        }
        let lines = self.log[before..].to_vec();
        self.settle(lines)
    }
}
