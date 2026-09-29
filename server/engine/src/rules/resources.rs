//! The resource pools (`src/engine/rules/resources.ts`): Hit Points, Stress and Armor Slots are marked
//! from empty; Light and Shadow are gained and spent against a cap. Every operation is pure and reports
//! what actually happened - asked to clear 4 Stress with 2 marked, it clears 2.

use crate::js;

pub const STARTING_GOOD: f64 = 2.0;
pub const MAX_GOOD: f64 = 6.0;
pub const MAX_BAD: f64 = 12.0;
pub const STARTING_STRESS_SLOTS: f64 = 6.0;
pub const MAX_SLOTS: f64 = 12.0;
pub const TAG_TEAM_GOOD_COST: f64 = 3.0;
pub const CLASS_GOOD_FEATURE_COST: f64 = 3.0;

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    js::min(max, js::max(min, value))
}

/// A pool marked from empty.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MarkPool {
    pub marked: f64,
    pub max: f64,
}

pub fn create_mark_pool(max: f64, marked: f64) -> MarkPool {
    let m = js::max(0.0, js::trunc(max));
    MarkPool { max: m, marked: clamp(marked, 0.0, m) }
}

pub fn unmarked(pool: &MarkPool) -> f64 {
    pool.max - pool.marked
}

pub fn is_full(pool: &MarkPool) -> bool {
    pool.max > 0.0 && pool.marked >= pool.max
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MarkResult {
    pub pool: MarkPool,
    pub applied: f64,
    pub overflow: f64,
    pub filled: bool,
}

pub fn mark(pool: &MarkPool, amount: f64) -> MarkResult {
    let want = js::max(0.0, js::trunc(amount));
    let applied = js::min(want, unmarked(pool));
    let next = MarkPool { max: pool.max, marked: pool.marked + applied };
    MarkResult { pool: next, applied, overflow: want - applied, filled: is_full(&next) }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClearResult {
    pub pool: MarkPool,
    pub applied: f64,
}

pub fn clear(pool: &MarkPool, amount: f64) -> ClearResult {
    let applied = js::min(js::max(0.0, js::trunc(amount)), pool.marked);
    ClearResult { pool: MarkPool { max: pool.max, marked: pool.marked - applied }, applied }
}

pub fn clear_all(pool: &MarkPool) -> ClearResult {
    ClearResult { pool: MarkPool { max: pool.max, marked: 0.0 }, applied: pool.marked }
}

/// More or fewer slots: leveling up, or temporary Armor Slots.
pub fn resize(pool: &MarkPool, max: f64, cap: f64) -> MarkPool {
    let m = clamp(js::trunc(max), 0.0, cap);
    MarkPool { max: m, marked: js::min(pool.marked, m) }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StressResult {
    pub stress: MarkPool,
    pub hit_points: MarkPool,
    pub stress_marked: f64,
    pub hp_marked: f64,
    pub became_vulnerable: bool,
    pub fell: bool,
}

/// Mark Stress; one Hit Point instead for the whole event when it cannot all be marked.
pub fn mark_stress(stress: &MarkPool, hit_points: &MarkPool, amount: f64) -> StressResult {
    let was_full = is_full(stress);
    let s = mark(stress, amount);
    let h = mark(hit_points, if s.overflow > 0.0 { 1.0 } else { 0.0 });
    StressResult { stress: s.pool, hit_points: h.pool, stress_marked: s.applied, hp_marked: h.applied, became_vulnerable: s.filled && !was_full, fell: h.filled && h.applied > 0.0 }
}

pub fn can_mark_stress(stress: &MarkPool, cost: f64) -> bool {
    unmarked(stress) >= js::max(1.0, js::trunc(cost))
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HitPointResult {
    pub hit_points: MarkPool,
    pub hp_marked: f64,
    pub fell: bool,
}

pub fn mark_hit_points(hit_points: &MarkPool, amount: f64) -> HitPointResult {
    let was_full = is_full(hit_points);
    let r = mark(hit_points, amount);
    HitPointResult { hit_points: r.pool, hp_marked: r.applied, fell: r.filled && !was_full }
}

/// Light or Shadow: gained and spent against a cap.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Currency {
    pub value: f64,
    pub max: f64,
}

pub fn create_good(value: f64, max: f64) -> Currency {
    Currency { max, value: clamp(value, 0.0, max) }
}

pub fn create_bad(value: f64, max: f64) -> Currency {
    Currency { max, value: clamp(value, 0.0, max) }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GainResult {
    pub currency: Currency,
    pub applied: f64,
    pub wasted: f64,
}

pub fn gain(currency: &Currency, amount: f64) -> GainResult {
    let want = js::max(0.0, js::trunc(amount));
    let applied = js::min(want, currency.max - currency.value);
    GainResult { currency: Currency { max: currency.max, value: currency.value + applied }, applied, wasted: want - applied }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpendResult {
    pub currency: Currency,
    pub ok: bool,
    pub spent: f64,
}

/// All or nothing: a cost partly paid buys nothing.
pub fn spend(currency: &Currency, amount: f64) -> SpendResult {
    let cost = js::max(0.0, js::trunc(amount));
    if currency.value < cost {
        return SpendResult { currency: *currency, ok: false, spent: 0.0 };
    }
    SpendResult { currency: Currency { max: currency.max, value: currency.value - cost }, ok: true, spent: cost }
}

pub fn can_afford(currency: &Currency, amount: f64) -> bool {
    currency.value >= js::max(0.0, js::trunc(amount))
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScarResult {
    pub good: Currency,
    pub journey_ends: bool,
}

/// Cross out a Light slot for good; the last one ends the journey.
pub fn scar(good: &Currency) -> ScarResult {
    let max = js::max(0.0, good.max - 1.0);
    ScarResult { good: Currency { max, value: js::min(good.value, max) }, journey_ends: max == 0.0 }
}
