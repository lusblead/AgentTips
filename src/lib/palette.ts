import type { CSSProperties } from "react";
import type { NoteColorKey } from "@/desktop-api/contract";

/**
 * 正式 Note Palette（10 色）。颜色是 Tip 的永久属性：
 * 创建时由后端 suggestNoteColor() 分配并持久化。
 * 显式静态映射（style 属性），禁止依赖 Tailwind 动态类名拼接——
 * JIT 无法从模板字符串生成 bg-note-* 工具类。
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

/** LIGHT 模式固定 Palette（Note Surface 背景）。 */
export const NOTE_BG: Record<NoteColorKey, string> = {
  lemon: "#FFF0A6",
  apricot: "#FFD7B5",
  coral: "#FFC7C2",
  rose: "#F7C6DC",
  lavender: "#DECDFB",
  periwinkle: "#C9D6FF",
  sky: "#BFE4FF",
  aqua: "#BDEDE7",
  mint: "#C7EFD4",
  sage: "#DDEAB5",
};

/** DARK 模式固定映射（Note Surface 背景）。 */
export const NOTE_BG_DARK: Record<NoteColorKey, string> = {
  lemon: "#4A401F",
  apricot: "#493425",
  coral: "#482F30",
  rose: "#452D39",
  lavender: "#372E4D",
  periwinkle: "#2B3654",
  sky: "#254052",
  aqua: "#214541",
  mint: "#264334",
  sage: "#394329",
};

/** 显式静态样式映射：Note Surface 背景 + 文本色（light/dark 双套）。 */
export function noteStyle(color: NoteColorKey, dark = false): CSSProperties {
  return {
    backgroundColor: dark ? NOTE_BG_DARK[color] : NOTE_BG[color],
    color: dark ? "#F5F7FA" : "#243044",
  };
}

export function noteTextSecondaryStyle(dark = false): CSSProperties {
  return { color: dark ? "#C6CEDA" : "#5F6C80" };
}

export function isNoteColorKey(value: string): value is NoteColorKey {
  return (NOTE_COLORS as string[]).includes(value);
}
