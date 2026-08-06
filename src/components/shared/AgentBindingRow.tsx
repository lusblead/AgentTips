import { X } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export interface AgentBindingRowProps {
  agentName: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  onRemove: () => void;
}

/** 单个 Agent 绑定行：名称 + 默认携带开关 + 移除，避免重复展示 Agent 信息。 */
export function AgentBindingRow({
  agentName,
  checked,
  disabled,
  onCheckedChange,
  onRemove,
}: AgentBindingRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-1.5">
      <span className="truncate text-tip font-medium">{agentName}</span>
      <span className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1.5 text-aux text-muted-foreground">
          默认携带
          <Switch
            aria-label={`${agentName} 默认携带`}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onCheckedChange}
          />
        </label>
        <button
          type="button"
          aria-label={`移除 ${agentName}`}
          className="rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}
