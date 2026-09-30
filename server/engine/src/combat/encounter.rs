//! Whose turn it is (`src/engine/combat/encounter.ts`): the party acts - under the spotlight, or with
//! action tokens the tracker counts - until a roll or a choice hands the spotlight to the GM, who spends
//! Shadow to spotlight adversaries one after another, then hands it back and a round has passed. The fight
//! ends when a side has nobody standing, or when something ends it. Each party member moves within a
//! circle drawn round where they stood as their turn began, Close unless a push widens it.
//!
//! The scene is the caller's: every method is handed it, and the runner keeps only the turn's own state.

use crate::grid::tile_grid::Spot;
use crate::rules::range::{next_band, RangeBand};
use crate::scene::state::{Faction, SceneState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnPolicy {
    /// Anyone in the party may act until a roll hands the spotlight over.
    Spotlight,
    /// Each character has a few tokens a round.
    Tracker,
}

pub const DEFAULT_TOKENS_PER_CHARACTER: f64 = 3.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Party,
    Gm,
}

/// How a fight ended - `stopped` is a script's End a fight, with enemies still standing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EncounterOutcome {
    Ongoing,
    Victory,
    Defeat,
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncounterView {
    pub side: Side,
    /// Party members who may act right now.
    pub ready: Vec<String>,
    /// Adversaries the GM has not yet spotlighted this turn.
    pub waiting: Vec<String>,
    pub round: u32,
    pub outcome: EncounterOutcome,
    /// Shadow the GM must spend to spotlight one more adversary this turn.
    pub next_spotlight_cost: f64,
}

/// Something the caller may want to log or animate.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EncounterEvent {
    Started { encounter: String },
    Spotlight { side: Side, round: u32 },
    Acted {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tokens_left: Option<f64>,
    },
    AdversaryActed { id: String, bad_spent: f64 },
    TokensRefilled { round: u32 },
    /// A character pushed their movement out a step, on a roll.
    Pushed { id: String, band: RangeBand },
    Ended { encounter: String, outcome: EncounterOutcome },
}

/// Where a party member's movement is drawn from this turn, and how far it reaches.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Circle {
    pub anchor: Spot,
    pub band: RangeBand,
}

pub struct EncounterRunner {
    pub encounter_id: String,
    pub policy: TurnPolicy,
    pub tokens_per_character: f64,
    tokens: HashMap<String, f64>,
    events: Vec<EncounterEvent>,
    /// Adversaries already spotlighted in the current GM turn.
    acted_this_gm_turn: Vec<String>,
    circles: HashMap<String, Circle>,
    side: Side,
    round_count: u32,
    started: bool,
    finished: EncounterOutcome,
}

fn alive_as(state: &SceneState, id: &str, faction: Faction) -> bool {
    state.entity(id).is_some_and(|e| e.alive && e.faction == faction)
}

impl EncounterRunner {
    pub fn new(encounter_id: &str, policy: Option<TurnPolicy>, tokens_per_character: Option<f64>) -> Self {
        EncounterRunner {
            encounter_id: encounter_id.into(),
            policy: policy.unwrap_or(TurnPolicy::Spotlight),
            tokens_per_character: crate::js::max(1.0, tokens_per_character.unwrap_or(DEFAULT_TOKENS_PER_CHARACTER)),
            tokens: HashMap::new(),
            events: Vec::new(),
            acted_this_gm_turn: Vec::new(),
            circles: HashMap::new(),
            side: Side::Party,
            round_count: 1,
            started: false,
            finished: EncounterOutcome::Ongoing,
        }
    }

    /// Begin. Marks the encounter started and fills the token budget.
    pub fn start(&mut self, state: &mut SceneState) -> EncounterView {
        if !self.started {
            self.started = true;
            let encounter = state.encounter(&self.encounter_id);
            encounter.started = true;
            encounter.triggered = true;
            self.refill_tokens(state, false);
            self.anchor_circles(state);
            self.events.push(EncounterEvent::Started { encounter: self.encounter_id.clone() });
            self.events.push(EncounterEvent::Spotlight { side: Side::Party, round: self.round_count });
        }
        self.view(state)
    }

    pub fn log(&self) -> &[EncounterEvent] {
        &self.events
    }

    pub fn round(&self) -> u32 {
        self.round_count
    }

    pub fn outcome(&self) -> EncounterOutcome {
        self.finished
    }

    /// Whether a character may take an action right now.
    pub fn can_act(&self, state: &SceneState, id: &str) -> bool {
        if self.finished != EncounterOutcome::Ongoing || self.side != Side::Party || !alive_as(state, id, Faction::Party) {
            return false;
        }
        self.policy == TurnPolicy::Spotlight || self.tokens.get(id).copied().unwrap_or(0.0) > 0.0
    }

    /// A character acts; under the tracker it costs a token. A roll that hands the spotlight over does.
    pub fn act(&mut self, state: &mut SceneState, id: &str, spotlight_to_gm: bool) -> EncounterView {
        if !self.can_act(state, id) {
            return self.view(state);
        }
        if self.policy == TurnPolicy::Tracker {
            let left = crate::js::max(0.0, self.tokens.get(id).copied().unwrap_or(0.0) - 1.0);
            self.tokens.insert(id.into(), left);
            self.events.push(EncounterEvent::Acted { id: id.into(), tokens_left: Some(left) });
        } else {
            self.events.push(EncounterEvent::Acted { id: id.into(), tokens_left: None });
        }
        if self.check_end(state) {
            return self.view(state);
        }
        // Under the tracker, running the party dry also hands the turn over.
        let spent = self.policy == TurnPolicy::Tracker && self.ready_characters(state).is_empty();
        if spotlight_to_gm || spent {
            self.pass_to_gm(state);
        }
        self.view(state)
    }

    /// Hand the spotlight to the GM without a roll having done it.
    pub fn pass_to_gm(&mut self, state: &SceneState) -> EncounterView {
        if self.finished != EncounterOutcome::Ongoing || self.side == Side::Gm {
            return self.view(state);
        }
        self.side = Side::Gm;
        self.acted_this_gm_turn.clear();
        self.events.push(EncounterEvent::Spotlight { side: Side::Gm, round: self.round_count });
        self.view(state)
    }

    /// The first adversary a GM turn spotlights is free; every one after costs a Shadow.
    pub fn next_spotlight_cost(&self) -> f64 {
        if self.acted_this_gm_turn.is_empty() {
            0.0
        } else {
            1.0
        }
    }

    fn acted(&self, id: &str) -> bool {
        self.acted_this_gm_turn.iter().any(|a| a == id)
    }

    fn mark_acted(&mut self, id: &str) {
        if !self.acted(id) {
            self.acted_this_gm_turn.push(id.into());
        }
    }

    /// Whether the GM can spotlight this adversary right now, and afford it.
    pub fn can_spotlight(&self, state: &SceneState, id: &str) -> bool {
        if self.finished != EncounterOutcome::Ongoing || self.side != Side::Gm || self.acted(id) || !alive_as(state, id, Faction::Adversary) {
            return false;
        }
        state.bad.value >= self.next_spotlight_cost()
    }

    pub fn spotlight(&mut self, state: &mut SceneState, id: &str) -> EncounterView {
        if !self.can_spotlight(state, id) {
            return self.view(state);
        }
        let cost = self.next_spotlight_cost();
        if cost > 0.0 {
            state.bad.value -= cost;
        }
        self.mark_acted(id);
        self.events.push(EncounterEvent::AdversaryActed { id: id.into(), bad_spent: cost });
        self.check_end(state);
        self.view(state)
    }

    /// A spotlight a feature hands out, free.
    pub fn grant_spotlight(&mut self, state: &mut SceneState, id: &str) -> EncounterView {
        if self.finished != EncounterOutcome::Ongoing || self.side != Side::Gm || !alive_as(state, id, Faction::Adversary) {
            return self.view(state);
        }
        self.mark_acted(id);
        self.events.push(EncounterEvent::AdversaryActed { id: id.into(), bad_spent: 0.0 });
        self.check_end(state);
        self.view(state)
    }

    /// Whether an adversary already spotlighted this turn can go again, for a Shadow.
    pub fn can_spotlight_again(&self, state: &SceneState, id: &str) -> bool {
        if self.finished != EncounterOutcome::Ongoing || self.side != Side::Gm || !self.acted(id) || !alive_as(state, id, Faction::Adversary) {
            return false;
        }
        state.bad.value >= 1.0
    }

    pub fn spotlight_again(&mut self, state: &mut SceneState, id: &str) -> EncounterView {
        if !self.can_spotlight_again(state, id) {
            return self.view(state);
        }
        state.bad.value -= 1.0;
        self.events.push(EncounterEvent::AdversaryActed { id: id.into(), bad_spent: 1.0 });
        self.check_end(state);
        self.view(state)
    }

    /// End the GM turn: "the spotlight goes back to the PCs."
    pub fn end_gm_turn(&mut self, state: &SceneState) -> EncounterView {
        if self.finished != EncounterOutcome::Ongoing || self.side != Side::Gm {
            return self.view(state);
        }
        self.side = Side::Party;
        self.round_count += 1;
        self.acted_this_gm_turn.clear();
        self.anchor_circles(state);
        // Under the tracker, a fresh round is when everyone gets their tokens back.
        if self.policy == TurnPolicy::Tracker && self.ready_characters(state).is_empty() {
            self.refill_tokens(state, true);
        }
        self.events.push(EncounterEvent::Spotlight { side: Side::Party, round: self.round_count });
        self.view(state)
    }

    /// Every living party member's circle drawn afresh round where they stand, at Close.
    fn anchor_circles(&mut self, state: &SceneState) {
        self.circles.clear();
        for entity in state.entities_of(Faction::Party).filter(|e| e.alive) {
            self.circles.insert(entity.id.clone(), Circle { anchor: entity.at, band: RangeBand::Close });
        }
    }

    /// Where a party member's movement is drawn from this turn. Somebody who joined mid-fight, or stood up
    /// again, is given a circle where they are.
    pub fn circle_of(&mut self, state: &SceneState, id: &str) -> Option<Circle> {
        if let Some(circle) = self.circles.get(id) {
            return Some(*circle);
        }
        let entity = state.entity(id).filter(|e| self.started && e.alive && e.faction == Faction::Party)?;
        let fresh = Circle { anchor: entity.at, band: RangeBand::Close };
        self.circles.insert(id.into(), fresh);
        Some(fresh)
    }

    /// Every circle drawn so far, by its owner, read without drawing one: for a view, or a replay to hold to.
    pub fn circles(&self) -> Vec<(String, Circle)> {
        let mut drawn: Vec<(String, Circle)> = self.circles.iter().map(|(id, c)| (id.clone(), *c)).collect();
        drawn.sort_by(|a, b| crate::js::utf16_cmp(&a.0, &b.0));
        drawn
    }

    /// Draw a circle again from where its owner stands now.
    pub fn reanchor(&mut self, state: &SceneState, id: &str) {
        if let (Some(entity), Some(circle)) = (state.entity(id), self.circles.get_mut(id)) {
            circle.anchor = entity.at;
        }
    }

    /// The band a push would open: one step out, or `None` when there is none past the circle.
    pub fn push_opens(&mut self, state: &SceneState, id: &str) -> Option<RangeBand> {
        self.circle_of(state, id).and_then(|circle| next_band(circle.band))
    }

    /// Widen a character's circle by one step, on a roll that did: the band it is now.
    pub fn push(&mut self, state: &SceneState, id: &str) -> Option<RangeBand> {
        let band = self.circle_of(state, id).and_then(|circle| next_band(circle.band))?;
        self.circles.get_mut(id).expect("just drawn").band = band;
        self.events.push(EncounterEvent::Pushed { id: id.into(), band });
        Some(band)
    }

    /// Tokens a character has left. Always infinite under the spotlight policy.
    pub fn tokens_for(&self, id: &str) -> f64 {
        if self.policy == TurnPolicy::Tracker {
            self.tokens.get(id).copied().unwrap_or(0.0)
        } else {
            f64::INFINITY
        }
    }

    /// Settle the fight if a side has nobody standing - after damage landed outside a turn.
    pub fn settle_if_decided(&mut self, state: &mut SceneState) -> bool {
        self.check_end(state)
    }

    /// End the encounter early - an objective met, a truce, a script saying so.
    pub fn end(&mut self, state: &mut SceneState, outcome: EncounterOutcome) -> EncounterView {
        if self.finished == EncounterOutcome::Ongoing {
            self.settle(state, outcome);
        }
        self.view(state)
    }

    pub fn view(&self, state: &SceneState) -> EncounterView {
        EncounterView {
            side: self.side,
            ready: self.ready_characters(state),
            waiting: state.entities_of(Faction::Adversary).filter(|e| e.alive && !self.acted(&e.id)).map(|e| e.id.clone()).collect(),
            round: self.round_count,
            outcome: self.finished,
            next_spotlight_cost: self.next_spotlight_cost(),
        }
    }

    fn ready_characters(&self, state: &SceneState) -> Vec<String> {
        state
            .entities_of(Faction::Party)
            .filter(|e| e.alive && (self.policy == TurnPolicy::Spotlight || self.tokens.get(&e.id).copied().unwrap_or(0.0) > 0.0))
            .map(|e| e.id.clone())
            .collect()
    }

    fn refill_tokens(&mut self, state: &SceneState, announce: bool) {
        for member in state.entities_of(Faction::Party).filter(|e| e.alive) {
            self.tokens.insert(member.id.clone(), self.tokens_per_character);
        }
        if announce {
            self.events.push(EncounterEvent::TokensRefilled { round: self.round_count });
        }
    }

    /// Victory when no adversary stands, defeat when no party member does.
    fn check_end(&mut self, state: &mut SceneState) -> bool {
        if self.finished != EncounterOutcome::Ongoing {
            return true;
        }
        let party_standing = state.entities_of(Faction::Party).any(|e| e.alive);
        let foes_standing = state.entities_of(Faction::Adversary).any(|e| e.alive);
        if !party_standing {
            return self.settle(state, EncounterOutcome::Defeat);
        }
        if !foes_standing {
            return self.settle(state, EncounterOutcome::Victory);
        }
        false
    }

    fn settle(&mut self, state: &mut SceneState, outcome: EncounterOutcome) -> bool {
        self.finished = outcome;
        state.encounter(&self.encounter_id).ended = true;
        self.events.push(EncounterEvent::Ended { encounter: self.encounter_id.clone(), outcome });
        true
    }
}
