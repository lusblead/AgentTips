import { act, render, screen } from "@testing-library/react";
import App from "./App";

function visit(path: string) {
  window.history.replaceState({}, "", path);
}

describe("窗口路由", () => {
  it("默认进入主管理窗口", async () => {
    visit("/");
    render(<App />);
    expect(await screen.findByText("提示库")).toBeInTheDocument();
    expect(screen.getByText("修改前解释调用链")).toBeInTheDocument();
  });

  it("?window=quick-note 进入快捷新建窗口", () => {
    visit("/?window=quick-note");
    render(<App />);
    expect(screen.getByText("新建提示")).toBeInTheDocument();
    expect(screen.getByLabelText("正文")).toBeInTheDocument();
  });

  it("?window=reminder 进入提醒窗口", async () => {
    visit("/?window=reminder");
    render(<App />);
    expect(await screen.findByRole("dialog", { name: "Cursor 提醒" })).toBeInTheDocument();
    expect(screen.getByText("3 条提示")).toBeInTheDocument();
  });

  it("?window=settings 进入设置页", async () => {
    visit("/?window=settings");
    render(<App />);
    expect(await screen.findByText("设置")).toBeInTheDocument();
  });

  it("popstate 事件可切换窗口", async () => {
    visit("/?window=main");
    const { unmount } = render(<App />);
    await screen.findByText("提示库");
    window.history.pushState({}, "", "/?window=quick-note");
    const { getWindowContext } = await import("@/desktop-api");
    expect(getWindowContext().kind).toBe("quick-note");
    act(() => {
      window.dispatchEvent(new Event("agenttips:route"));
    });
    expect(await screen.findByText("新建提示")).toBeInTheDocument();
    expect(screen.getByLabelText("正文")).toBeInTheDocument();
    unmount();
  });
});

describe("UI 开发文字清理", () => {
  const forbidden = ["Phase 1", "Phase 6", "仅前端", "尚未注册", "New Tip", "3 Tips"];

  it.each(["/?window=main", "/?window=quick-note", "/?window=reminder", "/?window=settings"])(
    "%s 不含开发阶段文字",
    async (path) => {
      visit(path);
      const { unmount } = render(<App />);
      if (path === "/?window=main") {
        await screen.findByText("提示库");
      } else if (path === "/?window=quick-note") {
        await screen.findByText("新建提示");
      } else if (path === "/?window=settings") {
        await screen.findByText("设置");
      } else {
        await screen.findByText("3 条提示");
      }
      const bodyText = document.body.textContent ?? "";
      for (const text of forbidden) {
        expect(bodyText).not.toContain(text);
      }
      unmount();
    },
  );
});
