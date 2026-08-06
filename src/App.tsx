import { useEffect, useMemo, useState } from "react";
import { type DesktopApi } from "@/desktop-api/contract";
import { MockDesktopApi, getWindowContext } from "@/desktop-api";
import type { WindowContext } from "@/desktop-api";
import { TauriDesktopApi } from "@/desktop-api/tauri-adapter";
import QuickNoteWindow from "@/features/quick-note";
import NoteLibraryWindow from "@/features/note-library";
import ReminderWindow from "@/features/reminder";
import HotkeySettingsWindow from "@/features/hotkey-settings";

/**
 * 应用入口：通过统一的窗口上下文适配器决定渲染哪个窗口。
 * 浏览器调试：
 *   /?window=quick-note
 *   /?window=main&agentId=agent-cursor
 *   /?window=reminder&demo=expanded|collapsed|empty
 *   /?window=settings
 * Phase 2 起由 TauriDesktopApi 替换 MockDesktopApi。
 */
export default function App() {
  const [context, setContext] = useState<WindowContext>(() => getWindowContext());
  useEffect(() => {
    const update = () => {
      setContext(getWindowContext());
    };
    window.addEventListener("popstate", update);
    window.addEventListener("agenttips:route", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("agenttips:route", update);
    };
  }, []);
  const isTauri = "__TAURI_INTERNALS__" in window;
  const api = useMemo<DesktopApi>(
    () => (isTauri ? new TauriDesktopApi() : new MockDesktopApi({ withSeed: !context.emptyData })),
    [context.emptyData, isTauri],
  );
  const navigateTo = (windowKind: string, extra?: Record<string, string>) => {
    const url = new URL(window.location.href);
    url.searchParams.set("window", windowKind);
    for (const [key, value] of Object.entries(extra ?? {})) {
      url.searchParams.set(key, value);
    }
    // 同文档路由切换（开发调试与浏览器模式），由 popstate 驱动窗口上下文更新。
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  // 仅开发模式暴露 adapter 标识，供真实 Tauri UI 验收断言，不泄漏生产信息。
  const adapterMarker = import.meta.env.DEV ? (isTauri ? "tauri" : "mock") : undefined;

  switch (context.kind) {
    case "quick-note":
      return (
        <div data-desktop-adapter={adapterMarker}>
          <QuickNoteWindow api={api} onClose={() => window.close()} />
        </div>
      );
    case "reminder":
      return (
        <div data-desktop-adapter={adapterMarker}>
          <ReminderWindow
            api={api}
            demo={context.reminderDemo}
            onOpenMain={(agentId) => {
              navigateTo("main", { agentId });
            }}
          />
        </div>
      );
    case "settings":
      return (
        <div data-desktop-adapter={adapterMarker}>
          <HotkeySettingsWindow api={api} />
        </div>
      );
    case "main":
    default:
      return (
        <div data-desktop-adapter={adapterMarker}>
          <NoteLibraryWindow
            api={api}
            initialAgentId={context.initialAgentId}
            onNewTip={() => navigateTo("quick-note")}
            onOpenSettings={() => navigateTo("settings")}
          />
        </div>
      );
  }
}
