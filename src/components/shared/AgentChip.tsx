import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentKind } from "@/desktop-api/contract";

export interface AgentChipProps {
  name: string;
  kind: AgentKind;
  onRemove?: () => void;
  muted?: boolean;
}

export function AgentChip({ name, kind, onRemove, muted }: AgentChipProps) {
  return (
    <Badge
      variant="secondary"
      className={muted ? "opacity-70" : ""}
      title={kind === "terminal" ? "终端 Agent" : "桌面 Agent"}
    >
      <span aria-hidden className="text-muted-foreground">
        {kind === "terminal" ? "⌘" : "▣"}
      </span>
      {name}
      {onRemove && (
        <button
          type="button"
          aria-label={`移除 ${name}`}
          className="rounded-sm hover:bg-muted-foreground/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}
