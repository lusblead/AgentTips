use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::agents::{Agent, AgentKind};
use crate::domain::tips::{CreateBindingInput, Tip, TipStatus};

// ---------- 输入 DTO（与 src/desktop-api/contract.ts camelCase 对应） ----------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTipInputDto {
    pub title: Option<String>,
    pub content: String,
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
    pub status: Option<TipStatus>,
    #[serde(default)]
    pub bindings: Option<Vec<TipBindingInputDto>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TipQueryDto {
    pub search: Option<String>,
    pub agent_id: Option<Uuid>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub content: String,
    pub status: TipStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub bindings: Vec<TipBindingDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TipSummaryDto {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub content: String,
    pub status: TipStatus,
    pub updated_at: DateTime<Utc>,
    pub agent_ids: Vec<Uuid>,
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
            title: tip.title.clone(),
            content: tip.content.clone(),
            status: tip.status,
            created_at: tip.created_at,
            updated_at: tip.updated_at,
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
            title: tip.title.clone(),
            content: tip.content.clone(),
            status: tip.status,
            updated_at: tip.updated_at,
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

impl UpdateTipInputDto {
    pub fn into_domain(self) -> crate::domain::tips::UpdateTipCommand {
        crate::domain::tips::UpdateTipCommand {
            id: self.id,
            title: self.title,
            content: self.content,
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
            status: TipStatus::Active,
            created_at: t,
            updated_at: t,
            deleted_at: None,
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
    fn optional_title_is_omitted_when_none() {
        let mut tip = sample_tip();
        tip.title = None;
        let json = serde_json::to_value(TipDto::from(&tip)).unwrap();
        assert!(json.get("title").is_none());
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
    }
}
