use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

use crate::domain::reminder::ReminderPayload;
use crate::error::{AppError, AppResult};
use crate::ports::reminder::ReminderPresenterPort;
use crate::ports::window_manager::{WindowLabel, WindowManagerPort};

const REMINDER_SHOW_EVENT: &str = "agenttips://reminder/show";

/// 真实 Reminder 展示器：
/// - 窗口由 WindowManagerPort 懒创建并以非激活方式显示（不抢外部 Agent 焦点）；
/// - payload 通过 Tauri 事件发送给 reminder Webview（前端 listener 兜底拉取 current payload）；
/// - 不依赖永久 topmost（普通 z-order，用户点击其他应用后自然退后）。
pub struct TauriReminderPresenter {
    app: AppHandle,
    windows: Arc<dyn WindowManagerPort>,
    current_agent_key: Mutex<Option<String>>,
}

impl TauriReminderPresenter {
    pub fn new(app: AppHandle, windows: Arc<dyn WindowManagerPort>) -> Self {
        Self {
            app,
            windows,
            current_agent_key: Mutex::new(None),
        }
    }
}

impl ReminderPresenterPort for TauriReminderPresenter {
    fn show(&self, payload: &ReminderPayload) -> AppResult<()> {
        self.windows
            .show_without_activation(WindowLabel::Reminder)?;
        self.app
            .emit_to(WindowLabel::Reminder.as_str(), REMINDER_SHOW_EVENT, payload)
            .map_err(|e| AppError::Window(format!("Reminder 事件发送失败: {e}")))?;
        *self.current_agent_key.lock().unwrap() = Some(payload.agent_key.clone());
        Ok(())
    }

    fn hide(&self) -> AppResult<()> {
        self.windows.hide(WindowLabel::Reminder)?;
        *self.current_agent_key.lock().unwrap() = None;
        Ok(())
    }

    fn is_visible(&self) -> AppResult<bool> {
        self.windows.is_visible(WindowLabel::Reminder)
    }

    fn current_agent_key(&self) -> AppResult<Option<String>> {
        Ok(self.current_agent_key.lock().unwrap().clone())
    }
}
