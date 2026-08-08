use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::agents::{Agent, AgentKind};
use crate::domain::color::NoteColorKey;
use crate::domain::tips::{CreateBindingInput, Tip, TipStatus};

// ---------- 输入 DTO（与 src/desktop-api/contract.ts camelCase 对应） ----------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTipInputDto {
    pub title: Option<String>,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub color_key: Option<NoteColorKey>,
    #[serde(default)]
    pub status: Option<TipStatus>,
    #[serde(default)]
    pub bindings: Vec<TipBindingInputDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipBindingInputDto {
    pub agent_id: Uuid,
    pub auto_attach: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTipInputDto {
    pub id: Uuid,
    #[serde(default)]
    pub title: Option<Option<String>>,
    pub content: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    pub status: Option<TipStatus>,
    #[serde(default)]
    pub bindings: Option<Vec<TipBindingInputDto>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TipQueryDto {
    pub search: Option<String>,
    pub agent_id: Option<Uuid>,
    /// 首页默认只展示未使用；Used View 传入 true。
    pub used: Option<bool>,
}

// ---------- 输出 DTO ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TipBindingDto {
    pub agent_id: Uuid,
    pub auto_attach: bool,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TipDto {
    pub id: Uuid,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub status: TipStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub color_key: NoteColorKey,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_at: Option<DateTime<Utc>>,
    pub bindings: Vec<TipBindingDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TipSummaryDto {
    pub id: Uuid,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub status: TipStatus,
    pub updated_at: DateTime<Utc>,
    pub color_key: NoteColorKey,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_at: Option<DateTime<Utc>>,
    pub agent_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTipTextInputDto {
    pub id: Uuid,
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDto {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub kind: AgentKind,
    pub reminder_enabled: bool,
}

impl From<&Tip> for TipDto {
    fn from(tip: &Tip) -> Self {
        Self {
            id: tip.id,
            title: tip.title.clone().unwrap_or_default(),
            content: tip.content.clone(),
            tags: tip.tags.clone(),
            status: tip.status,
            created_at: tip.created_at,
            updated_at: tip.updated_at,
            color_key: tip.color_key,
            used_at: tip.used_at,
            bindings: tip
                .bindings
                .iter()
                .map(|b| TipBindingDto {
                    agent_id: b.agent_id,
                    auto_attach: b.auto_attach,
                    sort_order: b.sort_order,
                })
                .collect(),
        }
    }
}

impl From<&Tip> for TipSummaryDto {
    fn from(tip: &Tip) -> Self {
        Self {
            id: tip.id,
            title: tip.title.clone().unwrap_or_default(),
            content: tip.content.clone(),
            tags: tip.tags.clone(),
            status: tip.status,
            updated_at: tip.updated_at,
            color_key: tip.color_key,
            used_at: tip.used_at,
            agent_ids: tip.bindings.iter().map(|b| b.agent_id).collect(),
        }
    }
}

impl From<&Agent> for AgentDto {
    fn from(agent: &Agent) -> Self {
        Self {
            id: agent.id,
            key: agent.key.clone(),
            name: agent.name.clone(),
            kind: agent.kind,
            reminder_enabled: agent.reminder_enabled,
        }
    }
}

impl CreateTipInputDto {
    pub fn into_domain(self) -> crate::domain::tips::CreateTipCommand {
        crate::domain::tips::CreateTipCommand {
            title: self.title,
            content: self.content,
            tags: self.tags,
            color_key: self.color_key,
            status: self.status.unwrap_or(TipStatus::Active),
            bindings: self
                .bindings
                .into_iter()
                .map(|b| CreateBindingInput {
                    agent_id: b.agent_id,
                    auto_attach: b.auto_attach,
                })
                .collect(),
        }
    }
}

impl UpdateTipTextInputDto {
    pub fn into_domain(self) -> crate::domain::tips::UpdateTipTextCommand {
        crate::domain::tips::UpdateTipTextCommand {
            id: self.id,
            title: self.title,
            content: self.content,
        }
    }
}

impl UpdateTipInputDto {
    pub fn into_domain(self) -> crate::domain::tips::UpdateTipCommand {
        crate::domain::tips::UpdateTipCommand {
            id: self.id,
            title: self.title,
            content: self.content,
            tags: self.tags,
            status: self.status,
            bindings: self.bindings.map(|bindings| {
                bindings
                    .into_iter()
                    .map(|b| CreateBindingInput {
                        agent_id: b.agent_id,
                        auto_attach: b.auto_attach,
                    })
                    .collect()
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{AppError, AppErrorDto};
    use chrono::TimeZone;
    use std::str::FromStr;

    fn uuid(value: &str) -> Uuid {
        Uuid::from_str(value).unwrap()
    }

    fn sample_tip() -> Tip {
        let t = Utc.with_ymd_and_hms(2026, 8, 6, 12, 0, 0).unwrap();
        Tip {
            id: uuid("11111111-1111-1111-1111-111111111111"),
            title: Some("标题".into()),
            content: "正文".into(),
            tags: vec!["Rust".into(), "测试".into()],
            status: TipStatus::Active,
            created_at: t,
            updated_at: t,
            deleted_at: None,
            color_key: NoteColorKey::Lemon,
            used_at: None,
            bindings: vec![crate::domain::tips::TipBinding {
                agent_id: uuid("22222222-2222-2222-2222-222222222222"),
                auto_attach: true,
                sort_order: 1,
            }],
        }
    }

    #[test]
    fn tip_dto_serializes_camel_case_with_bindings() {
        let json = serde_json::to_value(TipDto::from(&sample_tip())).unwrap();
        assert_eq!(json["id"], "11111111-1111-1111-1111-111111111111");
        assert_eq!(json["status"], "active");
        assert!(json.get("createdAt").is_some());
        assert!(json.get("updatedAt").is_some());
        let binding = &json["bindings"][0];
        assert_eq!(binding["agentId"], "22222222-2222-2222-2222-222222222222");
        assert_eq!(binding["autoAttach"], true);
        assert_eq!(binding["sortOrder"], 1);
        // 禁止 snake_case 字段泄露
        assert!(json.get("agent_id").is_none());
        assert!(json.get("auto_attach").is_none());
        assert!(json.get("sort_order").is_none());
    }

    #[test]
    fn missing_title_serializes_as_empty_string() {
        let mut tip = sample_tip();
        tip.title = None;
        let json = serde_json::to_value(TipDto::from(&tip)).unwrap();
        assert_eq!(json["title"], "");
    }

    #[test]
    fn summary_dto_contains_agent_ids() {
        let json = serde_json::to_value(TipSummaryDto::from(&sample_tip())).unwrap();
        assert_eq!(json["agentIds"][0], "22222222-2222-2222-2222-222222222222");
        assert!(
            json.get("createdAt").is_none(),
            "summary must not expose createdAt"
        );
    }

    #[test]
    fn error_dto_structure_is_fixed() {
        let dto = AppErrorDto::from(AppError::Validation("正文不能为空".into()));
        let json = serde_json::to_value(dto).unwrap();
        assert_eq!(json["code"], "VALIDATION_ERROR");
        assert_eq!(json["message"], "输入无效: 正文不能为空");
        assert_eq!(json["retryable"], false);
        assert!(json.get("field").is_none());
    }

    #[test]
    fn create_input_accepts_optional_status_and_bindings() {
        let json = serde_json::json!({
            "title": "t",
            "content": "c",
            "bindings": [{"agentId": "22222222-2222-2222-2222-222222222222", "autoAttach": true}]
        });
        let input: CreateTipInputDto = serde_json::from_value(json).unwrap();
        assert_eq!(input.status, None);
        assert_eq!(input.bindings.len(), 1);
        assert_eq!(
            input.bindings[0].agent_id,
            uuid("22222222-2222-2222-2222-222222222222")
        );
        assert!(input.bindings[0].auto_attach);
        assert!(input.tags.is_empty());
    }
}
