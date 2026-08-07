import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

type StatusFilter = "all" | "active" | "archived";

/**
 * Home Experience：打开即见"便签墙"。
 * Toolbar（AgentTips / Search / + / ···）+ Tip Grid + Floating Editor。
 * Agent 仅为 metadata，筛选在 Popover，无永久 Sidebar / Inspector。
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

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(
    initialAgentId ? [initialAgentId] : [],
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [editingTip, setEditingTip] = useState<TipDetail | null>(null);

  const loadTips = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await api.listTips({});
      setTips(list);
    } catch (err) {
      setLoadError(desktopErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

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
      .listTips({})
      .then((list) => {
        if (!cancelled) setTips(list);
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
    if (searchOpen) {
      searchRef.current?.focus();
    }
  }, [searchOpen]);

  const filteredTips = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tips.filter((tip) => {
      if (
        selectedAgentIds.length > 0 &&
        !tip.agentIds.some((id) => selectedAgentIds.includes(id))
      ) {
        return false;
      }
      if (statusFilter !== "all" && tip.status !== statusFilter) {
        return false;
      }
      if (needle) {
        return (
          tip.title.toLowerCase().includes(needle) || tip.content.toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [search, selectedAgentIds, statusFilter, tips]);

  const hasActiveFilter = selectedAgentIds.length > 0 || statusFilter !== "all";
  const hasSearch = search.trim().length > 0;
  const emptyWorkspace = !loading && !loadError && tips.length === 0;
  const noResults = !emptyWorkspace && filteredTips.length === 0;

  const toggleAgentFilter = (agentId: string) => {
    setSelectedAgentIds((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId],
    );
  };

  const clearFilters = () => {
    setSelectedAgentIds([]);
    setStatusFilter("all");
    setSearch("");
  };

  const openTip = useCallback(
    async (id: string) => {
      try {
        const tip = await api.getTip(id);
        if (tip) {
          setEditingTip(tip);
        }
      } catch (err) {
        setLoadError(desktopErrorMessage(err));
      }
    },
    [api],
  );

  const handleTipUpdated = (updated: TipDetail) => {
    setTips((current) =>
      current.map((tip) =>
        tip.id === updated.id
          ? {
              ...tip,
              title: updated.title,
              content: updated.content,
              agentIds: updated.bindings.map((b) => b.agentId),
              updatedAt: updated.updatedAt,
            }
          : tip,
      ),
    );
  };

  const handleTipDeleted = (id: string) => {
    setTips((current) => {
      const next = current.filter((tip) => tip.id !== id);
      if (next.length === 0) {
        // 全部删除后回到干净的 Empty Workspace
        setSearch("");
        setSearchOpen(false);
        setSelectedAgentIds([]);
        setStatusFilter("all");
      }
      return next;
    });
  };

  return (
    <main
      className="flex h-screen flex-col overflow-hidden bg-surface-canvas text-text-primary"
      data-window="main"
      data-testid="main-layout"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-2">
        <h2 className="text-page-title font-semibold tracking-tight">AgentTips</h2>
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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="新建提示"
            onClick={onNewTip}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="筛选"
                data-active={hasActiveFilter ? "true" : undefined}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1.5 text-secondary-size font-medium text-text-muted">Agent</p>
                  <div className="flex flex-col gap-1">
                    {agents.map((agent) => {
                      const checked = selectedAgentIds.includes(agent.id);
                      return (
                        <label
                          key={agent.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-hover"
                        >
                          <Checkbox
                            checked={checked}
                            aria-label={`筛选 ${agent.name}`}
                            onCheckedChange={() => toggleAgentFilter(agent.id)}
                          />
                          <span className="flex-1">{agent.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-secondary-size font-medium text-text-muted">状态</p>
                  <div className="flex flex-col gap-1">
                    {(
                      [
                        ["all", "全部"],
                        ["active", "使用中"],
                        ["archived", "已归档"],
                      ] as Array<[StatusFilter, string]>
                    ).map(([value, label]) => {
                      const active = statusFilter === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover"
                          onClick={() => setStatusFilter(value)}
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded-sm border ${
                              active
                                ? "border-accent bg-accent text-primary-foreground"
                                : "border-border-default"
                            }`}
                          >
                            {active && <Check className="h-3 w-3" />}
                          </span>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="h-px bg-border-subtle" />
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  清除全部筛选
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="更多操作">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={onOpenSettings}>
                <Settings className="h-4 w-4" />
                设置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <Archive className="h-4 w-4" />
                归档
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Info className="h-4 w-4" />
                关于
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
            {statusFilter !== "all" && (
              <button
                type="button"
                aria-label="清除状态筛选"
                className="flex items-center gap-1 rounded-full bg-surface-secondary px-2.5 py-1 text-secondary-size text-text-secondary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover"
                onClick={() => setStatusFilter("all")}
              >
                {statusFilter === "active" ? "使用中" : "已归档"}
                <X className="h-3 w-3" />
              </button>
            )}
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
                  void loadTips();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </Button>
            </div>
          ) : loading && tips.length === 0 ? (
            <p className="py-16 text-center text-secondary-size text-text-muted">加载中…</p>
          ) : emptyWorkspace ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-3 text-center"
              data-testid="empty-workspace"
            >
              <div className="rounded-full bg-surface-secondary p-4">
                <Plus className="h-6 w-6 text-text-muted" />
              </div>
              <p className="text-body font-semibold">还没有便签</p>
              <p className="max-w-xs text-secondary-size text-text-muted">
                随时记录你希望 Agent 记住的事情。
              </p>
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
            </div>
          ) : noResults ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-body font-medium">
                {hasSearch || hasActiveFilter ? "没有匹配的便签" : "还没有便签"}
              </p>
              <p className="text-secondary-size text-text-muted">
                {hasSearch || hasActiveFilter ? "换个关键词或清除筛选试试" : ""}
              </p>
            </div>
          ) : (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 pb-8"
              data-testid="tip-grid"
            >
              {filteredTips.map((tip) => (
                <TipCard
                  key={tip.id}
                  tip={tip}
                  agents={agents}
                  onClick={() => void openTip(tip.id)}
                />
              ))}
            </div>
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
    </main>
  );
}
