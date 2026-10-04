//! What a server needs of a hook that the TypeScript's fixture cannot show: that it stops, that it reaches
//! nothing but its reads, that its dice are the scenario's stream, and that a read reaching another hook
//! runs it.

use engine::rng::{Rng, Seed};
use engine::rules::range::RangeBand;
use engine::scene::state::Faction;
use engine::script::conditions::{HookReads, TargetBindings};
use engine::script::hooks::{CodeSource, HookReader, Hooks};
use hooks::{Limits, QuickJsHooks, TOO_LONG};
use serde_json::{json, Value};

/// A world of one creature, with a Difficulty that asks a hook - as a modifier gated on one would.
struct Room<'h> {
    hooks: Option<&'h QuickJsHooks>,
    asked: Vec<String>,
}

impl HookReader for Room<'_> {
    fn pool(&mut self, id: &str, pool: &str, measure: &str) -> Result<Option<f64>, String> {
        self.asked.push(format!("pool {id} {pool} {measure}"));
        Ok((id == "kara").then_some(3.0))
    }
    fn has_condition(&mut self, _id: &str, condition: &str) -> bool {
        condition == "hidden"
    }
    fn band_to(&mut self, _from: &str, _to: &str) -> Option<RangeBand> {
        Some(RangeBand::Close)
    }
    fn difficulty_of(&mut self, id: &str) -> Option<f64> {
        let hooks = self.hooks?;
        let gated = hooks.run("gate", &reads(json!({})), &mut Room { hooks: None, asked: Vec::new() });
        Some(if gated { 14.0 } else { 10.0 } + if id == "kara" { 1.0 } else { 0.0 })
    }
    fn select(&mut self, selector: &Value) -> Vec<String> {
        vec![selector["kind"].as_str().unwrap_or_default().to_string()]
    }
    fn flag(&mut self, name: &str) -> bool {
        name == "up"
    }
    fn variable(&mut self, name: &str) -> Value {
        json!(name.len())
    }
    fn count_alive(&mut self, faction: &str) -> f64 {
        faction.len() as f64
    }
    fn faction_of(&mut self, _id: &str) -> Option<Faction> {
        Some(Faction::Party)
    }
    fn tokens(&mut self, id: &str, ability: &str) -> f64 {
        (id.len() + ability.len()) as f64
    }
}

fn reads(args: Value) -> HookReads {
    HookReads { args, actor: Some("kara".into()), targets: vec!["rat".into()], hit: vec![], in_combat: true, bindings: TargetBindings::default() }
}

fn hooks_of(code: &[(&str, &str)], limits: Option<Limits>) -> QuickJsHooks {
    let code: Vec<CodeSource> = code.iter().map(|(id, source)| CodeSource { id: (*id).into(), name: (*id).into(), source: (*source).into() }).collect();
    let (hooks, issues) = match limits {
        None => QuickJsHooks::compile(&code),
        Some(limits) => QuickJsHooks::compile_with(&code, limits),
    };
    assert!(issues.is_empty(), "{issues:?}");
    hooks
}

fn effect(hooks: &QuickJsHooks, id: &str, rng: &mut Rng) -> hooks::Outcome {
    hooks.call(id, &reads(json!({ "n": 2 })), None, Some(rng), &mut Room { hooks: Some(hooks), asked: Vec::new() })
}

#[test]
fn a_hook_that_never_ends_is_stopped() {
    let hooks = hooks_of(&[("spin", "while (true) {}"), ("catch", "try { while (true) {} } catch (e) { ctx.log('escaped'); }")], None);
    let mut rng = Rng::new(Seed::Number(1.0));
    for id in ["spin", "catch"] {
        let out = effect(&hooks, id, &mut rng);
        assert!(!out.ok && out.message == TOO_LONG, "{id}: {out:?}");
    }
}

#[test]
fn a_hook_that_eats_memory_or_stack_is_stopped() {
    let hooks = hooks_of(&[("eat", "var a = []; for (;;) a.push('x'.repeat(1 << 16));"), ("deep", "function f(n) { return f(n + 1) + 1; } return f(0);")], Some(Limits { checks: 1_000_000, ..hooks::DEFAULT_LIMITS }));
    let mut rng = Rng::new(Seed::Number(1.0));
    let eat = effect(&hooks, "eat", &mut rng);
    assert!(!eat.ok, "{eat:?}");
    let deep = effect(&hooks, "deep", &mut rng);
    assert!(!deep.ok && deep.name.as_deref() == Some("RangeError"), "{deep:?}");
}

#[test]
fn a_hook_reaches_nothing_but_its_reads() {
    let body = "var found = [];
        try { require('fs'); } catch (e) { found.push(e.name); }
        try { Date.now(); } catch (e) { found.push(e.name); }
        try { Math.random(); } catch (e) { found.push(e.message); }
        found.push(typeof std, typeof os, typeof globalThis, typeof fetch, typeof Function, typeof print, typeof this);
        ctx.log(found.join('|'));";
    let hooks = hooks_of(&[("look", body)], None);
    let out = effect(&hooks, "look", &mut Rng::new(Seed::Number(1.0)));
    assert!(out.ok, "{out:?}");
    assert_eq!(
        out.queued[0]["text"],
        "TypeError|TypeError|Math.random is not available in a hook: roll off ctx.rng so replays stay in step|undefined|undefined|undefined|undefined|undefined|undefined|undefined"
    );
}

#[test]
fn a_hooks_dice_are_the_scenarios_stream() {
    let hooks = hooks_of(&[("roll", "ctx.log([ctx.rng.next(), ctx.rng.nextInt(7), ctx.rng.die(20), ctx.rng.dice(2, 6).join(','), ctx.rng.pick(['a', 'b', 'c'])].join(' ')); var f = ctx.rng.fork(); f.next();")], None);
    let mut rng = Rng::new(Seed::Text("stream"));
    let out = effect(&hooks, "roll", &mut rng);
    let mut expected = Rng::new(Seed::Text("stream"));
    let next = expected.next();
    let int = expected.next_int(7).unwrap();
    let die = expected.die(20).unwrap();
    let two = expected.dice(2, 6).unwrap();
    let pick = ["a", "b", "c"][expected.next_int(3).unwrap() as usize];
    expected.fork();
    let words = format!("{} {int} {die} {},{} {pick}", engine::js::number_to_string(next), two[0], two[1]);
    assert_eq!(out.queued[0]["text"], json!(words));
    assert_eq!(rng.save(), expected.save(), "the stream is left where the hook left it");
}

#[test]
fn a_read_that_reaches_a_hook_runs_it() {
    let hooks = hooks_of(&[("gate", "return ctx.flag('up');"), ("ask", "ctx.log(String(ctx.difficultyOf('kara')) + ' ' + ctx.pool('kara', 'stress') + ' ' + ctx.select({ kind: 'party' }) + ' ' + ctx.select({ kind: 'nothing' }))")], None);
    let out = effect(&hooks, "ask", &mut Rng::new(Seed::Number(1.0)));
    assert!(out.ok, "{out:?}");
    assert_eq!(out.queued[0]["text"], "15 3 party undefined");
}

#[test]
fn a_body_that_will_not_parse_is_an_issue_and_no_hook() {
    let code = [CodeSource { id: "bad".into(), name: "bad".into(), source: "return (".into() }, CodeSource { id: "good".into(), name: "good".into(), source: "return true;".into() }];
    let (hooks, issues) = QuickJsHooks::compile(&code);
    assert_eq!(issues.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["bad"]);
    assert!(!hooks.defined("bad") && hooks.defined("good"));
    assert!(hooks.run("good", &reads(json!({})), &mut Room { hooks: None, asked: Vec::new() }));
}
