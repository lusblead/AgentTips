import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import HotkeySettingsWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

describe("设置页导航", () => {
  it("提供设置导航并高亮快捷键", async () => {
    const api = new MockDesktopApi();
    render(<HotkeySettingsWindow api={api} />);
    const nav = await screen.findByRole("navigation", { name: "设置导航" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /快捷键/ })).toBeInTheDocument();
    expect(screen.getAllByText("即将提供").length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByTestId("hotkey-display")).toHaveTextContent("Ctrl + F12");
  });

  it("禁用项不可点击切换", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();
    render(<HotkeySettingsWindow api={api} />);
    await screen.findByTestId("hotkey-display");
    const disabled = screen.getByRole("button", { name: /关于/ });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(screen.getByTestId("hotkey-display")).toBeInTheDocument();
  });

  it("可以关闭某个 Agent 并持久化确认值", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();
    render(<HotkeySettingsWindow api={api} />);
    await user.click(screen.getByRole("button", { name: "Agent" }));
    const claude = await screen.findByRole("switch", { name: "使用 Claude Code" });
    expect(claude).toBeChecked();

    await user.click(claude);

    await waitFor(() => expect(claude).not.toBeChecked());
    expect((await api.listAgents()).find((agent) => agent.key === "claude-code")?.enabled).toBe(
      false,
    );
  });

  it("failed_agent_toggle_keeps_confirmed_state: 更新失败时保留原开关", async () => {
    const api = new MockDesktopApi();
    vi.spyOn(api, "updateAgentEnabled").mockRejectedValue(new Error("数据库错误"));
    const user = userEvent.setup();
    render(<HotkeySettingsWindow api={api} />);
    await user.click(screen.getByRole("button", { name: "Agent" }));
    const claude = await screen.findByRole("switch", { name: "使用 Claude Code" });

    await user.click(claude);

    expect(await screen.findByRole("alert")).toHaveTextContent("数据库错误");
    expect(claude).toBeChecked();
  });

  it("可以分别暂停两个 Agent 并只恢复其中一个", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();
    render(<HotkeySettingsWindow api={api} />);
    await user.click(screen.getByRole("button", { name: "Agent" }));

    await user.click(await screen.findByRole("button", { name: "暂停 Cursor 提醒" }));
    await user.click(await screen.findByRole("menuitem", { name: "4 小时" }));
    expect(await screen.findByTestId("agent-snooze-status-cursor")).toHaveTextContent(
      "提醒已暂停至",
    );

    await user.click(screen.getByRole("button", { name: "暂停 Claude Code 提醒" }));
    await user.click(await screen.findByRole("menuitem", { name: "2 小时" }));
    expect(await screen.findByTestId("agent-snooze-status-claude-code")).toHaveTextContent(
      "提醒已暂停至",
    );

    await user.click(screen.getByRole("button", { name: "恢复 Cursor 提醒" }));
    await waitFor(() =>
      expect(screen.getByTestId("agent-snooze-status-cursor")).toHaveTextContent("提醒正常"),
    );
    expect(screen.getByTestId("agent-snooze-status-claude-code")).toHaveTextContent("提醒已暂停至");
    expect(api.agentReminderSnoozeCalls).toEqual([
      { agentKey: "cursor", hours: 4 },
      { agentKey: "claude-code", hours: 2 },
    ]);
    expect(api.agentReminderResumeCalls).toEqual(["cursor"]);
  });

  it("恢复写入失败时保留该 Agent 已确认的暂停状态", async () => {
    const api = new MockDesktopApi();
    await api.snoozeAgentReminders("cursor", 4);
    vi.spyOn(api, "resumeAgentReminders").mockRejectedValue(new Error("数据库错误"));
    const user = userEvent.setup();
    render(<HotkeySettingsWindow api={api} />);
    await user.click(screen.getByRole("button", { name: "Agent" }));
    await screen.findByRole("button", { name: "恢复 Cursor 提醒" });

    await user.click(screen.getByRole("button", { name: "恢复 Cursor 提醒" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("数据库错误");
    expect(screen.getByTestId("agent-snooze-status-cursor")).toHaveTextContent("提醒已暂停至");
  });

  it("Agent 暂停状态加载失败时显示错误且不伪造状态", async () => {
    const api = new MockDesktopApi();
    vi.spyOn(api, "getAgentReminderSnoozes").mockRejectedValue(new Error("数据库读取失败"));
    const user = userEvent.setup();
    render(<HotkeySettingsWindow api={api} />);

    await user.click(screen.getByRole("button", { name: "Agent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("数据库读取失败");
    expect(screen.queryByTestId("agent-snooze-status-cursor")).not.toBeInTheDocument();
  });
});
