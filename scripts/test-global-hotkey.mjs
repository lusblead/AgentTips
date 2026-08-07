/**
 * Phase 3B Global Hotkey 真实 Windows Runtime Test。
 *
 * 流程（对应 Phase 3B §45-46）：
 *   A. 启动 AgentTips（独立测试 DB），默认 Ctrl + F12
 *   B. 隐藏 Main / Quick Note / Settings
 *   C. 打开 Notepad 并获得焦点
 *   D. 真实发送 Ctrl + F12 → Quick Note 出现并聚焦
 *   E. 输入文本，再次 Ctrl + F12 → 仍 1 个窗口且文本保留
 *   F. 关闭 Quick Note
 *   G. Settings UI 修改为 Ctrl + F11
 *   H. Notepad 前台按 Ctrl + F11 → Quick Note 出现
 *   I. 隐藏后按 Ctrl + F12 → 不出现（OLD 已失效）
 *   J. 重启应用 → Ctrl + F11 仍生效（持久化）
 *   冲突：fixture 占用 Ctrl + F10 → update 返回 HOTKEY_REGISTRATION_FAILED，
 *         数据库与 active 保持 F11，OLD 继续工作
 *
 * 业务操作（输入/选择/保存/录制）全部通过真实 DOM 完成；
 * invoke 仅用于窗口诊断与 hotkey 状态只读核对。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  killProcessTree,
  makeLogDir,
  makeTestDataDir,
  moveWindowsToNativeDisplay,
  sleep,
  waitFor,
} from "./lib/runtime-test-utils.mjs";

const CDP_PORT = 9234;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_DATA_DIR = makeTestDataDir("global-hotkey");
const FIXTURE = join(ROOT, "scripts", "fixtures", "hotkey-conflict-fixture.ps1");

let appProcess = null;
let logDir = null;
let notepadProcess = null;
let fixtureProcess = null;

const AGENT_WINDOW_TITLES = ["AgentTips", "新建提示", "设置"];

function moveAgentTipsAway() {
  try {
    moveWindowsToNativeDisplay({ titles: AGENT_WINDOW_TITLES });
  } catch {
    /* 单屏时忽略，不阻塞测试 */
  }
}

function moveNotepadAway() {
  try {
    moveWindowsToNativeDisplay({ className: "Notepad" });
  } catch {
    /* ignore */
  }
}

async function hideAgentWindows(labels) {
  for (const label of labels) {
    const client = clients.get(label);
    if (client && (await isVisible(client))) {
      await hideWindow(client, label);
    }
  }
}

async function listPageTargets() {
  const response = await fetch(CDP_ENDPOINT, { signal: AbortSignal.timeout(3_000) });
  const json = await response.json();
  return json.filter((t) => t.type === "page");
}

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ws open timeout")), 5_000);
      this.ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(t);
        reject(new Error("ws error"));
      };
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(
          `exception: ${
            message.params.exceptionDetails.exception?.description ??
            message.params.exceptionDetails.text
          }`,
        );
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(
          "console.error: " +
            message.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
        );
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(JSON.stringify(message.error)));
        } else {
          resolve(message.result);
        }
      }
    };
    await this.send("Runtime.enable");
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
        }`,
      );
    }
    return result.result.value;
  }

  async tryEval(expression) {
    try {
      return await this.evaluate(expression);
    } catch {
      return null;
    }
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

const clients = new Map();

async function ensureClient(kind) {
  if (clients.has(kind)) return clients.get(kind);
  await waitFor(
    async () => {
      const targets = await listPageTargets();
      for (const target of targets) {
        if (clients.has(kind)) return true;
        const probe = new CdpClient(target.webSocketDebuggerUrl);
        try {
          await probe.open();
          const k = await probe.evaluate(
            `document.querySelector('[data-window]')?.getAttribute('data-window') ?? null`,
          );
          if (k && !clients.has(k)) clients.set(k, probe);
          else probe.close();
        } catch {
          try {
            probe.close();
          } catch {
            /* ignore */
          }
        }
      }
      return clients.has(kind);
    },
    { timeout: 30_000, label: `window ${kind}` },
  );
  return clients.get(kind);
}

async function openWindow(kind) {
  const command = {
    main: "window_open_main",
    "quick-note": "window_open_quick_note",
    settings: "window_open_settings",
  }[kind];
  for (const client of clients.values()) {
    await client.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)})`);
    break;
  }
  await sleep(600);
  return ensureClient(kind);
}

async function isVisible(client) {
  return Boolean(
    await client.evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`),
  );
}

async function hideWindow(client, label) {
  await waitFor(
    async () => {
      const r = await client.tryEval(
        `window.__TAURI_INTERNALS__.invoke('window_hide_current', { label: ${JSON.stringify(label)} }).then(() => true, () => false)`,
      );
      return r === true;
    },
    { timeout: 15_000, label: `hide ${label}` },
  );
}

function startApp() {
  logDir = makeLogDir("global-hotkey");
  const child = spawn("pnpm.cmd", ["tauri", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      AGENTTIPS_TEST_DATA_DIR: TEST_DATA_DIR,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout.pipe(createWriteStream(join(logDir, "stdout.log")));
  child.stderr.pipe(createWriteStream(join(logDir, "stderr.log")));
  appProcess = child;
}

function stopApp() {
  if (appProcess) {
    killProcessTree(appProcess.pid);
    appProcess = null;
  }
}

/** 向系统发送真实 Ctrl + <vk>（keybd_event，需要外部应用获得焦点）。 */
function sendHotkey(vk) {
  const code = `
import ctypes, time
u = ctypes.windll.user32
u.keybd_event(0x11, 0, 0, 0)  # Ctrl down
time.sleep(0.05)
u.keybd_event(${vk}, 0, 0, 0)
time.sleep(0.05)
u.keybd_event(${vk}, 0, 2, 0)
time.sleep(0.05)
u.keybd_event(0x11, 0, 2, 0)  # Ctrl up
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`sendHotkey failed: ${result.stderr}`);
}

function focusNotepad() {
  const code = `
import ctypes, ctypes.wintypes as w, time
u = ctypes.windll.user32
def click(x, y):
    # SetCursorPos + mouse_event：物理坐标直通，系统按 DPI 自动虚拟化
    u.SetCursorPos(x, y)
    time.sleep(0.15)
    u.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.1)
    u.mouse_event(0x0004, 0, 0, 0, 0)
    time.sleep(0.15)
for _ in range(20):
    hwnd = u.FindWindowW("Notepad", None)
    if hwnd:
        u.ShowWindow(hwnd, 9)
        # ALT 键技巧绕过 Windows 前台锁（SetForegroundWindow 限制）
        u.keybd_event(0x12, 0, 0, 0)
        u.SetForegroundWindow(hwnd)
        u.keybd_event(0x12, 0, 2, 0)
        r = w.RECT()
        u.GetWindowRect(hwnd, ctypes.byref(r))
        cx = (r.left + r.right) // 2
        cy = (r.top + r.bottom) // 2
        # 真实鼠标点击 Notepad 客户区，绕过 SetForegroundWindow 前台锁
        click(cx, cy)
        time.sleep(0.3)
        print("focused")
        raise SystemExit
    time.sleep(0.3)
print("notepad not found")
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (!result.stdout.includes("focused")) {
    throw new Error(`focusNotepad failed: ${result.stdout} ${result.stderr}`);
  }
}

/** 返回当前前台窗口信息：{ hwnd, className, title }。 */
function getForegroundInfo() {
  const code = `
import ctypes, ctypes.wintypes as w
u = ctypes.windll.user32
hwnd = u.GetForegroundWindow()
cls = ctypes.create_unicode_buffer(256)
u.GetClassNameW(hwnd, cls, 256)
length = u.GetWindowTextLengthW(hwnd)
title = ctypes.create_unicode_buffer(length + 1)
u.GetWindowTextW(hwnd, title, length + 1)
print(f"{hwnd}|{cls.value}|{title.value}")
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`getForegroundInfo failed: ${result.stderr}`);
  const [hwnd, className, title] = result.stdout.trim().split("|");
  return { hwnd, className, title };
}

/** 读取指定顶层窗口的扩展样式，判断 WS_EX_TOPMOST (0x8) 是否置顶。 */
function isTopmostByHwnd(hwnd) {
  const code = `
import ctypes, ctypes.wintypes as w, sys
u = ctypes.windll.user32
hwnd = ${hwnd}
ex = u.GetWindowLongW(hwnd, -20)  # GWL_EXSTYLE
print(bool(ex & 0x8))
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`isTopmostByHwnd failed: ${result.stderr}`);
  return result.stdout.trim() === "True";
}

/** 获取指定标题/类名窗口的 hwnd；找不到返回 null。 */
function findWindowHwnd(className, title) {
  const code = `
import ctypes, ctypes.wintypes as w, sys
u = ctypes.windll.user32
cls = ${JSON.stringify(className ?? null)}
title = ${JSON.stringify(title ?? null)}
hwnd = u.FindWindowW(cls, title)
print(hwnd if hwnd else 0)
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`findWindowHwnd failed: ${result.stderr}`);
  return Number(result.stdout.trim() || 0);
}

/** 最小化指定窗口（SW_MINIMIZE），用于验证 Hotkey 唤醒恢复。 */
function minimizeWindowByHwnd(hwnd) {
  const code = `
import ctypes, ctypes.wintypes as w
u = ctypes.windll.user32
u.ShowWindow(${hwnd}, 6)
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`minimizeWindowByHwnd failed: ${result.stderr}`);
}

function isMinimizedByHwnd(hwnd) {
  const code = `
import ctypes, ctypes.wintypes as w
u = ctypes.windll.user32
print(bool(u.IsIconic(${hwnd})))
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`isMinimizedByHwnd failed: ${result.stderr}`);
  return result.stdout.trim() === "True";
}

function launchNotepad() {
  notepadProcess = spawn("notepad.exe", [], { stdio: "ignore" });
}

async function waitWindowVisible(kind, { timeout = 15_000 } = {}) {
  const client = await ensureClient(kind);
  await waitFor(async () => isVisible(client), { timeout, label: `${kind} visible` });
  return client;
}

async function waitWindowHidden(kind, { timeout = 15_000 } = {}) {
  const client = await ensureClient(kind);
  await waitFor(async () => !(await isVisible(client)), { timeout, label: `${kind} hidden` });
}

function startConflictFixture() {
  fixtureProcess = spawn(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", FIXTURE],
    { stdio: "ignore" },
  );
}

async function assertHotkeyState(expectedKey) {
  const main = await ensureClient("main");
  const state = await main.evaluate(
    `window.__TAURI_INTERNALS__.invoke('hotkey_get')`,
  );
  if (state.configured?.keyCode !== expectedKey) {
    throw new Error(`configured expected ${expectedKey}, got ${JSON.stringify(state)}`);
  }
  return state;
}

async function changeHotkeyViaSettingsUi(keyCode) {
  const settings = await openWindow("settings");
  await waitFor(
    async () =>
      Boolean(
        await settings.tryEval(
          `document.querySelector('button') && [...document.querySelectorAll('button')].some((b) => b.textContent.includes('重新录制'))`,
        ),
      ),
    { timeout: 10_000, label: "settings recorder ready" },
  );
  const clicked = await settings.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('重新录制'));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) throw new Error("重新录制 button not found");
  await sleep(300);
  // 真实键盘事件：Ctrl + <key>。CDP Input.dispatchKeyEvent 产生可信 keydown。
  const keyMap = {
    F11: { key: "F11", code: "F11", windowsVirtualKeyCode: 122, nativeVirtualKeyCode: 122 },
    F10: { key: "F10", code: "F10", windowsVirtualKeyCode: 121, nativeVirtualKeyCode: 121 },
  };
  const spec = keyMap[keyCode];
  if (!spec) throw new Error(`unsupported test key: ${keyCode}`);
  await settings.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 0,
  });
  await settings.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
    nativeVirtualKeyCode: spec.nativeVirtualKeyCode,
    modifiers: 2, // Ctrl
  });
  await settings.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
    nativeVirtualKeyCode: spec.nativeVirtualKeyCode,
    modifiers: 2,
  });
  await settings.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 0,
  });
  return settings;
}

function closeAllClients() {
  for (const client of clients.values()) client.close();
  clients.clear();
}

async function waitAppStopped() {
  await waitFor(
    async () => {
      try {
        const response = await fetch(CDP_ENDPOINT, { signal: AbortSignal.timeout(1_000) });
        await response.text();
        return false;
      } catch {
        return true;
      }
    },
    { timeout: 30_000, label: "app stopped" },
  );
}

async function run() {
  try {
    // A. 启动
    startApp();
    const main = await ensureClient("main");
    moveAgentTipsAway();
    await assertHotkeyState("F12");
    console.log("A. 启动，默认 Ctrl + F12  PASS");

    // B. 隐藏全部窗口
    await hideWindow(main, "main");
    // quick-note / settings 是懒创建窗口，此时可能尚未存在；只隐藏已创建的
    if (clients.has("quick-note")) {
      const existingQuick = clients.get("quick-note");
      if (await isVisible(existingQuick)) await hideWindow(existingQuick, "quick-note");
    }
    if (clients.has("settings")) {
      const existingSettings = clients.get("settings");
      if (await isVisible(existingSettings)) await hideWindow(existingSettings, "settings");
    }
    console.log("B. 全部窗口隐藏，AgentTips 后台运行  PASS");

    // C. Notepad 前台
    launchNotepad();
    moveNotepadAway();
    focusNotepad();
    console.log("C. Notepad 获得焦点  PASS");

    // D. Ctrl + F12 → Quick Note 出现
    sendHotkey(0x7b); // VK_F12
    const quick = await waitWindowVisible("quick-note");
    moveAgentTipsAway();
    await hideAgentWindows(["main", "settings"]);
    console.log("D. Ctrl + F12 → Quick Note 出现  PASS");

    // E. 输入文本；再次 Ctrl + F12 → 仍 1 个窗口且文本保留
    await quick.evaluate(`(() => {
      const ta = document.querySelector('textarea[aria-label="正文"]');
      if (!ta) throw new Error('textarea missing');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'global hotkey runtime test');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);
    sendHotkey(0x7b);
    await sleep(1_000);
    const targetCount = (await listPageTargets()).filter((t) => t.type === "page").length;
    const text = await quick.evaluate(
      `document.querySelector('textarea[aria-label="正文"]')?.value ?? null`,
    );
    if (text !== "global hotkey runtime test") {
      throw new Error(`draft lost after second trigger: ${text}`);
    }
    if (targetCount > 3) throw new Error(`unexpected window count: ${targetCount}`);
    console.log("E. 重复触发仍 1 个 Quick Note，文本保留  PASS");

    // B. 点击外部应用 → 外部应用成为前台，Quick Note 仍在但不再覆盖最顶层
    focusNotepad();
    await sleep(500);
    const fgAfterExternal = getForegroundInfo();
    if (fgAfterExternal.className !== "Notepad") {
      throw new Error(`Notepad 未成为前台: ${JSON.stringify(fgAfterExternal)}`);
    }
    if (!(await isVisible(quick))) {
      throw new Error("Quick Note 在外部应用获得焦点后不应隐藏");
    }
    const quickHwnd = findWindowHwnd("Tauri Window", "新建提示");
    if (!quickHwnd) throw new Error("找不到 Quick Note 窗口句柄");
    if (isTopmostByHwnd(quickHwnd)) {
      throw new Error("Quick Note 仍为 topmost，层级行为未修复");
    }
    console.log("B. 点击 Notepad 后外部应用前台，Quick Note 保留且非 topmost  PASS");

    // C. 再次 Hotkey → 同一个 Quick Note 回到前台，草稿保留
    sendHotkey(0x7b);
    await sleep(1_000);
    const fgAfterHotkey = getForegroundInfo();
    if (fgAfterHotkey.title !== "新建提示") {
      throw new Error(`Hotkey 后 Quick Note 未回到前台: ${JSON.stringify(fgAfterHotkey)}`);
    }
    const textAfterReturn = await quick.evaluate(
      `document.querySelector('textarea[aria-label="正文"]')?.value ?? null`,
    );
    if (textAfterReturn !== "global hotkey runtime test") {
      throw new Error(`再次唤醒后草稿丢失: ${textAfterReturn}`);
    }
    console.log("C. 再次 Hotkey 同一窗口回到前台，草稿保留  PASS");

    // D. 最小化 Quick Note → Hotkey → 同一窗口恢复并获得焦点
    const quickHwndD = findWindowHwnd("Tauri Window", "新建提示");
    minimizeWindowByHwnd(quickHwndD);
    await sleep(500);
    if (!isMinimizedByHwnd(quickHwndD)) {
      throw new Error("Quick Note 未进入最小化状态");
    }
    focusNotepad();
    sendHotkey(0x7b);
    await sleep(1_000);
    if (isMinimizedByHwnd(quickHwndD)) {
      throw new Error("Hotkey 后 Quick Note 仍处于最小化");
    }
    if (!(await isVisible(quick))) {
      throw new Error("Hotkey 后 Quick Note 不可见");
    }
    const fgAfterUnminimize = getForegroundInfo();
    if (fgAfterUnminimize.title !== "新建提示") {
      throw new Error(`Hotkey 后 Quick Note 未聚焦: ${JSON.stringify(fgAfterUnminimize)}`);
    }
    const textAfterUnminimize = await quick.evaluate(
      `document.querySelector('textarea[aria-label="正文"]')?.value ?? null`,
    );
    if (textAfterUnminimize !== "global hotkey runtime test") {
      throw new Error(`最小化唤醒后草稿丢失: ${textAfterUnminimize}`);
    }
    console.log("D. 最小化 Quick Note → Hotkey 恢复同一窗口并聚焦，草稿保留  PASS");

    // F. 关闭 Quick Note
    await hideWindow(quick, "quick-note");
    await waitWindowHidden("quick-note");
    console.log("F. Quick Note 关闭  PASS");

    // G. Settings UI 修改为 Ctrl + F11
    const settingsClient = await changeHotkeyViaSettingsUi("F11");
    moveAgentTipsAway();
    await waitFor(
      async () =>
        Boolean(
          await settingsClient.tryEval(
            `document.body.textContent.includes('已更新 Ctrl + F11')`,
          ),
        ),
      { timeout: 10_000, label: "hotkey updated to F11" },
    );
    await assertHotkeyState("F11");
    await hideWindow(settingsClient, "settings");
    console.log("G. Settings UI 修改为 Ctrl + F11  PASS");

    // H. Notepad 前台按 Ctrl + F11 → Quick Note 出现
    focusNotepad();
    sendHotkey(0x7a); // VK_F11
    await waitWindowVisible("quick-note");
    moveAgentTipsAway();
    console.log("H. Ctrl + F11 → Quick Note 出现  PASS");

    // I. 隐藏后按 Ctrl + F12 → 不出现
    await hideWindow(quick, "quick-note");
    await waitWindowHidden("quick-note");
    focusNotepad();
    sendHotkey(0x7b);
    await sleep(1_500);
    if (await isVisible(quick)) throw new Error("OLD Ctrl+F12 still triggers");
    console.log("I. 旧 Ctrl + F12 失效  PASS");

    // J. 重启持久化
    closeAllClients();
    stopApp();
    await waitAppStopped();
    startApp();
    await ensureClient("main");
    await assertHotkeyState("F11");
    focusNotepad();
    sendHotkey(0x7a);
    await waitWindowVisible("quick-note");
    moveAgentTipsAway();
    console.log("J. 重启后 Ctrl + F11 仍生效（持久化）  PASS");

    // 冲突 fixture：Ctrl + F10 被占用 → update 失败，OLD 保持
    startConflictFixture();
    await sleep(1_000);
    const main2 = await ensureClient("main");
    let updateResult = null;
    await waitFor(
      async () => {
        const r = await main2.tryEval(
          `window.__TAURI_INTERNALS__.invoke('hotkey_update', { modifier: 'Ctrl', keyCode: 'F10' }).then(
            (v) => ({ ok: true, value: v }),
            (e) => ({ ok: false, error: { code: e.code, message: e.message } }),
          )`,
        );
        if (r && r !== null && r !== undefined) {
          updateResult = r;
          return true;
        }
        return false;
      },
      { timeout: 20_000, label: "conflict update result" },
    );
    if (updateResult.ok) {
      throw new Error(`F10 update should fail, got ${JSON.stringify(updateResult)}`);
    }
    if (updateResult.error.code !== "HOTKEY_REGISTRATION_FAILED") {
      throw new Error(`expected HOTKEY_REGISTRATION_FAILED, got ${JSON.stringify(updateResult)}`);
    }
    const stateAfter = await main2.tryEval(
      `window.__TAURI_INTERNALS__.invoke('hotkey_get')`,
    );
    if (stateAfter.configured?.keyCode !== "F11" || stateAfter.active?.keyCode !== "F11") {
      throw new Error(`conflict must keep F11: ${JSON.stringify(stateAfter)}`);
    }
    console.log("冲突 fixture：Ctrl + F10 注册失败，OLD 保持 F11  PASS");

    console.log("GLOBAL HOTKEY = PASS");
  } finally {
    closeAllClients();
    if (fixtureProcess) killProcessTree(fixtureProcess.pid);
    if (notepadProcess) {
      try {
        notepadProcess.kill();
      } catch {
        /* ignore */
      }
    }
    stopApp();
    await waitAppStopped().catch(() => {});
    if (logDir) rmSync(logDir, { recursive: true, force: true });
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`GLOBAL HOTKEY = FAIL: ${error.message}`);
  process.exit(1);
});
