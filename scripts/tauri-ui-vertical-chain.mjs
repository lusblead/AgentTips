/**
 * Phase 2.1 真实 Tauri UI 垂直链路验收。
 *
 * 通过 WebView2 CDP 操作真实页面 DOM（点击/输入/键盘/路由切换）完成
 * 完整 CRUD，禁止直接调用 window.__TAURI_INTERNALS__.invoke 完成业务操作。
 *
 * 用法：
 *   node scripts/tauri-ui-vertical-chain.mjs
 * 或：
 *   pnpm test:tauri-ui
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CDP_PORT = 9222;
const DEV_URL = "http://localhost:1420";
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
let appProcess = null;
let logFiles = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeout = 60_000, interval = 250, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return true;
      }
    } catch {
      /* retry */
    }
    await sleep(interval);
  }
  throw new Error(`等待超时: ${label}`);
}

function runPython(code) {
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`python 执行失败: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function sqliteDeleteByTitle(title, prefix) {
  const code = `
import sqlite3, os
from datetime import datetime, timezone
db = os.path.join(os.environ['APPDATA'], 'com.agenttips.app', 'agenttips.sqlite3')
conn = sqlite3.connect(db)
cur = conn.cursor()
rows = cur.execute("SELECT id FROM tips WHERE title LIKE ? AND deleted_at IS NULL", ('${prefix}%',)).fetchall()
ids = [r[0] for r in rows]
if ids:
    cur.execute("UPDATE tips SET deleted_at = ? WHERE id IN ({})".format(",".join("?"*len(ids))), [datetime.now(timezone.utc).isoformat()] + ids)
    cur.execute("DELETE FROM tip_agents WHERE tip_id IN ({})".format(",".join("?"*len(ids))), ids)
conn.commit()
print(len(ids))
conn.close()
`;
  return Number(runPython(code));
}

function sqliteAssertClean(prefix) {
  const code = `
import sqlite3, os
db = os.path.join(os.environ['APPDATA'], 'com.agenttips.app', 'agenttips.sqlite3')
conn = sqlite3.connect(db)
cur = conn.cursor()
alive = cur.execute("SELECT COUNT(*) FROM tips WHERE title LIKE ? AND deleted_at IS NULL", ('${prefix}%',)).fetchone()[0]
bound = cur.execute("SELECT COUNT(*) FROM tip_agents WHERE tip_id IN (SELECT id FROM tips WHERE title LIKE ?)", ('${prefix}%',)).fetchone()[0]
print(f"{alive}|{bound}")
conn.close()
`;
  const [alive, bound] = runPython(code).split("|").map(Number);
  if (alive !== 0) {
    throw new Error(`数据库仍存在未删除测试记录 ${alive} 条`);
  }
  if (bound !== 0) {
    throw new Error(`数据库仍存在测试绑定 ${bound} 条`);
  }
  console.log("db clean: alive=0 bound=0");
}

function sqliteCleanupPrefix(prefix) {
  const code = `
import sqlite3, os
from datetime import datetime, timezone
db = os.path.join(os.environ['APPDATA'], 'com.agenttips.app', 'agenttips.sqlite3')
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

async function getTargetUrl() {
  const response = await fetch(CDP_ENDPOINT);
  const targets = await response.json();
  const page = targets.find((target) => target.type === "page");
  return page?.webSocketDebuggerUrl ?? null;
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
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
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
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(`exceptionThrown: ${JSON.stringify(message.params.exceptionDetails)}`);
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        this.errors.push(`log: ${message.params.entry.text}`);
      }
      if (
        message.method === "Runtime.consoleAPICalled" &&
        message.params.type === "error"
      ) {
        this.errors.push("console.error: " + JSON.stringify(message.params.args));
      }
    };
    await this.send("Runtime.enable");
    await this.send("Log.enable");
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
      throw new Error(`evaluate 失败: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result.value;
  }

  async switchRoute(windowKind, extra = {}) {
    const url = new URL(`${DEV_URL}/`);
    url.searchParams.set("window", windowKind);
    for (const [key, value] of Object.entries(extra)) {
      url.searchParams.set(key, value);
    }
    await this.evaluate(`(() => {
      history.pushState({}, "", ${JSON.stringify(url.toString())});
      window.dispatchEvent(new PopStateEvent("popstate"));
    })()`);
    await sleep(150);
  }

  async waitWindow(windowKind) {
    const expressions = {
      "quick-note": `document.querySelector('textarea[aria-label="正文"]') !== null`,
      main: `document.body.textContent.includes("提示库") && document.querySelector('input[aria-label="搜索便签"]') !== null`,
      settings: `Boolean(document.querySelector('[data-testid="hotkey-display"]'))`,
      reminder: `document.querySelector('[role="alert"]') !== null`,
    };
    const expression = expressions[windowKind];
    if (!expression) {
      throw new Error(`未知窗口: ${windowKind}`);
    }
    await this.waitForExpression(expression, `窗口 ${windowKind}`, 15_000);
  }

  async waitForExpression(expression, label = expression, timeout = 15_000) {
    await waitFor(
      async () => {
        const value = await this.evaluate(expression);
        return Boolean(value);
      },
      { timeout, label },
    );
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

function startApp() {
  const stdoutFile = join(logFiles, "tauri-ui.stdout.log");
  const stderrFile = join(logFiles, "tauri-ui.stderr.log");
  const child = spawn("pnpm.cmd", ["tauri", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
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
  if (!appProcess) {
    return;
  }
  try {
    spawnSync("taskkill", ["/pid", String(appProcess.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  appProcess = null;
}

async function waitAppStopped() {
  await waitFor(async () => {
    try {
      const response = await fetch(CDP_ENDPOINT);
      await response.text();
      return false;
    } catch {
      try {
        const response = await fetch("http://127.0.0.1:1420/");
        await response.text();
        return false;
      } catch {
        return true;
      }
    }
  }, { timeout: 30_000, label: "应用完全退出" });
  await sleep(1000);
}

async function connect() {
  await waitFor(async () => (await getTargetUrl()) !== null, {
    timeout: 120_000,
    label: "CDP target 出现",
  });
  const url = await getTargetUrl();
  const client = new CdpClient(url);
  await client.open();
  return client;
}

async function assertAdapter(client) {
  const adapter = await client.evaluate(
    `document.querySelector('[data-desktop-adapter]')?.getAttribute('data-desktop-adapter') ?? null`,
  );
  if (adapter !== "tauri") {
    throw new Error(`desktop adapter 应为 tauri，实际为 ${adapter}`);
  }
  console.log("desktop adapter = tauri ✓");
}

async function setTextarea(client, ariaLabel, text) {
  await client.evaluate(`(() => {
    const el = document.querySelector('textarea[aria-label=${JSON.stringify(ariaLabel)}]');
    if (!el) throw new Error('未找到 textarea: ' + ${JSON.stringify(ariaLabel)});
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function setInput(client, ariaLabel, text) {
  await client.evaluate(`(() => {
    const el = document.querySelector('input[aria-label=${JSON.stringify(ariaLabel)}]');
    if (!el) throw new Error('未找到 input: ' + ${JSON.stringify(ariaLabel)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function setDetailTextarea(client, text) {
  await client.evaluate(`(() => {
    const el = document.querySelector('#detail-content');
    if (!el) throw new Error('未找到详情正文 #detail-content');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function detailContent(client) {
  return client.evaluate(`document.querySelector('#detail-content')?.value ?? null`);
}

async function clickButton(client, text) {
  const ok = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((b) => (b.textContent ?? '').trim().includes(${JSON.stringify(text)}) && !b.disabled);
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`未找到可点击按钮: ${text}`);
  }
}

async function realClick(client, selector) {
  const box = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) {
    throw new Error(`真实点击目标不存在: ${selector}`);
  }
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

async function clickDialogButton(client, text) {
  const ok = await client.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    const buttons = [...dialog.querySelectorAll('button')];
    const target = buttons.find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(text)} && !b.disabled);
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`未找到对话框按钮: ${text}`);
  }
}

async function clickByLabel(client, label) {
  const ok = await client.evaluate(`(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`未找到 aria-label: ${label}`);
  }
}

async function pickAgent(client, agentName) {
  // 找到"添加 Agent"按钮并用真实鼠标点击
  const found = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled);
    if (!target) return false;
    target.dataset.pickAgent = '1';
    return true;
  })()`);
  if (!found) {
    throw new Error("未找到添加 Agent 按钮");
  }
  await realClick(client, 'button[data-pick-agent="1"]');
  try {
    await client.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes(${JSON.stringify(agentName)}))`,
      `菜单项 ${agentName}`,
      5_000,
    );
    } catch (error) {
      const diag = await client.evaluate(
      `JSON.stringify({
        buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 8),
        menuitems: [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim()),
        body: document.body.textContent.slice(0, 200),
      })`,
    );
      throw new Error(`菜单项 ${agentName} 未出现: ${diag}`, { cause: error });
  }
  const ok = await client.evaluate(`(() => {
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    const target = items.find((el) => (el.textContent ?? '').includes(${JSON.stringify(agentName)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`点击菜单项失败: ${agentName}`);
  }
  await sleep(150);
}

async function switchValue(client, label) {
  return client.evaluate(
    `document.querySelector('[aria-label=${JSON.stringify(label)}]')?.getAttribute('aria-checked') ?? null`,
  );
}

async function setSwitch(client, label, checked) {
  await client.waitForExpression(
    `Boolean(document.querySelector('[aria-label=${JSON.stringify(label)}]'))`,
    `开关 ${label}`,
  );
  const current = await switchValue(client, label);
  if (String(current) !== String(checked)) {
    await clickByLabel(client, label);
    await sleep(100);
  }
  const after = await switchValue(client, label);
  if (String(after) !== String(checked)) {
    throw new Error(`开关 ${label} 未切换为 ${checked}`);
  }
}

async function openTipByTitle(client, title) {
  await setInput(client, "搜索便签", title);
  await client.waitForExpression(
    `[...document.querySelectorAll('[data-window="main"] button[aria-pressed]')].some((b) => (b.textContent ?? '').includes(${JSON.stringify(title)}))`,
    `卡片 ${title}`,
  );
  const ok = await client.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-window="main"] button[aria-pressed]')];
    const target = cards.find((b) => (b.textContent ?? '').includes(${JSON.stringify(title)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`点击卡片失败: ${title}`);
  }
  try {
    await client.waitForExpression(
      `document.querySelector('#detail-title') !== null`,
      "详情打开",
      5_000,
    );
  } catch (error) {
    const diag = await client.evaluate(
      `JSON.stringify({
        cards: [...document.querySelectorAll('[data-window="main"] button[aria-pressed]')].map((b) => b.getAttribute('aria-pressed') + ':' + b.textContent.slice(0, 30)),
        labels: [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label')),
        body: document.body.textContent.slice(0, 150),
      })`,
    );
    throw new Error(`详情未打开: ${diag}`, { cause: error });
  }
}

function assertNoConsoleErrors(client, phase) {
  const realErrors = client.errors.filter(
    (entry) => !entry.includes("favicon") && !entry.includes("DevTools"),
  );
  if (realErrors.length > 0) {
    throw new Error(`[${phase}] 控制台存在未处理错误: ${realErrors.join(" | ")}`);
  }
  console.log(`[${phase}] console errors: none ✓`);
}

async function run() {
  logFiles = mkdtempSync(join(tmpdir(), "agenttips-tauri-ui-"));
  const titlePrefix = "垂直链路UI";
  const uniqueTitle = `${titlePrefix}-${Date.now()}`;
  const updatedContent = `${uniqueTitle} 修改后正文`;
  const errorPrefix = "错误路径";
  const errorTitle = `${errorPrefix}-${Date.now()}`;
  const errorEdited = `${errorTitle} 修改后仍保留`;
  let client = null;

  try {
    // 从干净数据库开始：清理历史失败的测试残留（测试数据清理，非业务操作）
    sqliteCleanupPrefix(titlePrefix);
    sqliteCleanupPrefix(errorPrefix);

    // ---- 启动 ----
    startApp();
    client = await connect();
    console.log("app started");

    // ---- adapter 断言 ----
    await client.waitForExpression(
      `Boolean(document.querySelector('[data-desktop-adapter]'))`,
      "adapter 标识",
    );
    await assertAdapter(client);

    // ---- 创建 ----
    await client.switchRoute("quick-note");
    await client.waitWindow("quick-note");
    await setTextarea(client, "正文", uniqueTitle);
    await pickAgent(client, "Cursor");
    await pickAgent(client, "Claude Code");
    await client.waitForExpression(`Boolean(document.querySelector('[aria-label="Cursor 默认携带"]'))`, "绑定行");
    await setSwitch(client, "Claude Code 默认携带", false);
    await clickButton(client, "保存");
    await client.waitForExpression(
      `document.querySelector('[role="status"]')?.textContent.includes("已保存")`,
      "保存成功反馈",
    );
    console.log("create via UI ok ✓");

    // ---- 主页面验证 ----
    await client.switchRoute("main");
    await client.waitWindow("main");
    await openTipByTitle(client, uniqueTitle);
    const content1 = await detailContent(client);
    const cursor1 = await switchValue(client, "Cursor 默认携带");
    const claude1 = await switchValue(client, "Claude Code 默认携带");
    if (content1 !== uniqueTitle || cursor1 !== "true" || claude1 !== "false") {
      throw new Error(`创建验证失败 content=${content1} cursor=${cursor1} claude=${claude1}`);
    }
    console.log("read back via UI ok ✓ (autoAttach 独立: cursor=true, claude=false)");
    assertNoConsoleErrors(client, "create+read");

    // ---- 重启持久化 ----
    client.close();
    stopApp();
    await waitAppStopped();
    startApp();
    client = await connect();
    await client.waitForExpression(
      `Boolean(document.querySelector('[data-desktop-adapter]'))`,
      "重启后 adapter 标识",
    );
    await assertAdapter(client);
    await client.switchRoute("main");
    await client.waitWindow("main");
    await openTipByTitle(client, uniqueTitle);
    const content2 = await detailContent(client);
    if (content2 !== uniqueTitle) {
      throw new Error(`重启后正文丢失: ${content2}`);
    }
    console.log("restart persistence via UI ok ✓");

    // ---- UI 修改正文 + 替换绑定 ----
    await setDetailTextarea(client, updatedContent);
    await clickByLabel(client, "移除 Claude Code");
    await setSwitch(client, "Cursor 默认携带", false);
    await clickButton(client, "保存修改");
    await client.waitForExpression(
      `document.body.textContent.includes("已保存")`,
      "修改保存反馈",
    );
    await client.switchRoute("main");
    await client.waitWindow("main");
    await openTipByTitle(client, updatedContent);
    const content3 = await detailContent(client);
    const cursor3 = await switchValue(client, "Cursor 默认携带");
    const hasClaude = await client.evaluate(`Boolean(document.querySelector('[aria-label="Claude Code 默认携带"]'))`);
    if (content3 !== updatedContent || cursor3 !== "false" || hasClaude) {
      throw new Error(`修改验证失败 content=${content3} cursor=${cursor3} claudeRemoved=${!hasClaude}`);
    }
    console.log("update via UI ok ✓ (正文已改、绑定替换为仅 Cursor、autoAttach=false)");

    // ---- UI 删除（overflow menu）----
    await realClick(client, '[aria-label="更多操作"]');
    await client.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes('删除'))`,
      "删除菜单项",
    );
    await client.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      const target = items.find((el) => (el.textContent ?? '').includes('删除'));
      target?.click();
    })()`);
    await client.waitForExpression(`Boolean(document.querySelector('[role="dialog"]'))`, "确认对话框");
    await clickDialogButton(client, "删除");
    await client.waitForExpression(
      `document.body.textContent.includes("没有匹配的提示")`,
      "删除后搜索无结果",
      20_000,
    );
    console.log("delete via UI ok ✓");
    sqliteAssertClean(titlePrefix);

    // ---- 真实错误路径 ----
    await client.switchRoute("quick-note");
    await client.waitWindow("quick-note");
    await setTextarea(client, "正文", errorTitle);
    await pickAgent(client, "Cursor");
    await clickButton(client, "保存");
    await client.waitForExpression(
      `document.querySelector('[role="status"]')?.textContent.includes("已保存")`,
      "错误路径创建成功",
    );
    await client.switchRoute("main");
    await client.waitWindow("main");
    await openTipByTitle(client, errorTitle);
    sqliteDeleteByTitle(errorTitle, errorPrefix);
    await setDetailTextarea(client, errorEdited);
    await clickButton(client, "保存修改");
    await client.waitForExpression(
      `document.querySelector('[role="alert"]') !== null`,
      "NOT_FOUND 错误提示",
    );
    const alertText = await client.evaluate(`document.querySelector('[role="alert"]').textContent`);
    const keptInput = await detailContent(client);
    if (!alertText.includes("不存在")) {
      throw new Error(`未显示 NOT_FOUND: ${alertText}`);
    }
    if (keptInput !== errorEdited) {
      throw new Error(`失败后输入丢失: ${keptInput}`);
    }
    console.log(`real error path ok ✓ (alert="${alertText}", 输入保留)`);
    assertNoConsoleErrors(client, "error-path");
    // 应用仍可用
    await client.switchRoute("main");
    await client.waitWindow("main");
    console.log("app alive after error path ✓");

    // ---- 未实现能力降级 ----
    await client.switchRoute("settings");
    await client.waitWindow("settings");
    const hotkeyBefore = await client.evaluate(`document.querySelector('[data-testid="hotkey-display"]').textContent`);
    await clickButton(client, "重新录制");
    await client.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))`);
    await client.waitForExpression(
      `document.body.textContent.includes("该能力将在系统功能启用后生效")`,
      "快捷键中性占位提示",
    );
    const hotkeyAfter = await client.evaluate(`document.querySelector('[data-testid="hotkey-display"]').textContent`);
    if (hotkeyBefore !== "Ctrl + F12" || hotkeyAfter !== "Ctrl + F12") {
      throw new Error(`快捷键降级异常 before=${hotkeyBefore} after=${hotkeyAfter}`);
    }
    console.log("settings degraded ok ✓ (中性占位提示、快捷键保持 F12)");

    await client.switchRoute("reminder");
    await client.waitForExpression(
      `document.body.textContent.includes("不提供预览")`,
      "提醒中性占位提示",
    );
    console.log("reminder degraded ok ✓ (中性占位提示、不白屏)");
    assertNoConsoleErrors(client, "degraded-pages");

    // ---- 主管理与快捷不受影响 ----
    await client.switchRoute("main");
    await client.waitWindow("main");
    await client.switchRoute("quick-note");
    await client.waitWindow("quick-note");
    console.log("main & quick-note unaffected ✓");

    // ---- 数据库最终干净 ----
    sqliteAssertClean(titlePrefix);
    sqliteAssertClean(errorPrefix);
    assertNoConsoleErrors(client, "final");
    console.log("VERTICAL CHAIN (UI) = PASS");
  } finally {
    client?.close();
    stopApp();
    await waitAppStopped().catch(() => {});
    rmSync(logFiles, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`VERTICAL CHAIN (UI) = FAIL: ${error.message}`);
  process.exit(1);
});
