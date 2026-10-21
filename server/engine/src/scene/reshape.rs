//! A room growing to reach what was laid outside it (`src/engine/scene/reshape.ts`). Growing east or south
//! only adds cells; growing west or north moves the corner, and every coordinate in the room with it.
//! `origin` on the document is the running total of those moves, which is how a game being played in the
//! room tells how far its own tiles have slid. Pure: a scene goes in, the fields that change come out.

use super::building::BUILD_LIMIT;
use crate::grid::terrain::VOID_TERRAIN_ID;
use crate::grid::tile_grid::NO_TILE;
use serde_json::{json, Map, Value};

/// No room grows past this on a side.
pub const MAX_GROWN: f64 = 128.0;

/// How a room changes shape: how far its contents move, and how big it ends up.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Growth {
    pub dx: f64,
    pub dy: f64,
    pub width: f64,
    pub height: f64,
}

/// A rectangle of cells, both corners included.
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reach {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

fn number(value: &Value, key: &str) -> f64 {
    value[key].as_f64().unwrap_or(f64::NAN)
}

/// What it takes for a room to hold these cells: nothing when it holds them already, or when holding them
/// would take it past `cap`.
pub fn growth_to_reach(width: f64, height: f64, reach: &Reach, cap: f64) -> Option<Growth> {
    let dx = crate::js::max(0.0, -reach.min_x);
    let dy = crate::js::max(0.0, -reach.min_y);
    let grown_width = crate::js::max(width, reach.max_x + 1.0) + dx;
    let grown_height = crate::js::max(height, reach.max_y + 1.0) + dy;
    if grown_width == width && grown_height == height {
        return None;
    }
    if grown_width > crate::js::max(cap, width) || grown_height > crate::js::max(cap, height) {
        return None;
    }
    Some(Growth { dx, dy, width: grown_width, height: grown_height })
}

fn within(n: f64) -> f64 {
    crate::js::max(-BUILD_LIMIT, crate::js::min(BUILD_LIMIT, n))
}

/// A point moved with the room, whatever else it carries kept.
fn moved(point: &Value, dx: f64, dy: f64) -> Value {
    let mut out = point.clone();
    out["x"] = json!(within(number(point, "x") + dx));
    out["y"] = json!(within(number(point, "y") + dy));
    out
}

/// The scene grown (`grownScene`): its cells moved into a bigger rectangle, everything in it moved with
/// them, the new cells filled with `fill` - nothing, unless told otherwise. What comes back is the fields
/// that say where things are, as an object to lay over the scene.
pub fn grown_scene(scene: &Value, growth: &Growth, fill: Option<&str>) -> Value {
    let fill = fill.unwrap_or(VOID_TERRAIN_ID);
    let Growth { dx, dy, width, height } = *growth;
    let (old_width, old_height) = (number(scene, "width") as usize, number(scene, "height") as usize);
    let (w, h, ox, oy) = (width as usize, height as usize, dx as usize, dy as usize);
    let mut terrain = vec![json!(fill); w * h];
    let mut heights = vec![json!(0); w * h];
    let old_tints = scene.get("tints").and_then(Value::as_array);
    let mut tints = old_tints.map(|_| vec![json!(""); w * h]);
    for y in 0..old_height {
        for x in 0..old_width {
            if x + ox >= w || y + oy >= h {
                continue;
            }
            let (from, to) = (y * old_width + x, (y + oy) * w + x + ox);
            terrain[to] = scene["terrain"][from].clone();
            heights[to] = scene["heights"][from].clone();
            if let (Some(tints), Some(old)) = (tints.as_mut(), old_tints) {
                tints[to] = old.get(from).filter(|t| !t.is_null()).cloned().unwrap_or(json!(""));
            }
        }
    }

    let list = |key: &str| scene[key].as_array().map_or(&[][..], Vec::as_slice);
    let with_position = |thing: &Value| {
        let mut out = thing.clone();
        out["position"] = moved(&thing["position"], dx, dy);
        out
    };
    let encounters: Vec<Value> = list("encounters")
        .iter()
        .map(|encounter| {
            let mut out = encounter.clone();
            out["adversaries"] = Value::Array(encounter["adversaries"].as_array().map_or(&[][..], Vec::as_slice).iter().map(with_position).collect());
            out["triggerCells"] = Value::Array(encounter["triggerCells"].as_array().map_or(&[][..], Vec::as_slice).iter().map(|c| moved(c, dx, dy)).collect());
            out
        })
        .collect();
    let origin = (scene["origin"]["x"].as_f64().unwrap_or(0.0) + dx, scene["origin"]["y"].as_f64().unwrap_or(0.0) + dy);

    let mut out = Map::new();
    out.insert("width".into(), json!(width));
    out.insert("height".into(), json!(height));
    out.insert("terrain".into(), Value::Array(terrain));
    out.insert("heights".into(), Value::Array(heights));
    if let Some(tints) = tints {
        out.insert("tints".into(), Value::Array(tints));
    }
    out.insert("spawns".into(), Value::Array(list("spawns").iter().map(|s| moved(s, dx, dy)).collect()));
    out.insert("decos".into(), Value::Array(list("decos").iter().map(with_position).collect()));
    out.insert("interactables".into(), Value::Array(list("interactables").iter().map(with_position).collect()));
    out.insert("encounters".into(), Value::Array(encounters));
    if let Some(pieces) = scene.get("buildingTiles").and_then(Value::as_object) {
        out.insert("buildingTiles".into(), Value::Object(moved_pieces(pieces, dx, dy)));
    }
    if origin != (0.0, 0.0) {
        out.insert("origin".into(), json!({ "x": origin.0, "y": origin.1 }));
    }
    Value::Object(out)
}

/// Every piece moved, under the key its new cell gives it, the `#n` of an overlap kept.
fn moved_pieces(pieces: &Map<String, Value>, dx: f64, dy: f64) -> Map<String, Value> {
    let mut out = Map::new();
    for (key, piece) in pieces {
        let next = moved(piece, dx, dy);
        let cell = super::document::building_key(next.as_object().expect("a piece"));
        let mut to = match key.find('#') {
            None => cell.clone(),
            Some(hash) => format!("{cell}{}", &key[hash..]),
        };
        // Only a document whose keys had already drifted from its pieces can collide; it still loses nothing.
        let mut n = 1;
        while out.contains_key(&to) {
            to = format!("{cell}#{n}");
            n += 1;
        }
        out.insert(to, next);
    }
    out
}

/// Where everybody was, in the room as it is now (`shiftSnapshot`): each tile and spot counted again from
/// the corner that moved. `dx, dy` may be negative - a growth undone - and whoever that leaves outside the
/// room is stood on `fallback`, their spot forgotten.
pub fn shift_snapshot(snapshot: &Value, old_width: i32, dx: i32, dy: i32, width: i32, height: i32, fallback: i32) -> Value {
    let mut entities = Map::new();
    for (id, entity) in snapshot["entities"].as_object().into_iter().flatten() {
        let tile = entity["tile"].as_f64().unwrap_or(f64::NAN);
        if tile == f64::from(NO_TILE) {
            entities.insert(id.clone(), entity.clone());
            continue;
        }
        let tile = tile as i32;
        let x = tile % old_width + dx;
        let y = tile.div_euclid(old_width) + dy;
        let mut out = entity.clone();
        if x < 0 || y < 0 || x >= width || y >= height {
            out.as_object_mut().expect("an entity").shift_remove("at");
            out["tile"] = json!(fallback);
        } else {
            out["tile"] = json!(y * width + x);
            if let Some(at) = entity.get("at").filter(|at| !at.is_null()) {
                out["at"] = json!({ "x": number(at, "x") + f64::from(dx), "y": number(at, "y") + f64::from(dy) });
            }
        }
        entities.insert(id.clone(), out);
    }
    let mut out = snapshot.clone();
    out["entities"] = Value::Object(entities);
    out
}
