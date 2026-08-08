use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder};

use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SWP_NOSIZE,
    SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE,
};

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
                WindowLabel::Reminder => "AgentTips 提醒",
            })
            .inner_size(
                match label {
                    WindowLabel::Main => 1100.0,
                    WindowLabel::QuickNote => 740.0,
                    WindowLabel::Settings => 860.0,
                    WindowLabel::Reminder => 440.0,
                },
                match label {
                    WindowLabel::Main => 760.0,
                    WindowLabel::QuickNote => 520.0,
                    WindowLabel::Settings => 620.0,
                    WindowLabel::Reminder => 540.0,
                },
            )
            .min_inner_size(
                match label {
                    WindowLabel::Main => 900.0,
                    WindowLabel::QuickNote => 640.0,
                    WindowLabel::Settings => 720.0,
                    WindowLabel::Reminder => 380.0,
                },
                match label {
                    WindowLabel::Main => 620.0,
                    WindowLabel::QuickNote => 420.0,
                    WindowLabel::Settings => 520.0,
                    WindowLabel::Reminder => 380.0,
                },
            )
            .resizable(label != WindowLabel::Reminder)
            .decorations(label != WindowLabel::Reminder)
            .center();
        builder = builder.max_inner_size(
            match label {
                WindowLabel::Reminder => 460.0,
                _ => 820.0,
            },
            match label {
                WindowLabel::Reminder => 560.0,
                _ => 680.0,
            },
        );
        // Reminder 懒创建时先隐藏，由 show_without_activation 以非激活方式显示。
        if label == WindowLabel::Reminder {
            builder = builder.visible(false);
        }
        let window = builder
            .build()
            .map_err(|e| AppError::Window(e.to_string()))?;
        Ok(window)
    }

    /// Reminder 显示位置：当前前台窗口所在显示器工作区右下角（margin 16px）。
    fn reminder_position(&self, width: i32, height: i32) -> (i32, i32) {
        let margin = 16;
        let foreground = unsafe { GetForegroundWindow() };
        let monitor = unsafe { MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            rcWork: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            dwFlags: 0,
        };
        let ok = unsafe { GetMonitorInfoW(monitor, &mut info) };
        if ok == 0 {
            return (margin, margin);
        }
        let work = info.rcWork;
        let x = work.right - width - margin;
        let y = work.bottom - height - margin;
        (x.max(work.left + margin), y.max(work.top + margin))
    }
}

impl WindowManagerPort for TauriWindowManager {
    fn show(&self, label: WindowLabel) -> AppResult<()> {
        let window = self.ensure(label)?;
        // 若窗口处于最小化状态，先恢复（unminimize），保证 Hotkey/Tray 唤醒后可见。
        if window.is_minimized().unwrap_or(false) {
            window
                .unminimize()
                .map_err(|e| AppError::Window(e.to_string()))?;
        }
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
            // Reminder 由原生 show_without_activation 显示，隐藏也走原生 SW_HIDE 兜底，
            // 保证 Windows 窗口真实隐藏（避免 Tauri 状态与实际可见性不一致）。
            #[cfg(target_os = "windows")]
            if let Ok(hwnd) = window.hwnd() {
                let _ = unsafe { ShowWindow(hwnd.0, SW_HIDE) };
            }
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

    fn show_without_activation(&self, label: WindowLabel) -> AppResult<()> {
        let window = self.ensure(label)?;
        #[cfg(target_os = "windows")]
        {
            let hwnd = window.hwnd().map_err(|e| AppError::Window(e.to_string()))?;
            let hwnd_raw = hwnd.0;
            let (width, height) = {
                let size = window
                    .inner_size()
                    .map_err(|e| AppError::Window(e.to_string()))?;
                (size.width as i32, size.height as i32)
            };
            let (x, y) = self.reminder_position(width, height);
            let flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSIZE;
            let moved = unsafe { SetWindowPos(hwnd_raw, HWND_TOP, x, y, 0, 0, flags) };
            if moved == 0 {
                return Err(AppError::Window("Reminder SetWindowPos 失败".to_string()));
            }
            // ShowWindow 返回值表示"先前是否可见"，隐藏→显示返回 0，不视为失败。
            let _ = unsafe { ShowWindow(hwnd_raw, SW_SHOWNOACTIVATE) };
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = label;
            Ok(())
        }
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
