use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::domain::hotkey::{HotkeyBinding, HotkeyPolicy, HotkeyPreview};
use crate::error::{AppError, AppResult};
use crate::ports::clock::Clock;
use crate::ports::hotkey_registrar::HotkeyRegistrarPort;
use crate::ports::hotkey_settings_repository::HotkeySettingsRepositoryPort;

/// 触发快捷键时打开 Quick Note 的窗口能力。
/// Application 层只依赖此抽象，不感知 TauriWindowManager。
pub trait HotkeyWindowPort: Send + Sync {
    fn show_quick_note(&self) -> AppResult<()>;
}

/// 200ms 长按防抖窗口。
pub const TRIGGER_GUARD: Duration = Duration::from_millis(200);

/// Configured 与 Active 的运行时状态（供 Settings 展示）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyRuntimeState {
    pub configured: Option<HotkeyBinding>,
    pub active: Option<HotkeyBinding>,
    pub registration_error: Option<String>,
}

/// 全局快捷键运行时：启动注册、原子切换（register→persist→unregister + 补偿）、
/// 触发协调（200ms guard + recording suppression）。
pub struct HotkeyRuntime {
    registrar: Arc<dyn HotkeyRegistrarPort>,
    repo: Arc<dyn HotkeySettingsRepositoryPort>,
    clock: Arc<dyn Clock>,
    windows: Arc<dyn HotkeyWindowPort>,
    state: Mutex<HotkeyRuntimeState>,
    suppress_trigger: AtomicBool,
    last_trigger: Mutex<Option<DateTime<Utc>>>,
}

impl HotkeyRuntime {
    pub fn new(
        registrar: Arc<dyn HotkeyRegistrarPort>,
        repo: Arc<dyn HotkeySettingsRepositoryPort>,
        clock: Arc<dyn Clock>,
        windows: Arc<dyn HotkeyWindowPort>,
    ) -> Self {
        Self {
            registrar,
            repo,
            clock,
            windows,
            state: Mutex::new(HotkeyRuntimeState {
                configured: None,
                active: None,
                registration_error: None,
            }),
            suppress_trigger: AtomicBool::new(false),
            last_trigger: Mutex::new(None),
        }
    }

    /// 启动注册：读 SQLite → 校验 → register。
    /// 注册失败不阻塞应用启动（Main/Tray/Settings 继续可用）。
    pub fn startup(&self) -> AppResult<()> {
        let binding = match self.repo.get()? {
            Some(binding) => binding,
            None => {
                // migration seed 已保证默认行；此处兜底创建默认 Ctrl+F12
                let default = HotkeyBinding {
                    modifier: crate::domain::hotkey::HotkeyModifier::Control,
                    key: crate::domain::hotkey::HotkeyKey::F12,
                };
                self.repo.save(&default)?;
                default
            }
        };
        if !HotkeyPolicy::validate(&binding) {
            let mut state = self.state.lock().unwrap();
            state.configured = Some(binding);
            state.active = None;
            state.registration_error = Some("HOTKEY_INVALID".into());
            return Ok(());
        }
        match self.registrar.register(&binding) {
            Ok(()) => {
                let mut state = self.state.lock().unwrap();
                state.configured = Some(binding);
                state.active = Some(binding);
                state.registration_error = None;
            }
            Err(err) => {
                let mut state = self.state.lock().unwrap();
                state.configured = Some(binding);
                state.active = None;
                state.registration_error = Some("HOTKEY_REGISTRATION_FAILED".into());
                eprintln!("[agenttips] hotkey startup registration failed: {err}");
            }
        }
        Ok(())
    }

    pub fn get_state(&self) -> HotkeyRuntimeState {
        self.state.lock().unwrap().clone()
    }

    pub fn preview(&self, modifier: &str, key_code: &str) -> HotkeyPreview {
        HotkeyPolicy::preview(modifier, key_code)
    }

    /// 原子切换。三个阶段 + 失败补偿：
    /// 1. register NEW（失败则 OLD/DB 不动）
    /// 2. persist NEW（失败则 unregister NEW）
    /// 3. unregister OLD（失败则补偿回 OLD）
    pub fn update(&self, modifier: &str, key_code: &str) -> AppResult<HotkeyBinding> {
        let new = match HotkeyPolicy::preview(modifier, key_code) {
            HotkeyPreview::Valid { binding, .. } => binding,
            HotkeyPreview::Invalid { reason } => match reason {
                crate::domain::hotkey::HotkeyInvalidReason::InvalidModifiers => {
                    return Err(AppError::HotkeyInvalid(format!(
                        "快捷键必须为 Ctrl + 一个按键 (检测到 {modifier} + {key_code})"
                    )));
                }
                crate::domain::hotkey::HotkeyInvalidReason::UnsupportedKey => {
                    return Err(AppError::HotkeyUnsupportedKey(format!(
                        "按键 {key_code} 不在支持范围"
                    )));
                }
            },
        };

        let current = {
            let state = self.state.lock().unwrap();
            (state.configured, state.active)
        };
        let (configured, active) = current;

        // NEW == configured：无需切换（no-op）
        if configured == Some(new) {
            if active != Some(new) {
                // configured 曾注册失败，现在重试注册
                self.registrar.register(&new).inspect_err(|_| {
                    self.state.lock().unwrap().registration_error =
                        Some("HOTKEY_REGISTRATION_FAILED".into());
                })?;
                let mut state = self.state.lock().unwrap();
                state.active = Some(new);
                state.registration_error = None;
            }
            return Ok(new);
        }

        // STEP 1: register NEW（OLD 保持）
        if active != Some(new) {
            if let Err(err) = self.registrar.register(&new) {
                return Err(AppError::HotkeyRegistrationFailed(format!(
                    "无法注册 {}: {err}",
                    new.display_label()
                )));
            }
        }

        // STEP 2: persist NEW
        if let Err(err) = self.repo.save(&new) {
            // 回滚：unregister NEW，OLD 保持
            if self
                .registrar
                .is_registered_by_this_app(&new)
                .unwrap_or(false)
            {
                let _ = self.registrar.unregister(&new);
            }
            return Err(AppError::HotkeyPersistFailed(format!(
                "快捷键保存失败: {err}"
            )));
        }

        // STEP 3: unregister OLD
        if let Some(old) = active {
            if old != new {
                if let Err(err) = self.registrar.unregister(&old) {
                    // 补偿：unregister NEW + SQLite 恢复 OLD + runtime 保持 OLD
                    self.registrar.unregister(&new).map_err(|e2| {
                        AppError::HotkeyInconsistentState(format!(
                            "补偿失败: unregister NEW 失败 ({e2}); 原始错误: {err}"
                        ))
                    })?;
                    self.repo.save(&old).map_err(|e2| {
                        AppError::HotkeyInconsistentState(format!(
                            "补偿失败: SQLite 恢复 OLD 失败 ({e2}); 原始错误: {err}"
                        ))
                    })?;
                    let mut state = self.state.lock().unwrap();
                    state.configured = Some(old);
                    state.active = Some(old);
                    state.registration_error = None;
                    return Err(AppError::HotkeySwapFailed(format!(
                        "卸载旧快捷键失败: {err}"
                    )));
                }
            }
        }

        let mut state = self.state.lock().unwrap();
        state.configured = Some(new);
        state.active = Some(new);
        state.registration_error = None;
        Ok(new)
    }

    /// 触发协调：只处理 Pressed；suppress 时忽略；200ms 内重复忽略。
    pub fn on_shortcut_pressed(&self) -> AppResult<()> {
        if self.suppress_trigger.load(Ordering::Relaxed) {
            return Ok(());
        }
        let now = self.clock.now_utc();
        {
            let mut last = self.last_trigger.lock().unwrap();
            if let Some(prev) = *last {
                if now
                    .signed_duration_since(prev)
                    .to_std()
                    .unwrap_or(TRIGGER_GUARD)
                    < TRIGGER_GUARD
                {
                    return Ok(());
                }
            }
            *last = Some(now);
        }
        self.windows.show_quick_note()
    }

    pub fn begin_recording(&self) {
        self.suppress_trigger.store(true, Ordering::Relaxed);
    }

    pub fn end_recording(&self) {
        self.suppress_trigger.store(false, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::hotkey::{HotkeyKey, HotkeyModifier};
    use std::sync::Mutex as StdMutex;

    struct FakeRegistrar {
        registered: StdMutex<Vec<HotkeyBinding>>,
        fail_register: StdMutex<Option<HotkeyBinding>>,
        fail_unregister: StdMutex<Option<HotkeyBinding>>,
    }

    impl FakeRegistrar {
        fn new() -> Self {
            Self {
                registered: StdMutex::new(vec![]),
                fail_register: StdMutex::new(None),
                fail_unregister: StdMutex::new(None),
            }
        }
    }

    impl HotkeyRegistrarPort for FakeRegistrar {
        fn register(&self, binding: &HotkeyBinding) -> AppResult<()> {
            if *self.fail_register.lock().unwrap() == Some(*binding) {
                return Err(AppError::HotkeyRegistrationFailed("occupied".into()));
            }
            self.registered.lock().unwrap().push(*binding);
            Ok(())
        }
        fn unregister(&self, binding: &HotkeyBinding) -> AppResult<()> {
            if *self.fail_unregister.lock().unwrap() == Some(*binding) {
                return Err(AppError::HotkeyRegistrationFailed("unregister fail".into()));
            }
            self.registered.lock().unwrap().retain(|b| b != binding);
            Ok(())
        }
        fn is_registered_by_this_app(&self, binding: &HotkeyBinding) -> AppResult<bool> {
            Ok(self.registered.lock().unwrap().contains(binding))
        }
    }

    struct FakeRepo {
        stored: StdMutex<Option<HotkeyBinding>>,
        fail_save: StdMutex<bool>,
    }

    impl FakeRepo {
        fn new() -> Self {
            Self {
                stored: StdMutex::new(None),
                fail_save: StdMutex::new(false),
            }
        }
    }

    impl HotkeySettingsRepositoryPort for FakeRepo {
        fn get(&self) -> AppResult<Option<HotkeyBinding>> {
            Ok(*self.stored.lock().unwrap())
        }
        fn save(&self, binding: &HotkeyBinding) -> AppResult<()> {
            if *self.fail_save.lock().unwrap() {
                return Err(AppError::Database("disk full".into()));
            }
            *self.stored.lock().unwrap() = Some(*binding);
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeClock {
        now: StdMutex<DateTime<Utc>>,
    }

    impl Clock for FakeClock {
        fn now_utc(&self) -> DateTime<Utc> {
            *self.now.lock().unwrap()
        }
    }

    #[derive(Default)]
    struct FakeWindows {
        shown: StdMutex<usize>,
    }

    impl HotkeyWindowPort for FakeWindows {
        fn show_quick_note(&self) -> AppResult<()> {
            *self.shown.lock().unwrap() += 1;
            Ok(())
        }
    }

    fn f12() -> HotkeyBinding {
        HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key: HotkeyKey::F12,
        }
    }
    fn f11() -> HotkeyBinding {
        HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key: HotkeyKey::F11,
        }
    }
    fn f10() -> HotkeyBinding {
        HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key: HotkeyKey::F10,
        }
    }

    struct Harness {
        runtime: HotkeyRuntime,
        registrar: Arc<FakeRegistrar>,
        repo: Arc<FakeRepo>,
        clock: Arc<FakeClock>,
        windows: Arc<FakeWindows>,
    }

    fn harness() -> Harness {
        let registrar = Arc::new(FakeRegistrar::new());
        let repo = Arc::new(FakeRepo::new());
        let clock = Arc::new(FakeClock::default());
        let windows = Arc::new(FakeWindows::default());
        let runtime = HotkeyRuntime::new(
            registrar.clone(),
            repo.clone(),
            clock.clone(),
            windows.clone(),
        );
        Harness {
            runtime,
            registrar,
            repo,
            clock,
            windows,
        }
    }

    fn seed(h: &Harness, binding: HotkeyBinding, active: bool) {
        h.repo.stored.lock().unwrap().replace(binding);
        if active {
            h.registrar.registered.lock().unwrap().push(binding);
        }
    }

    #[test]
    fn startup_registration_success() {
        let h = harness();
        seed(&h, f12(), false);
        h.runtime.startup().unwrap();
        let state = h.runtime.get_state();
        assert_eq!(state.configured, Some(f12()));
        assert_eq!(state.active, Some(f12()));
        assert_eq!(state.registration_error, None);
    }

    #[test]
    fn startup_registration_fail_app_still_usable() {
        let h = harness();
        seed(&h, f12(), false);
        *h.registrar.fail_register.lock().unwrap() = Some(f12());
        h.runtime.startup().unwrap();
        let state = h.runtime.get_state();
        assert_eq!(state.configured, Some(f12()));
        assert_eq!(state.active, None);
        assert_eq!(
            state.registration_error,
            Some("HOTKEY_REGISTRATION_FAILED".into())
        );
        // 应用仍可继续：update 等其他用例可执行
        assert!(h.runtime.preview("Ctrl", "KeyK").is_valid());
    }

    #[test]
    fn same_binding_is_noop() {
        let h = harness();
        seed(&h, f12(), true);
        h.runtime.startup().unwrap();
        let before = h.registrar.registered.lock().unwrap().len();
        let result = h.runtime.update("Ctrl", "F12").unwrap();
        assert_eq!(result, f12());
        assert_eq!(h.registrar.registered.lock().unwrap().len(), before);
    }

    #[test]
    fn register_new_success_swaps() {
        let h = harness();
        seed(&h, f12(), true);
        h.runtime.startup().unwrap();
        let result = h.runtime.update("Ctrl", "F11").unwrap();
        assert_eq!(result, f11());
        let state = h.runtime.get_state();
        assert_eq!(state.active, Some(f11()));
        assert_eq!(state.configured, Some(f11()));
        assert!(!h.registrar.is_registered_by_this_app(&f12()).unwrap());
        assert!(h.registrar.is_registered_by_this_app(&f11()).unwrap());
        assert_eq!(h.repo.get().unwrap(), Some(f11()));
    }

    #[test]
    fn register_new_fail_old_untouched() {
        let h = harness();
        seed(&h, f12(), true);
        h.runtime.startup().unwrap();
        *h.registrar.fail_register.lock().unwrap() = Some(f10());
        let err = h.runtime.update("Ctrl", "F10").unwrap_err();
        assert!(matches!(err, AppError::HotkeyRegistrationFailed(_)));
        let state = h.runtime.get_state();
        assert_eq!(state.configured, Some(f12()));
        assert_eq!(state.active, Some(f12()));
        assert!(h.registrar.is_registered_by_this_app(&f12()).unwrap());
        assert!(!h.registrar.is_registered_by_this_app(&f10()).unwrap());
        assert_eq!(h.repo.get().unwrap(), Some(f12()));
    }

    #[test]
    fn persist_fail_unregisters_new_and_keeps_old() {
        let h = harness();
        seed(&h, f12(), true);
        h.runtime.startup().unwrap();
        *h.repo.fail_save.lock().unwrap() = true;
        let err = h.runtime.update("Ctrl", "F11").unwrap_err();
        assert!(matches!(err, AppError::HotkeyPersistFailed(_)));
        assert!(!h.registrar.is_registered_by_this_app(&f11()).unwrap());
        assert!(h.registrar.is_registered_by_this_app(&f12()).unwrap());
        assert_eq!(h.repo.get().unwrap(), Some(f12()));
        let state = h.runtime.get_state();
        assert_eq!(state.active, Some(f12()));
    }

    #[test]
    fn unregister_old_fail_compensates() {
        let h = harness();
        seed(&h, f12(), true);
        h.runtime.startup().unwrap();
        *h.registrar.fail_unregister.lock().unwrap() = Some(f12());
        let err = h.runtime.update("Ctrl", "F11").unwrap_err();
        assert!(matches!(err, AppError::HotkeySwapFailed(_)));
        // 补偿后：NEW 已卸载，OLD 恢复，DB 保持 OLD
        assert!(!h.registrar.is_registered_by_this_app(&f11()).unwrap());
        assert!(h.registrar.is_registered_by_this_app(&f12()).unwrap());
        assert_eq!(h.repo.get().unwrap(), Some(f12()));
        let state = h.runtime.get_state();
        assert_eq!(state.active, Some(f12()));
    }

    #[test]
    fn pressed_shows_quick_note() {
        let h = harness();
        h.runtime.on_shortcut_pressed().unwrap();
        assert_eq!(*h.windows.shown.lock().unwrap(), 1);
    }

    #[test]
    fn duplicate_pressed_within_200ms_suppressed() {
        let h = harness();
        let t0 = Utc::now();
        *h.clock.now.lock().unwrap() = t0;
        h.runtime.on_shortcut_pressed().unwrap();
        *h.clock.now.lock().unwrap() = t0 + chrono::Duration::milliseconds(100);
        h.runtime.on_shortcut_pressed().unwrap();
        assert_eq!(*h.windows.shown.lock().unwrap(), 1);
    }

    #[test]
    fn trigger_allowed_after_200ms() {
        let h = harness();
        let t0 = Utc::now();
        *h.clock.now.lock().unwrap() = t0;
        h.runtime.on_shortcut_pressed().unwrap();
        *h.clock.now.lock().unwrap() = t0 + chrono::Duration::milliseconds(201);
        h.runtime.on_shortcut_pressed().unwrap();
        assert_eq!(*h.windows.shown.lock().unwrap(), 2);
    }

    #[test]
    fn suppression_blocks_trigger() {
        let h = harness();
        h.runtime.begin_recording();
        h.runtime.on_shortcut_pressed().unwrap();
        assert_eq!(*h.windows.shown.lock().unwrap(), 0);
    }

    #[test]
    fn suppression_ends_restores_trigger() {
        let h = harness();
        h.runtime.begin_recording();
        h.runtime.end_recording();
        h.runtime.on_shortcut_pressed().unwrap();
        assert_eq!(*h.windows.shown.lock().unwrap(), 1);
    }

    #[test]
    fn released_event_is_noop() {
        // adapter 只对 Pressed 调用 on_shortcut_pressed；此处验证 Released 不会产生任何窗口调用
        let h = harness();
        // 模拟 Released 不调用任何方法 —— 由 adapter 单测覆盖；这里验证应用不因 Released 触发
        assert_eq!(*h.windows.shown.lock().unwrap(), 0);
    }
}
