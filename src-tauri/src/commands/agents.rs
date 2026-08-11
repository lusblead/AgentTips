use tauri::State;

use crate::dto::AgentDto;
use crate::error::AppErrorDto;
use crate::AppState;
use uuid::Uuid;

#[tauri::command]
pub fn agent_list(state: State<'_, AppState>) -> Result<Vec<AgentDto>, AppErrorDto> {
    let agents = state.agents.list().map_err(AppErrorDto::from)?;
    Ok(agents.iter().map(AgentDto::from).collect())
}

#[tauri::command]
pub fn agent_update_enabled(
    state: State<'_, AppState>,
    agent_id: Uuid,
    enabled: bool,
) -> Result<AgentDto, AppErrorDto> {
    let agent = state
        .agents
        .set_enabled(agent_id, enabled)
        .map_err(AppErrorDto::from)?;
    Ok(AgentDto::from(&agent))
}
