use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Desktop,
    Terminal,
}

impl AgentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentKind::Desktop => "desktop",
            AgentKind::Terminal => "terminal",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "desktop" => Ok(AgentKind::Desktop),
            "terminal" => Ok(AgentKind::Terminal),
            other => Err(AppError::Validation(format!("未知 Agent 类型: {other}"))),
        }
    }
}

/// Agent 领域模型。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub kind: AgentKind,
    pub built_in: bool,
    pub enabled: bool,
    pub reminder_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
