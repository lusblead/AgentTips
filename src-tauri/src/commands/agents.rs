use tauri::State;

use crate::dto::AgentDto;
use crate::error::AppErrorDto;
use crate::AppState;

#[tauri::command]
pub fn agent_list(state: State<'_, AppState>) -> Result<Vec<AgentDto>, AppErrorDto> {
    let agents = state.agents.list().map_err(AppErrorDto::from)?;
    Ok(agents.iter().map(AgentDto::from).collect())
}
