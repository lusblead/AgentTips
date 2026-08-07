import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}
    >
      <div className="rounded-full bg-surface-secondary p-3">
        <Inbox className="h-6 w-6 text-text-muted" />
      </div>
      <p className="text-body font-medium">{title}</p>
      {description && <p className="max-w-xs text-secondary-size text-text-muted">{description}</p>}
      {action}
    </div>
  );
}
