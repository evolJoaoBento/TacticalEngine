//! JavaScript's arithmetic where it differs from Rust's, as V8 computes it - the engine's rules were
//! written against these, and a walk that rounds a spot to a tile the other way is on another tile.

/// `Math.round`: to the nearest integer, a half towards +Infinity (`Math.round(-0.5)` is -0, not -1).
/// V8's `Float64Round`: the ceiling, less one when that is more than half above.
pub fn round(x: f64) -> f64 {
    let up = x.ceil();
    if up - 0.5 <= x {
        up
    } else {
        up - 1.0
    }
}

/// `Math.hypot(a, b)` as V8 computes it: both scaled by the larger, the squares summed with Kahan's
/// compensation, the root scaled back. Not always the last bit `f64::hypot` gives.
pub fn hypot(a: f64, b: f64) -> f64 {
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let values = [a.abs(), b.abs()];
    let max = if values[1] > values[0] { values[1] } else { values[0] };
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for value in values {
        let n = value / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// `Math.max(a, b)` for numbers that are not NaN: +0 above -0, as JavaScript has it.
pub fn max(a: f64, b: f64) -> f64 {
    if a > b || (a == b && b.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Math.min(a, b)` for numbers that are not NaN: -0 below +0.
pub fn min(a: f64, b: f64) -> f64 {
    if a < b || (a == b && a.is_sign_negative()) {
        a
    } else {
        b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_halves_up() {
        assert_eq!(round(0.5), 1.0);
        assert_eq!(round(-0.5), 0.0);
        assert!(round(-0.5).is_sign_negative());
        assert_eq!(round(-1.5), -1.0);
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(round(-0.35), 0.0);
    }

    #[test]
    fn hypot_is_the_root_of_a_whole_square() {
        assert_eq!(hypot(3.0, 4.0), 5.0);
        assert_eq!(hypot(0.0, 0.0), 0.0);
        assert_eq!(hypot(1.0, 1.0), std::f64::consts::SQRT_2);
    }
}
