use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::color::NoteColorKey;
use crate::error::{AppError, AppResult};

/// 默认冷却时长（分钟）。
pub const DEFAULT_COOLDOWN_MINUTES: i64 = 15;
/// 冷却可配置范围：1 ～ 120 分钟（0 不允许表示 disabled）。
pub const MIN_COOLDOWN_MINUTES: i64 = 1;
pub const MAX_COOLDOWN_MINUTES: i64 = 120;

/// Reminder 全局设置（id=1 单行）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSettings {
    pub cooldown_minutes: i64,
    pub updated_at: DateTime<Utc>,
}

/// 冷却时长校验：1 ～ 120 分钟。
pub fn validate_cooldown_minutes(minutes: i64) -> AppResult<i64> {
    if !(MIN_COOLDOWN_MINUTES..=MAX_COOLDOWN_MINUTES).contains(&minutes) {
        return Err(AppError::Validation(format!(
            "冷却时长必须在 {} ～ {} 分钟之间",
            MIN_COOLDOWN_MINUTES, MAX_COOLDOWN_MINUTES
        )));
    }
    Ok(minutes)
}

/// Reminder 单条便签内容（只含用户自己保存的 Tip 内容 + 颜色）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderTip {
    pub tip_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub body: String,
    pub color_key: NoteColorKey,
}

/// Reminder 载荷：Agent + 该 Agent 当前有效 Default Carry Tips。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderPayload {
    pub agent_key: String,
    pub agent_id: Uuid,
    pub agent_display_name: String,
    pub tips: Vec<ReminderTip>,
    pub generated_at: DateTime<Utc>,
}

/// Reminder 决策结果（Coordinator 内部语义；不直接暴露给前端）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReminderDecision {
    Show { payload: ReminderPayload },
    SkipNoEligibleTips,
    SkipCooldown { remaining_secs: i64 },
    SkipNotActionable,
    SkipAlreadyVisible,
    Error { reason: String },
}

/// 冷却检查结果：区分"结构上未过期"与"系统时间回拨"。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CooldownCheck {
    pub active: bool,
    pub remaining_secs: i64,
    pub clock_rollback: bool,
}

/// 冷却判定（Agent Entry Driven；按 Agent 独立应用全局 duration）。
/// - last_shown_at 为空 → 未激活；
/// - now < last_shown_at（系统时间回拨）→ 视为 CooldownActive，不疯狂提醒；
/// - now - last_shown_at >= duration → 到期；
/// - 否则剩余 = duration - (now - last_shown_at)。
pub fn check_cooldown(
    cooldown_minutes: i64,
    last_shown_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> CooldownCheck {
    let Some(last) = last_shown_at else {
        return CooldownCheck {
            active: false,
            remaining_secs: 0,
            clock_rollback: false,
        };
    };
    let duration = Duration::minutes(cooldown_minutes.max(MIN_COOLDOWN_MINUTES));
    if now < last {
        return CooldownCheck {
            active: true,
            remaining_secs: duration.num_seconds(),
            clock_rollback: true,
        };
    }
    let elapsed = now - last;
    if elapsed >= duration {
        return CooldownCheck {
            active: false,
            remaining_secs: 0,
            clock_rollback: false,
        };
    }
    CooldownCheck {
        active: true,
        remaining_secs: (duration - elapsed).num_seconds().max(1),
        clock_rollback: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(secs: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(secs, 0).unwrap()
    }

    #[test]
    fn default_15min_valid() {
        assert_eq!(validate_cooldown_minutes(15).unwrap(), 15);
    }

    #[test]
    fn one_min_valid() {
        assert_eq!(validate_cooldown_minutes(1).unwrap(), 1);
    }

    #[test]
    fn one_hundred_twenty_min_valid() {
        assert_eq!(validate_cooldown_minutes(120).unwrap(), 120);
    }

    #[test]
    fn zero_invalid() {
        assert!(validate_cooldown_minutes(0).is_err());
    }

    #[test]
    fn one_hundred_twenty_one_invalid() {
        assert!(validate_cooldown_minutes(121).is_err());
    }

    #[test]
    fn negative_invalid() {
        assert!(validate_cooldown_minutes(-1).is_err());
    }

    #[test]
    fn clock_rollback_is_cooldown_active() {
        let last = at(1000);
        let now = at(900);
        let check = check_cooldown(15, Some(last), now);
        assert!(check.active);
        assert!(check.clock_rollback);
    }

    #[test]
    fn exactly_cooldown_elapsed_is_eligible() {
        let last = at(0);
        let now = at(15 * 60);
        let check = check_cooldown(15, Some(last), now);
        assert!(!check.active);
        assert!(!check.clock_rollback);
    }

    #[test]
    fn cooldown_minus_1ms_blocked() {
        let last = at(0);
        let now = at(15 * 60 - 1);
        let check = check_cooldown(15, Some(last), now);
        assert!(check.active);
        assert!(check.remaining_secs >= 1);
    }

    #[test]
    fn no_last_shown_is_eligible() {
        let check = check_cooldown(15, None, at(500));
        assert!(!check.active);
        assert!(!check.clock_rollback);
    }
}
