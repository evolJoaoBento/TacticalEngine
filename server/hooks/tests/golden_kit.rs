//! `server/fixtures/kit.json` replayed: what the TypeScript's party bought and sold, put on and took off, used
//! from its pack, recalled from the vault, rested and levelled, the campaign saved and loaded between rooms -
//! the shops, the binder's cards, the loadout, what a stat block prints and the saves as they stood - with the fight going on around it, played again by a Rust session with
//! the project's hooks compiled in QuickJS, step for step.

#[path = "../../engine/tests/support/world.rs"]
mod support;

use engine::game::content::Shipped;
use engine::game::session::{HooksFor, Session};
use engine::grid::tile_grid::NO_TILE;
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use hooks::QuickJsHooks;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;
use support::{fixture, from, same, to};

/// Hooks as the page keeps them: nothing for a project with no code, else compiled once per what it says.
fn hooks_for() -> HooksFor {
    let last: RefCell<Option<(String, Rc<dyn Hooks>)>> = RefCell::new(None);
    Rc::new(move |code: &[CodeSource]| -> Rc<dyn Hooks> {
        if code.is_empty() {
            return Rc::new(NoHooks);
        }
        let signature = code.iter().map(|c| format!("{}\u{0}{}", c.id, c.source)).collect::<Vec<_>>().join("\u{1}");
        if let Some((seen, hooks)) = last.borrow().as_ref() {
            if *seen == signature {
                return Rc::clone(hooks);
            }
        }
        let (hooks, _) = QuickJsHooks::compile(code);
        let hooks: Rc<dyn Hooks> = Rc::new(hooks);
        *last.borrow_mut() = Some((signature, Rc::clone(&hooks)));
        hooks
    })
}

/// Where two answers first part: the path to it, and each side there.
fn first_difference(a: &Value, b: &Value, at: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for key in x.keys().chain(y.keys()) {
                let (p, q) = (x.get(key).unwrap_or(&Value::Null), y.get(key).unwrap_or(&Value::Null));
                if let Some(found) = first_difference(p, q, &format!("{at}.{key}")) {
                    return Some(found);
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x.iter().zip(y).enumerate().find_map(|(i, (p, q))| first_difference(p, q, &format!("{at}[{i}]"))),
        _ if same(a, b) => None,
        _ => Some(format!("{at}: rust {a} / typescript {b}")),
    }
}

macro_rules! held {
    ($got:expr, $wanted:expr, $($what:tt)*) => {{
        let (got, wanted): (Value, &Value) = ($got, $wanted);
        if let Some(found) = first_difference(&got, wanted, "") {
            panic!("{}: {}", format!($($what)*), found);
        }
    }};
}

/// What happened, and then the view's queues drained.
fn view(session: &mut Session, since: usize) -> Value {
    let state = session.state();
    let fight = session.encounter.as_ref().map_or(Value::Null, |e| {
        let circles: Vec<Value> = e.circles().iter().map(|(id, c)| json!([id, c.anchor, c.band])).collect();
        json!({ "id": e.encounter_id, "view": to(&e.view(state)), "log": to(&e.log()), "circles": circles })
    });
    let pending = match (&session.pending, &session.asked) {
        (Some(p), _) => json!({ "prompt": p.prompt, "dialogue": p.dialogue.as_ref().map(|d| d.runner.id().to_string()) }),
        (None, Some(asked)) => json!({ "kind": asked.kind(), "prompt": asked.prompt() }),
        (None, None) => Value::Null,
    };
    let entities: Vec<Value> = state
        .all_entities()
        .iter()
        .map(|e| json!([e.id, e.faction, e.tile, e.at.x, e.at.y, e.alive, e.dead, e.hit_points, e.stress, e.armor_slots, e.good, e.conditions, e.truce]))
        .collect();
    let sheets: Vec<Value> = session.sheets.entries().iter().map(|(id, s)| json!([id, s.loadout, s.primary_weapon_id, s.secondary_weapon_id, s.armor_id, s.level, s.domain_cards, s.levels])).collect();
    let seen = json!({
        "scene": session.scene["id"],
        "fight": fight,
        "pending": pending,
        "selected": session.party.selected(),
        "bad": to(&state.bad),
        "entities": entities,
        "sheets": sheets,
        // A load puts back a shorter log than the one it replaced.
        "log": to(&session.log[since.min(session.log.len())..].to_vec()),
        "floaters": to(&session.floaters),
        "motions": session.motions,
        "rolls": to(&session.rolls),
        "things": state.snapshot()["interactables"],
        "scenario": session.world.scenario.snapshot(),
        "rng": session.rng.save(),
        "left": session.snapshots.entries().iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(),
        "party": session.project["party"].as_array().map_or(Vec::new(), |party| party.iter().map(|s| s["id"].clone()).collect()),
    });
    session.floaters.clear();
    session.motions.clear();
    session.rolls.clear();
    seen
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().map_or(Vec::new(), |list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
}

/// An intent by the page's name for it, given through the dispatcher.
fn call(session: &mut Session, at: &str, name: &str, args: Value) -> Value {
    session.dispatch(name, args.as_array().unwrap()).unwrap_or_else(|e| panic!("{at}: {name}: {e}"))
}

#[test]
fn the_party_is_kitted_out_as_the_browser_kitted_it() {
    let fixture = fixture("kit.json");
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let projects = fixture["projects"].as_array().unwrap();
    let (mut steps, mut done, mut saves) = (0, 0, 0);
    for played in fixture["sessions"].as_array().unwrap() {
        let name = played["name"].as_str().unwrap();
        let project = &projects[played["project"].as_u64().unwrap() as usize];
        let mut session = Session::build(project, Rc::clone(&shipped), hooks_for(), &format!("kit:{name}")).expect("a game");
        held!(view(&mut session, 0), &played["start"], "{name}: stood up");
        for (n, step) in played["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, step {n}: {}", step["step"]);
            let since = session.log.len();
            let id = step["id"].as_str().unwrap_or_default();
            let item = step["item"].as_str().unwrap_or_default();
            // Every intent the page names goes through the dispatcher, as the page's engine and the server's give it
            // (`game/dispatch.rs`): its argument reading and its answers held to the TypeScript's here too.
            let result = match step["step"].as_str().unwrap() {
                "give" => call(&mut session, &at, "giveItem", json!([item, step["count"]])),
                "shop" => {
                    let shop = session.shop_of(id).expect("a shop");
                    let offers: Vec<Value> = strings(&step["items"]).iter().map(|i| json!(session.offer_for(&shop, i))).collect();
                    let container: Vec<Value> = session.container_contents(id).expect("a shop").into_iter().map(|(i, name, count)| json!([i, name, count])).collect();
                    json!({
                        "contents": session.shop_contents(id),
                        "sellables": session.sellables(id),
                        "purse": session.purse(&shop),
                        "offers": offers,
                        "container": container,
                    })
                }
                "buy" => json!(session.buy_from(id, item)),
                "take" => call(&mut session, &at, "takeFromContainer", json!([id, item])),
                "sell" => json!(session.sell_to(id, item)),
                "equip" => call(&mut session, &at, "equipItem", json!([id, item])),
                "unequip" => call(&mut session, &at, "unequipItem", json!([id, step["slot"]])),
                "gear" => json!({ "view": session.gear_view(id), "of": session.gear_of(id) }),
                "card" => session.gear_card(item).unwrap_or(Value::Null),
                "useItem" => {
                    done += 1;
                    call(&mut session, &at, "useItem", json!([item]))
                }
                "loadout" => session.loadout_view(id),
                "swap" => call(&mut session, &at, "swapCard", json!([id, step["cardIn"], step["cardOut"], { "resting": step["resting"] }])),
                "rest" => {
                    done += 1;
                    call(&mut session, &at, "rest", json!([step["kind"], step["plan"]]))
                }
                "statBlock" => json!(session.stat_block_cards(id)),
                "grant" => {
                    session.world.scenario.party_level = session.world.scenario.party_level.max(step["level"].as_f64().unwrap());
                    Value::Null
                }
                "awaiting" => json!(session.awaiting_level()),
                "travel" => call(&mut session, &at, "travelTo", json!([id])),
                "save" => {
                    saves += 1;
                    json!({ "blocked": session.save_blocked_by(), "save": session.save_game(), "text": session.serialise_save() })
                }
                "load" => match step["text"].as_str() {
                    Some(text) => call(&mut session, &at, "loadGameText", json!([text])),
                    // A save as it stands is no intent the page gives: loaded as the TypeScript's `loadGame` is.
                    None => match session.load_game(&step["save"]) {
                        Ok(()) => json!({ "ok": true }),
                        Err(reason) => json!({ "ok": false, "reason": reason }),
                    },
                },
                "levelUp" => call(&mut session, &at, "applyLevelUp", json!([id, step["plan"]])),
                "fell" => {
                    let body = session.world.state.entity_mut(id).expect("a member");
                    body.hit_points.marked = body.hit_points.max;
                    body.alive = false;
                    Value::Null
                }
                "hurt" => {
                    let body = session.world.state.entity_mut(id).expect("a member");
                    let (hp, stress, armor) = (step["hp"].as_f64().unwrap(), step["stress"].as_f64().unwrap(), step["armor"].as_f64().unwrap());
                    body.hit_points.marked = (body.hit_points.max - 1.0).min(body.hit_points.marked + hp);
                    body.stress.marked = body.stress.max.min(body.stress.marked + stress);
                    body.armor_slots.marked = body.armor_slots.max.min(body.armor_slots.marked + armor);
                    Value::Null
                }
                "use" => {
                    session.ability_list(id);
                    call(&mut session, &at, "useAbility", json!([id, step["ability"], step["targets"]]))
                }
                "fight" => call(&mut session, &at, "startEncounter", json!([id])),
                "attack" => call(&mut session, &at, "attackWithSelected", json!([id])),
                "endTurn" => call(&mut session, &at, "endTurn", json!([])),
                "move" => call(&mut session, &at, "moveSelectedTo", json!([step["destination"].as_i64().unwrap_or(NO_TILE as i64)])),
                "answer" => call(&mut session, &at, "answerPending", json!([step["response"]])),
                "select" => {
                    let next = call(&mut session, &at, "selectNext", json!([]));
                    json!({ "selected": next, "moved": call(&mut session, &at, "syncTalks", json!([])) })
                }
                other => panic!("{at}: a step nobody knows: {other}"),
            };
            // A save's text is held as what it says, not byte for byte: the TypeScript keeps the key order a
            // loaded save's schema read its rooms in, which a room of structs does not remember. What the
            // text must not do is write a whole number as JavaScript never would.
            let mut result = result;
            if let Some(text) = result["text"].as_str().filter(|_| step["step"] == "save").map(str::to_string) {
                let whole_as_float = text.as_bytes().windows(3).any(|w| w[0] == b'.' && w[1] == b'0' && matches!(w[2], b',' | b'}' | b']'));
                assert!(!whole_as_float, "{at}: a whole number written with .0");
                result["text"] = serde_json::from_str(&text).expect("a save reads");
            }
            let mut wanted = step["result"].clone();
            if let Some(text) = wanted["text"].as_str().filter(|_| step["step"] == "save").map(str::to_string) {
                wanted["text"] = serde_json::from_str(&text).expect("a save reads");
            }
            held!(result, &wanted, "{at}");
            held!(view(&mut session, since), &step["after"], "{at}: after");
            steps += 1;
        }
    }
    assert!(steps > 700 && done > 100 && saves > 40, "{steps} {done} {saves}");
}
