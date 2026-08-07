use serde::Serialize;
use std::sync::Arc;
use tauri::State;

use crate::application::hotkey::HotkeyRuntime;
use crate::domain::hotkey::{HotkeyBinding, HotkeyPreview};
use crate::error::AppErrorDto;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBindingDto {
    pub modifier: &'static str,
    pub key_code: &'static str,
    pub display_label: String,
    pub high_conflict: bool,
}

impl From<HotkeyBinding> for HotkeyBindingDto {
    fn from(binding: HotkeyBinding) -> Self {
        Self {
            modifier: "Ctrl",
            key_code: binding.key.key_code(),
            display_label: binding.display_label(),
            high_conflict: binding.is_high_conflict(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyWarningDto {
    pub code: &'static str,
    pub message: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "ok")]
pub enum HotkeyPreviewDto {
    Valid {
        binding: HotkeyBindingDto,
        #[serde(skip_serializing_if = "Option::is_none")]
        warning: Option<HotkeyWarningDto>,
    },
    Invalid {
        reason: &'static str,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyRuntimeStateDto {
    pub configured: Option<HotkeyBindingDto>,
    pub active: Option<HotkeyBindingDto>,
    pub registration_error: Option<String>,
}

impl From<crate::application::hotkey::HotkeyRuntimeState> for HotkeyRuntimeStateDto {
    fn from(state: crate::application::hotkey::HotkeyRuntimeState) -> Self {
        Self {
            configured: state.configured.map(HotkeyBindingDto::from),
            active: state.active.map(HotkeyBindingDto::from),
            registration_error: state.registration_error,
        }
    }
}

impl From<HotkeyPreview> for HotkeyPreviewDto {
    fn from(preview: HotkeyPreview) -> Self {
        match preview {
            HotkeyPreview::Valid { binding, warning } => HotkeyPreviewDto::Valid {
                binding: HotkeyBindingDto::from(binding),
                warning: warning.map(|w| HotkeyWarningDto {
                    code: w.code,
                    message: w.message,
                }),
            },
            HotkeyPreview::Invalid { reason } => {
                let (reason_str, message) = match reason {
                    crate::domain::hotkey::HotkeyInvalidReason::InvalidModifiers => {
                        ("invalid", "快捷键只能使用 Ctrl + 一个按键".to_string())
                    }
                    crate::domain::hotkey::HotkeyInvalidReason::UnsupportedKey => {
                        ("unsupported", "该按键不在支持范围内".to_string())
                    }
                };
                HotkeyPreviewDto::Invalid {
                    reason: reason_str,
                    message,
                }
            }
        }
    }
}

#[tauri::command]
pub fn hotkey_get(runtime: State<'_, Arc<HotkeyRuntime>>) -> HotkeyRuntimeStateDto {
    runtime.get_state().into()
}

#[tauri::command]
pub fn hotkey_preview(
    runtime: State<'_, Arc<HotkeyRuntime>>,
    modifier: String,
    key_code: String,
) -> HotkeyPreviewDto {
    runtime.preview(&modifier, &key_code).into()
}

#[tauri::command]
pub async fn hotkey_update(
    runtime: State<'_, Arc<HotkeyRuntime>>,
    modifier: String,
    key_code: String,
) -> Result<HotkeyBindingDto, AppErrorDto> {
    runtime
        .update(&modifier, &key_code)
        .map(HotkeyBindingDto::from)
        .map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn hotkey_recording_begin(runtime: State<'_, Arc<HotkeyRuntime>>) {
    runtime.begin_recording();
}

#[tauri::command]
pub fn hotkey_recording_end(runtime: State<'_, Arc<HotkeyRuntime>>) {
    runtime.end_recording();
}
