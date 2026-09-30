//! The demo's house rules (`src/game/demo-rules.ts`): the range bands, the movement and the body every room
//! in a project is walked with. Numbers only; the cast and the sheets it ships are content, handed in.

use crate::grid::pathfinding::{MovementRules, DEFAULT_MOVEMENT};
use crate::grid::walk::{WalkRules, DEFAULT_WALK};
use crate::rules::jump::JumpRules;
use crate::rules::range::BandTiles;
use serde_json::Value;

/// Tight bands, so a 22x16 map spans more than one of them.
pub const DEMO_BAND_TILES: BandTiles = BandTiles { melee: 1.0, very_close: 2.0, close: 4.0, far: 8.0, very_far: 12.0 };

/// The Agility Roll a fighter makes to get farther than one move in a fight: the demo's number.
pub const DEMO_MOVE_DIFFICULTY: f64 = 12.0;

/// Every creature steps diagonally, at the price of a diagonal, and cuts no corner it could not squeeze past.
pub const DEMO_MOVEMENT: MovementRules = MovementRules { diagonals: true, diagonal_cost_multiplier: std::f64::consts::SQRT_2, ..DEFAULT_MOVEMENT };

/// The body a creature in the demo walks with.
pub const DEMO_WALK: WalkRules = WalkRules { max_step_height: DEMO_MOVEMENT.max_step_height, ..DEFAULT_WALK };

/// The jump rules a project plays by (`jumpRulesFor`): its own, or the engine's where it has said nothing.
pub fn jump_rules_for(project: &Value) -> JumpRules {
    match project.get("jump").filter(|j| j.is_object()) {
        Some(jump) => JumpRules::from_json(jump),
        None => JumpRules::default(),
    }
}

/// How high a step a project's rooms allow: its jump rules', or the engine's where it has said nothing.
fn step_height(project: &Value) -> f64 {
    project.get("jump").filter(|j| j.is_object()).and_then(|j| j["stepHeight"].as_f64()).unwrap_or(JumpRules::default().step_height)
}

/// How everybody in a project's rooms steps (`movementFor`): the demo's way, as high as the project says.
pub fn movement_for(project: &Value) -> MovementRules {
    MovementRules { max_step_height: step_height(project), ..DEMO_MOVEMENT }
}

/// The body they walk with, stepping as high (`walkFor`).
pub fn walk_for(project: &Value) -> WalkRules {
    WalkRules { max_step_height: step_height(project), ..DEMO_WALK }
}
