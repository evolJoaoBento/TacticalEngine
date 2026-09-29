//! Range bands (`src/engine/rules/range.ts`), SRD "MAPS, RANGE, AND MOVEMENT": Melee to Very Far, and
//! out of range beyond. A distance is "as the crow flies", and a band reaches half a tile past its number.

use crate::js;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum RangeBand {
    Melee,
    VeryClose,
    Close,
    Far,
    VeryFar,
    OutOfRange,
}

pub const RANGE_BANDS: [RangeBand; 6] = [RangeBand::Melee, RangeBand::VeryClose, RangeBand::Close, RangeBand::Far, RangeBand::VeryFar, RangeBand::OutOfRange];

impl RangeBand {
    pub fn name(self) -> &'static str {
        match self {
            RangeBand::Melee => "melee",
            RangeBand::VeryClose => "veryClose",
            RangeBand::Close => "close",
            RangeBand::Far => "far",
            RangeBand::VeryFar => "veryFar",
            RangeBand::OutOfRange => "outOfRange",
        }
    }

    pub fn from_name(text: &str) -> Option<RangeBand> {
        RANGE_BANDS.into_iter().find(|band| band.name() == text)
    }
}

/// Position in the band order; larger is further.
pub fn band_index(band: RangeBand) -> usize {
    band as usize
}

/// Whether something at `band` is within a stated maximum range.
pub fn reaches(band: RangeBand, max_range: RangeBand) -> bool {
    band != RangeBand::OutOfRange && band_index(band) <= band_index(max_range)
}

pub fn nearer_band(a: RangeBand, b: RangeBand) -> RangeBand {
    if band_index(a) <= band_index(b) {
        a
    } else {
        b
    }
}

/// The upper bound of each band in tiles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BandTiles {
    pub melee: f64,
    pub very_close: f64,
    pub close: f64,
    pub far: f64,
    pub very_far: f64,
}

pub const DEFAULT_BAND_TILES: BandTiles = BandTiles { melee: 1.0, very_close: 2.0, close: 6.0, far: 20.0, very_far: 60.0 };

impl BandTiles {
    fn of(&self, band: RangeBand) -> Option<f64> {
        match band {
            RangeBand::Melee => Some(self.melee),
            RangeBand::VeryClose => Some(self.very_close),
            RangeBand::Close => Some(self.close),
            RangeBand::Far => Some(self.far),
            RangeBand::VeryFar => Some(self.very_far),
            RangeBand::OutOfRange => None,
        }
    }
}

/// The band a tile distance falls in.
pub fn band_for_distance(tiles: f64, table: &BandTiles) -> RangeBand {
    RANGE_BANDS.into_iter().find(|&band| table.of(band).is_some_and(|most| tiles <= most)).unwrap_or(RangeBand::OutOfRange)
}

/// How far past a band's number a span still counts as inside it: half a tile.
pub const BAND_GRACE: f64 = 0.5;

/// The band a straight-line span falls in.
pub fn band_for_span(span: f64, table: &BandTiles) -> RangeBand {
    RANGE_BANDS.into_iter().find(|&band| table.of(band).is_some_and(|most| span < most + BAND_GRACE)).unwrap_or(RangeBand::OutOfRange)
}

/// The furthest span still inside a band.
pub fn max_span_for_band(band: RangeBand, table: &BandTiles) -> f64 {
    table.of(band).map_or(f64::INFINITY, |most| most + BAND_GRACE)
}

/// The next band out, or nothing past Very Far.
pub fn next_band(band: RangeBand) -> Option<RangeBand> {
    RANGE_BANDS.get(band_index(band) + 1).copied().filter(|&next| next != RangeBand::OutOfRange)
}

/// Somebody on the map: the tile they are in (negative off it) and where in it they stand.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Standing {
    pub tile: i32,
    pub x: f64,
    pub y: f64,
}

/// The band between two creatures, from where one stands to where the other does.
pub fn band_between_standing(a: Option<Standing>, b: Option<Standing>, table: &BandTiles) -> Option<RangeBand> {
    match (a, b) {
        (Some(a), Some(b)) if a.tile >= 0 && b.tile >= 0 => Some(band_for_span(js::hypot(a.x - b.x, a.y - b.y), table)),
        _ => None,
    }
}

/// The furthest tile distance still inside a band.
pub fn max_tiles_for_band(band: RangeBand, table: &BandTiles) -> f64 {
    table.of(band).unwrap_or(f64::INFINITY)
}

/// The SRD's own spelling of a band.
pub fn band_label(band: RangeBand) -> &'static str {
    match band {
        RangeBand::Melee => "Melee",
        RangeBand::VeryClose => "Very Close",
        RangeBand::Close => "Close",
        RangeBand::Far => "Far",
        RangeBand::VeryFar => "Very Far",
        RangeBand::OutOfRange => "Out of Range",
    }
}

/// A band out of content text - "Very Close", "very_close", "veryClose" - or nothing.
pub fn parse_range_band(input: &str) -> Option<RangeBand> {
    let key: String = js::trim(input).to_lowercase().chars().filter(|&c| !(js::is_space(c) || c == '_' || c == '-')).collect();
    RANGE_BANDS.into_iter().find(|&band| band_label(band).to_lowercase().replace(' ', "") == key)
}
