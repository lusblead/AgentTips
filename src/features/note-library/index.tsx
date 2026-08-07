import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Copy,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  Terminal,
  Trash2,
} from "lucide-react";
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
import { AgentBindingRow } from "@/components/shared/AgentBindingRow";
import { AgentMultiSelect } from "@/components/shared/AgentMultiSelect";
import { ConfirmActionDialog } from "@/components/shared/ConfirmActionDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { SearchInput } from "@/components/shared/SearchInput";
import { TipCard } from "@/components/shared/TipCard";
import { cn } from "@/lib/utils";
import type {
  Agent,
  AgentBinding,
  DesktopApi,
  TipDetail,
  TipSummary,
} from "@/desktop-api/contract";
import { desktopErrorMessage } from "@/desktop-api/contract";

export interface NoteLibraryWindowProps {
  api: DesktopApi;
  /** 从提醒窗口"查看全部"进入时的初始 Agent 过滤。 */
  initialAgentId?: string;
  onNewTip?: () => void;
  onOpenSettings?: () => void;
}

/**
 * 主管理窗口（三栏）：Agent 导航 / 提示列表 + 搜索 / Inspector 编辑。
 * 唯一允许浏览历史提示的地方。
 */
export default function NoteLibraryWindow({
  api,
  initialAgentId,
  onNewTip,
  onOpenSettings,
}: NoteLibraryWindowProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tips, setTips] = useState<TipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(initialAgentId);

  const [selectedTipId, setSelectedTipId] = useState<string | null>(null);
  const selectedTipIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<TipDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [editorTitle, setEditorTitle] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [editorBindings, setEditorBindings] = useState<AgentBinding[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<{
    title: string;
    content: string;
    bindings: AgentBinding[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDirty =
    savedSnapshot !== null &&
    (editorTitle !== savedSnapshot.title ||
      editorContent !== savedSnapshot.content ||
      JSON.stringify(editorBindings) !== JSON.stringify(savedSnapshot.bindings));

  const loadTips = useCallback(
    async (agentId: string | undefined, term: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = await api.listTips({
          agentId,
          search: term.trim() || undefined,
        });
        setTips(list);
        return list;
      } catch (err) {
        setLoadError(desktopErrorMessage(err));
        return [];
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  const openTip = useCallback(
    async (id: string) => {
      selectedTipIdRef.current = id;
      setSelectedTipId(id);
      setDetail(null);
      setDetailError(null);
      try {
        const tip = await api.getTip(id);
        setDetail(tip);
        if (tip) {
          const title = tip.title;
          const content = tip.content;
          const bindings = tip.bindings.map((b) => ({
            agentId: b.agentId,
            autoAttach: b.autoAttach,
          }));
          setEditorTitle(title);
          setEditorContent(content);
          setEditorBindings(bindings);
          setSavedSnapshot({ title, content, bindings: JSON.parse(JSON.stringify(bindings)) });
        }
      } catch (err) {
        setDetailError(desktopErrorMessage(err));
      }
    },
    [api],
  );

  const ensureSelection = useCallback(
    async (list: TipSummary[]) => {
      if (list.length === 0) {
        selectedTipIdRef.current = null;
        setSelectedTipId(null);
        setDetail(null);
        setSavedSnapshot(null);
        return;
      }
      const currentValid =
        selectedTipIdRef.current && list.some((tip) => tip.id === selectedTipIdRef.current);
      if (currentValid) {
        return;
      }
      await openTip(list[0].id);
    },
    [openTip],
  );

  useEffect(() => {
    let cancelled = false;
    api
      .listAgents()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(desktopErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api
      .listTips({ agentId: selectedAgentId, search: search.trim() || undefined })
      .then(async (list) => {
        if (cancelled) return;
        setTips(list);
        await ensureSelection(list);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(desktopErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, ensureSelection, search, selectedAgentId]);

  const saveDetail = async () => {
    if (!selectedTipId || saving) return;
    const trimmed = editorContent.trim();
    if (!trimmed) {
      setDetailError("提示正文不能为空");
      return;
    }
    setSaving(true);
    setDetailError(null);
    try {
      await api.updateTip(selectedTipId, {
        title: editorTitle.trim() || undefined,
        content: trimmed,
        bindings: editorBindings,
      });
      setSavedSnapshot({
        title: editorTitle.trim(),
        content: trimmed,
        bindings: JSON.parse(JSON.stringify(editorBindings)),
      });
      const list = await loadTips(selectedAgentId, search);
      await ensureSelection(list);
    } catch (err) {
      setDetailError(desktopErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedTipId) return;
    setDeleteConfirm(false);
    try {
      await api.deleteTip(selectedTipId);
      const list = await loadTips(selectedAgentId, search);
      await ensureSelection(list);
    } catch (err) {
      setDetailError(desktopErrorMessage(err));
    }
  };

  const copyContent = async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard 不可用时静默 */
    }
  };

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const agentCounts = new Map<string, number>();
  for (const tip of tips) {
    for (const agentId of tip.agentIds) {
      agentCounts.set(agentId, (agentCounts.get(agentId) ?? 0) + 1);
    }
  }
  const emptyWorkspace = !loading && !loadError && tips.length === 0 && !search;

  return (
    <main
      className="flex h-screen flex-col overflow-hidden bg-surface-canvas text-text-primary"
      data-window="main"
      data-testid="main-layout"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-2">
        <h2 className="text-page-title font-semibold tracking-tight">提示库</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="打开设置" onClick={onOpenSettings}>
            <Settings className="h-4 w-4" />
            设置
          </Button>
          <Button size="sm" aria-label="新建提示" onClick={onNewTip}>
            <Plus className="h-4 w-4" />
            新建提示
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col gap-0.5 bg-surface-secondary p-2.5">
          <Button
            variant={selectedAgentId === undefined ? "secondary" : "ghost"}
            size="sm"
            className="justify-start"
            aria-label="筛选全部便签"
            onClick={() => setSelectedAgentId(undefined)}
          >
            <span className="flex-1 truncate text-left">全部提示</span>
            <span className="text-caption text-text-muted">{tips.length}</span>
          </Button>
          <p className="px-2 pb-0.5 pt-2 text-caption font-medium text-text-muted">Agent</p>
          <div className="flex flex-col gap-0.5">
            {agents.map((agent) => (
              <Button
                key={agent.id}
                variant={selectedAgentId === agent.id ? "secondary" : "ghost"}
                size="sm"
                className="justify-start gap-2"
                aria-label={`筛选 ${agent.name}`}
                title={agent.kind === "terminal" ? "终端 Agent" : "桌面 Agent"}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                {agent.kind === "terminal" ? (
                  <Terminal className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                ) : (
                  <Monitor className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                )}
                <span className="flex-1 truncate text-left">{agent.name}</span>
                <span className="text-caption text-text-muted">
                  {agentCounts.get(agent.id) ?? 0}
                </span>
              </Button>
            ))}
          </div>
        </aside>

        <section className="flex w-80 shrink-0 flex-col border-x border-border-subtle bg-surface-primary">
          <div className="p-3 pb-2">
            <SearchInput value={search} onChange={setSearch} />
          </div>
          <div className="px-4 pb-1 text-secondary-size text-text-muted">
            {selectedAgent ? `${selectedAgent.name} 的提示` : "全部提示"} · {tips.length} 条
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
            {loadError ? (
              <EmptyState
                title="加载失败"
                description={loadError}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadTips(selectedAgentId, search)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重试
                  </Button>
                }
              />
            ) : loading && tips.length === 0 ? (
              <p className="py-10 text-center text-secondary-size text-text-muted">加载中…</p>
            ) : emptyWorkspace ? (
              <EmptyState
                className="py-16"
                title="还没有提示"
                description="按 Ctrl + F12 随时记录一条提示，或立即新建第一条"
                action={
                  <Button size="sm" onClick={onNewTip}>
                    <Plus className="h-4 w-4" />
                    新建提示
                  </Button>
                }
              />
            ) : tips.length === 0 ? (
              <EmptyState title="没有匹配的提示" description="换个关键词或 Agent 试试" />
            ) : (
              <div className="divide-y divide-border-subtle/60">
                {tips.map((tip) => (
                  <TipCard
                    key={tip.id}
                    tip={tip}
                    agents={agents}
                    selected={tip.id === selectedTipId}
                    onClick={() => void openTip(tip.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0 flex-1 overflow-hidden bg-surface-primary">
          {detail ? (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center justify-between px-4 py-1.5">
                <span className="text-caption text-text-muted">编辑提示</span>
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
                <Input
                  id="detail-title"
                  aria-label="标题"
                  value={editorTitle}
                  onChange={(event) => setEditorTitle(event.target.value)}
                  placeholder="无标题"
                  className="h-auto rounded-md border-transparent bg-transparent px-2 py-1 text-page-title font-semibold placeholder:text-text-disabled focus-visible:border-accent-ring focus-visible:bg-surface-primary"
                />
                <Textarea
                  id="detail-content"
                  value={editorContent}
                  onChange={(event) => setEditorContent(event.target.value)}
                  rows={8}
                  className="mt-2 min-h-0 flex-1 resize-none border-transparent bg-transparent px-2 text-body leading-relaxed focus-visible:border-accent-ring focus-visible:bg-surface-primary"
                />
                <div className="mt-4 flex flex-col gap-1.5">
                  <p className="px-2 text-secondary-size font-medium text-text-muted">绑定 Agent</p>
                  <div className="px-2">
                    <AgentMultiSelect
                      agents={agents}
                      selectedIds={editorBindings.map((b) => b.agentId)}
                      onChange={(ids) =>
                        setEditorBindings((current) => {
                          const existing = new Map(current.map((b) => [b.agentId, b]));
                          return ids.map(
                            (id) => existing.get(id) ?? { agentId: id, autoAttach: true },
                          );
                        })
                      }
                      disabled={saving}
                      showSelected={false}
                    />
                  </div>
                  {editorBindings.length > 0 && (
                    <div className="flex max-h-36 flex-col gap-0.5 overflow-y-auto">
                      {editorBindings.map((binding) => {
                        const agent = agents.find((a) => a.id === binding.agentId);
                        if (!agent) return null;
                        return (
                          <AgentBindingRow
                            key={binding.agentId}
                            agentName={agent.name}
                            checked={binding.autoAttach}
                            disabled={saving}
                            onCheckedChange={(autoAttach) =>
                              setEditorBindings((current) =>
                                current.map((b) =>
                                  b.agentId === binding.agentId ? { ...b, autoAttach } : b,
                                ),
                              )
                            }
                            onRemove={() =>
                              setEditorBindings((current) =>
                                current.filter((b) => b.agentId !== binding.agentId),
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-6 py-2">
                {detailError ? (
                  <span className="text-secondary-size text-danger" role="alert">
                    {detailError}
                  </span>
                ) : isDirty ? (
                  <span className="text-secondary-size text-text-muted">有未保存的修改</span>
                ) : (
                  <span className="text-secondary-size text-text-muted">已保存</span>
                )}
                <div className="flex items-center gap-2">
                  {isDirty && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => void openTip(selectedTipId!)}
                      >
                        还原
                      </Button>
                      <Button
                        size="sm"
                        disabled={saving || !editorContent.trim()}
                        onClick={() => void saveDetail()}
                      >
                        {saving ? "保存中…" : "保存修改"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "flex h-full items-center justify-center",
                emptyWorkspace ? "bg-surface-primary" : "bg-surface-canvas",
              )}
            >
              <p className="text-secondary-size text-text-muted">
                {emptyWorkspace ? "" : "从列表选择一条提示"}
              </p>
            </div>
          )}
        </section>
      </div>

      <ConfirmActionDialog
        open={deleteConfirm}
        title="删除提示？"
        description="删除后无法恢复。"
        confirmLabel="删除"
        destructive
        onConfirm={() => void deleteSelected()}
        onCancel={() => setDeleteConfirm(false)}
      />
    </main>
  );
}
