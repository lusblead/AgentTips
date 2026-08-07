use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers};

use crate::domain::hotkey::{HotkeyBinding, HotkeyKey};
use crate::error::{AppError, AppResult};
use crate::ports::hotkey_registrar::HotkeyRegistrarPort;

/// HotkeyKey → tauri_plugin_global_shortcut::Code 的权威显式映射。
/// 禁止依赖 Debug/parse 隐式转换。
pub fn hotkey_code(key: HotkeyKey) -> Code {
    match key {
        HotkeyKey::KeyA => Code::KeyA,
        HotkeyKey::KeyB => Code::KeyB,
        HotkeyKey::KeyC => Code::KeyC,
        HotkeyKey::KeyD => Code::KeyD,
        HotkeyKey::KeyE => Code::KeyE,
        HotkeyKey::KeyF => Code::KeyF,
        HotkeyKey::KeyG => Code::KeyG,
        HotkeyKey::KeyH => Code::KeyH,
        HotkeyKey::KeyI => Code::KeyI,
        HotkeyKey::KeyJ => Code::KeyJ,
        HotkeyKey::KeyK => Code::KeyK,
        HotkeyKey::KeyL => Code::KeyL,
        HotkeyKey::KeyM => Code::KeyM,
        HotkeyKey::KeyN => Code::KeyN,
        HotkeyKey::KeyO => Code::KeyO,
        HotkeyKey::KeyP => Code::KeyP,
        HotkeyKey::KeyQ => Code::KeyQ,
        HotkeyKey::KeyR => Code::KeyR,
        HotkeyKey::KeyS => Code::KeyS,
        HotkeyKey::KeyT => Code::KeyT,
        HotkeyKey::KeyU => Code::KeyU,
        HotkeyKey::KeyV => Code::KeyV,
        HotkeyKey::KeyW => Code::KeyW,
        HotkeyKey::KeyX => Code::KeyX,
        HotkeyKey::KeyY => Code::KeyY,
        HotkeyKey::KeyZ => Code::KeyZ,
        HotkeyKey::Digit0 => Code::Digit0,
        HotkeyKey::Digit1 => Code::Digit1,
        HotkeyKey::Digit2 => Code::Digit2,
        HotkeyKey::Digit3 => Code::Digit3,
        HotkeyKey::Digit4 => Code::Digit4,
        HotkeyKey::Digit5 => Code::Digit5,
        HotkeyKey::Digit6 => Code::Digit6,
        HotkeyKey::Digit7 => Code::Digit7,
        HotkeyKey::Digit8 => Code::Digit8,
        HotkeyKey::Digit9 => Code::Digit9,
        HotkeyKey::F1 => Code::F1,
        HotkeyKey::F2 => Code::F2,
        HotkeyKey::F3 => Code::F3,
        HotkeyKey::F4 => Code::F4,
        HotkeyKey::F5 => Code::F5,
        HotkeyKey::F6 => Code::F6,
        HotkeyKey::F7 => Code::F7,
        HotkeyKey::F8 => Code::F8,
        HotkeyKey::F9 => Code::F9,
        HotkeyKey::F10 => Code::F10,
        HotkeyKey::F11 => Code::F11,
        HotkeyKey::F12 => Code::F12,
        HotkeyKey::Backquote => Code::Backquote,
        HotkeyKey::Minus => Code::Minus,
        HotkeyKey::Equal => Code::Equal,
        HotkeyKey::BracketLeft => Code::BracketLeft,
        HotkeyKey::BracketRight => Code::BracketRight,
        HotkeyKey::Backslash => Code::Backslash,
        HotkeyKey::Semicolon => Code::Semicolon,
        HotkeyKey::Quote => Code::Quote,
        HotkeyKey::Comma => Code::Comma,
        HotkeyKey::Period => Code::Period,
        HotkeyKey::Slash => Code::Slash,
    }
}

fn shortcut(binding: &HotkeyBinding) -> tauri_plugin_global_shortcut::Shortcut {
    tauri_plugin_global_shortcut::Shortcut::new(Some(Modifiers::CONTROL), hotkey_code(binding.key))
}

/// 真实 Tauri global-shortcut 适配器。只实现注册能力；
/// trigger 事件由 lib.rs 的 plugin with_handler 转发到 HotkeyRuntime。
pub struct TauriGlobalShortcutAdapter {
    app: AppHandle,
}

impl TauriGlobalShortcutAdapter {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl HotkeyRegistrarPort for TauriGlobalShortcutAdapter {
    fn register(&self, binding: &HotkeyBinding) -> AppResult<()> {
        self.app
            .global_shortcut()
            .register(shortcut(binding))
            .map_err(|e| AppError::HotkeyRegistrationFailed(e.to_string()))
    }

    fn unregister(&self, binding: &HotkeyBinding) -> AppResult<()> {
        self.app
            .global_shortcut()
            .unregister(shortcut(binding))
            .map_err(|e| AppError::HotkeyRegistrationFailed(e.to_string()))
    }

    fn is_registered_by_this_app(&self, binding: &HotkeyBinding) -> AppResult<bool> {
        Ok(self.app.global_shortcut().is_registered(shortcut(binding)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::hotkey::ALL_HOTKEY_KEYS;

    #[test]
    fn every_hotkey_key_maps_to_a_tauri_code() {
        // 所有支持键都必须能映射；Code 枚举没有 PartialEq 公开比较，
        // 这里通过 match 覆盖保证编译期完整性 + 运行时 non-panic。
        for key in ALL_HOTKEY_KEYS {
            let _code = hotkey_code(*key);
        }
    }

    #[test]
    fn sample_mappings_are_stable() {
        assert_eq!(hotkey_code(HotkeyKey::KeyK), Code::KeyK);
        assert_eq!(hotkey_code(HotkeyKey::Digit1), Code::Digit1);
        assert_eq!(hotkey_code(HotkeyKey::F12), Code::F12);
        assert_eq!(hotkey_code(HotkeyKey::Period), Code::Period);
        assert_eq!(hotkey_code(HotkeyKey::Slash), Code::Slash);
        assert_eq!(hotkey_code(HotkeyKey::Minus), Code::Minus);
        assert_eq!(hotkey_code(HotkeyKey::Backquote), Code::Backquote);
        assert_eq!(hotkey_code(HotkeyKey::Semicolon), Code::Semicolon);
        assert_eq!(hotkey_code(HotkeyKey::Quote), Code::Quote);
        assert_eq!(hotkey_code(HotkeyKey::Comma), Code::Comma);
        assert_eq!(hotkey_code(HotkeyKey::BracketLeft), Code::BracketLeft);
        assert_eq!(hotkey_code(HotkeyKey::BracketRight), Code::BracketRight);
        assert_eq!(hotkey_code(HotkeyKey::Backslash), Code::Backslash);
        assert_eq!(hotkey_code(HotkeyKey::Equal), Code::Equal);
    }
}
