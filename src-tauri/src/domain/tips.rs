use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::color::NoteColorKey;
use crate::error::{AppError, AppResult};

pub const MAX_TAGS: usize = 8;
pub const MAX_TAG_LENGTH: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TipStatus {
    Draft,
    #[default]
    Active,
    Archived,
}

impl TipStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TipStatus::Draft => "draft",
            TipStatus::Active => "active",
            TipStatus::Archived => "archived",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "draft" => Ok(TipStatus::Draft),
            "active" => Ok(TipStatus::Active),
            "archived" => Ok(TipStatus::Archived),
            other => Err(AppError::Validation(format!("未知便签状态: {other}"))),
        }
    }
}

/// Tip-Agent 绑定（输入：由后端按数组顺序分配 sort_order）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBindingInput {
    pub agent_id: Uuid,
    pub auto_attach: bool,
}

/// 绑定领域值对象（含稳定排序）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipBinding {
    pub agent_id: Uuid,
    pub auto_attach: bool,
    pub sort_order: i64,
}

/// Tip 领域模型。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tip {
    pub id: Uuid,
    pub title: Option<String>,
    pub content: String,
    pub tags: Vec<String>,
    pub status: TipStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub color_key: NoteColorKey,
    pub used_at: Option<DateTime<Utc>>,
    pub bindings: Vec<TipBinding>,
}

/// 创建输入（来自 command DTO 转换）。
#[derive(Debug, Clone)]
pub struct CreateTipCommand {
    pub title: Option<String>,
    pub content: String,
    pub tags: Vec<String>,
    pub status: TipStatus,
    pub color_key: Option<NoteColorKey>,
    pub bindings: Vec<CreateBindingInput>,
}

/// 修改输入（title 为 Option<Option<String>>：None=不修改，Some(None)=清空）。
#[derive(Debug, Clone)]
pub struct UpdateTipCommand {
    pub id: Uuid,
    pub title: Option<Option<String>>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<TipStatus>,
    pub bindings: Option<Vec<CreateBindingInput>>,
}

/// Text-only 更新：只允许修改 title/content/updated_at，
/// 禁止修改 bindings / color_key / used_at / status。
#[derive(Debug, Clone)]
pub struct UpdateTipTextCommand {
    pub id: Uuid,
    pub title: String,
    pub content: String,
}

/// 查询输入。
#[derive(Debug, Clone, Default)]
pub struct TipQuery {
    pub search: Option<String>,
    pub agent_id: Option<Uuid>,
    /// None = 仅未使用（首页默认）；Some(true) = 仅已使用；Some(false) = 未使用。
    pub used: Option<bool>,
}

impl CreateTipCommand {
    /// 领域校验：content 去首尾空白后非空；重复 Agent 绑定拒绝。
    pub fn validate(&self) -> AppResult<()> {
        if self.content.trim().is_empty() {
            return Err(AppError::Validation("正文不能为空".into()));
        }
        normalize_tags(&self.tags)?;
        ensure_unique_bindings(&self.bindings)?;
        Ok(())
    }
}

impl UpdateTipCommand {
    /// 修改时的领域校验。
    pub fn validate(&self) -> AppResult<()> {
        if let Some(content) = &self.content {
            if content.trim().is_empty() {
                return Err(AppError::Validation("正文不能为空".into()));
            }
        }
        if let Some(tags) = &self.tags {
            normalize_tags(tags)?;
        }
        if let Some(bindings) = &self.bindings {
            ensure_unique_bindings(bindings)?;
        }
        Ok(())
    }
}

impl UpdateTipTextCommand {
    pub fn validate(&self) -> AppResult<()> {
        if self.content.trim().is_empty() {
            return Err(AppError::Validation("正文不能为空".into()));
        }
        Ok(())
    }
}

fn ensure_unique_bindings(bindings: &[CreateBindingInput]) -> AppResult<()> {
    let mut seen = HashSet::new();
    for binding in bindings {
        if !seen.insert(binding.agent_id) {
            return Err(AppError::Validation(format!(
                "Agent {} 重复绑定",
                binding.agent_id
            )));
        }
    }
    Ok(())
}

pub fn normalized_title(title: Option<&str>) -> Option<String> {
    title
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
}

pub fn normalized_tag_key(tag: &str) -> String {
    tag.to_lowercase()
}

/// 用户标签是自由文本：去除外围空白和前导 #，压缩内部空白，按大小写不敏感去重。
/// 历史标签建议只改善输入效率；领域层仍是标签边界的权威校验者。
pub fn normalize_tags(tags: &[String]) -> AppResult<Vec<String>> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();

    for raw in tags {
        let without_hash = raw.trim().trim_start_matches('#').trim();
        let name = without_hash
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if name.is_empty() {
            continue;
        }
        if name.chars().count() > MAX_TAG_LENGTH {
            return Err(AppError::Validation(format!(
                "标签“{name}”不能超过 {MAX_TAG_LENGTH} 个字符"
            )));
        }
        let key = normalized_tag_key(&name);
        if seen.insert(key) {
            normalized.push(name);
        }
    }

    if normalized.len() > MAX_TAGS {
        return Err(AppError::Validation(format!(
            "每条便签最多添加 {MAX_TAGS} 个标签"
        )));
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn agent_id(id: &str) -> Uuid {
        Uuid::from_str(id).unwrap()
    }

    #[test]
    fn empty_content_rejected() {
        let input = CreateTipCommand {
            title: None,
            content: "   \n  ".into(),
            tags: vec![],
            status: TipStatus::Active,
            color_key: None,
            bindings: vec![],
        };
        assert!(matches!(input.validate(), Err(AppError::Validation(_))));
    }

    #[test]
    fn title_may_be_empty() {
        let input = CreateTipCommand {
            title: None,
            content: "  hello  ".into(),
            tags: vec![],
            status: TipStatus::Active,
            color_key: None,
            bindings: vec![],
        };
        assert!(input.validate().is_ok());
    }

    #[test]
    fn duplicate_agent_binding_rejected() {
        let input = CreateTipCommand {
            title: None,
            content: "content".into(),
            tags: vec![],
            status: TipStatus::Active,
            color_key: None,
            bindings: vec![
                CreateBindingInput {
                    agent_id: agent_id("10000000-0000-0000-0000-000000000002"),
                    auto_attach: true,
                },
                CreateBindingInput {
                    agent_id: agent_id("10000000-0000-0000-0000-000000000002"),
                    auto_attach: false,
                },
            ],
        };
        assert!(matches!(input.validate(), Err(AppError::Validation(_))));
    }

    #[test]
    fn multi_agent_binding_valid_with_independent_auto_attach() {
        let input = CreateTipCommand {
            title: None,
            content: "content".into(),
            tags: vec![],
            status: TipStatus::Active,
            color_key: None,
            bindings: vec![
                CreateBindingInput {
                    agent_id: agent_id("10000000-0000-0000-0000-000000000002"),
                    auto_attach: true,
                },
                CreateBindingInput {
                    agent_id: agent_id("10000000-0000-0000-0000-000000000004"),
                    auto_attach: false,
                },
            ],
        };
        assert!(input.validate().is_ok());
        assert_ne!(input.bindings[0].auto_attach, input.bindings[1].auto_attach);
    }

    #[test]
    fn update_rejects_empty_content_and_duplicates() {
        let empty = UpdateTipCommand {
            id: agent_id("00000000-0000-0000-0000-000000000001"),
            title: None,
            content: Some("  ".into()),
            tags: None,
            status: None,
            bindings: None,
        };
        assert!(matches!(empty.validate(), Err(AppError::Validation(_))));

        let dup = UpdateTipCommand {
            id: agent_id("00000000-0000-0000-0000-000000000001"),
            title: None,
            content: None,
            tags: None,
            status: None,
            bindings: Some(vec![
                CreateBindingInput {
                    agent_id: agent_id("10000000-0000-0000-0000-000000000002"),
                    auto_attach: true,
                },
                CreateBindingInput {
                    agent_id: agent_id("10000000-0000-0000-0000-000000000002"),
                    auto_attach: false,
                },
            ]),
        };
        assert!(matches!(dup.validate(), Err(AppError::Validation(_))));
    }

    #[test]
    fn missing_title_stays_empty() {
        assert_eq!(normalized_title(None), None);
        assert_eq!(normalized_title(Some("   ")), None);
        assert_eq!(normalized_title(Some(" 标题 ")), Some("标题".into()));
    }

    #[test]
    fn tags_are_trimmed_deduplicated_and_bounded() {
        let tags = normalize_tags(&[
            " #Rust ".into(),
            "rust".into(),
            "代码   审查".into(),
            "#".into(),
        ])
        .unwrap();
        assert_eq!(tags, vec!["Rust", "代码 审查"]);

        let too_many = (0..=MAX_TAGS)
            .map(|index| format!("tag-{index}"))
            .collect::<Vec<_>>();
        assert!(matches!(
            normalize_tags(&too_many),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            normalize_tags(&["x".repeat(MAX_TAG_LENGTH + 1)]),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn text_update_rejects_empty_content() {
        let empty = UpdateTipTextCommand {
            id: agent_id("00000000-0000-0000-0000-000000000001"),
            title: "标题".into(),
            content: "  ".into(),
        };
        assert!(matches!(empty.validate(), Err(AppError::Validation(_))));
    }

    #[test]
    fn color_key_parse_round_trip() {
        for key in super::super::color::ALL_NOTE_COLORS {
            assert_eq!(NoteColorKey::parse(key.as_str()).unwrap(), key);
        }
        assert!(NoteColorKey::parse("purple").is_err());
        assert!(NoteColorKey::parse("white").is_err());
    }
}
