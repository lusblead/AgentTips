import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuickNoteWindow from ".";
import NoteLibraryWindow from "@/features/note-library";
import { MockDesktopApi } from "@/desktop-api";

/**
 * 真实垂直链路的组件侧验证：注入内存 adapter（语义与 SQLite adapter 一致），
 * 不依赖 Tauri 运行时。
 */
describe("Tip 创建链路（adapter 注入）", () => {
  it("createTip 成功后主窗口能读取到新提示", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();

    const quick = render(<QuickNoteWindow api={api} onClose={() => undefined} />);
    await screen.findByRole("button", { name: "添加 Agent" });
    await user.type(screen.getByLabelText("正文"), "垂直链路新增提示");
    await user.click(screen.getByRole("button", { name: /添加 Agent/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Cursor/ }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
    quick.unmount();

    const library = render(<NoteLibraryWindow api={api} />);
    await screen.findByLabelText("标题");
    expect(screen.getAllByText("垂直链路新增提示").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("标题")).toHaveValue("垂直链路新增提示");
    library.unmount();
  });

  it("createTip 失败后保留用户输入", async () => {
    const api = new MockDesktopApi();
    api.setMockFailure("save", true);
    const user = userEvent.setup();
    render(<QuickNoteWindow api={api} onClose={() => undefined} />);
    await screen.findByRole("button", { name: "添加 Agent" });
    await user.type(screen.getByLabelText("正文"), "失败后仍保留");
    await user.click(screen.getByRole("button", { name: /添加 Agent/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Cursor/ }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/模拟保存失败/);
    expect(screen.getByLabelText("正文")).toHaveValue("失败后仍保留");
  });
});
