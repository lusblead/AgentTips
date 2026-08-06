use std::sync::Arc;

use crate::domain::agents::Agent;
use crate::error::AppResult;
use crate::ports::agents::AgentRepository;

/// Agent 用例。
pub struct AgentService {
    repo: Arc<dyn AgentRepository>,
}

impl AgentService {
    pub fn new(repo: Arc<dyn AgentRepository>) -> Self {
        Self { repo }
    }

    pub fn list(&self) -> AppResult<Vec<Agent>> {
        self.repo.list()
    }
}
