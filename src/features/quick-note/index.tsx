import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentBindingRow } from "@/components/shared/AgentBindingRow";
import { AgentMultiSelect } from "@/components/shared/AgentMultiSelect";
import { ConfirmActionDialog } from "@/components/shared/ConfirmActionDialog";
import { TagInput } from "@/components/shared/TagInput";
import { cn } from "@/lib/utils";
import { noteStyle } from "@/lib/palette";
import { mergeTipTags } from "@/lib/tags";
import { desktopErrorMessage } from "@/desktop-api/contract";
import type { Agent, DesktopApi, NoteColorKey } from "@/desktop-api/contract";

export interface QuickNoteWindowProps {
  api: DesktopApi;
  /** 窗口隐藏后的可选通知；实际隐藏始终通过 DesktopApi。 */
  onClose?: () => void;
}

interface DraftBinding {
  agentId: string;
  autoAttach: boolean;
}

/**
 * 快捷新建窗口：floating command utility。
 * 每次进入都是空白提示；content 非空即可保存，Agent 绑定可选。
 * 键盘：Ctrl+Enter 保存，Esc 关闭。
 */
export default function QuickNoteWindow({ api, onClose }: QuickNoteWindowProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [bindings, setBindings] = useState<DraftBinding[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [draftColor, setDraftColor] = useState<NoteColorKey | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const hasUnsavedDraftRef = useRef(false);

  const loadTagSuggestions = useCallback(() => api.listTags(), [api]);

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
    let cancelled = false;
    loadTagSuggestions()
      .then((list) => {
        if (!cancelled) setTagSuggestions(list);
      })
      .catch(() => {
        // 历史标签是增强能力；失败时仍允许自由输入和保存。
        if (!cancelled) setTagSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadTagSuggestions]);

  useEffect(() => {
    let cancelled = false;
    api
      .suggestNoteColor()
      .then((color) => {
        if (!cancelled) setDraftColor(color);
      })
      .catch(() => {
        if (!cancelled) setDraftColor("lemon");
      });
    textareaRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const reset = useCallback(() => {
    hasUnsavedDraftRef.current = false;
    setContent("");
    setTags([]);
    setTagInput("");
    setBindings([]);
    setError(null);
    setDiscardConfirmOpen(false);
    setDraftColor(null);
    void api
      .suggestNoteColor()
      .then(setDraftColor)
      .catch(() => setDraftColor("lemon"));
    void loadTagSuggestions()
      .then(setTagSuggestions)
      .catch(() => setTagSuggestions([]));
  }, [api, loadTagSuggestions]);

  const hideQuickNote = useCallback(() => {
    void api.hideCurrentWindow("quick-note");
    onClose?.();
  }, [api, onClose]);

  const discardAndHide = useCallback(() => {
    reset();
    hideQuickNote();
  }, [hideQuickNote, reset]);

  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (hasUnsavedDraftRef.current) {
      setDiscardConfirmOpen(true);
      return;
    }
    discardAndHide();
  }, [discardAndHide]);

  const confirmDiscard = useCallback(() => {
    setDiscardConfirmOpen(false);
    discardAndHide();
  }, [discardAndHide]);

  const cancelDiscard = useCallback(() => {
    setDiscardConfirmOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    hasUnsavedDraftRef.current =
      content.trim().length > 0 ||
      tagInput.trim().length > 0 ||
      tags.length > 0 ||
      bindings.length > 0;
  }, [bindings.length, content, tagInput, tags.length]);

  // 每次 Quick Note 显示（Tauri emit reset / 浏览器 hide 模拟）都开始新的 Draft Session
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    api
      .subscribeQuickNoteReset(() => reset())
      .then((unsub) => {
        unsubscribe = unsub;
      })
      .catch(() => {
        /* 事件订阅失败不阻塞创建流程 */
      });
    return () => {
      unsubscribe?.();
    };
  }, [api, reset]);

  // 系统标题栏关闭由 Rust 转换为事件，和 Esc / 界面关闭按钮共用同一防丢稿入口。
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    api
      .subscribeQuickNoteCloseRequested(() => requestClose())
      .then((unsub) => {
        unsubscribe = unsub;
      })
      .catch(() => {
        /* 监听失败时不降级为直接隐藏，防止静默丢稿 */
      });
    return () => {
      unsubscribe?.();
    };
  }, [api, requestClose]);

  const canSave = content.trim().length > 0;

  const submit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || savingRef.current) return;
    const mergedTags = mergeTipTags(tags, tagInput, tagSuggestions);
    if (mergedTags.error) {
      setError(mergedTags.error);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.createTip({
        content: trimmed,
        tags: mergedTags.tags,
        colorKey: draftColor ?? undefined,
        bindings: bindings.map((b) => ({ agentId: b.agentId, autoAttach: b.autoAttach })),
      });
      setSaved(true);
      // 保存成功后：显示轻量成功状态 → 约 300ms 后隐藏窗口并清空 Draft
      window.setTimeout(() => {
        setSaved(false);
        reset();
        hideQuickNote();
      }, 300);
    } catch (err) {
      setError(desktopErrorMessage(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [api, bindings, content, draftColor, hideQuickNote, reset, tagInput, tagSuggestions, tags]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (discardConfirmOpen) return;
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [discardConfirmOpen, requestClose, submit]);

  return (
    <main
      className="h-screen overflow-hidden bg-surface-canvas p-2.5 text-text-primary"
      data-window="quick-note"
      data-testid="quick-note-shell"
    >
      <section
        className="quick-note-paper flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[16px] px-3.5 pb-3 pt-2.5 shadow-[0_12px_34px_rgba(15,23,42,0.10)]"
        style={
          draftColor ? noteStyle(draftColor) : { backgroundColor: "#F5F7FA", color: "#243044" }
        }
        data-testid="note-surface"
        data-note-color={draftColor ?? undefined}
        data-color={draftColor ?? undefined}
      >
        <header className="flex shrink-0 items-center justify-between gap-3">
          <h1 className="text-body font-semibold tracking-tight">新建提示</h1>
          <button
            type="button"
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-full text-text-muted transition-colors hover:bg-black/5 hover:text-text-primary focus:outline-none focus-visible:bg-black/5"
            disabled={saving}
            onClick={requestClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <textarea
          ref={textareaRef}
          aria-label="正文"
          placeholder="写下要提醒自己的内容……"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="block min-h-[88px] w-full flex-1 resize-none appearance-none rounded-none border-0 bg-transparent px-0 py-2.5 text-body leading-relaxed outline-none placeholder:text-text-muted focus:border-0 focus:outline-none focus-visible:outline-none"
          style={{ border: "none", borderRadius: 0, boxShadow: "none", outline: "none" }}
        />

        <div className="shrink-0 border-t border-black/10 pt-2" data-testid="quick-note-bindings">
          <div className="mb-1.5" data-testid="quick-note-tags">
            <TagInput
              tags={tags}
              suggestions={tagSuggestions}
              inputValue={tagInput}
              onInputValueChange={setTagInput}
              onTagsChange={setTags}
              onError={setError}
              disabled={saving}
              compact
            />
          </div>

          {bindings.length > 0 && (
            <div
              className="mb-1.5 flex max-h-[58px] flex-col gap-0.5 overflow-y-auto pr-0.5"
              data-testid="quick-note-binding-list"
            >
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

          {(saved || error) && (
            <div className="mb-1.5 min-w-0">
              {saved && (
                <span
                  className="flex items-center gap-1 text-secondary-size text-success"
                  role="status"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已保存
                </span>
              )}
              {error ? (
                <div
                  className="max-h-9 overflow-y-auto break-words text-secondary-size text-danger select-text"
                  role="alert"
                >
                  <span className="font-medium">保存失败：</span>
                  {error}
                </div>
              ) : null}
            </div>
          )}

          <div
            className="flex min-w-0 items-center justify-between gap-2"
            data-testid="quick-note-actions"
          >
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
      </section>

      <ConfirmActionDialog
        open={discardConfirmOpen}
        title="放弃这条便签？"
        description="这条便签还没有保存，放弃后无法恢复。"
        confirmLabel="放弃内容"
        cancelLabel="继续编辑"
        contentClassName="w-[calc(100%-24px)] max-w-[340px] gap-3 rounded-xl p-4"
        destructive
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </main>
  );
}
