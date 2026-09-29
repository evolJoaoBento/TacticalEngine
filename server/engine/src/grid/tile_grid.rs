//! The tile grid (`src/engine/grid/grid.ts`): elevation and terrain per tile, addressed by one integer
//! index (`y * width + x`) as the whole engine addresses them - `NO_TILE` (-1) is no tile at all.
//!
//! What a walk meets on a tile is the topmost piece stacked there, or the ground (`top_at`); how high a
//! creature stands is the top of that stack or the ground's slabs (`stand_at`), each slab `SLAB_BLOCKS`
//! of a block. The pieces themselves - how they are drawn - are the renderer's, and stay on the client.

use super::terrain::{TerrainPalette, TerrainType};
use crate::js;

/// Not a tile: what a lookup off the grid answers.
pub const NO_TILE: i32 = -1;
/// Nothing stacked on a tile: the ground is what a walk meets there.
pub const NOTHING_STACKED: i16 = -1;
/// How much of a block one level of ground elevation is.
pub const SLAB_BLOCKS: f64 = 0.35;

/// A place on the board in tile units, continuous: (0, 0) is the centre of the first tile.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Spot {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub struct TileGrid {
    pub width: i32,
    pub height: i32,
    pub palette: TerrainPalette,
    /// Elevation level per tile, in slabs (an `Int16Array` there).
    pub heights: Vec<i16>,
    /// Palette index of the ground per tile (a `Uint8Array`).
    pub terrain: Vec<u8>,
    /// Palette index of the topmost piece stacked per tile, or `NOTHING_STACKED`.
    pub overlay: Vec<i16>,
    /// How high the pieces on each tile stand, in blocks (a `Float32Array`: the precision is part of it).
    pub lift: Vec<f32>,
    /// Tiles closed by a wall along an edge, too thin to stand on and too tall to step over.
    pub barred: Vec<u8>,
}

impl TileGrid {
    pub fn new(width: i32, height: i32, palette: TerrainPalette) -> Self {
        assert!(width > 0 && height > 0, "grid needs positive integer dimensions, got {width}x{height}");
        let count = (width * height) as usize;
        TileGrid { width, height, palette, heights: vec![0; count], terrain: vec![0; count], overlay: vec![NOTHING_STACKED; count], lift: vec![0.0; count], barred: vec![0; count] }
    }

    pub fn size(&self) -> i32 {
        self.width * self.height
    }

    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.width && y < self.height
    }

    /// The tile at a coordinate, or `NO_TILE`.
    pub fn index_of(&self, x: i32, y: i32) -> i32 {
        if self.in_bounds(x, y) {
            y * self.width + x
        } else {
            NO_TILE
        }
    }

    /// The tile a spot lies in: the nearest centre, rounded as JavaScript rounds (a half upwards).
    pub fn tile_at_spot(&self, x: f64, y: f64) -> i32 {
        let (rx, ry) = (js::round(x), js::round(y));
        if rx >= 0.0 && ry >= 0.0 && rx < f64::from(self.width) && ry < f64::from(self.height) {
            ry as i32 * self.width + rx as i32
        } else {
            NO_TILE
        }
    }

    /// The centre of a tile as a spot; (-1, -1) for a non-tile.
    pub fn spot_of(&self, index: i32) -> Spot {
        if self.is_tile(index) {
            Spot { x: f64::from(self.x_of(index)), y: f64::from(self.y_of(index)) }
        } else {
            Spot { x: -1.0, y: -1.0 }
        }
    }

    pub fn x_of(&self, index: i32) -> i32 {
        index % self.width
    }

    pub fn y_of(&self, index: i32) -> i32 {
        index / self.width
    }

    pub fn is_tile(&self, index: i32) -> bool {
        index >= 0 && index < self.size()
    }

    fn at<T: Copy>(values: &[T], index: i32) -> Option<T> {
        usize::try_from(index).ok().and_then(|i| values.get(i).copied())
    }

    pub fn height_at(&self, index: i32) -> i16 {
        Self::at(&self.heights, index).unwrap_or(0)
    }

    /// How high a creature on this tile stands, in blocks: the top of the stack, or the ground if higher.
    pub fn stand_at(&self, index: i32) -> f64 {
        js::max(f64::from(Self::at(&self.heights, index).unwrap_or(0)) * SLAB_BLOCKS, f64::from(Self::at(&self.lift, index).unwrap_or(0.0)))
    }

    /// The ground at a tile, whatever is stacked on it.
    pub fn terrain_at(&self, index: i32) -> &TerrainType {
        self.palette.at(i32::from(Self::at(&self.terrain, index).unwrap_or(0)))
    }

    /// What a creature standing on a tile meets: the topmost piece stacked there, or the ground.
    pub fn top_at(&self, index: i32) -> &TerrainType {
        match Self::at(&self.overlay, index).unwrap_or(NOTHING_STACKED) {
            NOTHING_STACKED => self.terrain_at(index),
            stacked => self.palette.at(i32::from(stacked)),
        }
    }

    fn is_barred(&self, index: i32) -> bool {
        Self::at(&self.barred, index) == Some(1)
    }

    /// Movement to enter a tile; `INFINITY` where it cannot be entered.
    pub fn cost_at(&self, index: i32) -> f64 {
        let kind = self.top_at(index);
        if kind.passable && !self.is_barred(index) {
            kind.cost
        } else {
            f64::INFINITY
        }
    }

    pub fn is_passable(&self, index: i32) -> bool {
        self.is_tile(index) && !self.is_barred(index) && self.top_at(index).passable
    }

    pub fn blocks_sight(&self, index: i32) -> bool {
        !self.is_tile(index) || self.is_barred(index) || self.top_at(index).blocks_sight
    }

    pub fn provides_cover(&self, index: i32) -> bool {
        self.is_tile(index) && self.top_at(index).provides_cover
    }

    pub fn set_overlay(&mut self, index: i32, terrain_index: i16) {
        if self.is_tile(index) {
            self.overlay[index as usize] = terrain_index;
        }
    }

    pub fn set_terrain(&mut self, index: i32, terrain_index: u8) {
        if self.is_tile(index) {
            self.terrain[index as usize] = terrain_index;
        }
    }

    pub fn set_height(&mut self, index: i32, level: i16) {
        if self.is_tile(index) {
            self.heights[index as usize] = level;
        }
    }

    /// Manhattan distance in tiles: 4-neighbour.
    pub fn manhattan_distance(&self, a: i32, b: i32) -> i32 {
        (self.x_of(a) - self.x_of(b)).abs() + (self.y_of(a) - self.y_of(b)).abs()
    }

    /// Chebyshev distance in tiles: 8-neighbour.
    pub fn chebyshev_distance(&self, a: i32, b: i32) -> i32 {
        (self.x_of(a) - self.x_of(b)).abs().max((self.y_of(a) - self.y_of(b)).abs())
    }

    /// Straight-line distance in tiles, as `Math.hypot` gives it.
    pub fn euclidean_distance(&self, a: i32, b: i32) -> f64 {
        js::hypot(f64::from(self.x_of(a) - self.x_of(b)), f64::from(self.y_of(a) - self.y_of(b)))
    }

    /// The neighbours of a tile, in the fixed order ties are broken by: west, east, north, south, then -
    /// with diagonals - north-west, north-east, south-west, south-east.
    pub fn for_each_neighbor(&self, index: i32, diagonals: bool, mut visit: impl FnMut(i32)) {
        if !self.is_tile(index) {
            return;
        }
        let (x, y, w) = (self.x_of(index), self.y_of(index), self.width);
        let (west, east, north, south) = (x > 0, x < self.width - 1, y > 0, y < self.height - 1);
        if west {
            visit(index - 1);
        }
        if east {
            visit(index + 1);
        }
        if north {
            visit(index - w);
        }
        if south {
            visit(index + w);
        }
        if !diagonals {
            return;
        }
        if north && west {
            visit(index - w - 1);
        }
        if north && east {
            visit(index - w + 1);
        }
        if south && west {
            visit(index + w - 1);
        }
        if south && east {
            visit(index + w + 1);
        }
    }

    /// Whether two tiles touch diagonally rather than orthogonally.
    pub fn is_diagonal_step(&self, from: i32, to: i32) -> bool {
        self.x_of(from) != self.x_of(to) && self.y_of(from) != self.y_of(to)
    }
}
