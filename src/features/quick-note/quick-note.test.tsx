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
    await selectAgent(user, "Cursor");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/模拟保存失败/);
    expect(screen.getByLabelText("正文")).toHaveValue("不应丢失的内容");
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

  it("0 Agent 时保存 disabled 并提示绑定", async () => {
    const api = new MockDesktopApi();
    const createSpy = vi.spyOn(api, "createTip");
    const { user } = await renderQuickNote(api);
    await user.type(screen.getByLabelText("正文"), "只有正文");
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();
    expect(screen.getByText("请至少绑定一个 Agent")).toBeInTheDocument();
    await user.click(save);
    await waitFor(() => expect(createSpy).not.toHaveBeenCalled());
  });

  it("有正文 + Agent 时保存 enabled", async () => {
    const api = new MockDesktopApi();
    const { user } = await renderQuickNote(api);
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("正文"), "正文内容");
    expect(save).toBeDisabled();
    await selectAgent(user, "Cursor");
    expect(save).toBeEnabled();
  });
});
