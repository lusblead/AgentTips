use uuid::Uuid;

use crate::domain::tips::{Tip, TipBinding, TipQuery};
use crate::error::AppResult;

/// Tip 持久化端口。create/update 方法语义为原子操作：
/// Tip 主记录与全部绑定在同一事务内提交，任一步失败整体回滚。
pub trait TipRepository: Send + Sync {
    fn create_with_bindings(&self, tip: &Tip, bindings: &[TipBinding]) -> AppResult<Tip>;
    fn update_with_bindings(&self, tip: &Tip, bindings: &[TipBinding]) -> AppResult<Tip>;
    fn get(&self, id: Uuid) -> AppResult<Option<Tip>>;
    fn list(&self, query: &TipQuery) -> AppResult<Vec<Tip>>;
    fn delete(&self, id: Uuid) -> AppResult<()>;
}
