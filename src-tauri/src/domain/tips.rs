use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

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

/// Tip 领域模型（docs/03-domain-data-model.md）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tip {
    pub id: Uuid,
    pub title: Option<String>,
    pub content: String,
    pub status: TipStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub bindings: Vec<TipBinding>,
}

/// 创建输入（来自 command DTO 转换）。
#[derive(Debug, Clone)]
pub struct CreateTipCommand {
    pub title: Option<String>,
    pub content: String,
    pub status: TipStatus,
    pub bindings: Vec<CreateBindingInput>,
}

/// 修改输入（title 为 Option<Option<String>>：None=不修改，Some(None)=清空）。
#[derive(Debug, Clone)]
pub struct UpdateTipCommand {
    pub id: Uuid,
    pub title: Option<Option<String>>,
    pub content: Option<String>,
    pub status: Option<TipStatus>,
    pub bindings: Option<Vec<CreateBindingInput>>,
}

/// 查询输入。
#[derive(Debug, Clone, Default)]
pub struct TipQuery {
    pub search: Option<String>,
    pub agent_id: Option<Uuid>,
}

impl CreateTipCommand {
    /// 领域校验：content 去首尾空白后非空；重复 Agent 绑定拒绝。
    pub fn validate(&self) -> AppResult<()> {
        if self.content.trim().is_empty() {
            return Err(AppError::Validation("正文不能为空".into()));
        }
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
        if let Some(bindings) = &self.bindings {
            ensure_unique_bindings(bindings)?;
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

pub fn normalized_title(title: Option<&str>, content: &str) -> Option<String> {
    if let Some(title) = title {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    content
        .lines()
        .next()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(str::to_string)
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
            status: TipStatus::Active,
            bindings: vec![],
        };
        assert!(matches!(input.validate(), Err(AppError::Validation(_))));
    }

    #[test]
    fn title_may_be_empty() {
        let input = CreateTipCommand {
            title: None,
            content: "  hello  ".into(),
            status: TipStatus::Active,
            bindings: vec![],
        };
        assert!(input.validate().is_ok());
    }

    #[test]
    fn duplicate_agent_binding_rejected() {
        let input = CreateTipCommand {
            title: None,
            content: "content".into(),
            status: TipStatus::Active,
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
            status: TipStatus::Active,
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
            status: None,
            bindings: None,
        };
        assert!(matches!(empty.validate(), Err(AppError::Validation(_))));

        let dup = UpdateTipCommand {
            id: agent_id("00000000-0000-0000-0000-000000000001"),
            title: None,
            content: None,
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
    fn normalized_title_falls_back_to_first_line() {
        assert_eq!(
            normalized_title(None, "第一行\n第二行"),
            Some("第一行".into())
        );
        assert_eq!(normalized_title(Some("   "), "abc"), Some("abc".into()));
        assert_eq!(normalized_title(Some(" 标题 "), "abc"), Some("标题".into()));
    }
}
