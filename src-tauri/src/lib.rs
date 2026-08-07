pub mod adapters;
pub mod application;
pub mod commands;
pub mod domain;
pub mod dto;
pub mod error;
pub mod ports;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use adapters::clock::SystemClock;
use adapters::id::UuidGenerator;
use adapters::sqlite::SqliteDatabase;
use application::agents::AgentService;
use application::tips::TipService;
use commands::agents::agent_list;
use commands::tips::{
    note_color_suggest, tip_create, tip_delete, tip_get, tip_list, tip_mark_used, tip_restore_used,
    tip_update, tip_update_color, tip_update_text,
};

/// 应用共享状态（composition root 装配）。
pub struct AppState {
    pub tips: TipService,
    pub agents: AgentService,
}

fn database_path(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    Ok(data_dir.join("agenttips.sqlite3"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db_path = database_path(app)?;
            let db = Arc::new(SqliteDatabase::open(&db_path)?);
            let clock = Arc::new(SystemClock);
            let ids = Arc::new(UuidGenerator);

            let tips = TipService::new(db.clone(), clock, ids);
            let agents = AgentService::new(db);
            app.manage(AppState { tips, agents });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tip_create,
            tip_get,
            tip_list,
            tip_update,
            tip_delete,
            note_color_suggest,
            tip_update_text,
            tip_mark_used,
            tip_restore_used,
            tip_update_color,
            agent_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
