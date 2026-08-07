use tauri::State;
use uuid::Uuid;

use crate::domain::color::NoteColorKey;
use crate::dto::{
    CreateTipInputDto, TipDto, TipQueryDto, TipSummaryDto, UpdateTipInputDto, UpdateTipTextInputDto,
};
use crate::error::{AppError, AppErrorDto};
use crate::AppState;

#[tauri::command]
pub fn tip_create(
    state: State<'_, AppState>,
    input: CreateTipInputDto,
) -> Result<TipDto, AppErrorDto> {
    let tip = state
        .tips
        .create(input.into_domain())
        .map_err(AppErrorDto::from)?;
    Ok(TipDto::from(&tip))
}

#[tauri::command]
pub fn tip_get(state: State<'_, AppState>, id: String) -> Result<Option<TipDto>, AppErrorDto> {
    let id = parse_id(&id)?;
    let tip = state.tips.get(id).map_err(AppErrorDto::from)?;
    Ok(tip.as_ref().map(TipDto::from))
}

#[tauri::command]
pub fn tip_list(
    state: State<'_, AppState>,
    query: TipQueryDto,
) -> Result<Vec<TipSummaryDto>, AppErrorDto> {
    let tips = state
        .tips
        .list(crate::domain::tips::TipQuery {
            search: query.search,
            agent_id: query.agent_id,
            used: query.used,
        })
        .map_err(AppErrorDto::from)?;
    Ok(tips.iter().map(TipSummaryDto::from).collect())
}

#[tauri::command]
pub fn tip_update(
    state: State<'_, AppState>,
    input: UpdateTipInputDto,
) -> Result<TipDto, AppErrorDto> {
    let tip = state
        .tips
        .update(input.into_domain())
        .map_err(AppErrorDto::from)?;
    Ok(TipDto::from(&tip))
}

#[tauri::command]
pub fn tip_delete(state: State<'_, AppState>, id: String) -> Result<(), AppErrorDto> {
    let id = parse_id(&id)?;
    state.tips.delete(id).map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn note_color_suggest(state: State<'_, AppState>) -> Result<NoteColorKey, AppErrorDto> {
    state.tips.suggest_color().map_err(AppErrorDto::from)
}

#[tauri::command]
pub fn tip_update_text(
    state: State<'_, AppState>,
    input: UpdateTipTextInputDto,
) -> Result<TipDto, AppErrorDto> {
    let tip = state
        .tips
        .update_text(input.into_domain())
        .map_err(AppErrorDto::from)?;
    Ok(TipDto::from(&tip))
}

#[tauri::command]
pub fn tip_mark_used(state: State<'_, AppState>, id: String) -> Result<TipDto, AppErrorDto> {
    let id = parse_id(&id)?;
    let tip = state.tips.mark_used(id).map_err(AppErrorDto::from)?;
    Ok(TipDto::from(&tip))
}

#[tauri::command]
pub fn tip_restore_used(state: State<'_, AppState>, id: String) -> Result<TipDto, AppErrorDto> {
    let id = parse_id(&id)?;
    let tip = state.tips.restore_used(id).map_err(AppErrorDto::from)?;
    Ok(TipDto::from(&tip))
}

#[tauri::command]
pub fn tip_update_color(
    state: State<'_, AppState>,
    id: String,
    color_key: NoteColorKey,
) -> Result<TipDto, AppErrorDto> {
    let id = parse_id(&id)?;
    let tip = state
        .tips
        .update_color(id, color_key)
        .map_err(AppErrorDto::from)?;
    Ok(TipDto::from(&tip))
}

fn parse_id(raw: &str) -> Result<Uuid, AppErrorDto> {
    Uuid::parse_str(raw)
        .map_err(|_| AppErrorDto::from(AppError::Validation(format!("无效 ID: {raw}"))))
}
