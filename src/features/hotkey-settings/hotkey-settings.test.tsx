import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import HotkeySettingsWindow, { HotkeyRecorder } from ".";
import { MockDesktopApi } from "@/desktop-api";
import type { HotkeyBinding } from "@/desktop-api/contract";

const F12: HotkeyBinding = {
  modifier: "Ctrl",
  keyCode: "F12",
  displayLabel: "Ctrl + F12",
  highConflict: false,
};

async function renderRecorder() {
  const api = new MockDesktopApi();
  const user = userEvent.setup();
  render(<HotkeyRecorder api={api} initial={F12} />);
  return { api, user };
}

async function startRecording(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "重新录制" }));
  expect(screen.getByText("正在录制")).toBeInTheDocument();
}

describe("快捷键录制控件", () => {
  it("接受 Ctrl + K", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByText("已更新 Ctrl + K")).toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + K");
  });

  it("拒绝 Ctrl + Alt + K 并显示实际候选与原快捷键", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("{Control>}{Alt>}k{/Alt}{/Control}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("不能包含 Alt / Shift / Meta");
    expect(alert).toHaveTextContent("当前快捷键仍为 Ctrl + F12");
    expect(screen.getByText("检测到 Ctrl + Alt + K")).toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });

  it("拒绝单独按 K", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("k");
    expect(await screen.findByRole("alert")).toHaveTextContent("必须按住 Ctrl");
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });

  it("单独按 Ctrl 时继续等待", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("{Control>}");
    expect(screen.getByText(/请按下 Ctrl \+ 一个按键/)).toBeInTheDocument();
    expect(screen.getByText("正在录制")).toBeInTheDocument();
  });

  it("录制状态不把旧快捷键显示为候选", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    expect(screen.queryByText(/检测到/)).not.toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
    expect(screen.getByText(/请按下 Ctrl \+ 一个按键/)).toBeInTheDocument();
  });

  it("Esc 取消并恢复旧值", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByText("正在录制")).not.toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });

  it("常见冲突组合显示确认对话框，取消后保留旧值", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("{Control>}c{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "高冲突快捷键确认" });
    expect(dialog).toHaveTextContent("设为全局快捷键可能影响其他软件");
    expect(screen.getByText("检测到 Ctrl + C")).toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });

  it("Ctrl + C 确认后执行更新", async () => {
    const { api, user } = await renderRecorder();
    const updateSpy = vi.spyOn(api, "updateHotkey");
    await startRecording(user);
    await user.keyboard("{Control>}c{/Control}");
    await screen.findByRole("dialog", { name: "高冲突快捷键确认" });
    await user.click(screen.getByRole("button", { name: "仍然使用" }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已更新 Ctrl + C")).toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + C");
  });

  it("Ctrl + Z 冲突时不直接更新", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("{Control>}z{/Control}");
    expect(await screen.findByRole("dialog", { name: "高冲突快捷键确认" })).toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });

  it("注册失败时保留旧值并显示错误", async () => {
    const { api, user } = await renderRecorder();
    api.setMockFailure("hotkey", true);
    await startRecording(user);
    await user.keyboard("{Control>}k{/Control}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("无法注册");
    expect(alert).toHaveTextContent("当前快捷键仍为 Ctrl + F12");
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });

  it("录制开始与结束调用 begin/endHotkeyRecording", async () => {
    const { api, user } = await renderRecorder();
    await startRecording(user);
    expect(api.hotkeyCalls).toContain("begin");
    await user.keyboard("{Escape}");
    expect(api.hotkeyCalls).toContain("end");
  });

  it("Settings 打开时从持久化状态读取快捷键", async () => {
    const api = new MockDesktopApi();
    const view = render(<HotkeySettingsWindow api={api} />);
    expect(await screen.findByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
    view.unmount();
  });

  it("Settings 重新打开后显示已持久化的值", async () => {
    const api = new MockDesktopApi();
    const first = render(<HotkeySettingsWindow api={api} />);
    await screen.findByTestId("hotkey-display");
    first.unmount();

    // 另一处（Quick Note 等）直接改设置，模拟真实持久化语义
    await api.updateHotkey({ modifier: "Ctrl", keyCode: "F11" });
    const second = render(<HotkeySettingsWindow api={api} />);
    expect(await screen.findByTestId("hotkey-display")).toHaveTextContent("Ctrl + F11");
    second.unmount();
  });
});
