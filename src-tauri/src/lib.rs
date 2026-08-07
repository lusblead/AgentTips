pub mod adapters;
pub mod application;
pub mod commands;
pub mod domain;
pub mod dto;
pub mod error;
pub mod ports;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{Manager, WindowEvent};

use adapters::clock::SystemClock;
use adapters::id::UuidGenerator;
use adapters::sqlite::SqliteDatabase;
use adapters::sqlite_hotkey_settings::SqliteHotkeySettingsRepository;
use adapters::tauri_global_shortcut::TauriGlobalShortcutAdapter;
use adapters::tauri_window_manager::TauriWindowManager;
use application::agents::AgentService;
use application::hotkey::HotkeyRuntime;
use application::tips::TipService;
use application::windows::WindowApplicationService;
use commands::agents::agent_list;
use commands::hotkey::{
    hotkey_get, hotkey_preview, hotkey_recording_begin, hotkey_recording_end, hotkey_update,
};
use commands::tips::{
    note_color_suggest, tip_create, tip_delete, tip_get, tip_list, tip_mark_used, tip_restore_used,
    tip_update, tip_update_color, tip_update_text,
};
use commands::windows::{
    window_get_kind, window_hide_current, window_open_main, window_open_quick_note,
    window_open_settings, window_quit,
};
use ports::window_manager::{WindowLabel, WindowManagerPort};

/// 应用共享状态（composition root 装配）。
pub struct AppState {
    pub tips: TipService,
    pub agents: AgentService,
    pub windows: WindowApplicationService,
    pub is_quitting: Arc<AtomicBool>,
}

fn database_path(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // E2E 隔离：仅 debug/test 构建允许通过 AGENTTIPS_TEST_DATA_DIR 覆盖数据目录。
    // Release 构建无条件忽略该变量，始终使用正常 app_data_dir（Windows Known Folder API）。
    #[cfg(debug_assertions)]
    let data_dir = match std::env::var_os("AGENTTIPS_TEST_DATA_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => app.path().app_data_dir()?,
    };
    #[cfg(not(debug_assertions))]
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    Ok(data_dir.join("agenttips.sqlite3"))
}

/// 统一窗口关闭语义：main/settings → hide；quick-note → hide（draft 由前端清）。
/// 只有 is_quitting=true（Tray 退出 / quit command）才允许真正关闭。
fn on_window_event<R: tauri::Runtime>(
    state: &AppState,
    window: &tauri::Window<R>,
    event: &WindowEvent,
) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if state.is_quitting.load(Ordering::Relaxed) {
            return;
        }
        api.prevent_close();
        let label = window.label();
        let window_label = WindowLabel::from_label(label).ok();
        if let Some(window_label) = window_label {
            let _ = state.windows.hide(window_label);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // 只处理 Pressed；Released 忽略。
                    // 触发只调用 HotkeyRuntime 协调器，窗口逻辑复用 WindowApplicationService。
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(runtime) = app.try_state::<Arc<HotkeyRuntime>>() {
                            let _ = runtime.on_shortcut_pressed();
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 第二实例：唤醒第一实例的 Main Window
            let state = app.state::<AppState>();
            let _ = state.windows.open_main();
        }))
        .setup(|app| {
            let db_path = database_path(app)?;
            let db = Arc::new(SqliteDatabase::open(&db_path)?);
            let clock = Arc::new(SystemClock);
            let ids = Arc::new(UuidGenerator);

            let tips = TipService::new(db.clone(), clock.clone(), ids);
            let agents = AgentService::new(db.clone());

            let app_handle = app.handle().clone();
            let window_manager = Arc::new(TauriWindowManager::new(app_handle.clone()));
            let windows = WindowApplicationService::new(window_manager.clone());
            let is_quitting = Arc::new(AtomicBool::new(false));

            // Global Hotkey Runtime：启动注册失败不阻塞应用（Main/Tray/Settings 继续可用）
            let hotkey_repo = Arc::new(SqliteHotkeySettingsRepository::new(db.clone()));
            let registrar = Arc::new(TauriGlobalShortcutAdapter::new(app_handle.clone()));
            let hotkey = Arc::new(HotkeyRuntime::new(
                registrar,
                hotkey_repo,
                clock.clone(),
                Arc::new(windows.clone()) as Arc<dyn application::hotkey::HotkeyWindowPort>,
            ));
            hotkey.startup()?;

            app.manage(AppState {
                tips,
                agents,
                windows,
                is_quitting: is_quitting.clone(),
            });
            app.manage(hotkey);

            // 主窗口启动即创建并显示
            let _ = window_manager.show(WindowLabel::Main);

            // System Tray
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            let open_main = MenuItemBuilder::with_id("open_main", "打开 AgentTips").build(app)?;
            let open_quick = MenuItemBuilder::with_id("open_quick_note", "新建提示").build(app)?;
            let open_settings = MenuItemBuilder::with_id("open_settings", "设置").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&open_main)
                .item(&open_quick)
                .item(&open_settings)
                .separator()
                .item(&quit)
                .build()?;

            let tray = tauri::tray::TrayIconBuilder::with_id("agenttips-tray")
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| {
                    let state = app.state::<AppState>();
                    match event.id().as_ref() {
                        "open_main" => {
                            let _ = state.windows.open_main();
                        }
                        "open_quick_note" => {
                            let _ = state.windows.open_quick_note();
                        }
                        "open_settings" => {
                            let _ = state.windows.open_settings();
                        }
                        "quit" => {
                            state.is_quitting.store(true, Ordering::Relaxed);
                            let _ = state.windows.quit();
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            // 持有 tray 引用，确保图标在应用生命周期内常驻系统托盘
            app.manage(tray);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let Some(state) = window.try_state::<AppState>() {
                on_window_event(&state, window, event);
            }
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
            agent_list,
            hotkey_get,
            hotkey_preview,
            hotkey_update,
            hotkey_recording_begin,
            hotkey_recording_end,
            window_open_main,
            window_open_quick_note,
            window_open_settings,
            window_hide_current,
            window_get_kind,
            window_quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
