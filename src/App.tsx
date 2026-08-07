import { useEffect, useMemo, useState } from "react";
import { type DesktopApi } from "@/desktop-api/contract";
import { MockDesktopApi, getBrowserWindowContext, getTauriWindowContext } from "@/desktop-api";
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
  const isTauri = "__TAURI_INTERNALS__" in window;
  const [context, setContext] = useState<WindowContext>(() =>
    isTauri ? { kind: "main" } : getBrowserWindowContext(),
  );
  useEffect(() => {
    if (isTauri) {
      let cancelled = false;
      getTauriWindowContext().then((ctx) => {
        if (!cancelled) setContext(ctx);
      });
      return () => {
        cancelled = true;
      };
    }
    const update = () => {
      setContext(getBrowserWindowContext());
    };
    window.addEventListener("popstate", update);
    window.addEventListener("agenttips:route", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("agenttips:route", update);
    };
  }, [isTauri]);
  const api = useMemo<DesktopApi>(
    () => (isTauri ? new TauriDesktopApi() : new MockDesktopApi({ withSeed: !context.emptyData })),
    [context.emptyData, isTauri],
  );
  // 仅开发模式暴露 adapter 标识，供真实 Tauri UI 验收断言，不泄漏生产信息。
  const adapterMarker = import.meta.env.DEV ? (isTauri ? "tauri" : "mock") : undefined;

  switch (context.kind) {
    case "quick-note":
      return (
        <div data-desktop-adapter={adapterMarker}>
          <QuickNoteWindow api={api} onClose={() => void api.hideCurrentWindow("quick-note")} />
        </div>
      );
    case "reminder":
      return (
        <div data-desktop-adapter={adapterMarker}>
          <ReminderWindow
            api={api}
            demo={context.reminderDemo}
            onOpenMain={() => {
              void api.openMainWindow();
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
            onNewTip={() => void api.openQuickNoteWindow()}
            onOpenSettings={() => void api.openSettingsWindow()}
          />
        </div>
      );
  }
}
