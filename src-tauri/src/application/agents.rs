use std::sync::Arc;

use crate::domain::agents::Agent;
use crate::error::AppResult;
use crate::ports::agents::AgentRepository;
use uuid::Uuid;

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

    pub fn set_enabled(&self, id: Uuid, enabled: bool) -> AppResult<Agent> {
        self.repo.set_enabled(id, enabled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::agents::AgentKind;
    use std::sync::Mutex;

    struct FakeAgentRepository {
        agent: Mutex<Agent>,
        updates: Mutex<Vec<bool>>,
    }

    impl AgentRepository for FakeAgentRepository {
        fn list(&self) -> AppResult<Vec<Agent>> {
            Ok(vec![self.agent.lock().unwrap().clone()])
        }

        fn set_enabled(&self, id: Uuid, enabled: bool) -> AppResult<Agent> {
            let mut agent = self.agent.lock().unwrap();
            assert_eq!(agent.id, id);
            agent.enabled = enabled;
            self.updates.lock().unwrap().push(enabled);
            Ok(agent.clone())
        }
    }

    #[test]
    fn set_enabled_delegates_both_states() {
        let now = chrono::Utc::now();
        let id = Uuid::new_v4();
        let repo = Arc::new(FakeAgentRepository {
            agent: Mutex::new(Agent {
                id,
                key: "cursor".into(),
                name: "Cursor".into(),
                kind: AgentKind::Desktop,
                built_in: true,
                enabled: true,
                reminder_enabled: true,
                created_at: now,
                updated_at: now,
            }),
            updates: Mutex::new(Vec::new()),
        });
        let service = AgentService::new(repo.clone());

        assert!(!service.set_enabled(id, false).unwrap().enabled);
        assert!(service.set_enabled(id, true).unwrap().enabled);
        assert_eq!(repo.updates.lock().unwrap().as_slice(), [false, true]);
    }
}
