//! Projects (`src/engine/content/projects.ts`): the SRD's Work on a Project downtime move. A project plan is the
//! designer's - a name, how much work it takes, and what finishing it does, in the one effect vocabulary - and the
//! party comes by one through a `learnPlan` effect. On a long rest a character may spend a downtime move on a plan
//! the party has learned and not yet finished (`workOnProject`): one unit of work each, the party's together; the
//! move that does the last of it finishes the plan, and its reward is run with that character acting, as a
//! countdown's effects are run when it goes off. The work done is the party's, kept in the scenario
//! (`ScenarioState::projects`), and so in a save.

use super::log::note;
use super::session::Session;
use crate::js;
use crate::script::runner::{RunnerOptions, ScriptRunner};
use serde_json::Value;

impl Session {
    /// A project plan the project's designer wrote, by id.
    pub fn plan_of(&self, plan: &str) -> Option<Value> {
        self.project["projectPlans"].as_array()?.iter().find(|p| p["id"].as_str() == Some(plan)).cloned()
    }

    /// Whether a plan is learned and its work not all done: a plan a character may spend a move on.
    pub fn plan_open(&self, plan: &str) -> bool {
        let (Some(def), Some(done)) = (self.plan_of(plan), self.world.scenario.projects.get(plan)) else { return false };
        *done < def["work"].as_f64().unwrap_or(1.0)
    }

    /// One Work on a Project move, by `who`, on `plan`: a unit of work, and the plan finished - its reward run, `who`
    /// acting - when that was the last of it. Nothing for a plan not learned, not the project's, or finished.
    pub(super) fn work_on_project(&mut self, who: &str, plan: &str) -> Result<(), String> {
        if !self.plan_open(plan) {
            return Ok(());
        }
        let def = self.plan_of(plan).expect("an open plan is the project's");
        let work = def["work"].as_f64().unwrap_or(1.0);
        let done = self.world.scenario.projects.get(plan).copied().unwrap_or(0.0) + 1.0;
        self.world.scenario.projects.set(plan, done);
        let (name, worker) = (def["name"].as_str().unwrap_or(plan).to_string(), super::log::name_of(self, who));
        note(self, &format!("{worker} works on {name}: {} of {}.", js::number_to_string(done), js::number_to_string(work)), "good");
        if done < work {
            return Ok(());
        }
        note(self, &format!("{name} is finished."), "success");
        let reward = def["reward"].as_array().cloned().unwrap_or_default();
        let was = std::mem::replace(&mut self.world.scenario.actor_id, Some(who.to_string()));
        let options = RunnerOptions { targets: Some(Vec::new()), hit: Some(Vec::new()), roll_as: Some("actor".into()), ..RunnerOptions::default() };
        let mut runner = ScriptRunner::new(&mut self.world, &mut self.rng, &options);
        runner.run(&reward);
        let journal = runner.entries().to_vec();
        drop(runner);
        self.record(&journal)?;
        self.world.scenario.actor_id = was;
        Ok(())
    }
}
