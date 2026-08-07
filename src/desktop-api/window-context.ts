import type { WindowKind } from "./contract";

/**
 * 窗口上下文 Provider 抽象：
 * - 生产 Tauri：WindowKind 来自当前 WebviewWindow label（window-context 属于 desktop-api 适配层，允许读取）
 * - 浏览器测试：WindowKind 来自 URL ?window=...
 * feature 组件只消费 getWindowContext() 返回的 WindowContext，不直接读 URL / label / Tauri API。
 */

export type { WindowKind };
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

/** Browser Provider：URL 参数决定窗口。 */
export function getBrowserWindowContext(): WindowContext {
  const params = new URLSearchParams(window.location.search);
  const kind = kindFromLabel(params.get("window"));
  const demo = params.get("demo");
  const reminderDemo = demo === "collapsed" || demo === "empty" ? demo : undefined;
  const initialAgentId = params.get("agentId") ?? undefined;
  const emptyData = params.get("empty") === "1";
  return { kind, reminderDemo, initialAgentId, emptyData };
}

/** Tauri Provider：WebviewWindow label 决定窗口。 */
export async function getTauriWindowContext(): Promise<WindowContext> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const kind = kindFromLabel(getCurrentWindow().label);
  return { kind };
}

/**
 * 统一入口（composition root 使用）：根据环境自动选择 Provider。
 * 返回值在 Tauri 下为 Promise，浏览器下为同步对象；
 * App.tsx 按环境 await 后 setState。
 */
export function getWindowContext(): WindowContext | Promise<WindowContext> {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    return getTauriWindowContext();
  }
  return getBrowserWindowContext();
}
