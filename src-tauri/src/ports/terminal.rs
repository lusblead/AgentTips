use crate::domain::foreground::ForegroundContext;
use crate::domain::terminal::{ProcessIdentity, TerminalHostKind, TerminalObservation};
use crate::error::AppResult;

/// 进程树快照能力（Application 层不感知 Toolhelp/WMI/Windows 类型）。
pub trait ProcessTreeProviderPort: Send + Sync {
    /// 全系统轻量快照（PID/PPID/basename + 脱敏 marker）。
    fn snapshot(&self) -> AppResult<Vec<ProcessIdentity>>;
    fn descendants_of(&self, root_pid: u32) -> AppResult<Vec<ProcessIdentity>>;
    fn ancestor_chain(&self, pid: u32) -> AppResult<Vec<ProcessIdentity>>;
    /// 按需读取单个进程 CommandLine 并提取已知 marker（只查询候选进程）。
    fn command_marker_of(&self, pid: u32) -> AppResult<Option<String>>;
}

/// 终端宿主分类器。
pub trait TerminalHostClassifierPort: Send + Sync {
    fn classify(&self, context: &ForegroundContext) -> TerminalHostKind;
}

/// 终端上下文解析：基于 foreground + 进程树生成 TerminalObservation。
pub trait TerminalContextProviderPort: Send + Sync {
    fn observe(&self, context: &ForegroundContext) -> AppResult<TerminalObservation>;
    /// 快速分类（仅用于刷新节奏判断，不做完整 session 解析）。
    fn classify(&self, context: &ForegroundContext) -> TerminalHostKind;
}
