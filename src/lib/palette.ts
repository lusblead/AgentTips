import type { NoteColorKey } from "@/desktop-api/contract";

/**
 * 正式 Note Palette（10 色）。颜色是 Tip 的永久属性：
 * 创建时由后端 suggestNoteColor() 分配，之后可在 Detailed Editor 修改，
 * 修改后持久化到 SQLite。任何 Tip 不得使用白色/透明作为 Note Surface。
 */
export const NOTE_COLORS: NoteColorKey[] = [
  "lemon",
  "apricot",
  "coral",
  "rose",
  "lavender",
  "periwinkle",
  "sky",
  "aqua",
  "mint",
  "sage",
];

export const NOTE_COLOR_LABELS: Record<NoteColorKey, string> = {
  lemon: "柠檬",
  apricot: "杏橙",
  coral: "珊瑚",
  rose: "玫瑰",
  lavender: "薰衣草",
  periwinkle: "长春花",
  sky: "天空",
  aqua: "水蓝",
  mint: "薄荷",
  sage: "鼠尾草",
};

/** Tailwind 类名：背景来自 globals.css 中 --note-* 语义 token。 */
export function noteColorClass(color: NoteColorKey): string {
  return `bg-note-${color}`;
}

export function isNoteColorKey(value: string): value is NoteColorKey {
  return (NOTE_COLORS as string[]).includes(value);
}
