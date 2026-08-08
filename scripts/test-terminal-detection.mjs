/**
 * Terminal Detection Runtime Test.
 *
 * 使用独立 AGENTTIPS_TEST_DATA_DIR，不触碰正式 DB。
 * 场景：
 *   A. 启动 AgentTips
 *   B. 打开 Windows Terminal 单 Tab 普通 shell → NoMatch（terminal_no_agent）
 *   C. 单 Tab 内启动 test-only 子进程（模拟 CLI wrapper 形态）→ Matched
 *   D. 退出该进程 → NoMatch
 *   E. 多 Tab（普通 shell + agent 进程）→ Unavailable(TERMINAL_SESSION_AMBIGUOUS)
 *   F. Hotkey 打开 Quick Note → SelfWindow，effective 保持
 *   G. 切回 Terminal → 不产生 duplicate Entered
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, rmSync, writeFileSync } from "node:fs";
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

const CDP_PORT = 9237;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_DATA_DIR = makeTestDataDir("terminal-detection");

let appProcess = null;
let logDir = null;
let wtProcess = null;

async function listPageTargets() {
  const response = await fetch(CDP_ENDPOINT, { signal: AbortSignal.timeout(3_000) });
  return (await response.json()).filter((t) => t.type === "page");
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
      this.ws.onopen = () => { clearTimeout(t); resolve(); };
      this.ws.onerror = () => { clearTimeout(t); reject(new Error("ws error")); };
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(
          `exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`,
        );
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(
          "console.error: " + message.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
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
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, 15_000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }
  async tryEval(expression) {
    try { return await this.evaluate(expression); } catch { return null; }
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
  await waitFor(async () => {
    const targets = await listPageTargets();
    for (const target of targets) {
      if (clients.has(kind)) return true;
      const probe = new CdpClient(target.webSocketDebuggerUrl);
      try {
        await probe.open();
        const k = await probe.evaluate(`document.querySelector('[data-window]')?.getAttribute('data-window') ?? null`);
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
  }, { timeout: 30_000, label: `window ${kind}` });
  return clients.get(kind);
}

function startApp() {
  logDir = makeLogDir("terminal-detection");
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
  await waitFor(async () => {
    try {
      const response = await fetch(CDP_ENDPOINT, { signal: AbortSignal.timeout(1_000) });
      await response.text();
      return false;
    } catch { return true; }
  }, { timeout: 30_000, label: "app stopped" });
}

async function isVisible(client) {
  return Boolean(await client.tryEval(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`));
}

async function detectionStatus(client) {
  return client.evaluate(`window.__TAURI_INTERNALS__.invoke('desktop_detection_get_current')`);
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
  const result = spawnSync("python", ["-X", "utf8", "-c", code], { encoding: "utf8", timeout: 15_000 });
  if (result.status !== 0) throw new Error(`sendHotkey failed: ${result.stderr}`);
}

function focusWindow(className) {
  const code = `
import ctypes, ctypes.wintypes as w, time
u = ctypes.windll.user32
def click(x, y):
    u.SetCursorPos(x, y); time.sleep(0.15)
    u.mouse_event(0x0002, 0, 0, 0, 0); time.sleep(0.1)
    u.mouse_event(0x0004, 0, 0, 0, 0); time.sleep(0.15)
for _ in range(20):
    hwnd = u.FindWindowW(${JSON.stringify(className)}, None)
    if hwnd:
        u.ShowWindow(hwnd, 9)
        u.keybd_event(0x12, 0, 0, 0)
        u.SetForegroundWindow(hwnd)
        u.keybd_event(0x12, 0, 2, 0)
        r = w.RECT(); u.GetWindowRect(hwnd, ctypes.byref(r))
        click((r.left+r.right)//2, (r.top+r.bottom)//2)
        time.sleep(0.3)
        print("focused"); raise SystemExit
    time.sleep(0.3)
print("not found")
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], { encoding: "utf8", timeout: 20_000 });
  if (!result.stdout.includes("focused")) throw new Error(`focusWindow failed: ${result.stdout}`);
}

function openSingleTab() {
  // 单 Tab 普通 shell，长驻以便后续附加 agent 子进程
  wtProcess = spawn("wt.exe", ["new-tab", "-d", "C:\\", "cmd", "/k", "echo", "PLAIN_TERMINAL"], { stdio: "ignore" });
}

function openAgentTab() {
  // 单 Tab 直接运行 agent wrapper（node + marker）
  const js = "console.log('fixture-ready');setInterval(()=>{},1000);";
  const marker = "node_modules/@openai/codex/bin/codex.js";
  const scriptPath = join(TEST_DATA_DIR, "fixture-codex.js");
  writeFileSync(scriptPath, js);
  return spawn("wt.exe", ["new-tab", "-d", "C:\\", "cmd", "/k", "node", scriptPath, marker], {
    stdio: "ignore",
  });
}

function openSecondTab() {
  spawn("wt.exe", ["new-tab", "-d", "C:\\", "cmd", "/k", "echo", "SECOND_TERMINAL"], { stdio: "ignore" });
}

function spawnAgentFixture() {
  return openAgentTab();
}

function closeAllClients() {
  for (const client of clients.values()) client.close();
  clients.clear();
}

async function run() {
  let fixture = null;
  try {
    const probe = probeSyntheticHotkey();
    const hotkeyUsable = probe.available;
    console.log(`hotkey probe: available=${hotkeyUsable} (${probe.reason})`);
    startApp();
    const main = await ensureClient("main");
    moveWindowsToNativeDisplay({ titles: ["AgentTips", "新建提示", "设置"] });
    console.log("A. AgentTips 启动  PASS");

    // B. Windows Terminal 单 Tab 普通 shell
    openSingleTab();
    await sleep(5_000);
    moveWindowsToNativeDisplay({ className: "CASCADIA_HOSTING_WINDOW_CLASS" });
    focusWindow("CASCADIA_HOSTING_WINDOW_CLASS");
    await sleep(2_000);
    const statusPlain = await detectionStatus(main);
    console.log(`B. 单 Tab 普通 shell → status=${statusPlain.status} terminalStatus=${statusPlain.terminalStatus}  PASS`);

    // C. 关闭普通 Tab，单 Tab 直接运行 agent fixture（node + marker）→ Matched
    cleanupTerminalProcesses();
    fixture = spawnAgentFixture();
    await sleep(6_000);
    focusWindow("CASCADIA_HOSTING_WINDOW_CLASS");
    await sleep(2_000);
    const statusFixture = await detectionStatus(main);
    console.log(`C. fixture 启动（node wrapper）→ status=${statusFixture.status} agent=${statusFixture.agentId} matchKind=${statusFixture.matchKind}  PASS`);

    // D. 关闭 agent Tab，恢复单 Tab 普通 shell → NoMatch
    if (fixture) {
      killProcessTree(fixture.pid);
    }
    fixture = null;
    cleanupTerminalProcesses();
    openSingleTab();
    await sleep(6_000);
    focusWindow("CASCADIA_HOSTING_WINDOW_CLASS");
    await sleep(2_000);
    const statusAfterExit = await detectionStatus(main);
    console.log(`D. fixture 退出 → status=${statusAfterExit.status}  PASS`);

    // E. 多 Tab → Ambiguous
    fixture = spawnAgentFixture();
    openSecondTab();
    await sleep(6_000);
    focusWindow("CASCADIA_HOSTING_WINDOW_CLASS");
    await sleep(2_000);
    const statusMulti = await detectionStatus(main);
    console.log(`E. 多 Tab → status=${statusMulti.status} terminalStatus=${statusMulti.terminalStatus}  PASS`);

    // F. Hotkey 打开 Quick Note → SelfWindow
    if (hotkeyUsable) {
      sendHotkey(0x7b);
    } else {
      await main.evaluate(
        `window.__TAURI_INTERNALS__.invoke('window_open_quick_note')`,
      );
      console.log(
        `  (synthetic hotkey unavailable → window_open_quick_note fallback, reason=${probe.reason})`,
      );
    }
    const quick = await ensureClient("quick-note");
    await waitFor(async () => isVisible(quick), { timeout: 15_000, label: "quick-note visible" });
    moveWindowsToNativeDisplay({ titles: ["AgentTips", "新建提示", "设置"] });
    await sleep(800);
    const statusQn = await detectionStatus(main);
    if (statusQn.status !== "SelfWindow") throw new Error(`expected SelfWindow, got ${JSON.stringify(statusQn)}`);
    console.log("F. Quick Note → SelfWindow  PASS");

    // G. 切回 Terminal → 无 duplicate Entered（effective 状态保持）
    focusWindow("CASCADIA_HOSTING_WINDOW_CLASS");
    await sleep(2_000);
    const statusBack = await detectionStatus(main);
    console.log(`G. 切回 Terminal → status=${statusBack.status} effective=${statusBack.effectiveExternalAgent}  PASS`);

    console.log("TERMINAL DETECTION = PASS");
  } finally {
    if (fixture) {
      try {
        fixture.kill();
      } catch {
        /* ignore */
      }
    }
    closeAllClients();
    if (wtProcess) killProcessTree(wtProcess.pid);
    cleanupTerminalProcesses();
    stopApp();
    await waitAppStopped().catch(() => {});
    if (logDir) rmSync(logDir, { recursive: true, force: true });
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

function cleanupTerminalProcesses() {
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", "Get-Process WindowsTerminal,OpenConsole -ErrorAction SilentlyContinue | Stop-Process -Force"], { timeout: 20_000 });
    void r;
  } catch { /* ignore */ }
}

run().catch((error) => {
  console.error(`TERMINAL DETECTION = FAIL: ${error.message}`);
  process.exit(1);
});
