import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import ReminderWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

describe("Agent 提醒窗口", () => {
  it("多条便签聚合在一个提醒中", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    expect(await screen.findByRole("dialog", { name: "Cursor 提醒" })).toBeInTheDocument();
    expect(screen.getByText("3 条提示")).toBeInTheDocument();
    expect(screen.getByText("修改前解释调用链")).toBeInTheDocument();
    expect(screen.getByText("完成后运行全部测试")).toBeInTheDocument();
    expect(screen.getByText("不做无关重构")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("能展开和收起", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    await screen.findByRole("dialog");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "收起为胶囊" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Cursor · 3 条提示")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开提醒" }));
    expect(await screen.findByRole("dialog", { name: "Cursor 提醒" })).toBeInTheDocument();
  });

  it("本次忽略后隐藏", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();
    render(<ReminderWindow api={api} />);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "本次忽略" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Cursor · 3 条提示")).not.toBeInTheDocument();
  });

  it("无便签时展示安静提示而非错误窗口", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} demo="empty" />);
    expect(await screen.findByText("暂无携带便签")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("查看全部回调携带当前 Agent", async () => {
    const api = new MockDesktopApi();
    const onOpenMain = vi.fn();
    const user = userEvent.setup();
    render(<ReminderWindow api={api} onOpenMain={onOpenMain} />);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /查看全部/ }));
    expect(onOpenMain).toHaveBeenCalledWith("agent-cursor");
  });
});
