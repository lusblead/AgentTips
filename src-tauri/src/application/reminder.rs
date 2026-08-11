use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, Utc};

use crate::domain::detection::{DetectionResult, Transition};
use crate::domain::reminder::{
    check_cooldown, snooze_remaining_secs, validate_snooze_hours, ReminderDecision,
    ReminderPayload, ReminderSettings, ReminderSnoozeResult,
};
use crate::error::{AppError, AppResult};
use crate::ports::clock::Clock;
use crate::ports::reminder::{
    ReminderEligibilityPort, ReminderPresenterPort, ReminderStateRepositoryPort,
};

/// Detection Watcher 与 Reminder 的解耦端口（application 内部 trait）。
pub trait ReminderCoordinatorPort: Send + Sync {
    fn on_detection_change(&self, result: &DetectionResult, transition: &Transition);
}

struct CoordinatorMemory {
    /// 本进程内 per-agent 冷却（即使 SQLite persist 失败也阻止重复 spam）。
    last_shown_at: HashMap<String, DateTime<Utc>>,
    /// 最近成功展示的 payload（供 reminder_get_current_payload 兜底）。
    last_payload: Option<ReminderPayload>,
}

/// Reminder 协调器：Detection Transition → Actionability → Eligibility → Cooldown
/// → Presenter → Runtime State → Persistence。
///
/// 安全原则：只有 raw=Matched 且 Entered/Changed 才评估；Ambiguous/Unavailable/
/// SelfWindow/同 Agent None 一律不评估。Cooldown 按 Agent 独立。
pub struct ReminderCoordinator {
    eligibility: Arc<dyn ReminderEligibilityPort>,
    state_repo: Arc<dyn ReminderStateRepositoryPort>,
    presenter: Arc<dyn ReminderPresenterPort>,
    clock: Arc<dyn Clock>,
    memory: Mutex<CoordinatorMemory>,
}

impl ReminderCoordinator {
    pub fn new(
        eligibility: Arc<dyn ReminderEligibilityPort>,
        state_repo: Arc<dyn ReminderStateRepositoryPort>,
        presenter: Arc<dyn ReminderPresenterPort>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            eligibility,
            state_repo,
            presenter,
            clock,
            memory: Mutex::new(CoordinatorMemory {
                last_shown_at: HashMap::new(),
                last_payload: None,
            }),
        }
    }

    /// 前端兜底拉取：最近一次成功展示的 payload。
    pub fn current_payload(&self) -> Option<ReminderPayload> {
        self.memory.lock().unwrap().last_payload.clone()
    }

    /// 用户主动 Dismiss：隐藏窗口；不更新 cooldown（需求 57）。
    pub fn dismiss(&self) -> AppResult<()> {
        if self.presenter.is_visible()? {
            self.presenter.hide()?;
            self.memory.lock().unwrap().last_payload = None;
            eprintln!("[agenttips] reminder_hidden reason=dismissed");
        }
        Ok(())
    }

    /// 将指定 Agent 的提醒独立暂停；可由 Settings 直接调用，不依赖当前提醒窗口。
    pub fn snooze_agent(&self, agent_key: &str, hours: i64) -> AppResult<ReminderSnoozeResult> {
        let hours = validate_snooze_hours(hours)?;
        let snoozed_until = self.clock.now_utc() + Duration::hours(hours);
        self.state_repo
            .set_snoozed_until(agent_key, Some(snoozed_until))?;
        eprintln!(
            "[agenttips] reminder_snoozed agent_id={} hours={} until={}",
            agent_key,
            hours,
            snoozed_until.to_rfc3339()
        );
        Ok(ReminderSnoozeResult {
            agent_key: agent_key.to_string(),
            snoozed_until,
        })
    }

    /// 将当前可见提醒按 Agent 独立暂停；必须先持久化成功，之后才隐藏窗口。
    pub fn snooze_current(&self, hours: i64) -> AppResult<ReminderSnoozeResult> {
        if !self.presenter.is_visible()? {
            return Err(AppError::Validation("当前没有可暂停的提醒".into()));
        }
        let agent_key = self
            .presenter
            .current_agent_key()?
            .ok_or_else(|| AppError::Validation("当前提醒缺少 Agent 上下文".into()))?;

        // DB 失败时不得先隐藏；用户仍能看见原提醒并重试。
        let result = self.snooze_agent(&agent_key, hours)?;
        self.presenter.hide()?;
        self.memory.lock().unwrap().last_payload = None;
        Ok(result)
    }

    /// Settings 页列出仍处于暂停期的 Agent；过期值无需写清理即可视为可提醒。
    pub fn list_agent_snoozes(&self) -> AppResult<Vec<ReminderSnoozeResult>> {
        let now = self.clock.now_utc();
        Ok(self
            .state_repo
            .list_snoozed_until()?
            .into_iter()
            .filter(|entry| entry.snoozed_until > now)
            .collect())
    }

    /// Settings 页恢复指定 Agent；只清除该 Agent 的暂停时间。
    pub fn resume_agent(&self, agent_key: &str) -> AppResult<()> {
        self.state_repo.set_snoozed_until(agent_key, None)?;
        eprintln!("[agenttips] reminder_resumed agent_id={agent_key}");
        Ok(())
    }

    /// Settings 页读取当前冷却配置。
    pub fn get_settings(&self) -> AppResult<ReminderSettings> {
        self.state_repo.get_settings()
    }

    /// Settings 页更新全局冷却时长（分钟，1..=120）。
    pub fn update_settings(&self, cooldown_minutes: i64) -> AppResult<ReminderSettings> {
        self.state_repo.update_settings(cooldown_minutes)
    }

    fn hide_current(&self) -> AppResult<bool> {
        if self.presenter.is_visible()? {
            self.presenter.hide()?;
            self.memory.lock().unwrap().last_payload = None;
            return Ok(true);
        }
        Ok(false)
    }

    fn evaluate(&self, agent_key: &str, now: DateTime<Utc>) -> ReminderDecision {
        let agent = match self.eligibility.agent_info(agent_key) {
            Ok(Some(agent)) => agent,
            Ok(None) => {
                return ReminderDecision::Error {
                    reason: "UNKNOWN_AGENT".into(),
                };
            }
            Err(err) => {
                return ReminderDecision::Error {
                    reason: format!("AGENT_LOOKUP_FAILED: {err}"),
                };
            }
        };

        let snoozed_until = match self.state_repo.snoozed_until(agent_key) {
            Ok(value) => value,
            Err(err) => {
                return ReminderDecision::Error {
                    reason: format!("SNOOZE_READ_FAILED: {err}"),
                };
            }
        };
        let snooze_remaining = snooze_remaining_secs(snoozed_until, now);
        if snooze_remaining > 0 {
            return ReminderDecision::SkipSnoozed {
                remaining_secs: snooze_remaining,
            };
        }

        let tips = match self.eligibility.eligible_tips(agent_key) {
            Ok(tips) => tips,
            Err(err) => {
                return ReminderDecision::Error {
                    reason: format!("ELIGIBILITY_QUERY_FAILED: {err}"),
                };
            }
        };
        if tips.is_empty() {
            // NoEligibleTips 不消耗 cooldown（需求 13）。
            return ReminderDecision::SkipNoEligibleTips;
        }

        let settings = match self.state_repo.get_settings() {
            Ok(settings) => settings,
            Err(err) => {
                return ReminderDecision::Error {
                    reason: format!("SETTINGS_READ_FAILED: {err}"),
                };
            }
        };

        let last_shown = {
            let memory = self.memory.lock().unwrap();
            memory
                .last_shown_at
                .get(agent_key)
                .copied()
                .or_else(|| self.state_repo.last_shown_at(agent_key).ok().flatten())
        };
        let cooldown = check_cooldown(settings.cooldown_minutes, last_shown, now);
        if cooldown.active {
            if cooldown.clock_rollback {
                eprintln!(
                    "[agenttips] reminder_skipped agent_id={} reason=REMINDER_CLOCK_ROLLBACK",
                    agent_key
                );
            }
            return ReminderDecision::SkipCooldown {
                remaining_secs: cooldown.remaining_secs,
            };
        }

        let payload = ReminderPayload {
            agent_key: agent_key.to_string(),
            agent_id: agent.id,
            agent_display_name: agent.display_name,
            tips,
            generated_at: now,
        };

        // 同一 Agent 已可见 → 不重复（需求 62.13）。
        if let Ok(true) = self.presenter.is_visible() {
            if self
                .presenter
                .current_agent_key()
                .unwrap_or(None)
                .as_deref()
                == Some(agent_key)
            {
                return ReminderDecision::SkipAlreadyVisible;
            }
        }

        if let Err(err) = self.presenter.show(&payload) {
            // Show 失败不消耗 cooldown（需求 14 / 62.15）。
            eprintln!(
                "[agenttips] reminder_show_failed agent_id={} err={err}",
                agent_key
            );
            return ReminderDecision::Error {
                reason: format!("PRESENTER_SHOW_FAILED: {err}"),
            };
        }

        // 成功显示：先更新 in-memory，再持久化（需求 15）。
        {
            let mut memory = self.memory.lock().unwrap();
            memory.last_shown_at.insert(agent_key.to_string(), now);
            memory.last_payload = Some(payload.clone());
        }
        if let Err(err) = self.state_repo.set_last_shown_at(agent_key, now) {
            eprintln!(
                "[agenttips] REMINDER_STATE_PERSIST_FAILED agent_id={} err={err}",
                agent_key
            );
            // 持久化失败不重新弹；重启后可能提前提醒 = 已知降级（需求 15）。
        }
        eprintln!(
            "[agenttips] reminder_shown agent_id={} tip_count={}",
            agent_key,
            payload.tips.len()
        );
        ReminderDecision::Show { payload }
    }
}

impl ReminderCoordinatorPort for ReminderCoordinator {
    fn on_detection_change(&self, result: &DetectionResult, transition: &Transition) {
        let now = self.clock.now_utc();
        let decision = match (result, transition) {
            // 只有 raw Matched + Entered/Changed 才可行动（需求 6/7/61）。
            (DetectionResult::Matched { agent_id, .. }, Transition::Entered(entered))
                if entered == agent_id =>
            {
                Some(self.evaluate(agent_id, now))
            }
            // Changed A→B：evaluate B；B 不通过则隐藏 A（需求 62.12 / 78）。
            (DetectionResult::Matched { agent_id, .. }, Transition::Changed { .. }) => {
                let decision = self.evaluate(agent_id, now);
                if !matches!(decision, ReminderDecision::Show { .. }) {
                    let _ = self.hide_current();
                }
                Some(decision)
            }
            // Left：不评估 show；若已可见则隐藏（需求 7/62.11）。
            (_, Transition::Left(_)) => {
                match self.hide_current() {
                    Ok(true) => {
                        eprintln!("[agenttips] reminder_hidden reason=agent_left");
                    }
                    Ok(false) => {}
                    Err(err) => eprintln!("[agenttips] reminder_hide_failed err={err}"),
                }
                None
            }
            // SelfWindow / Unavailable / Ambiguous / NoMatch+None / None：一律不评估。
            _ => None,
        };

        if let Some(ReminderDecision::SkipCooldown { remaining_secs }) = &decision {
            let agent = match result {
                DetectionResult::Matched { agent_id, .. } => agent_id.as_str(),
                _ => "<none>",
            };
            eprintln!(
                "[agenttips] reminder_skipped agent_id={} reason=cooldown remaining_secs={}",
                agent, remaining_secs
            );
        }
        if let Some(ReminderDecision::SkipSnoozed { remaining_secs }) = &decision {
            let agent = match result {
                DetectionResult::Matched { agent_id, .. } => agent_id.as_str(),
                _ => "<none>",
            };
            eprintln!(
                "[agenttips] reminder_skipped agent_id={} reason=snoozed remaining_secs={}",
                agent, remaining_secs
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use uuid::Uuid;

    use crate::domain::color::NoteColorKey;
    use crate::domain::detection::MatchKind;
    use crate::domain::reminder::{validate_cooldown_minutes, ReminderSettings, ReminderTip};
    use crate::error::AppError;
    use crate::ports::reminder::AgentIdentity;

    struct FakeClock {
        now: StdMutex<DateTime<Utc>>,
    }
    impl Clock for FakeClock {
        fn now_utc(&self) -> DateTime<Utc> {
            *self.now.lock().unwrap()
        }
    }

    #[derive(Default)]
    struct FakeEligibility {
        tips: StdMutex<HashMap<String, Vec<ReminderTip>>>,
    }
    impl ReminderEligibilityPort for FakeEligibility {
        fn agent_info(&self, agent_key: &str) -> AppResult<Option<AgentIdentity>> {
            Ok(match agent_key {
                "cursor" => Some(AgentIdentity {
                    id: Uuid::parse_str("10000000-0000-0000-0000-000000000001").unwrap(),
                    display_name: "Cursor".into(),
                }),
                "codex" => Some(AgentIdentity {
                    id: Uuid::parse_str("10000000-0000-0000-0000-000000000002").unwrap(),
                    display_name: "Codex".into(),
                }),
                _ => None,
            })
        }
        fn eligible_tips(&self, agent_key: &str) -> AppResult<Vec<ReminderTip>> {
            Ok(self
                .tips
                .lock()
                .unwrap()
                .get(agent_key)
                .cloned()
                .unwrap_or_default())
        }
    }

    #[derive(Default)]
    struct FakeStateRepo {
        cooldown_minutes: StdMutex<i64>,
        last_shown: StdMutex<HashMap<String, DateTime<Utc>>>,
        snoozed: StdMutex<HashMap<String, DateTime<Utc>>>,
        fail_persist: StdMutex<bool>,
        fail_snooze_persist: StdMutex<bool>,
    }
    impl ReminderStateRepositoryPort for FakeStateRepo {
        fn get_settings(&self) -> AppResult<ReminderSettings> {
            Ok(ReminderSettings {
                cooldown_minutes: validate_cooldown_minutes(*self.cooldown_minutes.lock().unwrap())
                    .unwrap_or(15),
                updated_at: Utc::now(),
            })
        }
        fn update_settings(&self, cooldown_minutes: i64) -> AppResult<ReminderSettings> {
            validate_cooldown_minutes(cooldown_minutes)?;
            *self.cooldown_minutes.lock().unwrap() = cooldown_minutes;
            Ok(ReminderSettings {
                cooldown_minutes,
                updated_at: Utc::now(),
            })
        }
        fn last_shown_at(&self, agent_key: &str) -> AppResult<Option<DateTime<Utc>>> {
            Ok(self.last_shown.lock().unwrap().get(agent_key).copied())
        }
        fn set_last_shown_at(&self, agent_key: &str, at: DateTime<Utc>) -> AppResult<()> {
            if *self.fail_persist.lock().unwrap() {
                return Err(AppError::Database("模拟持久化失败".into()));
            }
            self.last_shown
                .lock()
                .unwrap()
                .insert(agent_key.to_string(), at);
            Ok(())
        }
        fn snoozed_until(&self, agent_key: &str) -> AppResult<Option<DateTime<Utc>>> {
            Ok(self.snoozed.lock().unwrap().get(agent_key).copied())
        }
        fn list_snoozed_until(&self) -> AppResult<Vec<ReminderSnoozeResult>> {
            Ok(self
                .snoozed
                .lock()
                .unwrap()
                .iter()
                .map(|(agent_key, snoozed_until)| ReminderSnoozeResult {
                    agent_key: agent_key.clone(),
                    snoozed_until: *snoozed_until,
                })
                .collect())
        }
        fn set_snoozed_until(
            &self,
            agent_key: &str,
            until: Option<DateTime<Utc>>,
        ) -> AppResult<()> {
            if *self.fail_snooze_persist.lock().unwrap() {
                return Err(AppError::Database("模拟暂停提醒持久化失败".into()));
            }
            let mut snoozed = self.snoozed.lock().unwrap();
            if let Some(until) = until {
                snoozed.insert(agent_key.to_string(), until);
            } else {
                snoozed.remove(agent_key);
            }
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakePresenter {
        shown: StdMutex<Vec<String>>,
        hidden: StdMutex<usize>,
        visible: StdMutex<bool>,
        current_key: StdMutex<Option<String>>,
        fail_show: StdMutex<bool>,
    }
    impl ReminderPresenterPort for FakePresenter {
        fn show(&self, payload: &ReminderPayload) -> AppResult<()> {
            if *self.fail_show.lock().unwrap() {
                return Err(AppError::Window("模拟展示失败".into()));
            }
            self.shown.lock().unwrap().push(payload.agent_key.clone());
            *self.visible.lock().unwrap() = true;
            *self.current_key.lock().unwrap() = Some(payload.agent_key.clone());
            Ok(())
        }
        fn hide(&self) -> AppResult<()> {
            *self.hidden.lock().unwrap() += 1;
            *self.visible.lock().unwrap() = false;
            *self.current_key.lock().unwrap() = None;
            Ok(())
        }
        fn is_visible(&self) -> AppResult<bool> {
            Ok(*self.visible.lock().unwrap())
        }
        fn current_agent_key(&self) -> AppResult<Option<String>> {
            Ok(self.current_key.lock().unwrap().clone())
        }
    }

    fn tip(id: u32) -> ReminderTip {
        ReminderTip {
            tip_id: Uuid::new_v4(),
            title: Some(format!("Tip {id}")),
            body: format!("body {id}"),
            color_key: NoteColorKey::Lemon,
        }
    }

    struct Harness {
        clock: Arc<FakeClock>,
        eligibility: Arc<FakeEligibility>,
        state: Arc<FakeStateRepo>,
        presenter: Arc<FakePresenter>,
        coordinator: ReminderCoordinator,
        base: DateTime<Utc>,
    }

    fn harness() -> Harness {
        let clock = Arc::new(FakeClock {
            now: StdMutex::new(
                chrono::DateTime::parse_from_rfc3339("2026-08-08T09:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
            ),
        });
        let base = *clock.now.lock().unwrap();
        let eligibility = Arc::new(FakeEligibility::default());
        let state = Arc::new(FakeStateRepo::default());
        let presenter = Arc::new(FakePresenter::default());
        let coordinator = ReminderCoordinator::new(
            eligibility.clone(),
            state.clone(),
            presenter.clone(),
            clock.clone(),
        );
        Harness {
            clock,
            eligibility,
            state,
            presenter,
            coordinator,
            base,
        }
    }

    fn matched(agent: &str) -> DetectionResult {
        DetectionResult::Matched {
            agent_id: agent.into(),
            match_kind: MatchKind::ExactExecutable,
        }
    }

    fn entered(agent: &str) -> Transition {
        Transition::Entered(agent.into())
    }

    fn changed(from: &str, to: &str) -> Transition {
        Transition::Changed {
            from: from.into(),
            to: to.into(),
        }
    }

    #[test]
    fn actionable_matrix_matched_entered_and_changed() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().as_slice(), ["cursor"]);

        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("codex".into(), vec![tip(2)]);
        h.coordinator
            .on_detection_change(&matched("codex"), &changed("cursor", "codex"));
        assert_eq!(
            h.presenter.shown.lock().unwrap().as_slice(),
            ["cursor", "codex"]
        );
    }

    #[test]
    fn matched_none_not_actionable() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &Transition::None);
        assert!(h.presenter.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn self_window_not_actionable() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&DetectionResult::SelfWindow, &Transition::None);
        assert!(h.presenter.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn unavailable_not_actionable() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator.on_detection_change(
            &DetectionResult::Unavailable {
                reason: "TERMINAL_SESSION_AMBIGUOUS".into(),
            },
            &Transition::None,
        );
        assert!(h.presenter.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn stale_effective_unavailable_never_shows() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        // 用户曾进入 cursor（effective 保留），随后 raw=Unavailable（Ambiguous）
        h.coordinator.on_detection_change(
            &DetectionResult::Unavailable {
                reason: "TERMINAL_SESSION_AMBIGUOUS".into(),
            },
            &Transition::None,
        );
        assert!(h.presenter.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn no_eligible_no_show_no_cooldown() {
        let h = harness();
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert!(h.presenter.shown.lock().unwrap().is_empty());
        assert!(h.state.last_shown.lock().unwrap().is_empty());
    }

    #[test]
    fn cooldown_active_blocks() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.state
            .last_shown
            .lock()
            .unwrap()
            .insert("cursor".into(), h.base);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert!(h.presenter.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn cooldown_expired_new_entry_shows() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.state
            .last_shown
            .lock()
            .unwrap()
            .insert("cursor".into(), h.base - chrono::Duration::minutes(15));
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().as_slice(), ["cursor"]);
    }

    #[test]
    fn show_updates_in_memory_and_persists() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().len(), 1);
        assert_eq!(
            h.state.last_shown.lock().unwrap().get("cursor"),
            Some(&h.base)
        );
    }

    #[test]
    fn persist_failure_no_duplicate_in_process() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        *h.state.fail_persist.lock().unwrap() = true;
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().len(), 1);
        // 同进程再次 Entered（理论上同 agent 不会再产生，防御性验证 in-memory 生效）
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().len(), 1);
    }

    #[test]
    fn cooldown_expires_while_staying_same_agent_no_auto_show() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        // 15 分钟后仍在 cursor：raw Matched + Transition None → 不评估
        *h.clock.now.lock().unwrap() = h.base + chrono::Duration::minutes(16);
        h.coordinator
            .on_detection_change(&matched("cursor"), &Transition::None);
        assert_eq!(h.presenter.shown.lock().unwrap().len(), 1);
    }

    #[test]
    fn left_hides_visible_reminder() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert!(*h.presenter.visible.lock().unwrap());
        h.coordinator
            .on_detection_change(&DetectionResult::NoMatch, &entered("cursor"));
        h.coordinator.on_detection_change(
            &DetectionResult::NoMatch,
            &Transition::Left("cursor".into()),
        );
        assert!(!*h.presenter.visible.lock().unwrap());
        assert_eq!(*h.presenter.hidden.lock().unwrap(), 1);
    }

    #[test]
    fn changed_agent_replaces_payload() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("codex".into(), vec![tip(2)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        h.coordinator
            .on_detection_change(&matched("codex"), &changed("cursor", "codex"));
        assert_eq!(
            h.presenter.shown.lock().unwrap().as_slice(),
            ["cursor", "codex"]
        );
        assert!(*h.presenter.visible.lock().unwrap());
        assert_eq!(
            h.presenter.current_agent_key().unwrap().as_deref(),
            Some("codex")
        );
    }

    #[test]
    fn changed_agent_skip_hides_previous() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        // codex 无 eligible tips → B 不通过 → 隐藏 A
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        h.coordinator
            .on_detection_change(&matched("codex"), &changed("cursor", "codex"));
        assert_eq!(h.presenter.shown.lock().unwrap().as_slice(), ["cursor"]);
        assert!(!*h.presenter.visible.lock().unwrap());
    }

    #[test]
    fn same_agent_already_visible_no_duplicate() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        // 模拟异常：同 agent 再次 Entered（reducer 正常不会产生）
        *h.clock.now.lock().unwrap() = h.base + chrono::Duration::minutes(16);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().len(), 1);
    }

    #[test]
    fn per_agent_cooldown_independent() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("codex".into(), vec![tip(2)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        // cursor cooldown active，但 codex 自己的冷却独立 → 可提醒
        h.coordinator
            .on_detection_change(&matched("codex"), &changed("cursor", "codex"));
        assert_eq!(
            h.presenter.shown.lock().unwrap().as_slice(),
            ["cursor", "codex"]
        );
    }

    #[test]
    fn presenter_failure_no_cooldown_consumption() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        *h.presenter.fail_show.lock().unwrap() = true;
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert!(h.presenter.shown.lock().unwrap().is_empty());
        assert!(h.state.last_shown.lock().unwrap().is_empty());
        // 修复 presenter 后立刻可提醒（冷却未被消耗）
        *h.presenter.fail_show.lock().unwrap() = false;
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().as_slice(), ["cursor"]);
    }

    #[test]
    fn settings_change_affects_next_entry() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().len(), 1);
        // 改冷却为 1 分钟
        h.state.update_settings(1).unwrap();
        *h.clock.now.lock().unwrap() = h.base + chrono::Duration::minutes(2);
        // 离开并重进（Left → Entered）
        h.coordinator.on_detection_change(
            &DetectionResult::NoMatch,
            &Transition::Left("cursor".into()),
        );
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert_eq!(h.presenter.shown.lock().unwrap().len(), 2);
    }

    #[test]
    fn startup_state_restored_respects_cooldown() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        // 模拟重启后 in-memory 为空，repo 有 last_shown（5 分钟前）
        h.state
            .last_shown
            .lock()
            .unwrap()
            .insert("cursor".into(), h.base - chrono::Duration::minutes(5));
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert!(h.presenter.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn snooze_current_persists_then_hides() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));

        let result = h.coordinator.snooze_current(4).unwrap();

        assert_eq!(result.agent_key, "cursor");
        assert_eq!(result.snoozed_until, h.base + chrono::Duration::hours(4));
        assert_eq!(
            h.state.snoozed.lock().unwrap().get("cursor"),
            Some(&result.snoozed_until)
        );
        assert!(!*h.presenter.visible.lock().unwrap());
        assert_eq!(*h.presenter.hidden.lock().unwrap(), 1);
        assert!(h.coordinator.current_payload().is_none());
    }

    #[test]
    fn settings_snoozes_agents_independently_and_resumes_only_one() {
        let h = harness();

        let cursor = h.coordinator.snooze_agent("cursor", 4).unwrap();
        let codex = h.coordinator.snooze_agent("codex", 8).unwrap();

        assert_eq!(cursor.snoozed_until, h.base + chrono::Duration::hours(4));
        assert_eq!(codex.snoozed_until, h.base + chrono::Duration::hours(8));
        let listed = h.coordinator.list_agent_snoozes().unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|entry| entry.agent_key == "cursor"));
        assert!(listed.iter().any(|entry| entry.agent_key == "codex"));
        assert_eq!(*h.presenter.hidden.lock().unwrap(), 0);

        h.coordinator.resume_agent("cursor").unwrap();

        assert_eq!(h.state.snoozed.lock().unwrap().get("cursor"), None);
        assert_eq!(
            h.state.snoozed.lock().unwrap().get("codex"),
            Some(&codex.snoozed_until)
        );
        let listed = h.coordinator.list_agent_snoozes().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].agent_key, "codex");
    }

    #[test]
    fn settings_snooze_list_excludes_expired_rows() {
        let h = harness();
        h.state
            .snoozed
            .lock()
            .unwrap()
            .insert("cursor".into(), h.base - chrono::Duration::seconds(1));
        h.state
            .snoozed
            .lock()
            .unwrap()
            .insert("codex".into(), h.base + chrono::Duration::hours(2));

        let listed = h.coordinator.list_agent_snoozes().unwrap();

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].agent_key, "codex");
    }

    #[test]
    fn snooze_without_current_agent_is_rejected() {
        let h = harness();
        assert!(h.coordinator.snooze_current(4).is_err());
        assert!(h.state.snoozed.lock().unwrap().is_empty());
        assert_eq!(*h.presenter.hidden.lock().unwrap(), 0);
    }

    #[test]
    fn snooze_persistence_failure_keeps_reminder_visible() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        *h.state.fail_snooze_persist.lock().unwrap() = true;

        assert!(h.coordinator.snooze_current(4).is_err());

        assert!(*h.presenter.visible.lock().unwrap());
        assert_eq!(*h.presenter.hidden.lock().unwrap(), 0);
        assert!(h.coordinator.current_payload().is_some());
    }

    #[test]
    fn snoozed_agent_is_skipped_without_advancing_cooldown() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.state
            .snoozed
            .lock()
            .unwrap()
            .insert("cursor".into(), h.base + chrono::Duration::hours(4));

        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));

        assert!(h.presenter.shown.lock().unwrap().is_empty());
        assert!(h.state.last_shown.lock().unwrap().is_empty());
    }

    #[test]
    fn another_agent_is_not_blocked_by_snooze() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("codex".into(), vec![tip(2)]);
        h.state
            .snoozed
            .lock()
            .unwrap()
            .insert("cursor".into(), h.base + chrono::Duration::hours(4));

        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        h.coordinator
            .on_detection_change(&matched("codex"), &changed("cursor", "codex"));

        assert_eq!(h.presenter.shown.lock().unwrap().as_slice(), ["codex"]);
    }

    #[test]
    fn expired_snooze_returns_to_normal_evaluation() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        h.state
            .snoozed
            .lock()
            .unwrap()
            .insert("cursor".into(), h.base - chrono::Duration::seconds(1));

        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));

        assert_eq!(h.presenter.shown.lock().unwrap().as_slice(), ["cursor"]);
    }

    #[test]
    fn clock_rollback_no_show() {
        let h = harness();
        h.eligibility
            .tips
            .lock()
            .unwrap()
            .insert("cursor".into(), vec![tip(1)]);
        // last_shown 在未来（系统时间回拨）
        h.state
            .last_shown
            .lock()
            .unwrap()
            .insert("cursor".into(), h.base + chrono::Duration::minutes(30));
        h.coordinator
            .on_detection_change(&matched("cursor"), &entered("cursor"));
        assert!(h.presenter.shown.lock().unwrap().is_empty());
    }
}
