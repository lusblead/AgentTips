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

export function TipCard({ tip, agents, selected, onClick }: TipCardProps) {
  const boundAgents = agents.filter((agent) => tip.agentIds.includes(agent.id));
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-md border bg-card px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary/50 bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/15",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "h-4 w-1 shrink-0 rounded-full bg-primary transition-colors",
            selected ? "opacity-100" : "opacity-0",
          )}
        />
        <span className="truncate text-sm font-medium">{tip.title || "无标题"}</span>
        {tip.status === "archived" && (
          <Badge variant="secondary" className="ml-auto">
            已归档
          </Badge>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tip.content}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {boundAgents.map((agent) => (
          <AgentChip key={agent.id} name={agent.name} kind={agent.kind} muted />
        ))}
      </div>
    </button>
  );
}
