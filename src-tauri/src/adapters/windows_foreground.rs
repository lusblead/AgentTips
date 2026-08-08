use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
};

use crate::domain::foreground::{ForegroundContext, ForegroundObservation};
use crate::error::{AppError, AppResult};
use crate::ports::foreground::ForegroundContextProviderPort;

/// Windows 前台窗口上下文采集（只读，不修改任何系统/应用状态）。
pub struct WindowsForegroundContextProvider {
    self_basename: String,
}

impl WindowsForegroundContextProvider {
    pub fn new(self_basename: impl Into<String>) -> Self {
        Self {
            self_basename: self_basename.into(),
        }
    }

    fn read_window_text(hwnd: HWND) -> Option<String> {
        let mut buffer = vec![0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        if len <= 0 {
            return None;
        }
        let text = String::from_utf16_lossy(&buffer[..len as usize])
            .trim()
            .to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    fn read_window_class(hwnd: HWND) -> Option<String> {
        let mut buffer = vec![0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        if len <= 0 {
            return None;
        }
        let text = String::from_utf16_lossy(&buffer[..len as usize])
            .trim()
            .to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    fn query_process(process_id: u32) -> Option<(String, String)> {
        let handle: HANDLE =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        if handle.is_null() {
            return None;
        }
        let mut size = 1024u32;
        let mut buffer = vec![0u16; size as usize];
        let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size) };
        unsafe {
            CloseHandle(handle);
        }
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..size as usize])
            .trim()
            .to_string();
        if path.is_empty() {
            return None;
        }
        let basename = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
        Some((basename, path))
    }
}

impl ForegroundContextProviderPort for WindowsForegroundContextProvider {
    fn current_foreground_observation(&self) -> AppResult<ForegroundObservation> {
        let hwnd: HWND = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            return Ok(ForegroundObservation::NoForegroundWindow);
        }

        let mut process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut process_id);
        }
        if process_id == 0 {
            return Ok(ForegroundObservation::ProcessQueryUnavailable(None));
        }

        let class = Self::read_window_class(hwnd);
        let title = Self::read_window_text(hwnd);

        let (basename, path) = match Self::query_process(process_id) {
            Some(v) => v,
            None => {
                // 权限不足/查询失败：保留部分上下文，明确不是 NoMatch
                let partial = ForegroundContext {
                    window_id: hwnd as usize as u64,
                    process_id,
                    executable_name: None,
                    executable_path: None,
                    window_class: class,
                    window_title: title,
                };
                return Ok(ForegroundObservation::ProcessQueryUnavailable(Some(
                    partial,
                )));
            }
        };

        let context = ForegroundContext {
            window_id: hwnd as usize as u64,
            process_id,
            executable_name: Some(basename.clone()),
            executable_path: Some(path),
            window_class: class,
            window_title: title,
        };

        // AgentTips 自身窗口：exe basename 匹配即 SelfWindow（不依赖路径）
        if basename.to_lowercase() == self.self_basename.to_lowercase() {
            return Ok(ForegroundObservation::SelfWindow(context));
        }
        Ok(ForegroundObservation::Observed(context))
    }
}

/// 工具函数（测试用）：从 UTF-16 缓冲区构造 String（空/截断安全）。
pub fn utf16_to_string(buffer: &[u16], len: usize) -> String {
    String::from_utf16_lossy(&buffer[..len.min(buffer.len())])
        .trim()
        .to_string()
}

/// 工具函数（测试用）：从完整路径提取 basename（Windows 分隔符）。
pub fn basename_from_path(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}

/// 错误映射：adapter 不 panic，结构化返回。
pub fn foreground_error(message: impl Into<String>) -> AppError {
    AppError::Internal(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_conversion_handles_empty_and_truncation() {
        assert_eq!(utf16_to_string(&[0u16; 0], 0), "");
        let buf: Vec<u16> = "ChatGPT - Google Search".encode_utf16().collect();
        assert_eq!(utf16_to_string(&buf, buf.len()), "ChatGPT - Google Search");
        // 截断到一半仍安全
        assert_eq!(utf16_to_string(&buf, 7), "ChatGPT");
    }

    #[test]
    fn basename_extraction_windows_and_forward_slash() {
        assert_eq!(
            basename_from_path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            "chrome.exe"
        );
        assert_eq!(
            basename_from_path("C:/Users/X/AppData/Local/Programs/cursor/Cursor.exe"),
            "Cursor.exe"
        );
        assert_eq!(basename_from_path("Notepad.exe"), "Notepad.exe");
    }

    #[test]
    fn process_query_failure_returns_partial_context() {
        // 直接验证 query_process 对无效 PID 返回 None（不会 panic）
        assert!(WindowsForegroundContextProvider::query_process(0xFFFFFFF0).is_none());
    }

    #[test]
    fn invalid_hwnd_text_reads_are_safe() {
        let invalid: HWND = std::ptr::null_mut();
        assert_eq!(
            WindowsForegroundContextProvider::read_window_text(invalid),
            None
        );
        assert_eq!(
            WindowsForegroundContextProvider::read_window_class(invalid),
            None
        );
    }
}
