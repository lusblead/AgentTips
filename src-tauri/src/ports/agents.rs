use crate::domain::agents::Agent;
use crate::error::AppResult;
use uuid::Uuid;

/// Agent 持久化端口。
pub trait AgentRepository: Send + Sync {
    fn list(&self) -> AppResult<Vec<Agent>>;
    fn set_enabled(&self, id: Uuid, enabled: bool) -> AppResult<Agent>;
}
