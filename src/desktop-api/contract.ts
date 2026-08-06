/**
 * DesktopApi 契约
 *
 * 前端唯一的桌面能力接口。feature 组件只能通过本契约调用能力，
 * 不得直接使用 @tauri-apps/api 的 invoke/listen 或读取平台细节。
 * 类型集中管理，避免每个页面复制一套 DTO。
 */

export type AgentKind = "desktop" | "terminal";
export type TipStatus = "active" | "archived";

/** 便签与 Agent 的绑定关系；默认携带属于该关系，不属于便签全局属性。 */
export interface AgentBinding {
  agentId: string;
  autoAttach: boolean;
}

export interface TipSummary {
  id: string;
  title: string;
  content: string;
  status: TipStatus;
  updatedAt: string;
  agentIds: string[];
}

export interface TipDetail {
  id: string;
  title: string;
  content: string;
  status: TipStatus;
  updatedAt: string;
  bindings: AgentBinding[];
}

export interface CreateTipInput {
  title?: string;
  content: string;
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
  | { ok: true; binding: HotkeyBinding }
  | { ok: false; reason: "invalid" | "unsupported" | "highConflict"; message: string };

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

/** 测试/调试辅助：让 Mock 在指定操作上失败，用于验证错误状态。 */
export type MockFailureKind = "save" | "delete";

export interface DesktopApi {
  listTips(query?: TipQuery): Promise<TipSummary[]>;
  getTip(id: string): Promise<TipDetail | null>;
  createTip(input: CreateTipInput): Promise<TipDetail>;
  updateTip(id: string, input: UpdateTipInput): Promise<TipDetail>;
  deleteTip(id: string): Promise<void>;

  listAgents(): Promise<Agent[]>;
  getSettings(): Promise<AppSettings>;
  previewHotkey(input: HotkeyCandidate): Promise<HotkeyPreviewResult>;

  getReminderPreview(): Promise<ReminderPreview>;

  setMockFailure(kind: MockFailureKind, enabled: boolean): void;
  reset(): void;
}
