//! Using the things in a room and talking to the creatures in it (`src/game/demo-scene.ts`'s `useSelectedOn`,
//! `answerPending` and `settle`, `game/prop-use.ts`, `game/talks.ts`, `game/interaction.ts`): a thing used
//! as the game uses it - in reach, refused, run - and the prompt it stops on held until it is answered, a
//! conversation opened on it and had reply by reply, the journal written down and acted on, a container's
//! window, a portal's other end, travel a script asked for, and a conversation set aside for somebody else.
//!
//! A prompt waits between calls: the script that raised it is put down (`SuspendedRunner`) and picked up
//! again with the world and the dice when it is answered, and a conversation keeps its runner and the
//! script inside it the same way.
//!
//! A fight a journal starts or stops is `fight`'s, and what answers a roll the party made is `answer`'s; the
//! countdowns a roll moves tick here. A card a roll would offer a table that asks (`ask_defender`) is the
//! next half's, and refused with an error naming it - refusing beats quietly doing something else.

use super::content::item_name;
use super::fight::not_yet;
use super::log::{name_of, note, speak, write_down, LogLine};
use super::session::Session;
use crate::dialogue::runner::{DialogueHost, DialogueRunner, DialogueStatus, DialogueView, ScriptResult};
use crate::grid::tile_grid::{TileGrid, NO_TILE};
use crate::rng::Rng;
use crate::scene::interact::{use_interactable, UseResult};
use crate::scene::prop_functions::{container_items, find_function, footprint_of, interactables_of, portal_partner};
use crate::scene::state::Faction;
use crate::script::conditions::{evaluate_optional, TargetBindings};
use crate::script::runner::{RunStatus, RunnerOptions, ScriptRunner, SuspendedRunner};
use crate::script::world::SceneScriptWorld;
use serde_json::{json, Value};

/// How near a thing has to be to be used, in tiles, counting a diagonal as one.
pub const DEMO_REACH: i32 = 1;

/// What came of an action: how it stands - `done`, `waiting`, `refused`, `busy`, `missing`, `unreachable`
/// - and the lines it wrote.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct UseOutcome {
    pub status: &'static str,
    pub lines: Vec<LogLine>,
}

fn outcome(status: &'static str, lines: Vec<LogLine>) -> Result<UseOutcome, String> {
    Ok(UseOutcome { status, lines })
}

/// What to do once a script finishes.
#[derive(Clone, Debug, PartialEq)]
pub enum OnDone {
    Nothing,
    /// A creature's conversation: the fight counted again, and a GM's turn it stopped played on.
    Converse,
    /// A push past the circle: walk on, or be held, as the roll says.
    Run { id: String, destination: i32, aimed: Option<crate::grid::tile_grid::Spot> },
    /// A jump: land, as the roll says.
    Leap { id: String, leap: super::leap::Leap, read: bool },
    /// A card of the party's that stopped to ask something: vaulted if it says so, and what it was holding -
    /// a swing - landed, with the actor it put down given back.
    Reaction { by: String, ability: Box<crate::content::abilities::AbilityDef>, landing: Option<Box<super::swing::HeldSwing>>, was: Option<String> },
}

/// A conversation in progress.
pub struct PendingDialogue {
    pub runner: DialogueRunner,
    /// The script a reply is running, put down while it waits on a roll.
    inner: Option<SuspendedRunner>,
    /// What the player is looking at, or nothing while a reply's script has the floor.
    pub view: Option<DialogueView>,
    /// A reply's own prompt: a roll it costs.
    pub prompt: Option<Value>,
    /// How much of the conversation's journal is already in the log.
    pub recorded: usize,
    /// The member having it.
    pub by: Option<String>,
    /// The node whose lines are already in the log.
    pub spoken_node: Option<String>,
}

/// A script waiting on the player (`PendingScript`).
pub struct PendingScript {
    runner: SuspendedRunner,
    pub prompt: Value,
    /// The thing it came from; nothing for a creature's conversation.
    pub interactable: Option<String>,
    /// How much of the runner's journal is already in the log: a journal is cumulative.
    pub recorded: usize,
    /// The conversation this script opened, while it is had.
    pub dialogue: Option<PendingDialogue>,
    /// The creature a conversation is with, bound as the `target` of everything said in it.
    pub with: Option<String>,
    pub on_done: OnDone,
}

impl PendingScript {
    /// A rolled move's roll, waiting.
    pub(super) fn new(runner: SuspendedRunner, prompt: Value, recorded: usize, on_done: OnDone) -> Self {
        PendingScript { runner, prompt, interactable: None, recorded, dialogue: None, with: None, on_done }
    }

    /// The journal so far, the runner's own.
    pub fn entries(&self) -> &[Value] {
        self.runner.entries()
    }
}

/// A conversation set aside for somebody else: the prompt it was, the shop it had open, and the room it
/// was set aside in - one entered afresh has a party of its own, and a conversation from before is over.
pub struct SetAside {
    pending: PendingScript,
    shop: Option<String>,
    room: u64,
}

/// What a conversation asks of the room it is had in: the world's conditions and checks, and a script run
/// for a reply - kept, put down, while it waits on a roll.
struct Host<'h> {
    world: &'h mut SceneScriptWorld<'static>,
    rng: &'h mut Rng,
    inner: &'h mut Option<SuspendedRunner>,
}

impl Host<'_> {
    fn result(runner: ScriptRunner<'_, SceneScriptWorld<'static>>, status: RunStatus, inner: &mut Option<SuspendedRunner>) -> ScriptResult {
        let journal = runner.entries().to_vec();
        let prompt = match status {
            RunStatus::Waiting(prompt) => Some(prompt),
            RunStatus::Done => None,
        };
        *inner = prompt.is_some().then(|| runner.suspend());
        ScriptResult { prompt, journal }
    }
}

impl DialogueHost for Host<'_> {
    fn evaluate(&mut self, condition: Option<&Value>) -> bool {
        evaluate_optional(condition, &mut *self.world, &TargetBindings::default(), false)
    }

    fn check_modifier(&mut self, trait_: Option<&Value>) -> Option<f64> {
        SceneScriptWorld::check_modifier(self.world, trait_.and_then(Value::as_str).unwrap_or_default(), "party")
    }

    fn run(&mut self, effects: &[Value], options: &Value) -> ScriptResult {
        let options: RunnerOptions = serde_json::from_value(options.clone()).unwrap_or_default();
        let mut runner = ScriptRunner::new(&mut *self.world, &mut *self.rng, &options);
        let status = runner.run(effects);
        Host::result(runner, status, self.inner)
    }

    fn resume(&mut self, response: &Value) -> ScriptResult {
        let Some(waiting) = self.inner.take() else { return ScriptResult { prompt: None, journal: Vec::new() } };
        let mut runner = waiting.attach(&mut *self.world, &mut *self.rng);
        let status = runner.resume(response).unwrap_or(RunStatus::Done);
        Host::result(runner, status, self.inner)
    }
}

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

/// Tiles apart, counting a diagonal as one step.
fn chebyshev(grid: &TileGrid, a: i32, b: i32) -> i32 {
    (grid.x_of(a) - grid.x_of(b)).abs().max((grid.y_of(a) - grid.y_of(b)).abs())
}

impl Session {
    /// Whether a fight is running.
    pub fn in_combat(&self) -> bool {
        self.encounter.as_ref().is_some_and(|e| e.outcome() == crate::combat::encounter::EncounterOutcome::Ongoing)
    }

    /// The tile a thing covers nearest to `here` (`nearestCovered`): a prop drawn across a block is reached
    /// from any side of it, a creature where it stands.
    pub fn nearest_covered(&self, id: &str, here: i32) -> i32 {
        let state = &self.world.state;
        let covers = state.interactable_covers(id);
        let standing = state.entity(id).map_or(NO_TILE, |e| e.tile);
        let tiles = if covers.is_empty() && standing != NO_TILE { vec![standing] } else { covers };
        let (mut best, mut away) = (NO_TILE, i32::MAX);
        for tile in tiles {
            let gap = chebyshev(&state.grid, tile, here);
            if gap < away {
                (best, away) = (tile, gap);
            }
        }
        best
    }

    /// The nearest thing the selected member could use right now (`reachableInteractable`).
    pub fn reachable_interactable(&self) -> Option<String> {
        let actor = self.party.selected()?;
        let here = self.world.state.entity(actor).map_or(NO_TILE, |e| e.tile);
        if here == NO_TILE {
            return None;
        }
        interactables_of(&self.scene).into_iter().map(|t| text(&t, "id").to_string()).find(|id| {
            let there = self.nearest_covered(id, here);
            there != NO_TILE && chebyshev(&self.world.state.grid, here, there) <= DEMO_REACH
        })
    }

    /// Use a thing with whoever is selected (`useSelectedOn`): one thing at a time, and only within reach.
    pub fn use_selected_on(&mut self, id: &str) -> Result<UseOutcome, String> {
        if self.pending.is_some() {
            return outcome("busy", Vec::new());
        }
        let Some(object) = interactables_of(&self.scene).into_iter().find(|t| text(t, "id") == id) else { return outcome("missing", Vec::new()) };
        let Some(actor) = self.party.selected().map(str::to_string) else { return outcome("unreachable", Vec::new()) };
        let here = self.world.state.entity(&actor).map_or(NO_TILE, |e| e.tile);
        let there = self.nearest_covered(id, here);
        if here == NO_TILE || there == NO_TILE || chebyshev(&self.world.state.grid, here, there) > DEMO_REACH {
            let line = note(self, "It is out of reach.", "system");
            return outcome("unreachable", vec![line]);
        }
        // In a fight, using a thing is what they did with the turn.
        let fighting = self.in_combat();
        if fighting && !self.encounter.as_ref().expect("a fight").can_act(&self.world.state, &actor) {
            let line = note(self, "There is no time \u{2014} you have acted.", "system");
            return outcome("refused", vec![line]);
        }
        self.world.scenario.actor_id = Some(actor.clone());
        let repeatable = object["repeatable"] == true;
        let (status, journal, runner) = match use_interactable(&object, &mut self.world, &mut self.rng, repeatable) {
            UseResult::Refused(refused) => {
                let line = note(self, &refused.text, "system");
                return outcome("refused", vec![line]);
            }
            UseResult::Done(runner) => (RunStatus::Done, runner.entries().to_vec(), runner.suspend()),
            UseResult::Waiting(prompt, runner) => (RunStatus::Waiting(prompt), runner.entries().to_vec(), runner.suspend()),
        };
        if fighting {
            self.encounter.as_mut().expect("a fight").act(&mut self.world.state, &actor, false);
        }
        let lines = self.record(&journal)?;
        match status {
            RunStatus::Waiting(prompt) => {
                self.pending = Some(PendingScript { runner, prompt, interactable: Some(id.to_string()), recorded: journal.len(), dialogue: None, with: None, on_done: OnDone::Nothing });
                self.settle(lines)
            }
            RunStatus::Done => self.settle_travel(lines),
        }
    }

    /// Answer whatever a script is waiting for (`answerPending`). A conversation that opened a shop waits
    /// for the shop to be shut; one on top of the script takes the answer first.
    pub fn answer_pending(&mut self, response: &Value) -> Result<UseOutcome, String> {
        let Some(mut waiting) = self.pending.take() else { return outcome("refused", Vec::new()) };
        if waiting.dialogue.is_some() && self.shop_open() {
            self.pending = Some(waiting);
            return outcome("refused", Vec::new());
        }
        if let Some(talking) = waiting.dialogue.take() {
            return self.answer_dialogue(waiting, talking, response);
        }
        let mut runner = waiting.runner.attach(&mut self.world, &mut self.rng);
        let status = runner.resume(response)?;
        let journal = runner.entries().to_vec();
        waiting.runner = runner.suspend();
        // Only the part that has not been shown yet.
        let lines = self.record_answering(&journal[waiting.recorded.min(journal.len())..])?;
        match status {
            RunStatus::Waiting(prompt) => {
                waiting.prompt = prompt;
                waiting.recorded = journal.len();
                // The dice are read and nothing has come of them: the room answers this one, not the player.
                if waiting.prompt["kind"] == "rolled" {
                    self.pending = None;
                    let asked = self.offer_on_roll(waiting)?;
                    let mut all = lines;
                    all.extend(asked.lines);
                    return outcome(asked.status, all);
                }
                self.pending = Some(waiting);
                self.settle(lines)
            }
            RunStatus::Done => {
                self.pending = None;
                self.done(waiting.on_done.clone(), &waiting.runner)?;
                self.settle_travel(lines)
            }
        }
    }

    /// Put the roll to the room before the check reads it (`offerOnRoll`): a free card plays itself; one to
    /// offer a table that asks is the next half's; with nobody asked, the roll stands.
    fn offer_on_roll(&mut self, waiting: PendingScript) -> Result<UseOutcome, String> {
        let roll: Option<crate::rules::duality::DualityRoll> = serde_json::from_value(waiting.prompt["roll"].clone()).ok();
        let tags: Option<Vec<String>> = serde_json::from_value(waiting.prompt["tags"].clone()).ok();
        let trait_ = waiting.prompt["trait"].as_str().map(str::to_string);
        let groups = match (self.world.scenario.actor_id.clone(), roll) {
            (Some(roller), Some(roll)) => self.rolling_offers(&roller, &roll, None, tags, trait_)?,
            _ => Vec::new(),
        };
        if !groups.is_empty() && self.ask_defender {
            return Err(not_yet("A card offered on a roll"));
        }
        self.pending = Some(waiting);
        self.answer_pending(&json!({ "kind": "answered" }))
    }

    /// Once a script finishes (`onDone`).
    fn done(&mut self, on_done: OnDone, runner: &SuspendedRunner) -> Result<(), String> {
        match on_done {
            // A creature's conversation over: the fight counted again - the one talked round may have been
            // the last who wanted it - and a GM's turn it stopped picked up again.
            OnDone::Converse => {
                if self.encounter.is_some() {
                    self.settle_fight()?;
                }
                if !self.waiting() && self.gm_turn.is_some() {
                    self.run_gm_turn()?;
                }
                Ok(())
            }
            OnDone::Run { .. } | OnDone::Leap { .. } => self.finish(on_done, runner),
            OnDone::Reaction { by, ability, landing, was } => self.reaction_done(&by, &ability, landing.map(|l| *l), was, runner),
            _ => Ok(()),
        }
    }

    /// Pick a reply, go on, or answer a roll a reply asked for (`answerDialogue`).
    fn answer_dialogue(&mut self, mut waiting: PendingScript, mut talking: PendingDialogue, response: &Value) -> Result<UseOutcome, String> {
        let status = {
            let mut host = Host { world: &mut self.world, rng: &mut self.rng, inner: &mut talking.inner };
            match response["kind"].as_str() {
                Some("choose") => talking.runner.choose(response["index"].as_f64().unwrap_or(f64::NAN) as i64, &mut host),
                Some("continue") => talking.runner.advance(&mut host),
                _ => talking.runner.resume(response, &mut host),
            }
        };
        let journal = talking.runner.entries().to_vec();
        let lines = self.record_answering(&journal[talking.recorded.min(journal.len())..])?;
        talking.recorded = journal.len();
        match status {
            DialogueStatus::Talking(view) => {
                let node = talking.runner.node_id(&view).to_string();
                let said_lines = talking.runner.lines(&view).to_vec();
                let said = speak(self, &mut talking.spoken_node, &node, &said_lines);
                talking.view = Some(view);
                talking.prompt = None;
                waiting.dialogue = Some(talking);
                self.pending = Some(waiting);
                let mut all = lines;
                all.extend(said);
                outcome("waiting", all)
            }
            DialogueStatus::Script(prompt) => {
                talking.view = None;
                talking.prompt = Some(prompt);
                waiting.dialogue = Some(talking);
                self.pending = Some(waiting);
                outcome("waiting", lines)
            }
            DialogueStatus::Ended => {
                // The conversation ended; the script that opened it carries on.
                self.pending = Some(waiting);
                self.resume_outer(lines)
            }
        }
    }

    /// Carry the interrupted script on past its `startDialogue` (`resumeOuter`), its own lines after the
    /// conversation's.
    fn resume_outer(&mut self, lines: Vec<LogLine>) -> Result<UseOutcome, String> {
        let Some(mut waiting) = self.pending.take() else { return outcome("done", lines) };
        let mut runner = waiting.runner.attach(&mut self.world, &mut self.rng);
        let status = runner.resume(&json!({ "kind": "continue" }))?;
        let journal = runner.entries().to_vec();
        waiting.runner = runner.suspend();
        let mut all = lines;
        all.extend(self.record_answering(&journal[waiting.recorded.min(journal.len())..])?);
        match status {
            RunStatus::Waiting(prompt) => {
                waiting.prompt = prompt;
                waiting.recorded = journal.len();
                self.pending = Some(waiting);
                self.settle(all)
            }
            RunStatus::Done => {
                self.pending = None;
                self.done(waiting.on_done.clone(), &waiting.runner)?;
                self.settle_travel(all)
            }
        }
    }

    /// A script that stopped on a `startDialogue` opens the conversation itself (`settle`), so nobody is
    /// handed a prompt there is no answer to.
    pub fn settle(&mut self, lines: Vec<LogLine>) -> Result<UseOutcome, String> {
        let Some(mut waiting) = self.pending.take() else { return outcome("waiting", lines) };
        if waiting.prompt["kind"] != "dialogue" {
            self.pending = Some(waiting);
            return outcome("waiting", lines);
        }
        let Some(dialogue) = self.dialogues.get(text(&waiting.prompt, "dialogue")).cloned() else {
            // A missing conversation must not wedge the script.
            self.pending = Some(waiting);
            let missing = note(self, "There is nothing to say.", "system");
            let mut all = lines;
            all.push(missing);
            return self.resume_outer(all);
        };
        let options = match &waiting.with {
            Some(with) => json!({ "targets": [with] }),
            None => json!({}),
        };
        let mut runner = DialogueRunner::new(dialogue, options)?;
        let mut inner = None;
        let status = runner.start(&mut Host { world: &mut self.world, rng: &mut self.rng, inner: &mut inner });
        let journal = runner.entries().to_vec();
        let started = self.record_answering(&journal)?;
        let mut opened = PendingDialogue {
            view: None,
            prompt: None,
            recorded: journal.len(),
            by: self.world.scenario.actor_id.clone(),
            spoken_node: None,
            inner,
            runner,
        };
        let mut all = lines;
        all.extend(started);
        match status {
            DialogueStatus::Ended => {
                self.pending = Some(waiting);
                self.resume_outer(all)
            }
            DialogueStatus::Talking(view) => {
                let node = opened.runner.node_id(&view).to_string();
                let said_lines = opened.runner.lines(&view).to_vec();
                let said = speak(self, &mut opened.spoken_node, &node, &said_lines);
                opened.view = Some(view);
                waiting.dialogue = Some(opened);
                self.pending = Some(waiting);
                all.extend(said);
                outcome("waiting", all)
            }
            DialogueStatus::Script(prompt) => {
                opened.prompt = Some(prompt);
                waiting.dialogue = Some(opened);
                self.pending = Some(waiting);
                outcome("waiting", all)
            }
        }
    }

    /// Act on a `goto` a script asked for, once the script has finished asking the player things
    /// (`settleTravel`).
    pub fn settle_travel(&mut self, lines: Vec<LogLine>) -> Result<UseOutcome, String> {
        let Some(destination) = self.destination.clone().filter(|_| self.pending.is_none()) else {
            return outcome(if self.pending.is_none() { "done" } else { "waiting" }, lines);
        };
        let before = self.log.len();
        self.travel_to(&destination)?;
        self.destination = None;
        let mut all = lines;
        all.extend(self.log[before..].iter().cloned());
        outcome("done", all)
    }

    // ---- a journal, acted on -----------------------------------------------------------------------------

    /// `record`, for the journal of a question being answered, which is still open while it is recorded.
    fn record_answering(&mut self, journal: &[Value]) -> Result<Vec<LogLine>, String> {
        self.answering += 1;
        let recorded = self.record(journal);
        self.answering -= 1;
        recorded
    }

    /// Turn what a script did into what the player reads, and act on it (`record`).
    pub fn record(&mut self, journal: &[Value]) -> Result<Vec<LogLine>, String> {
        let lines = write_down(self, journal);
        self.react(journal)?;
        Ok(lines)
    }

    /// Act on a journal once it is all in (`react`): the room's things and where the party is sent, the
    /// creatures turned, the pools, and what the party's rolls answer.
    fn react(&mut self, journal: &[Value]) -> Result<(), String> {
        self.react_to_things(journal);
        self.react_to_fights(journal);
        self.sync_pools();
        for (roller, roll) in self.rolls_from(journal) {
            self.play_party_rolled(&roller, &roll)?;
        }
        for cue in self.cues_from(journal) {
            self.tick_countdowns(&cue)?;
        }
        Ok(())
    }

    /// The party's rolls a journal holds (`rollsFrom`): a check rolled as a party member, an attack of theirs.
    fn rolls_from(&self, journal: &[Value]) -> Vec<(String, Value)> {
        let party = |id: &str| self.world.state.entity(id).is_some_and(|e| e.faction == Faction::Party);
        let mut rolls = Vec::new();
        for entry in journal {
            if entry["kind"] == "check" {
                if let Some(roller) = self.world.scenario.actor_id.clone().filter(|r| party(r)) {
                    rolls.push((roller, entry["roll"].clone()));
                }
            }
            if entry["kind"] == "attack" && entry.get("roll").is_some_and(|r| !r.is_null()) && party(text(entry, "attacker")) {
                rolls.push((text(entry, "attacker").to_string(), entry["roll"].clone()));
            }
        }
        rolls
    }

    /// What a journal holds that a countdown counts (`cuesFrom`): a party action roll, Hit Points marked.
    fn cues_from(&self, journal: &[Value]) -> Vec<crate::rules::countdown::CountdownCue> {
        use crate::rules::countdown::CountdownCue;
        let party = |id: Option<&str>| id.is_some_and(|id| self.world.state.entity(id).is_some_and(|e| e.faction == Faction::Party));
        let outcome = |entry: &Value| serde_json::from_value(entry["roll"]["outcome"].clone()).ok();
        let mut cues = Vec::new();
        for entry in journal {
            if entry["kind"] == "check" && party(self.world.scenario.actor_id.as_deref()) {
                if let Some(outcome) = outcome(entry) {
                    cues.push(CountdownCue::ActionRoll { attack: false, outcome });
                }
            }
            if entry["kind"] == "attack" {
                if entry.get("roll").is_some_and(|r| !r.is_null()) && party(entry["attacker"].as_str()) {
                    if let Some(outcome) = outcome(entry) {
                        cues.push(CountdownCue::ActionRoll { attack: true, outcome });
                    }
                }
                let marked = entry["hitPointsMarked"].as_f64().unwrap_or(0.0);
                if marked > 0.0 {
                    cues.push(CountdownCue::HpMarked { id: text(entry, "target").to_string(), marked });
                }
            }
        }
        cues
    }

    /// Act on what a script did to the things in a room and where it sent the party (`reactToThings`).
    fn react_to_things(&mut self, journal: &[Value]) {
        for entry in journal {
            match text(entry, "kind") {
                "goto" => self.destination = Some(text(entry, "scene").to_string()),
                "openContainer" | "shop" => self.opened = Some(text(entry, "id").to_string()),
                "teleport" => {
                    let pair = text(entry, "pair").to_string();
                    let from = entry["from"].as_str().map(str::to_string);
                    self.teleport(&pair, from.as_deref());
                }
                _ => {}
            }
        }
    }

    /// Send whoever used a portal to its partner: beside it in this room, or there once the party travels.
    fn teleport(&mut self, pair: &str, from: Option<&str>) {
        let Some(partner) = portal_partner(&self.project, pair, from).map(|p| (p.scene.to_string(), text(p.prop, "id").to_string())) else {
            note(self, "Nothing answers on the other side. This portal has no partner yet.", "system");
            return;
        };
        if partner.0 != text(&self.scene, "id") {
            self.destination = Some(partner.0.clone());
            self.arriving = Some(partner);
            return;
        }
        let Some(actor) = self.world.scenario.actor_id.clone().or_else(|| self.party.selected().map(str::to_string)) else { return };
        let going = if self.in_combat() { vec![actor] } else { self.party.group_of(&self.world.state, &actor) };
        self.step_out_beside(&partner.1, &going);
    }

    /// Once travel has settled, the party beside the portal they came through, if they came through one.
    pub(super) fn arrive_by_portal(&mut self) {
        let Some((scene, prop)) = self.arriving.take() else { return };
        if scene != text(&self.scene, "id") {
            return;
        }
        let members = self.party.members(&self.world.state);
        self.step_out_beside(&prop, &members);
    }

    /// Stand these on the nearest free tiles round a prop, each put down rather than walked.
    fn step_out_beside(&mut self, id: &str, who: &[String]) {
        let at = footprint_of(&self.scene, id).first().copied().or_else(|| {
            interactables_of(&self.scene).into_iter().find(|t| text(t, "id") == id).map(|t| (t["position"]["x"].as_f64().unwrap_or(f64::NAN), t["position"]["y"].as_f64().unwrap_or(f64::NAN)))
        });
        let Some((x, y)) = at else { return };
        for member in who {
            let tile = self.free_tile_near(self.world.state.grid.index_at(x, y));
            if tile == NO_TILE {
                continue;
            }
            let (tx, ty) = (f64::from(self.world.state.grid.x_of(tile)), f64::from(self.world.state.grid.y_of(tile)));
            self.world.state.move_entity(member, tile).expect("a member");
            self.world.state.place_entity(member, tx, ty).expect("a member");
            self.motions.push(json!({ "id": member, "teleport": true }));
        }
    }

    // ---- containers --------------------------------------------------------------------------------------

    /// What a seller sells, a prop's or a creature's (`shopOf`).
    pub fn shop_of(&self, id: &str) -> Option<Value> {
        if let Some(prop) = list(&self.scene, "decos").iter().find(|d| d["id"].as_str() == Some(id)) {
            return find_function(prop.get("function"), "shop").map(|f| f["shop"].clone());
        }
        self.placement_of(id).and_then(|(placement, _)| placement["interaction"].get("shop").cloned())
    }

    /// The container whose window is open, if it is still here to be open (`openContainer`).
    pub fn open_container(&mut self) -> Option<String> {
        if let Some(id) = self.opened.clone() {
            let a_prop = list(&self.scene, "decos").iter().any(|d| d["id"].as_str() == Some(id.as_str()));
            if !a_prop && !self.world.state.entity(&id).is_some_and(|e| e.alive) {
                self.opened = None;
            }
        }
        self.opened.clone()
    }

    /// Shut the container's window (`closeContainer`).
    pub fn close_container(&mut self) {
        self.opened = None;
    }

    /// Whether what is open is a shop (`shopOpen`).
    pub fn shop_open(&mut self) -> bool {
        self.open_container().is_some_and(|id| self.shop_of(&id).is_some())
    }

    /// What is still in a container: what was put in it, less what has been taken (`containerContents`).
    pub fn container_contents(&mut self, id: &str) -> Result<Vec<(String, String, f64)>, String> {
        if self.shop_of(id).is_some() {
            return Err("a shop's wares come with buying, which the server does not do yet".into());
        }
        let function = list(&self.scene, "decos").iter().find(|d| d["id"].as_str() == Some(id)).and_then(|d| d.get("function").cloned());
        let taken = self.world.state.interactable(id).data.clone();
        Ok(container_items(function.as_ref())
            .iter()
            .map(|line| {
                let item = text(line, "item").to_string();
                let name = item_name(self.shipped(), &self.project, &item).unwrap_or_else(|| item.clone());
                let count = line["count"].as_f64().unwrap_or(1.0) - taken.get(&format!("taken:{item}")).and_then(Value::as_f64).unwrap_or(0.0);
                (item, name, count)
            })
            .filter(|(_, _, count)| *count > 0.0)
            .collect())
    }

    /// Take one of something out of a container and into the party's pack (`takeFromContainer`).
    pub fn take_from_container(&mut self, id: &str, item: &str) -> Result<bool, String> {
        let Some((_, name, _)) = self.container_contents(id)?.into_iter().find(|(i, _, _)| i == item) else { return Ok(false) };
        let key = format!("taken:{item}");
        let state = self.world.state.interactable(id);
        let taken = state.data.get(&key).and_then(Value::as_f64).unwrap_or(0.0);
        state.data.insert(key, json!(taken + 1.0));
        crate::script::runner::ScriptWorld::add_item(&mut self.world, item, 1.0);
        let who = self.party.selected().map_or_else(|| "The party".to_string(), |w| name_of(self, w));
        note(self, &format!("{who} takes {name}."), "success");
        Ok(true)
    }

    // ---- creatures ---------------------------------------------------------------------------------------

    /// The placement a creature was stood up from, and the encounter that placed it.
    pub(super) fn placement_of(&self, id: &str) -> Option<(Value, String)> {
        for encounter in list(&self.scene, "encounters") {
            if let Some(placement) = list(encounter, "adversaries").iter().find(|p| p["id"].as_str() == Some(id)) {
                return Some((placement.clone(), text(encounter, "id").to_string()));
            }
        }
        None
    }

    /// Talk to a creature, standing where they can (`talkNow`).
    pub fn talk_now(&mut self, actor: &str, id: &str) -> Result<UseOutcome, String> {
        let Some(dialogue) = self.placement_of(id).and_then(|(p, _)| p["interaction"]["dialogue"].as_str().map(str::to_string)) else { return outcome("missing", Vec::new()) };
        if !self.world.state.entity(id).is_some_and(|e| e.alive) {
            return outcome("missing", Vec::new());
        }
        // In a fight the talk is the action, as opening a chest is.
        if self.in_combat() {
            self.encounter.as_mut().expect("a fight").act(&mut self.world.state, actor, false);
        }
        self.converse(actor, id, &dialogue)
    }

    /// Open a creature's conversation, the creature bound as the `target` of everything in it (`converse`).
    pub(super) fn converse(&mut self, actor: &str, id: &str, dialogue: &str) -> Result<UseOutcome, String> {
        self.world.scenario.actor_id = Some(actor.to_string());
        let options = RunnerOptions { targets: Some(vec![id.to_string()]), ..RunnerOptions::default() };
        let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
        let status = runner.run(&[json!({ "kind": "startDialogue", "dialogue": dialogue })]);
        let journal = runner.entries().to_vec();
        let runner = runner.suspend();
        let lines = self.record(&journal)?;
        let RunStatus::Waiting(prompt) = status else { return outcome("done", lines) };
        self.pending = Some(PendingScript { runner, prompt, interactable: None, recorded: journal.len(), dialogue: None, with: Some(id.to_string()), on_done: OnDone::Converse });
        self.settle(lines)
    }

    // ---- conversations set aside -------------------------------------------------------------------------

    /// Who is having the conversation on screen (`talkerOf`).
    pub fn talker(&self) -> Option<String> {
        self.pending.as_ref().and_then(|p| p.dialogue.as_ref()).and_then(|d| d.by.clone())
    }

    /// Everybody in a conversation set aside (`talkingAside`).
    pub fn talking_aside(&self) -> Vec<String> {
        self.talks.entries().iter().map(|(id, _)| id.clone()).collect()
    }

    /// Put the conversations where the selection says (`syncTalks`): the one on screen set aside when
    /// somebody else is selected, the selected member's own brought back. Whether anything moved.
    pub fn sync_talks(&mut self) -> bool {
        let mut moved = self.break_off();
        let who = self.party.selected().map(str::to_string);
        if let Some(talker) = self.talker() {
            if Some(&talker) != who.as_ref() && !self.in_combat() && self.party.hold(&self.world.state, &talker) {
                let open = self.open_container();
                let shop = open.filter(|id| self.shop_of(id).is_some());
                if shop.is_some() {
                    self.opened = None;
                }
                let pending = self.pending.take().expect("a conversation on screen");
                self.talks.set(&talker, SetAside { pending, shop, room: self.room });
                moved = true;
            }
        }
        if let Some(who) = who {
            if self.talks.has(&who) && self.pending.is_none() {
                let waiting = self.take_aside(&who);
                self.party.release(&who);
                self.pending = Some(waiting.pending);
                if waiting.shop.is_some() {
                    self.opened = waiting.shop;
                }
                moved = true;
            }
        }
        moved
    }

    fn take_aside(&mut self, who: &str) -> SetAside {
        let at = self.talks.entries().iter().position(|(id, _)| id == who).expect("set aside");
        let mut entries: Vec<(String, SetAside)> = std::mem::take(&mut self.talks).into_entries();
        let (_, taken) = entries.remove(at);
        for (id, talk) in entries {
            self.talks.set(&id, talk);
        }
        taken
    }

    /// A fight, the one talking fallen, or a room entered afresh: what was set aside is over (`breakOff`).
    fn break_off(&mut self) -> bool {
        let mut broken = false;
        for who in self.talking_aside() {
            let standing = self.world.state.entity(&who).is_some_and(|e| e.alive);
            let here = self.talks.get(&who).is_some_and(|t| t.room == self.room);
            if standing && here && !self.in_combat() {
                continue;
            }
            self.take_aside(&who);
            if here {
                self.party.release(&who);
            }
            if standing && here {
                let name = name_of(self, &who);
                note(self, &format!("{name} breaks off the conversation."), "system");
            }
            broken = true;
        }
        broken
    }
}
