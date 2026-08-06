# 11. 主要官方参考资料

以下资料用于实现时核对当前 API。依赖和命令可能随版本演进，代码 Agent 应以锁定版本对应的官方文档为准。

## Tauri

- Tauri 2 入门：https://v2.tauri.app/start/
- Global Shortcut：https://v2.tauri.app/plugin/global-shortcut/
- System Tray：https://v2.tauri.app/learn/system-tray/
- Single Instance：https://v2.tauri.app/plugin/single-instance/
- Autostart：https://v2.tauri.app/plugin/autostart/
- Plugin 列表：https://v2.tauri.app/plugin/

## 前端

- Vite Guide：https://vite.dev/guide/
- shadcn/ui + Vite：https://ui.shadcn.com/docs/installation/vite

## Windows

- GetForegroundWindow：https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-getforegroundwindow
- GetWindowThreadProcessId：https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid
- Tool Help System Snapshots：https://learn.microsoft.com/windows/win32/toolhelp/snapshots-of-the-system
- QueryFullProcessImageName：https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew

## 参考原则

- 优先官方文档；
- 不从过时博客复制 Tauri 1.x 配置；
- 不假设插件默认权限已经开放；
- Windows API 调用必须正确关闭句柄；
- 对可能变化的进程名和命令行建立可配置规则，而非写死结论；
- Global Shortcut 的可注册性以锁定版本插件与真实 Windows 冒烟为准；
- 录制控件只采集候选，系统注册结果由后端与操作系统决定。
