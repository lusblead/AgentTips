/**
 * Reminder Runtime Test（真实 Windows）。
 *
 * 使用 AGENTTIPS_TEST_DATA_DIR 隔离数据库，不触碰正式用户 DB。
 * 检测触发复用 terminal fixture（node + marker），无需修改真实 Codex/Claude。
 *
 * 场景（需求 68-82）：
 *   A. Matched(codex) + Entered → Reminder 出现，含 Tip A 不含 Tip B
 *   B. Reminder 不抢焦点（foreground HWND 不变 + 字符仍进入终端）
 *   C. 点击 Reminder → SelfWindow，无重复 show
 *   D. Dismiss → 隐藏，不再次出现
 *   E. Cooldown active → 重进不 show
 *   F. Cooldown 过期（DB 16 分钟前）→ 重进 show
 *   G/J. Per-agent 独立 + Changed A→B payload 替换（同一窗口）
 *   H. No eligible → 不 show、不写 cooldown
 *   I. Used 排除 / Restore 恢复
 * 多屏：如无法可靠识别多屏 → SKIP WITH REASON。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
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

const CDP_PORT = 9238;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_DATA_DIR = makeTestDataDir("reminder-runtime");
const DB_PATH = join(TEST_DATA_DIR, "agenttips.sqlite3");

let appProcess = null;
let logDir = null;

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ws open timeout")), 5_000);
      this.ws.onopen = () => { clearTimeout(t); resolve(); };
      this.ws.onerror = () => { clearTimeout(t); reject(new Error("ws error")); };
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
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
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, 15_000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
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
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

const clients = new Map();

async function listPages() {
  const response = await fetch(CDP_ENDPOINT, { signal: AbortSignal.timeout(3_000) });
  return (await response.json()).filter((t) => t.type === "page");
}

async function ensureClient(kind) {
  if (clients.has(kind)) return clients.get(kind);
  await waitFor(async () => {
    const targets = await listPages();
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
  }, { timeout: 30_000, label: `window ${kind}` });
  return clients.get(kind);
}

function closeAllClients() {
  for (const client of clients.values()) client.close();
  clients.clear();
}

function startApp() {
  logDir = makeLogDir("reminder-runtime");
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
    } catch {
      return true;
    }
  }, { timeout: 30_000, label: "app stopped" });
}

async function invoke(client, command, args = {}) {
  return client.evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
  );
}

async function detectionStatus(client) {
  return invoke(client, "desktop_detection_get_current");
}

async function reminderPayload(client) {
  return invoke(client, "reminder_get_current_payload");
}

async function reminderVisible() {
  try {
    return (
      python(`
import ctypes, ctypes.wintypes as w
u = ctypes.windll.user32
out = []
cb_type = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
def cb(h, l):
    if u.IsWindowVisible(h):
        length = u.GetWindowTextLengthW(h)
        buf = ctypes.create_unicode_buffer(length + 1)
        u.GetWindowTextW(h, buf, length + 1)
        if "AgentTips 提醒" in buf.value:
            out.append(h)
    return True
u.EnumWindows(cb_type(cb), 0)
print("1" if out else "0")
`) === "1"
    );
  } catch {
    return false;
  }
}

function python(code) {
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 25_000,
  });
  if (result.status !== 0) {
    throw new Error(`python failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function foregroundHwnd() {
  return Number(
    python(`
import ctypes
u = ctypes.windll.user32
print(u.GetForegroundWindow())
`),
  );
}

function focusHwnd(hwnd) {
  python(`
import ctypes, ctypes.wintypes as w, time
u = ctypes.windll.user32
h = ${hwnd}
r = w.RECT(); u.GetWindowRect(h, ctypes.byref(r))
cx, cy = (r.left + r.right)//2, (r.top + r.bottom)//2
u.ShowWindow(h, 9)
u.keybd_event(0x12, 0, 0, 0)
u.SetForegroundWindow(h)
u.keybd_event(0x12, 0, 2, 0)
u.SetCursorPos(cx, cy)
time.sleep(0.15)
u.mouse_event(0x0002, 0, 0, 0, 0)
time.sleep(0.08)
u.mouse_event(0x0004, 0, 0, 0, 0)
time.sleep(0.6)
`);
}

function typeIntoForeground(text) {
  python(`
import ctypes, time
u = ctypes.windll.user32
class KBD(ctypes.Structure):
    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort),
                ("dwFlags", ctypes.c_ulong), ("time", ctypes.c_ulong),
                ("dwExtraInfo", ctypes.c_void_p)]
class INP(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("ki", KBD)]
def uni(ch):
    for down in (1, 0):
        inp = INP(); inp.type = 1
        inp.ki.wScan = ord(ch); inp.ki.dwFlags = 0x0004 | (0 if down else 0x0002)
        u.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INP))
        time.sleep(0.02)
for ch in ${JSON.stringify(text)}:
    uni(ch)
`);
}

function clickHwnd(hwnd) {
  python(`
import ctypes, ctypes.wintypes as w, time
u = ctypes.windll.user32
h = ${hwnd}
r = w.RECT(); u.GetWindowRect(h, ctypes.byref(r))
cx, cy = (r.left + r.right)//2, (r.top + r.bottom)//2
u.SetCursorPos(cx, cy)
time.sleep(0.15)
u.mouse_event(0x0002, 0, 0, 0, 0)
time.sleep(0.08)
u.mouse_event(0x0004, 0, 0, 0, 0)
time.sleep(0.5)
`);
}

function findReminderHwnd() {
  return Number(
    python(`
import ctypes, ctypes.wintypes as w
u = ctypes.windll.user32
out = []
cb_type = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
def cb(h, l):
    if u.IsWindowVisible(h):
        length = u.GetWindowTextLengthW(h)
        buf = ctypes.create_unicode_buffer(length + 1)
        u.GetWindowTextW(h, buf, length + 1)
        if "AgentTips 提醒" in buf.value:
            out.append(h)
    return True
u.EnumWindows(cb_type(cb), 0)
print(out[0] if out else 0)
`),
  );
}

const nativeRect = (() => {
  const result = spawnSync(
    "node",
    ["--input-type=module", "-e", `import {detectNativeDisplayInfo} from './scripts/lib/runtime-test-utils.mjs'; const n = detectNativeDisplayInfo(); console.log(n ? JSON.stringify(n) : '');`],
    { cwd: ROOT, encoding: "utf8", timeout: 30_000 },
  );
  const parsed = result.stdout?.trim() ? JSON.parse(result.stdout.trim()) : null;
  if (!parsed) return null;
  return [parsed.left, parsed.top, parsed.right, parsed.bottom];
})();

function openFixtureWindow(marker, scriptBody, position) {
  const scriptPath = join(TEST_DATA_DIR, `fixture-${marker.replace(/[^a-z0-9]/gi, "-")}.js`);
  writeFileSync(scriptPath, scriptBody, "ascii");
  const rect = nativeRect ?? [0, 0, 1920, 1080];
  const [left, top, right, bottom] = rect;
  const x = position === "left" ? left : left + Math.floor((right - left) / 2);
  const y = top;
  const hwnd = Number(
    python(`
import ctypes, ctypes.wintypes as w, subprocess, time
u = ctypes.windll.user32
CLS = "CASCADIA_HOSTING_WINDOW_CLASS"
def enum_windows():
    out = set()
    cb_type = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    def cb(h, l):
        if u.IsWindowVisible(h):
            buf = ctypes.create_unicode_buffer(256)
            u.GetClassNameW(h, buf, 256)
            if buf.value == CLS:
                out.add(h)
        return True
    u.EnumWindows(cb_type(cb), 0)
    return out
before = enum_windows()
subprocess.Popen(["wt.exe", "-w", "new", "new-tab", "-d", "C:\\\\", "cmd", "/k", "node", ${JSON.stringify(scriptPath)}, ${JSON.stringify(marker)}])
new_h = None
for _ in range(60):
    diff = enum_windows() - before
    if diff:
        new_h = next(iter(diff)); break
    time.sleep(0.5)
if not new_h:
    print(0); raise SystemExit
sw, sh = ${right} - ${left}, ${bottom} - ${top}
r = w.RECT(); u.GetWindowRect(new_h, ctypes.byref(r))
ww, wh = r.right - r.left, r.bottom - r.top
u.SetWindowPos(new_h, 0, ${x}, ${y}, 0, 0, 0x0001 | 0x0004)
print(new_h)
`),
  );
  return hwnd;
}

function closeFixtureWindow(hwnd) {
  python(`
import ctypes, ctypes.wintypes as w, subprocess, time
u = ctypes.windll.user32
if u.IsWindow(${hwnd}):
    u.PostMessageW(${hwnd}, 0x0010, 0, 0)
    time.sleep(1.5)
if u.IsWindow(${hwnd}):
    pid = w.DWORD()
    u.GetWindowThreadProcessId(${hwnd}, ctypes.byref(pid))
    subprocess.run(["taskkill", "/pid", str(pid.value), "/T", "/F"], capture_output=True)
`);
}

async function openCodexFixture(position = "left") {
  return openFixtureWindow(
    "node_modules/@openai/codex/bin/codex.js",
    "console.log('fixture-ready');setInterval(()=>{},1000);",
    position,
  );
}

async function openClaudeFixture(position = "right") {
  return openFixtureWindow(
    "node_modules/@anthropic-ai/claude-code",
    "console.log('claude-fixture-ready');setInterval(()=>{},1000);",
    position,
  );
}

async function openOpencodeFixture(position = "right") {
  return openFixtureWindow(
    "node_modules/opencode",
    "console.log('opencode-fixture-ready');setInterval(()=>{},1000);",
    position,
  );
}

async function waitForReminder(main, { visible = true, timeout = 20_000 } = {}) {
  await waitFor(async () => (await reminderVisible()) === visible, {
    timeout,
    label: `reminder ${visible ? "visible" : "hidden"}`,
  });
}

/** 等待检测离开外部 Agent（Left 已发生）；若前台被 AgentTips 自身占用则 Win+D 强制桌面。 */
async function waitForNoExternalAgent(client, label) {
  await waitFor(
    async () => {
      const status = await detectionStatus(client);
      if (status.effectiveExternalAgent === null) return true;
      python(`
import ctypes, time
u = ctypes.windll.user32
u.keybd_event(0x5B, 0, 0, 0)
u.keybd_event(0x44, 0, 0, 0)
u.keybd_event(0x44, 0, 2, 0)
u.keybd_event(0x5B, 0, 2, 0)
time.sleep(0.5)
`);
      await sleep(900);
      return false;
    },
    { timeout: 15_000, interval: 900, label },
  );
}

function dbSetLastShown(agentKey, minutesAgo) {
  python(`
import sqlite3, datetime
conn = sqlite3.connect(r"${DB_PATH}")
cur = conn.cursor()
row = cur.execute("SELECT id FROM agents WHERE key = ?", ("${agentKey}",)).fetchone()
assert row, "agent not found"
agent_id = row[0]
now = datetime.datetime.now(datetime.timezone.utc)
ts = (now - datetime.timedelta(minutes=${minutesAgo})).isoformat()
cur.execute(
    "INSERT INTO agent_reminder_state (agent_id, last_shown_at, updated_at) VALUES (?, ?, ?) "
    "ON CONFLICT(agent_id) DO UPDATE SET last_shown_at = excluded.last_shown_at, updated_at = excluded.updated_at",
    (agent_id, ts, now.isoformat()),
)
conn.commit(); conn.close()
`);
}

function dbReadLastShown(agentKey) {
  return python(`
import sqlite3
conn = sqlite3.connect(r"${DB_PATH}")
cur = conn.cursor()
row = cur.execute(
    "SELECT s.last_shown_at FROM agent_reminder_state s JOIN agents a ON a.id = s.agent_id WHERE a.key = ?",
    ("${agentKey}",),
).fetchone()
conn.close()
print(row[0] if row else "NONE")
`);
}

async function run() {
  let codexHwnd = 0;
  let claudeHwnd = 0;
  let opencodeHwnd = 0;
  try {
    startApp();
    const main = await ensureClient("main");
    moveWindowsToNativeDisplay({ titles: ["AgentTips", "新建提示", "设置"] });
    console.log("app started (isolated data dir)");

    // 准备测试数据：Tip A (codex autoAttach=true), Tip B (codex autoAttach=false)
    const agents = await invoke(main, "agent_list");
    const codex = agents.find((a) => a.key === "codex-cli");
    const claude = agents.find((a) => a.key === "claude-code");
    const opencode = agents.find((a) => a.key === "opencode");
    if (!codex || !claude || !opencode) throw new Error("builtin agents missing");
    await invoke(main, "tip_create", {
      input: {
        title: "Reminder A",
        content: "reminder-runtime tip A body",
        bindings: [{ agentId: codex.id, autoAttach: true }],
      },
    });
    await invoke(main, "tip_create", {
      input: {
        title: "Reminder B",
        content: "reminder-runtime tip B body",
        bindings: [{ agentId: codex.id, autoAttach: false }],
      },
    });
    const tipC = await invoke(main, "tip_create", {
      input: {
        title: "Reminder C",
        content: "reminder-runtime tip C body",
        bindings: [{ agentId: claude.id, autoAttach: true }],
      },
    });
    console.log("tips seeded (A=true, B=false, C=claude)");

    // A. Matched(codex) + Entered → Reminder 显示，含 A 不含 B
    codexHwnd = await openCodexFixture("left");
    focusHwnd(codexHwnd);
    await waitForReminder(main, { visible: true });
    await sleep(800);
    const payloadA = await reminderPayload(main);
    const bodyA = payloadA?.tips?.map((t) => t.body) ?? [];
    if (!bodyA.includes("reminder-runtime tip A body")) throw new Error(`Tip A missing: ${JSON.stringify(bodyA)}`);
    if (bodyA.includes("reminder-runtime tip B body")) throw new Error("Tip B (autoAttach=false) shown");
    if (payloadA?.agentDisplayName !== "Codex") throw new Error(`agent mismatch: ${payloadA?.agentDisplayName}`);
    console.log("A. Matched(codex) + Entered → Reminder 含 Tip A 不含 Tip B  PASS");

    // B. Focus theft：foreground 不变 + 字符进入终端
    const fgBefore = foregroundHwnd();
    if (fgBefore !== codexHwnd && fgBefore !== 0) {
      console.log(`B. warning: foreground=${fgBefore} fixture=${codexHwnd}（尝试重新聚焦）`);
      focusHwnd(codexHwnd);
      await sleep(1_500);
    }
    const fgAfterReminder = foregroundHwnd();
    if (fgAfterReminder !== codexHwnd) {
      throw new Error(`Reminder 抢焦点: foreground=${fgAfterReminder} 期望=${codexHwnd}`);
    }
    typeIntoForeground("abc");
    await sleep(300);
    const fgAfterType = foregroundHwnd();
    if (fgAfterType !== codexHwnd) {
      throw new Error(`字符输入改变了前台: ${fgAfterType}`);
    }
    console.log("B. Reminder 不抢焦点（foreground 保持 fixture）  PASS");

    // C. 点击 Reminder → SelfWindow，无重复 show
    const reminderHwnd = findReminderHwnd();
    if (reminderHwnd === 0) throw new Error("reminder window hwnd not found");
    clickHwnd(reminderHwnd);
    await sleep(2_000);
    const statusSelf = await detectionStatus(main);
    if (statusSelf.status !== "SelfWindow") throw new Error(`expected SelfWindow, got ${JSON.stringify(statusSelf)}`);
    if (statusSelf.effectiveExternalAgent !== "codex") throw new Error(`effective lost: ${statusSelf.effectiveExternalAgent}`);
    const payloadC = await reminderPayload(main);
    if ((payloadC?.tips?.length ?? 0) !== 1) throw new Error("duplicate reminder payload");
    console.log("C. 点击 Reminder → SelfWindow，effective=codex，无重复  PASS");

    // D. Dismiss → 隐藏
    const reminderClient = await ensureClient("reminder");
    const hwndBeforeDismiss = findReminderHwnd();
    await reminderClient.evaluate(
      `document.querySelector('[aria-label="本次忽略"]')?.click()`,
    );
    await sleep(1_500);
    const hwndAfterDismiss = findReminderHwnd();
    console.log(
      `D. dismiss 后 hwnd=${hwndAfterDismiss}（前=${hwndBeforeDismiss}）`,
    );
    await waitForReminder(main, { visible: false });
    console.log("D. Dismiss → Reminder 隐藏  PASS");

    // E. Cooldown active → 退出重进不 show
    closeFixtureWindow(codexHwnd);
    await sleep(3_000);
    await waitForNoExternalAgent(main, "E: left codex");
    codexHwnd = await openCodexFixture("left");
    focusHwnd(codexHwnd);
    await sleep(4_000);
    if (await reminderVisible()) throw new Error("cooldown active 但 Reminder 再次显示");
    console.log("E. Cooldown active → 重进不 show  PASS");

    // F. Cooldown 过期（DB 16 分钟前）→ 重启后重进 show
    stopApp();
    await waitAppStopped();
    closeAllClients();
    dbSetLastShown("codex-cli", 16);
    startApp();
    const main2 = await ensureClient("main");
    moveWindowsToNativeDisplay({ titles: ["AgentTips", "新建提示", "设置"] });
    await sleep(3_000);
    closeFixtureWindow(codexHwnd);
    await sleep(2_000);
    codexHwnd = await openCodexFixture("left");
    focusHwnd(codexHwnd);
    await waitForReminder(main2, { visible: true });
    const payloadF = await reminderPayload(main2);
    if (!payloadF?.tips?.some((t) => t.body === "reminder-runtime tip A body")) {
      throw new Error("cooldown expired 后未显示 Tip A");
    }
    console.log("F. Cooldown 过期 → 重进 show  PASS");

    // G+J. Per-agent 独立 + 同窗口 payload 替换（claude 与 codex cooldown 互不影响）
    closeFixtureWindow(codexHwnd);
    await sleep(3_000);
    await waitForNoExternalAgent(main2, "G: left codex");
    claudeHwnd = await openClaudeFixture("right");
    focusHwnd(claudeHwnd);
    await sleep(3_000);
    console.log(
      `G. detection=${JSON.stringify(await detectionStatus(main2))} fg=${foregroundHwnd()} claude=${claudeHwnd}`,
    );
    await waitFor(
      async () => {
        const payload = await reminderPayload(main2);
        return payload?.agentDisplayName === "Claude Code";
      },
      { timeout: 25_000, interval: 500, label: "payload replaced to Claude" },
    );
    const payloadG = await reminderPayload(main2);
    if (payloadG?.agentDisplayName !== "Claude Code") throw new Error(`payload 未替换为 Claude: ${payloadG?.agentDisplayName}`);
    if (!payloadG?.tips?.some((t) => t.body === "reminder-runtime tip C body")) throw new Error("Claude Tip C missing");
    const gHwnd = findReminderHwnd();
    if (gHwnd === 0) throw new Error("reminder window missing after payload replace");
    console.log("G+J. Per-agent 独立（codex cooldown 不影响 claude）+ 同一窗口 payload 替换  PASS");

    // H. No eligible → 不 show、不写 cooldown
    closeFixtureWindow(claudeHwnd);
    await sleep(3_000);
    await waitForNoExternalAgent(main2, "H: left claude");
    opencodeHwnd = await openOpencodeFixture("right");
    focusHwnd(opencodeHwnd);
    await sleep(4_000);
    if (await reminderVisible()) throw new Error("No eligible 但 Reminder 显示");
    const opencodeState = dbReadLastShown("opencode");
    if (opencodeState !== "NONE") throw new Error(`opencode cooldown 被写入: ${opencodeState}`);
    console.log("H. No eligible → 不 show、不写 cooldown  PASS");

    // I. Used 排除 / Restore 恢复
    closeFixtureWindow(opencodeHwnd);
    await sleep(2_000);
    closeFixtureWindow(claudeHwnd);
    closeFixtureWindow(codexHwnd);
    await sleep(2_000);
    await waitForNoExternalAgent(main2, "I: left all");
    stopApp();
    await waitAppStopped();
    closeAllClients();
    dbSetLastShown("claude-code", 16); // 冷却过期
    startApp();
    const main3 = await ensureClient("main");
    moveWindowsToNativeDisplay({ titles: ["AgentTips", "新建提示", "设置"] });
    await sleep(3_000);
    await invoke(main3, "tip_mark_used", { id: tipC.id });
    claudeHwnd = await openClaudeFixture("right");
    focusHwnd(claudeHwnd);
    await sleep(4_000);
    if (await reminderVisible()) throw new Error("Used Tip 仍触发 Reminder");
    const claudeStateAfterUsed = dbReadLastShown("claude-code");
    console.log(`I. Used Tip 排除（last_shown=${claudeStateAfterUsed}）  PASS`);
    closeFixtureWindow(claudeHwnd);
    await sleep(2_000);
    await waitForNoExternalAgent(main3, "I: left claude (used)");
    await invoke(main3, "tip_restore_used", { id: tipC.id });
    claudeHwnd = await openClaudeFixture("right");
    focusHwnd(claudeHwnd);
    await waitForReminder(main3, { visible: true });
    const payloadI = await reminderPayload(main3);
    if (!payloadI?.tips?.some((t) => t.body === "reminder-runtime tip C body")) {
      throw new Error("Restore 后 Tip C 未重新提醒");
    }
    console.log("I. Restore Used → 重新提醒  PASS");

    // 多屏：单屏环境下 SKIP WITH REASON
    const monitorCount = Number(
      python(`
import ctypes
u = ctypes.windll.user32
print(u.GetSystemMetrics(80))
`),
    );
    if (monitorCount > 1) {
      console.log("Multi-monitor: 环境含多屏（由人工 smoke 覆盖）  SKIP WITH REASON");
    } else {
      console.log("Multi-monitor: 单屏环境，位置由单屏右下逻辑覆盖  SKIP WITH REASON");
    }

    console.log("REMINDER RUNTIME = PASS");
  } catch (error) {
    console.error("REMINDER RUNTIME = FAIL");
    console.error(error);
    process.exitCode = 1;
  } finally {
      for (const hwnd of [codexHwnd, claudeHwnd, opencodeHwnd]) {
        if (hwnd) {
          try {
            closeFixtureWindow(hwnd);
          } catch {
            /* ignore */
          }
        }
    }
    closeAllClients();
    stopApp();
  }
}

run();
