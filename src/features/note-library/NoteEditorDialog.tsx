import { useState } from "react";
import { Archive, Check, Copy, MoreHorizontal, Trash2 } from "lucide-react";
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
import { NOTE_COLORS, NOTE_COLOR_LABELS, noteColorClass } from "@/lib/palette";
import { desktopErrorMessage } from "@/desktop-api/contract";
import type {
  Agent,
  AgentBinding,
  DesktopApi,
  NoteColorKey,
  TipDetail,
} from "@/desktop-api/contract";

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
  const [title, setTitle] = useState(tip.title);
  const [content, setContent] = useState(tip.content);
  const [bindings, setBindings] = useState<AgentBinding[]>(initialBindings);
  const [savedSnapshot, setSavedSnapshot] = useState<{
    title: string;
    content: string;
    bindings: AgentBinding[];
  }>({
    title: tip.title,
    content: tip.content,
    bindings: JSON.parse(JSON.stringify(initialBindings)),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [updatingColor, setUpdatingColor] = useState(false);

  const isDirty =
    savedSnapshot !== null &&
    (title !== savedSnapshot.title ||
      content !== savedSnapshot.content ||
      JSON.stringify(bindings) !== JSON.stringify(savedSnapshot.bindings));

  const save = async () => {
    if (saving) return;
    const trimmed = content.trim();
    if (!trimmed) {
      setError("正文不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTip(tip.id, {
        title: title.trim() || undefined,
        content: trimmed,
        bindings,
      });
      setSavedSnapshot({
        title: updated.title,
        content: updated.content,
        bindings: updated.bindings.map((b) => ({ agentId: b.agentId, autoAttach: b.autoAttach })),
      });
      setTitle(updated.title);
      setContent(updated.content);
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

  const changeColor = async (colorKey: NoteColorKey) => {
    if (updatingColor || colorKey === tip.colorKey) return;
    setUpdatingColor(true);
    try {
      const updated = await api.updateTipColor(tip.id, colorKey);
      onTipUpdated(updated);
    } catch (err) {
      setError(desktopErrorMessage(err));
    } finally {
      setUpdatingColor(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent
          className={`max-w-2xl ${noteColorClass(tip.colorKey)} border-0 shadow-popover`}
        >
          <div className="flex items-start justify-between gap-2 pr-8">
            <Input
              aria-label="标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="无标题"
              className="h-auto rounded-md border-transparent bg-transparent px-2 py-1 text-page-title font-semibold placeholder:text-text-disabled focus-visible:border-accent-ring"
            />
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

          <Textarea
            aria-label="正文"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={8}
            className="min-h-0 flex-1 resize-none border-transparent bg-transparent px-2 text-body leading-relaxed focus-visible:border-accent-ring"
          />

          <div className="flex flex-col gap-1.5">
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

          <div className="flex flex-col gap-1.5">
            <p className="px-2 text-secondary-size font-medium text-text-secondary">便签颜色</p>
            <div className="flex flex-wrap gap-2 px-2">
              {NOTE_COLORS.map((color) => {
                const active = color === tip.colorKey;
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={`选择颜色 ${NOTE_COLOR_LABELS[color]}`}
                    aria-pressed={active}
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${noteColorClass(
                      color,
                    )} border border-black/10 shadow-sm transition-transform duration-[120ms] hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                      active ? "ring-2 ring-accent-ring" : ""
                    }`}
                    disabled={updatingColor}
                    onClick={() => void changeColor(color)}
                  >
                    {active && <Check className="h-4 w-4 text-note-text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border-subtle/60 px-2 pt-2">
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
