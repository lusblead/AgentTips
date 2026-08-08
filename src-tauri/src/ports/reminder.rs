use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::reminder::{ReminderPayload, ReminderSettings, ReminderTip};
use crate::error::AppResult;

/// Agent 身份（detection key → DB stable id + 展示名）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentIdentity {
    pub id: Uuid,
    pub display_name: String,
}

/// Default Carry 便签查询端口。
/// 输入为 detection 的 agent key（如 "codex"），实现按 agents.key 关联到 DB 的 stable id。
pub trait ReminderEligibilityPort: Send + Sync {
    /// 按 agent key 解析 DB stable id 与展示名。
    fn agent_info(&self, agent_key: &str) -> AppResult<Option<AgentIdentity>>;
    /// 该 Agent 当前有效（active / 未删除 / 未使用）且 auto_attach=true 的 Tip。
    /// 排序：tip_agents.sort_order ASC，之后 created_at ASC 稳定 tie-breaker。
    fn eligible_tips(&self, agent_key: &str) -> AppResult<Vec<ReminderTip>>;
}

/// Reminder 全局设置与 per-agent 冷却状态持久化端口。
pub trait ReminderStateRepositoryPort: Send + Sync {
    fn get_settings(&self) -> AppResult<ReminderSettings>;
    /// 更新全局冷却时长（分钟）。非法值在 application 层校验后不会到达此处。
    fn update_settings(&self, cooldown_minutes: i64) -> AppResult<ReminderSettings>;
    /// 某 Agent（按 key）最近一次 Reminder 成功显示时间。
    fn last_shown_at(&self, agent_key: &str) -> AppResult<Option<DateTime<Utc>>>;
    /// 记录某 Agent（按 key）Reminder 成功显示时间。
    fn set_last_shown_at(&self, agent_key: &str, at: DateTime<Utc>) -> AppResult<()>;
}

/// Reminder 展示端口（Application 不感知 WebviewWindow / HWND / Tauri Event）。
pub trait ReminderPresenterPort: Send + Sync {
    /// 显示（或替换 payload）Reminder；不得抢走当前外部 Agent 的键盘焦点。
    fn show(&self, payload: &ReminderPayload) -> AppResult<()>;
    fn hide(&self) -> AppResult<()>;
    fn is_visible(&self) -> AppResult<bool>;
    fn current_agent_key(&self) -> AppResult<Option<String>>;
}
