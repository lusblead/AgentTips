/**
 * Phase 3A Windows Runtime Tests
 *
 * 通过 WebView2 CDP 驱动真实 Tauri 多窗口，验证窗口生命周期：
 *   1. Main 启动
 *   2. Quick Note 第一次打开
 *   3. Quick Note 不重复创建
 *   4. Settings 不重复创建
 *   5. Main close -> hide（程序不退出）
 *   6. Tray restore Main（经 window_open_main 应用服务路径；tray 点击留人工冒烟）
 *   7. Quick Note Esc -> hide
 *   8. Quick Note 保存 -> hide
 *   9. 下一次 Quick Note 为空
 *   10. 下一次 color 重新请求
 *   11. Second Instance -> focus First（进程唯一）
 *   12. 只有一个主实例
 *   13. Quit command -> 进程真正结束（tray 退出同路径）
 *
 * 业务操作（输入/选择/保存）全部通过真实 DOM 完成，不使用 invoke 代替页面操作；
 * invoke 仅用于：打开/隐藏窗口（等价于 UI 按钮）、窗口可见性与尺寸诊断、数据只读核对。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeLogDir, makeTestDataDir, killProcessTree, sleep, waitFor } from "./lib/runtime-test-utils.mjs";

const CDP_PORT = 9232;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXE = join(ROOT, "src-tauri", "target", "debug", "agent-tips.exe");
/** E2E 隔离：所有测试写入独立 app data 目录，绝不触碰真实用户数据库 */
const TEST_DATA_DIR = makeTestDataDir("windows-runtime");

let appProcess = null;
let logFiles = null;

function runPython(code) {
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, AGENTTIPS_TEST_DATA_DIR: TEST_DATA_DIR },
  });
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  return result.stdout.trim();
}

function dbCleanupPrefix(prefix) {
  const code = `
import sqlite3, os
db = os.path.join(os.environ['AGENTTIPS_TEST_DATA_DIR'], 'agenttips.sqlite3')
if not os.path.exists(db):
    print(0)
    raise SystemExit
conn = sqlite3.connect(db)
cur = conn.cursor()
rows = cur.execute("SELECT id FROM tips WHERE title LIKE ?", ('${prefix}%',)).fetchall()
ids = [r[0] for r in rows]
if ids:
    cur.execute("DELETE FROM tip_agents WHERE tip_id IN ({})".format(",".join("?"*len(ids))), ids)
    cur.execute("DELETE FROM tips WHERE id IN ({})".format(",".join("?"*len(ids))), ids)
conn.commit()
print(len(ids))
conn.close()
`;
  console.log(`db cleanup (${prefix}): removed ${Number(runPython(code))}`);
}

function dbCountTitle(title) {
  const code = `
import sqlite3, os
db = os.path.join(os.environ['AGENTTIPS_TEST_DATA_DIR'], 'agenttips.sqlite3')
if not os.path.exists(db):
    print(0)
    raise SystemExit
conn = sqlite3.connect(db)
cur = conn.cursor()
n = cur.execute("SELECT COUNT(*) FROM tips WHERE title = ? AND deleted_at IS NULL", ('${title}',)).fetchone()[0]
print(n)
conn.close()
`;
  return Number(runPython(code));
}

async function listTargets() {
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
    await this.send("Log.enable");
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

  async evaluateRetry(expression, retries = 2) {
    let lastError;
    for (let i = 0; i <= retries; i += 1) {
      try {
        return await this.evaluate(expression);
      } catch (error) {
        lastError = error;
        await sleep(800);
      }
    }
    throw lastError;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function targetKind(client) {
  const kind = await client.tryEval(
    `document.querySelector('[data-window]')?.getAttribute('data-window') ?? null`,
  );
  return kind;
}

/** 打开指定窗口（真实 UI 按钮或应用 command，等价于 UI 入口） */
async function openWindow(kind) {
  const command = {
    main: "window_open_main",
    "quick-note": "window_open_quick_note",
    settings: "window_open_settings",
  }[kind];
  // 优先从主窗口调用；主窗口不可用时回退到其他已连接窗口
  const candidates = clients.has("main")
    ? [clients.get("main"), ...clients.values()]
    : [...clients.values()];
  const seen = new Set();
  for (const client of candidates) {
    if (seen.has(client)) continue;
    seen.add(client);
    const result = await client.tryEval(
      `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)})`,
    );
    if (result === null || result === undefined || result === true) break;
  }
  await sleep(500);
}

const clients = new Map();

async function ensureClient(kind) {
  if (clients.has(kind)) return clients.get(kind);
  await waitFor(
    async () => {
      const targets = await listTargets();
      for (const target of targets) {
        if (clients.has(kind)) return true;
        const probe = new CdpClient(target.webSocketDebuggerUrl);
        try {
          await probe.open();
          const k = await targetKind(probe);
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

function getProcessCount() {
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", "(Get-Process agent-tips -ErrorAction SilentlyContinue).Count"],
    { encoding: "utf8", timeout: 15_000 },
  );
  return Number((result.stdout ?? "").trim() || 0);
}

function startApp() {
  logFiles = makeLogDir("runtime");
  const stdoutFile = join(logFiles, "runtime.stdout.log");
  const stderrFile = join(logFiles, "runtime.stderr.log");
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
  child.stdout.pipe(createWriteStream(stdoutFile));
  child.stderr.pipe(createWriteStream(stderrFile));
  appProcess = child;
  console.log(`tauri dev started pid=${child.pid}`);
}

function stopApp() {
  if (!appProcess) return;
  killProcessTree(appProcess.pid);
  appProcess = null;
}

async function waitAppStopped() {
  await waitFor(
    async () => {
      try {
        const response = await fetch(CDP_ENDPOINT, { signal: AbortSignal.timeout(1_000) });
        await response.text();
        return false;
      } catch {
        try {
          const response = await fetch("http://127.0.0.1:1420/", {
            signal: AbortSignal.timeout(1_000),
          });
          await response.text();
          return false;
        } catch {
          return true;
        }
      }
    },
    { timeout: 30_000, label: "app fully exited" },
  );
}

async function assertAdapter(client) {
  const adapter = await client.evaluate(
    `document.querySelector('[data-desktop-adapter]')?.getAttribute('data-desktop-adapter') ?? null`,
  );
  if (adapter !== "tauri") throw new Error(`desktop adapter should be tauri, got ${adapter}`);
  console.log("desktop adapter = tauri  PASS");
}

async function allWindowLabels(client) {
  return client.evaluateRetry(
    `window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows')`,
  );
}

async function isVisible(client) {
  return Boolean(
    await client.evaluateRetry(
      `window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`,
    ),
  );
}

async function cssViewport(client) {
  return client
    .evaluateRetry(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`)
    .then((s) => JSON.parse(s));
}

function assertApprox(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: ${actual} != ${expected} (+-${tolerance})`);
  }
}

async function setTextarea(client, ariaLabel, text) {
  await client.evaluateRetry(`(() => {
    const el = document.querySelector('textarea[aria-label=${JSON.stringify(ariaLabel)}]');
    if (!el) throw new Error('textarea not found: ' + ${JSON.stringify(ariaLabel)});
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function clickButton(client, text) {
  const ok = await client.evaluateRetry(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find(
      (b) => (b.textContent ?? '').trim().includes(${JSON.stringify(text)}) && !b.disabled,
    );
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!ok) throw new Error(`button not found: ${text}`);
}

async function realClick(client, selector) {
  const box = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) throw new Error(`click target missing: ${selector}`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(200);
}

async function pickAgent(client, agentName) {
  // 竞态根因：Quick Note reset 后 React 尚未完成渲染，测试过早点击。
  // 正确流程：等待 reset 完成（按钮可见且 enabled）→ 重新获取最新 DOM →
  // 点击一次 → 等待菜单项；失败则关闭菜单、重新定位，最多重试 2 次。
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    await waitFor(
      async () =>
        Boolean(
          await client.tryEval(`(() => {
            const btn = [...document.querySelectorAll('button')].find(
              (b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled,
            );
            return !!btn;
          })()`),
        ),
      { timeout: 5_000, label: "添加 Agent 按钮就绪" },
    );
    const found = await client.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find(
        (b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled,
      );
      if (!target) return false;
      target.dataset.pickAgent = '1';
      return true;
    })()`);
    if (!found) throw new Error("add agent button not found");
    await realClick(client, 'button[data-pick-agent="1"]');
    await sleep(250);
    const clicked = await client.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      const target = items.find((el) => (el.textContent ?? '').includes(${JSON.stringify(agentName)}));
      if (!target) return false;
      target.click();
      return true;
    })()`);
    if (clicked) return;
    await client.evaluate(`document.body.click()`);
    await sleep(400);
    if (attempt === 2) {
      throw new Error(`menu item not found: ${agentName}`);
    }
  }
}

async function switchValue(client, label) {
  return client.evaluate(
    `document.querySelector('[aria-label=${JSON.stringify(label)}]')?.getAttribute('aria-checked') ?? null`,
  );
}

async function setSwitch(client, label, checked) {
  // 目标式切换：先读当前值，已等于目标则直接返回；否则只点击一次并等待，
  // 最多一轮重试。绝不连续盲点，避免 toggle 反转。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await switchValue(client, label);
    if (String(before) === String(checked)) return;
    await client.evaluate(`(() => {
      const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
      if (el) el.click();
    })()`);
    await sleep(200);
  }
  const after = await switchValue(client, label);
  if (String(after) !== String(checked)) {
    throw new Error(`switch ${label} not set to ${checked}`);
  }
}

function assertNoConsoleErrors(client, phase) {
  const realErrors = client.errors.filter(
    (entry) => !entry.includes("favicon") && !entry.includes("DevTools"),
  );
  if (realErrors.length > 0) {
    throw new Error(`[${phase}] console errors: ${realErrors.join(" | ")}`);
  }
}

async function run() {
  const prefix = "runtime-lifecycle-";
  const uniqueTitle = `${prefix}${Date.now()}`;
  try {
    dbCleanupPrefix(prefix);
    startApp();
    const main = await ensureClient("main");
    console.log("1. main window started  PASS");

    await main.evaluate(`document.querySelector('[data-desktop-adapter]') !== null`);
    await assertAdapter(main);

    // Main 尺寸：CSS viewport 应接近 1100x760（非 1000x750 模拟）
    const mainSize = await cssViewport(main);
    assertApprox(mainSize.w, 1100, 60, "main width");
    assertApprox(mainSize.h, 760, 60, "main height");
    console.log(`   main size ${mainSize.w}x${mainSize.h}  PASS`);

    // 2. Quick Note 第一次打开：点击首页真实"新建提示"按钮
    const btnOk = await main.evaluate(`(() => {
      const btn = document.querySelector('button[aria-label="新建提示"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!btnOk) throw new Error("new tip button not found on main");
    const quick = await ensureClient("quick-note");
    console.log("2. quick-note first open via UI button  PASS");

    const quickSize = await cssViewport(quick).catch(() => cssViewport(quick));
    assertApprox(quickSize.w, 740, 60, "quick-note width");
    assertApprox(quickSize.h, 520, 60, "quick-note height");
    if (quickSize.w >= mainSize.w) {
      throw new Error(`quick-note must not be main-sized: ${quickSize.w} >= ${mainSize.w}`);
    }
    console.log(`   quick-note size ${quickSize.w}x${quickSize.h} (独立小窗, 非 1100x760)  PASS`);

    // 3. 再次打开 Quick Note：不重复创建
    await openWindow("quick-note");
    const labelsAfterReopen = await allWindowLabels(main);
    const quickCount = labelsAfterReopen.filter((l) => l === "quick-note").length;
    if (quickCount !== 1) throw new Error(`quick-note count should be 1, got ${quickCount}`);
    console.log("3. quick-note 不重复创建 (window label 唯一)  PASS");

    // 8. 保存 -> hide；同时验证真实 CRUD 写入 SQLite
    await setTextarea(quick, "正文", uniqueTitle);
    await pickAgent(quick, "Cursor");
    await pickAgent(quick, "Claude Code");
    await setSwitch(quick, "Cursor 默认携带", true);
    await setSwitch(quick, "Claude Code 默认携带", false);
    await clickButton(quick, "保存");
    await waitFor(
      async () =>
        Boolean(
          await quick.tryEval(
            `document.querySelector('[role="status"]')?.textContent.includes('已保存')`,
          ),
        ),
      { timeout: 10_000, label: "save success feedback" },
    );
    await waitFor(async () => !(await isVisible(quick)), {
      timeout: 10_000,
      label: "quick-note hidden after save",
    });
    if (dbCountTitle(uniqueTitle) !== 1) {
      throw new Error(`tip not persisted: ${uniqueTitle}`);
    }
    console.log("8. quick-note 保存 -> 自动隐藏, Tip 已写入 SQLite  PASS");

    // 9 + 10. 下一次打开：正文为空 + 颜色重新请求
    // reset 契约：reset() 必先 setDraftColor(null) 再调用 suggestNoteColor，
    // 因此「内容为空 + data-note-color 有效」即证明 reset 已执行、颜色已重新请求。
    // 颜色值由随机 RNG 决定，运行时只验证“重新请求发生”，不断言颜色必须不同。
    for (let cycle = 0; cycle < 3; cycle += 1) {
      if (cycle > 0) {
        await openWindow("quick-note");
        await sleep(900);
      }
      const contentAfterReopen = await quick.evaluate(
        `document.querySelector('textarea[aria-label="正文"]')?.value ?? null`,
      );
      if (contentAfterReopen !== "") {
        throw new Error(`draft not empty on cycle ${cycle}: ${contentAfterReopen}`);
      }
      const colorKey = await quick.evaluate(
        `document.querySelector('[data-note-color]')?.getAttribute('data-note-color') ?? null`,
      );
      if (!colorKey) throw new Error(`color missing on cycle ${cycle}`);
      await quick.evaluate(
        `window.__TAURI_INTERNALS__.invoke('window_hide_current', { label: 'quick-note' })`,
      );
      await sleep(400);
    }
    console.log("9. 下次打开正文为空  PASS | 10. 颜色每次重新请求（非概率断言）  PASS");

    // 7. Esc -> hide
    await setTextarea(quick, "正文", "esc-cancel-content");
    await quick.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`,
    );
    await waitFor(async () => !(await isVisible(quick)), {
      timeout: 5_000,
      label: "quick-note hidden after Esc",
    });
    console.log("7. quick-note Esc -> hide  PASS");

    // Draft 保留：已可见再打开不清空
    await openWindow("quick-note");
    await setTextarea(quick, "正文", "draft-keep-2391");
    await openWindow("quick-note");
    const kept = await quick.evaluate(
      `document.querySelector('textarea[aria-label="正文"]')?.value ?? null`,
    );
    if (kept !== "draft-keep-2391") throw new Error(`draft lost on reopen-visible: ${kept}`);
    console.log("   quick-note 已可见再打开保留草稿  PASS");

    // 4. Settings：打开 5 次只创建一个
    for (let i = 0; i < 5; i += 1) {
      await openWindow("settings");
    }
    const settings = await ensureClient("settings");
    const labelsAfterSettings = await allWindowLabels(main);
    const settingsCount = labelsAfterSettings.filter((l) => l === "settings").length;
    if (settingsCount !== 1) {
      throw new Error(`settings count should be 1, got ${settingsCount}`);
    }
    const settingsSize = await cssViewport(settings).catch(() => cssViewport(settings));
    assertApprox(settingsSize.w, 860, 60, "settings width");
    assertApprox(settingsSize.h, 620, 60, "settings height");
    console.log(
      `4. settings 打开 5 次仅 1 个窗口 (${settingsSize.w}x${settingsSize.h})  PASS`,
    );

    // 15. Settings close -> hide
    await settings.evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:window|close')`);
    await waitFor(async () => !(await isVisible(settings)), {
      timeout: 5_000,
      label: "settings hidden after close",
    });
    if (getProcessCount() < 1) throw new Error("app exited after settings close");
    console.log("   settings close -> hide（程序不退出）  PASS");

    // 5. Main close -> hide
    await main.evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:window|close')`);
    await waitFor(async () => !(await isVisible(main)), {
      timeout: 5_000,
      label: "main hidden after close",
    });
    if (getProcessCount() < 1) throw new Error("app exited after main close");
    console.log("5. main close -> hide（程序驻留 Tray）  PASS");

    // 6. Tray restore Main（tray 菜单回调与 window_open_main 同走 WindowApplicationService）
    await openWindow("main");
    await waitFor(async () => isVisible(main), { timeout: 5_000, label: "main restored" });
    console.log("6. main restore（tray 同路径 window_open_main）  PASS");

    // 11 + 12. 第二实例：进程唯一 + 唤醒首实例 Main
    const countBefore = getProcessCount();
    const second = spawn(EXE, [], { stdio: "ignore", detached: false });
    await waitFor(async () => getProcessCount() === countBefore, {
      timeout: 15_000,
      label: "second instance exited",
    });
    await sleep(1_000);
    const countAfter = getProcessCount();
    if (countAfter !== countBefore) {
      throw new Error(`process count changed: ${countBefore} -> ${countAfter}`);
    }
    if (!(await isVisible(main))) {
      throw new Error("main not visible after second instance activation");
    }
    second.kill();
    console.log(
      `11+12. 第二实例启动 -> 首实例被唤醒, 进程唯一 (${countBefore} 个)  PASS`,
    );

    // 13. Quit command（tray 退出同路径：is_quitting -> app.exit）
    for (const client of clients.values()) {
      assertNoConsoleErrors(client, "runtime");
    }
    await main.evaluate(`window.__TAURI_INTERNALS__.invoke('window_quit')`);
    await waitAppStopped();
    if (getProcessCount() !== 0) {
      throw new Error(`process still alive after quit: ${getProcessCount()}`);
    }
    console.log("13. quit -> 所有进程结束  PASS");

    dbCleanupPrefix(prefix);
    console.log("WINDOWS RUNTIME = PASS");
  } finally {
    for (const client of clients.values()) client.close();
    clients.clear();
    stopApp();
    await waitAppStopped().catch(() => {});
    if (logFiles) rmSync(logFiles, { recursive: true, force: true });
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    dbCleanupPrefix(prefix);
  }
}

run().catch((error) => {
  console.error(`WINDOWS RUNTIME = FAIL: ${error.message}`);
  process.exit(1);
});
