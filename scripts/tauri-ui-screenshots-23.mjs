/**
 * Phase 2.3 真实 Tauri UI 截图：Home Experience（便签墙）。
 * 输出 artifacts/screenshots/phase-2.3/，固定设备指标 1000x750。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP_PORT = 9228;
const DEV_URL = "http://localhost:1420";
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, "artifacts", "screenshots", "phase-2.3");

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

function seedDemoTips() {
  const code = `
import sqlite3, os, uuid
from datetime import datetime, timezone
db = os.path.join(os.environ['APPDATA'], 'com.agenttips.app', 'agenttips.sqlite3')
conn = sqlite3.connect(db)
cur = conn.cursor()
agents = [r[0] for r in cur.execute("SELECT id FROM agents ORDER BY name LIMIT 6").fetchall()]
now = datetime.now(timezone.utc).isoformat()
contents = [
    "修改任何核心模块前，先用一两句话说明调用链和影响范围，避免无上下文的盲改。",
    "提交前运行 pnpm test、cargo test 与 acceptance 脚本，并检查 git diff。",
    "保持最小、有界的修改，不顺手改动无关文件；重构单独提交。",
    "新增依赖前检查 pnpm-lock.yaml 与 Cargo.lock 是否已锁定，说明用途。",
    "迁移先备份，迁移失败时保留原库不清空，恢复入口清晰。",
    "界面展示的错误要可理解，堆栈与原始 SQL 只写日志，不泄露路径与密钥。",
    "全局快捷键回调只负责打开快捷窗口，不执行耗时数据库查询。",
    "数据库时间一律 UTC RFC3339，展示层再转换本地时区。",
    "终端识别禁止以任意 node 进程作为唯一判断，必须匹配命令行与父子进程树。",
    "acceptance 脚本全绿且原生冒烟无阻断项才允许宣称 MVP 完成。",
    "这条便签用于观察较长正文在便签卡中的折行与截断表现，保持可读。",
    "归档便签不参与自动提醒，但保留在便签墙中供检索。",
]
for i, content in enumerate(contents, start=1):
    tip_id = str(uuid.uuid4())
    title = f"截图演示-{i:02d}"
    status = "archived" if i == 12 else "active"
    cur.execute(
        "INSERT INTO tips (id, title, content, status, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,NULL)",
        (tip_id, title, content, status, now, now),
    )
    count = 1 + (i % 3)
    for j in range(count):
        agent_id = agents[j % len(agents)]
        cur.execute(
            "INSERT INTO tip_agents (tip_id, agent_id, auto_attach, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (tip_id, agent_id, 1 if j == 0 else 0, j, now, now),
        )
conn.commit()
print(len(contents))
conn.close()
`;
  console.log("db seeded:", runPython(code));
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
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
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

  async clickByAria(label) {
    const ok = await this.evaluate(`(() => {
      const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`未找到 aria-label: ${label}`);
    await sleep(150);
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

  async setInputByAria(ariaLabel, text) {
    await this.evaluate(`(() => {
      const el = document.querySelector('input[aria-label=${JSON.stringify(ariaLabel)}]');
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

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  cleanupDb();

  const logDir = mkdtempSync(join(tmpdir(), "agenttips-shots23-"));
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

    // home-empty（空库）
    await client.switchRoute("main");
    await client.waitForExpression(`document.body.textContent.includes("还没有便签")`, "空态");
    shots.push(await client.screenshot("home-empty.png"));

    // 播种 12 条演示便签后刷新页面
    seedDemoTips();
    await client.switchRoute("quick-note");
    await client.waitForExpression(`document.querySelector('textarea[aria-label="正文"]') !== null`, "快捷窗口");
    await client.switchRoute("main");
    await client.waitForExpression(`document.body.textContent.includes("AgentTips")`, "主页面");

    // quick-note-empty / multiple-agents
    await client.switchRoute("quick-note");
    await client.waitForExpression(`document.querySelector('textarea[aria-label="正文"]') !== null`, "快捷窗口");
    shots.push(await client.screenshot("quick-note-empty.png"));
    await client.setTextarea("正文", "同时提醒多个 Agent 的通用约束，保持最小修改。");
    await client.pickAgent("Cursor");
    await client.pickAgent("Claude Code");
    await client.waitForExpression(`Boolean(document.querySelector('[aria-label="Cursor 默认携带"]'))`, "绑定行");
    shots.push(await client.screenshot("quick-note-multiple-agents.png"));

    // home-grid（12 条种子）
    await client.switchRoute("main");
    await client.waitForExpression(`document.querySelectorAll('[data-testid="tip-card"]').length >= 8`, "grid");
    shots.push(await client.screenshot("home-grid.png"));

    // home-grid-many（完整 12 条）
    await client.waitForExpression(`document.querySelectorAll('[data-testid="tip-card"]').length >= 12`, "grid many");
    shots.push(await client.screenshot("home-grid-many.png"));

    // home-hover
    await client.mouseMove('[data-testid="tip-card"]');
    shots.push(await client.screenshot("home-hover.png"));

    // home-filter-open
    await client.realClick('[aria-label="筛选"]');
    await client.waitForExpression(
      `Boolean(document.querySelector('[aria-label="筛选 Cursor"]'))`,
      "筛选弹层",
    );
    shots.push(await client.screenshot("home-filter-open.png"));

    // home-filtered（勾选 Cursor 后关闭弹层）
    await client.realClick('[aria-label="筛选 Cursor"]');
    await client.evaluate(`document.body.click()`);
    await sleep(250);
    await client.waitForExpression(
      `document.body.textContent.includes("Cursor") && document.querySelectorAll('[data-testid="tip-card"]').length < 12`,
      "过滤后 grid",
    );
    shots.push(await client.screenshot("home-filtered.png"));

    // home-search
    await client.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('清除全部'))?.click()`,
    );
    await sleep(250);
    await client.waitForExpression(
      `document.querySelectorAll('[data-testid="tip-card"]').length >= 12`,
      "清除筛选后 grid",
    );
    await client.clickByAria("搜索");
    await client.setInputByAria("搜索便签", "迁移");
    await client.waitForExpression(
      `document.body.textContent.includes("迁移先备份") || document.body.textContent.includes("截图演示-05")`,
      "搜索结果",
    );
    shots.push(await client.screenshot("home-search.png"));

    // note-editor（点击第一张卡）
    await client.evaluate(`document.body.click()`);
    await sleep(200);
    await client.realClick('[data-testid="tip-card"]');
    await client.waitForExpression(`document.querySelector('[aria-label="标题"]') !== null`, "编辑器");
    shots.push(await client.screenshot("note-editor.png"));

    // note-editor-dirty
    await client.setInputByAria("标题", "修改前先解释调用链（编辑中）");
    await client.waitForExpression(
      `document.body.textContent.includes("有未保存的修改")`,
      "dirty 状态",
    );
    shots.push(await client.screenshot("note-editor-dirty.png"));

    // note-editor-menu
    await client.realClick('[role="dialog"] [aria-label="更多操作"]');
    await client.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes('删除'))`,
      "编辑器菜单",
    );
    shots.push(await client.screenshot("note-editor-menu.png"));

    // settings
    await client.switchRoute("settings");
    await client.waitForExpression(`Boolean(document.querySelector('[data-testid="hotkey-display"]'))`, "设置页");
    shots.push(await client.screenshot("settings.png"));

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
