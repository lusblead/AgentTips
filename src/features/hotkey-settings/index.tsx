import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { desktopErrorMessage } from "@/desktop-api/contract";
import type {
  DesktopApi,
  HotkeyBinding,
  HotkeyCandidate,
  HotkeyPreviewResult,
} from "@/desktop-api/contract";
import { hotkeyDisplayKey } from "@/desktop-api";
import { cn } from "@/lib/utils";

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
        setState("error");
        setFeedback(desktopErrorMessage(err));
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
        <span className="w-24 shrink-0 text-aux text-muted-foreground">当前快捷键</span>
        <span
          className="flex-1 rounded-md border bg-card px-3 py-2 font-medium"
          data-testid="hotkey-display"
        >
          {current.displayLabel}
        </span>
      </div>

      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-[var(--duration-fast)]",
          recording && "border-primary/60 bg-primary/5 ring-1 ring-primary/30",
          state === "error" && "border-destructive/60 bg-destructive/5",
          state === "success" && "border-success/60 bg-success/5",
        )}
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <span className="text-tip font-medium">{recording ? "正在录制" : "点击重新录制"}</span>
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
          <p className="text-aux text-muted-foreground">
            请按下 Ctrl + 一个按键 ·{" "}
            <kbd className="rounded-sm border bg-card px-1 py-0.5 font-sans text-[11px] shadow-sm">
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
            {pending && <span className="text-aux text-muted-foreground">校验中…</span>}
          </div>
        )}

        {feedback && (
          <p
            className={cn(
              "text-aux",
              state === "success" ? "text-success" : state === "error" ? "text-destructive" : "",
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

export interface HotkeySettingsWindowProps {
  api: DesktopApi;
}

export default function HotkeySettingsWindow({ api }: HotkeySettingsWindowProps) {
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
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-window="settings"
    >
      <header className="shrink-0 border-b px-4 py-2.5">
        <h2 className="text-heading font-semibold tracking-tight">设置</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Card className="mx-auto w-full max-w-[640px]">
          <CardContent className="flex flex-col gap-4 p-4">
            {loadError ? (
              <p className="text-aux text-destructive" role="alert">
                {loadError}
              </p>
            ) : hotkey ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">全局新建快捷键</span>
                  <HotkeyRecorder api={api} initial={hotkey} />
                </div>
                <div className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-aux text-muted-foreground">
                  <p>快捷键必须是 Ctrl + 一个按键</p>
                  <p>
                    录制中按{" "}
                    <kbd className="rounded-sm border bg-card px-1 py-0.5 font-sans text-[11px] shadow-sm">
                      Esc
                    </kbd>{" "}
                    可取消
                  </p>
                </div>
              </>
            ) : (
              <p className="text-aux text-muted-foreground">加载中…</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
