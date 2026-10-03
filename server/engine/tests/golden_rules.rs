//! `server/fixtures/rules.json` replayed: every function of `src/engine/rules` given the same inputs,
//! answering the same - rolls drawing the same dice from the same point in the stream, and leaving it at
//! the same point after. Each answer is built in the shape the TypeScript answered and compared as JSON,
//! numbers by value.

use engine::rng::{Rng, Seed};
use engine::rules::countdown::{advance_countdown, dynamic_steps, steps_for, CountdownAdvance, CountdownClock, CountdownCue, CountdownLoop, CountdownTick};
use engine::rules::cover::{combine_cover, cover_applies, cover_disadvantage, Cover};
use engine::rules::damage::*;
use engine::rules::dice::{format_dice, max_dice, parse_dice, roll_dice, with_proficiency, DamageType, DiceExpression, DiceRoll};
use engine::rules::duality::*;
use engine::rules::gm_die::{roll_gm_die, GmRoll, GmRollOptions};
use engine::rules::jump::*;
use engine::rules::range::*;
use engine::rules::resources::*;
use serde_json::{json, Value};

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/rules.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/rules/rules.golden.test.ts")).expect("JSON")
}

/// Two JSON answers the same: numbers by value, objects by their keys whatever the order.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        _ => a == b,
    }
}

macro_rules! check {
    ($got:expr, $wanted:expr, $($what:tt)*) => {{
        let (got, wanted): (Value, &Value) = ($got, $wanted);
        assert!(same(&got, wanted), "{}:\n  rust       {}\n  typescript {}", format!($($what)*), got, wanted);
    }};
}

/// A number as the fixture keeps it: null is Infinity.
fn num(value: &Value) -> f64 {
    if value.is_null() {
        f64::INFINITY
    } else {
        value.as_f64().expect("a number")
    }
}

/// A number as the fixture writes it: Infinity as null.
fn out(x: f64) -> Value {
    if x.is_finite() {
        json!(x)
    } else {
        Value::Null
    }
}

fn opt(value: &Value, key: &str) -> Option<f64> {
    value.get(key).filter(|v| !v.is_null()).map(num)
}

fn rng_of(seed: &Value) -> Rng {
    match seed.as_str() {
        Some(text) => Rng::new(Seed::Text(text)),
        None => Rng::new(Seed::Number(num(seed))),
    }
}

fn expression(value: &Value) -> DiceExpression {
    DiceExpression { count: num(&value["count"]), sides: num(&value["sides"]), modifier: num(&value["modifier"]) }
}

fn expression_json(e: &DiceExpression) -> Value {
    json!({ "count": out(e.count), "sides": out(e.sides), "modifier": out(e.modifier) })
}

fn roll_json(roll: &DiceRoll) -> Value {
    json!({ "rolls": roll.rolls, "diceTotal": roll.dice_total, "modifier": roll.modifier, "total": roll.total })
}

fn types(value: &Value) -> Vec<DamageType> {
    value.as_array().map(|all| all.iter().map(|t| DamageType::parse(t.as_str().unwrap()).unwrap()).collect()).unwrap_or_default()
}

fn types_json(types: &[DamageType]) -> Value {
    json!(types.iter().map(|t| t.name()).collect::<Vec<_>>())
}

#[test]
fn cover_is_alike() {
    for case in fixture()["cover"].as_array().unwrap() {
        let parse = |v: &Value| if v == "cover" { Cover::Cover } else { Cover::None };
        let name = |c: Cover| if c == Cover::Cover { "cover" } else { "none" };
        let (a, b) = (parse(&case[0]), parse(&case[1]));
        check!(json!([case[0], case[1], name(combine_cover(a, b)), cover_disadvantage(a, true), cover_disadvantage(a, false), cover_applies(a == Cover::Cover)]), case, "cover {case}");
    }
}

#[test]
fn dice_are_alike() {
    let golden = fixture();
    let d = &golden["dice"];
    for case in d["parsed"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let got = match parse_dice(text) {
            None => Value::Null,
            Some(parsed) => {
                let mut value = expression_json(&parsed.expression);
                if let Some(types) = &parsed.types {
                    value["types"] = types_json(types);
                }
                value
            }
        };
        check!(got, &case["parsed"], "parse {text:?}");
    }
    for case in d["formatted"].as_array().unwrap() {
        let e = expression(&case[0]);
        check!(json!([case[0], format_dice(&e), out(max_dice(&e))]), case, "format {}", case[0]);
    }
    for case in d["proficiency"].as_array().unwrap() {
        check!(json!([case[0], case[1], expression_json(&with_proficiency(&expression(&case[0]), num(&case[1])))]), case, "proficiency {case}");
    }
    for case in d["rolls"].as_array().unwrap() {
        let mut rng = rng_of(&case["seed"]);
        let rolled = match roll_dice(&mut rng, &expression(&case["expression"])) {
            Ok(roll) => json!({ "ok": roll_json(&roll) }),
            Err(_) => json!({ "error": "RangeError" }),
        };
        check!(json!({ "seed": case["seed"], "expression": case["expression"], "rolled": rolled, "after": rng.save() }), case, "roll {}", case["expression"]);
    }
}

fn duality_json(roll: &DualityRoll) -> Value {
    let mut value = json!({
        "good": roll.good, "bad": roll.bad, "advantageDie": roll.advantage_die, "helpDice": roll.help_dice, "helpBonus": roll.help_bonus, "modifier": roll.modifier,
        "total": roll.total, "difficulty": roll.difficulty, "outcome": roll.outcome.name(), "success": roll.success, "critical": roll.critical, "withGood": roll.with_good,
        "withBad": roll.with_bad, "reaction": roll.reaction, "goodGained": roll.good_gained, "badGained": roll.bad_gained, "stressCleared": roll.stress_cleared,
        "spotlightToGm": roll.spotlight_to_gm,
    });
    if let Some(sides) = roll.good_sides {
        value["goodSides"] = json!(sides);
    }
    value
}

#[test]
fn the_duality_dice_are_alike() {
    let golden = fixture();
    let d = &golden["duality"];
    for case in d["rolls"].as_array().unwrap() {
        let o = &case["options"];
        let options = DualityRollOptions {
            difficulty: num(&o["difficulty"]),
            modifier: opt(o, "modifier"),
            good_die_sides: opt(o, "goodDieSides").map(|s| s as u32),
            advantage: opt(o, "advantage"),
            disadvantage: opt(o, "disadvantage"),
            help_dice: opt(o, "helpDice"),
            reaction: o.get("reaction").and_then(Value::as_bool),
        };
        let mut rng = rng_of(&case["seed"]);
        let roll = roll_duality(&mut rng, &options).unwrap();
        let refaced = [with_faces(&roll, Some(5), Some(5)), with_faces(&roll, Some(12), None), with_faces(&roll, None, Some(1)), with_faces(&roll, None, None)];
        check!(
            json!({ "seed": case["seed"], "options": o, "roll": duality_json(&roll), "after": rng.save(), "refaced": refaced.iter().map(duality_json).collect::<Vec<_>>() }),
            case,
            "duality {} {o}",
            case["seed"]
        );
    }
    for case in d["classified"].as_array().unwrap() {
        let c = classify_roll(num(&case[0]), num(&case[1]), num(&case[2]), num(&case[3]));
        check!(json!([case[0], case[1], case[2], case[3], { "outcome": c.outcome.name(), "success": c.success, "critical": c.critical, "withGood": c.with_good }]), case, "classify {case}");
    }
    for case in d["net"].as_array().unwrap() {
        let at = |v: &Value| if v.is_null() { 0.0 } else { num(v) };
        check!(json!([case[0], case[1], net_advantage(at(&case[0]), at(&case[1]))]), case, "net {case}");
    }
    for case in d["groups"].as_array().unwrap() {
        let successes: Vec<bool> = case[0].as_array().unwrap().iter().map(|v| v == true).collect();
        check!(json!([case[0], group_action_modifier(&successes)]), case, "group {case}");
    }
}

fn gm_json(roll: &GmRoll) -> Value {
    json!({ "die": roll.die, "advantageDie": roll.advantage_die, "modifier": roll.modifier, "total": roll.total, "difficulty": roll.difficulty, "success": roll.success, "critical": roll.critical, "reaction": roll.reaction })
}

#[test]
fn the_gms_die_is_alike() {
    for case in fixture()["gm"].as_array().unwrap() {
        let o = &case["options"];
        let options = GmRollOptions { difficulty: num(&o["difficulty"]), modifier: opt(o, "modifier"), advantage: opt(o, "advantage"), disadvantage: opt(o, "disadvantage"), reaction: o.get("reaction").and_then(Value::as_bool) };
        let mut rng = rng_of(&case["seed"]);
        let roll = roll_gm_die(&mut rng, &options).unwrap();
        check!(json!({ "seed": case["seed"], "options": o, "roll": gm_json(&roll), "after": rng.save() }), case, "gm {} {o}", case["seed"]);
    }
}

fn band(value: &Value) -> RangeBand {
    RangeBand::from_name(value.as_str().unwrap()).unwrap()
}

fn band_out(band: Option<RangeBand>) -> Value {
    band.map_or(Value::Null, |b| json!(b.name()))
}

#[test]
fn ranges_are_alike() {
    let golden = fixture();
    let r = &golden["range"];
    let t = &r["table"];
    let table = BandTiles { melee: num(&t["melee"]), very_close: num(&t["veryClose"]), close: num(&t["close"]), far: num(&t["far"]), very_far: num(&t["veryFar"]) };
    let d = &DEFAULT_BAND_TILES;
    check!(json!(RANGE_BANDS.iter().map(|b| b.name()).collect::<Vec<_>>()), &r["bands"], "the bands");
    for case in r["reaches"].as_array().unwrap() {
        let (a, b) = (band(&case[0]), band(&case[1]));
        check!(json!([case[0], case[1], reaches(a, b), nearer_band(a, b).name()]), case, "reaches {case}");
    }
    for case in r["byDistance"].as_array().unwrap() {
        let x = num(&case[0]);
        check!(json!([case[0], band_for_distance(x, d).name(), band_for_distance(x, &table).name(), band_for_span(x, d).name(), band_for_span(x, &table).name()]), case, "distance {case}");
    }
    for case in r["spans"].as_array().unwrap() {
        let b = band(&case[0]);
        check!(
            json!([case[0], out(max_span_for_band(b, d)), out(max_span_for_band(b, &table)), out(max_tiles_for_band(b, d)), out(max_tiles_for_band(b, &table)), band_out(next_band(b)), band_label(b)]),
            case,
            "spans {case}"
        );
    }
    for case in r["standing"].as_array().unwrap() {
        let standing = |v: &Value| (!v.is_null()).then(|| Standing { tile: num(&v["tile"]) as i32, x: num(&v["at"]["x"]), y: num(&v["at"]["y"]) });
        let (a, b) = (standing(&case[0]), standing(&case[1]));
        check!(json!([case[0], case[1], band_out(band_between_standing(a, b, d)), band_out(band_between_standing(a, b, &table))]), case, "standing {case}");
    }
    for case in r["parsed"].as_array().unwrap() {
        check!(json!([case[0], band_out(parse_range_band(case[0].as_str().unwrap()))]), case, "parse band {:?}", case[0]);
    }
}

fn outcome(value: &Value) -> RollOutcome {
    RollOutcome::parse(value.as_str().unwrap()).unwrap()
}

fn clock(value: &Value) -> CountdownClock {
    CountdownClock { value: num(&value["value"]), start: num(&value["start"]), looping: value.get("loop").and_then(Value::as_str).and_then(CountdownLoop::from_name) }
}

fn clock_json(clock: &CountdownClock) -> Value {
    let mut value = json!({ "value": clock.value, "start": clock.start });
    if let Some(looping) = clock.looping {
        value["loop"] = json!(looping.name());
    }
    value
}

fn tick_json(tick: &CountdownTick) -> Value {
    json!({ "clock": tick.clock.as_ref().map_or(Value::Null, clock_json), "value": tick.value, "fired": tick.fired })
}

#[test]
fn countdowns_are_alike() {
    let golden = fixture();
    let c = &golden["countdowns"];
    for case in c["dynamic"].as_array().unwrap() {
        check!(json!([case[0], case[1], dynamic_steps(case[0] == "consequence", outcome(&case[1]))]), case, "dynamic {case}");
    }
    for case in c["steps"].as_array().unwrap() {
        let cue = &case[1];
        let cue_of = if cue["kind"] == "hpMarked" {
            CountdownCue::HpMarked { id: cue["id"].as_str().unwrap().into(), marked: num(&cue["marked"]) }
        } else {
            CountdownCue::ActionRoll { attack: cue["attack"] == true, outcome: outcome(&cue["outcome"]) }
        };
        check!(json!([case[0], cue, steps_for(CountdownAdvance::from_name(case[0].as_str().unwrap()).unwrap(), &cue_of)]), case, "steps {case}");
    }
    for case in c["ticks"].as_array().unwrap() {
        check!(json!([case[0], case[1], tick_json(&advance_countdown(&clock(&case[0]), num(&case[1])))]), case, "tick {case}");
    }
}

fn thresholds(value: &Value) -> DamageThresholds {
    DamageThresholds { major: num(&value["major"]), severe: num(&value["severe"]) }
}

fn thresholds_json(t: &DamageThresholds) -> Value {
    json!({ "major": out(t.major), "severe": out(t.severe) })
}

fn severity(value: &Value) -> DamageSeverity {
    DamageSeverity::from_name(value.as_str().unwrap()).unwrap()
}

fn defenses(value: &Value) -> DamageDefenses {
    DamageDefenses {
        resistances: types(&value["resistances"]),
        immunities: types(&value["immunities"]),
        reduce: value["reduce"]
            .as_array()
            .map(|all| all.iter().map(|r| DamageReduction { dice: r["dice"].as_str().unwrap().into(), only: r.get("only").and_then(Value::as_str).and_then(DamageType::parse) }).collect())
            .unwrap_or_default(),
    }
}

#[test]
fn damage_is_alike() {
    let golden = fixture();
    let d = &golden["damage"];
    for case in d["severe"].as_array().unwrap() {
        let s = severity(&case[0]);
        let reduced: Vec<&str> = [0.0, 1.0, 2.0, 3.0, 9.0, -1.0, 1.7].iter().map(|&n| reduce_severity(s, n).name()).collect();
        check!(json!([case[0], is_severe(s), hp_for_severity(s), reduced]), case, "severity {case}");
    }
    for case in d["thresholds"].as_array().unwrap() {
        check!(json!([case[0], parse_thresholds(case[0].as_str().unwrap()).as_ref().map_or(Value::Null, thresholds_json)]), case, "thresholds {:?}", case[0]);
    }
    for case in d["severity"].as_array().unwrap() {
        let (t, a) = (thresholds(&case[0]), num(&case[1]));
        check!(json!([case[0], case[1], severity_for(a, &t, false).name(), severity_for(a, &t, true).name()]), case, "severity for {case}");
    }
    for case in d["pc"].as_array().unwrap() {
        let armor = (!case[1].is_null()).then(|| thresholds(&case[1]));
        check!(json!([case[0], case[1], thresholds_json(&pc_thresholds(num(&case[0]), armor.as_ref()))]), case, "pc {case}");
    }
    for case in d["armor"].as_array().unwrap() {
        check!(json!([case[0], case[1], armor_score(num(&case[0]), num(&case[1]))]), case, "armor {case}");
    }
    for case in d["defended"].as_array().unwrap() {
        let (defence, kinds, amount) = (defenses(&case[0]), types(&case[1]), num(&case[2]));
        check!(
            json!([case[0], case[1], case[2], apply_defenses(amount, &kinds, &defence), flat_reduction(&kinds, &defence), reduction_rolls(&defence)]),
            case,
            "defended {case}"
        );
    }
    for case in d["reductions"].as_array().unwrap() {
        let mut rng = rng_of(&case[0]);
        let total = roll_reduction(&mut rng, &types(&case[2]), &defenses(&case[1])).unwrap();
        check!(json!([case[0], case[1], case[2], total, rng.save()]), case, "reduction {case}");
    }
    for case in d["rolled"].as_array().unwrap() {
        let o = &case[2];
        let options = DamageRollOptions {
            proficiency: opt(o, "proficiency").unwrap_or(1.0),
            critical: o.get("critical") == Some(&json!(true)),
            critical_rule: if o.get("criticalRule") == Some(&json!("doubleDice")) { CriticalRule::DoubleDice } else { CriticalRule::MaxDicePlusRoll },
            bonus: opt(o, "bonus").unwrap_or(0.0),
        };
        let mut rng = rng_of(&case[0]);
        let r = roll_damage(&mut rng, &expression(&case[1]), &options).unwrap();
        let mut result = roll_json(&r.roll);
        result["expression"] = expression_json(&r.expression);
        result["critical"] = json!(r.critical);
        result["criticalBonus"] = json!(r.critical_bonus);
        result["bonus"] = json!(r.bonus);
        result["total"] = json!(r.total);
        check!(json!([case[0], case[1], case[2], result, rng.save()]), case, "damage roll {case}");
    }
    for case in d["resolved"].as_array().unwrap() {
        let (hit, o) = (&case[0], &case[2]);
        let incoming = IncomingDamage { amount: num(&hit["amount"]), types: types(&hit["types"]), direct: hit.get("direct") == Some(&json!(true)), severity: hit.get("severity").map(severity) };
        let options = ResolveDamageOptions {
            massive_damage: o.get("massiveDamage") == Some(&json!(true)),
            armor_slots_marked: opt(o, "armorSlotsMarked"),
            armor_slots_available: opt(o, "armorSlotsAvailable"),
            defenses: o.get("defenses").map(defenses).unwrap_or_default(),
            rolled_reduction: opt(o, "rolledReduction"),
        };
        let r = resolve_damage(&incoming, &thresholds(&case[1]), &options);
        check!(
            json!([hit, case[1], o, { "incoming": r.incoming, "reduced": r.reduced, "severity": r.severity.name(), "finalSeverity": r.final_severity.name(), "armorSlotsSpent": r.armor_slots_spent, "hpMarked": r.hp_marked }]),
            case,
            "resolve {case}"
        );
    }
}

fn pool(value: &Value) -> MarkPool {
    MarkPool { marked: num(&value["marked"]), max: num(&value["max"]) }
}

fn pool_json(p: &MarkPool) -> Value {
    json!({ "marked": p.marked, "max": p.max })
}

fn currency(value: &Value) -> Currency {
    Currency { value: num(&value["value"]), max: num(&value["max"]) }
}

fn currency_json(c: &Currency) -> Value {
    json!({ "value": c.value, "max": c.max })
}

#[test]
fn the_pools_are_alike() {
    let golden = fixture();
    let r = &golden["resources"];
    for case in r["pools"].as_array().unwrap() {
        let p = pool(&case[0]);
        let all = clear_all(&p);
        let resized: Vec<Value> = [0.0, 3.0, 6.0, 12.0, 13.0, -2.0, 7.8].iter().map(|&m| pool_json(&resize(&p, m, MAX_SLOTS))).collect();
        check!(json!([case[0], unmarked(&p), is_full(&p), { "pool": pool_json(&all.pool), "applied": all.applied }, resized, pool_json(&resize(&p, 20.0, 20.0))]), case, "pool {case}");
    }
    for case in r["marks"].as_array().unwrap() {
        let (p, a) = (pool(&case[0]), num(&case[1]));
        let (m, c, h) = (mark(&p, a), clear(&p, a), mark_hit_points(&p, a));
        check!(
            json!([case[0], case[1], { "pool": pool_json(&m.pool), "applied": m.applied, "overflow": m.overflow, "filled": m.filled }, { "pool": pool_json(&c.pool), "applied": c.applied },
                { "hitPoints": pool_json(&h.hit_points), "hpMarked": h.hp_marked, "fell": h.fell }]),
            case,
            "mark {case}"
        );
    }
    for case in r["stress"].as_array().unwrap() {
        let (s, h, a) = (pool(&case[0]), pool(&case[1]), num(&case[2]));
        let m = mark_stress(&s, &h, a);
        check!(
            json!([case[0], case[1], case[2], { "stress": pool_json(&m.stress), "hitPoints": pool_json(&m.hit_points), "stressMarked": m.stress_marked, "hpMarked": m.hp_marked,
                "becameVulnerable": m.became_vulnerable, "fell": m.fell }, can_mark_stress(&s, a)]),
            case,
            "stress {case}"
        );
    }
    for case in r["currencies"].as_array().unwrap() {
        let (c, a) = (currency(&case[0]), num(&case[1]));
        let (g, s) = (gain(&c, a), spend(&c, a));
        check!(
            json!([case[0], case[1], { "currency": currency_json(&g.currency), "applied": g.applied, "wasted": g.wasted }, { "currency": currency_json(&s.currency), "ok": s.ok, "spent": s.spent }, can_afford(&c, a)]),
            case,
            "currency {case}"
        );
    }
    for case in r["scars"].as_array().unwrap() {
        let s = scar(&currency(&case[0]));
        check!(json!([case[0], { "good": currency_json(&s.good), "journeyEnds": s.journey_ends }]), case, "scar {case}");
    }
}

fn jump_rules(value: &Value) -> JumpRules {
    let t = |key: &str| Trait::from_name(value[key].as_str().unwrap()).unwrap();
    JumpRules {
        enabled: value["enabled"] == true,
        step_height: num(&value["stepHeight"]),
        reach_trait: t("reachTrait"),
        reach_base: num(&value["reachBase"]),
        reach_per_point: num(&value["reachPerPoint"]),
        range_base: num(&value["rangeBase"]),
        range_per_point: num(&value["rangePerPoint"]),
        flat_roll: value["flatRoll"] == true,
        roll_trait: t("rollTrait"),
        difficulty: num(&value["difficulty"]),
        drop_trait: t("dropTrait"),
        drop_base: num(&value["dropBase"]),
        drop_per_point: num(&value["dropPerPoint"]),
        harder_every: num(&value["harderEvery"]),
        fall_die: num(&value["fallDie"]),
        half_on_success: value["halfOnSuccess"] == true,
        fail_condition: value["failCondition"].as_str().unwrap().into(),
    }
}

#[test]
fn jumps_are_alike() {
    let golden = fixture();
    let j = &golden["jumps"];
    assert_eq!(jump_rules(&j["defaults"]), JumpRules::default(), "the defaults");
    for entry in j["rules"].as_array().unwrap() {
        let rules = jump_rules(&entry["rules"]);
        for by in entry["byTraits"].as_array().unwrap() {
            let t = &by["traits"];
            let traits = Traits { agility: num(&t["agility"]), strength: num(&t["strength"]), finesse: num(&t["finesse"]), instinct: num(&t["instinct"]), presence: num(&t["presence"]), knowledge: num(&t["knowledge"]) };
            let terms: Vec<Value> = by["terms"]
                .as_array()
                .unwrap()
                .iter()
                .map(|pair| {
                    let found = leap_terms(&rules, num(&pair[0]), &traits);
                    json!([pair[0], found.map_or(Value::Null, |l| json!({ "difficulty": l.difficulty, "fallDice": l.fall_dice }))])
                })
                .collect();
            check!(
                json!({ "traits": t, "reach": jump_reach(&rules, &traits), "range": jump_range(&rules, &traits), "drop": safe_drop(&rules, &traits), "terms": terms }),
                by,
                "jumps {} with {t}",
                entry["rules"]
            );
        }
    }
    for case in j["arcs"].as_array().unwrap() {
        check!(json!([case[0], case[1], arc_lift(num(&case[0]), num(&case[1]))]), case, "arc {case}");
    }
    for case in j["heights"].as_array().unwrap() {
        check!(json!([case[0], case[1], case[2], case[3], arc_height(num(&case[0]), num(&case[1]), num(&case[2]), num(&case[3]))]), case, "height {case}");
    }
}
