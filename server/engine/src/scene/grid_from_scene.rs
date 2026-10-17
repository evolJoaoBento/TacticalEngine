//! A tile grid built from a scene document (`src/engine/scene/grid-from-scene.ts`): the ground by palette
//! index, the building layer stacked on it, and the props that stand in the way barred. A terrain id the
//! palette does not know is reported, once per id, and the tile left as the palette's first kind - a
//! typo is shown, not guessed at.
//!
//! Reading a grid back into a document is the editor's, and stays on the client.

use super::building::Structures;
use super::deco_span::deco_footprint;
use crate::content::document::ContentIssue;
use crate::grid::terrain::{PaletteError, TerrainPalette, TerrainType};
use crate::grid::tile_grid::{Origin, TileGrid, NO_TILE};
use crate::js;
use serde_json::{json, Value};
use std::collections::HashMap;

/// The palette a project declares, or the engine's own, and the structures it builds with: one question
/// since a kind of tile can be a structure (`paletteForProject`, which sets the TypeScript's registry).
pub fn palette_for_project(project: &Value) -> Result<(TerrainPalette, Structures), PaletteError> {
    let structures = Structures::declared(project.get("structureTypes").and_then(Value::as_array).map_or(&[][..], Vec::as_slice));
    let Some(declared) = project.get("terrainPalette").and_then(Value::as_array) else {
        return Ok((TerrainPalette::default_palette(), structures));
    };
    let types = declared
        .iter()
        .map(|kind| {
            let id = kind["id"].as_str().unwrap_or_default();
            let name = kind["name"].as_str().filter(|name| !name.is_empty()).unwrap_or(id);
            TerrainType {
                name: name.into(),
                passable: kind["passable"].as_bool().unwrap_or(true),
                cost: kind["cost"].as_f64().unwrap_or(1.0),
                provides_cover: kind["providesCover"].as_bool().unwrap_or(false),
                blocks_sight: kind["blocksSight"].as_bool().unwrap_or(false),
                structure: kind["structure"].as_str().map(str::to_string),
                ..TerrainType::new(id)
            }
        })
        .collect();
    Ok((TerrainPalette::new(types)?, structures))
}

fn number(value: &Value, key: &str) -> f64 {
    value[key].as_f64().unwrap_or(f64::NAN)
}

/// Build a grid from a scene, every unknown terrain id collected rather than the first one refused.
/// `source` names the document in each issue; the scene's own id when there is nothing better.
pub fn grid_from_scene(scene: &Value, palette: TerrainPalette, structures: &Structures, source: Option<&str>) -> (TileGrid, Vec<ContentIssue>) {
    let id = scene["id"].as_str().unwrap_or_default();
    let mut grid = TileGrid::new(number(scene, "width") as i32, number(scene, "height") as i32, palette);
    if let Some(origin) = scene.get("origin").filter(|o| o.is_object()) {
        grid.origin = Origin { x: number(origin, "x") as i32, y: number(origin, "y") as i32 };
    }

    let heights = scene["heights"].as_array().map_or(&[][..], Vec::as_slice);
    let terrain = scene["terrain"].as_array().map_or(&[][..], Vec::as_slice);
    // First seen first, as a `Map` keeps them.
    let mut unknown: Vec<(String, usize)> = Vec::new();
    for tile in 0..grid.size() as usize {
        grid.heights[tile] = js::to_int16(heights.get(tile).and_then(Value::as_f64).unwrap_or(f64::NAN));
        let kind = terrain.get(tile).and_then(Value::as_str).unwrap_or_default();
        match grid.palette.index_of(kind) {
            // An unresolved tile keeps the palette's first kind; its height still applies.
            -1 => match unknown.iter_mut().find(|(known, _)| known == kind) {
                Some(entry) => entry.1 += 1,
                None => unknown.push((kind.to_string(), 1)),
            },
            index => grid.terrain[tile] = index as u8,
        }
    }

    stack_pieces(scene, &mut grid, structures);
    bar_solid_props(scene, &mut grid);

    // One issue per unknown id, not per tile: a whole wall of typos is one problem.
    let issues = unknown
        .into_iter()
        .map(|(kind, count)| ContentIssue {
            source: source.unwrap_or(id).to_string(),
            entry: id.to_string(),
            field: "terrain".into(),
            message: format!("unknown terrain id {} on {count} tile{}", json!(kind), if count == 1 { "" } else { "s" }),
        })
        .collect();
    (grid, issues)
}

/// Bar the ground under a prop an author has said is solid - its whole block - and nothing else: a prop
/// is scenery unless it says so, and a prop with a function stands in the way as the thing it plays.
fn bar_solid_props(scene: &Value, grid: &mut TileGrid) {
    for deco in scene["decos"].as_array().map_or(&[][..], Vec::as_slice) {
        if deco.get("solid") != Some(&Value::Bool(true)) || deco.get("function").is_some() {
            continue;
        }
        for (x, y) in deco_footprint(deco) {
            let tile = grid.index_at(x, y);
            if tile != NO_TILE {
                grid.barred[tile as usize] = 1;
            }
        }
    }
}

/// The building layer resolved onto the grid: what a walk meets on each cell. The topmost piece counts,
/// a tie going to the one listed later. A piece naming no kind of tile is scenery, one naming a kind the
/// palette lacks is left to Check, and one outside the room is drawn and never stepped on.
fn stack_pieces(scene: &Value, grid: &mut TileGrid, structures: &Structures) {
    let Some(pieces) = scene.get("buildingTiles").and_then(Value::as_object) else { return };
    // The height of whatever is winning each cell, so a lower piece stamped later does not displace it.
    let mut best_level: HashMap<i32, f64> = HashMap::new();
    for piece in pieces.values() {
        let Some(kind) = piece.get("tile").and_then(Value::as_str) else { continue };
        let index = grid.palette.index_of(kind);
        if index < 0 {
            continue;
        }
        let tile = grid.index_at(number(piece, "x"), number(piece, "y"));
        if tile == NO_TILE {
            continue;
        }
        let level = number(piece, "level");
        // The tallest thing in the cell is what a creature is on, and a rail anywhere in the stack closes it.
        let profile = structures.profile(piece["shape"].as_str().unwrap_or_default(), piece.get("height").and_then(Value::as_f64).unwrap_or(1.0));
        let at = tile as usize;
        grid.lift[at] = js::max(f64::from(grid.lift[at]), level + profile.stand) as f32;
        if profile.bars {
            grid.barred[at] = 1;
        }
        if best_level.get(&tile).is_some_and(|&standing| level < standing) {
            continue;
        }
        best_level.insert(tile, level);
        grid.set_overlay(tile, index as i16);
    }
}

/// A scene of open floor at height 0, one spawn in the corner: where a new map starts (`blankScene`).
pub fn blank_scene(id: &str, width: usize, height: usize, terrain: &str) -> Value {
    let count = width * height;
    json!({
        "id": id, "name": "", "intro": "", "width": width, "height": height,
        "terrain": vec![terrain; count], "heights": vec![0; count],
        "spawns": [{ "x": 0, "y": 0 }], "interactables": [], "encounters": [], "decos": [],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_typo_is_one_issue_however_many_tiles_it_is_on() {
        let mut scene = blank_scene("room", 3, 2, "floor");
        scene["terrain"] = json!(["floor", "flor", "flor", "wall", "lava", "floor"]);
        scene["heights"] = json!([0, 40000, 0, 0, 0, -1]);
        let (grid, issues) = grid_from_scene(&scene, TerrainPalette::default_palette(), &Structures::default(), None);
        let said: Vec<&str> = issues.iter().map(|i| i.message.as_str()).collect();
        assert_eq!(said, ["unknown terrain id \"flor\" on 2 tiles", "unknown terrain id \"lava\" on 1 tile"]);
        assert_eq!(grid.terrain, [0, 0, 0, 3, 0, 0]);
        assert_eq!(grid.heights, [0, -25536, 0, 0, 0, -1]);
    }

    #[test]
    fn the_topmost_piece_is_walked_on_and_a_wall_closes_its_tile() {
        let mut scene = blank_scene("room", 3, 1, "floor");
        scene["buildingTiles"] = json!({
            "0,0,1": { "x": 0, "y": 0, "level": 1, "shape": "block", "material": "stone", "rotation": 0, "tile": "block" },
            "0,0,0": { "x": 0, "y": 0, "level": 0, "shape": "floor", "material": "stone", "rotation": 0, "tile": "platform" },
            "1,0,0": { "x": 1, "y": 0, "level": 0, "shape": "wall", "material": "stone", "rotation": 0, "tile": "barrier" },
            "2,0,0": { "x": 2, "y": 0, "level": 0, "shape": "wall", "material": "stone", "rotation": 0 },
        });
        let palette = TerrainPalette::default_palette();
        let (block, platform) = (palette.index_of("block") as i16, palette.index_of("platform"));
        let (grid, _) = grid_from_scene(&scene, palette, &Structures::default(), None);
        assert_eq!(grid.overlay[0], block);
        assert!(platform >= 0);
        assert_eq!(grid.lift, [2.0, 0.0, 0.0]);
        assert_eq!(grid.barred, [0, 1, 0]);
    }
}
