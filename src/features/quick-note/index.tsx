import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentBindingRow } from "@/components/shared/AgentBindingRow";
import { AgentMultiSelect } from "@/components/shared/AgentMultiSelect";
import { cn } from "@/lib/utils";
import { desktopErrorMessage } from "@/desktop-api/contract";
import type { Agent, DesktopApi } from "@/desktop-api/contract";

export interface QuickNoteWindowProps {
  api: DesktopApi;
  /** 浏览器/Tauri 模式下关闭窗口的行为；测试可注入 no-op。 */
  onClose?: () => void;
}

interface DraftBinding {
  agentId: string;
  autoAttach: boolean;
}

/**
 * 快捷新建窗口：floating command utility。
 * 每次进入都是空白提示；content 非空且至少绑定一个 Agent 才允许保存。
 * 键盘：Ctrl+Enter 保存，Esc 关闭。
 */
export default function QuickNoteWindow({ api, onClose }: QuickNoteWindowProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [bindings, setBindings] = useState<DraftBinding[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTitle, setShowTitle] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api.listAgents().then((list) => {
      if (!cancelled) setAgents(list);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const reset = useCallback(() => {
    setTitle("");
    setContent("");
    setBindings([]);
    setShowTitle(false);
    setError(null);
    setSubmitAttempted(false);
  }, []);

  const canSave = content.trim().length > 0 && bindings.length > 0;
  const noAgentHint = !submitAttempted && content.trim().length > 0 && bindings.length === 0;

  const submit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || bindings.length === 0 || savingRef.current) {
      setSubmitAttempted(true);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.createTip({
        title: title.trim() || undefined,
        content: trimmed,
        bindings: bindings.map((b) => ({ agentId: b.agentId, autoAttach: b.autoAttach })),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 900);
      reset();
      textareaRef.current?.focus();
    } catch (err) {
      setError(desktopErrorMessage(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [api, bindings, content, reset, title]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submit]);

  return (
    <main
      className="flex h-screen flex-col overflow-hidden bg-pastel-butter text-text-primary"
      data-window="quick-note"
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <h1 className="text-page-title font-semibold tracking-tight">新建提示</h1>
        <button
          type="button"
          aria-label="关闭（Esc）"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-secondary-size text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:bg-surface-hover"
          onClick={() => onClose?.()}
        >
          <kbd className="rounded-sm border border-border-default bg-surface-primary px-1.5 py-0.5 font-sans text-caption shadow-sm">
            Esc
          </kbd>
          关闭
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-1">
        {showTitle ? (
          <Input
            aria-label="标题"
            placeholder="标题（可选）"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mb-2 border-transparent bg-transparent px-1 text-page-title font-medium placeholder:text-text-disabled focus-visible:border-accent-ring focus-visible:bg-surface-primary"
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-1 w-fit px-1 text-secondary-size text-text-muted underline decoration-dotted underline-offset-4 hover:bg-transparent hover:text-text-primary"
            onClick={() => setShowTitle(true)}
          >
            添加标题
          </Button>
        )}

        <Textarea
          ref={textareaRef}
          aria-label="正文"
          placeholder="写下要提醒自己的内容……"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={6}
          className="min-h-0 flex-1 resize-none rounded-lg border-border-subtle bg-surface-primary px-3 py-2 text-body leading-relaxed focus-visible:border-accent-ring focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]"
        />

        <div className="shrink-0 py-2">
          {bindings.length > 0 && (
            <div className="mb-1.5 flex max-h-28 flex-col gap-0.5 overflow-y-auto">
              {bindings.map((binding) => {
                const agent = agents.find((a) => a.id === binding.agentId);
                if (!agent) return null;
                return (
                  <AgentBindingRow
                    key={binding.agentId}
                    agentName={agent.name}
                    checked={binding.autoAttach}
                    disabled={saving}
                    onCheckedChange={(autoAttach) =>
                      setBindings((current) =>
                        current.map((b) =>
                          b.agentId === binding.agentId ? { ...b, autoAttach } : b,
                        ),
                      )
                    }
                    onRemove={() =>
                      setBindings((current) => current.filter((b) => b.agentId !== binding.agentId))
                    }
                  />
                );
              })}
            </div>
          )}
          <AgentMultiSelect
            agents={agents}
            selectedIds={bindings.map((b) => b.agentId)}
            onChange={(ids) => {
              setBindings((current) => {
                const existing = new Map(current.map((b) => [b.agentId, b]));
                return ids.map((id) => existing.get(id) ?? { agentId: id, autoAttach: true });
              });
              // 选择后焦点回到正文，避免快捷键被菜单 trigger 捕获
              textareaRef.current?.focus();
            }}
            disabled={saving}
            showSelected={false}
            onMenuClosed={() => textareaRef.current?.focus()}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {saved && (
            <span
              className="flex shrink-0 items-center gap-1 text-secondary-size text-success"
              role="status"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              已保存
            </span>
          )}
          {error ? (
            <span className="truncate text-secondary-size text-danger" role="alert">
              {error}
            </span>
          ) : noAgentHint ? (
            <span className="truncate text-secondary-size text-text-muted">
              请至少绑定一个 Agent
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-secondary-size text-text-muted">
            <kbd className="rounded-sm border border-border-default bg-surface-primary px-1 py-0.5 font-sans text-caption shadow-sm">
              Ctrl
            </kbd>
            <span className="mx-0.5">+</span>
            <kbd className="rounded-sm border border-border-default bg-surface-primary px-1 py-0.5 font-sans text-caption shadow-sm">
              Enter
            </kbd>
            保存
          </span>
          <Button
            type="button"
            size="sm"
            className={cn(!canSave && "opacity-50")}
            disabled={saving || !canSave}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </main>
  );
}
