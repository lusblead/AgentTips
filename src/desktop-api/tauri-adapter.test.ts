import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriDesktopApi } from "./tauri-adapter";
import { ERROR_CODES, type CreateTipInput } from "./contract";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const CURSOR_AGENT_ID = "10000000-0000-0000-0000-000000000002";
const CLAUDE_AGENT_ID = "10000000-0000-0000-0000-000000000004";

function createInput(): CreateTipInput {
  return {
    title: "新提示",
    content: "正文内容",
    bindings: [
      { agentId: CURSOR_AGENT_ID, autoAttach: true },
      { agentId: CLAUDE_AGENT_ID, autoAttach: false },
    ],
  };
}

describe("TauriDesktopApi", () => {
  const api = new TauriDesktopApi();

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("listAgents 调用 agent_list", async () => {
    invokeMock.mockResolvedValue([{ id: CURSOR_AGENT_ID, key: "cursor", name: "Cursor" }]);
    await api.listAgents();
    expect(invokeMock).toHaveBeenCalledWith("agent_list");
  });

  it("createTip 使用输入参数调用 tip_create", async () => {
    invokeMock.mockResolvedValue({ id: "tip-1", bindings: [] });
    const input = createInput();
    await api.createTip(input);
    expect(invokeMock).toHaveBeenCalledWith("tip_create", { input });
  });

  it("updateTip 合并 id 与输入", async () => {
    invokeMock.mockResolvedValue({ id: "tip-1", bindings: [] });
    await api.updateTip("tip-1", { content: "新内容" });
    expect(invokeMock).toHaveBeenCalledWith("tip_update", {
      input: { id: "tip-1", content: "新内容" },
    });
  });

  it("listTips 传递查询参数", async () => {
    invokeMock.mockResolvedValue([]);
    await api.listTips({ agentId: CURSOR_AGENT_ID, search: "测试" });
    expect(invokeMock).toHaveBeenCalledWith("tip_list", {
      query: { agentId: CURSOR_AGENT_ID, search: "测试" },
    });
  });

  it("Rust 结构化错误转换为 DesktopError", async () => {
    invokeMock.mockRejectedValue({
      code: "VALIDATION_ERROR",
      message: "输入无效: 正文不能为空",
      retryable: false,
    });
    await expect(api.createTip(createInput())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "输入无效: 正文不能为空",
    });
  });

  it("带 field 的错误保留 field 并携带 retryable", async () => {
    invokeMock.mockRejectedValue({
      code: "NOT_FOUND",
      message: "Agent 不存在",
      field: "bindings",
      retryable: true,
    });
    await expect(api.createTip(createInput())).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Agent 不存在",
      field: "bindings",
      details: { retryable: true },
    });
  });

  it("非结构化 rejection 归一化为 INTERNAL_ERROR", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));
    await expect(api.deleteTip("x")).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "boom",
    });
  });

  it("previewHotkey 明确未实现", async () => {
    await expect(api.previewHotkey({ modifier: "Ctrl", keyCode: "KeyK" })).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: /尚未实现/,
    });
  });

  it("getReminderPreview 明确未实现", async () => {
    await expect(api.getReminderPreview()).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: /尚未实现/,
    });
  });

  it("openMainWindow / openQuickNoteWindow / openSettingsWindow 调用正确 command", async () => {
    invokeMock.mockResolvedValue(undefined);
    await api.openMainWindow();
    await api.openQuickNoteWindow();
    await api.openSettingsWindow();
    expect(invokeMock).toHaveBeenCalledWith("window_open_main");
    expect(invokeMock).toHaveBeenCalledWith("window_open_quick_note");
    expect(invokeMock).toHaveBeenCalledWith("window_open_settings");
  });

  it("hideCurrentWindow 传递 label", async () => {
    invokeMock.mockResolvedValue(undefined);
    await api.hideCurrentWindow("quick-note");
    expect(invokeMock).toHaveBeenCalledWith("window_hide_current", { label: "quick-note" });
  });

  it("subscribeQuickNoteReset 调用 listen 并解绑", async () => {
    listenMock.mockResolvedValue(() => undefined);
    const unsub = await api.subscribeQuickNoteReset(() => undefined);
    expect(listenMock).toHaveBeenCalledWith("agenttips://quick-note/reset", expect.any(Function));
    expect(typeof unsub).toBe("function");
  });
});
