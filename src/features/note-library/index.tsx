import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Settings, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { AgentBindingRow } from "@/components/shared/AgentBindingRow";
import { AgentMultiSelect } from "@/components/shared/AgentMultiSelect";
import { ConfirmActionDialog } from "@/components/shared/ConfirmActionDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { SearchInput } from "@/components/shared/SearchInput";
import { TipCard } from "@/components/shared/TipCard";
import { desktopErrorMessage } from "@/desktop-api/contract";
import type {
  Agent,
  AgentBinding,
  DesktopApi,
  TipDetail,
  TipSummary,
} from "@/desktop-api/contract";

export interface NoteLibraryWindowProps {
  api: DesktopApi;
  /** 从提醒窗口"查看全部"进入时的初始 Agent 过滤。 */
  initialAgentId?: string;
  onNewTip?: () => void;
  onOpenSettings?: () => void;
}

/**
 * 主管理窗口（三栏）：Agent 导航 / 便签列表 + 搜索 / 详情编辑。
 * 唯一允许浏览历史便签的地方。
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
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
          setEditorTitle(tip.title);
          setEditorContent(tip.content);
          setEditorBindings(
            tip.bindings.map((b) => ({ agentId: b.agentId, autoAttach: b.autoAttach })),
          );
        }
      } catch (err) {
        setDetailError(desktopErrorMessage(err));
      }
    },
    [api],
  );

  /** 列表有数据时保证右侧有选中项，不让详情区无意义留空。 */
  const ensureSelection = useCallback(
    async (list: TipSummary[]) => {
      if (list.length === 0) {
        selectedTipIdRef.current = null;
        setSelectedTipId(null);
        setDetail(null);
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
      setDetailError("便签正文不能为空");
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
      setNotice("已保存");
      window.setTimeout(() => setNotice(null), 900);
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

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const agentCounts = new Map<string, number>();
  for (const tip of tips) {
    for (const agentId of tip.agentIds) {
      agentCounts.set(agentId, (agentCounts.get(agentId) ?? 0) + 1);
    }
  }
  const hasData = tips.length > 0;
  const emptyState = !hasData && !search;

  return (
    <main
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-window="main"
      data-testid="main-layout"
    >
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <h2 className="text-heading font-semibold tracking-tight">提示库</h2>
        <div className="flex items-center gap-2">
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
        <aside className="flex w-52 shrink-0 flex-col gap-1 p-3">
          <Button
            variant={selectedAgentId === undefined ? "secondary" : "ghost"}
            size="sm"
            className="justify-start"
            aria-label="筛选全部便签"
            onClick={() => setSelectedAgentId(undefined)}
          >
            <span className="flex-1 truncate text-left">全部便签</span>
            <span className="text-[11px] text-muted-foreground">{tips.length}</span>
          </Button>
          <Separator className="my-2" />
          <p className="px-2 pb-1 text-aux font-medium text-muted-foreground">Agent</p>
          <div className="flex flex-col gap-0.5">
            {agents.map((agent) => (
              <Button
                key={agent.id}
                variant={selectedAgentId === agent.id ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                aria-label={`筛选 ${agent.name}`}
                title={agent.kind === "terminal" ? "终端 Agent" : "桌面 Agent"}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <span className="flex-1 truncate text-left">{agent.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {agentCounts.get(agent.id) ?? 0}
                </span>
              </Button>
            ))}
          </div>
        </aside>

        <section className="flex w-80 shrink-0 flex-col border-x">
          <div className="p-3">
            <SearchInput value={search} onChange={setSearch} />
          </div>
          <div className="px-3 pb-1 text-aux text-muted-foreground">
            {selectedAgent ? `${selectedAgent.name} 的提示` : "全部提示"} · {tips.length} 条
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
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
              <p className="py-10 text-center text-aux text-muted-foreground">加载中…</p>
            ) : emptyState ? (
              <EmptyState
                title="还没有提示"
                description="按 Ctrl + F12 随时记录一条提示，或在下方新建"
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
              <div className="flex flex-col gap-2">
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

        <section className="min-w-0 flex-1 overflow-hidden">
          {detail ? (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
                <h3 className="text-sm font-medium">编辑提示</h3>
                <div className="flex items-center gap-2">
                  {notice && <span className="text-aux text-success">{notice}</span>}
                  {detail.status === "archived" && <Badge variant="secondary">已归档</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label="删除提示"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="flex h-full flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="detail-title">标题</Label>
                    <Input
                      id="detail-title"
                      value={editorTitle}
                      onChange={(event) => setEditorTitle(event.target.value)}
                      placeholder="标题（可选）"
                    />
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                    <Label htmlFor="detail-content">正文</Label>
                    <Textarea
                      id="detail-content"
                      value={editorContent}
                      onChange={(event) => setEditorContent(event.target.value)}
                      rows={8}
                      className="min-h-0 flex-1 resize-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="mb-1 text-muted-foreground">绑定 Agent</Label>
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
                    {editorBindings.length > 0 && (
                      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-0.5">
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
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5">
                {detailError ? (
                  <span className="text-aux text-destructive" role="alert">
                    {detailError}
                  </span>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
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
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-aux text-muted-foreground">
                {emptyState ? "从左侧新建第一条提示" : "从列表选择一条提示"}
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
