import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NoteLibraryWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

async function renderLibrary(api: MockDesktopApi) {
  const user = userEvent.setup();
  render(<NoteLibraryWindow api={api} />);
  await screen.findByText("修改前解释调用链");
  return { user };
}

describe("主管理窗口", () => {
  it("能展示 Mock 历史便签", async () => {
    const api = new MockDesktopApi();
    await renderLibrary(api);
    expect(screen.getByText("修改前解释调用链")).toBeInTheDocument();
    expect(screen.getByText("完成后运行全部测试")).toBeInTheDocument();
    expect(screen.getByText("已归档示例")).toBeInTheDocument();
  });

  it("能按 Agent 筛选", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    await user.click(screen.getByRole("button", { name: "筛选 Cursor" }));
    expect(screen.getByText("修改前解释调用链")).toBeInTheDocument();
    expect(screen.getByText("不做无关重构")).toBeInTheDocument();
    expect(screen.queryByText("完成后运行全部测试")).not.toBeInTheDocument();
  });

  it("能搜索", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    await user.type(screen.getByLabelText("搜索便签"), "测试");
    expect(await screen.findByText("完成后运行全部测试")).toBeInTheDocument();
    expect(screen.queryByText("修改前解释调用链")).not.toBeInTheDocument();
  });

  it("能展示空结果", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);
    await user.type(screen.getByLabelText("搜索便签"), "不存在的关键词xyz");
    expect(await screen.findByText("没有匹配的提示")).toBeInTheDocument();
  });

  it("能编辑和删除 Mock 数据", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderLibrary(api);

    await user.click(screen.getByText("修改前解释调用链"));
    const titleInput = await screen.findByLabelText("标题");
    await user.clear(titleInput);
    await user.type(titleInput, "修改前先解释调用链");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByText("修改前先解释调用链")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除提示" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    expect(screen.queryByText("修改前解释调用链")).not.toBeInTheDocument();
    expect(screen.getByText("完成后运行全部测试")).toBeInTheDocument();
  });

  it("有数据时默认选中第一条", async () => {
    const api = new MockDesktopApi();
    render(<NoteLibraryWindow api={api} />);
    await screen.findByText("修改前解释调用链");
    const titleInput = await screen.findByLabelText("标题");
    expect(titleInput).toHaveValue("修改前解释调用链");
  });

  it("完全无数据时只显示统一空状态", async () => {
    const api = new MockDesktopApi({ withSeed: false });
    render(<NoteLibraryWindow api={api} />);
    expect(await screen.findByText("还没有提示")).toBeInTheDocument();
    expect(screen.getByText(/Ctrl \+ F12/)).toBeInTheDocument();
    expect(screen.queryByText("从列表选择一条提示")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建提示" }).length).toBeGreaterThanOrEqual(1);
  });

  it("存在新建和设置入口", async () => {
    const api = new MockDesktopApi();
    render(<NoteLibraryWindow api={api} />);
    await screen.findByText("修改前解释调用链");
    expect(screen.getByRole("button", { name: "新建提示" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开设置" })).toBeInTheDocument();
  });

  it("删除失败时显示错误", async () => {
    const api = new MockDesktopApi();
    api.setMockFailure("delete", true);
    const { user } = await renderLibrary(api);
    await user.click(screen.getByText("修改前解释调用链"));
    await screen.findByLabelText("标题");
    await user.click(screen.getByRole("button", { name: "删除提示" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/模拟删除失败/);
    expect(screen.getByText("修改前解释调用链")).toBeInTheDocument();
  });
});
