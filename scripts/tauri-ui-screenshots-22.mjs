/**
 * Phase 2.2 真实 Tauri UI 截图：通过 WebView2 CDP 在真实应用内截取
 * 主窗口（默认/hover/编辑/空态）、快捷窗口（空白/填写/多 Agent）、
 * 设置页（默认/录制/非法组合）与提醒降级态。
 * reminder-expanded / reminder-collapsed 由 e2e/screenshots.spec.ts 在
 * 浏览器 Mock 模式生成（真实 Tauri 下提醒服务未启用）。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP_PORT = 9227;
const DEV_URL = "http://localhost:1420";
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, "artifacts", "screenshots", "phase-2.2");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeout = 60_000, interval = 250, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return true;
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
  if (result.status !== 0) throw new Error(`python 失败: ${result.stderr}`);
  return result.stdout.trim();
}

function cleanupDb(prefix = "截图演示") {
  const code = `
import sqlite3, os
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
  console.log("db cleanup:", runPython(code));
}

async function getTargetUrl() {
  try {
    const response = await fetch(CDP_ENDPOINT);
    const targets = await response.json();
    return targets.find((target) => target.type === "page")?.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
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
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(`exception: ${JSON.stringify(message.params.exceptionDetails)}`);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push("console.error: " + JSON.stringify(message.params.args));
      }
    };
    await this.send("Runtime.enable");
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
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  async waitForExpression(expression, label = expression, timeout = 15_000) {
    await waitFor(async () => Boolean(await this.evaluate(expression)), { timeout, label });
  }

  async switchRoute(windowKind) {
    const url = new URL(`${DEV_URL}/`);
    url.searchParams.set("window", windowKind);
    await this.evaluate(`(() => {
      history.pushState({}, "", ${JSON.stringify(url.toString())});
      window.dispatchEvent(new PopStateEvent("popstate"));
    })()`);
    await sleep(250);
  }

  async screenshot(name) {
    const result = await this.send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT_DIR, name);
    writeFileSync(file, Buffer.from(result.data, "base64"));
    return file;
  }

  async mouseMove(selector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!box) throw new Error(`hover 目标不存在: ${selector}`);
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: box.x,
      y: box.y,
    });
    await sleep(250);
  }

  async realClick(selector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!box) throw new Error(`点击目标不存在: ${selector}`);
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: box.x,
      y: box.y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: box.x,
      y: box.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(250);
  }

  async pickAgent(agentName) {
    const found = await this.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find((b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled);
      if (!target) return false;
      target.dataset.pickAgent = '1';
      return true;
    })()`);
    if (!found) throw new Error("未找到添加 Agent 按钮");
    await this.realClick('button[data-pick-agent="1"]');
    await this.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes(${JSON.stringify(agentName)}))`,
      `菜单项 ${agentName}`,
    );
    await this.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      const target = items.find((el) => (el.textContent ?? '').includes(${JSON.stringify(agentName)}));
      target?.click();
    })()`);
    await sleep(250);
  }

  async setTextarea(ariaLabel, text) {
    await this.evaluate(`(() => {
      const el = document.querySelector('textarea[aria-label=${JSON.stringify(ariaLabel)}]');
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }

  async setTitle(text) {
    await this.evaluate(`(() => {
      const el = document.querySelector('#detail-title');
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function createDemoTip(client) {
  await client.switchRoute("quick-note");
  await client.waitForExpression(`document.querySelector('textarea[aria-label="正文"]') !== null`, "快捷窗口");
  await client.setTextarea("正文", "截图演示提示：修改前先解释调用链");
  await client.pickAgent("Cursor");
  await client.pickAgent("Claude Code");
  await client.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('保存') && !b.disabled)?.click()`);
  await client.waitForExpression(
    `document.querySelector('[role="status"]')?.textContent.includes("已保存")`,
    "演示数据保存",
  );
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  cleanupDb();

  const logDir = mkdtempSync(join(tmpdir(), "agenttips-shots22-"));
  const child = spawn("pnpm.cmd", ["tauri", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout.pipe(createWriteStream(join(logDir, "out.log")));
  child.stderr.pipe(createWriteStream(join(logDir, "err.log")));

  try {
    await waitFor(async () => (await getTargetUrl()) !== null, {
      timeout: 120_000,
      label: "CDP target",
    });
    const client = new CdpClient(await getTargetUrl());
    await client.open();
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1000,
      height: 750,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(1500);

    const shots = [];

    // 主窗口空态
    await client.switchRoute("main");
    await client.waitForExpression(`document.body.textContent.includes("还没有提示")`, "主窗口空态");
    shots.push(await client.screenshot("main-window-empty.png"));

    // 快捷窗口空白
    await client.switchRoute("quick-note");
    await client.waitForExpression(`document.querySelector('textarea[aria-label="正文"]') !== null`, "快捷窗口");
    shots.push(await client.screenshot("quick-note-empty.png"));

    // 快捷窗口填写 + 单 Agent
    await client.setTextarea("正文", "修改任何核心模块前，先解释调用链与影响范围。");
    await client.pickAgent("Cursor");
    await client.waitForExpression(`Boolean(document.querySelector('[aria-label="Cursor 默认携带"]'))`, "绑定行");
    shots.push(await client.screenshot("quick-note-filled.png"));

    // 快捷窗口多 Agent
    await client.pickAgent("Claude Code");
    await client.waitForExpression(`Boolean(document.querySelector('[aria-label="Claude Code 默认携带"]'))`, "多绑定");
    shots.push(await client.screenshot("quick-note-multiple-agents.png"));

    // 设置页默认 / 录制 / 非法组合
    await client.switchRoute("settings");
    await client.waitForExpression(`Boolean(document.querySelector('[data-testid="hotkey-display"]'))`, "设置页");
    shots.push(await client.screenshot("settings-default.png"));

    await client.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('重新录制') && !x.disabled);
      if (b) b.dataset.rec = '1';
    })()`);
    await client.realClick('button[data-rec="1"]');
    await client.waitForExpression(`document.body.textContent.includes("正在录制")`, "录制状态");
    shots.push(await client.screenshot("settings-recording.png"));

    await client.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true, bubbles: true }))`,
    );
    await client.waitForExpression(
      `document.body.textContent.includes("不能包含 Alt")`,
      "非法组合提示",
    );
    shots.push(await client.screenshot("settings-invalid.png"));

    // 提醒降级态
    await client.switchRoute("reminder");
    await client.waitForExpression(
      `document.body.textContent.includes("不提供预览")`,
      "提醒中性占位",
    );
    shots.push(await client.screenshot("reminder-degraded.png"));

    // 主窗口有数据：默认选中第一条 / hover / 编辑 dirty
    await createDemoTip(client);
    await client.switchRoute("main");
    await client.waitForExpression(`document.body.textContent.includes("截图演示提示")`, "主窗口有数据");
    await client.waitForExpression(`Boolean(document.querySelector('#detail-title'))`, "详情打开");
    shots.push(await client.screenshot("main-window.png"));

    await client.mouseMove('[data-window="main"] button[aria-pressed]');
    shots.push(await client.screenshot("main-window-hover.png"));

    await client.setTitle("截图演示提示（编辑中）");
    await client.waitForExpression(
      `document.body.textContent.includes("有未保存的修改")`,
      "dirty 状态",
    );
    shots.push(await client.screenshot("main-window-editing.png"));

    const errors = client.errors.filter((e) => !e.includes("favicon"));
    if (errors.length > 0) {
      throw new Error(`截图过程中出现控制台错误: ${errors.join(" | ")}`);
    }

    console.log("screenshots saved:");
    for (const shot of shots) {
      console.log("  ", shot);
    }
    client.close();
  } finally {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    rmSync(logDir, { recursive: true, force: true });
    cleanupDb();
  }
}

main().catch((error) => {
  console.error(`SCREENSHOTS FAIL: ${error.message}`);
  process.exit(1);
});
