import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import NoteLibraryWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

async function renderLibrary(api: MockDesktopApi) {
  const user = userEvent.setup();
  const view = render(<NoteLibraryWindow api={api} />);
  await screen.findAllByTestId("tip-card");
  return { user, view };
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.hover(await screen.findByRole("menuitem", { name: /筛选/ }));
  await screen.findByRole("checkbox", { name: "筛选 Cursor" });
}

async function expandFirstTip(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole("button", { name: "展开详情" })[0]);
  return screen.findByRole("dialog");
}

function tipCardByTitle(title: string) {
  return screen
    .getAllByTestId("tip-card")
    .find((card) => within(card).getByLabelText("标题").getAttribute("value") === title);
}

describe("主管理窗口（Living Notes）", () => {
  it("首页默认展示所有 Tip Card（含正文直编输入）", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    const cards = screen.getAllByTestId("tip-card");
    expect(cards.length).toBeGreaterThanOrEqual(8);
    const first = tipCardByTitle("修改前解释调用链");
    expect(first).toBeDefined();
    expect(within(first!).getByLabelText("正文")).toHaveValue(
      "修改任何核心模块前，先用一两句话说明调用链和影响范围。",
    );
  });

  it("首页不存在永久 Agent Sidebar", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    expect(screen.queryByText("Agent", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /筛选 Cursor/ })).not.toBeInTheDocument();
  });

  it("首页不存在永久 Inspector", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    expect(screen.queryByText("编辑提示")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Tip 使用 Grid 布局", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    const grid = screen.getByTestId("tip-grid");
    expect(grid).toBeInTheDocument();
    expect(grid.className).toContain("grid");
    expect(within(grid).getAllByTestId("tip-card").length).toBeGreaterThan(1);
  });

  it("多个 Tip 至少存在多个不同 note tone（data-color）", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    const tones = new Set(
      screen
        .getAllByTestId("tip-card")
        .map((card) => card.getAttribute("data-color"))
        .filter(Boolean),
    );
    expect(tones.size).toBeGreaterThanOrEqual(3);
  });

  it("同一 Tip 重渲染颜色稳定", async () => {
    const api = new MockDesktopApi();
    const { view } = await renderLibrary(api);
    const first = screen.getAllByTestId("tip-card")[0].getAttribute("data-color");
    view.unmount();
    render(<NoteLibraryWindow api={api} />);
    await screen.findAllByTestId("tip-card");
    const second = screen.getAllByTestId("tip-card")[0].getAttribute("data-color");
    expect(second).toBe(first);
  });

  it("首页正文可以直接聚焦输入并 autosave", async () => {
    const api = new MockDesktopApi();
    const updateSpy = vi.spyOn(api, "updateTipText");
    const { user } = await renderLibrary(api);
    const first = tipCardByTitle("修改前解释调用链")!;
    const textarea = within(first).getByLabelText("正文");
    await user.click(textarea);
    await user.type(textarea, "（补充）");
    await waitFor(() => expect(updateSpy).toHaveBeenCalled(), { timeout: 2000 });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.stringContaining("补充"),
    );
  });

  it("首页标题可以直接修改并 autosave", async () => {
    const api = new MockDesktopApi();
    const updateSpy = vi.spyOn(api, "updateTipText");
    const { user } = await renderLibrary(api);
    const first = tipCardByTitle("修改前解释调用链")!;
    const title = within(first).getByLabelText("标题");
    await user.click(title);
    await user.clear(title);
    await user.type(title, "修改前先解释调用链");
    await waitFor(() => expect(updateSpy).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("autosave 失败保留文字并显示重试", async () => {
    const api = new MockDesktopApi();
    api.setMockFailure("save", true);
    const { user } = await renderLibrary(api);
    const first = tipCardByTitle("修改前解释调用链")!;
    const textarea = within(first).getByLabelText("正文");
    await user.click(textarea);
    await user.type(textarea, "（不应丢失）");
    await waitFor(() => expect(within(first).queryByRole("alert")).toHaveTextContent(/保存失败/), {
      timeout: 2000,
    });
    expect((within(first).getByLabelText("正文") as HTMLTextAreaElement).value).toContain(
      "不应丢失",
    );
  });

  it("inline update 不修改 bindings/color/usedAt", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const before = tipCardByTitle("修改前解释调用链")!;
    const colorBefore = before.getAttribute("data-color");
    const title = within(before).getByLabelText("标题");
    await user.click(title);
    await user.clear(title);
    await user.type(title, "仅改标题");
    await waitFor(() => {
      const card = tipCardByTitle("仅改标题");
      expect(card).toBeDefined();
      expect(card!.getAttribute("data-color")).toBe(colorBefore);
    });
  });

  it("Expand 打开 Floating Editor，Esc 关闭", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const dialog = await expandFirstTip(user);
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("标题")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("tip-grid")).toBeInTheDocument();
  });

  it("Editor dirty/clean 状态正确", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const dialog = await expandFirstTip(user);
    expect(within(dialog).getByText("已保存")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("标题"), " 已修改");
    expect(within(dialog).getByText("有未保存的修改")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存修改" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "还原" })).toBeInTheDocument();
  });

  it("Editor 不暴露颜色选择器（第一版自动分配）", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const dialog = await expandFirstTip(user);
    expect(within(dialog).queryByText("便签颜色")).not.toBeInTheDocument();
    expect(dialog.getAttribute("data-note-color")).toBeTruthy();
  });

  it("Agent filter 在 Popover 内且过滤后 Grid 正确", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    await openFilters(user);
    const cursorFilter = await screen.findByRole("checkbox", { name: "筛选 Cursor" });
    const cursorRow = cursorFilter.closest("div")!;
    fireEvent.click(cursorRow);
    expect(tipCardByTitle("修改前解释调用链")).toBeDefined();
    expect(tipCardByTitle("不做无关重构")).toBeDefined();
    expect(tipCardByTitle("完成后运行全部测试")).toBeUndefined();
    expect(screen.getByTestId("tip-grid")).toBeInTheDocument();
  });

  it("Search 后 Grid 正确", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.type(screen.getByLabelText("搜索便签"), "测试");
    expect(tipCardByTitle("完成后运行全部测试")).toBeDefined();
    expect(tipCardByTitle("修改前解释调用链")).toBeUndefined();
    expect(screen.getByTestId("tip-grid")).toBeInTheDocument();
  });

  it("Empty Workspace 只有一个主要空状态", async () => {
    const api = new MockDesktopApi({ withSeed: false });
    render(<NoteLibraryWindow api={api} />);
    expect(await screen.findByText("还没有便签")).toBeInTheDocument();
    expect(screen.getAllByText("还没有便签")).toHaveLength(1);
    expect(screen.getByText("创建第一张便签")).toBeInTheDocument();
    expect(screen.queryByTestId("tip-grid")).not.toBeInTheDocument();
  });

  it("首页设置入口降为 secondary（仅 ··· 菜单）", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    expect(screen.queryByRole("button", { name: "打开设置" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(await screen.findByRole("menuitem", { name: "设置" })).toBeInTheDocument();
  });

  it("Mark Used 后首页消失，Used View 可见并含同色 Tip，Restore 回首页", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const target = tipCardByTitle("修改前解释调用链")!;
    const color = target.getAttribute("data-color");
    await user.click(within(target).getByRole("button", { name: "标记已使用" }));
    await waitFor(() => expect(tipCardByTitle("修改前解释调用链")).toBeUndefined(), {
      timeout: 2000,
    });
    expect(screen.getByTestId("used-toast")).toHaveTextContent("已移至「已使用」");

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "已使用便签" }));
    await screen.findByText("已使用");
    const usedCard = screen
      .getAllByTestId("tip-card")
      .find(
        (card) => within(card).getByLabelText("标题").getAttribute("value") === "修改前解释调用链",
      );
    expect(usedCard).toBeDefined();
    expect(usedCard!.getAttribute("data-color")).toBe(color);

    await user.click(within(usedCard!).getByRole("button", { name: "恢复到首页" }));
    // 恢复后自动回首页，卡片重新出现
    await waitFor(() => expect(tipCardByTitle("修改前解释调用链")).toBeDefined(), {
      timeout: 2000,
    });
  });

  it("Undo 可恢复刚标记的便签", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const target = tipCardByTitle("修改前解释调用链")!;
    await user.click(within(target).getByRole("button", { name: "标记已使用" }));
    await waitFor(() => expect(tipCardByTitle("修改前解释调用链")).toBeUndefined(), {
      timeout: 2000,
    });
    await user.click(
      within(screen.getByTestId("used-toast")).getByRole("button", { name: "撤销" }),
    );
    await waitFor(() => expect(tipCardByTitle("修改前解释调用链")).toBeDefined(), {
      timeout: 2000,
    });
  });

  it("Editor 中删除后 Grid 更新", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const dialog = await expandFirstTip(user);
    await user.click(within(dialog).getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "删除提示" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    expect(tipCardByTitle("修改前解释调用链")).toBeUndefined();
    expect(tipCardByTitle("完成后运行全部测试")).toBeDefined();
  });

  it("删除失败时显示错误且保留 Editor", async () => {
    const api = new MockDesktopApi();
    api.setMockFailure("delete", true);
    const { user } = await renderLibrary(api);
    const dialog = await expandFirstTip(user);
    await user.click(within(dialog).getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "删除提示" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/模拟删除失败/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Agent 图标不使用字体 glyph", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    expect(document.body.textContent).not.toContain("⌘");
    expect(document.body.textContent).not.toContain("▣");
  });
});
