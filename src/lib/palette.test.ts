import { describe, expect, it } from "vitest";
import { NOTE_BG, NOTE_COLORS, isNoteColorKey, noteStyle } from "./palette";

describe("Note Palette", () => {
  it("包含恰好 10 种正式颜色", () => {
    expect(NOTE_COLORS).toHaveLength(10);
    expect(new Set(NOTE_COLORS).size).toBe(10);
  });

  it("所有颜色生成显式静态样式", () => {
    for (const color of NOTE_COLORS) {
      const style = noteStyle(color);
      expect(style.backgroundColor).toMatch(/^#[0-9A-F]{6}$/i);
      expect(NOTE_BG[color]).toBe(style.backgroundColor);
      expect(isNoteColorKey(color)).toBe(true);
    }
  });

  it("LIGHT Palette 是任务指定的 10 个 hex", () => {
    expect(NOTE_BG).toEqual({
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
    });
  });

  it("白色/透明/surface-primary 不属于 Palette", () => {
    expect(isNoteColorKey("white")).toBe(false);
    expect(isNoteColorKey("transparent")).toBe(false);
    expect(isNoteColorKey("surface-primary")).toBe(false);
  });
});
