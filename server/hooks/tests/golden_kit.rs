//! `server/fixtures/kit.json` replayed: what the TypeScript's party bought and sold, put on and took off, used
//! from its pack, recalled from the vault and rested - the shops, the binder's cards, the loadout and what a
//! stat block prints as they stood - with the fight going on around it, played again by a Rust session with
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
    let sheets: Vec<Value> = session.sheets.entries().iter().map(|(id, s)| json!([id, s.loadout, s.primary_weapon_id, s.secondary_weapon_id, s.armor_id])).collect();
    let seen = json!({
        "scene": session.scene["id"],
        "fight": fight,
        "pending": pending,
        "selected": session.party.selected(),
        "bad": to(&state.bad),
        "entities": entities,
        "sheets": sheets,
        "log": to(&session.log[since..].to_vec()),
        "floaters": to(&session.floaters),
        "motions": session.motions,
        "rolls": to(&session.rolls),
        "things": state.snapshot()["interactables"],
        "scenario": session.world.scenario.snapshot(),
    });
    session.floaters.clear();
    session.motions.clear();
    session.rolls.clear();
    seen
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().map_or(Vec::new(), |list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
}

/// `{ ok: true, <key>: value }` or `{ ok: false, reason }`, as the TypeScript answers.
fn ok_or<T: serde::Serialize>(result: Result<T, String>, key: &str) -> Value {
    match result {
        Ok(value) => json!({ "ok": true, key: value }),
        Err(reason) => json!({ "ok": false, "reason": reason }),
    }
}

#[test]
fn the_party_is_kitted_out_as_the_browser_kitted_it() {
    let fixture = fixture("kit.json");
    let shipped: Rc<Shipped> = Rc::new(from(&fixture["shipped"]));
    let projects = fixture["projects"].as_array().unwrap();
    let (mut steps, mut done) = (0, 0);
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
            let result = match step["step"].as_str().unwrap() {
                "give" => {
                    session.world.add_item(item, step["count"].as_f64().unwrap());
                    Value::Null
                }
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
                "take" => json!(session.take_from_container(id, item).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "sell" => json!(session.sell_to(id, item)),
                "equip" => ok_or(session.equip_item(id, item), "slot"),
                "unequip" => ok_or(session.unequip_item(id, step["slot"].as_str().unwrap()), "slot"),
                "gear" => json!({ "view": session.gear_view(id), "of": session.gear_of(id) }),
                "card" => session.gear_card(item).unwrap_or(Value::Null),
                "useItem" => {
                    done += 1;
                    to(&session.use_item(item).unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "loadout" => session.loadout_view(id),
                "swap" => {
                    let out = step["cardOut"].as_str();
                    ok_or(session.swap_card(id, step["cardIn"].as_str().unwrap(), out, step["resting"] == true), "stress")
                }
                "rest" => {
                    done += 1;
                    ok_or(session.rest(step["kind"] == "long", &step["plan"]), "badGained")
                }
                "statBlock" => json!(session.stat_block_cards(id)),
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
                    to(&session.use_ability(id, step["ability"].as_str().unwrap(), &strings(&step["targets"]), None).unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "fight" => {
                    session.start_encounter(id);
                    Value::Null
                }
                "attack" => to(&session.attack_with_selected(id).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "endTurn" => json!(session.end_turn().unwrap_or_else(|e| panic!("{at}: {e}"))),
                "move" => {
                    let destination = step["destination"].as_i64().map_or(NO_TILE, |t| t as i32);
                    to(&session.move_selected_to(destination, None).unwrap_or_else(|e| panic!("{at}: {e}")))
                }
                "answer" => to(&session.answer_pending(&step["response"]).unwrap_or_else(|e| panic!("{at}: {e}"))),
                "select" => {
                    let next = session.party.select_next(&session.world.state);
                    json!({ "selected": next, "moved": session.sync_talks() })
                }
                other => panic!("{at}: a step nobody knows: {other}"),
            };
            held!(result, &step["result"], "{at}");
            held!(view(&mut session, since), &step["after"], "{at}: after");
            steps += 1;
        }
    }
    assert!(steps > 700 && done > 100, "{steps} {done}");
}
