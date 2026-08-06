import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HotkeyRecorder } from ".";
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
    expect(await screen.findByText("已保存 Ctrl + K")).toBeInTheDocument();
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

  it("常见冲突组合显示针对性警告并保留旧值", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("{Control>}c{/Control}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("该组合可能覆盖系统常用操作");
    expect(alert).toHaveTextContent("当前快捷键仍为 Ctrl + F12");
    expect(screen.getByText("检测到 Ctrl + C")).toBeInTheDocument();
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });

  it("Ctrl + Z 冲突时保留旧值", async () => {
    const { user } = await renderRecorder();
    await startRecording(user);
    await user.keyboard("{Control>}z{/Control}");
    expect(await screen.findByRole("alert")).toHaveTextContent("该组合可能覆盖系统常用操作");
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });
});
