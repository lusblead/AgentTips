use crate::domain::hotkey::HotkeyBinding;
use crate::error::AppResult;

/// 快捷键设置持久化。第一版始终只有一条记录（id=1）。
pub trait HotkeySettingsRepositoryPort: Send + Sync {
    fn get(&self) -> AppResult<Option<HotkeyBinding>>;
    fn save(&self, binding: &HotkeyBinding) -> AppResult<()>;
}
