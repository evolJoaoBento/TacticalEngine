//! What answers something that has already happened: a card of the party's (`offersFor`, `playReaction`,
//! `afterReaction`), a stat block's reaction, a debt a condition left for whoever swings (`playPayouts`),
//! the riders on a swing (`playAttackRiders`, `playMissRiders`, `playAttackedOn`), a roll the party made
//! (`playPartyRolled`), a blow landed (`playDamageReactions`, `nearbyOffers`) and ground that bites
//! (`playZoneEntries`).
//!
//! A card that costs nothing and asks nothing plays itself, and one that stops to ask something of its own
//! waits as a prompt. A card that is a decision is offered to a table that asks (`ask_defender`) - which is
//! the next half's, and refuses until then. With nobody asked, it is simply not played.

use super::fight::not_yet;
use super::features::Left;
use super::log::{name_of, note};
use super::play::{OnDone, PendingScript};
use super::session::Session;
use super::swing::HeldSwing;
use crate::combat::defense::can_pay_for;
use crate::content::abilities::{loadout_of, AbilityDef};
use crate::js;
use crate::rules::countdown::CountdownCue;
use crate::rules::duality::DualityRoll;
use crate::scene::state::Faction;
use crate::script::conditions::{evaluate, BoundRoll, TargetBindings};
use crate::script::runner::{LastDamageOption, RunStatus, RunnerOptions, ScriptRunner, SuspendedRunner};
use crate::script::world::scenario::use_key;
use crate::script::world::PayoutOwed;
use serde_json::{json, Map, Value};

/// One card, ready to run, with everything the moment left behind (`ReactionOffer`).
#[derive(Clone, Debug, PartialEq)]
pub struct ReactionOffer {
    pub by: String,
    pub ability: AbilityDef,
    /// Who the card is aimed at: whoever struck, or whoever was struck.
    pub targets: Vec<String>,
    /// The other one, when the moment names two.
    pub hit: Option<Vec<String>>,
    pub counts: Map<String, Value>,
    pub last_damage: Option<LastDamageOption>,
    /// The roll that raised it, for a card that asks what the dice said.
    pub roll: Option<BoundRoll>,
    /// And its dice, for a card that puts the same roll against somebody else.
    pub swing: Option<DualityRoll>,
}

/// Everything else a moment left behind, all of it optional (`offersFor`'s `left`).
#[derive(Default)]
pub(super) struct Moment<'a> {
    pub last_damage: Option<LastDamageOption>,
    /// A swing of the holder's waiting on these cards: a card that plays itself changes it here.
    pub landing: Option<&'a mut HeldSwing>,
    pub roll: Option<BoundRoll>,
    pub swing: Option<DualityRoll>,
    pub hit: Option<Vec<String>>,
}

/// The roll a `rolled` gate reads, from the dice.
pub(super) fn bound_roll(roll: &DualityRoll) -> BoundRoll {
    BoundRoll { total: roll.total, outcome: Some(roll.outcome), tags: None, trait_: None }
}

pub(super) fn counts(pairs: &[(&str, f64)]) -> Map<String, Value> {
    pairs.iter().map(|(k, v)| (k.to_string(), json!(v))).collect()
}

/// A card nobody holds, made for one moment: ground that bites, a debt collected.
fn made_card(id: &str, name: &str, text: &str, auto: bool, effects: Vec<Value>) -> AbilityDef {
    serde_json::from_value(json!({
        "id": id,
        "name": name,
        "source": { "card": id },
        "text": text,
        "kind": "reaction",
        "auto": auto,
        "effects": effects,
    }))
    .expect("a made card reads")
}

impl Session {
    /// Whether a character can play this card in answer to something right now (`canPlay`).
    fn can_play(&self, id: &str, ability: &AbilityDef) -> bool {
        let Some(entity) = self.world.state.entity(id) else { return false };
        let left = match &ability.uses {
            None => f64::INFINITY,
            Some(uses) => js::max(0.0, uses.count - self.world.scenario.ability_uses.get(&use_key(id, &ability.id)).copied().unwrap_or(0.0)),
        };
        can_pay_for(entity.good.as_ref(), &entity.stress, ability) && left > 0.0
    }

    /// Pay a reaction's cost (`payFor`): false when it turned out they could not.
    fn pay_for(&mut self, id: &str, ability: &AbilityDef) -> bool {
        if self.world.state.entity(id).is_none() {
            return false;
        }
        let good = ability.cost.good.unwrap_or(0.0);
        let stress = ability.cost.stress.unwrap_or(0.0);
        if good > 0.0 && !self.world.spend_good(id, good) {
            return false;
        }
        if stress > 0.0 {
            self.world.mark_stress(id, stress);
        }
        if ability.uses.is_some() {
            let key = use_key(id, &ability.id);
            let used = self.world.scenario.ability_uses.get(&key).copied().unwrap_or(0.0);
            self.world.scenario.ability_uses.set(&key, used + 1.0);
        }
        true
    }

    /// What a party member can play about something that has already happened (`offersFor`): the free ones
    /// run here, and what is left is handed back to be put to the player.
    pub(super) fn offers_for(&mut self, id: &str, triggers: &[&str], bound: &[String], counts: &Map<String, Value>, mut left: Moment) -> Result<Vec<ReactionOffer>, String> {
        let beaten = left.hit.clone().unwrap_or_else(|| bound.to_vec());
        let mut offers = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        for trigger in triggers {
            let bindings = TargetBindings { targets: bound.to_vec(), hit: beaten.clone(), counts: Some(counts.clone()), roll: left.roll.clone(), point: None };
            for ability in self.world.reactions_for(id, trigger, Some(&bindings)) {
                if ability.effects.is_empty() || seen.contains(&ability.id) {
                    continue;
                }
                seen.push(ability.id.clone());
                if !self.can_play(id, &ability) {
                    continue;
                }
                let free = ability.auto && ability.cost.good.unwrap_or(0.0) == 0.0 && ability.cost.stress.unwrap_or(0.0) == 0.0;
                let offer = ReactionOffer {
                    by: id.to_string(),
                    ability,
                    targets: bound.to_vec(),
                    hit: left.hit.clone(),
                    counts: counts.clone(),
                    last_damage: left.last_damage.clone(),
                    roll: left.roll.clone(),
                    swing: left.swing.clone(),
                };
                if free {
                    let held = left.landing.as_deref().cloned();
                    let ran = self.play_reaction(offer, false, held.clone())?;
                    if let (Some(landing), Some(held)) = (left.landing.as_deref_mut(), held) {
                        if let Some(answered) = self.as_answered(Some(held), &ran) {
                            *landing = answered;
                        }
                    }
                    continue;
                }
                offers.push(offer);
            }
        }
        Ok(offers)
    }

    /// Put the first group of offers to the player (`offerReactions`). With nobody at the table to ask, an
    /// optional card is simply not played; a table that asks is the next half's.
    pub(super) fn offer_reactions(&mut self, groups: Vec<Vec<ReactionOffer>>) -> Result<(), String> {
        if groups.iter().all(Vec::is_empty) || !self.ask_defender {
            return Ok(());
        }
        Err(not_yet("A card offered to the table"))
    }

    /// Run one of the party's reactions (`playReaction`): pay, then play its script with what the moment
    /// left behind. A card that stops to ask something waits as a prompt, and what finishing it resumes is
    /// done then; one that runs through is done now when `resume`. What it journalled, for a caller still
    /// holding a blow.
    pub(super) fn play_reaction(&mut self, offer: ReactionOffer, resume: bool, landing: Option<HeldSwing>) -> Result<Vec<Value>, String> {
        if !self.pay_for(&offer.by, &offer.ability) {
            if resume {
                self.after_reaction(landing)?;
            }
            return Ok(Vec::new());
        }
        let who = name_of(self, &offer.by);
        note(self, &format!("{who}: {}.", offer.ability.name), "good");
        let was = self.world.scenario.actor_id.replace(offer.by.clone());
        let options = RunnerOptions {
            targets: Some(offer.targets.clone()),
            hit: Some(offer.hit.clone().unwrap_or_else(|| offer.targets.clone())),
            roll_as: Some("actor".into()),
            counts: Some(offer.counts.clone()),
            last_damage: offer.last_damage.clone(),
            roll: offer.roll.clone(),
            swing: offer.swing.clone(),
            ..RunnerOptions::default()
        };
        let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
        let status = runner.run(&offer.ability.effects);
        let journal = runner.entries().to_vec();
        let runner = runner.suspend();
        self.record(&journal)?;
        if let RunStatus::Waiting(prompt) = status {
            // The actor stays theirs until the card is done with.
            let finish = OnDone::Reaction { by: offer.by.clone(), ability: Box::new(offer.ability.clone()), landing: landing.map(Box::new), was };
            self.pending = Some(PendingScript::new(runner, prompt, journal.len(), finish));
            return Ok(journal);
        }
        self.world.scenario.actor_id = was;
        self.vault_after(&offer.by, &offer.ability, &runner)?;
        if resume {
            let answered = self.as_answered(landing, &journal);
            self.after_reaction(answered)?;
        }
        Ok(journal)
    }

    /// A card that stopped to ask something is done (`playReaction`'s `onDone`).
    pub(super) fn reaction_done(&mut self, by: &str, ability: &AbilityDef, landing: Option<HeldSwing>, was: Option<String>, runner: &SuspendedRunner) -> Result<(), String> {
        self.world.scenario.actor_id = was;
        self.vault_after(by, ability, runner)?;
        let answered = self.as_answered(landing, runner.entries());
        self.after_reaction(answered)
    }

    /// "Then place this card in your vault" (`vaultAfter`).
    fn vault_after(&mut self, id: &str, ability: &AbilityDef, runner: &SuspendedRunner) -> Result<(), String> {
        if !runner.vaulted {
            return Ok(());
        }
        let card = ability.source.card.clone();
        let (Some(sheet), Some(character)) = (self.sheets.get(id).cloned(), self.characters.get(id)) else { return Ok(()) };
        let loadout = loadout_of(character.sheet.loadout.as_deref(), &character.cards);
        if !loadout.contains(&card) {
            return Ok(());
        }
        let kept: Vec<String> = loadout.into_iter().filter(|held| *held != card).collect();
        self.set_sheet(crate::character::sheet::CharacterSheet { loadout: Some(kept), ..sheet })?;
        self.refresh_world();
        self.sync_pools();
        let who = name_of(self, id);
        note(self, &format!("{who} places {} in the vault.", ability.name), "system");
        Ok(())
    }

    /// Ask the next character what they make of it, or let the fight carry on (`afterReaction`). Nothing is
    /// queued behind a card while nobody is asked, and no script is held mid-roll.
    pub(super) fn after_reaction(&mut self, landing: Option<HeldSwing>) -> Result<(), String> {
        if self.waiting() {
            return Ok(());
        }
        if let Some(landing) = landing {
            if landing.stage_rolled {
                self.after_rolled(HeldSwing { stage_rolled: false, ..landing })?;
            } else {
                self.land_party_attack(landing)?;
            }
        }
        self.play_death_moves()?;
        if !self.waiting() {
            self.settle_fight()?;
        }
        if self.gm_turn.is_some() {
            self.run_gm_turn()?;
        }
        Ok(())
    }

    // ---- the moments ---------------------------------------------------------------------------------

    /// What the ground does to somebody who has just walked onto it (`playZoneEntries`).
    pub(super) fn play_zone_entries(&mut self) -> Result<(), String> {
        for crossing in self.world.drain_entered() {
            let Some(def) = self.world.condition_def(&crossing.condition).cloned() else { continue };
            let Some(on_enter) = def.on_enter.filter(|o| !o.effects.is_empty()) else { continue };
            if !self.world.state.entity(&crossing.id).is_some_and(|e| e.alive) {
                continue;
            }
            let by = match &crossing.owner {
                Some(owner) if self.world.state.entity(owner).is_some_and(|e| e.alive) => owner.clone(),
                _ => crossing.id.clone(),
            };
            let id = format!("zone-{}", crossing.condition);
            let ability = made_card(&id, &def.name, "The ground they just stepped onto.", true, on_enter.effects.clone());
            let offer = ReactionOffer { by, ability, targets: vec![crossing.id.clone()], hit: None, counts: Map::new(), last_damage: None, roll: None, swing: None };
            self.play_reaction(offer, false, None)?;
        }
        Ok(())
    }

    /// The features and cards that answer a wound, for each blow that landed (`playDamageReactions`).
    pub(super) fn play_damage_reactions(&mut self) -> Result<(), String> {
        let mut asked: Vec<Vec<ReactionOffer>> = Vec::new();
        for _pass in 0..4 {
            let took = self.world.drain_damage();
            if took.is_empty() {
                break;
            }
            for blow in took {
                let Some(entity) = self.world.state.entity(&blow.id).filter(|e| e.alive) else { continue };
                let faction = entity.faction;
                let attacker = blow.attacker.clone().filter(|a| self.world.state.entity(a).is_some_and(|e| e.alive));
                let mut triggers = vec!["tookDamage"];
                if blow.hit_points > 0.0 {
                    triggers.push("tookHitPoints");
                }
                if blow.severe {
                    triggers.push("tookSevere");
                }
                let taken = counts(&[("hitPointsTaken", blow.hit_points)]);
                let bound: Vec<String> = attacker.into_iter().collect();
                let last_damage = LastDamageOption { total: blow.damage, types: Some(blow.types.clone()) };
                if faction == Faction::Party {
                    let offers = self.offers_for(&blow.id, &triggers, &bound, &taken, Moment { last_damage: Some(last_damage.clone()), ..Moment::default() })?;
                    if !offers.is_empty() {
                        asked.push(offers);
                    }
                    let others: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
                    for other in others {
                        if other == blow.id || !self.world.state.entity(&other).is_some_and(|e| e.alive) {
                            continue;
                        }
                        let theirs = self.offers_for(&other, &["allyTookDamage"], &bound, &taken, Moment { last_damage: Some(last_damage.clone()), ..Moment::default() })?;
                        if !theirs.is_empty() {
                            asked.push(theirs);
                        }
                    }
                    let nearby = self.nearby_offers(&blow.id, &bound, &taken, &last_damage)?;
                    asked.extend(nearby);
                    continue;
                }
                if faction != Faction::Adversary {
                    continue;
                }
                for trigger in &triggers {
                    let bindings = TargetBindings { targets: bound.clone(), hit: bound.clone(), counts: Some(taken.clone()), ..TargetBindings::default() };
                    for ability in self.world.reactions_for(&blow.id, trigger, Some(&bindings)) {
                        if ability.effects.is_empty() || !self.affordable_reaction(&blow.id, &ability) {
                            continue;
                        }
                        self.spend_feature_cost(&blow.id, &ability, true);
                        let from = Left { counts: Some(taken.clone()), last_damage: Some(last_damage.clone()), roll: None };
                        self.run_adversary_script(&blow.id, &ability, &bound, &bound, from)?;
                    }
                }
                let nearby = self.nearby_offers(&blow.id, &bound, &taken, &last_damage)?;
                asked.extend(nearby);
            }
        }
        self.offer_reactions(asked)
    }

    /// What everybody else in the room makes of somebody being hurt (`nearbyOffers`).
    fn nearby_offers(&mut self, wounded: &str, dealer: &[String], taken: &Map<String, Value>, last_damage: &LastDamageOption) -> Result<Vec<Vec<ReactionOffer>>, String> {
        let mut asked = Vec::new();
        let everybody: Vec<String> = self.world.state.entities_of(Faction::Party).chain(self.world.state.entities_of(Faction::Adversary)).map(|e| e.id.clone()).collect();
        for other in everybody {
            let Some(entity) = self.world.state.entity(&other) else { continue };
            if other == wounded || !entity.alive {
                continue;
            }
            match entity.faction {
                Faction::Party => {
                    let moment = Moment { last_damage: Some(last_damage.clone()), hit: Some(vec![wounded.to_string()]), ..Moment::default() };
                    let theirs = self.offers_for(&other, &["nearbyTookDamage"], dealer, taken, moment)?;
                    if !theirs.is_empty() {
                        asked.push(theirs);
                    }
                }
                Faction::Adversary => {
                    let bindings = TargetBindings { targets: dealer.to_vec(), hit: vec![wounded.to_string()], counts: Some(taken.clone()), ..TargetBindings::default() };
                    for ability in self.world.reactions_for(&other, "nearbyTookDamage", Some(&bindings)) {
                        if ability.effects.is_empty() || !self.affordable_reaction(&other, &ability) {
                            continue;
                        }
                        self.spend_feature_cost(&other, &ability, true);
                        let from = Left { counts: Some(taken.clone()), last_damage: Some(last_damage.clone()), roll: None };
                        self.run_adversary_script(&other, &ability, dealer, &[wounded.to_string()], from)?;
                    }
                }
                _ => {}
            }
        }
        Ok(asked)
    }

    /// What the room makes of a roll the party made (`playPartyRolled`).
    pub(super) fn play_party_rolled(&mut self, roller: &str, roll: &Value) -> Result<(), String> {
        if self.world.state.entity(roller).map(|e| e.faction) != Some(Faction::Party) {
            return Ok(());
        }
        let bound = BoundRoll { total: roll["total"].as_f64().unwrap_or(0.0), outcome: serde_json::from_value(roll["outcome"].clone()).ok(), tags: None, trait_: None };
        let bindings = TargetBindings { targets: vec![roller.to_string()], hit: vec![roller.to_string()], roll: Some(bound.clone()), ..TargetBindings::default() };
        self.world.ends_on_roll(roller);
        let mut asked = Vec::new();
        let members: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
        for member in members {
            if !self.world.state.entity(&member).is_some_and(|e| e.alive) {
                continue;
            }
            let theirs = self.offers_for(&member, &["partyRolled"], &[roller.to_string()], &Map::new(), Moment { roll: Some(bound.clone()), ..Moment::default() })?;
            if !theirs.is_empty() {
                asked.push(theirs);
            }
        }
        self.offer_reactions(asked)?;
        let foes: Vec<String> = self.world.state.entities_of(Faction::Adversary).map(|e| e.id.clone()).collect();
        for foe in foes {
            if !self.world.state.entity(&foe).is_some_and(|e| e.alive) {
                continue;
            }
            for ability in self.world.reactions_for(&foe, "partyRolled", Some(&bindings)) {
                if ability.effects.is_empty() || !self.affordable_reaction(&foe, &ability) {
                    continue;
                }
                self.spend_feature_cost(&foe, &ability, true);
                let from = Left { roll: Some(bound.clone()), ..Left::default() };
                self.run_adversary_script(&foe, &ability, &[roller.to_string()], &[roller.to_string()], from)?;
            }
        }
        Ok(())
    }

    /// "Until after the next attack made against you": whoever was swung at counts the swing (`playAttackedOn`).
    pub(super) fn play_attacked_on(&mut self, defender: &str, attacker: &str) -> Result<(), String> {
        let Some(entity) = self.world.state.entity(defender).filter(|e| e.alive) else { return Ok(()) };
        let bound: Vec<String> = if self.world.state.entity(attacker).is_some_and(|e| e.alive) { vec![attacker.to_string()] } else { Vec::new() };
        if entity.faction == Faction::Party {
            let offers = self.offers_for(defender, &["attacked"], &bound, &Map::new(), Moment::default())?;
            return self.offer_reactions(vec![offers]);
        }
        let bindings = TargetBindings { targets: bound.clone(), hit: bound.clone(), ..TargetBindings::default() };
        for ability in self.world.reactions_for(defender, "attacked", Some(&bindings)) {
            if ability.effects.is_empty() || !self.affordable_reaction(defender, &ability) {
                continue;
            }
            self.spend_feature_cost(defender, &ability, true);
            self.run_adversary_script(defender, &ability, &bound, &bound, Left::default())?;
        }
        Ok(())
    }

    /// What a stat block or a card hangs on its holder's own swing landing (`playAttackRiders`).
    pub(super) fn play_attack_riders(&mut self, attacker: &str, defender: &str, hit_points: f64, roll: Option<&DualityRoll>) -> Result<(), String> {
        if !self.world.state.entity(attacker).is_some_and(|e| e.alive) || !self.world.state.entity(defender).is_some_and(|e| e.alive) {
            return Ok(());
        }
        let triggers: &[&str] = if hit_points > 0.0 { &["dealtHit", "dealtDamage"] } else { &["dealtHit"] };
        let dealt = counts(&[("hitPointsDealt", hit_points)]);
        let party = self.world.state.entity(attacker).map(|e| e.faction) == Some(Faction::Party);
        if party {
            let moment = Moment { roll: roll.map(bound_roll), swing: roll.cloned(), ..Moment::default() };
            let offers = self.offers_for(attacker, triggers, &[defender.to_string()], &dealt, moment)?;
            return self.offer_reactions(vec![offers]);
        }
        for trigger in triggers {
            let bindings = TargetBindings { targets: vec![defender.to_string()], hit: vec![defender.to_string()], counts: Some(dealt.clone()), roll: roll.map(bound_roll), point: None };
            for ability in self.world.reactions_for(attacker, trigger, Some(&bindings)) {
                if ability.effects.is_empty() {
                    continue;
                }
                let from = Left { counts: Some(dealt.clone()), ..Left::default() };
                self.run_adversary_script(attacker, &ability, &[defender.to_string()], &[defender.to_string()], from)?;
            }
        }
        Ok(())
    }

    /// "When you fail an attack, you can mark a Stress to…" (`playMissRiders`): the party's side only.
    pub(super) fn play_miss_riders(&mut self, attacker: &str, defender: &str, roll: Option<&DualityRoll>) -> Result<(), String> {
        if !self.world.state.entity(attacker).is_some_and(|e| e.alive) || !self.world.state.entity(defender).is_some_and(|e| e.alive) {
            return Ok(());
        }
        if self.world.state.entity(attacker).map(|e| e.faction) != Some(Faction::Party) {
            return Ok(());
        }
        let moment = Moment { roll: roll.map(bound_roll), ..Moment::default() };
        let offers = self.offers_for(attacker, &["dealtMiss"], &[defender.to_string()], &Map::new(), moment)?;
        self.offer_reactions(vec![offers])
    }

    /// What a creature owed whoever swung at them, put to them as a card would be (`playPayouts`).
    pub(super) fn play_payouts(&mut self, attacker: &str, target: &str, owed: Vec<PayoutOwed>, roll: Option<&DualityRoll>) -> Result<(), String> {
        let mut asked = Vec::new();
        for debt in owed {
            if !self.world.state.entity(target).is_some_and(|e| e.has_condition(&debt.condition)) {
                continue;
            }
            if let Some(when) = &debt.when {
                let was = self.world.scenario.actor_id.replace(attacker.to_string());
                let bindings = TargetBindings { targets: vec![target.to_string()], hit: vec![target.to_string()], roll: roll.map(bound_roll), ..TargetBindings::default() };
                let holds = evaluate(when, &mut self.world, &bindings, false);
                self.world.scenario.actor_id = was;
                if !holds {
                    continue;
                }
            }
            let name = self.world.condition_name(&debt.condition);
            let auto = debt.auto == Some(true);
            let mut effects = debt.effects.clone();
            if debt.keeps != Some(true) {
                effects.push(json!({ "kind": "clearCondition", "condition": debt.condition, "target": { "kind": "target" } }));
            }
            let id = format!("payout-{}", debt.condition);
            let ability = made_card(&id, &name, "What somebody else left you.", auto, effects);
            let offer = ReactionOffer { by: attacker.to_string(), ability, targets: vec![target.to_string()], hit: None, counts: Map::new(), last_damage: None, roll: None, swing: None };
            if auto {
                self.play_reaction(offer, false, None)?;
                continue;
            }
            asked.push(vec![offer]);
        }
        if !asked.is_empty() {
            self.offer_reactions(asked)?;
        }
        Ok(())
    }

    /// The countdown cues a swing that never went through the runner raises by hand.
    pub(super) fn swing_cues(&mut self, roll: Option<&DualityRoll>, target: &str, marked: f64) -> Result<(), String> {
        if let Some(roll) = roll {
            self.tick_countdowns(&CountdownCue::ActionRoll { attack: true, outcome: roll.outcome })?;
        }
        if marked > 0.0 {
            self.tick_countdowns(&CountdownCue::HpMarked { id: target.to_string(), marked })?;
        }
        Ok(())
    }
}

