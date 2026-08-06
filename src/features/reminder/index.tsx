import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { DesktopApi, ReminderPreview } from "@/desktop-api/contract";
import { cn } from "@/lib/utils";

const MAX_VISIBLE = 3;

export interface ReminderWindowProps {
  api: DesktopApi;
  /** 浏览器调试用演示态；不传则使用 Mock 数据默认态。 */
  demo?: "expanded" | "collapsed" | "empty";
  /** "查看全部"：由宿主（App 层）负责打开主窗口并过滤 Agent。 */
  onOpenMain?: (agentId: string) => void;
}

/**
 * Agent 提醒窗口：一次聚合展示当前 Agent 的携带便签，不抢焦点、不是模态框。
 * 支持展开 / 收起为胶囊 / 本次忽略。无便签时显示安静提示，不弹错误。
 */
export default function ReminderWindow({ api, demo, onOpenMain }: ReminderWindowProps) {
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [collapsed, setCollapsed] = useState(demo === "collapsed");
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getReminderPreview()
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (dismissed) {
    return null;
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-4 text-foreground">
        <p className="text-sm text-destructive" role="alert">
          提醒加载失败：{error}
        </p>
      </div>
    );
  }

  if (!preview) {
    return null;
  }

  const empty = demo === "empty" || preview.tips.length === 0;
  if (empty) {
    return (
      <div
        className="flex h-screen items-center justify-center bg-background p-4 text-foreground"
        data-window="reminder"
        data-state="empty"
      >
        <Card className="animate-window-in w-full max-w-sm transition-all duration-[var(--duration-fast)]">
          <CardContent className="py-6 text-center">
            <p className="text-sm font-medium">暂无携带便签</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {preview.agent.name} 当前没有默认携带的便签，无需打扰。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const visible = preview.tips.slice(0, MAX_VISIBLE);
  const hiddenCount = preview.tips.length - visible.length;

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
              <span className="text-sm font-medium">
                {preview.agent.name} · {preview.tips.length} 条提示
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="展开提醒"
                onClick={() => setCollapsed(false)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="本次忽略"
                onClick={() => setDismissed(true)}
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
          "animate-window-in w-full max-w-sm shadow-lg transition-all duration-[var(--duration-fast)]",
        )}
        role="dialog"
        aria-label={`${preview.agent.name} 提醒`}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{preview.agent.name}</span>
            <span className="text-xs text-muted-foreground">{preview.tips.length} 条提示</span>
          </div>
          <div className="flex items-center gap-1">
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
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 py-2">
          <div className="divide-y">
            {visible.map((tip, index) => (
              <div key={tip.id} className="py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] text-muted-foreground">{index + 1}</span>
                  <p className="text-tip font-medium">{tip.title}</p>
                </div>
                <p className="mt-0.5 line-clamp-2 pl-5 text-aux text-muted-foreground">
                  {tip.content}
                </p>
              </div>
            ))}
          </div>
          {hiddenCount > 0 && (
            <p className="px-1 pt-2 text-aux text-muted-foreground">
              还有 {hiddenCount} 条已折叠，点击“查看全部”浏览。
            </p>
          )}
          <div className="flex items-center gap-2 py-2">
            <Button variant="outline" size="sm" onClick={() => onOpenMain?.(preview.agent.id)}>
              <ExternalLink className="h-3.5 w-3.5" />
              查看全部
            </Button>
            <span className="ml-auto text-[11px] text-muted-foreground/70">
              不会自动发送给 Agent
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
