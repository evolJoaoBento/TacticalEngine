//! Project hooks run in QuickJS (`src/engine/script/hooks.ts`, through `rquickjs`): the engine's `Hooks`,
//! for a server that runs other people's projects. A hook meets the `ctx` the TypeScript hands it - the
//! reads, answered by the world it is lent, the scenario's dice, the last roll, the queue - built by the
//! same code (`prelude.js`), and is compiled the same way, with the same names shadowed and `Math.random`
//! refusing. What a browser treats as a guard against honest mistakes is a boundary here, so each call is
//! also given a runtime of its own, with no host but the reads, and limits: memory, stack, and a budget
//! of the engine's own interrupt checks - counted, not timed, so a hook stopped on one machine is stopped
//! on every machine. A runtime to itself is also what lets a hook's read reach a hook: a modifier gated on
//! one, read while a hook asks a Difficulty, runs in a runtime of its own.
//!
//! Where it differs from the browser: an error the engine raises itself (reading a property of
//! `undefined`, a syntax error, a stack overflow) is worded by QuickJS rather than V8 - its kind is the
//! same; QuickJS has no `Intl`; and a hook past its limits fails here where the browser would carry on.

use engine::rng::Rng;
use engine::script::conditions::HookReads;
use engine::script::hooks::{answer_read, CodeSource, HookIssue, HookReader, Hooks};
use engine::script::runner::{HookRun, LastRoll};
use rquickjs::{Context, Function, Runtime};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

const PRELUDE: &str = include_str!("prelude.js");

/// What one call may take.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Bytes the runtime may allocate.
    pub memory: usize,
    /// Bytes of native stack the engine may use.
    pub stack: usize,
    /// Interrupt checks the engine may make - one every few thousand operations - before it is stopped.
    pub checks: u64,
}

pub const DEFAULT_LIMITS: Limits = Limits { memory: 32 << 20, stack: 512 << 10, checks: 20_000 };

/// What a hook's run came to, in full: whether it finished, and if not, what it threw and of what kind.
#[derive(Clone, Debug, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    /// For a predicate: whether it answered exactly `true`.
    pub value: bool,
    /// What it threw: an `Error`'s message, or the thrown thing as text.
    pub message: String,
    /// The `Error`'s name - `TypeError`, `RangeError` - when it threw one.
    pub name: Option<String>,
    pub queued: Vec<Value>,
}

/// Project code compiled for QuickJS: every entry that compiles, a later one under an id replacing an earlier.
pub struct QuickJsHooks {
    code: Vec<(String, String)>,
    limits: Limits,
}

/// The message a hook stopped by its limits leaves.
pub const TOO_LONG: &str = "the hook ran too long";

impl QuickJsHooks {
    /// Compile a project's code: a body that will not parse is an issue and no hook, so the rest still loads.
    pub fn compile(code: &[CodeSource]) -> (Self, Vec<HookIssue>) {
        Self::compile_with(code, DEFAULT_LIMITS)
    }

    pub fn compile_with(code: &[CodeSource], limits: Limits) -> (Self, Vec<HookIssue>) {
        let mut hooks = QuickJsHooks { code: Vec::new(), limits };
        let mut issues = Vec::new();
        for entry in code {
            match hooks.check(&entry.source) {
                Some(message) => issues.push(HookIssue { id: entry.id.clone(), message }),
                None => match hooks.code.iter_mut().find(|(id, _)| *id == entry.id) {
                    Some(known) => known.1 = entry.source.clone(),
                    None => hooks.code.push((entry.id.clone(), entry.source.clone())),
                },
            }
        }
        (hooks, issues)
    }

    fn source(&self, id: &str) -> Option<&str> {
        self.code.iter().find(|(known, _)| known == id).map(|(_, source)| source.as_str())
    }

    /// A runtime of its own, limited, with the prelude run in a context on it; `host` answers the reads.
    fn with<R>(&self, host: impl Fn(String, String) -> Option<String> + 'static, work: impl FnOnce(&rquickjs::Ctx) -> R) -> Result<R, String> {
        let runtime = Runtime::new().map_err(|e| e.to_string())?;
        runtime.set_memory_limit(self.limits.memory);
        runtime.set_max_stack_size(self.limits.stack);
        let checks = Arc::new(AtomicU64::new(0));
        let (counted, budget) = (checks.clone(), self.limits.checks);
        runtime.set_interrupt_handler(Some(Box::new(move || counted.fetch_add(1, Ordering::Relaxed) + 1 > budget)));
        let context = Context::full(&runtime).map_err(|e| e.to_string())?;
        let answer = context.with(|ctx| -> Result<R, String> {
            let door = Function::new(ctx.clone(), move |name: String, args: String| host(name, args)).map_err(|e| e.to_string())?;
            ctx.globals().set("__host", door).map_err(|e| e.to_string())?;
            ctx.eval::<(), _>(PRELUDE).map_err(|e| e.to_string())?;
            Ok(work(&ctx))
        });
        if checks.load(Ordering::Relaxed) > budget {
            return Err(TOO_LONG.into());
        }
        answer
    }

    /// Whether a body compiles, and if not, what QuickJS said.
    fn check(&self, source: &str) -> Option<String> {
        let source = source.to_string();
        let checked = self.with(|_, _| None, move |ctx| {
            let check: Function = ctx.globals().get("check").expect("the prelude defines check");
            check.call::<_, Option<String>>((source,)).map_err(|e| e.to_string())
        });
        match checked {
            Ok(Ok(said)) => said,
            Ok(Err(message)) | Err(message) => Some(message),
        }
    }

    /// Run a hook: as a predicate (no dice, no queue) when `rng` is none, as an effect otherwise. The world
    /// answers its reads while it runs; the stream is left where the hook left it.
    pub fn call(&self, id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: Option<&mut Rng>, world: &mut dyn HookReader) -> Outcome {
        let failed = |message: String| Outcome { ok: false, value: false, message, name: None, queued: Vec::new() };
        let Some(source) = self.source(id).map(str::to_string) else { return failed(format!("no hook \"{id}\"")) };
        // The reads are lent for this call alone: the runtime holding the door to them is dropped before
        // the call returns, so nothing a hook keeps can reach them after.
        let door: *mut (dyn HookReader + '_) = world;
        // SAFETY: the pointer is only dereferenced by the `__host` function, which lives in the runtime
        // `with` builds and drops before returning, while `world` is borrowed for the whole call; QuickJS
        // runs the hook on this thread, synchronously.
        let door: *mut (dyn HookReader + 'static) = unsafe { std::mem::transmute(door) };
        let host = move |name: String, args: String| {
            let world = unsafe { &mut *door };
            answer_read(world, &name, &args)
        };
        let effect = rng.is_some();
        let seed = rng.as_ref().map_or(0, |r| r.save());
        let reads_json = json!({ "args": reads.args, "actor": reads.actor, "targets": reads.targets, "hit": reads.hit, "inCombat": reads.in_combat }).to_string();
        let last = json!(last_roll).to_string();
        let ran = self.with(host, move |ctx| {
            let run: Function = ctx.globals().get("run").expect("the prelude defines run");
            match run.call::<_, String>((source, effect, reads_json, seed, last)) {
                Ok(text) => Ok(text),
                Err(rquickjs::Error::Exception) => Err(ctx.catch().as_exception().and_then(|e| e.message()).unwrap_or_else(|| "the hook failed".into())),
                Err(e) => Err(e.to_string()),
            }
        });
        let text = match ran {
            Ok(Ok(text)) => text,
            Ok(Err(message)) | Err(message) => return failed(message),
        };
        let out: Value = serde_json::from_str(&text).expect("the prelude answers JSON");
        if let (Some(rng), Some(state)) = (rng, out["state"].as_u64()) {
            rng.restore(state as u32);
        }
        Outcome {
            ok: out["ok"] == true,
            value: out["value"] == true,
            message: out["message"].as_str().unwrap_or_default().to_string(),
            name: out["name"].as_str().map(str::to_string),
            queued: out["queued"].as_array().cloned().unwrap_or_default(),
        }
    }
}

impl Hooks for QuickJsHooks {
    fn defined(&self, id: &str) -> bool {
        self.source(id).is_some()
    }

    fn run(&self, id: &str, reads: &HookReads, world: &mut dyn HookReader) -> bool {
        let outcome = self.call(id, reads, None, None, world);
        outcome.ok && outcome.value
    }

    fn run_effect(&self, id: &str, reads: &HookReads, last_roll: Option<LastRoll>, rng: &mut Rng, world: &mut dyn HookReader) -> HookRun {
        let outcome = self.call(id, reads, last_roll, Some(rng), world);
        HookRun { ok: outcome.ok, message: outcome.message, queued: outcome.queued }
    }
}
