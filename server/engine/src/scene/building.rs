//! The building layer as a walk meets it (`src/engine/scene/building.ts`): the four atoms every structure
//! is built from, the structures a project declares out of them, and what a piece of one is to somebody
//! standing on it - how high, and whether it closes its tile.
//!
//! The TypeScript keeps the structures in a registry that `paletteForProject` refills as a project's
//! ground is read; here they are a value (`Structures`) handed to whoever needs them, so a grid built
//! for one project never reads another's. How far off a stair is drawn as one box is the renderer's, and
//! stays on the client: only the near boxes are here, which are the ones a walk is read from.

use serde_json::Value;

/// How far construction reaches on every axis.
pub const BUILD_LIMIT: f64 = 1_000_000.0;

/// The four the engine ships, each a single atom, in the order the strip lists them.
pub const DEFAULT_STRUCTURES: [&str; 4] = ["block", "floor", "wall", "stairs"];

/// One box of a piece: `x, y, z` of its centre, then `sx, sy, sz` of its size.
pub type BuildingPart = [f64; 6];

/// The four boxes a staircase is built from, ascending along +Z at rotation 0.
const STAIR_STEPS: [BuildingPart; 4] = [
    [0.0, 0.125, -0.375, 1.0, 0.25, 0.25],
    [0.0, 0.25, -0.125, 1.0, 0.5, 0.25],
    [0.0, 0.375, 0.125, 1.0, 0.75, 0.25],
    [0.0, 0.5, 0.375, 1.0, 1.0, 0.25],
];

/// The boxes an atom is built from, close up; nothing for a name that is not one of the four.
pub fn atom_parts(shape: &str) -> &'static [BuildingPart] {
    match shape {
        "block" => &[[0.0, 0.5, 0.0, 1.0, 1.0, 1.0]],
        "floor" => &[[0.0, 0.125, 0.0, 1.0, 0.25, 1.0]],
        // Rotation moves this wall around all four edges, meeting at the tile corners.
        "wall" => &[[0.0, 0.5, -0.4, 1.0, 1.0, 0.2]],
        "stairs" => &STAIR_STEPS,
        _ => &[],
    }
}

/// One atom placed in a structure: which of the four, and where it sits within the tile.
#[derive(Clone, Debug, PartialEq)]
pub struct StructureAtom {
    pub shape: String,
    /// Offset from the tile's centre, in tiles. Absent means centred.
    pub at: Option<[f64; 3]>,
}

/// Every structure a project can build with, the engine's four first, by id.
#[derive(Clone, Debug, PartialEq)]
pub struct Structures {
    types: Vec<(String, Vec<StructureAtom>)>,
}

impl Default for Structures {
    fn default() -> Self {
        Structures { types: DEFAULT_STRUCTURES.iter().map(|shape| (shape.to_string(), vec![StructureAtom { shape: shape.to_string(), at: None }])).collect() }
    }
}

impl Structures {
    /// The engine's four and a project's own (`setStructures`), as `structureTypes` holds them once read.
    /// One declared under an id already known takes its place, as a `Map` set again keeps its order.
    pub fn declared(types: &[Value]) -> Self {
        let mut structures = Structures::default();
        for kind in types {
            let Some(id) = kind["id"].as_str() else { continue };
            let atoms = kind["atoms"]
                .as_array()
                .map_or(&[][..], Vec::as_slice)
                .iter()
                .map(|atom| StructureAtom {
                    shape: atom["shape"].as_str().unwrap_or_default().to_string(),
                    at: atom["at"].as_array().map(|at| [0, 1, 2].map(|i| at.get(i).and_then(Value::as_f64).unwrap_or(0.0))),
                })
                .collect();
            match structures.types.iter_mut().find(|(known, _)| known == id) {
                Some(entry) => entry.1 = atoms,
                None => structures.types.push((id.to_string(), atoms)),
            }
        }
        structures
    }

    /// Whether anything can be built from this id.
    pub fn has(&self, id: &str) -> bool {
        self.types.iter().any(|(known, _)| known == id)
    }

    /// Every structure's id, the engine's four first.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.types.iter().map(|(id, _)| id.as_str())
    }

    /// The boxes a piece is drawn from (`buildingParts`, close up). An id nothing declares draws nothing.
    pub fn parts(&self, shape: &str) -> Vec<BuildingPart> {
        let Some((_, atoms)) = self.types.iter().find(|(id, _)| id == shape) else { return Vec::new() };
        let mut boxes = Vec::new();
        for atom in atoms {
            let parts = atom_parts(&atom.shape);
            match atom.at {
                None => boxes.extend_from_slice(parts),
                Some([dx, dy, dz]) => boxes.extend(parts.iter().map(|&[x, y, z, sx, sy, sz]| [x + dx, y + dy, z + dz, sx, sy, sz])),
            }
        }
        boxes
    }

    /// What a piece is to somebody walking (`pieceProfile`): how high they stand on it, in blocks above the
    /// level it was placed at, and whether it closes its tile. The parts wide enough to stand on give the
    /// height, averaged by the floor they cover; a rail - a part thinner than a quarter - lifts nobody,
    /// and bars the tile when it reaches a block above where they would stand. `stretch` is the piece's
    /// own `height`.
    pub fn profile(&self, shape: &str, stretch: f64) -> PieceProfile {
        let (mut area, mut sum, mut rail) = (0.0, 0.0, 0.0);
        for [_, y, _, sx, sy, sz] in self.parts(shape) {
            let top = (y + sy / 2.0) * stretch;
            if sx.min(sz) < RAIL {
                rail = crate::js::max(rail, top);
            } else {
                area += sx * sz;
                sum += top * sx * sz;
            }
        }
        let stand = if area == 0.0 { 0.0 } else { sum / area };
        PieceProfile { stand, bars: rail - stand >= 1.0 }
    }
}

/// A part this thin is a rail - a wall along an edge - and nobody stands on one.
const RAIL: f64 = 0.25;

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct PieceProfile {
    pub stand: f64,
    pub bars: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_four_stand_as_they_look() {
        let s = Structures::default();
        assert_eq!(s.profile("block", 1.0), PieceProfile { stand: 1.0, bars: false });
        assert_eq!(s.profile("floor", 1.0), PieceProfile { stand: 0.25, bars: false });
        // The flight averaged by the floor each step covers: a quarter, a half, three quarters and a block.
        assert_eq!(s.profile("stairs", 1.0), PieceProfile { stand: 0.625, bars: false });
        assert_eq!(s.profile("wall", 1.0), PieceProfile { stand: 0.0, bars: true });
        // Half a wall is stepped over.
        assert_eq!(s.profile("wall", 0.5), PieceProfile { stand: 0.0, bars: false });
        assert_eq!(s.profile("nothing", 1.0), PieceProfile { stand: 0.0, bars: false });
    }

    #[test]
    fn a_project_builds_its_own_and_may_redraw_the_four() {
        let s = Structures::declared(&[
            json!({ "id": "doorway", "atoms": [{ "shape": "wall", "at": [0, 1, 0] }, { "shape": "floor" }] }),
            json!({ "id": "block", "atoms": [{ "shape": "floor" }] }),
        ]);
        assert_eq!(s.ids().collect::<Vec<_>>(), ["block", "floor", "wall", "stairs", "doorway"]);
        assert_eq!(s.parts("doorway")[0], [0.0, 1.5, -0.4, 1.0, 1.0, 0.2]);
        assert_eq!(s.profile("block", 1.0).stand, 0.25);
        assert!(s.profile("doorway", 1.0).bars);
    }
}
