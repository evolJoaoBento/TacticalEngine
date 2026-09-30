//! The scene (`src/engine/scene`): so far, the play state combat reads and writes (`state`). The scene
//! document, its migration and the rest of its state come with the scene's own port.

pub mod document;
pub mod migrate;
pub mod state;
