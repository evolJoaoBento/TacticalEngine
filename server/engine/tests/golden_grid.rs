//! `server/fixtures/grid.json` replayed: each grid rebuilt from its spec, and every answer
//! `src/engine/grid` gave about it - per tile, sight and cover for every pair, reachability and paths
//! under five rules and five contexts, and the walk - given again here, to the last bit.

use engine::grid::los::{cover_between, line_of_sight, trace_line, LineOfSightRules};
use engine::grid::pathfinding::{trace_path, MovementContext, MovementRules, Pathfinder};
use engine::grid::terrain::{TerrainPalette, TerrainType};
use engine::grid::walk::{
    can_stand_at, distance_inside, distance_within, inside_circle, line_cost, line_length, nearest_on_line, point_along, segment_clear, settle_end, smooth_path, split_line,
    Circle, WalkRules,
};
use engine::grid::{Spot, TileGrid};
use engine::rules::cover::Cover;
use serde_json::Value;
use std::collections::HashMap;

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/grid.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("written by src/engine/grid/grid.golden.test.ts")).expect("JSON")
}

/// A number as the fixture keeps it: null is Infinity.
fn num(value: &Value) -> f64 {
    if value.is_null() {
        f64::INFINITY
    } else {
        value.as_f64().expect("a number")
    }
}

fn int(value: &Value) -> i32 {
    value.as_i64().expect("an integer") as i32
}

fn spot(value: &Value) -> Spot {
    Spot { x: num(&value["x"]), y: num(&value["y"]) }
}

fn spots(value: &Value) -> Vec<Spot> {
    value.as_array().expect("spots").iter().map(spot).collect()
}

fn tiles(value: &Value) -> Vec<i32> {
    value.as_array().expect("tiles").iter().map(int).collect()
}

fn assert_spot(got: Spot, wanted: &Value, what: &str) {
    let wanted = spot(wanted);
    assert!(got.x == wanted.x && got.y == wanted.y, "{what}: {got:?}, the TypeScript {wanted:?}");
}

fn assert_spots(got: &[Spot], wanted: &Value, what: &str) {
    let wanted = spots(wanted);
    assert_eq!(got.len(), wanted.len(), "{what}: {got:?}, the TypeScript {wanted:?}");
    for (g, w) in got.iter().zip(&wanted) {
        assert!(g.x == w.x && g.y == w.y, "{what}: {got:?}, the TypeScript {wanted:?}");
    }
}

fn grid_of(spec: &Value) -> TileGrid {
    let types = spec["palette"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| TerrainType {
            passable: t["passable"].as_bool().unwrap(),
            cost: num(&t["cost"]),
            provides_cover: t["providesCover"].as_bool().unwrap(),
            blocks_sight: t["blocksSight"].as_bool().unwrap(),
            ..TerrainType::new(t["id"].as_str().unwrap())
        })
        .collect();
    let mut grid = TileGrid::new(int(&spec["width"]), int(&spec["height"]), TerrainPalette::new(types).expect("a palette"));
    let each = |key: &str| spec[key].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect::<Vec<_>>();
    grid.heights = each("heights").iter().map(|&h| h as i16).collect();
    grid.terrain = each("terrain").iter().map(|&t| t as u8).collect();
    grid.overlay = each("overlay").iter().map(|&o| o as i16).collect();
    grid.lift = each("lift").iter().map(|&l| l as f32).collect();
    grid.barred = each("barred").iter().map(|&b| b as u8).collect();
    grid
}

#[test]
fn the_default_palette_is_the_same_kinds_in_the_same_order() {
    let ids: Vec<String> = TerrainPalette::default_palette().types.iter().map(|t| t.id.clone()).collect();
    let wanted: Vec<String> = fixture()["defaultPalette"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
    // The TypeScript lists the kinds it declares; the palette appends nothing at all.
    assert_eq!(&ids[..wanted.len()], &wanted[..]);
    assert_eq!(ids.last().map(String::as_str), Some("void"));
}

#[test]
fn every_tile_answers_alike() {
    for g in fixture()["grids"].as_array().unwrap() {
        let name = g["name"].as_str().unwrap();
        let grid = grid_of(&g["spec"]);
        let b = &g["basics"];
        for i in 0..grid.size() {
            let at = i as usize;
            assert_eq!(grid.cost_at(i), num(&b["costAt"][at]), "{name} cost at {i}");
            assert_eq!(grid.is_passable(i), b["isPassable"][at], "{name} passable at {i}");
            assert_eq!(grid.blocks_sight(i), b["blocksSight"][at], "{name} sight at {i}");
            assert_eq!(grid.provides_cover(i), b["providesCover"][at], "{name} cover at {i}");
            assert_eq!(grid.stand_at(i), num(&b["standAt"][at]), "{name} stand at {i}");
            let mut plain = Vec::new();
            grid.for_each_neighbor(i, false, |n| plain.push(n));
            assert_eq!(plain, tiles(&b["neighbours"][at]), "{name} neighbours of {i}");
            let mut all = Vec::new();
            grid.for_each_neighbor(i, true, |n| all.push(n));
            assert_eq!(all, tiles(&b["neighboursDiagonal"][at]), "{name} diagonal neighbours of {i}");
        }
        for off in b["offTheGrid"].as_array().unwrap() {
            let i = int(&off["i"]);
            assert_eq!((grid.is_passable(i), grid.blocks_sight(i), grid.provides_cover(i)), (off["passable"] == true, off["sight"] == true, off["cover"] == true), "{name} off the grid at {i}");
            assert_spot(grid.spot_of(i), &off["spot"], &format!("{name} spot of {i}"));
        }
        for d in b["distances"].as_array().unwrap() {
            let (a, c) = (int(&d["a"]), int(&d["b"]));
            assert_eq!(grid.manhattan_distance(a, c), int(&d["manhattan"]), "{name} manhattan {a} {c}");
            assert_eq!(grid.chebyshev_distance(a, c), int(&d["chebyshev"]), "{name} chebyshev {a} {c}");
            assert_eq!(grid.euclidean_distance(a, c), num(&d["euclidean"]), "{name} euclidean {a} {c}");
            assert_eq!(grid.is_diagonal_step(a, c), d["diagonal"] == true, "{name} diagonal {a} {c}");
        }
        for s in b["tileAtSpot"].as_array().unwrap() {
            assert_eq!(grid.tile_at_spot(num(&s[0]), num(&s[1])), int(&s[2]), "{name} tile at {s}");
        }
    }
}

#[test]
fn sight_and_cover_are_alike_for_every_pair() {
    for g in fixture()["grids"].as_array().unwrap() {
        let name = g["name"].as_str().unwrap();
        let grid = grid_of(&g["spec"]);
        let sight = &g["sight"];
        let results = sight["results"].as_array().unwrap();
        let mut row = 0;
        for rules in sight["rules"].as_array().unwrap() {
            let rules = LineOfSightRules { blocking_height_margin: num(&rules["blockingHeightMargin"]) };
            for a in 0..grid.size() {
                for b in 0..grid.size() {
                    let seen = line_of_sight(&grid, a, b, rules);
                    let cover = cover_between(&grid, a, b, rules) == Cover::Cover;
                    let wanted = &results[row];
                    assert_eq!(
                        (seen.clear, seen.partial, seen.first_blocker, cover),
                        (wanted[0] == 1, wanted[1] == 1, int(&wanted[2]), wanted[3] == 1),
                        "{name} sight {a} to {b}, margin {}",
                        rules.blocking_height_margin
                    );
                    row += 1;
                }
            }
        }
        assert_eq!(row, results.len());
        for trace in sight["traces"].as_array().unwrap() {
            let mut visited = Vec::new();
            trace_line(&grid, int(&trace["a"]), int(&trace["b"]), |tile, corner| {
                visited.push((tile, corner));
                true
            });
            let wanted: Vec<(i32, bool)> = trace["visited"].as_array().unwrap().iter().map(|v| (int(&v[0]), v[1] == true)).collect();
            assert_eq!(visited, wanted, "{name} trace {}", trace);
        }
    }
}

fn movement_rules(value: &Value) -> MovementRules {
    MovementRules {
        diagonals: value["diagonals"] == true,
        max_step_height: num(&value["maxStepHeight"]),
        allow_corner_cutting: value["allowCornerCutting"] == true,
        diagonal_cost_multiplier: num(&value["diagonalCostMultiplier"]),
    }
}

/// A context as the fixture keeps it: the tiles held, the surcharges, the disc.
struct ContextData {
    blocked: Option<Vec<i32>>,
    extra: Option<HashMap<i32, f64>>,
    max_span: Option<f64>,
}

fn context_data(value: &Value) -> ContextData {
    ContextData {
        blocked: value.get("blocked").map(tiles),
        extra: value.get("extra").map(|e| e.as_object().unwrap().iter().map(|(k, v)| (k.parse().unwrap(), num(v))).collect()),
        max_span: value.get("maxSpan").map(num),
    }
}

fn optional_path(value: &Value) -> Option<Vec<i32>> {
    if value.is_null() {
        None
    } else {
        Some(tiles(value))
    }
}

#[test]
fn reachability_and_paths_are_alike() {
    for g in fixture()["grids"].as_array().unwrap() {
        let name = g["name"].as_str().unwrap();
        let grid = grid_of(&g["spec"]);
        let finder = Pathfinder::new(&grid);
        let p = &g["paths"];
        let rules: Vec<MovementRules> = p["rules"].as_array().unwrap().iter().map(movement_rules).collect();
        let contexts: Vec<ContextData> = p["contexts"].as_array().unwrap().iter().map(context_data).collect();
        let with_context = |c: usize, run: &mut dyn FnMut(&MovementContext)| {
            let data = &contexts[c];
            let blocked = |tile: i32| data.blocked.as_ref().is_some_and(|b| b.contains(&tile));
            let extra = |tile: i32| data.extra.as_ref().and_then(|e| e.get(&tile).copied()).unwrap_or(0.0);
            let context = MovementContext {
                is_blocked: data.blocked.as_ref().map(|_| &blocked as &dyn Fn(i32) -> bool),
                extra_cost: data.extra.as_ref().map(|_| &extra as &dyn Fn(i32) -> f64),
                max_span: data.max_span,
            };
            run(&context);
        };
        for field in p["fields"].as_array().unwrap() {
            let (r, c, start, budget) = (field["rules"].as_u64().unwrap() as usize, field["context"].as_u64().unwrap() as usize, int(&field["start"]), num(&field["budget"]));
            let what = format!("{name} field rules {r} context {c} from {start} budget {budget}");
            with_context(c, &mut |context| {
                let reached = finder.reachable(start, budget, &rules[r], context);
                for t in 0..grid.size() {
                    assert_eq!(reached.cost_to(t), num(&field["cost"][t as usize]), "{what}: cost to {t}");
                    assert_eq!(reached.came_from(t), int(&field["cameFrom"][t as usize]), "{what}: came from, to {t}");
                    assert_eq!(trace_path(&reached, t), optional_path(&field["traced"][t as usize]), "{what}: traced to {t}");
                }
                assert_eq!(reached.tiles(), tiles(&field["reach"]), "{what}: the tiles");
                for pair in field["adjacent"].as_array().unwrap() {
                    assert_eq!(finder.nearest_reachable_adjacent_to(&reached, int(&pair[0]), &rules[r]), int(&pair[1]), "{what}: beside {}", pair[0]);
                }
            });
        }
        for route in p["routes"].as_array().unwrap() {
            let (r, c, start) = (route["rules"].as_u64().unwrap() as usize, route["context"].as_u64().unwrap() as usize, int(&route["start"]));
            with_context(c, &mut |context| {
                for (goal, wanted) in route["paths"].as_array().unwrap().iter().enumerate() {
                    assert_eq!(finder.find_path(start, goal as i32, &rules[r], context), optional_path(wanted), "{name} path rules {r} context {c} from {start} to {goal}");
                }
            });
        }
    }
}

fn walk_rules(value: &Value) -> WalkRules {
    WalkRules { radius: num(&value["radius"]), max_step_height: num(&value["maxStepHeight"]) }
}

#[test]
fn the_walk_is_alike() {
    for g in fixture()["grids"].as_array().unwrap() {
        let name = g["name"].as_str().unwrap();
        let grid = grid_of(&g["spec"]);
        let w = &g["walks"];
        let rules: Vec<WalkRules> = w["walkRules"].as_array().unwrap().iter().map(walk_rules).collect();
        let held = tiles(&w["blocked"]);
        let blocked = |tile: i32| held.contains(&tile);
        let nothing = |_: i32| false;
        let lattice = spots(&w["lattice"]);
        for (r, rule) in rules.iter().enumerate() {
            for (s, at) in lattice.iter().enumerate() {
                let wanted = &w["stand"][r][s];
                assert_eq!((can_stand_at(&grid, *at, &nothing, *rule), can_stand_at(&grid, *at, &blocked, *rule)), (wanted[0] == 1, wanted[1] == 1), "{name} stand at {at:?}, rules {r}");
            }
        }
        for segment in w["segments"].as_array().unwrap() {
            let (from, to) = (spot(&segment["from"]), spot(&segment["to"]));
            for (r, rule) in rules.iter().enumerate() {
                let wanted = &segment["clear"][r];
                assert_eq!(
                    (segment_clear(&grid, from, to, &nothing, *rule), segment_clear(&grid, from, to, &blocked, *rule)),
                    (wanted[0] == true, wanted[1] == true),
                    "{name} segment {from:?} to {to:?}, rules {r}"
                );
            }
        }
        for settle in w["settles"].as_array().unwrap() {
            let (last, aimed, others) = (int(&settle["last"]), spot(&settle["aimed"]), spots(&settle["others"]));
            for (r, rule) in rules.iter().enumerate() {
                assert_spot(settle_end(&grid, last, aimed, &blocked, &others, *rule), &settle["settled"][r], &format!("{name} settle at {last} aimed {aimed:?}, rules {r}"));
            }
        }
        for case in w["smooth"].as_array().unwrap() {
            let path = tiles(&case["path"]);
            let (start, end) = (case["ends"].get("start").map(spot), case["ends"].get("end").map(spot));
            let what = format!("{name} line along {path:?}");
            let lines: Vec<Vec<Spot>> = rules.iter().map(|rule| smooth_path(&grid, &path, &blocked, *rule, start, end)).collect();
            for (r, line) in lines.iter().enumerate() {
                assert_spots(line, &case["lines"][r], &format!("{what}, rules {r}"));
            }
            let line = &lines[0];
            let probe = spot(&case["probe"]);
            assert_spot(nearest_on_line(line, probe), &case["nearest"], &format!("{what}: nearest"));
            for (i, d) in [-1.0, 0.0, 0.3, 1.0, 2.5, 7.0, 100.0].iter().enumerate() {
                assert_spot(point_along(line, *d), &case["along"][i], &format!("{what}: along {d}"));
            }
            assert_eq!(line_length(line), num(&case["length"]), "{what}: length");
            assert_eq!(line_cost(&grid, line), num(&case["cost"]), "{what}: cost");
            for (i, a) in [0.0, 0.5, 1.0, 2.0, 3.75, 10.0, 1000.0].iter().enumerate() {
                assert_eq!(distance_within(&grid, line, *a), num(&case["within"][i]), "{what}: within {a}");
            }
            for (i, radius) in [0.5, 1.5, 3.0, 10.0].iter().enumerate() {
                assert_eq!(distance_inside(line, Circle { anchor: line[0], radius: *radius }), num(&case["inside"][i]), "{what}: inside {radius}");
            }
            let elsewhere = Circle { anchor: Spot { x: line[0].x + 1.0, y: line[0].y }, radius: 1.2 };
            assert_eq!(distance_inside(line, elsewhere), num(&case["insideElsewhere"]), "{what}: inside elsewhere");
            for (i, d) in [-1.0, 0.0, 0.75, 2.0, 100.0].iter().enumerate() {
                let (within, beyond) = split_line(line, *d);
                assert_spots(&within, &case["split"][i]["within"], &format!("{what}: split at {d}, within"));
                assert_spots(&beyond, &case["split"][i]["beyond"], &format!("{what}: split at {d}, beyond"));
            }
            for (i, r) in [0.5, 1.0, 2.0].iter().enumerate() {
                assert_eq!(inside_circle(probe, Circle { anchor: line[0], radius: *r }), case["inCircle"][i] == true, "{what}: probe in circle {r}");
            }
        }
    }
}

#[test]
fn empty_lines_are_alike() {
    let empty = &fixture()["emptyLines"];
    assert_spot(nearest_on_line(&[], Spot { x: 1.0, y: 2.0 }), &empty["nearest"], "nearest on nothing");
    assert_spot(point_along(&[], 3.0), &empty["along"], "along nothing");
    assert_eq!(line_length(&[]), num(&empty["length"]));
    assert_eq!(distance_inside(&[], Circle { anchor: Spot { x: 0.0, y: 0.0 }, radius: 1.0 }), num(&empty["inside"]));
    let (within, beyond) = split_line(&[], 1.0);
    assert_spots(&within, &empty["split"]["within"], "split nothing, within");
    assert_spots(&beyond, &empty["split"]["beyond"], "split nothing, beyond");
}
