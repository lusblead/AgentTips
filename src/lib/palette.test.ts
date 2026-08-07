import { describe, expect, it } from "vitest";
import { NOTE_COLORS, isNoteColorKey, noteColorClass } from "./palette";

describe("Note Palette", () => {
  it("包含恰好 10 种正式颜色", () => {
    expect(NOTE_COLORS).toHaveLength(10);
    expect(new Set(NOTE_COLORS).size).toBe(10);
  });

  it("所有颜色生成合法 Tailwind 类名", () => {
    for (const color of NOTE_COLORS) {
      expect(noteColorClass(color)).toMatch(/^bg-note-[a-z]+$/);
      expect(isNoteColorKey(color)).toBe(true);
    }
  });

  it("白色/透明/surface-primary 不属于 Palette", () => {
    expect(isNoteColorKey("white")).toBe(false);
    expect(isNoteColorKey("transparent")).toBe(false);
    expect(isNoteColorKey("surface-primary")).toBe(false);
  });
});
