import { describe, expect, it } from "vitest";
import { MAX_TIP_TAGS, mergeTipTags } from "./tags";

describe("mergeTipTags", () => {
  it("normalizes freeform tags and reuses the historical display name", () => {
    expect(mergeTipTags([], " #rust，代码   审查 ", ["Rust"]).tags).toEqual(["Rust", "代码 审查"]);
  });

  it("deduplicates case-insensitively", () => {
    expect(mergeTipTags(["Rust"], ["rust", "RUST"]).tags).toEqual(["Rust"]);
  });

  it("rejects overlong or excessive tags without partially changing selection", () => {
    const selected = ["已有"];
    expect(mergeTipTags(selected, "x".repeat(33))).toEqual({
      tags: selected,
      error: "标签不能超过 32 个字符",
    });
    const values = Array.from({ length: MAX_TIP_TAGS + 1 }, (_, index) => `tag-${index}`);
    expect(mergeTipTags([], values).error).toBe(`每条便签最多添加 ${MAX_TIP_TAGS} 个标签`);
  });
});
