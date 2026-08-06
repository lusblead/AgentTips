import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Agent } from "@/desktop-api/contract";
import { AgentChip } from "./AgentChip";

export interface AgentMultiSelectProps {
  agents: Agent[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** 是否在按钮上方展示已选 Agent 标签；绑定行由调用方渲染时可关闭。 */
  showSelected?: boolean;
}

export function AgentMultiSelect({
  agents,
  selectedIds,
  onChange,
  disabled,
  showSelected = true,
}: AgentMultiSelectProps) {
  const selected = agents.filter((agent) => selectedIds.includes(agent.id));
  return (
    <div className="flex flex-col gap-2">
      {showSelected && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((agent) => (
            <AgentChip
              key={agent.id}
              name={agent.name}
              kind={agent.kind}
              onRemove={
                disabled ? undefined : () => onChange(selectedIds.filter((id) => id !== agent.id))
              }
            />
          ))}
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="w-fit gap-2"
          >
            <Plus className="h-4 w-4" />
            添加 Agent
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>选择要绑定的 Agent</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {agents.map((agent) => {
            const checked = selectedIds.includes(agent.id);
            return (
              <DropdownMenuItem
                key={agent.id}
                onSelect={() => {
                  onChange(
                    checked
                      ? selectedIds.filter((id) => id !== agent.id)
                      : [...selectedIds, agent.id],
                  );
                }}
              >
                <span className={checked ? "text-foreground" : "opacity-0"}>
                  <Check className="h-4 w-4" />
                </span>
                <span className="flex-1">{agent.name}</span>
                <span className="text-xs text-muted-foreground">
                  {agent.kind === "terminal" ? "终端" : "桌面"}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
