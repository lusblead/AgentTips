import { Badge } from "@/components/ui/badge";
import { pastelClass, pastelForTip } from "@/lib/palette";
import type { Agent, TipSummary } from "@/desktop-api/contract";

export interface TipCardProps {
  tip: TipSummary;
  agents: Agent[];
  onClick: () => void;
}

const MAX_AGENT_LABELS = 2;

/**
 * 便签卡：pastel 底 + subtle shadow + radius 建立层次，无数据库 row 感。
 * 颜色由 Tip id 稳定映射；Agent 仅作为低权重 metadata。
 */
export function TipCard({ tip, agents, onClick }: TipCardProps) {
  const tone = pastelForTip(tip.id);
  const boundAgents = agents.filter((agent) => tip.agentIds.includes(agent.id));
  const visibleAgents = boundAgents.slice(0, MAX_AGENT_LABELS);
  const hiddenCount = boundAgents.length - visibleAgents.length;

  const agentLabel = [
    ...visibleAgents.map((agent) => agent.name),
    hiddenCount > 0 ? `+${hiddenCount}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-[190px] w-full flex-col rounded-lg ${pastelClass(tone)} p-3 text-left text-text-primary shadow-floating transition-all duration-[150ms] hover:-translate-y-px hover:shadow-popover focus:outline-none focus-visible:shadow-popover focus-visible:ring-1 focus-visible:ring-accent-ring`}
      data-testid="tip-card"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-body font-semibold leading-snug">
          {tip.title || "无标题"}
        </span>
        {tip.status === "archived" && (
          <Badge variant="secondary" className="shrink-0 text-caption">
            已归档
          </Badge>
        )}
      </div>
      <p className="mt-2 line-clamp-4 text-secondary-size leading-relaxed text-text-secondary">
        {tip.content}
      </p>
      <span className="mt-auto line-clamp-1 text-caption text-text-muted">{agentLabel}</span>
    </button>
  );
}
