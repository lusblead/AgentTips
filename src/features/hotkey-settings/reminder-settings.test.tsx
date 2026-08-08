import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import HotkeySettingsWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

async function openReminderSection(api: MockDesktopApi) {
  const user = userEvent.setup();
  render(<HotkeySettingsWindow api={api} />);
  await user.click(screen.getByRole("button", { name: /提醒/ }));
  return user;
}

describe("设置页提醒冷却", () => {
  it("显示默认 15 分钟", async () => {
    const api = new MockDesktopApi();
    await openReminderSection(api);
    expect(await screen.findByTestId("reminder-cooldown-input")).toHaveValue(15);
  });

  it("改为 5 分钟并保存成功", async () => {
    const api = new MockDesktopApi();
    const user = await openReminderSection(api);
    const input = await screen.findByTestId("reminder-cooldown-input");
    await user.clear(input);
    await user.type(input, "5");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("已保存 5 分钟")).toBeInTheDocument();
    expect(await api.getReminderSettings()).toMatchObject({ cooldownMinutes: 5 });
  });

  it("0 分钟非法并保留旧值", async () => {
    const api = new MockDesktopApi();
    const user = await openReminderSection(api);
    const input = await screen.findByTestId("reminder-cooldown-input");
    await user.clear(input);
    await user.type(input, "0");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("冷却时长必须在 1 ～ 120 分钟之间");
    expect(input).toHaveValue(15);
  });

  it("121 分钟非法并保留旧值", async () => {
    const api = new MockDesktopApi();
    const user = await openReminderSection(api);
    const input = await screen.findByTestId("reminder-cooldown-input");
    await user.clear(input);
    await user.type(input, "121");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("冷却时长必须在 1 ～ 120 分钟之间");
    expect(input).toHaveValue(15);
  });

  it("更新失败保留旧值", async () => {
    const api = new MockDesktopApi();
    vi.spyOn(api, "updateReminderSettings").mockRejectedValue(
      Object.assign(new Error("数据库错误"), { code: "DATABASE_ERROR" }),
    );
    const user = await openReminderSection(api);
    const input = await screen.findByTestId("reminder-cooldown-input");
    await user.clear(input);
    await user.type(input, "5");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/数据库错误/);
    expect(input).toHaveValue(15);
    expect(await api.getReminderSettings()).toMatchObject({ cooldownMinutes: 15 });
  });

  it("重开设置页显示持久化值", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();
    const { unmount } = render(<HotkeySettingsWindow api={api} />);
    await user.click(screen.getByRole("button", { name: /提醒/ }));
    const first = user;
    const input = await screen.findByTestId("reminder-cooldown-input");
    await first.clear(input);
    await first.type(input, "3");
    await first.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("已保存 3 分钟");
    unmount();
    render(<HotkeySettingsWindow api={api} />);
    await user.click(screen.getAllByRole("button", { name: /提醒/ })[0]);
    expect(await screen.findByTestId("reminder-cooldown-input")).toHaveValue(3);
  });
});
