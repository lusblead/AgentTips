import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Info,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TipCard } from "@/components/shared/TipCard";
import { desktopErrorMessage } from "@/desktop-api/contract";
import type { Agent, DesktopApi, TipDetail, TipSummary } from "@/desktop-api/contract";
import { NoteEditorDialog } from "./NoteEditorDialog";

export interface NoteLibraryWindowProps {
  api: DesktopApi;
  /** 从提醒窗口"查看全部"进入时的初始 Agent 过滤（active chip，可清除）。 */
  initialAgentId?: string;
  onNewTip?: () => void;
  onOpenSettings?: () => void;
}

interface UndoToast {
  tipId: string;
  title: string;
}

/**
 * Home Experience：打开即见"便签墙"（可变高度 Masonry）。
 * 首页便签支持 WYSIWYG inline editing + 650ms autosave；
 * Mark Used 后移入「已使用」独立视图，可 Restore 或 Undo。
 */
export default function NoteLibraryWindow({
  api,
  initialAgentId,
  onNewTip,
  onOpenSettings,
}: NoteLibraryWindowProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tips, setTips] = useState<TipSummary[]>([]);
  const [usedTips, setUsedTips] = useState<TipSummary[]>([]);
  const [view, setView] = useState<"home" | "used">("home");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(
    initialAgentId ? [initialAgentId] : [],
  );
  const [editingTip, setEditingTip] = useState<TipDetail | null>(null);
  const [toast, setToast] = useState<UndoToast | null>(null);
  const [leavingIds, setLeavingIds] = useState<string[]>([]);

  const loadTips = useCallback(
    async (used: boolean) => {
      setLoadError(null);
      try {
        const list = await api.listTips(used ? { used: true } : {});
        if (used) setUsedTips(list);
        else setTips(list);
      } catch (err) {
        setLoadError(desktopErrorMessage(err));
      }
    },
    [api],
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
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api
      .listTips(view === "used" ? { used: true } : {})
      .then((list) => {
        if (cancelled) return;
        if (view === "used") setUsedTips(list);
        else setTips(list);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(desktopErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, view]);

  // Cmd/Ctrl + F 展开搜索
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // Undo Toast 5 秒自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const sourceTips = view === "used" ? usedTips : tips;
  const filteredTips = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sourceTips.filter((tip) => {
      if (
        selectedAgentIds.length > 0 &&
        !tip.agentIds.some((id) => selectedAgentIds.includes(id))
      ) {
        return false;
      }
      if (needle) {
        return (
          tip.title.toLowerCase().includes(needle) || tip.content.toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [search, selectedAgentIds, sourceTips]);

  const hasActiveFilter = selectedAgentIds.length > 0;
  const emptyWorkspace = !loading && !loadError && sourceTips.length === 0;
  const noResults = !emptyWorkspace && filteredTips.length === 0;

  const toggleAgentFilter = (agentId: string) => {
    setSelectedAgentIds((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId],
    );
  };

  const clearFilters = () => {
    setSelectedAgentIds([]);
    setSearch("");
  };

  const openTip = useCallback(
    async (id: string) => {
      try {
        const tip = await api.getTip(id);
        if (tip) setEditingTip(tip);
      } catch (err) {
        setLoadError(desktopErrorMessage(err));
      }
    },
    [api],
  );

  const handleTextSaved = useCallback(
    async (id: string, title: string, content: string) => {
      const updated = await api.updateTipText(id, title, content);
      const patch = (tip: TipSummary): TipSummary => ({
        ...tip,
        title: updated.title,
        content: updated.content,
        updatedAt: updated.updatedAt,
      });
      setTips((current) => current.map((tip) => (tip.id === id ? patch(tip) : tip)));
      setUsedTips((current) => current.map((tip) => (tip.id === id ? patch(tip) : tip)));
    },
    [api],
  );

  const handleTipUpdated = useCallback((updated: TipDetail) => {
    const patch = (tip: TipSummary): TipSummary => ({
      ...tip,
      title: updated.title,
      content: updated.content,
      colorKey: updated.colorKey,
      agentIds: updated.bindings.map((b) => b.agentId),
      updatedAt: updated.updatedAt,
    });
    setTips((current) => current.map((tip) => (tip.id === updated.id ? patch(tip) : tip)));
    setUsedTips((current) => current.map((tip) => (tip.id === updated.id ? patch(tip) : tip)));
  }, []);

  const handleTipDeleted = useCallback((id: string) => {
    setTips((current) => current.filter((tip) => tip.id !== id));
    setUsedTips((current) => current.filter((tip) => tip.id !== id));
  }, []);

  const handleMarkUsed = useCallback(
    async (id: string) => {
      const tip = tips.find((t) => t.id === id);
      setLeavingIds((current) => [...current, id]);
      window.setTimeout(() => {
        setLeavingIds((current) => current.filter((x) => x !== id));
        setTips((current) => current.filter((t) => t.id !== id));
        setToast({ tipId: id, title: tip?.title ?? "便签" });
      }, 180);
      try {
        await api.markTipUsed(id);
        void loadTips(true);
      } catch (err) {
        setLoadError(desktopErrorMessage(err));
      }
    },
    [api, loadTips, tips],
  );

  const handleUndo = useCallback(async () => {
    if (!toast) return;
    const id = toast.tipId;
    setToast(null);
    try {
      await api.restoreTipUsed(id);
      setUsedTips((current) => current.filter((t) => t.id !== id));
      void loadTips(false);
    } catch (err) {
      setLoadError(desktopErrorMessage(err));
    }
  }, [api, loadTips, toast]);

  const handleRestoreUsed = useCallback(
    async (id: string) => {
      try {
        await api.restoreTipUsed(id);
        setUsedTips((current) => current.filter((t) => t.id !== id));
        setView("home");
        void loadTips(false);
      } catch (err) {
        setLoadError(desktopErrorMessage(err));
      }
    },
    [api, loadTips],
  );

  const renderToolbar = () => (
    <div className="flex items-center gap-1">
      {searchOpen ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            ref={searchRef}
            aria-label="搜索便签"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索便签…"
            className="h-8 w-64 pl-8 pr-8"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchOpen(false);
                setSearch("");
              }
            }}
          />
          {search && (
            <button
              type="button"
              aria-label="清除搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-text-muted hover:text-text-primary focus:outline-none focus-visible:bg-surface-hover"
              onClick={() => setSearch("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="搜索"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-4 w-4" />
        </Button>
      )}
      {view === "home" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="新建提示"
          onClick={onNewTip}
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="更多操作">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {view === "home" && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SlidersHorizontal className="h-4 w-4" />
                  筛选
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <p className="px-2 py-1 text-secondary-size font-medium text-text-muted">Agent</p>
                  {agents.map((agent) => {
                    const checked = selectedAgentIds.includes(agent.id);
                    return (
                      <div
                        key={agent.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-hover"
                        onClick={() => toggleAgentFilter(agent.id)}
                      >
                        <Checkbox
                          checked={checked}
                          aria-label={`筛选 ${agent.name}`}
                          className="pointer-events-none"
                        />
                        <span className="flex-1">{agent.name}</span>
                      </div>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1 text-left text-sm text-text-muted hover:bg-surface-hover focus:outline-none"
                    onClick={clearFilters}
                  >
                    清除全部筛选
                  </button>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => setView("used")}>
                <Archive className="h-4 w-4" />
                已使用便签
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={onOpenSettings}>
            <Settings className="h-4 w-4" />
            设置
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Info className="h-4 w-4" />
            关于
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <main
      className="flex h-screen flex-col overflow-hidden bg-surface-canvas text-text-primary"
      data-window="main"
      data-testid="main-layout"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {view === "used" ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 px-2"
                aria-label="返回首页"
                onClick={() => setView("home")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-page-title font-semibold tracking-tight">已使用</h2>
            </>
          ) : (
            <h2 className="text-page-title font-semibold tracking-tight">AgentTips</h2>
          )}
        </div>
        {renderToolbar()}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {hasActiveFilter && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-2.5">
            {selectedAgentIds.map((agentId) => {
              const agent = agents.find((a) => a.id === agentId);
              if (!agent) return null;
              return (
                <button
                  key={agentId}
                  type="button"
                  aria-label={`清除 ${agent.name} 筛选`}
                  className="flex items-center gap-1 rounded-full bg-surface-secondary px-2.5 py-1 text-secondary-size text-text-secondary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover"
                  onClick={() => toggleAgentFilter(agentId)}
                >
                  {agent.name}
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            <button
              type="button"
              className="px-1 text-secondary-size text-text-muted underline-offset-2 hover:underline focus:outline-none"
              onClick={clearFilters}
            >
              清除全部
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 p-4">
          {loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-body text-danger">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoading(true);
                  void loadTips(view === "used");
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </Button>
            </div>
          ) : loading && sourceTips.length === 0 ? (
            <p className="py-16 text-center text-secondary-size text-text-muted">加载中…</p>
          ) : emptyWorkspace ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-3 text-center"
              data-testid="empty-workspace"
            >
              <div className="rounded-full bg-surface-secondary p-4">
                <Plus className="h-6 w-6 text-text-muted" />
              </div>
              <p className="text-body font-semibold">
                {view === "used" ? "还没有已使用的便签" : "还没有便签"}
              </p>
              <p className="max-w-xs text-secondary-size text-text-muted">
                {view === "used"
                  ? "标记为已使用的便签会收进这里。"
                  : "随时记录你希望 Agent 记住的事情。"}
              </p>
              {view === "home" && (
                <>
                  <Button size="sm" onClick={onNewTip}>
                    <Plus className="h-4 w-4" />
                    创建第一张便签
                  </Button>
                  <p className="text-caption text-text-muted">
                    <kbd className="rounded-sm border border-border-default bg-surface-primary px-1 py-0.5 font-sans text-caption shadow-sm">
                      Ctrl
                    </kbd>
                    <span className="mx-0.5">+</span>
                    <kbd className="rounded-sm border border-border-default bg-surface-primary px-1 py-0.5 font-sans text-caption shadow-sm">
                      F12
                    </kbd>
                  </p>
                </>
              )}
            </div>
          ) : noResults ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-body font-medium">没有匹配的便签</p>
              <p className="text-secondary-size text-text-muted">换个关键词或清除筛选试试</p>
            </div>
          ) : (
            <MasonryGrid data-testid="tip-grid" className="pb-8" gap={14}>
              {filteredTips.map((tip) => (
                <TipCard
                  key={tip.id}
                  tip={tip}
                  agents={agents}
                  onExpand={() => void openTip(tip.id)}
                  onTextChange={handleTextSaved}
                  onMarkUsed={view === "home" ? (id) => void handleMarkUsed(id) : undefined}
                  onRestoreUsed={view === "used" ? (id) => void handleRestoreUsed(id) : undefined}
                  usedView={view === "used"}
                  leaving={leavingIds.includes(tip.id)}
                />
              ))}
            </MasonryGrid>
          )}
        </div>
      </div>

      <NoteEditorDialog
        tip={editingTip}
        agents={agents}
        api={api}
        onClose={() => setEditingTip(null)}
        onTipUpdated={handleTipUpdated}
        onTipDeleted={handleTipDeleted}
      />

      {toast && (
        <div
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border-default bg-surface-primary px-4 py-2 shadow-popover"
          role="status"
          data-testid="used-toast"
        >
          <span className="text-secondary-size text-text-primary">已移至「已使用」</span>
          <button
            type="button"
            className="text-secondary-size font-medium text-accent hover:text-accent-hover focus:outline-none"
            onClick={() => void handleUndo()}
          >
            撤销
          </button>
        </div>
      )}
    </main>
  );
}

/**
 * Variable-height Masonry：CSS Grid + ResizeObserver + grid-auto-rows。
 * 每张卡片按实际高度计算 span，短卡保持短、长卡向下生长。
 */
function MasonryGrid({
  children,
  className,
  gap = 14,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { gap?: number }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const rowUnit = 8;

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => {
      const cards = grid.querySelectorAll<HTMLElement>("[data-testid='tip-card']");
      cards.forEach((card) => {
        const height = card.getBoundingClientRect().height;
        const span = Math.max(1, Math.ceil((height + gap) / (rowUnit + gap)));
        card.style.gridRowEnd = `span ${span}`;
      });
    });
    observer.observe(grid);
    const cards = grid.querySelectorAll<HTMLElement>("[data-testid='tip-card']");
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [gap, children]);

  return (
    <div
      ref={gridRef}
      className={`grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start ${className ?? ""}`}
      style={{
        gridAutoRows: `${rowUnit}px`,
        gap: `${gap}px`,
        gridAutoFlow: "row dense",
      }}
      {...props}
    >
      {children}
    </div>
  );
}
