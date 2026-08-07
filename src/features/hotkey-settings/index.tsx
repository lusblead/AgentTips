import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { desktopErrorMessage, ERROR_CODES } from "@/desktop-api/contract";
import type {
  DesktopApi,
  HotkeyBinding,
  HotkeyCandidate,
  HotkeyPreviewResult,
} from "@/desktop-api/contract";
import { hotkeyDisplayKey } from "@/desktop-api";

export interface HotkeyRecorderProps {
  api: DesktopApi;
  initial: HotkeyBinding;
}

type RecorderState = "idle" | "recording" | "success" | "error";

function reasonText(result: HotkeyPreviewResult): string {
  if (result.ok) {
    return "";
  }
  switch (result.reason) {
    case "invalid":
      return "不能包含 Alt / Shift / Meta";
    case "unsupported":
      return "该按键不在支持范围内";
    case "highConflict":
      return "该组合可能覆盖系统常用操作";
  }
}

function detectedLabelFromEvent(event: KeyboardEvent): string {
  const modifiers = [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Meta",
  ].filter(Boolean) as string[];
  return [...modifiers, hotkeyDisplayKey(event.code)].join(" + ");
}

/**
 * 快捷键录制控件：只接受 Ctrl + 单个非修饰键。
 * 录制状态与已保存状态分离展示；非法/冲突时保留原快捷键。
 * 尚未接入系统注册时，展示中性占位文案而非错误。
 */
export function HotkeyRecorder({ api, initial }: HotkeyRecorderProps) {
  const [current, setCurrent] = useState<HotkeyBinding>(initial);
  const [state, setState] = useState<RecorderState>("idle");
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const cancel = useCallback(() => {
    setState("idle");
    setDetectedLabel(null);
    setFeedback(null);
    setPending(false);
  }, []);

  const evaluate = useCallback(
    async (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
        if (
          event.key === "Control" &&
          event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          !event.metaKey
        ) {
          return;
        }
        setState("error");
        setDetectedLabel(detectedLabelFromEvent(event));
        setFeedback("不能包含 Alt / Shift / Meta");
        return;
      }

      event.preventDefault();
      const label = detectedLabelFromEvent(event);
      setDetectedLabel(label);

      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
        setState("error");
        setFeedback(event.ctrlKey ? "不能包含 Alt / Shift / Meta" : "必须按住 Ctrl");
        return;
      }

      const candidate: HotkeyCandidate = { modifier: "Ctrl", keyCode: event.code };
      setPending(true);
      try {
        const result = await api.previewHotkey(candidate);
        if (result.ok) {
          setCurrent(result.binding);
          setState("success");
          setFeedback(`已保存 ${result.binding.displayLabel}`);
        } else {
          setState("error");
          setFeedback(reasonText(result));
        }
      } catch (err) {
        const message = desktopErrorMessage(err);
        const isUnavailable =
          typeof err === "object" &&
          err !== null &&
          (err as { code?: string }).code === ERROR_CODES.INTERNAL_ERROR &&
          message.includes("尚未实现");
        if (isUnavailable) {
          // 中性占位：能力将在系统功能启用后生效，不属于错误
          setState("idle");
          setFeedback("该能力将在系统功能启用后生效");
        } else {
          setState("error");
          setFeedback(message);
        }
      } finally {
        setPending(false);
      }
    },
    [api, cancel],
  );

  useEffect(() => {
    if (state === "idle") {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      void evaluate(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [evaluate, state]);

  useEffect(() => {
    if (state === "idle") {
      return;
    }
    function onMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        cancel();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [cancel, state]);

  const recording = state === "recording";

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-secondary-size text-text-muted">当前快捷键</span>
        <span
          className="flex-1 rounded-md border border-border-default bg-surface-primary px-3 py-2 font-medium"
          data-testid="hotkey-display"
        >
          {current.displayLabel}
        </span>
      </div>

      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-[var(--duration-fast)]",
          recording && "border-accent-ring bg-accent-subtle",
          state === "error" && "border-danger/60 bg-danger-subtle",
          state === "success" && "border-success/60 bg-success/5",
        )}
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-text-muted" />
            <span className="text-body font-medium">{recording ? "正在录制" : "点击重新录制"}</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant={recording ? "secondary" : "default"}
            onClick={() => {
              setState("recording");
              setDetectedLabel(null);
              setFeedback(null);
            }}
            disabled={recording}
          >
            {recording ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                录制中…
              </>
            ) : (
              "重新录制"
            )}
          </Button>
        </div>

        {recording && (
          <p className="text-secondary-size text-text-muted">
            请按下 Ctrl + 一个按键 ·{" "}
            <kbd className="rounded-sm border border-border-default bg-surface-primary px-1 py-0.5 font-sans text-caption shadow-sm">
              Esc
            </kbd>{" "}
            取消
          </p>
        )}

        {detectedLabel && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={state === "error" ? "destructive" : "default"}>
              检测到 {detectedLabel}
            </Badge>
            {pending && <span className="text-secondary-size text-text-muted">校验中…</span>}
          </div>
        )}

        {feedback && (
          <p
            className={cn(
              "text-secondary-size",
              state === "success"
                ? "text-success"
                : state === "error"
                  ? "text-danger"
                  : "text-text-muted",
            )}
            role={state === "error" ? "alert" : "status"}
          >
            {feedback}
            {state === "error" && ` · 当前快捷键仍为 ${current.displayLabel}`}
          </p>
        )}
      </div>
    </div>
  );
}

const SECTIONS: Array<{ id: string; label: string; disabled?: boolean }> = [
  { id: "hotkey", label: "快捷键" },
  { id: "regular", label: "常规", disabled: true },
  { id: "reminder", label: "提醒", disabled: true },
  { id: "data", label: "数据", disabled: true },
  { id: "about", label: "关于", disabled: true },
];

export interface HotkeySettingsWindowProps {
  api: DesktopApi;
}

export default function HotkeySettingsWindow({ api }: HotkeySettingsWindowProps) {
  const [section, setSection] = useState<string>("hotkey");
  const [hotkey, setHotkey] = useState<HotkeyBinding | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((settings) => {
        if (!cancelled) setHotkey(settings.hotkey);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(desktopErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <main
      className="flex h-screen flex-col overflow-hidden bg-surface-canvas text-text-primary"
      data-window="settings"
    >
      <header className="shrink-0 border-b border-border-subtle px-4 py-2.5">
        <h2 className="text-page-title font-semibold tracking-tight">设置</h2>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-44 shrink-0 bg-surface-secondary p-2" aria-label="设置导航">
          <div className="flex flex-col gap-0.5">
            {SECTIONS.map((item) => (
              <Button
                key={item.id}
                variant={section === item.id ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                disabled={item.disabled}
                onClick={() => setSection(item.id)}
              >
                {item.label}
                {item.disabled && (
                  <span className="ml-auto text-caption text-text-disabled">即将提供</span>
                )}
              </Button>
            ))}
          </div>
        </nav>
        <section className="min-w-0 flex-1 overflow-y-auto bg-surface-primary p-5">
          {section === "hotkey" ? (
            <div className="mx-auto flex max-w-xl flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-section font-semibold">全局新建快捷键</h3>
                <p className="text-secondary-size text-text-muted">快捷键必须是 Ctrl + 一个按键</p>
              </div>
              {loadError ? (
                <p className="text-secondary-size text-danger" role="alert">
                  {loadError}
                </p>
              ) : hotkey ? (
                <>
                  <HotkeyRecorder api={api} initial={hotkey} />
                  <p className="text-secondary-size text-text-muted">
                    录制中按{" "}
                    <kbd className="rounded-sm border border-border-default bg-surface-primary px-1 py-0.5 font-sans text-caption shadow-sm">
                      Esc
                    </kbd>{" "}
                    可取消
                  </p>
                </>
              ) : (
                <p className="text-secondary-size text-text-muted">加载中…</p>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-secondary-size text-text-muted">该设置项即将提供</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
