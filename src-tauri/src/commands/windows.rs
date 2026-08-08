use tauri::State;

use crate::application::detection::ForegroundWatcher;
use crate::error::AppErrorDto;
use crate::AppState;
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[tauri::command]
pub async fn window_open_main(state: State<'_, AppState>) -> Result<(), AppErrorDto> {
    state.windows.open_main().map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn window_open_quick_note(state: State<'_, AppState>) -> Result<(), AppErrorDto> {
    state.windows.open_quick_note().map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn window_open_settings(state: State<'_, AppState>) -> Result<(), AppErrorDto> {
    state.windows.open_settings().map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn window_hide_current(
    state: State<'_, AppState>,
    label: String,
) -> Result<(), AppErrorDto> {
    let label =
        crate::ports::window_manager::WindowLabel::from_label(&label).map_err(AppErrorDto::from)?;
    state.windows.hide(label).map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn window_get_kind(
    state: State<'_, AppState>,
    label: String,
) -> Result<String, AppErrorDto> {
    let _ = state;
    let label =
        crate::ports::window_manager::WindowLabel::from_label(&label).map_err(AppErrorDto::from)?;
    Ok(label.as_str().to_string())
}

#[tauri::command]
pub async fn window_quit(
    state: State<'_, AppState>,
    watcher: State<'_, Arc<ForegroundWatcher>>,
) -> Result<(), AppErrorDto> {
    let _ = watcher.stop();
    state.is_quitting.store(true, Ordering::Relaxed);
    state.windows.quit().map_err(AppErrorDto::from)
}
