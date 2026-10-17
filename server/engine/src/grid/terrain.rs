//! Terrain types and the palette a grid indexes into (`src/engine/grid/terrain.ts`).
//!
//! A project declares its own kinds of tile; the engine reads `passable`, `cost`, `provides_cover` and
//! `blocks_sight` off them rather than deducing anything. A grid stores one byte per tile, so a palette
//! holds at most 256 kinds. The drawing fields the TypeScript carries - a colour, a model, a scale -
//! are the renderer's, and stay on the client.

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct TerrainType {
    /// Stable id used by content and save files. Never rely on palette order.
    pub id: String,
    pub name: String,
    /// Whether a creature can stand here at all.
    pub passable: bool,
    /// Movement to enter this tile; ignored when impassable (and `INFINITY` there).
    pub cost: f64,
    /// Whether a creature standing here has cover. SRD 2.0 made cover binary.
    pub provides_cover: bool,
    /// Whether the tile blocks line of sight through it.
    pub blocks_sight: bool,
    /// The structure a tile of this kind is, when it is stacked rather than ground.
    pub structure: Option<String>,
}

impl TerrainType {
    /// A kind of tile with the TypeScript's defaults (`terrain()`): passable, cost 1, no cover, no sight blocked.
    pub fn new(id: &str) -> Self {
        TerrainType { id: id.into(), name: id.into(), passable: true, cost: 1.0, provides_cover: false, blocks_sight: false, structure: None }
    }
}

pub const MAX_TERRAIN_TYPES: usize = 256;

/// Nothing at all: the cells a room takes in when it grows round tiles laid outside it.
pub const VOID_TERRAIN_ID: &str = "void";

pub fn void_terrain() -> TerrainType {
    TerrainType { name: "Nothing".into(), passable: false, cost: f64::INFINITY, ..TerrainType::new(VOID_TERRAIN_ID) }
}

/// The terrain the engine ships (`DEFAULT_TERRAIN_TYPES`), floor first so a zeroed grid is open floor.
pub fn default_terrain_types() -> Vec<TerrainType> {
    let kind = |id: &str, name: &str| TerrainType { name: name.into(), ..TerrainType::new(id) };
    vec![
        kind("floor", "Floor"),
        TerrainType { cost: 2.0, ..kind("difficult", "Difficult Terrain") },
        TerrainType { provides_cover: true, ..kind("cover", "Cover") },
        TerrainType { passable: false, cost: f64::INFINITY, blocks_sight: true, ..kind("wall", "Wall") },
        TerrainType { structure: Some("floor".into()), ..kind("platform", "Grass Ground") },
        TerrainType { structure: Some("stairs".into()), ..kind("steps", "Stone Stairs") },
        TerrainType { structure: Some("block".into()), ..kind("block", "Stone Block") },
        TerrainType { structure: Some("wall".into()), provides_cover: true, ..kind("barrier", "Stone Wall") },
    ]
}

#[derive(Clone, Debug)]
pub struct PaletteError(pub String);

/// An ordered set of kinds of tile: the index is what a grid stores, the id what content uses.
#[derive(Clone, Debug)]
pub struct TerrainPalette {
    pub types: Vec<TerrainType>,
    index_by_id: HashMap<String, usize>,
}

impl TerrainPalette {
    /// A palette of these kinds, `void` appended when there is room and it is not already one of them.
    pub fn new(mut types: Vec<TerrainType>) -> Result<Self, PaletteError> {
        if types.is_empty() {
            return Err(PaletteError("a terrain palette needs at least one type".into()));
        }
        if types.len() > MAX_TERRAIN_TYPES {
            return Err(PaletteError(format!("a terrain palette holds at most {MAX_TERRAIN_TYPES} types")));
        }
        if types.len() < MAX_TERRAIN_TYPES && !types.iter().any(|kind| kind.id == VOID_TERRAIN_ID) {
            types.push(void_terrain());
        }
        let mut index_by_id = HashMap::new();
        for (i, kind) in types.iter().enumerate() {
            if index_by_id.insert(kind.id.clone(), i).is_some() {
                return Err(PaletteError(format!("duplicate terrain id \"{}\"", kind.id)));
            }
        }
        Ok(TerrainPalette { types, index_by_id })
    }

    pub fn default_palette() -> Self {
        TerrainPalette::new(default_terrain_types()).expect("the default palette")
    }

    pub fn size(&self) -> usize {
        self.types.len()
    }

    /// The index of an id, or -1 when the palette has no such kind.
    pub fn index_of(&self, id: &str) -> i32 {
        self.index_by_id.get(id).map_or(-1, |&i| i as i32)
    }

    pub fn require(&self, id: &str) -> Result<usize, PaletteError> {
        self.index_by_id.get(id).copied().ok_or_else(|| PaletteError(format!("unknown terrain id \"{id}\"")))
    }

    /// The kind at an index; out of range, the first.
    pub fn at(&self, index: i32) -> &TerrainType {
        usize::try_from(index).ok().and_then(|i| self.types.get(i)).unwrap_or(&self.types[0])
    }

    pub fn has(&self, id: &str) -> bool {
        self.index_by_id.contains_key(id)
    }
}
