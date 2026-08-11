use tauri::State;

use crate::domain::reminder::{ReminderPayload, ReminderSettings, ReminderSnoozeResult};
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
pub fn reminder_snooze(
    state: State<'_, AppState>,
    hours: i64,
) -> Result<ReminderSnoozeResult, AppErrorDto> {
    state
        .reminder
        .snooze_current(hours)
        .map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn reminder_list_agent_snoozes(
    state: State<'_, AppState>,
) -> Result<Vec<ReminderSnoozeResult>, AppErrorDto> {
    state
        .reminder
        .list_agent_snoozes()
        .map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn reminder_snooze_agent(
    state: State<'_, AppState>,
    agent_key: String,
    hours: i64,
) -> Result<ReminderSnoozeResult, AppErrorDto> {
    state
        .reminder
        .snooze_agent(&agent_key, hours)
        .map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn reminder_resume_agent(
    state: State<'_, AppState>,
    agent_key: String,
) -> Result<(), AppErrorDto> {
    state
        .reminder
        .resume_agent(&agent_key)
        .map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn reminder_get_current_payload(state: State<'_, AppState>) -> Option<ReminderPayload> {
    state.reminder.current_payload()
}
