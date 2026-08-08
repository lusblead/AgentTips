use uuid::Uuid;

use crate::domain::color::NoteColorKey;
use crate::domain::tips::{Tip, TipBinding, TipQuery};
use crate::error::AppResult;

/// Tip 持久化端口。create/update 方法语义为原子操作：
/// Tip 主记录、标签关联与全部绑定在同一事务内提交，任一步失败整体回滚。
pub trait TipRepository: Send + Sync {
    fn create_with_bindings(&self, tip: &Tip, bindings: &[TipBinding]) -> AppResult<Tip>;
    fn update_with_bindings(&self, tip: &Tip, bindings: &[TipBinding]) -> AppResult<Tip>;
    fn get(&self, id: Uuid) -> AppResult<Option<Tip>>;
    fn list(&self, query: &TipQuery) -> AppResult<Vec<Tip>>;
    /// 最近使用优先的历史标签建议，不返回便签正文。
    fn list_tags(&self, limit: usize) -> AppResult<Vec<String>>;
    fn delete(&self, id: Uuid) -> AppResult<()>;
    /// 最近创建的 2 张 Tip 的颜色（含已使用，用于颜色建议）。
    fn recent_color_keys(&self, limit: usize) -> AppResult<Vec<NoteColorKey>>;
    /// Text-only 更新：只改 title/content/updated_at；空标题以 NULL 保存。
    fn update_text(
        &self,
        id: Uuid,
        title: Option<&str>,
        content: &str,
        updated_at: chrono::DateTime<chrono::Utc>,
    ) -> AppResult<Tip>;
    fn mark_used(&self, id: Uuid, used_at: chrono::DateTime<chrono::Utc>) -> AppResult<Tip>;
    fn restore_used(&self, id: Uuid) -> AppResult<Tip>;
    fn update_color(&self, id: Uuid, color_key: NoteColorKey) -> AppResult<Tip>;
}
