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
rows = cur.execute("SELECT id FROM tips WHERE content LIKE ?", ('${prefix}%',)).fetchall()
ids = [r[0] for r in rows]
if ids:
    cur.execute("DELETE FROM tip_agents WHERE tip_id IN ({})".format(",".join("?"*len(ids))), ids)
    cur.execute("DELETE FROM tip_tags WHERE tip_id IN ({})".format(",".join("?"*len(ids))), ids)
    cur.execute("DELETE FROM tips WHERE id IN ({})".format(",".join("?"*len(ids))), ids)
conn.commit()
print(len(ids))
conn.close()
`;
  console.log(`db cleanup (${prefix}): removed ${Number(runPython(code))}`);
}

function dbReadTipByContent(content) {
  const code = `
import json, sqlite3, os
db = os.path.join(os.environ['AGENTTIPS_TEST_DATA_DIR'], 'agenttips.sqlite3')
if not os.path.exists(db):
    print(json.dumps({"count": 0, "title": None, "tags": []}))
    raise SystemExit
conn = sqlite3.connect(db)
cur = conn.cursor()
rows = cur.execute("SELECT id, title FROM tips WHERE content = ? AND deleted_at IS NULL", (${JSON.stringify(content)},)).fetchall()
tags = []
if len(rows) == 1:
    tags = [r[0] for r in cur.execute("SELECT t.name FROM tip_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.tip_id = ? ORDER BY tt.sort_order", (rows[0][0],)).fetchall()]
print(json.dumps({"count": len(rows), "title": rows[0][1] if len(rows) == 1 else None, "tags": tags}, ensure_ascii=False))
conn.close()
`;
  return JSON.parse(runPython(code));
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
        reject(new Error(`${method} timeout (pending=${this.pending.size})`));
      }, 20_000);
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

  async evaluateRetry(expression, retries = 3) {
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
  try {
    return Boolean(
      await client.evaluateRetry(
        `window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`,
      ),
    );
  } catch {
    // 第二实例唤醒等场景可能重建 WebView：重新识别窗口再试一次
    for (const [kind, existing] of [...clients.entries()]) {
      existing.close();
      clients.delete(kind);
    }
    const rebuilt = await ensureClient("main");
    // 调用方持有的 client 引用可能已失效，返回新 client（不改变签名，调用方应容忍）
    clients.set("main", rebuilt);
    return Boolean(
      await rebuilt.evaluateRetry(
        `window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`,
      ),
    );
  }
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

async function setTextInput(client, ariaLabel, text) {
  await client.evaluateRetry(`(() => {
    const el = document.querySelector('input[aria-label=${JSON.stringify(ariaLabel)}]');
    if (!el) throw new Error('input not found: ' + ${JSON.stringify(ariaLabel)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
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
  const uniqueContent = `${prefix}${Date.now()}`;
  try {
    dbCleanupPrefix(prefix);
    startApp();
    let main = await ensureClient("main");
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
    assertApprox(quickSize.w, 440, 30, "quick-note width");
    assertApprox(quickSize.h, 380, 30, "quick-note height");
    if (quickSize.w >= mainSize.w) {
      throw new Error(`quick-note must not be main-sized: ${quickSize.w} >= ${mainSize.w}`);
    }
    const quickLayout = await quick.evaluate(`(() => {
      const root = document.documentElement;
      const body = document.querySelector('textarea[aria-label="正文"]');
      const tagInput = document.querySelector('input[aria-label="添加标签"]');
      const bindings = document.querySelector('[data-testid="quick-note-bindings"]');
      const actions = document.querySelector('[data-testid="quick-note-actions"]');
      if (!body || !tagInput || !bindings || !actions) return null;
      const bodyRect = body.getBoundingClientRect();
      const bindingsRect = bindings.getBoundingClientRect();
      const style = getComputedStyle(body);
      return {
        hasTitleControl: Boolean(document.querySelector('[aria-label="标题"]')) ||
          [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '添加标题'),
        horizontalOverflow: root.scrollWidth - root.clientWidth,
        verticalOverflow: root.scrollHeight - root.clientHeight,
        overlap: bodyRect.bottom > bindingsRect.top + 1,
        borderWidth: style.borderWidth,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        backgroundColor: style.backgroundColor,
      };
    })()`);
    if (!quickLayout) throw new Error("quick-note layout elements missing");
    if (quickLayout.hasTitleControl) throw new Error("quick-note must not render a title control");
    if (quickLayout.horizontalOverflow > 0 || quickLayout.verticalOverflow > 0) {
      throw new Error(`quick-note document overflow: ${JSON.stringify(quickLayout)}`);
    }
    if (quickLayout.overlap) throw new Error("quick-note body overlaps the bindings area");
    if (
      quickLayout.borderWidth !== "0px" ||
      quickLayout.borderRadius !== "0px" ||
      quickLayout.boxShadow !== "none" ||
      quickLayout.backgroundColor !== "rgba(0, 0, 0, 0)"
    ) {
      throw new Error(`quick-note body must be frameless: ${JSON.stringify(quickLayout)}`);
    }
    console.log(`   quick-note size ${quickSize.w}x${quickSize.h}, compact frameless layout  PASS`);

    // 3. 再次打开 Quick Note：不重复创建
    await openWindow("quick-note");
    const labelsAfterReopen = await allWindowLabels(main);
    const quickCount = labelsAfterReopen.filter((l) => l === "quick-note").length;
    if (quickCount !== 1) throw new Error(`quick-note count should be 1, got ${quickCount}`);
    console.log("3. quick-note 不重复创建 (window label 唯一)  PASS");

    // 8. 无 Agent 保存 -> hide；未按 Enter 的自由标签也保存，标题保持 NULL。
    await setTextarea(quick, "正文", uniqueContent);
    await setTextInput(quick, "添加标签", "runtime-tag");
    const contentOnlySaveEnabled = await quick.evaluate(
      `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '保存' && !button.disabled)`,
    );
    if (!contentOnlySaveEnabled) throw new Error("content-only quick note must be saveable");
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
    const savedTip = dbReadTipByContent(uniqueContent);
    if (savedTip.count !== 1 || savedTip.title !== null) {
      throw new Error(`titleless tip not persisted correctly: ${JSON.stringify(savedTip)}`);
    }
    if (JSON.stringify(savedTip.tags) !== JSON.stringify(["runtime-tag"])) {
      throw new Error(`pending tag input not persisted: ${JSON.stringify(savedTip)}`);
    }
    console.log("8. quick-note 无标题 + 自由标签 + 无 Agent 保存 -> SQLite 原子写入  PASS");

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
      if (cycle === 1) {
        await quick.evaluate(`(() => {
          const input = document.querySelector('input[aria-label="添加标签"]');
          input?.focus();
          input?.click();
        })()`);
        await waitFor(
          async () =>
            Boolean(
              await quick.tryEval(
                `[...document.querySelectorAll('[role="option"]')].some((option) => option.textContent?.includes('runtime-tag'))`,
              ),
            ),
          { timeout: 5_000, label: "persisted tag appears as reusable suggestion" },
        );
        console.log("   已保存标签在下一次 Quick Note 中可点击复用  PASS");
      }
      await quick.evaluate(
        `window.__TAURI_INTERNALS__.invoke('window_hide_current', { label: 'quick-note' })`,
      );
      await sleep(400);
    }
    console.log("9. 下次打开正文为空  PASS | 10. 颜色每次重新请求（非概率断言）  PASS");

    // 7. Esc 与系统标题栏关闭：非空草稿必须确认，取消后保留，确认后才隐藏
    await openWindow("quick-note");
    await setTextarea(quick, "正文", "esc-cancel-content");
    await quick.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`,
    );
    await waitFor(
      async () =>
        Boolean(
          await quick.tryEval(
            `document.querySelector('[role="dialog"]')?.textContent.includes('放弃这条便签')`,
          ),
        ),
      { timeout: 5_000, label: "discard confirmation after Esc" },
    );
    if (!(await isVisible(quick))) throw new Error("quick-note hidden before discard confirmation");
    const keptAfterEsc = await quick.evaluate(
      `document.querySelector('textarea[aria-label="正文"]')?.value ?? null`,
    );
    if (keptAfterEsc !== "esc-cancel-content") {
      throw new Error(`draft changed before confirmation: ${keptAfterEsc}`);
    }
    await clickButton(quick, "继续编辑");
    await waitFor(
      async () =>
        !(await quick.tryEval(
          `document.querySelector('[role="dialog"]')?.textContent.includes('放弃这条便签')`,
        )),
      { timeout: 5_000, label: "discard confirmation cancelled" },
    );

    await quick.evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:window|close')`);
    await waitFor(
      async () =>
        Boolean(
          await quick.tryEval(
            `document.querySelector('[role="dialog"]')?.textContent.includes('放弃这条便签')`,
          ),
        ),
      { timeout: 5_000, label: "discard confirmation after native close" },
    );
    if (!(await isVisible(quick))) throw new Error("native close bypassed discard confirmation");
    await clickButton(quick, "放弃内容");
    await waitFor(async () => !(await isVisible(quick)), {
      timeout: 5_000,
      label: "quick-note hidden after confirmed discard",
    });
    console.log("7. Esc/native close -> confirm, cancel keeps draft, discard hides  PASS");

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
    const visibleAfterSecond = await isVisible(main);
    if (!visibleAfterSecond) {
      throw new Error("main not visible after second instance activation");
    }
    main = clients.get("main") ?? main;
    second.kill();
    console.log(
      `11+12. 第二实例启动 -> 首实例被唤醒, 进程唯一 (${countBefore} 个)  PASS`,
    );

    // 13. Quit command（tray 退出同路径：is_quitting -> app.exit）
    for (const client of clients.values()) {
      assertNoConsoleErrors(client, "runtime");
    }
    try {
      await main.evaluate(`window.__TAURI_INTERNALS__.invoke('window_quit')`);
    } catch {
      // quit 成功会先关闭 WebView，CDP Promise 可能因此 reject；只有进程仍在时才重连重试。
      let appAlreadyExited = false;
      try {
        await waitFor(async () => getProcessCount() === 0, {
          timeout: 3_000,
          label: "app process exited after quit disconnect",
        });
        appAlreadyExited = true;
      } catch {
        // 第二实例唤醒也可能重建 WebView，此时仍需重连并再次请求退出。
      }
      if (!appAlreadyExited) {
        for (const [kind, existing] of [...clients.entries()]) {
          existing.close();
          clients.delete(kind);
        }
        main = await ensureClient("main");
        await main.evaluate(`window.__TAURI_INTERNALS__.invoke('window_quit')`);
      }
    }
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
