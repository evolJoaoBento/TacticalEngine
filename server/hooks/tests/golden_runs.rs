//! The whole of it, with nothing taped: every run `server/fixtures/runner.json` holds, run again by the Rust
//! runner against the Rust world with the project's hooks compiled and run in QuickJS - the same prompts,
//! the same journal and the same dice after every step, and the world where the TypeScript's world was
//! once every step's changes (`world.json`) are laid over where it began.

#[macro_use]
#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::rng::Rng;
use engine::scene::interact::{use_interactable, UseResult};
use engine::script::hooks::CodeSource;
use engine::script::runner::{RunStatus, RunnerOptions, ScriptRunner};
use engine::script::world::{ScenarioState, SceneScriptWorld, WorldContent};
use hooks::QuickJsHooks;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::rc::Rc;
use support::*;

/// A step's changes laid over the scene and scenario as they stood: creatures one by one, the rest whole.
fn lay(standing: &mut Value, changed: &Value) {
    for (part, value) in changed.as_object().unwrap() {
        if part == "entities" {
            let entities = standing["entities"].as_object_mut().unwrap();
            for (id, entity) in value.as_object().unwrap() {
                if entity.is_null() {
                    entities.remove(id);
                } else {
                    entities.insert(id.clone(), entity.clone());
                }
            }
        } else {
            standing[part] = value.clone();
        }
    }
}

/// Each content's code compiled as the TypeScript's world compiled it: the project's own.
fn compiled(world_fixture: &Value) -> HashMap<String, (Rc<WorldContent>, Vec<String>, Rc<QuickJsHooks>)> {
    world_fixture["contents"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, spec)| {
            let (content, defined) = content_of(spec);
            let (hooks, issues) = QuickJsHooks::compile(&from::<Vec<CodeSource>>(&spec["code"]));
            assert!(issues.is_empty(), "{issues:?}");
            (key.clone(), (Rc::new(content), defined, Rc::new(hooks)))
        })
        .collect()
}

#[test]
fn every_script_runs_with_its_hooks_as_the_browser_ran_it() {
    let runner_fixture = fixture("runner.json");
    let world_fixture = fixture("world.json");
    let contents = compiled(&world_fixture);
    let (mut steps_replayed, mut hook_runs) = (0, 0);
    for (run, played) in runner_fixture["runs"].as_array().unwrap().iter().zip(world_fixture["runs"].as_array().unwrap()) {
        let seed = run["seed"].as_str().unwrap();
        let at = format!("{} ({seed})", run["source"]);
        let start = &world_fixture["starts"][played["start"].as_str().unwrap()];
        let grid = &world_fixture["grids"][played["grid"].as_str().unwrap()];
        let (content, defined, hooks) = &contents[played["content"].as_str().unwrap()];
        for id in defined {
            assert!(engine::script::hooks::Hooks::defined(&**hooks, id), "{at}: the project's code defines {id}");
        }
        hook_runs += played["hooks"].as_array().unwrap().iter().map(|h| h.as_array().unwrap().len()).sum::<usize>();
        let mut scenario = ScenarioState::default();
        scenario.restore(&start["scenario"]).expect("a scenario");
        let mut world = SceneScriptWorld::new(scene_of(grid, start), scenario, content.clone(), hooks.clone());
        let spotlit: Vec<String> = from(&start["spotlit"]);
        world.spotlight_spent = Box::new(move |id| spotlit.iter().any(|s| s == id));
        let mut expected = standing(&world);
        for changed in played["changed"].as_array().unwrap() {
            lay(&mut expected, changed);
        }

        let effects: Vec<Value> = from(&run["effects"]);
        let options: RunnerOptions = from(&run["options"]);
        let mut rng = Rng::new(engine::rng::Seed::Text(&format!("{seed}:dice")));
        {
            let mut runner = ScriptRunner::new(&mut world, &mut rng, &options);
            let mut status = RunStatus::Done;
            let mut seen = 0;
            for (i, taped) in run["steps"].as_array().unwrap().iter().enumerate() {
                let at = format!("{at} step {i}: {}", taped["move"]);
                let mv = &taped["move"];
                if mv["act"] == "run" {
                    status = runner.run(&effects);
                } else {
                    match runner.resume(&mv["response"]) {
                        Ok(next) => status = next,
                        Err(_) => assert_eq!(mv["threw"], true, "{at}: we refused to resume, the TypeScript did not"),
                    }
                }
                check!(status_json(&status, runner.entries(), seen), &taped["status"], "{at}");
                assert_eq!(json!(runner.stream()), taped["after"], "{at}: the dice stream");
                seen = runner.entries().len();
                steps_replayed += 1;
            }
        }
        check!(standing(&world), &expected, "{at}: the world after");
        check!(to(&world.drain_damage()), &played["end"]["damaged"], "{at}: the blows waiting to be heard");
        check!(to(&world.drain_entered()), &played["end"]["entered"], "{at}: the crossings waiting to be heard");
    }
    assert!(steps_replayed > 1100, "{steps_replayed}");
    assert!(hook_runs > 0, "some run ran a hook");
}

#[test]
fn every_thing_is_used_as_the_browser_used_it() {
    let world_fixture = fixture("world.json");
    let contents = compiled(&world_fixture);
    let (mut ran, mut resumed) = (0, 0);
    for used in world_fixture["uses"].as_array().unwrap() {
        let thing = &used["thing"];
        let seed = used["seed"].as_str().unwrap();
        let at = format!("using {} ({seed})", thing["id"]);
        let start = &world_fixture["starts"][used["start"].as_str().unwrap()];
        let grid = &world_fixture["grids"][used["grid"].as_str().unwrap()];
        let (content, _, hooks) = &contents[used["content"].as_str().unwrap()];
        let mut scenario = ScenarioState::default();
        scenario.restore(&start["scenario"]).expect("a scenario");
        let mut world = SceneScriptWorld::new(scene_of(grid, start), scenario, content.clone(), hooks.clone());
        let spotlit: Vec<String> = from(&start["spotlit"]);
        world.spotlight_spent = Box::new(move |id| spotlit.iter().any(|s| s == id));
        let mut rng = Rng::new(engine::rng::Seed::Text(&format!("{seed}:dice")));
        for (n, act) in used["acts"].as_array().unwrap().iter().enumerate() {
            let at = format!("{at}, use {n}");
            let (mut status, mut runner) = match use_interactable(thing, &mut world, &mut rng, thing["repeatable"] == true) {
                UseResult::Refused(refused) => {
                    check!(json!({ "status": "refused", "reason": refused.reason, "text": refused.text }), &act["use"], "{at}");
                    assert_eq!(json!(rng.save()), act["after"], "{at}: the dice stream");
                    continue;
                }
                UseResult::Waiting(prompt, runner) => (RunStatus::Waiting(prompt), runner),
                UseResult::Done(runner) => (RunStatus::Done, runner),
            };
            ran += 1;
            check!(status_json(&status, runner.entries(), 0), &act["use"], "{at}");
            assert_eq!(json!(runner.stream()), act["after"], "{at}: the dice stream");
            let mut seen = runner.entries().len();
            for (r, resume) in act["resumes"].as_array().unwrap().iter().enumerate() {
                status = runner.resume(&resume["response"]).unwrap_or_else(|e| panic!("{at}, answer {r}: {e}"));
                check!(status_json(&status, runner.entries(), seen), &resume["status"], "{at}, answer {r}");
                assert_eq!(json!(runner.stream()), resume["after"], "{at}, answer {r}: the dice stream");
                seen = runner.entries().len();
                resumed += 1;
            }
        }
        check!(standing(&world), &used["after"], "{at}: the world after");
    }
    assert!(ran > 30 && resumed > 30, "{ran} {resumed}");
}
