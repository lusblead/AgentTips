import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "搜索标题和正文…",
  ariaLabel = "搜索便签",
}: SearchInputProps) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <Input
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8"
      />
      {value && (
        <button
          type="button"
          aria-label="清除搜索"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-text-muted hover:text-text-primary focus:outline-none focus-visible:bg-surface-hover"
          onClick={() => onChange("")}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
