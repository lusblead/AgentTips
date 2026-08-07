import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NoteLibraryWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

async function renderLibrary(api: MockDesktopApi) {
  const user = userEvent.setup();
  const view = render(<NoteLibraryWindow api={api} />);
  await screen.findByText("修改前解释调用链");
  return { user, view };
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "筛选" }));
}

async function openFirstTip(user: ReturnType<typeof userEvent.setup>) {
  const cards = screen.getAllByTestId("tip-card");
  await user.click(cards[0]);
  return screen.findByRole("dialog");
}

describe("主管理窗口（Home Experience）", () => {
  it("首页默认展示所有 Tip Card", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    const cards = screen.getAllByTestId("tip-card");
    expect(cards.length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText("修改前解释调用链")).toBeInTheDocument();
    expect(screen.getByText("提交信息要可检索")).toBeInTheDocument();
  });

  it("首页不存在永久 Agent Sidebar", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    expect(screen.queryByText("Agent", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /筛选 Cursor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选全部便签" })).not.toBeInTheDocument();
  });

  it("首页不存在永久 Inspector", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    expect(screen.queryByText("编辑提示")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("正文")).not.toBeInTheDocument();
  });

  it("Tip 使用 Grid 布局", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    const grid = screen.getByTestId("tip-grid");
    expect(grid).toBeInTheDocument();
    expect(grid.className).toContain("grid");
    expect(within(grid).getAllByTestId("tip-card").length).toBeGreaterThan(1);
  });

  it("多个 Tip 至少存在多个不同 pastel tone", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    const tones = new Set<string>();
    for (const card of screen.getAllByTestId("tip-card")) {
      const match = card.className.match(/bg-pastel-[a-z]+/);
      if (match) tones.add(match[0]);
    }
    expect(tones.size).toBeGreaterThanOrEqual(3);
  });

  it("同一 Tip 重渲染颜色稳定", async () => {
    const api = new MockDesktopApi();
    const { view } = await renderLibrary(api);
    const first = screen.getAllByTestId("tip-card")[0].className;
    view.unmount();
    render(<NoteLibraryWindow api={api} />);
    await screen.findByText("修改前解释调用链");
    const second = screen.getAllByTestId("tip-card")[0].className;
    expect(second).toBe(first);
  });

  it("点击 Tip 打开 Floating Editor", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const dialog = await openFirstTip(user);
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("标题")).toHaveValue("修改前解释调用链");
    expect(within(dialog).getByLabelText("正文")).toBeInTheDocument();
  });

  it("Esc 关闭 Editor", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    await openFirstTip(user);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("tip-grid")).toBeInTheDocument();
  });

  it("Editor dirty/clean 状态正确", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const dialog = await openFirstTip(user);
    expect(within(dialog).getByText("已保存")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "保存修改" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("标题"), " 已修改");
    expect(within(dialog).getByText("有未保存的修改")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存修改" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "还原" })).toBeInTheDocument();
  });

  it("Agent filter 在 Popover 内且过滤后 Grid 正确", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    await openFilters(user);
    const cursorFilter = await screen.findByRole("checkbox", { name: "筛选 Cursor" });
    await user.click(cursorFilter);
    expect(screen.getByText("修改前解释调用链")).toBeInTheDocument();
    expect(screen.getByText("不做无关重构")).toBeInTheDocument();
    expect(screen.queryByText("完成后运行全部测试")).not.toBeInTheDocument();
    const grid = screen.getByTestId("tip-grid");
    expect(grid).toBeInTheDocument();
  });

  it("Search 后 Grid 正确", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.type(screen.getByLabelText("搜索便签"), "测试");
    expect(screen.getByText("完成后运行全部测试")).toBeInTheDocument();
    expect(screen.queryByText("修改前解释调用链")).not.toBeInTheDocument();
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

  it("编辑并保存后 Grid 更新", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const dialog = await openFirstTip(user);
    const title = within(dialog).getByLabelText("标题");
    await user.clear(title);
    await user.type(title, "修改前先解释调用链");
    await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
    expect(await within(dialog).findByText("已保存")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByText("修改前先解释调用链")).toBeInTheDocument();
  });

  it("Editor 中删除后 Grid 更新", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    const dialog = await openFirstTip(user);
    await user.click(within(dialog).getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "删除提示" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    expect(screen.queryByText("修改前解释调用链")).not.toBeInTheDocument();
    expect(screen.getByText("完成后运行全部测试")).toBeInTheDocument();
  });

  it("删除失败时显示错误且保留 Editor", async () => {
    const api = new MockDesktopApi();
    api.setMockFailure("delete", true);
    const { user } = await renderLibrary(api);
    const dialog = await openFirstTip(user);
    await user.click(within(dialog).getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "删除提示" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/模拟删除失败/);
    expect(screen.getByText("修改前解释调用链")).toBeInTheDocument();
  });

  it("Agent 图标不使用字体 glyph", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    expect(document.body.textContent).not.toContain("⌘");
    expect(document.body.textContent).not.toContain("▣");
  });
});
