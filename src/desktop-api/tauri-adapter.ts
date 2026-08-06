// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import {
  ERROR_CODES,
  type Agent,
  type AppSettings,
  type CreateTipInput,
  type DesktopApi,
  type DesktopError,
  type HotkeyCandidate,
  type HotkeyPreviewResult,
  type MockFailureKind,
  type ReminderPreview,
  type TipDetail,
  type TipQuery,
  type TipSummary,
  type UpdateTipInput,
} from "./contract";

const FALLBACK_SETTINGS: AppSettings = {
  theme: "system",
  globalPause: false,
  hotkey: {
    modifier: "Ctrl",
    keyCode: "F12",
    displayLabel: "Ctrl + F12",
    highConflict: false,
  },
};

function notImplemented(feature: string): never {
  const error: DesktopError = {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: `${feature} 尚未实现（后续阶段接入）`,
  };
  throw error;
}

/**
 * 把 Tauri invoke 的 rejection 转换为统一 DesktopError。
 * Rust 侧返回 AppErrorDto { code, message, retryable }；防御性兼容任意结构。
 */
function toDesktopError(error: unknown): DesktopError {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : "未知错误";
    const code = typeof record.code === "string" ? record.code : ERROR_CODES.INTERNAL_ERROR;
    const details: Record<string, unknown> = {};
    if (typeof record.retryable === "boolean") {
      details.retryable = record.retryable;
    }
    if (typeof record.field === "string") {
      return {
        code,
        message,
        field: record.field,
        details: Object.keys(details).length ? details : undefined,
      };
    }
    return { code, message, details: Object.keys(details).length ? details : undefined };
  }
  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Tauri 生产适配器。只允许本文件与 desktop-api 适配层调用 invoke。
 * 本阶段实现 Tip/Agent 真实链路；previewHotkey、getReminderPreview 明确未实现。
 */
export class TauriDesktopApi implements DesktopApi {
  async listTips(query?: TipQuery): Promise<TipSummary[]> {
    try {
      return await invoke<TipSummary[]>("tip_list", { query: query ?? {} });
    } catch (error) {
      throw toDesktopError(error);
    }
  }

  async getTip(id: string): Promise<TipDetail | null> {
    try {
      return await invoke<TipDetail | null>("tip_get", { id });
    } catch (error) {
      throw toDesktopError(error);
    }
  }

  async createTip(input: CreateTipInput): Promise<TipDetail> {
    try {
      return await invoke<TipDetail>("tip_create", { input });
    } catch (error) {
      throw toDesktopError(error);
    }
  }

  async updateTip(id: string, input: UpdateTipInput): Promise<TipDetail> {
    try {
      return await invoke<TipDetail>("tip_update", {
        input: { id, ...input },
      });
    } catch (error) {
      throw toDesktopError(error);
    }
  }

  async deleteTip(id: string): Promise<void> {
    try {
      await invoke<void>("tip_delete", { id });
    } catch (error) {
      throw toDesktopError(error);
    }
  }

  async listAgents(): Promise<Agent[]> {
    try {
      return await invoke<Agent[]>("agent_list");
    } catch (error) {
      throw toDesktopError(error);
    }
  }

  async getSettings(): Promise<AppSettings> {
    // 快捷键设置持久化属 Phase 3；本阶段返回默认值供页面渲染。
    return { ...FALLBACK_SETTINGS, hotkey: { ...FALLBACK_SETTINGS.hotkey } };
  }

  async previewHotkey(_input: HotkeyCandidate): Promise<HotkeyPreviewResult> {
    return notImplemented("快捷键录制校验");
  }

  async getReminderPreview(): Promise<ReminderPreview> {
    return notImplemented("自动提醒");
  }

  setMockFailure(_kind: MockFailureKind, _enabled: boolean): void {
    // Mock 专用；Tauri 生产路径无意义。
  }

  reset(): void {
    // Mock 专用；Tauri 生产路径无意义。
  }
}
