//! The engine as the page loads it (`docs/SERVER.md`, phase 3, slice 2): a replica of the game, stood up from
//! the project, told after every intent how the game stands (`game/replica.rs`), and asked what the pointer
//! asks on every move.
//!
//! The face is a C one - no `wasm-bindgen`, nothing to install: the page puts a JSON message in memory it was
//! lent (`alloc`), hands it over (`call`), and reads the answer back (`answer_ptr`, the length `call` gave),
//! all through `WebAssembly.instantiate`, in a browser or in Node alike. The message is one of
//!
//! - `{ "op": "build", "project", "shipped", "seed", "animated", "askDefender" }` - a game stood up from a
//!   project, its walks drawn or not, its defender asked or not;
//! - `{ "op": "restore", "replica" }` - told how the game stands;
//! - `{ "op": "call", "call", "args" }` - an intent, by the page's name for it (`game/dispatch.rs`);
//! - `{ "op": "ask", "ask": ..., ... }` - asked: `reach`, `pressure`, `preview` (`destination`, `aim`, `from`),
//!   `targets`, `tiles` (`id`, `ability`), `shape` (`id`, `ability`, `tile`), `jumpOffered`, `jumpAim`,
//!   `jumpReaches` (`id`, `destination`, `aim`);
//!
//! and the answer `{ "ok": <answer> }` or `{ "error": <why> }`.
//!
//! A project's hooks are the page's to run (`HostHooks`): the module imports one function, `host.hook`, which
//! the page answers by running the hook's JavaScript in the same prelude QuickJS runs it in on the server
//! (`server/hooks/src/prelude.js`), and a hook's reads of the world come back in through `hook_read`. That is
//! a call into the module while it is still inside one, so the world the hook reads is not reached through
//! the game - borrowed for the whole of `call` - but through a slot it is lent to for the hook's run alone.
//! Built for anything but WebAssembly, nothing is imported and no hook is run.

use engine::game::face;
use engine::game::session::{HooksFor, Session};
use engine::script::hooks::{CodeSource, Hooks, NoHooks};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

thread_local! {
    static GAME: RefCell<Option<Session>> = const { RefCell::new(None) };
    static ANSWER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[cfg(target_arch = "wasm32")]
mod host {
    //! The page's half of a hook: its JavaScript run, and the world read back while it runs.

    use engine::rng::Rng;
    use engine::script::conditions::HookReads;
    use engine::script::hooks::{answer_read, CodeSource, HookReader, Hooks};
    use engine::script::runner::{HookRun, LastRoll};
    use serde_json::{json, Value};
    use std::cell::Cell;

    #[link(wasm_import_module = "host")]
    extern "C" {
        /// Run a hook: `{ source, effect, reads, seed, last }` as JSON at `at`; the answer is the prelude's
        /// JSON, length-prefixed (four bytes, little end first) in memory the page took from `alloc`.
        fn hook(at: *const u8, len: usize) -> *mut u8;
    }

    thread_local! {
        /// The world a running hook is lent, for `hook_read`; none between hooks.
        static READER: Cell<Option<*mut (dyn HookReader + 'static)>> = const { Cell::new(None) };
    }

    /// A read a running hook makes (`ctx.pool`, `ctx.select`...): `{ name, args }` as JSON, answered into the
    /// answer buffer - empty for the `undefined` a read can come to.
    #[no_mangle]
    pub unsafe extern "C" fn hook_read(at: *const u8, len: usize) -> usize {
        let message: Value = serde_json::from_slice(std::slice::from_raw_parts(at, len)).unwrap_or(Value::Null);
        let said = READER.with(|reader| match reader.get() {
            // SAFETY: lent by `HostHooks::call` for the hook's run, during which the hook is the only one
            // reading it, on this one thread; taken back before that call returns.
            Some(world) => answer_read(unsafe { &mut *world }, message["name"].as_str().unwrap_or(""), &message["args"].to_string()),
            None => None,
        });
        super::ANSWER.with(|out| {
            *out.borrow_mut() = said.unwrap_or_default().into_bytes();
            out.borrow().len()
        })
    }

    /// Project code run by the page: every entry by its id, a later one replacing an earlier.
    pub struct HostHooks {
        code: Vec<(String, String)>,
    }

    impl HostHooks {
        pub fn new(code: &[CodeSource]) -> HostHooks {
            let mut kept: Vec<(String, String)> = Vec::new();
            for entry in code {
                match kept.iter_mut().find(|(id, _)| *id == entry.id) {
                    Some(known) => known.1 = entry.source.clone(),
                    None => kept.push((entry.id.clone(), entry.source.clone())),
                }
            }
            HostHooks { code: kept }
        }

        fn call(&self, id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: Option<&mut Rng>, world: &mut dyn HookReader) -> Value {
            let Some(source) = self.code.iter().find(|(known, _)| known == id).map(|(_, s)| s.clone()) else {
                return json!({ "ok": false, "message": format!("no hook \"{id}\"") });
            };
            let effect = rng.is_some();
            let seed = rng.as_ref().map_or(0, |r| r.save());
            let message = json!({
                "source": source,
                "effect": effect,
                "reads": { "args": reads.args, "actor": reads.actor, "targets": reads.targets, "hit": reads.hit, "inCombat": reads.in_combat },
                "seed": seed,
                "last": last_roll,
            })
            .to_string();
            let lent: *mut (dyn HookReader + '_) = world;
            // SAFETY: the pointer is only read by `hook_read`, during the import's call below, while `world`
            // is borrowed for the whole of this function; the slot is put back as it was before returning,
            // so a hook a hook's read reaches lends its own world and gives it back.
            let lent: *mut (dyn HookReader + 'static) = unsafe { std::mem::transmute(lent) };
            let before = READER.with(|reader| reader.replace(Some(lent)));
            let at = unsafe { hook(message.as_ptr(), message.len()) };
            READER.with(|reader| reader.set(before));
            let answer = unsafe {
                let len = u32::from_le_bytes(std::slice::from_raw_parts(at, 4).try_into().expect("four bytes")) as usize;
                let text: Value = serde_json::from_slice(std::slice::from_raw_parts(at.add(4), len)).unwrap_or_else(|e| json!({ "ok": false, "message": format!("the page's hook said no JSON: {e}") }));
                super::free(at, len + 4);
                text
            };
            if let (Some(rng), Some(state)) = (rng, answer["state"].as_u64()) {
                rng.restore(state as u32);
            }
            answer
        }
    }

    impl Hooks for HostHooks {
        fn defined(&self, id: &str) -> bool {
            self.code.iter().any(|(known, _)| known == id)
        }

        fn run(&self, id: &str, reads: &HookReads, world: &mut dyn HookReader) -> bool {
            let answer = self.call(id, reads, None, None, world);
            answer["ok"] == true && answer["value"] == true
        }

        fn run_effect(&self, id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: &mut Rng, world: &mut dyn HookReader) -> HookRun {
            let answer = self.call(id, reads, last_roll, Some(rng), world);
            HookRun {
                ok: answer["ok"] == true,
                message: answer["message"].as_str().unwrap_or_default().to_string(),
                queued: if answer["ok"] == true { answer["queued"].as_array().cloned().unwrap_or_default() } else { Vec::new() },
            }
        }
    }
}

/// Lend the page `len` bytes to write a message into.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let at = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    at
}

/// Take back what `alloc` lent.
///
/// # Safety
/// `at` and `len` are what one `alloc` gave, and nothing reads them after.
#[no_mangle]
pub unsafe extern "C" fn free(at: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(at, 0, len));
}

/// Answer the message the page wrote at `at`: the answer's length, to be read at `answer_ptr`.
///
/// # Safety
/// `at` holds `len` bytes the page wrote.
#[no_mangle]
pub unsafe extern "C" fn call(at: *const u8, len: usize) -> usize {
    let message = std::str::from_utf8(std::slice::from_raw_parts(at, len)).unwrap_or("");
    let said = answer(message).into_bytes();
    ANSWER.with(|out| {
        *out.borrow_mut() = said;
        out.borrow().len()
    })
}

/// Where the last answer is.
#[no_mangle]
pub extern "C" fn answer_ptr() -> *const u8 {
    ANSWER.with(|out| out.borrow().as_ptr())
}

/// A message answered: `{ "ok": ... }` or `{ "error": ... }`, as text.
pub fn answer(message: &str) -> String {
    let said = serde_json::from_str::<Value>(message).map_err(|e| format!("not a message: {e}")).and_then(|m| respond(&m));
    match said {
        Ok(answer) => json!({ "ok": answer }),
        Err(why) => json!({ "error": why }),
    }
    .to_string()
}

/// A project's hooks: the page's to run, in WebAssembly; none anywhere else.
fn hooks_for() -> HooksFor {
    Rc::new(|code: &[CodeSource]| -> Rc<dyn Hooks> {
        if code.is_empty() {
            return Rc::new(NoHooks);
        }
        #[cfg(target_arch = "wasm32")]
        return Rc::new(host::HostHooks::new(code));
        #[cfg(not(target_arch = "wasm32"))]
        Rc::new(NoHooks)
    })
}

fn respond(message: &Value) -> Result<Value, String> {
    GAME.with(|game| face::respond(&mut game.borrow_mut(), message, hooks_for()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(message: Value) -> Value {
        serde_json::from_str(&answer(&message.to_string())).unwrap()
    }

    #[test]
    fn a_message_that_is_not_one_is_answered_with_why() {
        assert!(serde_json::from_str::<Value>(&answer("{")).unwrap()["error"].as_str().unwrap().starts_with("not a message"));
        assert_eq!(said(json!({ "op": "ask", "ask": "reach" })), json!({ "error": "no game: build one first" }));
        assert_eq!(said(json!({ "nothing": true })), json!({ "error": "no op" }));
    }

    #[test]
    fn the_replica_fixture_is_answered_through_the_face() {
        let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/replica.json")).unwrap()).unwrap();
        let played = &fixture["sessions"][0];
        let project = &fixture["projects"][played["project"].as_u64().unwrap() as usize];
        assert_eq!(said(json!({ "op": "build", "project": project, "shipped": fixture["shipped"], "seed": "face" })), json!({ "ok": null }));
        for step in played["steps"].as_array().unwrap().iter().take(8) {
            assert_eq!(said(json!({ "op": "restore", "replica": step["replica"] })), json!({ "ok": null }));
            let asks = &step["asks"];
            assert_eq!(said(json!({ "op": "ask", "ask": "pressure" }))["ok"], asks["pressure"]);
            assert_eq!(said(json!({ "op": "ask", "ask": "reach" }))["ok"]["tiles"], asks["reach"]["tiles"]);
            for preview in asks["previews"].as_array().unwrap() {
                let got = said(json!({ "op": "ask", "ask": "preview", "destination": preview["destination"], "aim": preview["aim"] }));
                assert_eq!(got["ok"].is_null(), preview["result"].is_null());
            }
            for card in asks["cards"].as_array().unwrap() {
                let got = said(json!({ "op": "ask", "ask": "targets", "id": card["id"], "ability": card["ability"] }));
                assert_eq!(got["ok"], card["targets"]);
            }
            assert_eq!(said(json!({ "op": "ask", "ask": "jumpOffered" }))["ok"], asks["jump"]["offered"]);
        }
        assert_eq!(said(json!({ "op": "ask", "ask": "nothing" })), json!({ "error": "no question \"nothing\"" }));
    }
}
