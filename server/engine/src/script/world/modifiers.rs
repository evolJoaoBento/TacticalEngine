//! What a creature holds and what it adds: a character's class, subclass and loadout - with the cards a
//! condition lends - or the features printed on a stat block; the modifiers those carry and the ones a
//! condition wears, read from the holder's chair; the swing a block prints, the damage it shrugs off, the
//! dice on either scale of a roll, and the reactions it may answer with.

use super::SceneScriptWorld;
use crate::character::sheet::{granted_cards, lent_cards, trait_part, DerivedCharacter};
use crate::combat::attack::condition_modifiers;
use crate::content::abilities::{abilities_for, stat_blocks_of, AbilityDef, AbilityKind, AbilityModifier, Requires, Stat};
use crate::content::adversaries::AdversaryDef;
use crate::content::conditions::ConditionBlock;
use crate::content::pack::CardDef;
use crate::js;
use crate::rules::damage::{DamageDefenses, DamageReduction, DamageSeverity};
use crate::rules::dice::{parse_dice, ParsedDamage};
use crate::script::conditions::{evaluate, TargetBindings};
use crate::script::runner::Advantage;
use crate::script::zones::RunningZone;
use serde_json::Value;

/// What a stat block's passives say about the swing it prints.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Swing {
    pub direct: bool,
    pub damage: Option<ParsedDamage>,
    pub double: bool,
    pub severity: Option<DamageSeverity>,
}

fn net(advantage: f64) -> Advantage {
    Advantage { advantage: js::max(0.0, advantage), disadvantage: js::max(0.0, -advantage) }
}

impl<'w> SceneScriptWorld<'w> {
    /// A condition read from somebody's chair: `id` acting, the bindings naming whoever it is about.
    pub(super) fn holds_as(&mut self, id: &str, when: &Value, bindings: &TargetBindings) -> bool {
        let was = self.scenario.actor_id.replace(id.to_string());
        let held = evaluate(when, self, bindings, false);
        self.scenario.actor_id = was;
        held
    }

    /// The abilities a creature holds: a character's in bar order, or a stat block's features and what a
    /// condition on it lends.
    pub fn held_by(&self, id: &str) -> Vec<&'w AbilityDef> {
        let content = self.content;
        if let Some(character) = content.characters.get(id) {
            let granted: Vec<CardDef> = match &content.cards {
                None => character.granted.clone(),
                Some(cards) => granted_cards(&character.sheet, cards).into_iter().chain(self.lent_to(id)).cloned().collect(),
            };
            return abilities_for(character.sheet.loadout.as_deref(), &character.cards, &granted, &content.abilities);
        }
        let mut own = self.state.entity(id).map(|e| self.abilities_for_adversary(&e.definition)).unwrap_or_default();
        own.extend(self.abilities_on(&self.lent_to(id)));
        own
    }

    /// The cards the conditions on a creature lend it: none in a world handed no cards.
    fn lent_to(&self, id: &str) -> Vec<&'w CardDef> {
        let content = self.content;
        match (self.state.entity(id), &content.cards) {
            (Some(entity), Some(cards)) => lent_cards(&entity.conditions, cards),
            _ => Vec::new(),
        }
    }

    /// The abilities on these cards, in the library's order.
    fn abilities_on(&self, cards: &[&CardDef]) -> Vec<&'w AbilityDef> {
        if cards.is_empty() {
            return Vec::new();
        }
        self.content.abilities.iter().filter(|a| cards.iter().any(|card| card.id == a.source.card)).collect()
    }

    /// The scripted features of a stat block, named by the definition so every creature off it shares them.
    pub fn abilities_for_adversary(&self, definition: &str) -> Vec<&'w AbilityDef> {
        let content = self.content;
        let cards: &[CardDef] = content.cards.as_deref().unwrap_or(&[]);
        content.abilities.iter().filter(|a| stat_blocks_of(a, cards).is_some_and(|blocks| blocks.iter().any(|b| b == definition))).collect()
    }

    /// The stat block a definition names, out of the content this fight is played with.
    pub fn adversary_def(&self, definition: &str) -> Option<&'w AdversaryDef> {
        self.content.adversaries.get(definition)
    }

    /// Every modifier on a creature now: its abilities' - a character's static ones already in its
    /// numbers, so for pools only the gated and the per-token count - what a condition lends a character,
    /// and what its conditions wear. Gates are read from the holder's chair.
    pub fn modifiers_of(&mut self, id: &str, pool: bool, bindings: &TargetBindings) -> Vec<AbilityModifier> {
        let Some(entity) = self.state.entity(id) else { return Vec::new() };
        let conditions = entity.conditions.clone();
        let character: Option<&'w DerivedCharacter> = self.content.characters.get(id);
        let mine: Vec<&'w AbilityModifier> = match character {
            Some(character) => character.modifiers.iter().collect(),
            None => self.held_by(id).into_iter().filter(|a| a.kind == AbilityKind::Passive).flat_map(|a| a.modifiers.iter()).collect(),
        };
        let mut out = Vec::new();
        for m in mine {
            if pool && m.when.is_none() && m.per_token.is_none() && character.is_some() {
                continue;
            }
            if m.when.as_ref().is_none_or(|when| self.holds_as(id, when, bindings)) {
                out.push(m.clone());
            }
        }
        if character.is_some() {
            let lent: Vec<&'w AbilityModifier> = self.abilities_on(&self.lent_to(id)).into_iter().filter(|a| a.kind == AbilityKind::Passive).flat_map(|a| a.modifiers.iter()).collect();
            for m in lent {
                if m.when.as_ref().is_none_or(|when| self.holds_as(id, when, bindings)) {
                    out.push(m.clone());
                }
            }
        }
        for condition in &conditions {
            if let Some(def) = self.content.condition_defs.get(condition) {
                out.extend(def.modifiers.iter().cloned());
            }
        }
        out
    }

    /// What a stat block's passives say about the swing it prints, read from the attacker's chair with the
    /// target bound; a passive with a gate and nobody to read it against says nothing.
    pub fn standard_attack_of(&mut self, definition: &str, between: Option<(&str, &str)>) -> Swing {
        let mut swing = Swing::default();
        for ability in self.abilities_for_adversary(definition) {
            let Some(said) = ability.standard_attack.as_ref().filter(|_| ability.kind == AbilityKind::Passive) else { continue };
            if let Some(when) = &said.when {
                let Some((attacker, target)) = between else { continue };
                let bindings = TargetBindings { targets: vec![target.into()], hit: vec![target.into()], ..TargetBindings::default() };
                if !self.holds_as(attacker, when, &bindings) {
                    continue;
                }
            }
            if said.direct == Some(true) {
                swing.direct = true;
            }
            if said.double == Some(true) {
                swing.double = true;
            }
            if said.severity.is_some() {
                swing.severity = said.severity;
            }
            if let Some(damage) = &said.damage {
                swing.damage = parse_dice(damage).or(swing.damage);
            }
        }
        swing
    }

    /// The zones a creature is standing in, by the condition they are bearing.
    pub(super) fn zones_over(&self, id: &str) -> Vec<RunningZone> {
        match self.state.entity(id) {
            Some(entity) if !self.scenario.zones.is_empty() => self.scenario.zones.values().filter(|z| entity.has_condition(&z.condition)).cloned().collect(),
            _ => Vec::new(),
        }
    }

    /// The damage types a creature halves or ignores, and what comes off: its passives', its conditions',
    /// and the ground it stands on. Types do not stack; reductions do.
    pub fn defenses_of(&self, id: &str) -> DamageDefenses {
        let mut out = DamageDefenses::default();
        let mut take = |defenses: Option<&DamageDefenses>| {
            let Some(defenses) = defenses else { return };
            for t in &defenses.resistances {
                if !out.resistances.contains(t) {
                    out.resistances.push(*t);
                }
            }
            for t in &defenses.immunities {
                if !out.immunities.contains(t) {
                    out.immunities.push(*t);
                }
            }
            out.reduce.extend(defenses.reduce.iter().cloned());
        };
        for ability in self.held_by(id) {
            if ability.kind == AbilityKind::Passive {
                take(ability.defenses.as_ref());
            }
        }
        for condition in self.state.entity(id).map(|e| e.conditions.clone()).unwrap_or_default() {
            take(self.content.condition_defs.get(&condition).and_then(|def| def.defenses.as_ref()));
        }
        for zone in self.zones_over(id) {
            if let Some(value) = zone.value.filter(|v| *v > 0.0) {
                out.reduce.push(DamageReduction { dice: js::number_to_string(value), only: None });
            }
        }
        out
    }

    fn sum_modifiers(&self, id: &str, modifiers: &[AbilityModifier]) -> f64 {
        let character = self.content.characters.get(id);
        modifiers.iter().fold(0.0, |sum, m| {
            let one = m.bonus
                + character.map_or(0.0, |c| trait_part(m.plus_trait, m.halve_trait, &c.traits))
                + if m.plus_proficiency == Some(true) { self.proficiency_of(id) } else { 0.0 };
            sum + match &m.per_token {
                None => one,
                Some(card) => one * self.tokens_on(id, card),
            }
        })
    }

    /// The bonus a creature's modifiers add to a roll of this kind; an attack or a Spellcast Roll takes
    /// what reads on every action roll too, once.
    pub fn roll_bonus(&mut self, id: &str, stat: Stat, melee: bool) -> f64 {
        let also_any = matches!(stat, Stat::AttackRoll | Stat::SpellcastRoll);
        let applicable: Vec<AbilityModifier> = self
            .modifiers_of(id, false, &TargetBindings::default())
            .into_iter()
            .filter(|m| (m.stat == stat || (also_any && m.stat == Stat::ActionRoll)) && m.against != Some(true) && (m.requires != Some(Requires::MeleeWeapon) || melee))
            .collect();
        self.sum_modifiers(id, &applicable)
    }

    /// What a creature's scene-dependent modifiers add to a pool or a defence.
    pub fn pool_bonus(&mut self, id: &str, stat: Stat) -> f64 {
        let applicable: Vec<AbilityModifier> = self
            .modifiers_of(id, true, &TargetBindings::default())
            .into_iter()
            .filter(|m| m.stat == stat && m.against != Some(true) && m.requires != Some(Requires::MeleeWeapon))
            .collect();
        self.sum_modifiers(id, &applicable)
    }

    fn advantage_modifiers(&mut self, id: &str, other: Option<&str>, against: bool, any_roll: bool) -> Vec<AbilityModifier> {
        let bindings = TargetBindings { targets: other.map(|o| vec![o.to_string()]).unwrap_or_default(), ..TargetBindings::default() };
        self.modifiers_of(id, false, &bindings)
            .into_iter()
            .filter(|m| m.stat == Stat::Advantage && (m.against == Some(true)) == against && (!any_roll || m.any_roll == Some(true)))
            .collect()
    }

    /// The advantage and disadvantage a swing carries beyond the target's conditions: the attacker's
    /// passives and the defender's, each read from its own chair with the other bound.
    pub fn advantage_for(&mut self, attacker: &str, defender: &str) -> Advantage {
        let mine = self.advantage_modifiers(attacker, Some(defender), false, false);
        let theirs = self.advantage_modifiers(defender, Some(attacker), true, false);
        net(self.sum_modifiers(attacker, &mine) + self.sum_modifiers(defender, &theirs))
    }

    /// The same, with what the feature itself said folded in.
    pub(super) fn advantage_with(&mut self, attacker: &str, defender: &str, extra: f64) -> Advantage {
        let passives = self.advantage_for(attacker, defender);
        net(passives.advantage - passives.disadvantage + extra)
    }

    /// The scales the actor carries into a roll that is not a swing: what a card gave their next action roll.
    pub fn advantage_rolling(&mut self) -> Advantage {
        let Some(actor) = self.scenario.actor_id.clone() else { return Advantage::default() };
        let mine = self.advantage_modifiers(&actor, None, false, true);
        net(self.sum_modifiers(&actor, &mine))
    }

    /// What the creatures a check is aimed at do to it: the best any grants and the worst any imposes,
    /// added - their conditions and what they carry against any roll.
    pub fn advantage_against(&mut self, targets: &[String]) -> Advantage {
        let actor = self.scenario.actor_id.clone();
        let (mut best, mut worst) = (0.0, 0.0);
        for id in targets {
            if self.state.entity(id).is_none() {
                continue;
            }
            let theirs = self.advantage_modifiers(id, actor.as_deref(), true, true);
            let (advantage, disadvantage) = condition_modifiers(self.state.entity(id).expect("still here"));
            let net = advantage - disadvantage + self.sum_modifiers(id, &theirs);
            best = js::max(best, net);
            worst = js::min(worst, net);
        }
        net(best + worst)
    }

    /// The reactions to incoming damage a creature holds.
    pub fn reactions_of(&mut self, id: &str) -> Vec<&'w AbilityDef> {
        self.reactions_for(id, "incomingDamage", None)
    }

    /// The reactions a creature holds that answer this trigger, each card's gate read with its holder
    /// acting. Stunned - whatever blocks reactions - silences them all. No bindings binds the holder to itself.
    pub fn reactions_for(&mut self, id: &str, trigger: &str, bindings: Option<&TargetBindings>) -> Vec<&'w AbilityDef> {
        if self.blocks(id, ConditionBlock::Reactions) {
            return Vec::new();
        }
        let own = TargetBindings { targets: vec![id.to_string()], ..TargetBindings::default() };
        let bindings = bindings.unwrap_or(&own).clone();
        let mut offered = Vec::new();
        for ability in self.held_by(id) {
            if ability.kind != AbilityKind::Reaction || ability.trigger.as_deref() != Some(trigger) {
                continue;
            }
            if ability.available.as_ref().is_none_or(|available| self.holds_as(id, available, &bindings)) {
                offered.push(ability);
            }
        }
        offered
    }
}
