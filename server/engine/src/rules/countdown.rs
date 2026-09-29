//! Countdowns (`src/engine/rules/countdown.ts`), SRD 2.0: a clock that starts at a value, is reduced as
//! it advances, and triggers at 0 - spent, or looping back to its start (which an increasing or
//! decreasing loop moves by one). The clock alone: what a countdown does belongs to the script.

use crate::js;
use crate::rules::duality::RollOutcome;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CountdownAdvance {
    Standard,
    AttackRoll,
    WithBad,
    HpMarked,
    Progress,
    Consequence,
}

pub const COUNTDOWN_ADVANCES: [CountdownAdvance; 6] =
    [CountdownAdvance::Standard, CountdownAdvance::AttackRoll, CountdownAdvance::WithBad, CountdownAdvance::HpMarked, CountdownAdvance::Progress, CountdownAdvance::Consequence];

impl CountdownAdvance {
    pub fn name(self) -> &'static str {
        match self {
            CountdownAdvance::Standard => "standard",
            CountdownAdvance::AttackRoll => "attackRoll",
            CountdownAdvance::WithBad => "withBad",
            CountdownAdvance::HpMarked => "hpMarked",
            CountdownAdvance::Progress => "progress",
            CountdownAdvance::Consequence => "consequence",
        }
    }

    pub fn from_name(text: &str) -> Option<Self> {
        COUNTDOWN_ADVANCES.into_iter().find(|advance| advance.name() == text)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CountdownLoop {
    Reset,
    Increasing,
    Decreasing,
}

impl CountdownLoop {
    pub fn name(self) -> &'static str {
        match self {
            CountdownLoop::Reset => "reset",
            CountdownLoop::Increasing => "increasing",
            CountdownLoop::Decreasing => "decreasing",
        }
    }

    pub fn from_name(text: &str) -> Option<Self> {
        [CountdownLoop::Reset, CountdownLoop::Increasing, CountdownLoop::Decreasing].into_iter().find(|kind| kind.name() == text)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CountdownClock {
    pub value: f64,
    pub start: f64,
    pub looping: Option<CountdownLoop>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CountdownTick {
    /// Nothing when the countdown is over.
    pub clock: Option<CountdownClock>,
    /// The value it reached, before any loop reset it.
    pub value: f64,
    pub fired: bool,
}

/// Something at the table a countdown might answer.
#[derive(Clone, Debug, PartialEq)]
pub enum CountdownCue {
    ActionRoll { attack: bool, outcome: RollOutcome },
    HpMarked { id: String, marked: f64 },
}

/// A dynamic countdown's advance, by the SRD's chart: progress by the party's successes, consequence by
/// their failures, up to 3.
pub fn dynamic_steps(consequence: bool, outcome: RollOutcome) -> f64 {
    use RollOutcome::*;
    match (consequence, outcome) {
        (false, CriticalSuccess) => 3.0,
        (false, SuccessWithGood) => 2.0,
        (false, SuccessWithBad) => 1.0,
        (true, FailureWithBad) => 3.0,
        (true, FailureWithGood) => 2.0,
        (true, SuccessWithBad) => 1.0,
        _ => 0.0,
    }
}

/// How far a cue moves a countdown that advances by this rule: 0 when it is not the cue it waits for.
pub fn steps_for(advance: CountdownAdvance, cue: &CountdownCue) -> f64 {
    match cue {
        CountdownCue::HpMarked { marked, .. } => {
            if advance == CountdownAdvance::HpMarked {
                js::max(0.0, *marked)
            } else {
                0.0
            }
        }
        CountdownCue::ActionRoll { attack, outcome } => match advance {
            CountdownAdvance::Standard => 1.0,
            CountdownAdvance::AttackRoll => f64::from(u8::from(*attack)),
            CountdownAdvance::WithBad => f64::from(u8::from(matches!(outcome, RollOutcome::SuccessWithBad | RollOutcome::FailureWithBad))),
            CountdownAdvance::Progress => dynamic_steps(false, *outcome),
            CountdownAdvance::Consequence => dynamic_steps(true, *outcome),
            CountdownAdvance::HpMarked => 0.0,
        },
    }
}

/// Advance a clock, and say what became of it.
pub fn advance_countdown(clock: &CountdownClock, steps: f64) -> CountdownTick {
    let value = js::max(0.0, clock.value - js::max(0.0, js::trunc(steps)));
    if value > 0.0 {
        return CountdownTick { clock: Some(CountdownClock { value, ..*clock }), value, fired: false };
    }
    let Some(looping) = clock.looping else { return CountdownTick { clock: None, value, fired: true } };
    let start = match looping {
        CountdownLoop::Increasing => clock.start + 1.0,
        CountdownLoop::Decreasing => clock.start - 1.0,
        CountdownLoop::Reset => clock.start,
    };
    if start <= 0.0 {
        return CountdownTick { clock: None, value, fired: true };
    }
    CountdownTick { clock: Some(CountdownClock { value: start, start, looping: Some(looping) }), value, fired: true }
}
