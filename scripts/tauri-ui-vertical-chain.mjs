/**
 * 真实 Tauri UI 垂直链路验收。
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
import { createWriteStream, rmSync } from "node:fs";
import { join } from "node:path";
import { makeLogDir, makeTestDataDir, killProcessTree, sleep, waitFor } from "./lib/runtime-test-utils.mjs";

const CDP_PORT = 9222;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
/** E2E 隔离：所有测试写入独立 app data 目录，绝不触碰真实用户数据库 */
const TEST_DATA_DIR = makeTestDataDir("tauri-ui");
let appProcess = null;
let logFiles = null;

function runPython(code) {
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, AGENTTIPS_TEST_DATA_DIR: TEST_DATA_DIR },
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
db = os.path.join(os.environ['AGENTTIPS_TEST_DATA_DIR'], 'agenttips.sqlite3')
if not os.path.exists(db):
    print(0)
    raise SystemExit
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
db = os.path.join(os.environ['AGENTTIPS_TEST_DATA_DIR'], 'agenttips.sqlite3')
if not os.path.exists(db):
    print("0|0")
    raise SystemExit
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

async function listPageTargets() {
  const response = await fetch(CDP_ENDPOINT);
  const targets = await response.json();
  return targets.filter((target) => target.type === "page");
}

/** 通过 DOM data-window 识别窗口身份并连接（生产 Tauri 中页面身份来自 WebviewWindow label） */
async function connectWindow(kind, { timeout = 60_000 } = {}) {
  await waitFor(
    async () => {
      const targets = await listPageTargets();
      for (const target of targets) {
        const probe = new CdpClient(target.webSocketDebuggerUrl);
        try {
          await probe.open();
          const current =
            (await probe.evaluate(
              `document.querySelector('[data-window]')?.getAttribute('data-window') ?? null`,
            )) ?? null;
          if (current === kind) return true;
          probe.close();
        } catch {
          try {
            probe.close();
          } catch {
            /* ignore */
          }
        }
      }
      return false;
    },
    { timeout, label: `window ${kind}` },
  );
  const targets = await listPageTargets();
  for (const target of targets) {
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    const current = await client.evaluate(
      `document.querySelector('[data-window]')?.getAttribute('data-window') ?? null`,
    );
    if (current === kind) return client;
    client.close();
  }
  throw new Error(`window ${kind} not found`);
}

/** 打开窗口并连接到对应 target（生产 Tauri 中由 WindowManager 统一创建/复用窗口） */
async function openWindow(fromClient, kind) {
  const command = {
    "quick-note": "window_open_quick_note",
    settings: "window_open_settings",
    main: "window_open_main",
  }[kind];
  await fromClient.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)})`);
  await sleep(400);
  return connectWindow(kind);
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

  async waitWindow(windowKind) {
    const expressions = {
      "quick-note": `document.querySelector('textarea[aria-label="正文"]') !== null`,
      main: `document.body.textContent.includes("AgentTips")`,
      settings: `Boolean(document.querySelector('[data-testid="hotkey-display"]'))`,
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
  logFiles = makeLogDir("tauri-ui");
  const stdoutFile = join(logFiles, "tauri-ui.stdout.log");
  const stderrFile = join(logFiles, "tauri-ui.stderr.log");
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
  if (!appProcess) {
    return;
  }
  killProcessTree(appProcess.pid);
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
    const el = document.querySelector('[role="dialog"] textarea[aria-label="正文"]');
    if (!el) throw new Error('未找到详情正文');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function detailContent(client) {
  return client.evaluate(
    `document.querySelector('[role="dialog"] textarea[aria-label="正文"]')?.value ?? null`,
  );
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

async function clickByAria(client, label) {
  const ok = await client.evaluate(`(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`未找到 aria-label: ${label}`);
  }
  await sleep(150);
}

async function pickAgent(client, agentName) {
  // 竞态根因：Quick Note reset 后 React 尚未完成渲染，测试过早点击。
  // 正确流程：等待 reset 完成（按钮可见且 enabled）→ 重新获取最新 DOM →
  // 点击一次 → 等待菜单项；失败则关闭菜单、重新定位，最多重试 2 次。
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    await client.waitForExpression(
      `(() => {
        const btn = [...document.querySelectorAll('button')].find(
          (b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled,
        );
        return !!btn;
      })()`,
      `添加 Agent 按钮就绪`,
      5_000,
    );
    const found = await client.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find((b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled);
      if (!target) return false;
      target.dataset.pickAgent = '1';
      return true;
    })()`);
    if (!found) throw new Error("未找到添加 Agent 按钮");
    await realClick(client, 'button[data-pick-agent="1"]');
    try {
      await client.waitForExpression(
        `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes(${JSON.stringify(agentName)}))`,
        `菜单项 ${agentName}`,
        3_000,
      );
      break;
    } catch {
      await client.evaluate(`document.body.click()`);
      await sleep(400);
      if (attempt === 2) {
        const diag = await client.evaluate(
          `JSON.stringify({
            buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 8),
            menuitems: [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim()),
            body: document.body.textContent.slice(0, 200),
          })`,
        );
        throw new Error(`菜单项 ${agentName} 未出现: ${diag}`);
      }
    }
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
  // 目标式切换：已等于目标直接返回；否则只点击一次并等待，最多一轮重试。
  let after = await switchValue(client, label);
  if (String(after) !== String(checked)) {
    await clickByLabel(client, label);
    await sleep(200);
    after = await switchValue(client, label);
    if (String(after) !== String(checked)) {
      await clickByLabel(client, label);
      await sleep(200);
      after = await switchValue(client, label);
    }
  }
  if (String(after) !== String(checked)) {
    throw new Error(`开关 ${label} 未切换为 ${checked}`);
  }
}

async function openTipByTitle(client, title) {
  const searchOpen = await client.evaluate(
    `Boolean(document.querySelector('input[aria-label="搜索便签"]'))`,
  );
  if (!searchOpen) {
    await clickByLabel(client, "搜索");
  }
  await setInput(client, "搜索便签", title);
  // 主窗口列表刷新依赖 window focus 事件；跨窗口新建 Tip 后主窗口可能未
  // 获得真实焦点变化，这里显式触发一次刷新，避免依赖 OS 前台时序。
  await client.evaluate(`window.dispatchEvent(new Event('focus'))`);
  await sleep(300);
  await client.waitForExpression(
    `[...document.querySelectorAll('[data-window="main"] [data-testid="tip-card"]')].some((b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(title)})`,
    `卡片 ${title}`,
  );
  const ok = await client.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-window="main"] [data-testid="tip-card"]')];
    const target = cards.find(
      (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(title)},
    );
    if (!target) return false;
    const expand = target.querySelector('button[aria-label="展开详情"]');
    if (!expand) return false;
    expand.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`展开卡片失败: ${title}`);
  }
  try {
    await client.waitForExpression(
      `document.querySelector('[role="dialog"] input[aria-label="标题"]') !== null`,
      "详情打开",
      5_000,
    );
  } catch (error) {
    const diag = await client.evaluate(
      `JSON.stringify({
        cards: [...document.querySelectorAll('[data-window="main"] [data-testid="tip-card"]')].map((b) => b.querySelector('input[aria-label="标题"]')?.value ?? ''),
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
  const titlePrefix = "垂直链路UI";
  const uniqueTitle = `${titlePrefix}-${Date.now()}`;
  const updatedContent = `${uniqueTitle} 修改后正文`;
  const errorPrefix = "错误路径";
  const errorTitle = `${errorPrefix}-${Date.now()}`;
  const errorEdited = `${errorTitle} 修改后仍保留`;
  let client = null;
  let mainClient;

  try {
    // 从干净数据库开始：清理历史失败的测试残留（测试数据清理，非业务操作）
    sqliteCleanupPrefix(titlePrefix);
    sqliteCleanupPrefix(errorPrefix);

    // ---- 启动 ----
    startApp();
    mainClient = await connectWindow("main");
    client = mainClient;
    console.log("app started");

    // ---- adapter 断言 ----
    await client.waitForExpression(
      `Boolean(document.querySelector('[data-desktop-adapter]'))`,
      "adapter 标识",
    );
    await assertAdapter(client);

    // ---- 创建 ----
    client = await openWindow(mainClient, "quick-note");
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
    client = mainClient;
    await openWindow(mainClient, "main");
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

    // ---- Living Notes：首页 inline 修改 → autosave → reload 验证 ----
    client = mainClient;
    await openWindow(mainClient, "main");
    await client.waitWindow("main");
    const searchVisible = await client.evaluate(
      `Boolean(document.querySelector('[aria-label="搜索"]'))`,
    );
    if (searchVisible) {
      await clickByAria(client, "搜索");
    }
    await setInput(client, "搜索便签", uniqueTitle);
    await client.waitForExpression(
      `[...document.querySelectorAll('[data-testid="tip-card"]')].some((b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)})`,
      `卡片 ${uniqueTitle}`,
    );
    const inlineEdit = await client.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="tip-card"]')].find(
        (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)},
      );
      if (!card) return false;
      const ta = card.querySelector('textarea[aria-label="正文"]');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(updatedContent)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!inlineEdit) throw new Error("首页 inline 修改失败");
    // 等 autosave（650ms debounce + 往返）
    await client.waitForExpression(
      `(async () => {
        const list = await window.__TAURI_INTERNALS__.invoke('tip_list', { query: { search: ${JSON.stringify(
          uniqueTitle,
        )} } });
        return list.some((t) => t.content === ${JSON.stringify(updatedContent)});
      })()`,
      "inline autosave 持久化",
      8_000,
    );
    console.log("inline edit + autosave via UI ok ✓");

    // ---- 首页输入大量文字 → 卡片变高（真实浏览器） ----
    await client.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="tip-card"]')].find(
        (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)},
      );
      if (!card) return;
      const ta = card.querySelector('textarea[aria-label="正文"]');
      const longText = Array.from({ length: 15 }, (_, i) => '第 ' + (i + 1) + ' 行内容').join('\\n');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, longText);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(900);
    const growInfo = await client.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="tip-card"]')].find(
        (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)},
      );
      if (!card) return null;
      const ta = card.querySelector('textarea[aria-label="正文"]');
      return {
        cardH: Math.round(card.getBoundingClientRect().height),
        taH: Math.round(ta.getBoundingClientRect().height),
        taScroll: ta.scrollHeight,
        w: Math.round(card.getBoundingClientRect().width),
      };
    })()`);
    if (!growInfo || growInfo.taH < 80 || growInfo.taScroll > growInfo.taH + 2) {
      throw new Error(`卡片未自适应增长: ${JSON.stringify(growInfo)}`);
    }
    console.log("auto-grow via UI ok ✓", JSON.stringify(growInfo));

    // ---- 首页直接输入额外内容并验证 autosave 失败保留（利用 error path 单独覆盖） ----
    // ---- Mark Used → 首页消失 ----
    const colorBefore = await client.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="tip-card"]')].find(
        (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)},
      );
      return card?.getAttribute('data-color') ?? null;
    })()`);
    await client.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="tip-card"]')].find(
        (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)},
      );
      card?.querySelector('button[aria-label="标记已使用"]')?.click();
    })()`);
    await client.waitForExpression(
      `document.body.textContent.includes("已移至「已使用」")`,
      "已使用 Toast",
    );
    await client.waitForExpression(
      `![...document.querySelectorAll('[data-testid="tip-card"]')].some((b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)})`,
      "首页移除",
    );
    console.log("mark used via UI ok ✓");

    // ---- Used View：找到同色 Tip → Restore ----
    await sleep(400);
    const clicked = await client.evaluate(`(() => {
      const el = document.querySelector('[aria-label="更多操作"]');
      if (!el) return false;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error("更多操作按钮不存在");
    await sleep(400);
    await client.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes('已使用便签'))`,
      "已使用菜单项",
    );
    await client.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      items.find((el) => (el.textContent ?? '').includes('已使用便签'))?.click();
    })()`);
    await client.waitForExpression(
      `document.body.textContent.includes("已使用") && [...document.querySelectorAll('[data-testid="tip-card"]')].some((b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)})`,
      "Used View 显示该 Tip",
    );
    const colorInUsed = await client.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="tip-card"]')].find(
        (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)},
      );
      return card?.getAttribute('data-color') ?? null;
    })()`);
    if (colorBefore !== colorInUsed) {
      throw new Error(`Used View 颜色变化: ${colorBefore} -> ${colorInUsed}`);
    }
    console.log("used view color preserved ✓");
    await client.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="tip-card"]')].find(
        (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)},
      );
      card?.querySelector('button[aria-label="恢复到首页"]')?.click();
    })()`);
    await client.waitForExpression(
      `document.body.textContent.includes("AgentTips") && !document.body.textContent.includes("还没有便签")`,
      "restore 回首页",
    );
    const restoreDiag = await client.evaluate(`(() => {
      const list = window.__TAURI_INTERNALS__.invoke('tip_list', { query: { search: ${JSON.stringify(
        uniqueTitle,
      )} } });
      return list;
    })()`);
    const restored =
      Array.isArray(restoreDiag) &&
      restoreDiag.some(
        (t) => t.title === uniqueTitle && (t.usedAt === null || t.usedAt === undefined),
      );
    if (!restored) throw new Error("Restore 后 usedAt 未清空");
    console.log("restore via UI ok ✓ (color 不变, usedAt 清空)");

    // ---- 重启持久化 ----
    client.close();
    stopApp();
    await waitAppStopped();
    startApp();
    mainClient = await connectWindow("main");
    client = mainClient;
    await client.waitForExpression(
      `Boolean(document.querySelector('[data-desktop-adapter]'))`,
      "重启后 adapter 标识",
    );
    await assertAdapter(client);
    await openWindow(mainClient, "main");
    await client.waitWindow("main");
    await clickByAria(client, "搜索");
    await setInput(client, "搜索便签", uniqueTitle);
    await client.waitForExpression(
      `[...document.querySelectorAll('[data-testid="tip-card"]')].some((b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)})`,
      `重启后卡片 ${uniqueTitle}`,
    );
    const colorAfterRestart = await client.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="tip-card"]')].find(
        (b) => (b.querySelector('input[aria-label="标题"]')?.value ?? '') === ${JSON.stringify(uniqueTitle)},
      );
      return card?.getAttribute('data-color') ?? null;
    })()`);
    if (colorAfterRestart !== colorBefore) {
      throw new Error(`重启后颜色变化: ${colorBefore} -> ${colorAfterRestart}`);
    }
    await openTipByTitle(client, uniqueTitle);
    await client.waitForExpression(
      `(document.querySelector('[role="dialog"] textarea[aria-label="正文"]')?.value ?? '').includes('第 15 行内容')`,
      "editor 加载完整正文",
      5_000,
    );
    const content2 = await detailContent(client);
    if (!content2?.includes("第 15 行内容")) {
      throw new Error(`重启后正文未持久化: ${content2?.slice(0, 40)}`);
    }
    console.log("restart persistence + color stable via UI ok ✓ (15 行正文保留)");

    // ---- UI 删除（overflow menu，Editor 仍打开）----
    await realClick(client, '[role="dialog"] [aria-label="更多操作"]');
    await client.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes('删除'))`,
      "删除菜单项",
    );
    await client.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      const target = items.find((el) => (el.textContent ?? '').includes('删除'));
      target?.click();
    })()`);
    await client.waitForExpression(
      `document.body.textContent.includes("删除后无法恢复")`,
      "确认对话框",
    );
    const confirmed = await client.evaluate(`(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      const confirm = dialogs.find((d) => d.textContent.includes('删除后无法恢复'));
      if (!confirm) return false;
      const button = [...confirm.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === '删除' && !b.disabled,
      );
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!confirmed) {
      throw new Error("未找到删除确认按钮");
    }
    await sleep(600);
    await client.waitForExpression(
      `document.body.textContent.includes("还没有便签")`,
      "删除后空态",
      20_000,
    );
    console.log("delete via UI ok ✓");
    sqliteAssertClean(titlePrefix);

    // ---- 真实错误路径 ----
    client = await openWindow(mainClient, "quick-note");
    await client.waitWindow("quick-note");
    await setTextarea(client, "正文", errorTitle);
    await pickAgent(client, "Cursor");
    await clickButton(client, "保存");
    await client.waitForExpression(
      `document.querySelector('[role="status"]')?.textContent.includes("已保存")`,
      "错误路径创建成功",
    );
    client = mainClient;
    await openWindow(mainClient, "main");
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
    client = mainClient;
    await openWindow(mainClient, "main");
    await client.waitWindow("main");
    console.log("app alive after error path ✓");

    // ---- 未实现能力降级 ----
    client = await openWindow(mainClient, "settings");
    await client.waitWindow("settings");
    const hotkeyBefore = await client.evaluate(`document.querySelector('[data-testid="hotkey-display"]').textContent`);
    await clickButton(client, "重新录制");
    await client.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))`);
    await client.waitForExpression(
      `document.body.textContent.includes("已更新 Ctrl + K")`,
      "快捷键真实更新成功",
    );
    const hotkeyAfter = await client.evaluate(`document.querySelector('[data-testid="hotkey-display"]').textContent`);
    if (hotkeyBefore !== "Ctrl + F12" || hotkeyAfter !== "Ctrl + K") {
      throw new Error(`快捷键更新异常 before=${hotkeyBefore} after=${hotkeyAfter}`);
    }
    console.log("settings hotkey real update ok ✓ (Ctrl + F12 -> Ctrl + K, 立即生效)");

    // 本脚本不重复覆盖 Reminder 原生运行链路；浏览器状态由 E2E、原生行为由专用 runtime test 覆盖。
    console.log("reminder coverage delegated to browser E2E and dedicated runtime test ✓");
    assertNoConsoleErrors(client, "degraded-pages");

    // ---- 主管理与快捷不受影响 ----
    client = mainClient;
    await openWindow(mainClient, "main");
    await client.waitWindow("main");
    client = await openWindow(mainClient, "quick-note");
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
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`VERTICAL CHAIN (UI) = FAIL: ${error.message}`);
  process.exit(1);
});
