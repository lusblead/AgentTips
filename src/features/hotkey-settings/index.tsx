import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { desktopErrorMessage } from "@/desktop-api/contract";
import type {
  DesktopApi,
  HotkeyBinding,
  HotkeyCandidate,
  HotkeyPreviewResult,
  ReminderSettings,
} from "@/desktop-api/contract";
import { hotkeyDisplayKey } from "@/desktop-api";

export interface HotkeyRecorderProps {
  api: DesktopApi;
  initial: HotkeyBinding;
}

type RecorderState = "idle" | "recording" | "success" | "error";

interface PendingConfirm {
  binding: HotkeyBinding;
  warning: { code: string; message: string };
}

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
 * - 合法组合直接 updateHotkey（真实注册 + SQLite 持久化）；
 * - 高冲突组合先显示确认，用户点“仍然使用”才更新；
 * - 录制期间 begin/endHotkeyRecording 配对，抑制当前快捷键触发 Quick Note；
 * - 取消/失败保留原快捷键。
 */
export function HotkeyRecorder({ api, initial }: HotkeyRecorderProps) {
  const [current, setCurrent] = useState<HotkeyBinding>(initial);
  const [state, setState] = useState<RecorderState>("idle");
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const cancel = useCallback(() => {
    setState("idle");
    setDetectedLabel(null);
    setFeedback(null);
    setPending(false);
    setConfirm(null);
    void api.endHotkeyRecording();
  }, [api]);

  const doUpdate = useCallback(
    async (binding: HotkeyBinding) => {
      setPending(true);
      try {
        await api.updateHotkey({
          modifier: "Ctrl",
          keyCode: binding.keyCode,
        });
        setCurrent(binding);
        setState("success");
        setFeedback(`已更新 ${binding.displayLabel}`);
        setConfirm(null);
        await api.endHotkeyRecording();
      } catch (err) {
        setState("error");
        setFeedback(desktopErrorMessage(err));
        setConfirm(null);
        await api.endHotkeyRecording();
      } finally {
        setPending(false);
      }
    },
    [api],
  );

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
          if (result.warning) {
            setConfirm({ binding: result.binding, warning: result.warning });
          } else {
            await doUpdate(result.binding);
          }
        } else {
          setState("error");
          setFeedback(reasonText(result));
        }
      } catch (err) {
        const message = desktopErrorMessage(err);
        setState("error");
        setFeedback(message);
      } finally {
        setPending(false);
      }
    },
    [api, cancel, doUpdate],
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

  // 兜底：组件卸载（Settings 关闭）时恢复 suppression，防止快捷键永久失效。
  useEffect(() => {
    return () => {
      void api.endHotkeyRecording();
    };
  }, [api]);

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
              void api.beginHotkeyRecording();
              setState("recording");
              setDetectedLabel(null);
              setFeedback(null);
              setConfirm(null);
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

        {confirm && (
          <div
            className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning-subtle p-3"
            role="dialog"
            aria-label="高冲突快捷键确认"
          >
            <p className="text-secondary-size text-text-primary">
              {confirm.warning.message}。设为全局快捷键可能影响其他软件。
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setConfirm(null);
                  setState("idle");
                  setDetectedLabel(null);
                  setFeedback(null);
                  void api.endHotkeyRecording();
                }}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => void doUpdate(confirm.binding)}
              >
                仍然使用
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const SECTIONS: Array<{ id: string; label: string; disabled?: boolean }> = [
  { id: "hotkey", label: "快捷键" },
  { id: "regular", label: "常规", disabled: true },
  { id: "reminder", label: "提醒" },
  { id: "data", label: "数据", disabled: true },
  { id: "about", label: "关于", disabled: true },
];

function ReminderSettingsSection({ api }: { api: DesktopApi }) {
  const [value, setValue] = useState("15");
  const [saved, setSaved] = useState<number>(15);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getReminderSettings()
      .then((settings: ReminderSettings) => {
        if (cancelled) return;
        setSaved(settings.cooldownMinutes);
        setValue(String(settings.cooldownMinutes));
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(desktopErrorMessage(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function save() {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) {
      setError("冷却时长必须在 1 ～ 120 分钟之间");
      setValue(String(saved));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateReminderSettings(parsed);
      setSaved(updated.cooldownMinutes);
      setValue(String(updated.cooldownMinutes));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      // 保存失败：保留旧值
      setError(desktopErrorMessage(err));
      setValue(String(saved));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-secondary-size text-text-muted">加载中…</p>;
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-section font-semibold">提醒冷却</h3>
        <p className="text-secondary-size text-text-muted">
          进入 Agent 后，同一 Agent 在冷却时间内不再重复提醒。
        </p>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="reminder-cooldown" className="shrink-0 text-secondary-size text-text-muted">
          冷却时长（分钟）
        </label>
        <input
          id="reminder-cooldown"
          type="number"
          min={1}
          max={120}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-28 rounded-md border border-border-default bg-surface-primary px-3 py-2 text-body"
          data-testid="reminder-cooldown-input"
        />
        <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
      <p className="text-secondary-size text-text-muted">
        允许范围 1 ～ 120 分钟（默认 15）。冷却按 Agent 独立记录。
      </p>
      {error && (
        <p className="text-secondary-size text-danger" role="alert">
          {error} · 当前仍为 {saved} 分钟
        </p>
      )}
      {success && (
        <p className="text-secondary-size text-success" role="status">
          已保存 {saved} 分钟
        </p>
      )}
    </div>
  );
}

export interface HotkeySettingsWindowProps {
  api: DesktopApi;
}

export default function HotkeySettingsWindow({ api }: HotkeySettingsWindowProps) {
  const [section, setSection] = useState<string>("hotkey");
  const [hotkey, setHotkey] = useState<HotkeyBinding | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getHotkeySettings()
      .then((state) => {
        if (cancelled) return;
        setHotkey(state.configured ?? state.active);
        setRegistrationError(state.registrationError);
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
                  {registrationError && (
                    <p className="text-secondary-size text-warning" role="alert">
                      ⚠ 当前无法注册这个快捷键，请重新录制。
                    </p>
                  )}
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
          ) : section === "reminder" ? (
            <ReminderSettingsSection api={api} />
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
