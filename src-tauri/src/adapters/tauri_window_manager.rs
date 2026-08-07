use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::application::windows::should_start_draft_session;
use crate::error::{AppError, AppResult};
use crate::ports::window_manager::{WindowLabel, WindowManagerPort};

/// 真实 Tauri 窗口管理器：
/// - main 启动时由 lib.rs 创建（本适配器 lazy 兜底）；
/// - quick-note / settings 懒创建，之后隐藏/显示复用（窗口唯一性）。
pub struct TauriWindowManager {
    app: AppHandle,
}

impl TauriWindowManager {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    fn get(&self, label: WindowLabel) -> Option<WebviewWindow> {
        self.app.get_webview_window(label.as_str())
    }

    fn ensure(&self, label: WindowLabel) -> AppResult<WebviewWindow> {
        if let Some(window) = self.get(label) {
            return Ok(window);
        }
        let mut builder =
            WebviewWindowBuilder::new(&self.app, label.as_str(), tauri::WebviewUrl::default());
        builder = builder
            .title(match label {
                WindowLabel::Main => "AgentTips",
                WindowLabel::QuickNote => "新建提示",
                WindowLabel::Settings => "设置",
            })
            .inner_size(
                match label {
                    WindowLabel::Main => 1100.0,
                    WindowLabel::QuickNote => 740.0,
                    WindowLabel::Settings => 860.0,
                },
                match label {
                    WindowLabel::Main => 760.0,
                    WindowLabel::QuickNote => 520.0,
                    WindowLabel::Settings => 620.0,
                },
            )
            .min_inner_size(
                match label {
                    WindowLabel::Main => 900.0,
                    WindowLabel::QuickNote => 640.0,
                    WindowLabel::Settings => 720.0,
                },
                match label {
                    WindowLabel::Main => 620.0,
                    WindowLabel::QuickNote => 420.0,
                    WindowLabel::Settings => 520.0,
                },
            )
            .resizable(true)
            .decorations(true)
            .center();
        if label == WindowLabel::QuickNote {
            builder = builder.max_inner_size(820.0, 680.0).always_on_top(true);
        }
        let window = builder
            .build()
            .map_err(|e| AppError::Window(e.to_string()))?;
        Ok(window)
    }
}

impl WindowManagerPort for TauriWindowManager {
    fn show(&self, label: WindowLabel) -> AppResult<()> {
        let window = self.ensure(label)?;
        let was_visible = window.is_visible().unwrap_or(false);
        if was_visible {
            window
                .set_focus()
                .map_err(|e| AppError::Window(e.to_string()))?;
        } else {
            window.show().map_err(|e| AppError::Window(e.to_string()))?;
            window
                .set_focus()
                .map_err(|e| AppError::Window(e.to_string()))?;
        }
        // Quick Note 仅从隐藏变为显示时开始新的 Draft Session；
        // 已可见时再次请求只置前聚焦，保留正在编辑的内容。
        if label == WindowLabel::QuickNote && should_start_draft_session(was_visible) {
            let _ = window.emit(
                "agenttips://quick-note/reset",
                serde_json::json!({ "openedAt": chrono::Utc::now().to_rfc3339() }),
            );
        }
        Ok(())
    }

    fn hide(&self, label: WindowLabel) -> AppResult<()> {
        if let Some(window) = self.get(label) {
            window.hide().map_err(|e| AppError::Window(e.to_string()))?;
        }
        Ok(())
    }

    fn focus(&self, label: WindowLabel) -> AppResult<()> {
        let window = self
            .get(label)
            .ok_or_else(|| AppError::Window(format!("窗口 {} 不存在", label.as_str())))?;
        window
            .set_focus()
            .map_err(|e| AppError::Window(e.to_string()))?;
        Ok(())
    }

    fn is_visible(&self, label: WindowLabel) -> AppResult<bool> {
        Ok(self
            .get(label)
            .map(|w| w.is_visible().unwrap_or(false))
            .unwrap_or(false))
    }

    fn inner_size(&self, label: WindowLabel) -> AppResult<(u32, u32)> {
        let window = self
            .get(label)
            .ok_or_else(|| AppError::Window(format!("窗口 {} 不存在", label.as_str())))?;
        let size = window
            .inner_size()
            .map_err(|e| AppError::Window(e.to_string()))?;
        Ok((size.width, size.height))
    }

    fn quit(&self) -> AppResult<()> {
        self.app.exit(0);
        Ok(())
    }
}
