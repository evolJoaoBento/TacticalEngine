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

/// `Math.trunc`: towards zero.
pub fn trunc(x: f64) -> f64 {
    x.trunc()
}

/// Whether JavaScript's `\s` and `trim` take this character: WhiteSpace and LineTerminator - U+FEFF
/// included, U+0085 not, the other way round from `char::is_whitespace`.
pub fn is_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

/// `String.prototype.trim`.
pub fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

/// A number as `String(n)` writes it: whole numbers without a point, `1e+21` from there up, and
/// JavaScript's exponent form below a millionth.
pub fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x == 0.0 {
        return "0".into();
    }
    let magnitude = x.abs();
    if magnitude >= 1e21 || magnitude < 1e-6 {
        let text = format!("{x:e}");
        return match text.split_once('e') {
            Some((mantissa, exponent)) if !exponent.starts_with('-') => format!("{mantissa}e+{exponent}"),
            _ => text,
        };
    }
    if x.fract() == 0.0 {
        format!("{x:.0}")
    } else {
        format!("{x}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_written_as_javascript_writes_them() {
        for (x, text) in [(0.0, "0"), (-0.0, "0"), (3.0, "3"), (-2.0, "-2"), (0.5, "0.5"), (1e20, "100000000000000000000"), (1e21, "1e+21"), (1.5e22, "1.5e+22"), (1e-7, "1e-7")] {
            assert_eq!(number_to_string(x), text, "{x}");
        }
    }

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

/// The order `Array.prototype.sort` puts strings in with no comparator: by UTF-16 code unit, so a
/// character past U+FFFF (two surrogates, from U+D800) sorts before one from U+E000 to U+FFFF, which
/// Rust's own `str` order puts the other way round.
pub fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}
