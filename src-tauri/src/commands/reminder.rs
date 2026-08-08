use tauri::State;

use crate::domain::reminder::{ReminderPayload, ReminderSettings};
use crate::error::AppErrorDto;
use crate::AppState;

#[tauri::command]
pub fn reminder_settings_get(state: State<'_, AppState>) -> Result<ReminderSettings, AppErrorDto> {
    state.reminder.get_settings().map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn reminder_settings_update(
    state: State<'_, AppState>,
    cooldown_minutes: i64,
) -> Result<ReminderSettings, AppErrorDto> {
    state
        .reminder
        .update_settings(cooldown_minutes)
        .map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn reminder_dismiss(state: State<'_, AppState>) -> Result<(), AppErrorDto> {
    state.reminder.dismiss().map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn reminder_get_current_payload(state: State<'_, AppState>) -> Option<ReminderPayload> {
    state.reminder.current_payload()
}
