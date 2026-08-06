import { useMemo } from "react";
import type { DesktopApi } from "@/desktop-api/contract";
import { MockDesktopApi, getWindowContext } from "@/desktop-api";
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
  const context = useMemo(() => getWindowContext(), []);
  const api = useMemo<DesktopApi>(
    () => new MockDesktopApi({ withSeed: !context.emptyData }),
    [context.emptyData],
  );
  const navigateTo = (windowKind: string, extra?: Record<string, string>) => {
    const url = new URL(window.location.href);
    url.searchParams.set("window", windowKind);
    for (const [key, value] of Object.entries(extra ?? {})) {
      url.searchParams.set(key, value);
    }
    window.location.assign(url.toString());
  };

  switch (context.kind) {
    case "quick-note":
      return <QuickNoteWindow api={api} onClose={() => window.close()} />;
    case "reminder":
      return (
        <ReminderWindow
          api={api}
          demo={context.reminderDemo}
          onOpenMain={(agentId) => {
            navigateTo("main", { agentId });
          }}
        />
      );
    case "settings":
      return <HotkeySettingsWindow api={api} />;
    case "main":
    default:
      return (
        <NoteLibraryWindow
          api={api}
          initialAgentId={context.initialAgentId}
          onNewTip={() => navigateTo("quick-note")}
          onOpenSettings={() => navigateTo("settings")}
        />
      );
  }
}
