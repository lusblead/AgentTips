import { useEffect, useState } from "react";
import { Archive, Copy, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AgentBindingRow } from "@/components/shared/AgentBindingRow";
import { AgentMultiSelect } from "@/components/shared/AgentMultiSelect";
import { ConfirmActionDialog } from "@/components/shared/ConfirmActionDialog";
import { TagInput } from "@/components/shared/TagInput";
import { noteStyle } from "@/lib/palette";
import { mergeTipTags } from "@/lib/tags";
import { desktopErrorMessage } from "@/desktop-api/contract";
import type { Agent, AgentBinding, DesktopApi, TipDetail } from "@/desktop-api/contract";

export interface NoteEditorDialogProps {
  tip: TipDetail | null;
  agents: Agent[];
  api: DesktopApi;
  onClose: () => void;
  onTipUpdated: (tip: TipDetail) => void;
  onTipDeleted: (id: string) => void;
}

/**
 * Floating Note Editor：点击便签后"从桌面拿起一张便签"。
 * 标题/正文自然编辑，dirty 才显示保存操作，删除在 overflow menu。
 */
export function NoteEditorDialog({
  tip,
  agents,
  api,
  onClose,
  onTipUpdated,
  onTipDeleted,
}: NoteEditorDialogProps) {
  if (!tip) {
    return null;
  }
  return (
    <EditorInner
      key={tip.id}
      tip={tip}
      agents={agents}
      api={api}
      onClose={onClose}
      onTipUpdated={onTipUpdated}
      onTipDeleted={onTipDeleted}
    />
  );
}

interface EditorInnerProps {
  tip: TipDetail;
  agents: Agent[];
  api: DesktopApi;
  onClose: () => void;
  onTipUpdated: (tip: TipDetail) => void;
  onTipDeleted: (id: string) => void;
}

function EditorInner({ tip, agents, api, onClose, onTipUpdated, onTipDeleted }: EditorInnerProps) {
  const initialBindings = tip.bindings.map((b) => ({
    agentId: b.agentId,
    autoAttach: b.autoAttach,
  }));
  const hasLegacyTitle = tip.title.trim().length > 0;
  const [title, setTitle] = useState(tip.title);
  const [content, setContent] = useState(tip.content);
  const [tags, setTags] = useState<string[]>(tip.tags);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [bindings, setBindings] = useState<AgentBinding[]>(initialBindings);
  const [savedSnapshot, setSavedSnapshot] = useState<{
    title: string;
    content: string;
    tags: string[];
    bindings: AgentBinding[];
  }>({
    title: tip.title,
    content: tip.content,
    tags: [...tip.tags],
    bindings: JSON.parse(JSON.stringify(initialBindings)),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const isDirty =
    savedSnapshot !== null &&
    (title !== savedSnapshot.title ||
      content !== savedSnapshot.content ||
      tagInput.trim().length > 0 ||
      JSON.stringify(tags) !== JSON.stringify(savedSnapshot.tags) ||
      JSON.stringify(bindings) !== JSON.stringify(savedSnapshot.bindings));

  useEffect(() => {
    let cancelled = false;
    api
      .listTags()
      .then((list) => {
        if (!cancelled) setTagSuggestions(list);
      })
      .catch(() => {
        if (!cancelled) setTagSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const save = async () => {
    if (saving) return;
    const trimmed = content.trim();
    if (!trimmed) {
      setError("正文不能为空");
      return;
    }
    const mergedTags = mergeTipTags(tags, tagInput, tagSuggestions);
    if (mergedTags.error) {
      setError(mergedTags.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTip(tip.id, {
        ...(hasLegacyTitle ? { title: title.trim() } : {}),
        content: trimmed,
        tags: mergedTags.tags,
        bindings,
      });
      setSavedSnapshot({
        title: updated.title,
        content: updated.content,
        tags: [...updated.tags],
        bindings: updated.bindings.map((b) => ({ agentId: b.agentId, autoAttach: b.autoAttach })),
      });
      setTitle(updated.title);
      setContent(updated.content);
      setTags(updated.tags);
      setTagInput("");
      onTipUpdated(updated);
    } catch (err) {
      setError(desktopErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard 不可用时静默 */
    }
  };

  const remove = async () => {
    setDeleteConfirm(false);
    try {
      await api.deleteTip(tip.id);
      onTipDeleted(tip.id);
      onClose();
    } catch (err) {
      setError(desktopErrorMessage(err));
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent
          className="flex max-h-[min(680px,calc(100vh-64px))] max-w-2xl flex-col overflow-hidden border-0 p-0 shadow-[0_12px_34px_rgba(15,23,42,0.18)]"
          style={noteStyle(tip.colorKey)}
          data-note-id={tip.id}
          data-note-color={tip.colorKey}
        >
          <div className="flex shrink-0 items-start justify-between gap-2 px-6 pt-5 pr-3">
            {hasLegacyTitle && (
              <Input
                aria-label="标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-auto rounded-md border-none bg-transparent px-2 py-1 text-[17px] font-semibold outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="更多操作">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem disabled>
                  <Archive className="h-4 w-4" />
                  归档
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyContent()}>
                  <Copy className="h-4 w-4" />
                  {copied ? "已复制" : "复制"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  aria-label="删除提示"
                  onSelect={() => setDeleteConfirm(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
            <Textarea
              aria-label="正文"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={8}
              className="min-h-full resize-none rounded-md border-none bg-transparent px-2 text-body leading-relaxed outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            />
          </div>

          <div className="shrink-0 flex flex-col gap-1.5 border-t border-black/10 px-6 py-3">
            <div className="px-2">
              <TagInput
                tags={tags}
                suggestions={tagSuggestions}
                inputValue={tagInput}
                onInputValueChange={setTagInput}
                onTagsChange={setTags}
                onError={setError}
                disabled={saving}
              />
            </div>
            <p className="px-2 text-secondary-size font-medium text-text-secondary">绑定 Agent</p>
            <div className="px-2">
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
            </div>
            {bindings.length > 0 && (
              <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
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
                        setBindings((current) =>
                          current.filter((b) => b.agentId !== binding.agentId),
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-black/10 px-6 py-2.5">
            {error ? (
              <span className="text-secondary-size text-danger" role="alert">
                {error}
              </span>
            ) : isDirty ? (
              <span className="text-secondary-size text-text-muted">有未保存的修改</span>
            ) : (
              <span className="text-secondary-size text-text-muted">已保存</span>
            )}
            {isDirty && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    if (savedSnapshot) {
                      setTitle(savedSnapshot.title);
                      setContent(savedSnapshot.content);
                      setTags([...savedSnapshot.tags]);
                      setTagInput("");
                      setBindings(JSON.parse(JSON.stringify(savedSnapshot.bindings)));
                    }
                  }}
                >
                  还原
                </Button>
                <Button size="sm" disabled={saving || !content.trim()} onClick={() => void save()}>
                  {saving ? "保存中…" : "保存修改"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={deleteConfirm}
        title="删除提示？"
        description="删除后无法恢复。"
        confirmLabel="删除"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setDeleteConfirm(false)}
      />
    </>
  );
}
