//! A conversation in progress (`src/engine/dialogue/dialogue.ts`'s `DialogueRunner`): a node is entered,
//! its `onEnter` run, its lines shown with the replies that are available, a reply chosen - rolling its
//! check, if it has one, and going where the outcome says - until a node leads nowhere.
//!
//! The walk is the dialogue's; what it stands on is `script/`'s: whether a condition holds, running
//! effects and answering the prompts they raise, and the modifier a check will add. Those are asked of a
//! `DialogueHost`, in exactly the order and number the TypeScript asks them (a view is built twice on
//! entering a node, as it is there), so a recorded host can hold this walk to the TypeScript's before
//! `script/` is ported, and the script port's world can answer for real after.

use crate::dialogue::schema::{Dialogue, DialogueLine, NodeKind};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// What a script run or resume came to: waiting on a prompt, or done, with the run's whole journal so
/// far - a resumed run's journal carries on from where it stood.
#[derive(Clone, Debug, PartialEq)]
pub struct ScriptResult {
    pub prompt: Option<Value>,
    pub journal: Vec<Value>,
}

/// What a dialogue asks of the world it is spoken in.
pub trait DialogueHost {
    /// `evaluateOptional`: nothing to check holds.
    fn evaluate(&mut self, condition: Option<&Value>) -> bool;
    /// The modifier the party would add to a roll with this trait, if it has one.
    fn check_modifier(&mut self, trait_: Option<&Value>) -> Option<f64>;
    /// Run these effects in a new script, with the dialogue's `targets` and `subject`.
    fn run(&mut self, effects: &[Value], options: &Value) -> ScriptResult;
    /// Answer the running script's prompt.
    fn resume(&mut self, response: &Value) -> ScriptResult;
}

/// A reply as the player is shown it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ViewOption {
    pub index: usize,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// False when a visible option is locked.
    pub enabled: bool,
    /// Set when picking this needs a roll, so a UI can mark it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check: Option<ViewCheck>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ViewCheck {
    #[serde(rename = "trait", skip_serializing_if = "Option::is_none")]
    pub trait_: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub difficulty: Option<Value>,
    pub modifier: f64,
}

/// What the player is being shown right now: the node, by its index in the dialogue.
#[derive(Clone, Debug, PartialEq)]
pub struct DialogueView {
    pub node: usize,
    pub options: Vec<ViewOption>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DialogueStatus {
    Talking(DialogueView),
    /// An effect inside the dialogue needs an answer of its own.
    Script(Value),
    Ended,
}

pub struct DialogueRunner<'a> {
    dialogue: &'a Dialogue,
    by_id: HashMap<&'a str, usize>,
    journal: Vec<Value>,
    /// Who the conversation is with, handed to every script inside it.
    with: Value,
    current: Option<usize>,
    script_running: bool,
    /// Where to go once the running script finishes.
    pending_goto: Option<String>,
    /// The choice whose check is being rolled - node and reply - so its outcome can route.
    pending_check: Option<(usize, usize)>,
    entering_node: Option<usize>,
    consumed: usize,
    ended: bool,
}

impl<'a> DialogueRunner<'a> {
    /// `options` is the script options the conversation passes on: `{ targets?, subject? }`. A dialogue
    /// that repeats a node id is refused, in the TypeScript's words.
    pub fn new(dialogue: &'a Dialogue, options: Value) -> Result<Self, String> {
        let mut by_id = HashMap::new();
        for (index, node) in dialogue.nodes.iter().enumerate() {
            if by_id.insert(node.id.as_str(), index).is_some() {
                return Err(format!("dialogue \"{}\" repeats node \"{}\"", dialogue.id, node.id));
            }
        }
        Ok(DialogueRunner {
            dialogue,
            by_id,
            journal: Vec::new(),
            with: options,
            current: None,
            script_running: false,
            pending_goto: None,
            pending_check: None,
            entering_node: None,
            consumed: 0,
            ended: false,
        })
    }

    /// Everything the conversation has recorded: the replies chosen and every script's journal.
    pub fn entries(&self) -> &[Value] {
        &self.journal
    }

    /// The node a view names.
    pub fn lines(&self, view: &DialogueView) -> &'a [DialogueLine] {
        &self.dialogue.nodes[view.node].lines
    }

    /// Enter the first node.
    pub fn start(&mut self, host: &mut impl DialogueHost) -> DialogueStatus {
        let start = self.dialogue.start.clone();
        self.enter(&start, host)
    }

    /// Pick a reply, by its index in the current node. An index that names no reply, or one hidden or
    /// locked, changes nothing.
    pub fn choose(&mut self, index: i64, host: &mut impl DialogueHost) -> DialogueStatus {
        let Some(node_index) = self.current.filter(|_| !self.ended) else { return DialogueStatus::Ended };
        let node = &self.dialogue.nodes[node_index];
        let choices = node.choices.as_deref().unwrap_or(&[]);
        let Some(choice) = usize::try_from(index).ok().and_then(|i| choices.get(i)) else { return self.talking(node_index, host) };
        if !host.evaluate(choice.available.as_ref()) {
            return self.talking(node_index, host);
        }
        if !host.evaluate(choice.enabled.as_ref()) {
            return self.talking(node_index, host);
        }
        self.journal.push(json!({ "kind": "chose", "label": choice.text, "index": index }));
        if let Some(check) = &choice.check {
            self.pending_check = Some((node_index, index as usize));
            let effect = json!({ "kind": "check", "check": check });
            return self.run_script(&[effect], choice.goto.clone(), None, host);
        }
        let effects = choice.effects.clone().unwrap_or_default();
        self.run_script(&effects, choice.goto.clone(), None, host)
    }

    /// Answer a prompt raised by an effect inside the dialogue. With nothing running, the node stands -
    /// even after the end, as the TypeScript has it.
    pub fn resume(&mut self, response: &Value, host: &mut impl DialogueHost) -> DialogueStatus {
        if !self.script_running {
            return match self.current {
                None => DialogueStatus::Ended,
                Some(node) => self.talking(node, host),
            };
        }
        let result = host.resume(response);
        self.after_script(result, host)
    }

    /// Move on from a node with no replies - the "continue" button. With replies, one must be chosen.
    pub fn advance(&mut self, host: &mut impl DialogueHost) -> DialogueStatus {
        let Some(node_index) = self.current.filter(|_| !self.ended) else { return DialogueStatus::Ended };
        if !self.visible_choices(node_index, host).is_empty() {
            return self.talking(node_index, host);
        }
        match self.dialogue.nodes[node_index].goto.clone() {
            Some(goto) => self.enter(&goto, host),
            None => self.finish(),
        }
    }

    fn enter(&mut self, id: &str, host: &mut impl DialogueHost) -> DialogueStatus {
        let Some(&node_index) = self.by_id.get(id) else {
            // A dangling link ends the conversation rather than failing it; `dangling_links` finds them.
            self.ended = true;
            return DialogueStatus::Ended;
        };
        self.current = Some(node_index);
        match &self.dialogue.nodes[node_index].on_enter {
            Some(effects) if !effects.is_empty() => self.run_script(&effects.clone(), None, Some(node_index), host),
            _ => self.after_enter(node_index, host),
        }
    }

    /// After a node's `onEnter`: a consequence goes on, a node with nothing to answer and somewhere to
    /// go walks straight on, and anything else is said - a closing line is shown before it ends.
    fn after_enter(&mut self, node_index: usize, host: &mut impl DialogueHost) -> DialogueStatus {
        let node = &self.dialogue.nodes[node_index];
        if node.kind == Some(NodeKind::Consequence) {
            return match node.goto.clone() {
                None => self.finish(),
                Some(goto) => self.enter(&goto, host),
            };
        }
        let options = self.visible_choices(node_index, host);
        if let (true, Some(goto)) = (options.is_empty(), node.goto.clone()) {
            return self.enter(&goto, host);
        }
        self.talking(node_index, host)
    }

    fn run_script(&mut self, effects: &[Value], goto: Option<String>, entering: Option<usize>, host: &mut impl DialogueHost) -> DialogueStatus {
        self.pending_goto = goto;
        self.entering_node = entering;
        self.script_running = true;
        let result = host.run(effects, &self.with);
        self.after_script(result, host)
    }

    fn after_script(&mut self, result: ScriptResult, host: &mut impl DialogueHost) -> DialogueStatus {
        self.journal.extend(result.journal.iter().skip(self.consumed).cloned());
        self.consumed = result.journal.len();
        if let Some(prompt) = result.prompt {
            return DialogueStatus::Script(prompt);
        }
        self.script_running = false;
        self.consumed = 0;

        // A check inside a choice routes by its outcome: the last check the conversation recorded.
        if let Some((node_index, choice_index)) = self.pending_check.take() {
            let choice = &self.dialogue.nodes[node_index].choices.as_ref().expect("a checked reply")[choice_index];
            let check = choice.check.as_ref().expect("a checked reply has its check");
            let last = self.journal.iter().rev().find(|e| e["kind"] == "check");
            let succeeded = last.is_some_and(|e| e["roll"]["success"] == Value::Bool(true));
            let routed = if succeeded { check.goto_on_success.clone() } else { check.goto_on_failure.clone() };
            let target = routed.or(self.pending_goto.take());
            self.pending_goto = None;
            // A choice with a check may also carry plain effects; they run after it.
            if let Some(effects) = choice.effects.as_ref().filter(|e| !e.is_empty()) {
                return self.run_script(&effects.clone(), target, None, host);
            }
            return match target {
                None => self.finish(),
                Some(target) => self.enter(&target, host),
            };
        }

        if let Some(entering) = self.entering_node.take() {
            return self.after_enter(entering, host);
        }
        match self.pending_goto.take() {
            None => self.finish(),
            Some(goto) => self.enter(&goto, host),
        }
    }

    fn finish(&mut self) -> DialogueStatus {
        self.ended = true;
        DialogueStatus::Ended
    }

    /// The replies shown: every `available` asked first, then each shown reply's `enabled` and its
    /// check's modifier, in turn.
    fn visible_choices(&self, node_index: usize, host: &mut impl DialogueHost) -> Vec<ViewOption> {
        let choices = self.dialogue.nodes[node_index].choices.as_deref().unwrap_or(&[]);
        let shown: Vec<usize> = (0..choices.len()).filter(|&i| host.evaluate(choices[i].available.as_ref())).collect();
        shown
            .into_iter()
            .map(|index| {
                let choice = &choices[index];
                let enabled = host.evaluate(choice.enabled.as_ref());
                let check = choice.check.as_ref().map(|check| ViewCheck {
                    trait_: check.trait_().cloned(),
                    difficulty: check.difficulty().cloned(),
                    modifier: host.check_modifier(check.trait_()).unwrap_or(0.0),
                });
                ViewOption { index, text: choice.text.clone(), detail: choice.detail.clone(), enabled, check }
            })
            .collect()
    }

    fn talking(&self, node_index: usize, host: &mut impl DialogueHost) -> DialogueStatus {
        DialogueStatus::Talking(DialogueView { node: node_index, options: self.visible_choices(node_index, host) })
    }
}
