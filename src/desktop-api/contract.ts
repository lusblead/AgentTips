/**
 * DesktopApi 契约
 *
 * 前端唯一的桌面能力接口。feature 组件只能通过本契约调用能力，
 * 不得直接使用 @tauri-apps/api 的 invoke/listen 或读取平台细节。
 * 类型集中管理，避免每个页面复制一套 DTO。
 */

export type AgentKind = "desktop" | "terminal";
export type TipStatus = "active" | "archived";
export type WindowKind = "main" | "quick-note" | "settings" | "reminder";
export type NoteColorKey =
  | "lemon"
  | "apricot"
  | "coral"
  | "rose"
  | "lavender"
  | "periwinkle"
  | "sky"
  | "aqua"
  | "mint"
  | "sage";

/** 便签与 Agent 的绑定关系（输入用）；默认携带属于该关系，不属于便签全局属性。 */
export interface AgentBinding {
  agentId: string;
  autoAttach: boolean;
}

/** 绑定输出 DTO：包含后端分配的稳定排序。 */
export interface TipBindingDto extends AgentBinding {
  sortOrder: number;
}

export interface TipSummary {
  id: string;
  title: string;
  content: string;
  status: TipStatus;
  updatedAt: string;
  colorKey: NoteColorKey;
  usedAt: string | null;
  agentIds: string[];
}

export interface TipDetail {
  id: string;
  title: string;
  content: string;
  status: TipStatus;
  updatedAt: string;
  colorKey: NoteColorKey;
  usedAt: string | null;
  bindings: TipBindingDto[];
}

export interface CreateTipInput {
  title?: string;
  content: string;
  colorKey?: NoteColorKey;
  status?: "draft" | "active";
  bindings: AgentBinding[];
}

export interface UpdateTipInput {
  title?: string;
  content?: string;
  bindings?: AgentBinding[];
}

export interface TipQuery {
  agentId?: string;
  search?: string;
  /** true=仅已使用；false/缺省=仅未使用（首页默认）。 */
  used?: boolean;
}

export interface Agent {
  id: string;
  key: string;
  name: string;
  kind: AgentKind;
  reminderEnabled: boolean;
}

export interface HotkeyBinding {
  modifier: "Ctrl";
  keyCode: string;
  displayLabel: string;
  highConflict: boolean;
}

export interface HotkeyCandidate {
  modifier: "Ctrl";
  keyCode: string;
}

export type HotkeyPreviewResult =
  | {
      ok: true;
      binding: HotkeyBinding;
      warning?: { code: string; message: string } | null;
    }
  | { ok: false; reason: "invalid" | "unsupported" | "highConflict"; message: string };

/** Configured（数据库持久化）与 Active（真实注册）的运行时状态。 */
export interface HotkeyRuntimeState {
  configured: HotkeyBinding | null;
  active: HotkeyBinding | null;
  registrationError: string | null;
}

/** 桌面 Agent 前台检测状态（安全 DTO：不含完整 path / window title）。 */
export interface DesktopDetectionStatus {
  status: "Matched" | "NoMatch" | "SelfWindow" | "Unavailable" | "Unknown";
  agentId: string | null;
  processName: string | null;
  matchKind: string | null;
  source: string | null;
  terminalStatus: string | null;
  effectiveExternalAgent: string | null;
  observedAt: string | null;
}

export interface AppSettings {
  theme: "system" | "light" | "dark";
  globalPause: boolean;
  hotkey: HotkeyBinding;
}

export interface ReminderPreviewAgent {
  id: string;
  name: string;
}

export interface ReminderTip {
  id: string;
  title: string;
  content: string;
}

export interface ReminderPreview {
  agent: ReminderPreviewAgent;
  tips: ReminderTip[];
}

/** 快捷窗口每次显示前由后端发出的重置事件（新 Draft Session）。 */
export interface QuickNoteResetPayload {
  openedAt: string;
}

/** 统一结构化错误（与 Rust AppErrorDto 对应）。 */
export interface DesktopError {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  DATABASE_ERROR: "DATABASE_ERROR",
  MIGRATION_ERROR: "MIGRATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export function isDesktopError(value: unknown): value is DesktopError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

export function desktopErrorMessage(error: unknown): string {
  if (isDesktopError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** 测试/调试辅助：让 Mock 在指定操作上失败，用于验证错误状态。 */
export type MockFailureKind = "save" | "delete" | "hotkey";

export interface DesktopApi {
  listTips(query?: TipQuery): Promise<TipSummary[]>;
  getTip(id: string): Promise<TipDetail | null>;
  createTip(input: CreateTipInput): Promise<TipDetail>;
  updateTip(id: string, input: UpdateTipInput): Promise<TipDetail>;
  deleteTip(id: string): Promise<void>;
  /** 创建时颜色建议（排除最近 2 种颜色）。 */
  suggestNoteColor(): Promise<NoteColorKey>;
  /** Text-only 更新：只改标题/正文，不影响 bindings/color/usedAt/status。 */
  updateTipText(id: string, title: string, content: string): Promise<TipDetail>;
  markTipUsed(id: string): Promise<TipDetail>;
  restoreTipUsed(id: string): Promise<TipDetail>;
  updateTipColor(id: string, colorKey: NoteColorKey): Promise<TipDetail>;

  /** 打开主窗口（显示/聚焦）。 */
  openMainWindow(): Promise<void>;
  /** 打开快捷新建窗口（懒创建/复用；已打开时不重置 draft）。 */
  openQuickNoteWindow(): Promise<void>;
  /** 打开设置窗口（懒创建/复用）。 */
  openSettingsWindow(): Promise<void>;
  /** 隐藏当前窗口（由调用方传入当前窗口 label）。 */
  hideCurrentWindow(label: string): Promise<void>;
  /** 返回当前窗口类型（生产 = Tauri label；浏览器 = URL 参数）。 */
  getWindowKind(): Promise<WindowKind>;

  listAgents(): Promise<Agent[]>;
  getSettings(): Promise<AppSettings>;
  previewHotkey(input: HotkeyCandidate): Promise<HotkeyPreviewResult>;
  getHotkeySettings(): Promise<HotkeyRuntimeState>;
  updateHotkey(input: HotkeyCandidate): Promise<HotkeyBinding>;
  beginHotkeyRecording(): Promise<void>;
  endHotkeyRecording(): Promise<void>;
  getDesktopDetectionStatus(): Promise<DesktopDetectionStatus>;

  getReminderPreview(): Promise<ReminderPreview>;

  /** 订阅快捷窗口 reset（新 Draft Session）。Tauri 下由 Window Manager show 时触发。 */
  subscribeQuickNoteReset(handler: (payload: QuickNoteResetPayload) => void): Promise<() => void>;

  setMockFailure(kind: MockFailureKind, enabled: boolean): void;
  reset(): void;
}
