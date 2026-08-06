/**
 * 窗口上下文适配器：统一决定当前窗口是哪一个。
 * - 浏览器调试：读取 ?window=quick-note|main|reminder|settings（含可选的 demo 参数）
 * - Tauri 运行时：读取当前 WebviewWindow 的 label
 * feature 组件不得自行读取 URL 参数或 window label。
 */

export type WindowKind = "quick-note" | "main" | "reminder" | "settings";
export type ReminderDemo = "expanded" | "collapsed" | "empty";

export interface WindowContext {
  kind: WindowKind;
  /** 提醒窗口演示态（仅浏览器调试用） */
  reminderDemo?: ReminderDemo;
  /** 主窗口初始 Agent 过滤（从提醒窗口"查看全部"进入时使用） */
  initialAgentId?: string;
  /** 调试：使用空便签数据（主窗口空态截图） */
  emptyData?: boolean;
}

const WINDOW_KINDS: readonly WindowKind[] = ["quick-note", "main", "reminder", "settings"];

function kindFromLabel(label: string | null): WindowKind {
  return WINDOW_KINDS.includes(label as WindowKind) ? (label as WindowKind) : "main";
}

export function getWindowContext(): WindowContext {
  const params = new URLSearchParams(window.location.search);
  const kind = kindFromLabel(params.get("window"));
  const demo = params.get("demo");
  const reminderDemo = demo === "collapsed" || demo === "empty" ? demo : undefined;
  const initialAgentId = params.get("agentId") ?? undefined;
  const emptyData = params.get("empty") === "1";
  // 当前为单窗口阶段（Phase 2 / 2.1）：统一由 URL 查询参数决定调试路由。
  // Phase 3 引入多窗口后，Tauri 分支改为读取 WebviewWindow label，
  // 浏览器分支继续使用 URL 参数，两者在本适配器内合并，feature 不感知。
  return { kind, reminderDemo, initialAgentId, emptyData };
}
