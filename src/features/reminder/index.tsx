import { useCallback, useEffect, useState } from "react";
import { BellOff, Check, ChevronDown, ChevronUp, Copy, ExternalLink, X } from "lucide-react";
import { AgentSnoozeMenu } from "@/components/shared/AgentSnoozeMenu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  desktopErrorMessage,
  type DesktopApi,
  type ReminderPayloadDto,
} from "@/desktop-api/contract";
import { cn } from "@/lib/utils";

const MAX_VISIBLE = 5;

/** Copy All 稳定格式：[Title]\nBody\n---\n */
export function formatCopyAll(payload: ReminderPayloadDto): string {
  return payload.tips
    .map((tip) => {
      const title = tip.title?.trim() ? tip.title.trim() : "未命名提示";
      return `[${title}]\n\n${tip.body}`;
    })
    .join("\n\n---\n\n");
}

const DEMO_PAYLOAD: ReminderPayloadDto = {
  agentKey: "cursor",
  agentId: "10000000-0000-0000-0000-000000000001",
  agentDisplayName: "Cursor",
  generatedAt: "2026-08-08T09:00:00+00:00",
  tips: [
    {
      tipId: "demo-1",
      title: "修改前解释调用链",
      body: "先说明改动会影响哪些调用方，再动手修改。",
      colorKey: "lemon",
    },
    {
      tipId: "demo-2",
      title: "完成后运行全部测试",
      body: "提交前运行 pnpm test 与 cargo test。",
      colorKey: "mint",
    },
    {
      tipId: "demo-3",
      title: "不做无关重构",
      body: "只改与当前任务相关的代码。",
      colorKey: "sky",
    },
  ],
};

export interface ReminderWindowProps {
  api: DesktopApi;
  /** 浏览器调试用演示态；不传则使用真实事件 payload。 */
  demo?: "expanded" | "collapsed" | "empty";
  /** "打开 AgentTips"：由宿主负责打开主窗口并过滤 Agent。 */
  onOpenMain?: (agentId: string) => void;
}

/**
 * Agent 提醒窗口：一次聚合展示当前 Agent 的 Default Carry 便签。
 * - 真实路径：订阅 agenttips://reminder/show 事件（后端非激活展示），加载时兜底拉取 current payload；
 * - 只读/复制表面：无编辑、无 Mark Used、无自动发送；
 * - Dismiss 只隐藏本次提醒（不消耗冷却，由 Rust 权威决策）。
 */
export default function ReminderWindow({ api, demo, onOpenMain }: ReminderWindowProps) {
  const [payload, setPayload] = useState<ReminderPayloadDto | null>(() =>
    demo ? (demo === "empty" ? { ...DEMO_PAYLOAD, tips: [] } : DEMO_PAYLOAD) : null,
  );
  const [collapsed, setCollapsed] = useState(demo === "collapsed");
  const [dismissed, setDismissed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [copiedTipId, setCopiedTipId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    if (demo) {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    async function init() {
      // 先订阅（同步注册 handler），再兜底拉取，避免首帧事件丢失。
      try {
        unsubscribe = await api.subscribeReminderShow((next) => {
          if (cancelled) return;
          setPayload(next);
          setDismissed(false);
          setCollapsed(false);
          setLoadError(null);
          setActionError(null);
        });
      } catch (err) {
        if (!cancelled) setLoadError(desktopErrorMessage(err));
      }
      try {
        const current = await api.getCurrentReminderPayload();
        if (!cancelled && current) {
          setPayload(current);
          setDismissed(false);
          setCollapsed(false);
        }
      } catch {
        // 兜底拉取失败不阻塞事件订阅
      }
    }
    void init();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api, demo]);

  const copyText = useCallback(async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }, []);

  const handleSnooze = useCallback(
    async (hours: number) => {
      setSnoozing(true);
      setActionError(null);
      try {
        await api.snoozeReminder(hours);
        setDismissed(true);
      } catch (err) {
        setActionError(desktopErrorMessage(err));
        setCollapsed(false);
      } finally {
        setSnoozing(false);
      }
    },
    [api],
  );

  if (dismissed) {
    return null;
  }

  if (loadError) {
    return (
      <div
        className="flex h-screen items-center justify-center bg-surface-canvas p-4 text-text-primary"
        data-window="reminder"
        data-state="error"
      >
        <p className="text-secondary-size text-danger" role="alert">
          提醒加载失败：{loadError}
        </p>
      </div>
    );
  }

  if (!payload) {
    return (
      <div
        className="flex h-screen items-center justify-center bg-surface-canvas p-4 text-text-primary"
        data-window="reminder"
        data-state="loading"
      >
        <p className="text-secondary-size text-text-muted">正在准备提醒…</p>
      </div>
    );
  }

  if (payload.tips.length === 0) {
    return (
      <div
        className="flex h-screen items-center justify-center bg-surface-canvas p-4 text-text-primary"
        data-window="reminder"
        data-state="empty"
      >
        <Card className="animate-window-in w-full max-w-sm transition-all duration-[var(--duration-fast)]">
          <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
            <BellOff className="h-5 w-5 text-text-muted" aria-hidden />
            <p className="text-body font-medium">暂无携带便签</p>
            <p className="text-secondary-size text-text-muted">
              {payload.agentDisplayName} 当前没有默认携带的便签，无需打扰。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const visible = payload.tips.slice(0, MAX_VISIBLE);
  const hiddenCount = payload.tips.length - visible.length;
  const countLabel = `${payload.agentDisplayName} · ${payload.tips.length} 条提示`;

  if (collapsed) {
    return (
      <div
        className="flex h-screen items-start justify-end bg-transparent p-4"
        data-window="reminder"
        data-state="collapsed"
      >
        <Card className="animate-window-in shadow-lg transition-all duration-[var(--duration-fast)]">
          <CardHeader className="p-0">
            <div className="flex items-center gap-2 px-4 py-2">
              <span className="text-sm font-medium">{countLabel}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="展开提醒"
                onClick={() => setCollapsed(false)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <AgentSnoozeMenu
                compact
                pending={snoozing}
                onSelect={(hours) => void handleSnooze(hours)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="本次忽略"
                onClick={() => {
                  setDismissed(true);
                  void api.dismissReminder();
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen items-start justify-end bg-transparent p-4"
      data-window="reminder"
      data-state="expanded"
    >
      <Card
        className={cn(
          "animate-window-in flex max-h-[520px] w-full max-w-sm flex-col shadow-lg transition-all duration-[var(--duration-fast)]",
        )}
        role="dialog"
        aria-label={`${payload.agentDisplayName} 提醒`}
      >
        <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-2 space-y-0 border-b px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{payload.agentDisplayName}</span>
            <span className="shrink-0 text-xs text-text-muted">{payload.tips.length} 条提示</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="收起为胶囊"
              onClick={() => setCollapsed(true)}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="本次忽略"
              onClick={() => {
                setDismissed(true);
                void api.dismissReminder();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <div className="divide-y divide-border-subtle">
            {visible.map((tip, index) => (
              <div key={tip.tipId} className="py-2" data-tip-id={tip.tipId}>
                <div className="flex items-baseline gap-2">
                  <span className="text-caption text-text-muted">{index + 1}</span>
                  <p className="text-tip font-medium">{tip.title?.trim() || "未命名提示"}</p>
                </div>
                <div
                  className="mt-1 rounded-md px-3 py-2"
                  data-color-key={tip.colorKey}
                  style={{ backgroundColor: `var(--note-${tip.colorKey})` }}
                >
                  <p className="whitespace-pre-wrap text-body text-text-primary">{tip.body}</p>
                </div>
                <div className="mt-1.5 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-secondary-size"
                    onClick={async () => {
                      const text = tip.title?.trim()
                        ? `[${tip.title.trim()}]\n\n${tip.body}`
                        : tip.body;
                      await copyText(text);
                      setCopiedTipId(tip.tipId);
                      setCopiedAll(false);
                      setTimeout(() => setCopiedTipId(null), 1200);
                    }}
                  >
                    {copiedTipId === tip.tipId ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedTipId === tip.tipId ? "已复制" : "复制"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {hiddenCount > 0 && (
            <p className="px-1 pt-2 text-secondary-size text-text-muted">
              还有 {hiddenCount} 条已折叠，可滚动查看全部。
            </p>
          )}
        </CardContent>
        <div className="shrink-0 border-t border-border-subtle px-4 py-2">
          {actionError && (
            <p className="mb-2 text-secondary-size text-danger" role="alert">
              暂停提醒失败：{actionError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <AgentSnoozeMenu pending={snoozing} onSelect={(hours) => void handleSnooze(hours)} />
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await copyText(formatCopyAll(payload));
                setCopiedAll(true);
                setCopiedTipId(null);
                setTimeout(() => setCopiedAll(false), 1200);
              }}
            >
              {copiedAll ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedAll ? "已复制全部" : "复制全部"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenMain?.(payload.agentId)}>
              <ExternalLink className="h-3.5 w-3.5" />
              打开 AgentTips
            </Button>
            <span className="ml-auto text-caption text-text-muted/70">不会自动发送给 Agent</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
