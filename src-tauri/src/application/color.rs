use std::sync::Arc;

use rand::seq::SliceRandom;

use crate::domain::color::{NoteColorKey, ALL_NOTE_COLORS};
use crate::error::AppResult;
use crate::ports::tips::TipRepository;

/// 颜色建议：排除最近创建的 2 张 Tip 的颜色后随机选择，
/// 避免连续创建三张同色便签。
pub struct NoteColorService {
    repo: Arc<dyn TipRepository>,
}

impl NoteColorService {
    pub fn new(repo: Arc<dyn TipRepository>) -> Self {
        Self { repo }
    }

    pub fn suggest(&self) -> AppResult<NoteColorKey> {
        let recent = self.repo.recent_color_keys(2)?;
        let excluded: std::collections::HashSet<NoteColorKey> = recent.into_iter().collect();
        let pool: Vec<NoteColorKey> = ALL_NOTE_COLORS
            .iter()
            .copied()
            .filter(|key| !excluded.contains(key))
            .collect();
        let candidates = if pool.is_empty() {
            ALL_NOTE_COLORS.to_vec()
        } else {
            pool
        };
        let mut rng = rand::thread_rng();
        Ok(*candidates.choose(&mut rng).unwrap_or(&NoteColorKey::Lemon))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeColorRepo(Mutex<Vec<NoteColorKey>>);

    impl TipRepository for FakeColorRepo {
        fn create_with_bindings(
            &self,
            _tip: &crate::domain::tips::Tip,
            _bindings: &[crate::domain::tips::TipBinding],
        ) -> AppResult<crate::domain::tips::Tip> {
            unreachable!()
        }
        fn update_with_bindings(
            &self,
            _tip: &crate::domain::tips::Tip,
            _bindings: &[crate::domain::tips::TipBinding],
        ) -> AppResult<crate::domain::tips::Tip> {
            unreachable!()
        }
        fn get(&self, _id: uuid::Uuid) -> AppResult<Option<crate::domain::tips::Tip>> {
            Ok(None)
        }
        fn list(
            &self,
            _query: &crate::domain::tips::TipQuery,
        ) -> AppResult<Vec<crate::domain::tips::Tip>> {
            Ok(vec![])
        }
        fn delete(&self, _id: uuid::Uuid) -> AppResult<()> {
            Ok(())
        }
        fn recent_color_keys(&self, _limit: usize) -> AppResult<Vec<NoteColorKey>> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn update_text(
            &self,
            _id: uuid::Uuid,
            _title: &str,
            _content: &str,
            _updated_at: chrono::DateTime<chrono::Utc>,
        ) -> AppResult<crate::domain::tips::Tip> {
            unreachable!()
        }
        fn mark_used(
            &self,
            _id: uuid::Uuid,
            _used_at: chrono::DateTime<chrono::Utc>,
        ) -> AppResult<crate::domain::tips::Tip> {
            unreachable!()
        }
        fn restore_used(&self, _id: uuid::Uuid) -> AppResult<crate::domain::tips::Tip> {
            unreachable!()
        }
        fn update_color(
            &self,
            _id: uuid::Uuid,
            _color_key: NoteColorKey,
        ) -> AppResult<crate::domain::tips::Tip> {
            unreachable!()
        }
    }

    #[test]
    fn suggestion_excludes_recent_two_colors() {
        let repo = Arc::new(FakeColorRepo(Mutex::new(vec![
            NoteColorKey::Lemon,
            NoteColorKey::Sky,
        ])));
        let service = NoteColorService::new(repo);
        for _ in 0..20 {
            let key = service.suggest().unwrap();
            assert_ne!(key, NoteColorKey::Lemon);
            assert_ne!(key, NoteColorKey::Sky);
        }
    }

    #[test]
    fn suggestion_returns_palette_color() {
        let repo = Arc::new(FakeColorRepo(Mutex::new(vec![])));
        let service = NoteColorService::new(repo);
        for _ in 0..20 {
            let key = service.suggest().unwrap();
            assert!(ALL_NOTE_COLORS.contains(&key));
        }
    }
}
