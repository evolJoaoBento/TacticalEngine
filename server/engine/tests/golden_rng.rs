//! `server/fixtures/rng.json` replayed: every call `src/engine/core/rng.golden.test.ts` made of the
//! TypeScript generator, made again here, with the same answers.

use engine::rng::{hash_seed, Rng, Seed};
use serde_json::Value;

fn fixture() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/rng.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("the fixture is written by the TypeScript golden test"))
        .expect("the fixture is JSON")
}

fn u32s(value: &Value) -> Vec<u32> {
    value.as_array().unwrap().iter().map(|n| n.as_u64().unwrap() as u32).collect()
}

#[test]
fn text_seeds_hash_as_typescript_hashes_them() {
    let golden = fixture();
    for pair in golden["hashSeed"].as_array().unwrap() {
        assert_eq!(hash_seed(pair[0].as_str().unwrap()), pair[1].as_u64().unwrap() as u32, "hashSeed({})", pair[0]);
    }
}

#[test]
fn every_run_rolls_as_typescript_rolls() {
    let golden = fixture();
    let runs = golden["runs"].as_array().unwrap();
    assert!(runs.len() >= 15);
    for run in runs {
        let seed = &run["seed"];
        let mut rng = match seed.as_str() {
            Some(text) => Rng::new(Seed::Text(text)),
            None => Rng::new(Seed::Number(seed.as_f64().unwrap())),
        };
        let at = |what: &str| format!("seed {seed}: {what}");
        assert_eq!(u64::from(rng.save()), run["start"].as_u64().unwrap(), "{}", at("start"));

        let uint32: Vec<u32> = (0..8).map(|_| (rng.next() * 4_294_967_296.0) as u32).collect();
        assert_eq!(uint32, u32s(&run["uint32"]), "{}", at("next"));

        for triple in run["ints"].as_array().unwrap() {
            let max = triple[0].as_u64().unwrap() as u32;
            let got = [rng.next_int(max).unwrap(), rng.next_int(max).unwrap()];
            assert_eq!(got.to_vec(), vec![triple[1].as_u64().unwrap() as u32, triple[2].as_u64().unwrap() as u32], "{}", at(&format!("nextInt({max})")));
        }

        let d20: Vec<u32> = (0..10).map(|_| rng.die(20).unwrap()).collect();
        assert_eq!(d20, u32s(&run["d20"]), "{}", at("die(20)"));
        assert_eq!(rng.dice(4, 6).unwrap(), u32s(&run["dice"]), "{}", at("dice(4, 6)"));

        let letters = ["a", "b", "c", "d", "e", "f", "g"];
        let picked: Vec<&str> = (0..5).map(|_| *rng.pick(&letters).unwrap()).collect();
        let wanted: Vec<&str> = run["picked"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(picked, wanted, "{}", at("pick"));

        let mut shuffled: Vec<u32> = (0..12).collect();
        rng.shuffle(&mut shuffled);
        assert_eq!(shuffled, u32s(&run["shuffled"]), "{}", at("shuffle"));

        let mut fork = rng.fork();
        let forked: Vec<u32> = (0..4).map(|_| (fork.next() * 4_294_967_296.0) as u32).collect();
        assert_eq!(forked, u32s(&run["forked"]), "{}", at("fork"));
        assert_eq!(u64::from(fork.save()), run["forkState"].as_u64().unwrap(), "{}", at("fork state"));

        let after = rng.save();
        assert_eq!(u64::from(after), run["after"].as_u64().unwrap(), "{}", at("save"));
        let mut resumed = Rng::new(Seed::Number(0.0));
        resumed.restore(after);
        assert_eq!((resumed.next() * 4_294_967_296.0) as u32 as u64, run["resumedNext"].as_u64().unwrap(), "{}", at("restore"));
    }
}
