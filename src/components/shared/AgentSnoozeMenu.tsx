import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const AGENT_SNOOZE_HOUR_OPTIONS = [1, 2, 4, 8, 24] as const;

interface AgentSnoozeMenuProps {
  compact?: boolean;
  pending: boolean;
  disabled?: boolean;
  buttonLabel?: string;
  ariaLabel?: string;
  menuLabel?: string;
  onSelect: (hours: number) => void;
}

export function AgentSnoozeMenu({
  compact = false,
  pending,
  disabled = false,
  buttonLabel = "稍后提醒",
  ariaLabel,
  menuLabel = "暂停当前 Agent",
  onSelect,
}: AgentSnoozeMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={compact ? "ghost" : "outline"}
          size={compact ? "icon" : "sm"}
          className={compact ? "h-6 w-6" : undefined}
          disabled={disabled || pending}
          aria-label={ariaLabel ?? (compact ? buttonLabel : undefined)}
        >
          <Clock3 className="h-3.5 w-3.5" />
          {!compact && (pending ? "处理中…" : buttonLabel)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {AGENT_SNOOZE_HOUR_OPTIONS.map((hours) => (
          <DropdownMenuItem key={hours} onSelect={() => onSelect(hours)}>
            {hours} 小时
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
