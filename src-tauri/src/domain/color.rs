use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// 正式 Note Palette（10 色）。颜色是 Tip 的永久属性，创建时分配，之后可修改。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteColorKey {
    Lemon,
    Apricot,
    Coral,
    Rose,
    Lavender,
    Periwinkle,
    Sky,
    Aqua,
    Mint,
    Sage,
}

pub const ALL_NOTE_COLORS: [NoteColorKey; 10] = [
    NoteColorKey::Lemon,
    NoteColorKey::Apricot,
    NoteColorKey::Coral,
    NoteColorKey::Rose,
    NoteColorKey::Lavender,
    NoteColorKey::Periwinkle,
    NoteColorKey::Sky,
    NoteColorKey::Aqua,
    NoteColorKey::Mint,
    NoteColorKey::Sage,
];

impl NoteColorKey {
    pub fn as_str(&self) -> &'static str {
        match self {
            NoteColorKey::Lemon => "lemon",
            NoteColorKey::Apricot => "apricot",
            NoteColorKey::Coral => "coral",
            NoteColorKey::Rose => "rose",
            NoteColorKey::Lavender => "lavender",
            NoteColorKey::Periwinkle => "periwinkle",
            NoteColorKey::Sky => "sky",
            NoteColorKey::Aqua => "aqua",
            NoteColorKey::Mint => "mint",
            NoteColorKey::Sage => "sage",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "lemon" => Ok(NoteColorKey::Lemon),
            "apricot" => Ok(NoteColorKey::Apricot),
            "coral" => Ok(NoteColorKey::Coral),
            "rose" => Ok(NoteColorKey::Rose),
            "lavender" => Ok(NoteColorKey::Lavender),
            "periwinkle" => Ok(NoteColorKey::Periwinkle),
            "sky" => Ok(NoteColorKey::Sky),
            "aqua" => Ok(NoteColorKey::Aqua),
            "mint" => Ok(NoteColorKey::Mint),
            "sage" => Ok(NoteColorKey::Sage),
            other => Err(AppError::Validation(format!("未知便签颜色: {other}"))),
        }
    }
}
