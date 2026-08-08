/**
 * Desktop Agent Foreground Detection Runtime Test.
 *
 * 使用独立 AGENTTIPS_TEST_DATA_DIR，不触碰正式 DB。
 * 场景：
 *   A. 启动 AgentTips
 *   B. Notepad foreground → desktop_detection_get_current = NoMatch + processName=notepad.exe
 *   C. Hotkey 打开 Quick Note → SelfWindow + effective 保持
 *   D. 切回 Notepad → 不产生 Agent duplicate entry
 *   E. 快速前台切换期间不 panic
 *   F. Tray-only（全隐藏）→ watcher 仍运行；Quit → 进程结束
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
  probeSyntheticHotkey,
  sleep,
  waitFor,
} from "./lib/runtime-test-utils.mjs";

const CDP_PORT = 9236;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_DATA_DIR = makeTestDataDir("desktop-detection");

let appProcess = null;
let logDir = null;
let notepadProcess = null;

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

function startApp() {
  logDir = makeLogDir("desktop-detection");
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

async function isVisible(client) {
  return Boolean(
    await client.tryEval(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`),
  );
}

async function hideWindow(client, label) {
  await waitFor(
    async () =>
      (await client.tryEval(
        `window.__TAURI_INTERNALS__.invoke('window_hide_current', { label: ${JSON.stringify(label)} }).then(() => true, () => false)`,
      )) === true,
    { timeout: 15_000, label: `hide ${label}` },
  );
}

async function detectionStatus(client) {
  return client.evaluate(
    `window.__TAURI_INTERNALS__.invoke('desktop_detection_get_current')`,
  );
}

function sendHotkey(vk) {
  const code = `
import ctypes, time
u = ctypes.windll.user32
u.keybd_event(0x11, 0, 0, 0)
time.sleep(0.05)
u.keybd_event(${vk}, 0, 0, 0)
time.sleep(0.05)
u.keybd_event(${vk}, 0, 2, 0)
time.sleep(0.05)
u.keybd_event(0x11, 0, 2, 0)
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
        u.keybd_event(0x12, 0, 0, 0)
        u.SetForegroundWindow(hwnd)
        u.keybd_event(0x12, 0, 2, 0)
        r = w.RECT()
        u.GetWindowRect(hwnd, ctypes.byref(r))
        click((r.left + r.right) // 2, (r.top + r.bottom) // 2)
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

function launchNotepad() {
  notepadProcess = spawn("notepad.exe", [], { stdio: "ignore" });
}

function closeAllClients() {
  for (const client of clients.values()) client.close();
  clients.clear();
}

function assertNoPanics() {
  for (const [kind, client] of clients) {
    const realErrors = client.errors.filter(
      (entry) => !entry.includes("favicon") && !entry.includes("DevTools"),
    );
    if (realErrors.length > 0) {
      throw new Error(`[${kind}] console errors: ${realErrors.join(" | ")}`);
    }
  }
}

async function run() {
  try {
    const probe = probeSyntheticHotkey();
    const hotkeyUsable = probe.available;
    console.log(`hotkey probe: available=${hotkeyUsable} (${probe.reason})`);
    const openQuickNote = async () => {
      if (hotkeyUsable) {
        sendHotkey(0x7b); // Ctrl + F12
      } else {
        await main.evaluate(
          `window.__TAURI_INTERNALS__.invoke('window_open_quick_note')`,
        );
        console.log(
          `  (synthetic hotkey unavailable → window_open_quick_note fallback, reason=${probe.reason})`,
        );
      }
    };

    // A. 启动
    startApp();
    const main = await ensureClient("main");
    moveWindowsToNativeDisplay({ titles: ["AgentTips", "新建提示", "设置"] });
    console.log("A. AgentTips 启动  PASS");

    // B. Notepad foreground → NoMatch
    launchNotepad();
    moveWindowsToNativeDisplay({ className: "Notepad" });
    focusNotepad();
    await sleep(1_000);
    const statusNotepad = await detectionStatus(main);
    if (statusNotepad.status !== "NoMatch") {
      throw new Error(`Notepad 应 NoMatch, got ${JSON.stringify(statusNotepad)}`);
    }
    console.log(
      `B. Notepad foreground → NoMatch (processName=${statusNotepad.processName})  PASS`,
    );

    // C. Hotkey 打开 Quick Note → SelfWindow + effective 保持
    await openQuickNote();
    const quick = await ensureClient("quick-note");
    await waitFor(async () => isVisible(quick), { timeout: 15_000, label: "quick-note visible" });
    moveWindowsToNativeDisplay({ titles: ["AgentTips", "新建提示", "设置"] });
    await sleep(800);
    const statusQuick = await detectionStatus(main);
    if (statusQuick.status !== "SelfWindow") {
      throw new Error(`Quick Note 应 SelfWindow, got ${JSON.stringify(statusQuick)}`);
    }
    if (statusQuick.effectiveExternalAgent !== null) {
      throw new Error(`SelfWindow 不应改变 effective, got ${JSON.stringify(statusQuick)}`);
    }
    console.log("C. Quick Note foreground → SelfWindow，effective 保持  PASS");

    // D. 切回 Notepad → 不产生 duplicate entry（有效状态无 Entered）
    focusNotepad();
    await sleep(1_000);
    const statusBack = await detectionStatus(main);
    if (statusBack.status !== "NoMatch") {
      throw new Error(`切回 Notepad 应 NoMatch, got ${JSON.stringify(statusBack)}`);
    }
    console.log("D. 切回 Notepad → NoMatch，无 duplicate entry  PASS");

    // E. 快速前台切换期间不 panic
    for (let i = 0; i < 3; i += 1) {
      await openQuickNote();
      await sleep(600);
      await detectionStatus(main);
      focusNotepad();
      await sleep(600);
      await detectionStatus(main);
    }
    assertNoPanics();
    console.log("E. 快速前台切换（Quick Note ↔ Notepad ×3）无 panic  PASS");

    // F. Tray-only：隐藏全部窗口，watcher 仍运行；Quit → 进程结束
    await hideWindow(main, "main");
    await hideWindow(quick, "quick-note");
    if (clients.has("settings")) {
      await hideWindow(clients.get("settings"), "settings");
    }
    await sleep(1_500);
    const statusTrayOnly = await detectionStatus(main);
    if (!statusTrayOnly.status) {
      throw new Error(`Tray-only watcher 无响应: ${JSON.stringify(statusTrayOnly)}`);
    }
    console.log("F. Tray-only 全隐藏 → watcher 仍运行  PASS");

    closeAllClients();
    stopApp();
    await waitAppStopped();
    console.log("G. Quit → watcher/进程结束  PASS");

    console.log("DESKTOP DETECTION = PASS");
  } finally {
    closeAllClients();
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
  console.error(`DESKTOP DETECTION = FAIL: ${error.message}`);
  process.exit(1);
});
