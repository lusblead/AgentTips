/**
 * Phase 2.4 真实 Tauri UI 截图：彩色便签墙、可变高度、inline editing、Used View。
 * 输出 artifacts/screenshots/phase-2.4/，固定设备指标 1000x750。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP_PORT = 9229;
const DEV_URL = "http://localhost:1420";
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, "artifacts", "screenshots", "phase-2.4");

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

const COLORS = [
  "lemon", "apricot", "coral", "rose", "lavender", "periwinkle",
  "sky", "aqua", "mint", "sage", "lemon", "apricot", "coral", "rose",
  "lavender", "periwinkle", "sky", "aqua", "mint", "sage",
];

function seedDemoTips() {
  const colorsJson = JSON.stringify(COLORS);
  const code = `
import sqlite3, os, uuid, json
from datetime import datetime, timezone
db = os.path.join(os.environ['APPDATA'], 'com.agenttips.app', 'agenttips.sqlite3')
conn = sqlite3.connect(db)
cur = conn.cursor()
agents = [r[0] for r in cur.execute("SELECT id FROM agents ORDER BY name LIMIT 6").fetchall()]
now = datetime.now(timezone.utc).isoformat()
colors = ${colorsJson}
contents = [
    "短便签：先解释调用链。",
    "中等长度：提交前运行全部测试并检查 git diff，确保改动最小且有边界。",
    "长内容：迁移前先确认备份存在，迁移失败时保留原库不清空，恢复入口清晰；界面错误要可读，堆栈只写日志。",
    "超长便签：这是一段用于观察便签纸向下生长的超长正文。终端识别禁止以任意 node 进程作为唯一判断，必须匹配命令行与父子进程树；全局快捷键回调只负责打开窗口；数据库时间一律 UTC；acceptance 全绿才算完成。这段内容会持续多行，用于验证 Masonry 与卡片高度自适应。",
    "短便签：保持最小修改。",
    "中等：颜色应该当场随机分配一次并永久保存，重启与筛选都不改变。",
    "长内容：新增依赖前检查锁文件并说明用途；迁移先备份；错误信息面向用户；快捷键只触发窗口；时间统一 UTC；不把 node 当 Claude。",
    "超长便签：第二张超长内容。便签墙采用可变高度 Masonry，短卡保持短、长卡向下生长，宽度始终固定；首页支持 WYSIWYG 直接编辑与 650ms 自动保存；标记已使用后收进独立视图，可恢复。",
    "短便签：归档与已使用不同。",
    "中等：颜色映射来自 10 色正式 Palette，任何 Tip 不允许白色表面。",
    "长内容：自动化验收必须真实运行全部命令；截图需展示五颜六色、不等高、Masonry、长 Note 向下生长与 Used 独立存放。",
    "短便签：Ctrl + F12 快速记录。",
    "中等：绑定多个 Agent 时每个绑定独立保存默认携带开关。",
    "长内容：这篇便签继续验证变高效果：内容越多 textarea 越高、卡片越高、不出现内部滚动条；下方便签自动重新排布，形成桌面上不等高的便签墙。",
    "短便签：已归档示例。",
    "中等：hover 时显示展开与标记已使用两个轻量操作。",
    "长内容：Detailed Editor 使用当前便签自己的颜色作为纸面，背景保持中性；颜色可在编辑器内修改并持久化。",
    "短便签：不把 node.exe 当 Claude。",
    "中等：发布前跑全量验收与原生冒烟。",
    "短便签：时间统一 UTC。",
]
for i, content in enumerate(contents, start=1):
    tip_id = str(uuid.uuid4())
    title = f"截图演示-{i:02d}"
    cur.execute(
        "INSERT INTO tips (id, title, content, status, created_at, updated_at, deleted_at, color_key, used_at) VALUES (?,?,?,'active',?,?,NULL,?,NULL)",
        (tip_id, title, content, now, now, colors[i-1]),
    )
    count = 1 + (i % 3)
    for j in range(count):
        cur.execute(
            "INSERT INTO tip_agents (tip_id, agent_id, auto_attach, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (tip_id, agents[j % len(agents)], 1 if j == 0 else 0, j, now, now),
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
    await sleep(300);
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
  seedDemoTips();

  const logDir = mkdtempSync(join(tmpdir(), "agenttips-shots24-"));
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

    // home-color-wall（彩色便签墙）
    await client.switchRoute("main");
    await client.waitForExpression(`document.querySelectorAll('[data-testid="tip-card"]').length >= 20`, "20 卡");
    shots.push(await client.screenshot("home-color-wall.png"));

    // home-color-wall-many（与 wall 相同，作为主视觉验收）
    shots.push(await client.screenshot("home-color-wall-many.png"));

    // home-variable-height（长卡高、短卡矮）
    const heights = await client.evaluate(
      `[...document.querySelectorAll('[data-testid="tip-card"]')].map((el) => Math.round(el.getBoundingClientRect().height))`,
    );
    console.log("HEIGHTS:", JSON.stringify(heights.slice(0, 8)));
    shots.push(await client.screenshot("home-variable-height.png"));

    // home-note-hover
    await client.mouseMove('[data-testid="tip-card"]');
    shots.push(await client.screenshot("home-note-hover.png"));

    // home-inline-editing（第一张卡正文输入中）
    await client.realClick('[data-testid="tip-card"] textarea[aria-label="正文"]');
    await client.setTextarea("正文", "这是首页直接编辑的正文……");
    shots.push(await client.screenshot("home-inline-editing.png"));
    await client.evaluate(`document.body.click()`);
    await sleep(900);

    // home-long-note（输入 15 行后的超高卡）
    await client.realClick('[data-testid="tip-card"] textarea[aria-label="正文"]');
    await client.setTextarea(
      "正文",
      Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 行内容`).join("\n"),
    );
    await sleep(900);
    shots.push(await client.screenshot("home-long-note.png"));
    await client.evaluate(`document.body.click()`);
    await sleep(900);

    // quick-note-lemon / mint（两次打开不同颜色）
    await client.switchRoute("quick-note");
    await client.waitForExpression(`document.querySelector('[data-testid="note-surface"]') !== null`, "note surface");
    shots.push(await client.screenshot("quick-note-lemon.png"));
    await client.switchRoute("main");
    await client.switchRoute("quick-note");
    await client.waitForExpression(`document.querySelector('[data-testid="note-surface"]') !== null`, "note surface 2");
    shots.push(await client.screenshot("quick-note-mint.png"));

    // quick-note-multiple-agents
    await client.setTextarea("正文", "同时提醒多个 Agent 的通用约束。");
    await client.pickAgent("Cursor");
    await client.pickAgent("Claude Code");
    await client.waitForExpression(`Boolean(document.querySelector('[aria-label="Cursor 默认携带"]'))`, "绑定行");
    shots.push(await client.screenshot("quick-note-multiple-agents.png"));

    // note-detail（Detailed Editor 使用自身 colorKey）
    await client.switchRoute("main");
    await client.waitForExpression(`document.querySelectorAll('[data-testid="tip-card"]').length >= 20`, "20 卡");
    await client.mouseMove('[data-testid="tip-card"]');
    await client.realClick('[data-testid="tip-card"] button[aria-label="展开详情"]');
    await client.waitForExpression(`document.querySelector('[role="dialog"] input[aria-label="标题"]') !== null`, "editor");
    shots.push(await client.screenshot("note-detail.png"));

    // 关闭 editor 后标记第一张为已使用，进入 Used View
    await client.evaluate(`document.body.click()`);
    await sleep(200);
    await client.switchRoute("main");
    await client.waitForExpression(`document.querySelectorAll('[data-testid="tip-card"]').length >= 20`, "20 卡");
    await client.mouseMove('[data-testid="tip-card"]');
    const marked = await client.evaluate(`(() => {
      const card = document.querySelector('[data-testid="tip-card"]');
      const btn = card?.querySelector('button[aria-label="标记已使用"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!marked) throw new Error("未找到标记已使用按钮");
    await client.waitForExpression(`document.body.textContent.includes("已移至「已使用」")`, "toast");
    await sleep(400);
    await client.clickByAria("更多操作");
    await sleep(250);
    await client.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      items.find((el) => (el.textContent ?? '').includes('已使用便签'))?.click();
    })()`);
    await sleep(800);
    const afterClick = await client.evaluate(
      `JSON.stringify({ body: document.body.textContent.slice(0, 100), cards: document.querySelectorAll('[data-testid="tip-card"]').length })`,
    );
    console.log("AFTER_CLICK:", afterClick);
    await client.waitForExpression(
      `document.body.textContent.includes("已使用") && document.querySelectorAll('[data-testid="tip-card"]').length >= 1`,
      "used view",
    );
    shots.push(await client.screenshot("used-notes.png"));

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
