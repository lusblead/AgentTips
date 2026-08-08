import { useMemo, useState } from "react";
import { Hash, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { mergeTipTags, normalizeTagName } from "@/lib/tags";

export interface TagInputProps {
  tags: string[];
  suggestions: string[];
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onTagsChange: (tags: string[]) => void;
  onError?: (message: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
}

/** 自由输入标签；历史标签只作为可点击复用建议，不形成固定选项集合。 */
export function TagInput({
  tags,
  suggestions,
  inputValue,
  onInputValueChange,
  onTagsChange,
  onError,
  disabled,
  compact,
}: TagInputProps) {
  const [focused, setFocused] = useState(false);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedKeys = useMemo(
    () => new Set(tags.map((tag) => normalizeTagName(tag).toLocaleLowerCase())),
    [tags],
  );
  const visibleSuggestions = useMemo(() => {
    const query = normalizeTagName(inputValue).toLocaleLowerCase();
    return suggestions
      .filter((tag) => {
        const normalized = normalizeTagName(tag);
        const key = normalized.toLocaleLowerCase();
        return normalized && !selectedKeys.has(key) && (!query || key.includes(query));
      })
      .slice(0, 6);
  }, [inputValue, selectedKeys, suggestions]);
  const listOpen = focused && !suggestionsDismissed && visibleSuggestions.length > 0;

  const commit = (raw: string) => {
    const result = mergeTipTags(tags, raw, suggestions);
    if (result.error) {
      onError?.(result.error);
      return false;
    }
    onTagsChange(result.tags);
    onInputValueChange("");
    onError?.(null);
    setActiveIndex(0);
    setSuggestionsDismissed(true);
    return true;
  };

  const remove = (target: string) => {
    const key = normalizeTagName(target).toLocaleLowerCase();
    onTagsChange(tags.filter((tag) => normalizeTagName(tag).toLocaleLowerCase() !== key));
    onError?.(null);
  };

  return (
    <div className="relative min-w-0 flex-1" data-testid="tag-input">
      <div
        className={cn(
          "flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg bg-black/[0.035] px-2 py-1 focus-within:bg-black/[0.055]",
          compact ? "flex-nowrap overflow-x-auto" : "flex-wrap",
        )}
      >
        <Hash className="h-3.5 w-3.5 shrink-0 opacity-55" aria-hidden="true" />
        {tags.map((tag) => (
          <span
            key={tag.toLocaleLowerCase()}
            className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-black/[0.065] pl-2 pr-1 text-[11px] font-medium"
          >
            {tag}
            <button
              type="button"
              aria-label={`移除标签 ${tag}`}
              className="grid h-4 w-4 place-items-center rounded-full opacity-55 hover:bg-black/10 hover:opacity-100 focus:outline-none focus-visible:bg-black/10"
              disabled={disabled}
              onClick={() => remove(tag)}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          type="text"
          role="combobox"
          aria-label="添加标签"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls="tag-suggestions"
          autoComplete="off"
          value={inputValue}
          disabled={disabled}
          placeholder={tags.length === 0 ? "添加标签" : ""}
          className="h-5 min-w-[84px] flex-1 border-0 bg-transparent px-0 text-[12px] outline-none placeholder:opacity-55 focus:outline-none"
          onFocus={() => {
            setFocused(true);
            setSuggestionsDismissed(false);
            setActiveIndex(0);
          }}
          onClick={() => setSuggestionsDismissed(false)}
          onBlur={() => window.setTimeout(() => setFocused(false), 0)}
          onChange={(event) => {
            onInputValueChange(event.target.value);
            onError?.(null);
            setSuggestionsDismissed(false);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === "Enter") return;
            if (event.key === "ArrowDown" && listOpen) {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % visibleSuggestions.length);
              return;
            }
            if (event.key === "ArrowUp" && listOpen) {
              event.preventDefault();
              setActiveIndex(
                (current) => (current - 1 + visibleSuggestions.length) % visibleSuggestions.length,
              );
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const value = listOpen ? visibleSuggestions[activeIndex] : inputValue;
              if (value) commit(value);
              return;
            }
            if (event.key === "," || event.key === "，") {
              event.preventDefault();
              if (inputValue) commit(inputValue);
              return;
            }
            if (event.key === "Backspace" && !inputValue && tags.length > 0) {
              remove(tags[tags.length - 1]);
              return;
            }
            if (event.key === "Escape" && listOpen) {
              event.preventDefault();
              event.stopPropagation();
              setSuggestionsDismissed(true);
              setFocused(false);
            }
          }}
        />
      </div>

      {listOpen && (
        <div
          id="tag-suggestions"
          role="listbox"
          aria-label="以前使用过的标签"
          className="absolute bottom-full left-0 z-30 mb-1 max-h-40 min-w-44 overflow-y-auto rounded-lg border border-black/10 bg-surface-primary p-1 text-text-primary shadow-popover"
        >
          {visibleSuggestions.map((tag, index) => (
            <button
              key={tag.toLocaleLowerCase()}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-secondary-size focus:outline-none",
                index === activeIndex ? "bg-surface-hover" : "hover:bg-surface-hover",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(tag)}
            >
              <Hash className="h-3 w-3 text-text-muted" />
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
