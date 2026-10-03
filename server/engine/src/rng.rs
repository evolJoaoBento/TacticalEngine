//! Deterministic random numbers for the rules: `src/engine/core/rng.ts`, bit for bit.
//!
//! SplitMix32 - 32-bit state, one multiply-xorshift chain per draw - with FNV-1a for text seeds. The
//! TypeScript does its arithmetic with `Math.imul` and `>>> 0`; here it is wrapping `u32`, which is the
//! same thing. A text seed is hashed over its UTF-16 code units, as JavaScript's `charCodeAt` reads it,
//! so a seed with an accent or an emoji rolls the same dice in both. Held to
//! `server/fixtures/rng.json` by `tests/golden_rng.rs`.

/// A position in a random stream, for saves and assertions.
pub type RngState = u32;

/// Hash a string into a seed, so seeds can be human-readable. FNV-1a, 32-bit, over UTF-16 code units.
pub fn hash_seed(seed: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for unit in seed.encode_utf16() {
        h ^= u32::from(unit);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// A number as JavaScript's `>>> 0` folds it: truncated, then taken modulo 2^32; nothing for NaN or infinity.
pub fn to_uint32(value: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    value.trunc().rem_euclid(4_294_967_296.0) as u32
}

/// A seed as `createRng` takes one: text is hashed, a number is folded to 32 bits.
#[derive(Clone, Copy, Debug)]
pub enum Seed<'a> {
    Text(&'a str),
    Number(f64),
}

/// A seeded generator. Every rule that rolls takes one; nothing in the engine rolls any other way.
#[derive(Clone, Debug)]
pub struct Rng {
    state: u32,
}

/// Why a call was refused: the TypeScript throws a `RangeError` for the same arguments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RangeError(pub String);

impl Rng {
    pub fn new(seed: Seed<'_>) -> Self {
        let state = match seed {
            Seed::Text(text) => hash_seed(text),
            Seed::Number(number) => to_uint32(number),
        };
        Rng { state }
    }

    pub fn from_state(state: RngState) -> Self {
        Rng { state }
    }

    /// The next 32 bits of the stream.
    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x9e37_79b9);
        let mut z = self.state;
        z = (z ^ (z >> 16)).wrapping_mul(0x21f0_aaad);
        z = (z ^ (z >> 15)).wrapping_mul(0x735a_2d97);
        z ^ (z >> 15)
    }

    /// Uniform float in [0, 1).
    pub fn next(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.0
    }

    /// Uniform integer in [0, max), by rejection sampling so it is exactly uniform.
    pub fn next_int(&mut self, max: u32) -> Result<u32, RangeError> {
        if max == 0 {
            return Err(RangeError(format!("nextInt(max) needs a positive integer, got {max}")));
        }
        let span: u64 = 1 << 32;
        let limit = span - (span % u64::from(max));
        let mut value = self.next_u32();
        while u64::from(value) >= limit {
            value = self.next_u32();
        }
        Ok(value % max)
    }

    /// One die: uniform integer in [1, sides].
    pub fn die(&mut self, sides: u32) -> Result<u32, RangeError> {
        if sides == 0 {
            return Err(RangeError(format!("die(sides) needs a positive integer, got {sides}")));
        }
        Ok(self.next_int(sides)? + 1)
    }

    /// `count` dice of `sides`, in roll order.
    pub fn dice(&mut self, count: usize, sides: u32) -> Result<Vec<u32>, RangeError> {
        (0..count).map(|_| self.die(sides)).collect()
    }

    /// Uniform pick from a non-empty slice.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> Result<&'a T, RangeError> {
        if items.is_empty() {
            return Err(RangeError("pick() needs a non-empty array".into()));
        }
        let index = self.next_int(items.len() as u32)?;
        Ok(&items[index as usize])
    }

    /// In-place Fisher-Yates shuffle, walking down from the end as the TypeScript does.
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.next_int(i as u32 + 1).expect("i + 1 is positive") as usize;
            items.swap(i, j);
        }
    }

    /// A new, independent generator from this one's current position; advances this one by one draw.
    pub fn fork(&mut self) -> Rng {
        Rng { state: self.next_u32() }
    }

    pub fn save(&self) -> RngState {
        self.state
    }

    pub fn restore(&mut self, state: RngState) {
        self.state = state;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_what_the_typescript_refuses() {
        let mut rng = Rng::new(Seed::Number(0.0));
        assert!(rng.next_int(0).is_err());
        assert!(rng.die(0).is_err());
        assert!(rng.pick::<u8>(&[]).is_err());
    }

    #[test]
    fn folds_numbers_as_javascript_does() {
        assert_eq!(to_uint32(-1.0), 0xffff_ffff);
        assert_eq!(to_uint32(1.75), 1);
        assert_eq!(to_uint32(4_294_967_303.0), 7);
        assert_eq!(to_uint32(f64::NAN), 0);
    }
}
