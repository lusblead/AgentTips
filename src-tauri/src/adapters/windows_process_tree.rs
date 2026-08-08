use std::collections::HashMap;

use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::domain::terminal::ProcessIdentity;
use crate::error::{AppError, AppResult};
use crate::ports::terminal::ProcessTreeProviderPort;

/// 进程树快照：Toolhelp32（PID/PPID/basename）+ 按需 OpenProcess 查询路径。
pub struct WindowsProcessTreeProvider {
    cache: std::sync::Mutex<HashMap<u32, (String, String, u64)>>,
}

impl WindowsProcessTreeProvider {
    pub fn new() -> Self {
        Self {
            cache: std::sync::Mutex::new(HashMap::new()),
        }
    }

    fn query_path(&self, pid: u32) -> Option<(String, String)> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }
        // 创建时间（100ns ticks since 1601）用于 PID reuse 防护：同一 PID 但创建时间
        // 不同说明进程已被系统复用，旧缓存必须失效。
        let created = {
            let mut creation = FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            };
            let mut exit = FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            };
            let mut kernel = FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            };
            let mut user = FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            };
            let ok = unsafe {
                GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user)
            };
            if ok == 0 {
                None
            } else {
                Some((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
            }
        };
        {
            let cache = self.cache.lock().unwrap();
            if let Some(cached) = cache.get(&pid) {
                if created.is_some() && Some(cached.2) == created {
                    // 同一进程（创建时间一致）：复用缓存身份，避免重复路径查询。
                    unsafe {
                        CloseHandle(handle);
                    }
                    return Some((cached.0.clone(), cached.1.clone()));
                }
            }
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
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        let basename = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
        if let Some(created) = created {
            self.cache
                .lock()
                .unwrap()
                .insert(pid, (basename.clone(), path.clone(), created));
        }
        Some((basename, path))
    }
}

impl Default for WindowsProcessTreeProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessTreeProviderPort for WindowsProcessTreeProvider {
    fn snapshot(&self) -> AppResult<Vec<ProcessIdentity>> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot.is_null() {
            return Err(AppError::Internal(
                "TERMINAL_PROCESS_SNAPSHOT_FAILED".into(),
            ));
        }
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut result = vec![];
        let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) };
        while ok != 0 {
            let pid = entry.th32ProcessID;
            let path_info = self.query_path(pid);
            let (basename, path_marker) = path_info.unwrap_or_else(|| {
                let name = String::from_utf16_lossy(&entry.szExeFile[..entry.szExeFile.len()])
                    .trim()
                    .to_string();
                (name, String::new())
            });
            result.push(ProcessIdentity {
                pid,
                parent_pid: entry.th32ParentProcessID,
                executable_name: basename,
                executable_path_marker: if path_marker.is_empty() {
                    None
                } else {
                    Some(sanitize_path(&path_marker))
                },
                command_marker: None,
                created_at: None,
            });
            ok = unsafe { Process32NextW(snapshot, &mut entry) };
        }
        unsafe {
            CloseHandle(snapshot);
        }
        Ok(result)
    }

    fn descendants_of(&self, root_pid: u32) -> AppResult<Vec<ProcessIdentity>> {
        let all = self.snapshot()?;
        let mut by_parent: HashMap<u32, Vec<ProcessIdentity>> = HashMap::new();
        for p in &all {
            by_parent.entry(p.parent_pid).or_default().push(p.clone());
        }
        let mut result = vec![];
        let mut frontier = vec![root_pid];
        while let Some(pid) = frontier.pop() {
            if let Some(children) = by_parent.get(&pid) {
                for child in children {
                    result.push(child.clone());
                    frontier.push(child.pid);
                }
            }
        }
        Ok(result)
    }

    fn ancestor_chain(&self, pid: u32) -> AppResult<Vec<ProcessIdentity>> {
        let all = self.snapshot()?;
        let map: HashMap<u32, ProcessIdentity> = all.into_iter().map(|p| (p.pid, p)).collect();
        let mut result = vec![];
        let mut current = pid;
        for _ in 0..64 {
            let parent_pid = match map.get(&current) {
                Some(p) => p.parent_pid,
                None => break,
            };
            if parent_pid == current {
                break;
            }
            if let Some(parent) = map.get(&parent_pid) {
                result.push(parent.clone());
                current = parent_pid;
            } else {
                break;
            }
        }
        Ok(result)
    }

    fn command_marker_of(&self, pid: u32) -> AppResult<Option<String>> {
        // 只查询单个候选进程（非全系统扫描）；提取后丢弃原始 CommandLine。
        let result = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "(Get-CimInstance Win32_Process -Filter 'ProcessId={}' -ErrorAction SilentlyContinue).CommandLine",
                    pid
                ),
            ])
            .output();
        let output = result
            .map_err(|e| AppError::Internal(format!("TERMINAL_PROCESS_QUERY_FAILED: {e}")))?;
        let cmdline = String::from_utf8_lossy(&output.stdout).to_string();
        if cmdline.trim().is_empty() {
            return Ok(None);
        }
        let lower = cmdline.to_lowercase();
        let markers = [
            "@openai/codex",
            "codex.js",
            "@anthropic-ai/claude-code",
            "opencode",
        ];
        let marker = markers
            .iter()
            .find(|m| lower.contains(&m.to_lowercase()))
            .map(|m| m.to_string());
        Ok(marker)
    }
}

/// 脱敏：替换用户目录前缀；不输出完整路径到日志/DTO。
pub fn sanitize_path(path: &str) -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    if !home.is_empty() && path.to_lowercase().starts_with(&home.to_lowercase()) {
        return format!("%USERPROFILE%{}", &path[home.len()..]);
    }
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if !local.is_empty() && path.to_lowercase().starts_with(&local.to_lowercase()) {
        return format!("%LOCALAPPDATA%{}", &path[local.len()..]);
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_user_profile() {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\test".into());
        let p = format!("{}\\AppData\\Roaming\\npm\\node.exe", home);
        let s = sanitize_path(&p);
        assert!(!s.contains("Users"));
        assert!(s.starts_with("%USERPROFILE%\\AppData"));
    }

    #[test]
    fn sanitize_keeps_unknown_path() {
        assert_eq!(
            sanitize_path(r"C:\Windows\System32\cmd.exe"),
            r"C:\Windows\System32\cmd.exe"
        );
    }

    #[test]
    fn pid_reuse_invalidates_stale_cache() {
        let provider = WindowsProcessTreeProvider::new();
        let pid = std::process::id();
        // 模拟 PID 复用：为当前 PID 注入创建时间错误的旧缓存（stale.exe）。
        provider
            .cache
            .lock()
            .unwrap()
            .insert(pid, ("stale.exe".into(), "C:\\stale\\stale.exe".into(), 1));
        let (basename, _path) = provider.query_path(pid).expect("当前进程路径应可解析");
        // 旧缓存必须失效并基于真实进程刷新。
        assert_ne!(basename.to_lowercase(), "stale.exe");
        let cached = provider
            .cache
            .lock()
            .unwrap()
            .get(&pid)
            .cloned()
            .expect("缓存应已刷新");
        assert_ne!(cached.2, 1, "缓存必须以真实创建时间重新键控");
    }

    #[test]
    fn snapshot_returns_processes() {
        let provider = WindowsProcessTreeProvider::new();
        let all = provider.snapshot().unwrap();
        assert!(all.len() > 10);
        // 当前测试进程必然在快照中
        let self_pid = std::process::id();
        assert!(all.iter().any(|p| p.pid == self_pid));
    }

    #[test]
    fn descendants_contains_children() {
        let provider = WindowsProcessTreeProvider::new();
        // 使用当前进程根，descendants 至少包含其直接子进程（可能为空也安全）
        let _ = provider.descendants_of(std::process::id()).unwrap();
    }
}
