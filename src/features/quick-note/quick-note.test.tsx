import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import QuickNoteWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

async function renderQuickNote(api: MockDesktopApi) {
  const onClose = vi.fn();
  const view = render(<QuickNoteWindow api={api} onClose={onClose} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "添加 Agent" });
  return { user, onClose, unmount: view.unmount };
}

async function selectAgent(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: /添加 Agent/ }));
  await user.click(await screen.findByRole("menuitem", { name: new RegExp(name) }));
}

describe("快捷新建窗口", () => {
  it("renders a compact frameless note without a title control", async () => {
    const api = new MockDesktopApi();
    await renderQuickNote(api);

    expect(screen.queryByLabelText("标题")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加标题" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ctrl")).not.toBeInTheDocument();
    expect(screen.queryByText("Enter")).not.toBeInTheDocument();
    expect(screen.queryByText("Esc")).not.toBeInTheDocument();
    expect(screen.queryByText("可选")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();

    const body = screen.getByLabelText("正文");
    expect(body).toHaveClass("border-0", "rounded-none", "bg-transparent");
    expect((body as HTMLTextAreaElement).style.borderStyle).toBe("none");
    expect((body as HTMLTextAreaElement).style.borderRadius).toBe("0px");
    expect((body as HTMLTextAreaElement).style.boxShadow).toBe("none");
    expect(screen.getByTestId("note-surface")).toContainElement(body);
    expect(screen.getByTestId("quick-note-actions")).toBeInTheDocument();
  });

  it("初次进入内容为空", async () => {
    const api = new MockDesktopApi();
    await renderQuickNote(api);
    expect(screen.getByLabelText("正文")).toHaveValue("");
  });

  it("不显示历史便签", async () => {
    const api = new MockDesktopApi();
    await renderQuickNote(api);
    expect(screen.queryByText("修改前解释调用链")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("空内容不能保存", async () => {
    const api = new MockDesktopApi();
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();
    await user.click(save);
    await waitFor(() => expect(createSpy).not.toHaveBeenCalled());
  });

  it("content-only draft can be saved without an Agent", async () => {
    const api = new MockDesktopApi();
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "先记录，稍后再绑定 Agent");
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0][0].bindings).toEqual([]);
    expect(createSpy.mock.calls[0][0].tags).toEqual([]);
  });

  it("选择多个 Agent 后能够提交", async () => {
    const api = new MockDesktopApi();
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "一条新便签");
    await selectAgent(user, "Cursor");
    await selectAgent(user, "Claude Code");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const input = createSpy.mock.calls[0][0];
    expect(input.bindings).toHaveLength(2);
    expect(input.bindings.map((b: { agentId: string }) => b.agentId).sort()).toEqual(
      ["agent-claude-code", "agent-cursor"].sort(),
    );
  });

  it("submits and persists no title", async () => {
    const api = new MockDesktopApi();
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "正文首行也不是标题");
    await selectAgent(user, "Cursor");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0][0]).not.toHaveProperty("title");
    const created = (await api.listTips()).find((tip) => tip.content === "正文首行也不是标题");
    expect(created?.title).toBe("");
  });

  it("supports freeform tags and reusable tag suggestions", async () => {
    const api = new MockDesktopApi();
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "带标签的便签");

    const tagInput = screen.getByRole("combobox", { name: "添加标签" });
    await user.click(tagInput);
    await user.click(await screen.findByRole("option", { name: "测试" }));
    await user.click(tagInput);
    await user.type(tagInput, "个人规则{Enter}");

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0][0].tags).toEqual(["测试", "个人规则"]);
  });

  it("saves pending tag input without requiring Enter", async () => {
    const api = new MockDesktopApi();
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "直接保存标签输入");
    await user.type(screen.getByRole("combobox", { name: "添加标签" }), "稍后整理");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0][0].tags).toEqual(["稍后整理"]);
  });

  it("tag suggestion failure keeps freeform input available", async () => {
    const api = new MockDesktopApi();
    vi.spyOn(api, "listTags").mockRejectedValue(new Error("标签查询失败"));
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "建议失败也能保存");
    const tagInput = screen.getByRole("combobox", { name: "添加标签" });
    await user.type(tagInput, "仍可手写{Enter}");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0][0].tags).toEqual(["仍可手写"]);
  });

  it("Agent 每个只显示一次", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderQuickNote(api);
    await selectAgent(user, "Cursor");
    expect(screen.getAllByText("Cursor", { exact: true })).toHaveLength(1);
  });

  it("Ctrl+Enter 触发一次提交", async () => {
    const api = new MockDesktopApi();
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "快捷键保存");
    await selectAgent(user, "Cursor");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
  });

  it("连续按键不会重复提交", async () => {
    const api = new MockDesktopApi();
    api.setSaveDelay(80);
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "防重复");
    await selectAgent(user, "Cursor");
    await user.keyboard("{Control>}{Enter}{Enter}{/Control}");
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
  });

  it("Mock 失败后保留正文并显示错误", async () => {
    const api = new MockDesktopApi();
    api.setMockFailure("save", true);
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "不应丢失的内容");
    await user.type(screen.getByRole("combobox", { name: "添加标签" }), "不能丢的标签{Enter}");
    await selectAgent(user, "Cursor");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/模拟保存失败/);
    expect(screen.getByLabelText("正文")).toHaveValue("不应丢失的内容");
    expect(screen.getByText("不能丢的标签")).toBeInTheDocument();
  });

  it("long save errors remain fully readable", async () => {
    const api = new MockDesktopApi();
    const message = "数据库暂时不可用，请检查本地数据目录权限后重试。".repeat(5);
    vi.spyOn(api, "createTip").mockRejectedValueOnce(new Error(message));
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "需要保留的正文");
    await user.click(screen.getByRole("button", { name: "保存" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveClass("overflow-y-auto", "break-words", "select-text");
    expect(alert).not.toHaveClass("truncate");
    expect(screen.getByLabelText("正文")).toHaveValue("需要保留的正文");
  });

  it("再次打开时仍然是新便签", async () => {
    const api = new MockDesktopApi();
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "旧内容");
    await selectAgent(user, "Cursor");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
    unmount();
    await renderQuickNote(api);
    expect(screen.getByLabelText("正文")).toHaveValue("");
  });

  it("有正文时保存 enabled，绑定 Agent 后仍可保存", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderQuickNote(api);
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("正文"), "正文内容");
    expect(save).toBeEnabled();
    await selectAgent(user, "Cursor");
    expect(save).toBeEnabled();
  });

  it("外层 Canvas 保持 neutral，Note Surface 使用 Palette 颜色", async () => {
    const api = new MockDesktopApi();
    await renderQuickNote(api);
    const main = screen.getByTestId("quick-note-shell");
    const surface = screen.getByTestId("note-surface");
    expect(main.className).toContain("bg-surface-canvas");
    const style = window.getComputedStyle(surface);
    expect(style.backgroundColor).toMatch(/^rgb\(/);
    expect(style.backgroundColor).not.toBe("rgb(255, 255, 255)");
    expect(style.backgroundColor).not.toBe("rgb(245, 247, 250)");
    expect(surface.getAttribute("data-color")).toBeTruthy();
  });

  it("Textarea 透明且 Note Surface 颜色来自 suggestNoteColor", async () => {
    const api = new MockDesktopApi();
    const suggestSpy = vi.spyOn(api, "suggestNoteColor");
    await renderQuickNote(api);
    expect(suggestSpy).toHaveBeenCalled();
    const textarea = screen.getByLabelText("正文");
    expect(textarea.className).toContain("bg-transparent");
  });

  it("每次重新打开 Quick Note 都会重新请求颜色", async () => {
    const api = new MockDesktopApi();
    const suggestSpy = vi.spyOn(api, "suggestNoteColor");
    const first = await renderQuickNote(api);
    first.unmount();
    const second = await renderQuickNote(api);
    expect(suggestSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    second.unmount();
  });

  it("保存成功后约 300ms 隐藏窗口并清空 Draft", async () => {
    const api = new MockDesktopApi();
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "保存后应清空");
    await selectAgent(user, "Cursor");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
    await waitFor(() => expect(hideSpy).toHaveBeenCalledWith("quick-note"), { timeout: 2000 });
    expect(screen.getByLabelText("正文")).toHaveValue("");
    unmount();
  });

  it("empty draft closes without confirmation", async () => {
    const api = new MockDesktopApi();
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "放弃这条便签？" })).not.toBeInTheDocument();
    expect(hideSpy).toHaveBeenCalledWith("quick-note");
    unmount();
  });

  it("Esc asks before discarding a non-empty draft", async () => {
    const api = new MockDesktopApi();
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "取消的内容");
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "放弃这条便签？" })).toBeVisible();
    expect(hideSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("正文")).toHaveValue("取消的内容");
    unmount();
  });

  it("tag-only draft asks before discarding", async () => {
    const api = new MockDesktopApi();
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByRole("combobox", { name: "添加标签" }), "未保存标签");
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "放弃这条便签？" })).toBeVisible();
    expect(hideSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("in-app close asks before discarding a non-empty draft", async () => {
    const api = new MockDesktopApi();
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "点击关闭也不能丢失");
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(await screen.findByRole("dialog", { name: "放弃这条便签？" })).toBeVisible();
    expect(hideSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("正文")).toHaveValue("点击关闭也不能丢失");
    unmount();
  });

  it("native close request asks before discarding a non-empty draft", async () => {
    const api = new MockDesktopApi();
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "系统标题栏关闭也要保护");
    api.simulateQuickNoteCloseRequested();
    expect(await screen.findByRole("dialog", { name: "放弃这条便签？" })).toBeVisible();
    expect(hideSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("正文")).toHaveValue("系统标题栏关闭也要保护");
    unmount();
  });

  it("discard confirmation clears and hides the draft", async () => {
    const api = new MockDesktopApi();
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "明确放弃的内容");
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "放弃内容" }));
    await waitFor(() => expect(hideSpy).toHaveBeenCalledWith("quick-note"));
    expect(screen.getByLabelText("正文")).toHaveValue("");
    unmount();
  });

  it("cancel discard keeps the draft", async () => {
    const api = new MockDesktopApi();
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    const textarea = screen.getByLabelText("正文");
    await user.type(textarea, "继续编辑的内容");
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "继续编辑" }));
    expect(hideSpy).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("继续编辑的内容");
    await waitFor(() => expect(textarea).toHaveFocus());
    unmount();
  });

  it("close during save keeps the window open", async () => {
    const api = new MockDesktopApi();
    api.setSaveDelay(200);
    const hideSpy = vi.spyOn(api, "hideCurrentWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "正在保存的内容");
    await user.click(screen.getByRole("button", { name: "保存" }));
    api.simulateQuickNoteCloseRequested();
    expect(screen.queryByRole("dialog", { name: "放弃这条便签？" })).not.toBeInTheDocument();
    expect(hideSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("正文")).toHaveValue("正在保存的内容");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
    unmount();
  });

  it("收到 reset 事件时清空 Draft 并重新请求颜色", async () => {
    const api = new MockDesktopApi();
    const suggestSpy = vi.spyOn(api, "suggestNoteColor");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "旧草稿");
    await user.type(screen.getByRole("combobox", { name: "添加标签" }), "旧标签{Enter}");
    await selectAgent(user, "Cursor");
    api.simulateQuickNoteReset();
    await waitFor(() => expect(screen.getByLabelText("正文")).toHaveValue(""));
    expect(screen.getByRole("combobox", { name: "添加标签" })).toHaveValue("");
    expect(screen.queryByText("旧标签")).not.toBeInTheDocument();
    expect(suggestSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it("已可见时再次打开不清空正在编辑的草稿（仅 reset 事件清空）", async () => {
    const api = new MockDesktopApi();
    const openSpy = vi.spyOn(api, "openQuickNoteWindow");
    const { user, unmount } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "正在编辑的内容");
    await selectAgent(user, "Cursor");
    await api.openQuickNoteWindow();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("正文")).toHaveValue("正在编辑的内容");
    unmount();
  });
});
