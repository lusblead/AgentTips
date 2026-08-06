pub mod adapters;
pub mod application;
pub mod domain;
pub mod error;
pub mod ports;

/// Phase 0：最小可运行窗口，无业务 Command。
/// Phase 2+ 在此挂载 app state、SQLite 与业务 Command。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
