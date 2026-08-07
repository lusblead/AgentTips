import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Agent, TipSummary } from "@/desktop-api/contract";
import { AgentChip } from "./AgentChip";

export interface TipCardProps {
  tip: TipSummary;
  agents: Agent[];
  selected: boolean;
  onClick: () => void;
}

/**
 * 轻量列表项（非独立卡片）：标题 + 摘要 + Agent 元数据。
 * selected：accent-subtle 底 + 左侧 2px accent 指示条，不使用大面积高饱和蓝。
 */
export function TipCard({ tip, agents, selected, onClick }: TipCardProps) {
  const boundAgents = agents.filter((agent) => tip.agentIds.includes(agent.id));
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "relative w-full rounded-md px-3 py-2 text-left transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover",
        selected && "bg-surface-selected hover:bg-surface-selected",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity duration-[var(--duration-fast)]",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="flex items-center gap-2">
        <span className="truncate text-body font-medium">{tip.title || "无标题"}</span>
        {tip.status === "archived" && (
          <Badge variant="secondary" className="ml-auto text-caption">
            已归档
          </Badge>
        )}
      </div>
      <p className="mt-0.5 line-clamp-1 text-secondary-size text-text-muted">{tip.content}</p>
      {boundAgents.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {boundAgents.map((agent) => (
            <AgentChip key={agent.id} name={agent.name} kind={agent.kind} muted />
          ))}
        </div>
      )}
    </button>
  );
}
