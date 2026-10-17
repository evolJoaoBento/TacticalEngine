//! Cover (`src/engine/rules/cover.ts`), SRD 2.0: binary - a partial obstruction between an attacker and
//! their target gives the target cover, and an attack made through it is rolled with disadvantage. One
//! die, never more; only a ranged attack is made through it.

/// Whether an obstruction stands between an attacker and their target.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Cover {
    None,
    Cover,
}

/// The disadvantage dice cover costs an attack: one for a ranged attack through it, else none.
pub fn cover_disadvantage(cover: Cover, ranged: bool) -> u32 {
    u32::from(ranged && cover == Cover::Cover)
}

/// Cover only applies to ranged attacks; a melee attacker is already past it.
pub fn cover_applies(ranged: bool) -> bool {
    ranged
}

/// Cover when either source gives it. It does not stack.
pub fn combine_cover(a: Cover, b: Cover) -> Cover {
    if a == Cover::Cover || b == Cover::Cover {
        Cover::Cover
    } else {
        Cover::None
    }
}
