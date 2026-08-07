import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Maximize2, RotateCcw } from "lucide-react";
import { noteStyle, noteTextSecondaryStyle } from "@/lib/palette";
import type { Agent, TipSummary } from "@/desktop-api/contract";

export interface TipCardProps {
  tip: TipSummary;
  agents: Agent[];
  onExpand: () => void;
  onTextChange: (id: string, title: string, content: string) => Promise<void>;
  onMarkUsed?: (id: string) => void;
  onRestoreUsed?: (id: string) => void;
  saving?: boolean;
  /** 已使用视图内允许恢复。 */
  usedView?: boolean;
  leaving?: boolean;
}

const MAX_AGENT_LABELS = 2;

/** 自动增长 textarea：高度跟随内容，内容越多卡片越高，不出现内部滚动条。 */
function AutoGrowTextarea({
  value,
  onChange,
  ariaLabel,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  onBlur?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      rows={1}
      className="w-full resize-none overflow-y-hidden break-words rounded-md border-none bg-transparent px-1 py-0.5 text-[13px] leading-relaxed outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none"
      style={noteTextSecondaryStyle()}
    />
  );
}

/**
 * 便签卡：首页上的"一张纸"，支持 WYSIWYG inline editing。
 * 单击标题/正文即可直接输入；650ms 无输入自动保存，blur 立即保存。
 */
export function TipCard({
  tip,
  agents,
  onExpand,
  onTextChange,
  onMarkUsed,
  onRestoreUsed,
  saving,
  usedView,
  leaving,
}: TipCardProps) {
  const [title, setTitle] = useState(tip.title);
  const [content, setContent] = useState(tip.content);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const latestRef = useRef({ title: tip.title, content: tip.content });

  const flush = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      latestRef.current = { title: nextTitle, content: nextContent };
      try {
        await onTextChange(tip.id, nextTitle, nextContent);
        setSaveError(null);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    },
    [onTextChange, tip.id],
  );

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush(value, content), 650);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush(title, value), 650);
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

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
    <div
      data-testid="tip-card"
      data-note-id={tip.id}
      data-note-color={tip.colorKey}
      data-color={tip.colorKey}
      style={noteStyle(tip.colorKey)}
      className={`group relative flex min-h-[168px] w-full flex-col rounded-[14px] p-3 shadow-[0_6px_18px_rgba(15,23,42,0.07)] transition-all duration-[160ms] hover:-translate-y-px hover:shadow-[0_10px_28px_rgba(15,23,42,0.10)] focus-within:shadow-[0_0_0_1px_rgba(36,48,68,0.10),0_10px_28px_rgba(15,23,42,0.10)] ${
        leaving ? "translate-y-[-4px] scale-[0.985] opacity-0" : ""
      }`}
    >
      {/* hover actions */}
      <div className="absolute right-2 top-2 z-10 flex gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-within:opacity-100">
        {usedView ? (
          <button
            type="button"
            aria-label="恢复到首页"
            className="rounded-md p-1 transition-colors hover:bg-black/10 focus:outline-none focus-visible:bg-black/10"
            onClick={() => onRestoreUsed?.(tip.id)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label="展开详情"
              className="rounded-md p-1 transition-colors hover:bg-black/10 focus:outline-none focus-visible:bg-black/10"
              onClick={onExpand}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="标记已使用"
              className="rounded-md p-1 transition-colors hover:bg-black/10 focus:outline-none focus-visible:bg-black/10"
              onClick={() => onMarkUsed?.(tip.id)}
            >
              <CircleCheck className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      <input
        aria-label="标题"
        value={title}
        onChange={(event) => handleTitleChange(event.target.value)}
        onBlur={() => flush(title, content)}
        placeholder="无标题"
        className="w-full break-words rounded-md border-none bg-transparent px-1 py-0.5 text-[15px] font-semibold outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none"
      />
      <AutoGrowTextarea
        value={content}
        onChange={handleContentChange}
        ariaLabel="正文"
        onBlur={() => void flush(title, content)}
      />

      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="line-clamp-1 text-[11px] opacity-70">{agentLabel}</span>
        {saving && <span className="text-[11px] opacity-70">保存中…</span>}
      </div>
      {saveError && (
        <div className="flex items-center gap-2 pt-1 text-[11px] text-danger" role="alert">
          <span className="truncate">保存失败 · 重试</span>
          <button
            type="button"
            className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80 focus:outline-none"
            onClick={() => void flush(latestRef.current.title, latestRef.current.content)}
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}

// 保留导出名兼容旧引用（内部实现已重构）
export { TipCard as NoteCard };
