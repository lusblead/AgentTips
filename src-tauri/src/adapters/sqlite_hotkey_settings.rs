use std::sync::Arc;

use rusqlite::OptionalExtension;

use crate::adapters::sqlite::SqliteDatabase;
use crate::domain::hotkey::{HotkeyBinding, HotkeyKey, HotkeyModifier};
use crate::error::{AppError, AppResult};
use crate::ports::hotkey_settings_repository::HotkeySettingsRepositoryPort;

/// hotkey_settings 表（id=1 单行）的 SQLite 实现。
pub struct SqliteHotkeySettingsRepository {
    db: Arc<SqliteDatabase>,
}

impl SqliteHotkeySettingsRepository {
    pub fn new(db: Arc<SqliteDatabase>) -> Self {
        Self { db }
    }
}

impl HotkeySettingsRepositoryPort for SqliteHotkeySettingsRepository {
    fn get(&self) -> AppResult<Option<HotkeyBinding>> {
        let row: Option<(String, String)> = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT modifier, key_code FROM hotkey_settings WHERE id = 1",
                [],
                |row| -> rusqlite::Result<(String, String)> { Ok((row.get(0)?, row.get(1)?)) },
            )
            .optional()
            .map_err(AppError::from)
        })?;
        let Some((modifier, key_code)) = row else {
            return Ok(None);
        };
        if modifier != "Control" {
            return Err(AppError::HotkeyInconsistentState(
                "hotkey_settings.modifier 不是 Control".into(),
            ));
        }
        let Some(key) = HotkeyKey::from_key_code(&key_code) else {
            return Err(AppError::HotkeyInconsistentState(format!(
                "hotkey_settings.key_code 不受支持: {key_code}"
            )));
        };
        Ok(Some(HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key,
        }))
    }

    fn save(&self, binding: &HotkeyBinding) -> AppResult<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE hotkey_settings SET modifier = ?1, key_code = ?2, updated_at = ?3 WHERE id = 1",
                rusqlite::params![
                    "Control",
                    binding.key.key_code(),
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .map_err(AppError::from)?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ctrl_f12_exists() {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let repo = SqliteHotkeySettingsRepository::new(db);
        let binding = repo.get().unwrap().expect("default row");
        assert_eq!(binding.modifier, HotkeyModifier::Control);
        assert_eq!(binding.key, HotkeyKey::F12);
    }

    #[test]
    fn update_and_read_back_persists() {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let repo = SqliteHotkeySettingsRepository::new(db);
        let new = HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key: HotkeyKey::F11,
        };
        repo.save(&new).unwrap();
        let binding = repo.get().unwrap().unwrap();
        assert_eq!(binding.key, HotkeyKey::F11);
    }
}
