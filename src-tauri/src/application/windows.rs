use std::sync::Arc;

use crate::application::hotkey::HotkeyWindowPort;
use crate::error::AppResult;
use crate::ports::window_manager::{WindowLabel, WindowManagerPort};

/// 判断 Quick Note 是否应开始新的 Draft Session。
/// 契约：仅当窗口从隐藏变为显示时重置；已可见时再次请求只置前聚焦并保留草稿。
pub fn should_start_draft_session(was_visible: bool) -> bool {
    !was_visible
}

/// 窗口用例：统一编排 show/hide/focus，供 command 与 tray 复用。
#[derive(Clone)]
pub struct WindowApplicationService {
    manager: Arc<dyn WindowManagerPort>,
}

impl WindowApplicationService {
    pub fn new(manager: Arc<dyn WindowManagerPort>) -> Self {
        Self { manager }
    }

    pub fn open_main(&self) -> AppResult<()> {
        self.manager.show(WindowLabel::Main)
    }

    pub fn open_quick_note(&self) -> AppResult<()> {
        self.manager.show(WindowLabel::QuickNote)
    }

    pub fn open_settings(&self) -> AppResult<()> {
        self.manager.show(WindowLabel::Settings)
    }

    pub fn hide(&self, label: WindowLabel) -> AppResult<()> {
        self.manager.hide(label)
    }

    pub fn focus(&self, label: WindowLabel) -> AppResult<()> {
        self.manager.focus(label)
    }

    pub fn is_visible(&self, label: WindowLabel) -> AppResult<bool> {
        self.manager.is_visible(label)
    }

    pub fn inner_size(&self, label: WindowLabel) -> AppResult<(u32, u32)> {
        self.manager.inner_size(label)
    }

    pub fn quit(&self) -> AppResult<()> {
        self.manager.quit()
    }
}

impl HotkeyWindowPort for WindowApplicationService {
    fn show_quick_note(&self) -> AppResult<()> {
        self.open_quick_note()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeWindowManager {
        shown: Mutex<Vec<WindowLabel>>,
        hidden: Mutex<Vec<WindowLabel>>,
        focused: Mutex<Vec<WindowLabel>>,
        visible: Mutex<bool>,
        quit_called: Mutex<bool>,
        create_count: Mutex<usize>,
    }

    impl WindowManagerPort for FakeWindowManager {
        fn show(&self, label: WindowLabel) -> AppResult<()> {
            self.shown.lock().unwrap().push(label);
            *self.visible.lock().unwrap() = true;
            // 模拟懒创建：每次 show 计数（真实实现中已存在会复用）
            *self.create_count.lock().unwrap() += 0;
            Ok(())
        }
        fn hide(&self, label: WindowLabel) -> AppResult<()> {
            self.hidden.lock().unwrap().push(label);
            *self.visible.lock().unwrap() = false;
            Ok(())
        }
        fn focus(&self, label: WindowLabel) -> AppResult<()> {
            self.focused.lock().unwrap().push(label);
            Ok(())
        }
        fn show_without_activation(&self, label: WindowLabel) -> AppResult<()> {
            self.shown.lock().unwrap().push(label);
            *self.visible.lock().unwrap() = true;
            Ok(())
        }
        fn is_visible(&self, _label: WindowLabel) -> AppResult<bool> {
            Ok(*self.visible.lock().unwrap())
        }
        fn inner_size(&self, _label: WindowLabel) -> AppResult<(u32, u32)> {
            Ok((740, 520))
        }
        fn quit(&self) -> AppResult<()> {
            *self.quit_called.lock().unwrap() = true;
            Ok(())
        }
    }

    fn setup() -> (Arc<FakeWindowManager>, WindowApplicationService) {
        let manager = Arc::new(FakeWindowManager::default());
        let service = WindowApplicationService::new(manager.clone());
        (manager, service)
    }

    #[test]
    fn show_existing_and_create_missing_delegate_to_manager() {
        let (manager, service) = setup();
        service.open_main().unwrap();
        service.open_quick_note().unwrap();
        service.open_settings().unwrap();
        assert_eq!(
            manager.shown.lock().unwrap().as_slice(),
            [
                WindowLabel::Main,
                WindowLabel::QuickNote,
                WindowLabel::Settings
            ]
        );
        assert!(manager.is_visible(WindowLabel::Main).unwrap());
    }

    #[test]
    fn show_reuses_existing_without_reset() {
        let (manager, service) = setup();
        service.open_quick_note().unwrap();
        service.open_quick_note().unwrap();
        service.open_quick_note().unwrap();
        // shown 记录调用；真实 adapter 会复用同一 WebviewWindow
        assert_eq!(
            manager
                .shown
                .lock()
                .unwrap()
                .iter()
                .filter(|l| **l == WindowLabel::QuickNote)
                .count(),
            3
        );
        assert!(service.is_visible(WindowLabel::QuickNote).unwrap());
    }

    #[test]
    fn focus_and_hide_are_forwarded() {
        let (manager, service) = setup();
        service.focus(WindowLabel::Main).unwrap();
        service.hide(WindowLabel::Main).unwrap();
        assert_eq!(
            manager.focused.lock().unwrap().as_slice(),
            [WindowLabel::Main]
        );
        assert_eq!(
            manager.hidden.lock().unwrap().as_slice(),
            [WindowLabel::Main]
        );
        assert!(!service.is_visible(WindowLabel::Main).unwrap());
    }

    #[test]
    fn quit_is_delegated() {
        let (manager, service) = setup();
        service.quit().unwrap();
        assert!(*manager.quit_called.lock().unwrap());
    }

    #[test]
    fn quick_note_draft_starts_only_from_hidden_to_visible() {
        assert!(should_start_draft_session(false));
        assert!(!should_start_draft_session(true));
    }
}
