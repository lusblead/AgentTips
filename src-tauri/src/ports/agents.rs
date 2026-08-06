use crate::domain::agents::Agent;
use crate::error::AppResult;

/// Agent 持久化端口。
pub trait AgentRepository: Send + Sync {
    fn list(&self) -> AppResult<Vec<Agent>>;
}
