use std::path::Path;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::domain::agents::{Agent, AgentKind};
use crate::domain::color::NoteColorKey;
use crate::domain::tips::{normalized_tag_key, Tip, TipBinding, TipQuery, TipStatus};
use crate::error::{AppError, AppResult};
use crate::ports::agents::AgentRepository;
use crate::ports::tips::TipRepository;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_init.sql")),
    (2, include_str!("../../migrations/0002_living_notes.sql")),
    (3, include_str!("../../migrations/0003_hotkey_settings.sql")),
    (
        4,
        include_str!("../../migrations/0004_reminder_runtime.sql"),
    ),
    (5, include_str!("../../migrations/0005_tip_tags.sql")),
];

/// 内置 Agent 初始名单。
const BUILTIN_AGENTS: &[(&str, &str, AgentKind)] = &[
    ("chatgpt-desktop", "ChatGPT", AgentKind::Desktop),
    ("cursor", "Cursor", AgentKind::Desktop),
    ("trae", "Trae", AgentKind::Desktop),
    ("claude-code", "Claude Code", AgentKind::Terminal),
    ("opencode", "OpenCode", AgentKind::Terminal),
    ("codex-cli", "Codex", AgentKind::Terminal),
];

pub struct SqliteDatabase {
    conn: Mutex<Connection>,
}

impl SqliteDatabase {
    /// 在连接锁内执行查询（供独立 repository 实现复用同一连接）。
    pub(crate) fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self.conn.lock().unwrap();
        f(&conn)
    }

    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path).map_err(AppError::from)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory().map_err(AppError::from)?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        conn.pragma_update(None, "foreign_keys", true)
            .map_err(AppError::from)?;
        // 单连接 Mutex 串行化自身访问；busy_timeout 防止与外部进程短暂写竞争时报 locked。
        conn.busy_timeout(Duration::from_millis(5000))
            .map_err(AppError::from)?;
        let just_upgraded_to_living_notes = run_migrations(&conn)?;
        if just_upgraded_to_living_notes {
            backfill_tip_colors(&conn)?;
        }
        seed_builtin_agents(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

/// 单版本迁移：schema DDL 与版本记录在同一事务，中途失败整体回滚。
fn apply_migration(conn: &Connection, version: i64, sql: &str) -> AppResult<()> {
    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    tx.execute_batch(sql).map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
        params![version, Utc::now().to_rfc3339()],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

/// 返回 true 表示刚应用了 migration 2（需要执行旧数据 color backfill）。
fn run_migrations(conn: &Connection) -> AppResult<bool> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )
    .map_err(AppError::from)?;

    let mut upgraded_to_living = false;
    for (version, sql) in MIGRATIONS {
        let applied: Option<i64> = conn
            .query_row(
                "SELECT version FROM schema_migrations WHERE version = ?1",
                params![version],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)?;
        if applied.is_some() {
            continue;
        }
        apply_migration(conn, *version, sql)?;
        if *version == 2 {
            upgraded_to_living = true;
        }
    }
    Ok(upgraded_to_living)
}

/// FNV-1a 32 位稳定散列（与前端历史 backfill 同源；仅用于旧数据迁移）。
fn stable_hash(input: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in input.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

/// 旧 Tip 确定性 backfill：stableHash(id) % 10 -> 10 色之一。
/// 只在 migration 2 刚应用时执行一次；此后 color_key 为数据库持久属性。
fn backfill_tip_colors(conn: &Connection) -> AppResult<()> {
    let colors: Vec<NoteColorKey> = crate::domain::color::ALL_NOTE_COLORS.to_vec();
    let mut stmt = conn
        .prepare("SELECT id FROM tips")
        .map_err(AppError::from)?;
    let ids: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(AppError::from)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)?;
    drop(stmt);
    for id in ids {
        let idx = (stable_hash(&id) as usize) % colors.len();
        conn.execute(
            "UPDATE tips SET color_key = ?1 WHERE id = ?2",
            params![colors[idx].as_str(), id],
        )
        .map_err(AppError::from)?;
    }
    Ok(())
}

fn seed_builtin_agents(conn: &Connection) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    for (key, name, kind) in BUILTIN_AGENTS {
        // 稳定 ID（与前端 Mock 的 agent-* 不同；以数据库为准）
        let id = builtin_agent_id(key);
        let inserted = conn
            .execute(
                "INSERT OR IGNORE INTO agents (id, key, name, kind, built_in, enabled, reminder_enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, 1, 1, ?5, ?5)",
                params![id.to_string(), key, name, kind.as_str(), now],
            )
            .map_err(AppError::from)?;
        if inserted == 0 {
            // 已存在（key 唯一）：不覆盖用户字段
            continue;
        }
    }
    Ok(())
}

fn builtin_agent_id(key: &str) -> Uuid {
    // 稳定 UUID：以 key 生成确定性 ID，保证幂等且可读。
    let bytes = key.as_bytes();
    let mut seed = [0u8; 16];
    for (i, b) in bytes.iter().enumerate() {
        seed[i % 16] ^= b;
    }
    seed[6] = (seed[6] & 0x0f) | 0x40;
    seed[8] = (seed[8] & 0x3f) | 0x80;
    Uuid::from_bytes(seed)
}

fn parse_rfc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn rfc(at: DateTime<Utc>) -> String {
    at.to_rfc3339()
}

fn tip_from_row(row: &Row) -> rusqlite::Result<Tip> {
    let id: String = row.get(0)?;
    let title: Option<String> = row.get(1)?;
    let content: String = row.get(2)?;
    let status: String = row.get(3)?;
    let created_at: String = row.get(4)?;
    let updated_at: String = row.get(5)?;
    let deleted_at: Option<String> = row.get(6)?;
    let color_key: String = row.get(7)?;
    let used_at: Option<String> = row.get(8)?;
    Ok(Tip {
        id: Uuid::from_str(&id).map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        title,
        content,
        tags: Vec::new(),
        status: TipStatus::parse(&status)
            .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        created_at: parse_rfc(&created_at)
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("created_at".into()))?,
        updated_at: parse_rfc(&updated_at)
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("updated_at".into()))?,
        deleted_at: deleted_at.and_then(|v| parse_rfc(&v)),
        color_key: NoteColorKey::parse(&color_key)
            .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        used_at: used_at.and_then(|v| parse_rfc(&v)),
        bindings: Vec::new(),
    })
}

fn agent_from_row(row: &Row) -> rusqlite::Result<Agent> {
    let id: String = row.get(0)?;
    let key: String = row.get(1)?;
    let name: String = row.get(2)?;
    let kind: String = row.get(3)?;
    let built_in: i64 = row.get(4)?;
    let enabled: i64 = row.get(5)?;
    let reminder_enabled: i64 = row.get(6)?;
    let created_at: String = row.get(7)?;
    let updated_at: String = row.get(8)?;
    Ok(Agent {
        id: Uuid::from_str(&id).map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        key,
        name,
        kind: AgentKind::parse(&kind)
            .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        built_in: built_in != 0,
        enabled: enabled != 0,
        reminder_enabled: reminder_enabled != 0,
        created_at: parse_rfc(&created_at)
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("created_at".into()))?,
        updated_at: parse_rfc(&updated_at)
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("updated_at".into()))?,
    })
}

fn load_bindings(conn: &Connection, tip_ids: &[Uuid]) -> AppResult<Vec<(Uuid, TipBinding)>> {
    if tip_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; tip_ids.len()].join(", ");
    let sql = format!(
        "SELECT tip_id, agent_id, auto_attach, sort_order FROM tip_agents WHERE tip_id IN ({placeholders}) ORDER BY tip_id, sort_order"
    );
    let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
    let params: Vec<String> = tip_ids.iter().map(|id| id.to_string()).collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            let tip_id: String = row.get(0)?;
            let agent_id: String = row.get(1)?;
            let auto_attach: i64 = row.get(2)?;
            let sort_order: i64 = row.get(3)?;
            Ok((
                Uuid::from_str(&tip_id)
                    .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
                TipBinding {
                    agent_id: Uuid::from_str(&agent_id)
                        .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
                    auto_attach: auto_attach != 0,
                    sort_order,
                },
            ))
        })
        .map_err(AppError::from)?;
    let mut by_tip: Vec<(Uuid, TipBinding)> = Vec::new();
    for row in rows {
        by_tip.push(row.map_err(AppError::from)?);
    }
    Ok(by_tip)
}

fn load_tags(conn: &Connection, tip_ids: &[Uuid]) -> AppResult<Vec<(Uuid, String)>> {
    if tip_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; tip_ids.len()].join(", ");
    let sql = format!(
        "SELECT tt.tip_id, t.name
         FROM tip_tags tt
         JOIN tags t ON t.id = tt.tag_id
         WHERE tt.tip_id IN ({placeholders})
         ORDER BY tt.tip_id, tt.sort_order"
    );
    let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
    let params: Vec<String> = tip_ids.iter().map(|id| id.to_string()).collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            let tip_id: String = row.get(0)?;
            let name: String = row.get(1)?;
            Ok((
                Uuid::from_str(&tip_id)
                    .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
                name,
            ))
        })
        .map_err(AppError::from)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)
}

fn load_tip(conn: &Connection, id: Uuid) -> AppResult<Option<Tip>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, status, created_at, updated_at, deleted_at, color_key, used_at
             FROM tips WHERE id = ?1 AND deleted_at IS NULL",
        )
        .map_err(AppError::from)?;
    let mut rows = stmt
        .query_map(params![id.to_string()], tip_from_row)
        .map_err(AppError::from)?;
    let Some(row) = rows.next() else {
        return Ok(None);
    };
    let mut tip = row.map_err(AppError::from)?;
    tip.bindings = load_bindings(conn, &[id])?
        .into_iter()
        .map(|(_, b)| b)
        .collect();
    tip.tags = load_tags(conn, &[id])?
        .into_iter()
        .map(|(_, tag)| tag)
        .collect();
    Ok(Some(tip))
}

fn ensure_agents_exist(conn: &Connection, agent_ids: &[Uuid]) -> AppResult<()> {
    for agent_id in agent_ids {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE id = ?1",
                params![agent_id.to_string()],
                |row| row.get(0),
            )
            .map_err(AppError::from)?;
        if count == 0 {
            return Err(AppError::NotFound(format!("Agent {} 不存在", agent_id)));
        }
    }
    Ok(())
}

fn insert_bindings(conn: &Connection, tip_id: Uuid, bindings: &[TipBinding]) -> AppResult<()> {
    let now = rfc(Utc::now());
    for binding in bindings {
        conn.execute(
            "INSERT INTO tip_agents (tip_id, agent_id, auto_attach, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                tip_id.to_string(),
                binding.agent_id.to_string(),
                binding.auto_attach as i64,
                binding.sort_order,
                now
            ],
        )
        .map_err(AppError::from)?;
    }
    Ok(())
}

fn insert_tags(
    conn: &Connection,
    tip_id: Uuid,
    tags: &[String],
    updated_at: DateTime<Utc>,
) -> AppResult<()> {
    let at = rfc(updated_at);
    for (sort_order, name) in tags.iter().enumerate() {
        let normalized_name = normalized_tag_key(name);
        let candidate_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO tags (id, name, normalized_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(normalized_name) DO UPDATE SET updated_at = excluded.updated_at",
            params![candidate_id, name, normalized_name, at],
        )
        .map_err(AppError::from)?;
        let tag_id: String = conn
            .query_row(
                "SELECT id FROM tags WHERE normalized_name = ?1",
                params![normalized_name],
                |row| row.get(0),
            )
            .map_err(AppError::from)?;
        conn.execute(
            "INSERT INTO tip_tags (tip_id, tag_id, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![tip_id.to_string(), tag_id, sort_order as i64, at],
        )
        .map_err(AppError::from)?;
    }
    Ok(())
}

impl TipRepository for SqliteDatabase {
    fn create_with_bindings(&self, tip: &Tip, bindings: &[TipBinding]) -> AppResult<Tip> {
        let conn = self.conn.lock().unwrap();
        ensure_agents_exist(
            &conn,
            &bindings.iter().map(|b| b.agent_id).collect::<Vec<_>>(),
        )?;
        let tx = conn.unchecked_transaction().map_err(AppError::from)?;
        tx.execute(
            "INSERT INTO tips (id, title, content, status, created_at, updated_at, deleted_at, color_key, used_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL, ?6, NULL)",
            params![
                tip.id.to_string(),
                tip.title,
                tip.content,
                tip.status.as_str(),
                rfc(tip.created_at),
                tip.color_key.as_str(),
            ],
        )
        .map_err(AppError::from)?;
        insert_bindings(&tx, tip.id, bindings)?;
        insert_tags(&tx, tip.id, &tip.tags, tip.updated_at)?;
        tx.commit().map_err(AppError::from)?;
        load_tip(&conn, tip.id)?.ok_or_else(|| AppError::Internal("创建后读取失败".into()))
    }

    fn update_with_bindings(&self, tip: &Tip, bindings: &[TipBinding]) -> AppResult<Tip> {
        let conn = self.conn.lock().unwrap();
        ensure_agents_exist(
            &conn,
            &bindings.iter().map(|b| b.agent_id).collect::<Vec<_>>(),
        )?;
        let tx = conn.unchecked_transaction().map_err(AppError::from)?;
        let affected = tx
            .execute(
                "UPDATE tips SET title = ?2, content = ?3, status = ?4, updated_at = ?5, color_key = ?6
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![
                    tip.id.to_string(),
                    tip.title,
                    tip.content,
                    tip.status.as_str(),
                    rfc(tip.updated_at),
                    tip.color_key.as_str(),
                ],
            )
            .map_err(AppError::from)?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Tip {} 不存在", tip.id)));
        }
        tx.execute(
            "DELETE FROM tip_agents WHERE tip_id = ?1",
            params![tip.id.to_string()],
        )
        .map_err(AppError::from)?;
        tx.execute(
            "DELETE FROM tip_tags WHERE tip_id = ?1",
            params![tip.id.to_string()],
        )
        .map_err(AppError::from)?;
        insert_bindings(&tx, tip.id, bindings)?;
        insert_tags(&tx, tip.id, &tip.tags, tip.updated_at)?;
        tx.commit().map_err(AppError::from)?;
        load_tip(&conn, tip.id)?.ok_or_else(|| AppError::Internal("更新后读取失败".into()))
    }

    fn get(&self, id: Uuid) -> AppResult<Option<Tip>> {
        let conn = self.conn.lock().unwrap();
        load_tip(&conn, id)
    }

    fn list(&self, query: &TipQuery) -> AppResult<Vec<Tip>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT id, title, content, status, created_at, updated_at, deleted_at, color_key, used_at
             FROM tips WHERE deleted_at IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(search) = &query.search {
            let needle = format!("%{}%", search.trim().to_lowercase());
            sql.push_str(
                " AND (LOWER(COALESCE(title, '')) LIKE ? OR LOWER(content) LIKE ?
                  OR EXISTS (
                    SELECT 1 FROM tip_tags tt
                    JOIN tags tag ON tag.id = tt.tag_id
                    WHERE tt.tip_id = tips.id AND LOWER(tag.name) LIKE ?
                  ))",
            );
            args.push(Box::new(needle.clone()));
            args.push(Box::new(needle.clone()));
            args.push(Box::new(needle));
        }
        if let Some(agent_id) = query.agent_id {
            sql.push_str(
                " AND EXISTS (SELECT 1 FROM tip_agents b WHERE b.tip_id = tips.id AND b.agent_id = ?)",
            );
            args.push(Box::new(agent_id.to_string()));
        }
        match query.used {
            Some(true) => sql.push_str(" AND used_at IS NOT NULL"),
            Some(false) | None => sql.push_str(" AND used_at IS NULL"),
        }
        sql.push_str(" ORDER BY updated_at DESC, id ASC");

        let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
        let mut tips: Vec<Tip> = Vec::new();
        let rows = stmt
            .query_map(
                rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())),
                tip_from_row,
            )
            .map_err(AppError::from)?;
        for row in rows {
            tips.push(row.map_err(AppError::from)?);
        }
        drop(stmt);

        // 批量加载绑定与标签并分组，避免 N+1
        let ids: Vec<Uuid> = tips.iter().map(|tip| tip.id).collect();
        let bindings = load_bindings(&conn, &ids)?;
        let mut grouped: std::collections::HashMap<Uuid, Vec<TipBinding>> =
            std::collections::HashMap::new();
        for (tip_id, binding) in bindings {
            grouped.entry(tip_id).or_default().push(binding);
        }
        for tip in tips.iter_mut() {
            if let Some(bindings) = grouped.remove(&tip.id) {
                tip.bindings = bindings;
            }
        }
        let tags = load_tags(&conn, &ids)?;
        let mut grouped_tags: std::collections::HashMap<Uuid, Vec<String>> =
            std::collections::HashMap::new();
        for (tip_id, tag) in tags {
            grouped_tags.entry(tip_id).or_default().push(tag);
        }
        for tip in tips.iter_mut() {
            if let Some(tags) = grouped_tags.remove(&tip.id) {
                tip.tags = tags;
            }
        }
        Ok(tips)
    }

    fn list_tags(&self, limit: usize) -> AppResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT name FROM tags
                 ORDER BY updated_at DESC, name COLLATE NOCASE ASC
                 LIMIT ?1",
            )
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map(params![limit as i64], |row| row.get::<_, String>(0))
            .map_err(AppError::from)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(AppError::from)
    }

    fn delete(&self, id: Uuid) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction().map_err(AppError::from)?;
        let now = rfc(Utc::now());
        let affected = tx
            .execute(
                "UPDATE tips SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
                params![id.to_string(), now],
            )
            .map_err(AppError::from)?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Tip {} 不存在", id)));
        }
        tx.execute(
            "DELETE FROM tip_agents WHERE tip_id = ?1",
            params![id.to_string()],
        )
        .map_err(AppError::from)?;
        tx.commit().map_err(AppError::from)?;
        Ok(())
    }

    fn recent_color_keys(&self, limit: usize) -> AppResult<Vec<NoteColorKey>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT color_key FROM tips ORDER BY created_at DESC, id ASC LIMIT ?1")
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map(params![limit as i64], |row| row.get::<_, String>(0))
            .map_err(AppError::from)?;
        let mut keys = Vec::new();
        for row in rows {
            let raw = row.map_err(AppError::from)?;
            if let Ok(key) = NoteColorKey::parse(&raw) {
                keys.push(key);
            }
        }
        Ok(keys)
    }

    fn update_text(
        &self,
        id: Uuid,
        title: Option<&str>,
        content: &str,
        updated_at: DateTime<Utc>,
    ) -> AppResult<Tip> {
        let conn = self.conn.lock().unwrap();
        let affected = conn
            .execute(
                "UPDATE tips SET title = ?2, content = ?3, updated_at = ?4
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![id.to_string(), title, content, rfc(updated_at)],
            )
            .map_err(AppError::from)?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Tip {} 不存在", id)));
        }
        load_tip(&conn, id)?.ok_or_else(|| AppError::Internal("更新后读取失败".into()))
    }

    fn mark_used(&self, id: Uuid, used_at: DateTime<Utc>) -> AppResult<Tip> {
        let conn = self.conn.lock().unwrap();
        let affected = conn
            .execute(
                "UPDATE tips SET used_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
                params![id.to_string(), rfc(used_at)],
            )
            .map_err(AppError::from)?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Tip {} 不存在", id)));
        }
        load_tip(&conn, id)?.ok_or_else(|| AppError::Internal("标记后读取失败".into()))
    }

    fn restore_used(&self, id: Uuid) -> AppResult<Tip> {
        let conn = self.conn.lock().unwrap();
        let affected = conn
            .execute(
                "UPDATE tips SET used_at = NULL, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
                params![id.to_string(), rfc(Utc::now())],
            )
            .map_err(AppError::from)?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Tip {} 不存在", id)));
        }
        load_tip(&conn, id)?.ok_or_else(|| AppError::Internal("恢复后读取失败".into()))
    }

    fn update_color(&self, id: Uuid, color_key: NoteColorKey) -> AppResult<Tip> {
        let conn = self.conn.lock().unwrap();
        let affected = conn
            .execute(
                "UPDATE tips SET color_key = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
                params![id.to_string(), color_key.as_str(), rfc(Utc::now())],
            )
            .map_err(AppError::from)?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Tip {} 不存在", id)));
        }
        load_tip(&conn, id)?.ok_or_else(|| AppError::Internal("更新颜色后读取失败".into()))
    }
}

impl AgentRepository for SqliteDatabase {
    fn list(&self) -> AppResult<Vec<Agent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, key, name, kind, built_in, enabled, reminder_enabled, created_at, updated_at
                 FROM agents ORDER BY name ASC",
            )
            .map_err(AppError::from)?;
        let rows = stmt.query_map([], agent_from_row).map_err(AppError::from)?;
        let mut agents = Vec::new();
        for row in rows {
            agents.push(row.map_err(AppError::from)?);
        }
        Ok(agents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::agents::AgentKind;
    use crate::domain::color::NoteColorKey;
    use crate::domain::tips::TipStatus;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now() -> DateTime<Utc> {
        Utc::now()
    }

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("agenttips-test-{name}-{nanos}.sqlite3"))
    }

    fn sample_tip(id: Uuid, title: Option<&str>, content: &str, bindings: &[TipBinding]) -> Tip {
        let t = now();
        Tip {
            id,
            title: title.map(str::to_string),
            content: content.to_string(),
            tags: vec![],
            status: TipStatus::Active,
            created_at: t,
            updated_at: t,
            deleted_at: None,
            color_key: NoteColorKey::Lemon,
            used_at: None,
            bindings: bindings.to_vec(),
        }
    }

    fn binding(agent_id: Uuid, auto_attach: bool, sort_order: i64) -> TipBinding {
        TipBinding {
            agent_id,
            auto_attach,
            sort_order,
        }
    }

    fn builtin_agents() -> Vec<Agent> {
        let db = SqliteDatabase::open_in_memory().unwrap();
        AgentRepository::list(&db).unwrap()
    }

    fn agent_ids(agents: &[Agent]) -> (Uuid, Uuid) {
        (agents[1].id, agents[3].id)
    }

    // ---------- migration 测试 ----------

    #[test]
    fn empty_database_migrates_successfully() {
        let path = temp_db_path("migrate");
        let db = SqliteDatabase::open(&path).expect("open should succeed");
        assert!(!AgentRepository::list(&db).unwrap().is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migration_is_idempotent_on_second_open() {
        let path = temp_db_path("idempotent");
        {
            let db = SqliteDatabase::open(&path).unwrap();
            drop(db);
        }
        let db = SqliteDatabase::open(&path).expect("second open should not error");
        assert!(!AgentRepository::list(&db).unwrap().is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migration_5_preserves_existing_titleless_tips() {
        let path = temp_db_path("tags-upgrade");
        let tip_id = Uuid::new_v4();
        {
            let conn = Connection::open(&path).unwrap();
            for (version, sql) in MIGRATIONS.iter().take(4) {
                apply_migration(&conn, *version, sql).unwrap();
            }
            conn.execute(
                "INSERT INTO tips (id, title, content, status, created_at, updated_at, deleted_at, color_key, used_at)
                 VALUES (?1, NULL, '升级前正文', 'active', ?2, ?2, NULL, 'lemon', NULL)",
                params![tip_id.to_string(), rfc(now())],
            )
            .unwrap();
        }

        let db = SqliteDatabase::open(&path).unwrap();
        let preserved = db.get(tip_id).unwrap().expect("existing Tip must survive");
        assert_eq!(preserved.title, None);
        assert_eq!(preserved.content, "升级前正文");
        assert!(preserved.tags.is_empty());
        let versions: i64 = db
            .with_conn(|conn| {
                conn.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                    row.get(0)
                })
                .map_err(AppError::from)
            })
            .unwrap();
        assert_eq!(versions, 5);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn required_tables_indices_and_fk_exist() {
        let path = temp_db_path("schema");
        let db = SqliteDatabase::open(&path).unwrap();
        let conn = db.conn.lock().unwrap();
        for table in [
            "agents",
            "tips",
            "tip_agents",
            "tags",
            "tip_tags",
            "schema_migrations",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing table {table}");
        }
        for index in [
            "idx_tips_updated_at",
            "idx_tip_agents_agent",
            "idx_tip_tags_tag",
            "idx_tags_updated_at",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    params![index],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing index {index}");
        }
        // tip_agents 联合主键存在
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tip_agents') WHERE pk > 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "tip_agents composite PK expected");
        // 外键已开启
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn builtin_agents_seeded_idempotently() {
        let path = temp_db_path("agents");
        {
            let db = SqliteDatabase::open(&path).unwrap();
            let first = AgentRepository::list(&db).unwrap();
            assert_eq!(first.len(), 6);
            assert!(first.iter().all(|a| a.built_in));
            drop(db);
        }
        {
            let db = SqliteDatabase::open(&path).unwrap();
            let second = AgentRepository::list(&db).unwrap();
            assert_eq!(second.len(), 6, "restart must not duplicate builtin agents");
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn busy_timeout_is_configured() {
        let db = SqliteDatabase::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(timeout, 5000, "busy_timeout must be 5000ms");
    }

    #[test]
    fn every_new_connection_enables_foreign_keys() {
        let db = SqliteDatabase::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn migration_failure_rolls_back_and_does_not_write_version() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )
        .unwrap();
        // 坏 SQL：第二条语句引用不存在表
        let bad_sql = "CREATE TABLE temp_migrate (id TEXT); INSERT INTO missing_table VALUES (1);";
        assert!(apply_migration(&conn, 99, bad_sql).is_err());
        let version: Option<i64> = conn
            .query_row(
                "SELECT version FROM schema_migrations WHERE version = 99",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(
            version.is_none(),
            "failed migration must not record version"
        );
        // 表也不应残留
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'temp_migrate'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "failed migration DDL must be rolled back");
    }

    #[test]
    fn concurrent_list_calls_do_not_fail() {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let agents = AgentRepository::list(&*db).unwrap();
        let tip = sample_tip(
            Uuid::new_v4(),
            Some("并发"),
            "并发数据",
            &[binding(agents[0].id, true, 0)],
        );
        TipRepository::create_with_bindings(&*db, &tip, &tip.bindings).unwrap();

        let handles: Vec<_> = (0..2)
            .map(|_| {
                let db = db.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        TipRepository::list(&*db, &TipQuery::default())
                            .expect("list must not fail");
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("list thread must not panic");
        }
    }

    #[test]
    fn concurrent_list_and_create_do_not_panic() {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let agents = AgentRepository::list(&*db).unwrap();
        let agent_id = agents[0].id;

        let reader = {
            let db = db.clone();
            std::thread::spawn(move || {
                for _ in 0..20 {
                    TipRepository::list(&*db, &TipQuery::default()).expect("list must not fail");
                }
            })
        };
        let writer = {
            let db = db.clone();
            std::thread::spawn(move || {
                for i in 0..20 {
                    let tip = sample_tip(
                        Uuid::new_v4(),
                        Some(&format!("写入 {i}")),
                        "并发写入",
                        &[binding(agent_id, true, 0)],
                    );
                    TipRepository::create_with_bindings(&*db, &tip, &tip.bindings)
                        .expect("create must not fail");
                }
            })
        };
        reader.join().expect("reader must not panic");
        writer.join().expect("writer must not panic");
        assert_eq!(
            TipRepository::list(&*db, &TipQuery::default())
                .unwrap()
                .len(),
            20
        );
    }

    // ---------- repository 集成测试 ----------

    fn setup_repo() -> (SqliteDatabase, Uuid, Uuid) {
        let agents = builtin_agents();
        let (agent_a, agent_b) = agent_ids(&agents);
        (SqliteDatabase::open_in_memory().unwrap(), agent_a, agent_b)
    }

    #[test]
    fn create_then_read_back() {
        let (db, agent_a, _) = setup_repo();
        let tip = sample_tip(
            Uuid::new_v4(),
            Some("标题"),
            "正文",
            &[binding(agent_a, true, 0)],
        );
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        let read = db.get(created.id).unwrap().expect("tip should exist");
        assert_eq!(read.content, "正文");
        assert_eq!(read.bindings.len(), 1);
        assert_eq!(read.bindings[0].agent_id, agent_a);
    }

    #[test]
    fn create_without_bindings_round_trips() {
        let (db, _, _) = setup_repo();
        let tip = sample_tip(Uuid::new_v4(), None, "先记录，稍后绑定", &[]);
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        assert!(created.bindings.is_empty());

        let read = db.get(created.id).unwrap().expect("tip should exist");
        assert_eq!(read.content, "先记录，稍后绑定");
        assert!(read.bindings.is_empty());
    }

    #[test]
    fn create_with_tags_round_trips() {
        let (db, agent_a, _) = setup_repo();
        let mut tip = sample_tip(
            Uuid::new_v4(),
            None,
            "无标题正文",
            &[binding(agent_a, true, 0)],
        );
        tip.tags = vec!["Rust".into(), "代码审查".into()];
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        assert_eq!(created.title, None);
        assert_eq!(created.tags, vec!["Rust", "代码审查"]);

        let read = db.get(created.id).unwrap().expect("tip should exist");
        assert_eq!(read.tags, created.tags);
        assert_eq!(TipRepository::list_tags(&db, 50).unwrap().len(), 2);
    }

    #[test]
    fn tag_constraint_failure_rolls_back_tip_and_bindings() {
        let (db, agent_a, _) = setup_repo();
        let mut tip = sample_tip(
            Uuid::new_v4(),
            None,
            "事务失败不能残留",
            &[binding(agent_a, true, 0)],
        );
        // 绕过领域校验直接验证 repository 的事务边界：两个值命中同一规范化标签。
        tip.tags = vec!["Rust".into(), "rust".into()];
        assert!(db.create_with_bindings(&tip, &tip.bindings).is_err());

        let conn = db.conn.lock().unwrap();
        for table in ["tips", "tip_agents", "tags", "tip_tags"] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} must roll back with the aggregate");
        }
    }

    #[test]
    fn create_with_multi_agent_bindings_keeps_independent_auto_attach() {
        let (db, agent_a, agent_b) = setup_repo();
        let tip = sample_tip(
            Uuid::new_v4(),
            None,
            "多 Agent",
            &[binding(agent_a, true, 0), binding(agent_b, false, 1)],
        );
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        assert_eq!(created.bindings.len(), 2);
        assert!(created.bindings[0].auto_attach);
        assert!(!created.bindings[1].auto_attach);
        assert_eq!(created.bindings[0].sort_order, 0);
        assert_eq!(created.bindings[1].sort_order, 1);
    }

    #[test]
    fn update_content_and_replace_bindings() {
        let (db, agent_a, agent_b) = setup_repo();
        let tip = sample_tip(Uuid::new_v4(), None, "旧正文", &[binding(agent_a, true, 0)]);
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();

        let mut updated = created.clone();
        updated.title = Some("新标题".into());
        updated.content = "新正文".into();
        updated.updated_at = now();
        updated.bindings = vec![binding(agent_b, true, 0), binding(agent_a, false, 1)];
        let result = db
            .update_with_bindings(&updated, &updated.bindings)
            .unwrap();
        assert_eq!(result.content, "新正文");
        assert_eq!(result.title.as_deref(), Some("新标题"));
        assert_eq!(result.bindings.len(), 2);
        assert!(result.bindings[0].auto_attach);
        assert!(!result.bindings[1].auto_attach);
    }

    #[test]
    fn delete_removes_tip_and_bindings() {
        let (db, agent_a, _) = setup_repo();
        let tip = sample_tip(Uuid::new_v4(), None, "待删除", &[binding(agent_a, true, 0)]);
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        db.delete(created.id).unwrap();
        assert!(db.get(created.id).unwrap().is_none());
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tip_agents WHERE tip_id = ?1",
                params![created.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "bindings must be removed");
    }

    #[test]
    fn binding_unknown_agent_rolls_back_transaction() {
        let (db, _, _) = setup_repo();
        let ghost = Uuid::new_v4();
        let tip = sample_tip(Uuid::new_v4(), None, "不会残留", &[binding(ghost, true, 0)]);
        assert!(matches!(
            db.create_with_bindings(&tip, &tip.bindings),
            Err(AppError::NotFound(_))
        ));
        assert!(TipRepository::list(&db, &TipQuery::default())
            .unwrap()
            .is_empty());
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tips", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0, "no partial tip rows");
    }

    #[test]
    fn filter_by_agent() {
        let (db, agent_a, agent_b) = setup_repo();
        let t1 = sample_tip(Uuid::new_v4(), None, "A", &[binding(agent_a, true, 0)]);
        let t2 = sample_tip(Uuid::new_v4(), None, "B", &[binding(agent_b, true, 0)]);
        db.create_with_bindings(&t1, &t1.bindings).unwrap();
        db.create_with_bindings(&t2, &t2.bindings).unwrap();
        let list = TipRepository::list(
            &db,
            &TipQuery {
                agent_id: Some(agent_a),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].content, "A");
    }

    #[test]
    fn search_by_keyword() {
        let (db, agent_a, _) = setup_repo();
        let t1 = sample_tip(
            Uuid::new_v4(),
            Some("运行测试"),
            "内容一",
            &[binding(agent_a, true, 0)],
        );
        let t2 = sample_tip(
            Uuid::new_v4(),
            Some("部署脚本"),
            "内容二",
            &[binding(agent_a, true, 0)],
        );
        db.create_with_bindings(&t1, &t1.bindings).unwrap();
        db.create_with_bindings(&t2, &t2.bindings).unwrap();
        let list = TipRepository::list(
            &db,
            &TipQuery {
                search: Some("测试".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title.as_deref(), Some("运行测试"));
    }

    #[test]
    fn search_by_tag() {
        let (db, agent_a, _) = setup_repo();
        let mut tagged = sample_tip(
            Uuid::new_v4(),
            None,
            "正文不包含检索词",
            &[binding(agent_a, true, 0)],
        );
        tagged.tags = vec!["数据库迁移".into()];
        db.create_with_bindings(&tagged, &tagged.bindings).unwrap();

        let list = TipRepository::list(
            &db,
            &TipQuery {
                search: Some("迁移".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tags, vec!["数据库迁移"]);
    }

    #[test]
    fn list_order_is_deterministic() {
        let (db, agent_a, _) = setup_repo();
        let base = now();
        for (i, title) in ["第一条", "第二条", "第三条"].iter().enumerate() {
            let mut tip = sample_tip(
                Uuid::new_v4(),
                Some(title),
                "内容",
                &[binding(agent_a, true, 0)],
            );
            tip.updated_at = base + chrono::Duration::seconds(i as i64);
            db.create_with_bindings(&tip, &tip.bindings).unwrap();
        }
        let first = TipRepository::list(&db, &TipQuery::default()).unwrap();
        let second = TipRepository::list(&db, &TipQuery::default()).unwrap();
        let titles: Vec<Option<String>> = first.iter().map(|t| t.title.clone()).collect();
        assert_eq!(titles[0].as_deref(), Some("第三条"));
        assert_eq!(titles[2].as_deref(), Some("第一条"));
        assert_eq!(
            titles,
            second.iter().map(|t| t.title.clone()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn data_survives_reopen() {
        let path = temp_db_path("reopen");
        let tip_id = Uuid::new_v4();
        {
            let db = SqliteDatabase::open(&path).unwrap();
            let agents = AgentRepository::list(&db).unwrap();
            let tip = sample_tip(
                tip_id,
                Some("持久化"),
                "重启后仍在",
                &[binding(agents[0].id, true, 0)],
            );
            db.create_with_bindings(&tip, &tip.bindings).unwrap();
        }
        let db = SqliteDatabase::open(&path).unwrap();
        let read = db.get(tip_id).unwrap().expect("data must survive reopen");
        assert_eq!(read.content, "重启后仍在");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn backfill_gives_old_tips_varied_colors() {
        let path = temp_db_path("backfill");
        // 先手工构造 migration 1 的旧库（无 color_key 列）
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE tips (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                INSERT INTO tips VALUES
                    ('11111111-1111-1111-1111-111111111111','a','x','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('22222222-2222-2222-2222-222222222222','b','y','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('33333333-3333-3333-3333-333333333333','c','z','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('44444444-4444-4444-4444-444444444444','d','w','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('55555555-5555-5555-5555-555555555555','e','v','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('66666666-6666-6666-6666-666666666666','f','u','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('77777777-7777-7777-7777-777777777777','g','t','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('88888888-8888-8888-8888-888888888888','h','s','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('99999999-9999-9999-9999-999999999999','i','r','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL),
                    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','j','q','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL);",
            )
            .unwrap();
        }
        // 打开后自动执行 migration 2 + backfill
        let db = SqliteDatabase::open(&path).unwrap();
        let tips = TipRepository::list(&db, &TipQuery::default()).unwrap();
        assert_eq!(tips.len(), 10);
        let colors: std::collections::HashSet<NoteColorKey> =
            tips.iter().map(|t| t.color_key).collect();
        assert!(
            colors.len() >= 4,
            "10 条旧 Tip 至少 4 种颜色，实际 {}",
            colors.len()
        );
        assert!(tips
            .iter()
            .all(|t| crate::domain::color::ALL_NOTE_COLORS.contains(&t.color_key)));
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn used_filter_and_mark_restore_round_trip() {
        let (db, agent_a, _) = setup_repo();
        let tip = sample_tip(
            Uuid::new_v4(),
            None,
            "生命周期",
            &[binding(agent_a, true, 0)],
        );
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        // 首页（used=false/None）可见
        assert_eq!(
            TipRepository::list(&db, &TipQuery::default())
                .unwrap()
                .len(),
            1
        );
        let used = TipRepository::mark_used(&db, created.id, now()).unwrap();
        assert!(used.used_at.is_some());
        assert_eq!(used.color_key, created.color_key, "mark used 不改颜色");
        // 首页消失，Used View 可见
        assert!(TipRepository::list(&db, &TipQuery::default())
            .unwrap()
            .is_empty());
        assert_eq!(
            TipRepository::list(
                &db,
                &TipQuery {
                    used: Some(true),
                    ..Default::default()
                }
            )
            .unwrap()
            .len(),
            1
        );
        let restored = TipRepository::restore_used(&db, created.id).unwrap();
        assert!(restored.used_at.is_none());
        assert_eq!(restored.color_key, created.color_key, "restore 不改颜色");
        assert_eq!(
            TipRepository::list(&db, &TipQuery::default())
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn update_text_does_not_touch_other_fields() {
        let (db, agent_a, _) = setup_repo();
        let tip = sample_tip(
            Uuid::new_v4(),
            Some("原标题"),
            "原正文",
            &[binding(agent_a, true, 0)],
        );
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        let updated =
            TipRepository::update_text(&db, created.id, Some("新标题"), "新正文", now()).unwrap();
        assert_eq!(updated.title.as_deref(), Some("新标题"));
        assert_eq!(updated.content, "新正文");
        assert_eq!(updated.color_key, created.color_key);
        assert_eq!(updated.used_at, created.used_at);
        assert_eq!(updated.status, created.status);
        assert_eq!(updated.bindings, created.bindings);
    }

    #[test]
    fn titleless_text_update_stays_titleless_and_keeps_tags() {
        let (db, agent_a, _) = setup_repo();
        let mut tip = sample_tip(Uuid::new_v4(), None, "原正文", &[binding(agent_a, true, 0)]);
        tip.tags = vec!["持续保留".into()];
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        let updated = TipRepository::update_text(&db, created.id, None, "新正文", now()).unwrap();
        assert_eq!(updated.title, None);
        assert_eq!(updated.tags, vec!["持续保留"]);
        assert_eq!(updated.bindings, created.bindings);
    }

    #[test]
    fn update_color_changes_key_only() {
        let (db, agent_a, _) = setup_repo();
        let tip = sample_tip(Uuid::new_v4(), None, "换色", &[binding(agent_a, true, 0)]);
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        assert_ne!(created.color_key, NoteColorKey::Sky);
        let updated = TipRepository::update_color(&db, created.id, NoteColorKey::Sky).unwrap();
        assert_eq!(updated.color_key, NoteColorKey::Sky);
        assert_eq!(updated.content, created.content);
        assert_eq!(updated.used_at, created.used_at);
        assert_eq!(updated.bindings, created.bindings);
    }

    // 防止 builtin_agents helper 未使用告警
    #[allow(dead_code)]
    fn _kind_used(kind: AgentKind) -> &'static str {
        kind.as_str()
    }
}
