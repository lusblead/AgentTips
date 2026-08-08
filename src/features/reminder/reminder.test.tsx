import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import ReminderWindow, { formatCopyAll } from ".";
import { MockDesktopApi } from "@/desktop-api";
import type { ReminderPayloadDto } from "@/desktop-api/contract";

function payload(tips: Array<{ id: string; title: string; body: string }>): ReminderPayloadDto {
  return {
    agentKey: "cursor",
    agentId: "10000000-0000-0000-0000-000000000001",
    agentDisplayName: "Cursor",
    generatedAt: "2026-08-08T09:00:00+00:00",
    tips: tips.map((tip, index) => ({
      tipId: tip.id,
      title: tip.title,
      body: tip.body,
      colorKey: (["lemon", "mint", "sky"] as const)[index % 3],
    })),
  };
}

const ONE_TIP = payload([{ id: "t1", title: "标题一", body: "正文一" }]);

const THREE_TIPS = payload([
  { id: "t1", title: "标题一", body: "正文一" },
  { id: "t2", title: "标题二", body: "正文二" },
  { id: "t3", title: "标题三", body: "正文三" },
]);

describe("Agent 提醒窗口（真实 payload 事件驱动）", () => {
  it("payload 渲染 agent 与便签", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    api.emitReminder(THREE_TIPS);
    expect(await screen.findByRole("dialog", { name: "Cursor 提醒" })).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();
    expect(screen.getByText("3 条提示")).toBeInTheDocument();
  });

  it("单条便签渲染", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    api.emitReminder(ONE_TIP);
    expect(await screen.findByText("标题一")).toBeInTheDocument();
    expect(screen.getByText("正文一")).toBeInTheDocument();
    expect(screen.getByText("1 条提示")).toBeInTheDocument();
  });

  it("多条便签聚合渲染", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    api.emitReminder(THREE_TIPS);
    expect(await screen.findByText("标题一")).toBeInTheDocument();
    expect(screen.getByText("标题二")).toBeInTheDocument();
    expect(screen.getByText("标题三")).toBeInTheDocument();
  });

  it("pastel 颜色保留在每条便签上", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    api.emitReminder(THREE_TIPS);
    const block = await screen.findByText("正文一");
    expect(block.closest("[data-color-key]")).toHaveAttribute("data-color-key", "lemon");
  });

  it("长正文可滚动（内容区纵向滚动）", async () => {
    const api = new MockDesktopApi();
    const longBody = "行\n".repeat(80);
    render(<ReminderWindow api={api} />);
    api.emitReminder(payload([{ id: "long", title: "长文", body: longBody }]));
    await screen.findByText("长文");
    const scrollable = document.querySelector("[data-window='reminder'] .overflow-y-auto");
    expect(scrollable).not.toBeNull();
  });

  it("复制单条便签内容", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();
    render(<ReminderWindow api={api} />);
    api.emitReminder(ONE_TIP);
    await user.click(await screen.findByRole("button", { name: "复制" }));
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });

  it("复制全部使用稳定格式", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();
    render(<ReminderWindow api={api} />);
    api.emitReminder(THREE_TIPS);
    await user.click(await screen.findByRole("button", { name: "复制全部" }));
    expect(await screen.findByText("已复制全部")).toBeInTheDocument();
  });

  it("Copy All 稳定格式：标题 + 正文 + 分隔线", () => {
    const expected = "[标题一]\n\n正文一\n\n---\n\n[标题二]\n\n正文二\n\n---\n\n[标题三]\n\n正文三";
    expect(formatCopyAll(THREE_TIPS)).toBe(expected);
  });

  it("本次忽略后隐藏并调用 dismiss", async () => {
    const api = new MockDesktopApi();
    const dismissSpy = vi.spyOn(api, "dismissReminder");
    const user = userEvent.setup();
    const { container } = render(<ReminderWindow api={api} />);
    api.emitReminder(THREE_TIPS);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "本次忽略" }));
    expect(container.firstChild).toBeNull();
    expect(dismissSpy).toHaveBeenCalled();
  });

  it("打开 AgentTips 回调携带当前 Agent", async () => {
    const api = new MockDesktopApi();
    const onOpenMain = vi.fn();
    const user = userEvent.setup();
    render(<ReminderWindow api={api} onOpenMain={onOpenMain} />);
    api.emitReminder(THREE_TIPS);
    await user.click(await screen.findByRole("button", { name: /打开 AgentTips/ }));
    expect(onOpenMain).toHaveBeenCalledWith("10000000-0000-0000-0000-000000000001");
  });

  it("payload 替换 A→B 时更新展示", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    api.emitReminder(payload([{ id: "a", title: "Agent A 提示", body: "A 正文" }]));
    expect(await screen.findByText("Agent A 提示")).toBeInTheDocument();
    const b = payload([{ id: "b", title: "Agent B 提示", body: "B 正文" }]);
    api.emitReminder({ ...b, agentDisplayName: "Codex", agentKey: "codex" });
    expect(await screen.findByText("Agent B 提示")).toBeInTheDocument();
    expect(screen.queryByText("Agent A 提示")).not.toBeInTheDocument();
  });

  it("无编辑 UI", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    api.emitReminder(THREE_TIPS);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("无自动发送 UI", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    api.emitReminder(THREE_TIPS);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /发送/ })).not.toBeInTheDocument();
    expect(screen.getByText(/不会自动发送给 Agent/)).toBeInTheDocument();
  });

  it("无便签时展示安静提示", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} />);
    api.emitReminder(payload([]));
    expect(await screen.findByText("暂无携带便签")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("demo=expanded 浏览器调试态可渲染", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} demo="expanded" />);
    expect(await screen.findByRole("dialog", { name: "Cursor 提醒" })).toBeInTheDocument();
    expect(screen.getByText("3 条提示")).toBeInTheDocument();
  });

  it("demo=empty 浏览器调试态显示空态", async () => {
    const api = new MockDesktopApi();
    render(<ReminderWindow api={api} demo="empty" />);
    expect(await screen.findByText("暂无携带便签")).toBeInTheDocument();
  });
});
