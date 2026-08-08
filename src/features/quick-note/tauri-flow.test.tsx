import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuickNoteWindow from ".";
import NoteLibraryWindow from "@/features/note-library";
import { MockDesktopApi } from "@/desktop-api";

/**
 * 真实垂直链路的组件侧验证：注入内存 adapter（语义与 SQLite adapter 一致），
 * 不依赖 Tauri 运行时。
 */
describe("Tip 创建链路（adapter 注入）", () => {
  it("titleless tagged quick note appears in the main library", async () => {
    const api = new MockDesktopApi();
    const user = userEvent.setup();

    const quick = render(<QuickNoteWindow api={api} onClose={() => undefined} />);
    await screen.findByRole("button", { name: "添加 Agent" });
    await user.type(screen.getByLabelText("正文"), "垂直链路新增提示");
    await user.type(screen.getByRole("combobox", { name: "添加标签" }), "垂直链路{Enter}");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
    quick.unmount();

    const library = render(<NoteLibraryWindow api={api} />);
    const cards = await screen.findAllByTestId("tip-card");
    const target = cards.find(
      (card) =>
        (within(card).getByLabelText("正文") as HTMLTextAreaElement).value === "垂直链路新增提示",
    );
    expect(target).toBeDefined();
    expect(within(target!).queryByLabelText("标题")).not.toBeInTheDocument();
    expect(within(target!).getByText("#垂直链路")).toBeInTheDocument();
    await user.click(target!.querySelector('button[aria-label="展开详情"]')!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("标题")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("正文")).toHaveValue("垂直链路新增提示");
    expect(within(dialog).getByText("垂直链路")).toBeInTheDocument();
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
