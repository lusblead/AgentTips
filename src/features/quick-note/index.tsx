import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AgentBindingRow } from "@/components/shared/AgentBindingRow";
import { AgentMultiSelect } from "@/components/shared/AgentMultiSelect";
import { desktopErrorMessage, type Agent, type DesktopApi } from "@/desktop-api/contract";

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
 * 快捷新建窗口：每次进入都是空白提示，只负责新建，不展示历史。
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
  }, []);

  const submit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || savingRef.current) {
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
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-window="quick-note"
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
        <h1 className="text-heading font-semibold tracking-tight">新建提示</h1>
        <button
          type="button"
          aria-label="关闭（Esc）"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-aux text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onClose?.()}
        >
          <kbd className="rounded-sm border bg-card px-1.5 py-0.5 font-sans text-[11px] shadow-sm">
            Esc
          </kbd>
          关闭
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-2">
        {showTitle ? (
          <Input
            aria-label="标题"
            placeholder="标题（可选）"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit px-2 text-muted-foreground underline decoration-dotted underline-offset-4 hover:bg-transparent hover:text-foreground"
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
          rows={7}
          className="min-h-0 flex-1 resize-none rounded-md"
        />

        <div className="flex flex-col gap-1.5 pb-2">
          <Label className="text-aux text-muted-foreground">绑定 Agent</Label>
          <AgentMultiSelect
            agents={agents}
            selectedIds={bindings.map((b) => b.agentId)}
            onChange={(ids) =>
              setBindings((current) => {
                const existing = new Map(current.map((b) => [b.agentId, b]));
                return ids.map((id) => existing.get(id) ?? { agentId: id, autoAttach: true });
              })
            }
            disabled={saving}
            showSelected={false}
          />
          {bindings.length > 0 && (
            <div className="flex max-h-36 flex-col gap-1 overflow-y-auto pr-0.5">
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
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {saved && (
            <span className="flex shrink-0 items-center gap-1 text-aux text-success" role="status">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已保存
            </span>
          )}
          {error && (
            <span className="truncate text-aux text-destructive" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-aux text-muted-foreground">
            <kbd className="rounded-sm border bg-card px-1 py-0.5 font-sans text-[11px] shadow-sm">
              Ctrl
            </kbd>
            <span className="mx-0.5">+</span>
            <kbd className="rounded-sm border bg-card px-1 py-0.5 font-sans text-[11px] shadow-sm">
              Enter
            </kbd>
            保存
          </span>
          <Button
            type="button"
            size="sm"
            disabled={saving || !content.trim()}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </main>
  );
}
