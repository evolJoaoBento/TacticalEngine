//! The action bar (`src/game/demo-abilities.ts`): the abilities a character has, in bar order
//! (`abilitiesOf`), whom one may be aimed at (`abilityTargets`, `scriptTargets`), where a card aimed at the
//! ground may land and whom it would catch there (`pointTiles`, `shapeAt`), whether it can be used now and
//! why not (`canUseAbility`, `abilityList`), and using it (`useAbility`): the price paid, the script run, the
//! action spent in a fight, the card put back when its roll is stepped away from, the vault. Tokens are
//! placed again when what refills them comes round (`refillTokens`).

use super::content::{abilities_of, character_content_for};
use super::log::{name_of, note, LogLine};
use super::play::{OnDone, PendingScript, UseOutcome};
use super::session::Session;
use crate::character::sheet::{granted_cards, lent_cards};
use crate::content::abilities::{abilities_for, AbilityDef, AbilityKind};
use crate::grid::tile_grid::NO_TILE;
use crate::js;
use crate::rules::range::reaches;
use crate::rules::resources::{can_mark_stress, spend};
use crate::scene::state::Faction;
use crate::script::conditions::{evaluate_optional, TargetBindings};
use crate::script::runner::{RunStatus, RunnerOptions, ScriptRunner, SuspendedRunner};
use crate::script::schema::walk_effects;
use crate::script::world::scenario::use_key;
use serde::Serialize;
use serde_json::{json, Value};

/// What an action bar shows for one ability (`AbilityView`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityView {
    pub id: String,
    /// The rules text: the ability's own, or its card's.
    pub text: String,
    /// Whether the engine can run it, or it is text for the table.
    pub scripted: bool,
    pub usable: bool,
    /// Why not, when not.
    pub reason: Option<String>,
    /// Uses left before the next refresh, or nothing when unlimited.
    pub uses_left: Option<f64>,
    /// Valid targets right now, when it wants one.
    pub targets: Vec<String>,
    /// The card it sits on, with the domain its art is drawn in.
    pub card: Option<Value>,
}

/// Whether an ability has a script the engine can run (`isScripted`).
fn is_scripted(ability: &AbilityDef) -> bool {
    !ability.effects.is_empty() || !ability.modifiers.is_empty() || ability.reaction.is_some() || ability.defenses.is_some()
}

impl Session {
    /// Every ability a character has, in bar order (`abilitiesOf`): the cards in play as the project stands
    /// now, and whatever a condition on them lends while it lasts.
    pub fn abilities_of(&self, id: &str) -> Vec<AbilityDef> {
        let Some(character) = self.characters.get(id) else { return Vec::new() };
        let content = character_content_for(self.shipped(), &self.project);
        let bearing = self.world.state.entity(id).map(|e| e.conditions.clone()).unwrap_or_default();
        let mut granted: Vec<_> = granted_cards(&character.sheet, content.cards.iter()).into_iter().cloned().collect();
        granted.extend(lent_cards(&bearing, content.cards.iter()).into_iter().cloned());
        let abilities = abilities_of(&self.project);
        abilities_for(character.sheet.loadout.as_deref(), &character.cards, &granted, &abilities).into_iter().cloned().collect()
    }

    /// Uses left of a limited ability, or nothing when it is not limited (`usesLeft`).
    pub fn uses_left(&self, id: &str, ability: &AbilityDef) -> Option<f64> {
        let uses = ability.uses.as_ref()?;
        Some(js::max(0.0, uses.count - self.world.scenario.ability_uses.get(&use_key(id, &ability.id)).copied().unwrap_or(0.0)))
    }

    /// Who a script with no pick of its own rolls against (`scriptTargets`): its first check's own selector.
    pub fn script_targets(&mut self, id: &str, ability: &AbilityDef) -> Option<Vec<String>> {
        let first = ability.effects.iter().find(|e| e["kind"] == "check")?;
        let selector = first["check"].get("targets").filter(|t| !t.is_null())?.clone();
        let actor = self.world.scenario.actor_id.replace(id.to_string());
        let ids = self.world.resolve_targets(&selector, &TargetBindings::default());
        self.world.scenario.actor_id = actor;
        Some(ids)
    }

    /// The creatures an ability may be aimed at from where the actor stands (`abilityTargets`).
    pub fn ability_targets(&mut self, id: &str, ability: &AbilityDef) -> Vec<String> {
        match ability.target.kind.as_str() {
            "none" => return self.script_targets(id, ability).unwrap_or_default(),
            "self" => return vec![id.to_string()],
            "point" => return Vec::new(),
            _ => {}
        }
        let kind = ability.target.kind.clone();
        let fallen = ability.target.fallen == Some(true);
        let living: Vec<(String, Faction)> = self.world.state.all_entities().iter().filter(|e| e.alive || (fallen && e.faction == Faction::Party)).map(|e| (e.id.clone(), e.faction)).collect();
        let mut chosen = Vec::new();
        for (other, faction) in living {
            let fits = match kind.as_str() {
                "adversary" | "group" => faction == Faction::Adversary,
                "ally" => faction == Faction::Party,
                _ => true,
            };
            if !fits || !self.world.band_to(id, &other).is_some_and(|band| reaches(band, ability.target.range)) {
                continue;
            }
            if self.worth_aiming(id, ability, &other) {
                chosen.push(other);
            }
        }
        chosen
    }

    /// The tiles a card aimed at the ground may be aimed at (`pointTiles`): everything within its band.
    pub fn point_tiles(&self, id: &str, ability: &AbilityDef) -> Vec<i32> {
        if ability.target.kind != "point" {
            return Vec::new();
        }
        let here = self.world.state.entity(id).map_or(NO_TILE, |e| e.tile);
        if here == NO_TILE {
            return Vec::new();
        }
        (0..self.world.state.grid.size()).filter(|&tile| tile != here && self.world.band_between(here, tile).is_some_and(|band| reaches(band, ability.target.range))).collect()
    }

    /// Who a card aimed at this tile would catch, without aiming it (`shapeAt`).
    pub fn shape_at(&mut self, id: &str, ability: &AbilityDef, tile: i32) -> Vec<String> {
        if ability.target.kind != "point" || tile == NO_TILE {
            return Vec::new();
        }
        let was = self.world.scenario.actor_id.replace(id.to_string());
        let mut shapes: Vec<Value> = Vec::new();
        walk_effects(&ability.effects, &mut |effect| {
            let named = [effect.get("target"), effect.get("targets"), if effect["kind"] == "check" { effect["check"].get("targets") } else { None }];
            for selector in named.into_iter().flatten() {
                if !selector.is_object() {
                    continue;
                }
                if selector["kind"] != "inPath" && selector["around"] != "point" {
                    continue;
                }
                shapes.push(selector.clone());
            }
        });
        let mut caught: Vec<String> = Vec::new();
        for shape in shapes {
            let bindings = TargetBindings { point: Some(tile), ..TargetBindings::default() };
            for other in self.world.resolve_targets(&shape, &bindings) {
                if !caught.contains(&other) {
                    caught.push(other);
                }
            }
        }
        self.world.scenario.actor_id = was;
        caught
    }

    /// Whether an ability can be used now, and if not, why (`canUseAbility`).
    pub fn can_use_ability(&mut self, id: &str, ability: &AbilityDef, targets: &[String]) -> Result<(), String> {
        let Some(entity) = self.world.state.entity(id).cloned().filter(|e| e.alive) else { return Err("not standing".into()) };
        if !self.characters.has(id) {
            return Err("not standing".into());
        }
        if self.waiting() {
            return Err("something is waiting for an answer".into());
        }
        match ability.kind {
            AbilityKind::Action => {}
            AbilityKind::Passive => return Err("always on".into()),
            AbilityKind::Reaction => return Err("a reaction".into()),
        }
        if !is_scripted(ability) {
            return Err("the table adjudicates this one".into());
        }
        let fighting = self.in_combat();
        if ability.in_combat_only && !fighting {
            return Err("only in a fight".into());
        }
        if let Some(encounter) = self.encounter.as_ref().filter(|_| fighting) {
            if encounter.view(&self.world.state).side != crate::combat::encounter::Side::Party {
                return Err("the GM's turn".into());
            }
            if ability.action && !encounter.can_act(&self.world.state, id) {
                return Err("already acted".into());
            }
        }
        let cost = ability.cost;
        if cost.bad.unwrap_or(0.0) > 0.0 {
            return Err("only the GM spends Shadow".into());
        }
        if let Some(good) = cost.good.filter(|&g| g > 0.0) {
            if entity.good.map_or(0.0, |g| g.value) < good {
                return Err(format!("needs {} Light", js::number_to_string(good)));
            }
        }
        if cost.stress.is_some_and(|s| s > 0.0) && !can_mark_stress(&entity.stress, cost.stress.unwrap_or(0.0)) {
            return Err("no Stress slot to mark".into());
        }
        if self.uses_left(id, ability).is_some_and(|left| left <= 0.0) {
            let per = ability.uses.as_ref().map_or("rest", |u| u.per.as_str());
            return Err(format!("used until the next {}", match per {
                "longRest" => "long rest",
                "scene" => "fight",
                _ => "rest",
            }));
        }
        // The TypeScript leaves the actor where this puts it.
        self.world.scenario.actor_id = Some(id.to_string());
        let bindings = TargetBindings { targets: targets.to_vec(), ..TargetBindings::default() };
        if !evaluate_optional(ability.available.as_ref(), &mut self.world, &bindings, false) {
            return Err("not now".into());
        }
        match ability.target.kind.as_str() {
            "point" => {
                if self.point_tiles(id, ability).is_empty() {
                    return Err("nowhere to aim it".into());
                }
            }
            "none" => {
                if self.script_targets(id, ability).is_some_and(|t| t.is_empty()) {
                    return Err("nothing in range".into());
                }
            }
            _ => {
                let valid = self.ability_targets(id, ability);
                if valid.is_empty() {
                    return Err("nothing in range".into());
                }
                if !targets.is_empty() && !targets.iter().all(|t| valid.contains(t)) {
                    return Err("that target is out of range".into());
                }
            }
        }
        Ok(())
    }

    /// The words for an ability: its own, or else its card's (`abilityText`).
    fn ability_text(&self, ability: &AbilityDef) -> String {
        if !ability.text.is_empty() {
            return ability.text.clone();
        }
        let content = character_content_for(self.shipped(), &self.project);
        let Some(card) = content.cards.get(&ability.source.card) else { return String::new() };
        if card.name == ability.name {
            return card.text.clone();
        }
        card.features.iter().find(|f| f.name == ability.name).map_or_else(|| card.text.clone(), |f| f.text.clone())
    }

    /// The card an ability sits on, for its art (`cardArtOf`).
    fn card_art_of(&self, ability: &AbilityDef) -> Option<Value> {
        let content = character_content_for(self.shipped(), &self.project);
        let card = content.cards.get(&ability.source.card)?;
        let domain = if card.is_domain_card() { card.domain.clone().unwrap_or_default() } else { "granted".into() };
        Some(json!({ "id": card.id, "domain": domain }))
    }

    /// Everything a character can do, for an action bar (`abilityList`).
    pub fn ability_list(&mut self, id: &str) -> Vec<AbilityView> {
        let mut views = Vec::new();
        for ability in self.abilities_of(id) {
            let can = self.can_use_ability(id, &ability, &[]);
            let uses_left = self.uses_left(id, &ability);
            let targets = self.ability_targets(id, &ability);
            views.push(AbilityView {
                id: ability.id.clone(),
                text: self.ability_text(&ability),
                scripted: is_scripted(&ability),
                usable: can.is_ok(),
                reason: can.err(),
                uses_left,
                targets,
                card: self.card_art_of(&ability),
            });
        }
        views
    }

    /// Use an ability on some targets (`useAbility`): the price first, then the script; in a fight the action
    /// is spent when the script finishes, and stepping back from its roll puts the card down again.
    pub fn use_ability(&mut self, id: &str, ability_id: &str, targets: &[String], point: Option<i32>) -> Result<UseOutcome, String> {
        let Some(ability) = abilities_of(&self.project).into_iter().find(|a| a.id == ability_id) else { return Ok(UseOutcome { status: "missing", lines: Vec::new() }) };
        if !self.abilities_of(id).iter().any(|a| a.id == ability_id) {
            return Ok(UseOutcome { status: "missing", lines: Vec::new() });
        }
        if self.waiting() {
            return Ok(UseOutcome { status: "busy", lines: Vec::new() });
        }
        let kind = ability.target.kind.clone();
        let mut chosen = targets.to_vec();
        if kind == "self" {
            chosen = vec![id.to_string()];
        }
        if kind != "none" && kind != "self" && chosen.is_empty() {
            let valid = self.ability_targets(id, &ability);
            if valid.len() == 1 {
                chosen = valid;
            }
        }
        if let Err(reason) = self.can_use_ability(id, &ability, &chosen) {
            let who = name_of(self, id);
            let line = note(self, &format!("{who} cannot use {}: {reason}.", ability.name), "system");
            return Ok(UseOutcome { status: "refused", lines: vec![line] });
        }
        if kind == "point" && point.is_none_or(|p| p == NO_TILE) {
            let line = note(self, &format!("{} needs somewhere to aim.", ability.name), "system");
            return Ok(UseOutcome { status: "refused", lines: vec![line] });
        }
        if kind != "none" && kind != "point" && chosen.is_empty() {
            let line = note(self, &format!("{} needs a target.", ability.name), "system");
            return Ok(UseOutcome { status: "refused", lines: vec![line] });
        }
        if kind == "group" {
            let around = self.world.resolve_targets(&json!({ "kind": "adversaries", "range": "veryClose", "around": "target" }), &TargetBindings { targets: chosen.clone(), ..TargetBindings::default() });
            if !around.is_empty() {
                chosen = around;
            }
        }
        self.world.scenario.actor_id = Some(id.to_string());
        let who = name_of(self, id);
        let on = if !chosen.is_empty() && kind != "self" { format!(" on {}", chosen.iter().map(|c| name_of(self, c)).collect::<Vec<_>>().join(", ")) } else { String::new() };
        let mut lines: Vec<LogLine> = vec![note(self, &format!("{who} uses {}{on}.", ability.name), "system")];
        if let Some(good) = ability.cost.good.filter(|&g| g > 0.0) {
            if let Some(held) = self.world.state.entity(id).and_then(|e| e.good) {
                self.world.state.entity_mut(id).expect("standing").good = Some(spend(&held, good).currency);
                lines.push(note(self, &format!("Spends {} Light.", js::number_to_string(good)), "good"));
            }
        }
        if let Some(stress) = ability.cost.stress.filter(|&s| s > 0.0) {
            self.world.mark_stress(id, stress);
            lines.push(note(self, &format!("Marks {} Stress.", js::number_to_string(stress)), "bad"));
        }
        if ability.uses.is_some() {
            let key = use_key(id, &ability.id);
            let used = self.world.scenario.ability_uses.get(&key).copied().unwrap_or(0.0);
            self.world.scenario.ability_uses.set(&key, used + 1.0);
        }
        let fighting = self.in_combat();
        let options = RunnerOptions { targets: Some(chosen), roll_as: Some("actor".into()), point: point.filter(|&p| p != NO_TILE), ..RunnerOptions::default() };
        let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
        let status = runner.run(&ability.effects);
        let journal = runner.entries().to_vec();
        let runner = runner.suspend();
        lines.extend(self.record(&journal)?);
        let finish = OnDone::Used { id: id.to_string(), ability: Box::new(ability), fighting };
        if let RunStatus::Waiting(prompt) = status {
            self.pending = Some(PendingScript::new(runner, prompt, journal.len(), finish));
            return self.settle(lines);
        }
        self.done_using(finish, &runner)?;
        self.settle_travel(lines)
    }

    /// What using an ability does once its script is done (`useAbility`'s `finish`).
    pub(super) fn done_using(&mut self, finish: OnDone, runner: &SuspendedRunner) -> Result<(), String> {
        let OnDone::Used { id, ability, fighting } = finish else { return Ok(()) };
        if runner.cancelled && !runner.rolled {
            self.put_back(&id, &ability);
            return Ok(());
        }
        if fighting && ability.action && self.in_combat() {
            let encounter = self.encounter.as_mut().expect("a fight");
            if encounter.can_act(&self.world.state, &id) {
                encounter.act(&mut self.world.state, &id, runner.spotlight_to_gm);
            }
        }
        self.vault_after(&id, &ability, runner)?;
        self.settle_fight()
    }

    /// The card goes back in hand: what it cost is returned (`putBack`).
    fn put_back(&mut self, id: &str, ability: &AbilityDef) {
        let Some(entity) = self.world.state.entity_mut(id) else { return };
        if let (Some(good), Some(held)) = (ability.cost.good.filter(|&g| g > 0.0), entity.good) {
            entity.good = Some(crate::rules::resources::Currency { value: js::min(held.max, held.value + good), ..held });
        }
        if let Some(stress) = ability.cost.stress.filter(|&s| s > 0.0) {
            self.world.clear_stress(id, stress);
        }
        if ability.uses.is_some() {
            let key = use_key(id, &ability.id);
            let used = self.world.scenario.ability_uses.get(&key).copied().unwrap_or(1.0) - 1.0;
            if used <= 0.0 {
                self.world.scenario.ability_uses.delete(&key);
            } else {
                self.world.scenario.ability_uses.set(&key, used);
            }
        }
        let who = name_of(self, id);
        note(self, &format!("{who} steps back from {}; its cost is returned.", ability.name), "system");
    }

    /// Place tokens again on every card whose pile one of these events refills (`refillTokens`).
    pub fn refill_tokens(&mut self, events: &[&str]) {
        let members: Vec<String> = self.world.state.entities_of(Faction::Party).map(|e| e.id.clone()).collect();
        for member in members {
            for ability in self.abilities_of(&member) {
                let Some(tokens) = &ability.tokens else { continue };
                if !events.contains(&tokens.refill.as_str()) {
                    continue;
                }
                self.world.scenario.ability_tokens.delete(&use_key(&member, &ability.id));
                let placed = self.world.add_tokens(&member, &ability.id, None);
                if placed > 0.0 {
                    let who = name_of(self, &member);
                    note(self, &format!("{who} places {} token{} on {}.", js::number_to_string(placed), if placed == 1.0 { "" } else { "s" }, ability.name), "good");
                }
            }
        }
    }
}
