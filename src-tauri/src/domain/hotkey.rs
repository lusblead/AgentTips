use serde::{Deserialize, Serialize};

/// 全局快捷键第一版只允许 Control 修饰键。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum HotkeyModifier {
    Control,
}

/// 支持键范围：A-Z / 0-9 / F1-F12 / 常用标点单键。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum HotkeyKey {
    KeyA,
    KeyB,
    KeyC,
    KeyD,
    KeyE,
    KeyF,
    KeyG,
    KeyH,
    KeyI,
    KeyJ,
    KeyK,
    KeyL,
    KeyM,
    KeyN,
    KeyO,
    KeyP,
    KeyQ,
    KeyR,
    KeyS,
    KeyT,
    KeyU,
    KeyV,
    KeyW,
    KeyX,
    KeyY,
    KeyZ,
    Digit0,
    Digit1,
    Digit2,
    Digit3,
    Digit4,
    Digit5,
    Digit6,
    Digit7,
    Digit8,
    Digit9,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    Backquote,
    Minus,
    Equal,
    BracketLeft,
    BracketRight,
    Backslash,
    Semicolon,
    Quote,
    Comma,
    Period,
    Slash,
}

pub const ALL_HOTKEY_KEYS: &[HotkeyKey] = &[
    HotkeyKey::KeyA,
    HotkeyKey::KeyB,
    HotkeyKey::KeyC,
    HotkeyKey::KeyD,
    HotkeyKey::KeyE,
    HotkeyKey::KeyF,
    HotkeyKey::KeyG,
    HotkeyKey::KeyH,
    HotkeyKey::KeyI,
    HotkeyKey::KeyJ,
    HotkeyKey::KeyK,
    HotkeyKey::KeyL,
    HotkeyKey::KeyM,
    HotkeyKey::KeyN,
    HotkeyKey::KeyO,
    HotkeyKey::KeyP,
    HotkeyKey::KeyQ,
    HotkeyKey::KeyR,
    HotkeyKey::KeyS,
    HotkeyKey::KeyT,
    HotkeyKey::KeyU,
    HotkeyKey::KeyV,
    HotkeyKey::KeyW,
    HotkeyKey::KeyX,
    HotkeyKey::KeyY,
    HotkeyKey::KeyZ,
    HotkeyKey::Digit0,
    HotkeyKey::Digit1,
    HotkeyKey::Digit2,
    HotkeyKey::Digit3,
    HotkeyKey::Digit4,
    HotkeyKey::Digit5,
    HotkeyKey::Digit6,
    HotkeyKey::Digit7,
    HotkeyKey::Digit8,
    HotkeyKey::Digit9,
    HotkeyKey::F1,
    HotkeyKey::F2,
    HotkeyKey::F3,
    HotkeyKey::F4,
    HotkeyKey::F5,
    HotkeyKey::F6,
    HotkeyKey::F7,
    HotkeyKey::F8,
    HotkeyKey::F9,
    HotkeyKey::F10,
    HotkeyKey::F11,
    HotkeyKey::F12,
    HotkeyKey::Backquote,
    HotkeyKey::Minus,
    HotkeyKey::Equal,
    HotkeyKey::BracketLeft,
    HotkeyKey::BracketRight,
    HotkeyKey::Backslash,
    HotkeyKey::Semicolon,
    HotkeyKey::Quote,
    HotkeyKey::Comma,
    HotkeyKey::Period,
    HotkeyKey::Slash,
];

/// 全局快捷键绑定：第一版始终 Ctrl + 一个键。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct HotkeyBinding {
    pub modifier: HotkeyModifier,
    pub key: HotkeyKey,
}

/// 高冲突组合（格式合法但常被其他软件占用）。
pub const HIGH_CONFLICT_KEYS: &[HotkeyKey] = &[
    HotkeyKey::KeyA,
    HotkeyKey::KeyC,
    HotkeyKey::KeyF,
    HotkeyKey::KeyN,
    HotkeyKey::KeyO,
    HotkeyKey::KeyP,
    HotkeyKey::KeyR,
    HotkeyKey::KeyS,
    HotkeyKey::KeyT,
    HotkeyKey::KeyV,
    HotkeyKey::KeyW,
    HotkeyKey::KeyX,
    HotkeyKey::KeyZ,
];

impl HotkeyKey {
    /// KeyboardEvent.code 字符串（与 from_key_code 互逆，用于持久化）。
    pub fn key_code(&self) -> &'static str {
        match self {
            HotkeyKey::KeyA => "KeyA",
            HotkeyKey::KeyB => "KeyB",
            HotkeyKey::KeyC => "KeyC",
            HotkeyKey::KeyD => "KeyD",
            HotkeyKey::KeyE => "KeyE",
            HotkeyKey::KeyF => "KeyF",
            HotkeyKey::KeyG => "KeyG",
            HotkeyKey::KeyH => "KeyH",
            HotkeyKey::KeyI => "KeyI",
            HotkeyKey::KeyJ => "KeyJ",
            HotkeyKey::KeyK => "KeyK",
            HotkeyKey::KeyL => "KeyL",
            HotkeyKey::KeyM => "KeyM",
            HotkeyKey::KeyN => "KeyN",
            HotkeyKey::KeyO => "KeyO",
            HotkeyKey::KeyP => "KeyP",
            HotkeyKey::KeyQ => "KeyQ",
            HotkeyKey::KeyR => "KeyR",
            HotkeyKey::KeyS => "KeyS",
            HotkeyKey::KeyT => "KeyT",
            HotkeyKey::KeyU => "KeyU",
            HotkeyKey::KeyV => "KeyV",
            HotkeyKey::KeyW => "KeyW",
            HotkeyKey::KeyX => "KeyX",
            HotkeyKey::KeyY => "KeyY",
            HotkeyKey::KeyZ => "KeyZ",
            HotkeyKey::Digit0 => "Digit0",
            HotkeyKey::Digit1 => "Digit1",
            HotkeyKey::Digit2 => "Digit2",
            HotkeyKey::Digit3 => "Digit3",
            HotkeyKey::Digit4 => "Digit4",
            HotkeyKey::Digit5 => "Digit5",
            HotkeyKey::Digit6 => "Digit6",
            HotkeyKey::Digit7 => "Digit7",
            HotkeyKey::Digit8 => "Digit8",
            HotkeyKey::Digit9 => "Digit9",
            HotkeyKey::F1 => "F1",
            HotkeyKey::F2 => "F2",
            HotkeyKey::F3 => "F3",
            HotkeyKey::F4 => "F4",
            HotkeyKey::F5 => "F5",
            HotkeyKey::F6 => "F6",
            HotkeyKey::F7 => "F7",
            HotkeyKey::F8 => "F8",
            HotkeyKey::F9 => "F9",
            HotkeyKey::F10 => "F10",
            HotkeyKey::F11 => "F11",
            HotkeyKey::F12 => "F12",
            HotkeyKey::Backquote => "Backquote",
            HotkeyKey::Minus => "Minus",
            HotkeyKey::Equal => "Equal",
            HotkeyKey::BracketLeft => "BracketLeft",
            HotkeyKey::BracketRight => "BracketRight",
            HotkeyKey::Backslash => "Backslash",
            HotkeyKey::Semicolon => "Semicolon",
            HotkeyKey::Quote => "Quote",
            HotkeyKey::Comma => "Comma",
            HotkeyKey::Period => "Period",
            HotkeyKey::Slash => "Slash",
        }
    }

    /// 从 KeyboardEvent.code（如 "KeyK" / "Digit1" / "F12" / "Period"）解析。
    /// 未知键返回 None（由调用方映射为 unsupported）。
    pub fn from_key_code(code: &str) -> Option<HotkeyKey> {
        match code {
            "KeyA" => Some(HotkeyKey::KeyA),
            "KeyB" => Some(HotkeyKey::KeyB),
            "KeyC" => Some(HotkeyKey::KeyC),
            "KeyD" => Some(HotkeyKey::KeyD),
            "KeyE" => Some(HotkeyKey::KeyE),
            "KeyF" => Some(HotkeyKey::KeyF),
            "KeyG" => Some(HotkeyKey::KeyG),
            "KeyH" => Some(HotkeyKey::KeyH),
            "KeyI" => Some(HotkeyKey::KeyI),
            "KeyJ" => Some(HotkeyKey::KeyJ),
            "KeyK" => Some(HotkeyKey::KeyK),
            "KeyL" => Some(HotkeyKey::KeyL),
            "KeyM" => Some(HotkeyKey::KeyM),
            "KeyN" => Some(HotkeyKey::KeyN),
            "KeyO" => Some(HotkeyKey::KeyO),
            "KeyP" => Some(HotkeyKey::KeyP),
            "KeyQ" => Some(HotkeyKey::KeyQ),
            "KeyR" => Some(HotkeyKey::KeyR),
            "KeyS" => Some(HotkeyKey::KeyS),
            "KeyT" => Some(HotkeyKey::KeyT),
            "KeyU" => Some(HotkeyKey::KeyU),
            "KeyV" => Some(HotkeyKey::KeyV),
            "KeyW" => Some(HotkeyKey::KeyW),
            "KeyX" => Some(HotkeyKey::KeyX),
            "KeyY" => Some(HotkeyKey::KeyY),
            "KeyZ" => Some(HotkeyKey::KeyZ),
            "Digit0" => Some(HotkeyKey::Digit0),
            "Digit1" => Some(HotkeyKey::Digit1),
            "Digit2" => Some(HotkeyKey::Digit2),
            "Digit3" => Some(HotkeyKey::Digit3),
            "Digit4" => Some(HotkeyKey::Digit4),
            "Digit5" => Some(HotkeyKey::Digit5),
            "Digit6" => Some(HotkeyKey::Digit6),
            "Digit7" => Some(HotkeyKey::Digit7),
            "Digit8" => Some(HotkeyKey::Digit8),
            "Digit9" => Some(HotkeyKey::Digit9),
            "F1" => Some(HotkeyKey::F1),
            "F2" => Some(HotkeyKey::F2),
            "F3" => Some(HotkeyKey::F3),
            "F4" => Some(HotkeyKey::F4),
            "F5" => Some(HotkeyKey::F5),
            "F6" => Some(HotkeyKey::F6),
            "F7" => Some(HotkeyKey::F7),
            "F8" => Some(HotkeyKey::F8),
            "F9" => Some(HotkeyKey::F9),
            "F10" => Some(HotkeyKey::F10),
            "F11" => Some(HotkeyKey::F11),
            "F12" => Some(HotkeyKey::F12),
            "Backquote" => Some(HotkeyKey::Backquote),
            "Minus" => Some(HotkeyKey::Minus),
            "Equal" => Some(HotkeyKey::Equal),
            "BracketLeft" => Some(HotkeyKey::BracketLeft),
            "BracketRight" => Some(HotkeyKey::BracketRight),
            "Backslash" => Some(HotkeyKey::Backslash),
            "Semicolon" => Some(HotkeyKey::Semicolon),
            "Quote" => Some(HotkeyKey::Quote),
            "Comma" => Some(HotkeyKey::Comma),
            "Period" => Some(HotkeyKey::Period),
            "Slash" => Some(HotkeyKey::Slash),
            _ => None,
        }
    }

    /// 展示用键名（与前端 hotkeyDisplayKey 对齐）。
    pub fn display(&self) -> &'static str {
        match self {
            HotkeyKey::KeyA => "A",
            HotkeyKey::KeyB => "B",
            HotkeyKey::KeyC => "C",
            HotkeyKey::KeyD => "D",
            HotkeyKey::KeyE => "E",
            HotkeyKey::KeyF => "F",
            HotkeyKey::KeyG => "G",
            HotkeyKey::KeyH => "H",
            HotkeyKey::KeyI => "I",
            HotkeyKey::KeyJ => "J",
            HotkeyKey::KeyK => "K",
            HotkeyKey::KeyL => "L",
            HotkeyKey::KeyM => "M",
            HotkeyKey::KeyN => "N",
            HotkeyKey::KeyO => "O",
            HotkeyKey::KeyP => "P",
            HotkeyKey::KeyQ => "Q",
            HotkeyKey::KeyR => "R",
            HotkeyKey::KeyS => "S",
            HotkeyKey::KeyT => "T",
            HotkeyKey::KeyU => "U",
            HotkeyKey::KeyV => "V",
            HotkeyKey::KeyW => "W",
            HotkeyKey::KeyX => "X",
            HotkeyKey::KeyY => "Y",
            HotkeyKey::KeyZ => "Z",
            HotkeyKey::Digit0 => "0",
            HotkeyKey::Digit1 => "1",
            HotkeyKey::Digit2 => "2",
            HotkeyKey::Digit3 => "3",
            HotkeyKey::Digit4 => "4",
            HotkeyKey::Digit5 => "5",
            HotkeyKey::Digit6 => "6",
            HotkeyKey::Digit7 => "7",
            HotkeyKey::Digit8 => "8",
            HotkeyKey::Digit9 => "9",
            HotkeyKey::F1 => "F1",
            HotkeyKey::F2 => "F2",
            HotkeyKey::F3 => "F3",
            HotkeyKey::F4 => "F4",
            HotkeyKey::F5 => "F5",
            HotkeyKey::F6 => "F6",
            HotkeyKey::F7 => "F7",
            HotkeyKey::F8 => "F8",
            HotkeyKey::F9 => "F9",
            HotkeyKey::F10 => "F10",
            HotkeyKey::F11 => "F11",
            HotkeyKey::F12 => "F12",
            HotkeyKey::Backquote => "`",
            HotkeyKey::Minus => "-",
            HotkeyKey::Equal => "=",
            HotkeyKey::BracketLeft => "[",
            HotkeyKey::BracketRight => "]",
            HotkeyKey::Backslash => "\\",
            HotkeyKey::Semicolon => ";",
            HotkeyKey::Quote => "'",
            HotkeyKey::Comma => ",",
            HotkeyKey::Period => ".",
            HotkeyKey::Slash => "/",
        }
    }
}

impl HotkeyBinding {
    /// 标准展示文本，如 "Ctrl + K"。
    pub fn display_label(&self) -> String {
        format!("Ctrl + {}", self.key.display())
    }

    pub fn is_high_conflict(&self) -> bool {
        HIGH_CONFLICT_KEYS.contains(&self.key)
    }
}

/// 预览结果：合法（可能带高冲突 warning）或非法。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyPreview {
    Valid {
        binding: HotkeyBinding,
        warning: Option<HotkeyConflictWarning>,
    },
    Invalid {
        reason: HotkeyInvalidReason,
    },
}

impl HotkeyPreview {
    pub fn is_valid(&self) -> bool {
        matches!(self, HotkeyPreview::Valid { .. })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyInvalidReason {
    /// modifier 不是 Control，或带了额外修饰键
    InvalidModifiers,
    /// 按键不在支持范围
    UnsupportedKey,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HotkeyConflictWarning {
    pub code: &'static str,
    pub message: &'static str,
}

/// 权威合法性规则（唯一来源）。
pub struct HotkeyPolicy;

impl HotkeyPolicy {
    /// 输入为"用户实际按下的组合"描述：
    /// - modifier: "Ctrl" / "Alt" / "Shift" / "Meta" / 组合（如 "Ctrl+Alt"）
    /// - key_code: KeyboardEvent.code
    pub fn preview(modifier: &str, key_code: &str) -> HotkeyPreview {
        // 只有恰好 Ctrl + 一个键合法
        let parts: Vec<&str> = modifier.split('+').filter(|s| !s.is_empty()).collect();
        if parts.len() != 1 || parts[0] != "Ctrl" {
            return HotkeyPreview::Invalid {
                reason: HotkeyInvalidReason::InvalidModifiers,
            };
        }
        let Some(key) = HotkeyKey::from_key_code(key_code) else {
            return HotkeyPreview::Invalid {
                reason: HotkeyInvalidReason::UnsupportedKey,
            };
        };
        let binding = HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key,
        };
        let warning = binding.is_high_conflict().then_some(HotkeyConflictWarning {
            code: "HIGH_CONFLICT",
            message: match key {
                HotkeyKey::KeyA => "这个组合通常用于全选",
                HotkeyKey::KeyC => "这个组合通常用于复制",
                HotkeyKey::KeyF => "这个组合通常用于查找",
                HotkeyKey::KeyN => "这个组合通常用于新建",
                HotkeyKey::KeyO => "这个组合通常用于打开",
                HotkeyKey::KeyP => "这个组合通常用于打印",
                HotkeyKey::KeyR => "这个组合通常用于刷新",
                HotkeyKey::KeyS => "这个组合通常用于保存",
                HotkeyKey::KeyT => "这个组合通常用于新建标签页",
                HotkeyKey::KeyV => "这个组合通常用于粘贴",
                HotkeyKey::KeyW => "这个组合通常用于关闭标签页",
                HotkeyKey::KeyX => "这个组合通常用于剪切",
                HotkeyKey::KeyZ => "这个组合通常用于撤销",
                _ => "这个组合可能被其他软件占用",
            },
        });
        HotkeyPreview::Valid { binding, warning }
    }

    /// 校验一个已解析的 binding 是否合法（启动注册时使用）。
    pub fn validate(binding: &HotkeyBinding) -> bool {
        matches!(binding.modifier, HotkeyModifier::Control)
            && ALL_HOTKEY_KEYS.contains(&binding.key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid(modifier: &str, key: &str) -> HotkeyPreview {
        HotkeyPolicy::preview(modifier, key)
    }

    #[test]
    fn ctrl_k_valid() {
        assert!(
            matches!(valid("Ctrl", "KeyK"), HotkeyPreview::Valid { binding, warning: None } if binding.key == HotkeyKey::KeyK)
        );
    }

    #[test]
    fn ctrl_f12_valid() {
        assert!(
            matches!(valid("Ctrl", "F12"), HotkeyPreview::Valid { binding, warning: None } if binding.key == HotkeyKey::F12)
        );
    }

    #[test]
    fn ctrl_digit1_valid() {
        assert!(
            matches!(valid("Ctrl", "Digit1"), HotkeyPreview::Valid { binding, warning: None } if binding.key == HotkeyKey::Digit1)
        );
    }

    #[test]
    fn ctrl_period_valid() {
        assert!(
            matches!(valid("Ctrl", "Period"), HotkeyPreview::Valid { binding, warning: None } if binding.key == HotkeyKey::Period)
        );
    }

    #[test]
    fn only_key_invalid() {
        assert!(matches!(
            valid("", "KeyK"),
            HotkeyPreview::Invalid {
                reason: HotkeyInvalidReason::InvalidModifiers
            }
        ));
    }

    #[test]
    fn only_ctrl_invalid() {
        assert!(matches!(
            valid("Ctrl", ""),
            HotkeyPreview::Invalid {
                reason: HotkeyInvalidReason::UnsupportedKey
            }
        ));
    }

    #[test]
    fn ctrl_shift_k_invalid() {
        assert!(matches!(
            valid("Ctrl+Shift", "KeyK"),
            HotkeyPreview::Invalid {
                reason: HotkeyInvalidReason::InvalidModifiers
            }
        ));
    }

    #[test]
    fn ctrl_alt_k_invalid() {
        assert!(matches!(
            valid("Ctrl+Alt", "KeyK"),
            HotkeyPreview::Invalid {
                reason: HotkeyInvalidReason::InvalidModifiers
            }
        ));
    }

    #[test]
    fn unsupported_key_invalid() {
        assert!(matches!(
            valid("Ctrl", "Escape"),
            HotkeyPreview::Invalid {
                reason: HotkeyInvalidReason::UnsupportedKey
            }
        ));
        assert!(matches!(
            valid("Ctrl", "Tab"),
            HotkeyPreview::Invalid {
                reason: HotkeyInvalidReason::UnsupportedKey
            }
        ));
    }

    #[test]
    fn ctrl_c_valid_with_high_conflict() {
        match valid("Ctrl", "KeyC") {
            HotkeyPreview::Valid {
                binding,
                warning: Some(w),
            } => {
                assert_eq!(binding.key, HotkeyKey::KeyC);
                assert_eq!(w.code, "HIGH_CONFLICT");
                assert!(binding.is_high_conflict());
            }
            other => panic!("expected valid+warning, got {:?}", other),
        }
    }

    #[test]
    fn display_labels() {
        let k = HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key: HotkeyKey::KeyK,
        };
        assert_eq!(k.display_label(), "Ctrl + K");
        let f12 = HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key: HotkeyKey::F12,
        };
        assert_eq!(f12.display_label(), "Ctrl + F12");
        let dot = HotkeyBinding {
            modifier: HotkeyModifier::Control,
            key: HotkeyKey::Period,
        };
        assert_eq!(dot.display_label(), "Ctrl + .");
    }
}
