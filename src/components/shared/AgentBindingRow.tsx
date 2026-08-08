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
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-primary px-3 py-1.5">
      <span className="truncate text-tip font-medium">{agentName}</span>
      <span className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1.5 text-aux text-text-muted">
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
          className="rounded-sm text-text-muted hover:text-text-primary focus:outline-none focus-visible:bg-surface-hover"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}
