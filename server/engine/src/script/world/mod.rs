//! The bridge from a running scene to a script (`src/engine/script/world.ts`): `SceneScriptWorld` is what
//! the runner and the conditions ask - `ScriptWorld` and `ConditionContext` - over a live `SceneState` and
//! the `ScenarioState` that outlives it, and what the fight asks beyond them: the modifiers, defences and
//! reactions a creature holds, the swing a stat block prints, damage taken through the thresholds and
//! the armour, the ground a zone holds and who is standing on it, the clocks a fight is counting, and the
//! walks, pushes and blinks a script moves a creature by.
//!
//! The content it reads - sheets derived, stat blocks, abilities, cards, conditions, loot tables - is
//! borrowed for the world's life (`WorldContent`): the TypeScript asks for the cards and the hooks afresh
//! each time so an editor's change is seen at once, and here a changed project is a new world. Hooks are
//! asked through `Hooks` (`script::hooks`), the world lending each a `HookReader` over itself.
//!
//! Split as the TypeScript's sections are: `scenario` (what outlives a scene), `reads`, `zones`,
//! `modifiers` (what a creature holds and what it adds), `targets` (who a selector names), `writes`,
//! `fight` (damage, defence, attacks, summons) and `moves`; `context` is the two traits.

mod context;
mod fight;
mod modifiers;
mod moves;
mod reads;
pub mod scenario;
mod targets;
mod writes;
mod zones;

pub use fight::AttackAsked;
pub use modifiers::Swing;
pub use reads::{ArmorAidOn, Instead, Mark};
pub use scenario::*;
pub use zones::Footprint;
pub use crate::script::hooks::{HookReader, Hooks, NoHooks};

use crate::character::sheet::DerivedCharacter;
use crate::combat::defense::{ArmorPolicy, DefensePolicy};
use crate::content::abilities::AbilityDef;
use crate::content::adversaries::AdversaryDef;
use crate::content::conditions::ConditionDef;
use crate::content::items::LootTable;
use crate::content::pack::CardDef;
use crate::grid::pathfinding::MovementRules;
use crate::rules::damage::DamageThresholds;
use crate::rules::dice::DamageType;
use crate::rules::jump::Trait;
use crate::rules::range::{BandTiles, DEFAULT_BAND_TILES};
use crate::scene::state::SceneState;
use serde::Serialize;
use std::collections::HashMap;
use std::rc::Rc;

/// Everything the world reads and never writes: the content a fight is played with, and the table's rules.
pub struct WorldContent {
    /// Trait modifiers for a check rolled as the party: the party's best hand at each trait.
    pub traits: HashMap<Trait, f64>,
    /// The party's derived sheets, by character id.
    pub characters: HashMap<String, DerivedCharacter>,
    /// Stat blocks by content id.
    pub adversaries: HashMap<String, AdversaryDef>,
    /// How many tiles each range band spans on this map; the engine's table when left out.
    pub band_tiles: Option<BandTiles>,
    /// The rules a script walks a creature by; the engine's four-way default when left out.
    pub movement: Option<MovementRules>,
    /// Whether Armor Slots are marked and reactions fire without being asked.
    pub defense: DefensePolicy,
    /// Every ability the project knows, in its order.
    pub abilities: Vec<AbilityDef>,
    /// Every card, in the project's order: `None` for a world handed none, where a character holds what
    /// its sheet was derived with and no creature has a feature.
    pub cards: Option<Vec<CardDef>>,
    /// What each named condition does, by id - a later definition of the same id replacing an earlier.
    pub condition_defs: HashMap<String, ConditionDef>,
    pub loot_tables: HashMap<String, LootTable>,
}

impl Default for WorldContent {
    fn default() -> Self {
        WorldContent {
            traits: HashMap::new(),
            characters: HashMap::new(),
            adversaries: HashMap::new(),
            band_tiles: None,
            movement: None,
            defense: DefensePolicy { armor: ArmorPolicy::Auto, reactions: true },
            abilities: Vec::new(),
            cards: None,
            condition_defs: HashMap::new(),
            loot_tables: HashMap::new(),
        }
    }
}

impl WorldContent {
    /// Condition definitions by id, a later one winning, as `new Map(defs.map(...))` keeps them.
    pub fn index_conditions(defs: Vec<ConditionDef>) -> HashMap<String, ConditionDef> {
        defs.into_iter().map(|def| (def.id.clone(), def)).collect()
    }

    fn table(&self) -> &BandTiles {
        self.band_tiles.as_ref().unwrap_or(&DEFAULT_BAND_TILES)
    }
}

/// A blow that landed, waiting for the features that answer it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DamageNote {
    /// Who took it.
    pub id: String,
    /// Who dealt it, when a creature did.
    pub attacker: Option<String>,
    /// Hit Points it actually marked, after armor and reactions.
    #[serde(rename = "hitPoints")]
    pub hit_points: f64,
    /// The damage rolled, before armor took anything off it.
    pub damage: f64,
    /// What kind it was, so damage sent back is the same kind.
    pub types: Vec<DamageType>,
    /// Whether any part of it was Severe.
    pub severe: bool,
}

/// What `noteDamage` is told: every part optional.
#[derive(Clone, Debug, Default)]
pub struct Blow {
    pub attacker: Option<String>,
    pub hit_points: Option<f64>,
    pub damage: Option<f64>,
    pub types: Option<Vec<DamageType>>,
    pub severe: Option<bool>,
}

/// Somebody who has just come to stand in a zone whose condition bites.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ZoneEntry {
    pub id: String,
    pub condition: String,
    /// Whose spell the ground is, or nobody's.
    pub owner: Option<String>,
}

/// What a condition on the one who was swung at owes the one who swung.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PayoutOwed {
    pub condition: String,
    pub effects: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keeps: Option<bool>,
}

/// Thresholds for a creature nothing describes: the demo's stand-in numbers.
pub const FALLBACK_DIFFICULTY: f64 = 11.0;
pub const FALLBACK_THRESHOLDS: DamageThresholds = DamageThresholds { major: 6.0, severe: 12.0 };

/// A `ScriptWorld` backed by a live scene.
pub struct SceneScriptWorld<'w> {
    pub state: SceneState,
    pub scenario: ScenarioState,
    content: &'w WorldContent,
    /// Whether a creature has already had the spotlight this GM turn: whoever runs the turn says; a world
    /// with nobody keeping turns says no, and everyone joins a swarm.
    pub spotlight_spent: Box<dyn Fn(&str) -> bool + 'w>,
    /// Whether a fight is running, when something other than the scene's encounters says so.
    in_combat: Option<Box<dyn Fn(&SceneState) -> bool + 'w>>,
    /// Shared rather than owned, so the world can lend itself to a hook while the hooks are asked.
    hooks: Rc<dyn Hooks + 'w>,
    /// Blows that landed since anyone last looked.
    damaged: Vec<DamageNote>,
    /// Crossings into ground that bites, waiting for somebody with a runner.
    entered: Vec<ZoneEntry>,
}

impl<'w> SceneScriptWorld<'w> {
    pub fn new(state: SceneState, scenario: ScenarioState, content: &'w WorldContent, hooks: Rc<dyn Hooks + 'w>) -> Self {
        SceneScriptWorld { state, scenario, content, spotlight_spent: Box::new(|_| false), in_combat: None, hooks, damaged: Vec::new(), entered: Vec::new() }
    }

    /// Read whether a fight is running from something other than the scene's encounters.
    pub fn with_in_combat(mut self, fighting: Box<dyn Fn(&SceneState) -> bool + 'w>) -> Self {
        self.in_combat = Some(fighting);
        self
    }

    pub fn content(&self) -> &'w WorldContent {
        self.content
    }
}
