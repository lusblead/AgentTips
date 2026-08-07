import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HotkeySettingsWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

describe("设置页导航", () => {
  it("提供设置导航并高亮快捷键", async () => {
    const api = new MockDesktopApi();
    render(<HotkeySettingsWindow api={api} />);
    const nav = await screen.findByRole("navigation", { name: "设置导航" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /快捷键/ })).toBeInTheDocument();
    expect(screen.getAllByText("即将提供").length).toBeGreaterThanOrEqual(4);
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
});
