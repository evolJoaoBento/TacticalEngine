//! A walk cut short (`docs/SERVER.md`, phase 5, slice 1): the page says where each walker is drawn when a new
//! order interrupts the glide (`landWalkers`), and the game puts them down there - but only somewhere on the
//! line it gave them to walk. A spot anywhere else is a page saying where somebody stands, which the game the
//! server plays is never told.
//!
//! The line is the walker's last motion: the one still waiting to be drawn, or the one a view drained
//! (`takeMotions`), kept with the room it was walked in. A walker thrown, put down, or landed has no line until
//! they walk again. The page draws a walk through points a little off the line - each leg from wherever the
//! token stood, a glide's world position read back into tile units - so a spot is on it within `SLACK`.

use super::session::Session;
use crate::grid::tile_grid::Spot;
use serde_json::Value;

/// How far from the line a walker may be put down, in tiles.
pub const SLACK: f64 = 0.75;

/// Whether `at` is within `slack` of the line through `line`'s points (a single point, of that point).
pub fn near_line(line: &[Spot], at: Spot, slack: f64) -> bool {
    let near = |a: Spot, b: Spot| {
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let length = dx * dx + dy * dy;
        let t = if length == 0.0 { 0.0 } else { (((at.x - a.x) * dx + (at.y - a.y) * dy) / length).clamp(0.0, 1.0) };
        (a.x + dx * t - at.x).hypot(a.y + dy * t - at.y) <= slack
    };
    match line {
        [] => false,
        [only] => near(*only, *only),
        _ => line.windows(2).any(|leg| near(leg[0], leg[1])),
    }
}

impl Session {
    /// What a motion says of its walker's line: a line to be drawn along - its route, else its path's tile
    /// centres - `Some(None)` for a walker thrown or put down, who is drawn there and does not walk, and `None`
    /// for one that moves nobody (a lunge, a blow struck).
    fn says_of_line(&self, motion: &Value) -> Option<Option<Vec<Spot>>> {
        if motion["thrown"] == true || motion["teleport"] == true {
            return Some(None);
        }
        if motion["route"].is_null() && motion["path"].is_null() {
            return None;
        }
        Some(self.line_of(motion))
    }

    fn line_of(&self, motion: &Value) -> Option<Vec<Spot>> {
        if let Some(route) = motion["route"].as_array().filter(|route| !route.is_empty()) {
            return route.iter().map(|spot| serde_json::from_value::<Spot>(spot.clone()).ok()).collect();
        }
        let path = motion["path"].as_array()?;
        let grid = &self.world.state.grid;
        path.iter().map(|tile| tile.as_i64().map(|tile| grid.spot_of(tile as i32))).collect()
    }

    /// What a view drained, kept: each walker's line, until they walk again, are put down, or land.
    pub(crate) fn drained(&mut self, motions: &[Value]) {
        for motion in motions {
            let Some(id) = motion["id"].as_str() else { continue };
            match self.says_of_line(motion) {
                Some(Some(line)) => {
                    self.walked.insert(id.to_string(), (self.room, line));
                }
                Some(None) => {
                    self.walked.remove(id);
                }
                None => {}
            }
        }
    }

    /// The line a walker was last given: from the motion still to be drawn, else the one drained in this room.
    fn walked_line(&self, id: &str) -> Option<Vec<Spot>> {
        if let Some(said) = self.motions.iter().rev().filter(|motion| motion["id"] == id).find_map(|motion| self.says_of_line(motion)) {
            return said;
        }
        self.walked.get(id).filter(|(room, _)| *room == self.room).map(|(_, line)| line.clone())
    }

    /// A walker put down where the page draws them, if that is on the line they were walking: whether they were.
    pub fn land_walker(&mut self, id: &str, at: Spot) -> bool {
        let Some(line) = self.walked_line(id) else { return false };
        if !near_line(&line, at, SLACK) || !self.party.land_at(&mut self.world.state, id, at) {
            return false;
        }
        self.walked.remove(id);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spot(x: f64, y: f64) -> Spot {
        Spot { x, y }
    }

    #[test]
    fn a_spot_on_the_line_or_beside_it_is_near() {
        let line = [spot(0.0, 0.0), spot(4.0, 0.0), spot(4.0, 3.0)];
        assert!(near_line(&line, spot(2.0, 0.0), SLACK));
        assert!(near_line(&line, spot(4.0, 1.5), SLACK));
        assert!(near_line(&line, spot(2.0, 0.7), SLACK));
        assert!(near_line(&line, spot(-0.5, 0.0), SLACK));
    }

    #[test]
    fn a_spot_off_the_line_or_past_its_ends_is_not() {
        let line = [spot(0.0, 0.0), spot(4.0, 0.0), spot(4.0, 3.0)];
        assert!(!near_line(&line, spot(2.0, 1.0), SLACK));
        assert!(!near_line(&line, spot(4.0, 4.0), SLACK));
        assert!(!near_line(&line, spot(-1.0, 0.0), SLACK));
        assert!(!near_line(&[], spot(0.0, 0.0), SLACK));
    }

    #[test]
    fn a_line_of_one_point_is_that_point() {
        assert!(near_line(&[spot(1.0, 1.0)], spot(1.5, 1.0), SLACK));
        assert!(!near_line(&[spot(1.0, 1.0)], spot(2.0, 1.0), SLACK));
    }
}
