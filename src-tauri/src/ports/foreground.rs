use crate::domain::foreground::ForegroundObservation;
use crate::error::AppResult;

/// 前台上下文提供者。Application 层只依赖此接口，
/// 不感知 Windows HWND/HANDLE 类型。
pub trait ForegroundContextProviderPort: Send + Sync {
    fn current_foreground_observation(&self) -> AppResult<ForegroundObservation>;
}

/// 前台 watcher 生命周期接口（Polling 或 WinEventHook 实现可替换）。
pub trait ForegroundWatcherPort: Send + Sync {
    fn start(&self) -> AppResult<()>;
    fn stop(&self) -> AppResult<()>;
}
