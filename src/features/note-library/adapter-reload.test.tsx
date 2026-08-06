import { render, screen } from "@testing-library/react";
import NoteLibraryWindow from ".";
import { MockDesktopApi } from "@/desktop-api";

describe("主窗口重新加载后读取 adapter 数据", () => {
  it("卸载后重新挂载仍能读取同一 adapter 的数据", async () => {
    const api = new MockDesktopApi();
    const first = render(<NoteLibraryWindow api={api} />);
    await screen.findByText("修改前解释调用链");
    first.unmount();

    // 模拟应用重新加载：同一 adapter 实例仍持有数据（SQLite 语义为重启后仍可读）
    const second = render(<NoteLibraryWindow api={api} />);
    expect(await screen.findByText("修改前解释调用链")).toBeInTheDocument();
    expect(screen.getByText("完成后运行全部测试")).toBeInTheDocument();
    second.unmount();
  });

  it("createTip 后重建主窗口能读取新提示", async () => {
    const api = new MockDesktopApi();
    const created = await api.createTip({
      title: "重启后可见",
      content: "从 adapter 读取",
      bindings: [],
    });
    expect(created.id).toBeTruthy();

    const view = render(<NoteLibraryWindow api={api} />);
    expect(await screen.findByText("重启后可见")).toBeInTheDocument();
    view.unmount();
  });
});
