//! How much ground a prop covers (`src/engine/scene/deco-span.ts`): a square block anchored at its
//! north-west tile, one tile unless it says otherwise. Square, so a prop's rotation never turns what it
//! covers; anchored at the corner, so an even span has somewhere to stand.

use serde_json::Value;

/// The largest block a prop may cover.
pub const DECO_SPAN_MAX: f64 = 16.0;

/// How many tiles across a prop is drawn: absent means one.
pub fn span_of(deco: &Value) -> i64 {
    match deco.get("span").and_then(Value::as_f64) {
        None => 1,
        Some(span) if span.is_finite() => DECO_SPAN_MAX.min(span.floor().max(1.0)) as i64,
        Some(_) => 1,
    }
}

fn anchor(deco: &Value) -> (f64, f64) {
    (deco["position"]["x"].as_f64().unwrap_or(f64::NAN), deco["position"]["y"].as_f64().unwrap_or(f64::NAN))
}

/// Whether a prop covers a tile: its anchor, and everything south and east of it within the span.
pub fn deco_covers(deco: &Value, x: f64, y: f64) -> bool {
    let span = span_of(deco) as f64;
    let (ax, ay) = anchor(deco);
    x >= ax && x < ax + span && y >= ay && y < ay + span
}

/// The middle of the block, in tiles: where the model is drawn. Fractional for an even span.
pub fn deco_centre(deco: &Value) -> (f64, f64) {
    let off = (span_of(deco) - 1) as f64 / 2.0;
    let (x, y) = anchor(deco);
    (x + off, y + off)
}

/// Every tile a prop covers, north-west first, row by row.
pub fn deco_footprint(deco: &Value) -> Vec<(f64, f64)> {
    let span = span_of(deco);
    let (x, y) = anchor(deco);
    (0..span).flat_map(|dy| (0..span).map(move |dx| (x + dx as f64, y + dy as f64))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_block_is_anchored_at_its_corner() {
        let crate_ = json!({ "position": { "x": 4, "y": 4 }, "span": 2 });
        assert_eq!(deco_footprint(&crate_), [(4.0, 4.0), (5.0, 4.0), (4.0, 5.0), (5.0, 5.0)]);
        assert_eq!(deco_centre(&crate_), (4.5, 4.5));
        assert!(deco_covers(&crate_, 5.0, 5.0) && !deco_covers(&crate_, 6.0, 5.0));
        assert_eq!(span_of(&json!({ "span": 99 })), 16);
        assert_eq!(span_of(&json!({ "span": 0.5 })), 1);
        assert_eq!(span_of(&json!({})), 1);
    }
}
