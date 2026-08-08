/**
 * Phase 2.4R 真实 Tauri UI 截图：产品契约恢复后的视觉验收。
 * 输出 artifacts/screenshots/phase-2.4R/，固定设备指标 1000x750。
 * - 20 条种子 Tip，其中 6 条已使用（不同 pastel）用于 Used View 验收
 * - lemon / mint 通过循环重开 Quick Note 直到 data-color 命中
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP_PORT = 9230;
const DEV_URL = "http://localhost:1420";
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, "artifacts", "screenshots", "phase-2.4R");

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
    "超长便签：用于观察便签纸向下生长。终端识别禁止以任意 node 进程作为唯一判断，必须匹配命令行与父子进程树；全局快捷键回调只负责打开窗口；数据库时间一律 UTC；acceptance 全绿才算完成。",
    "短便签：保持最小修改。",
    "中等：颜色创建时随机分配一次并永久保存，重启与筛选都不改变。",
    "长内容：新增依赖前检查锁文件并说明用途；迁移先备份；错误信息面向用户；快捷键只触发窗口；时间统一 UTC。",
    "超长便签：第二张超长内容。便签墙采用可变高度 Masonry，短卡保持短、长卡向下生长，宽度固定；首页支持 WYSIWYG 直接编辑与 650ms 自动保存。",
    "短便签：归档与已使用不同。",
    "中等：颜色映射来自 10 色正式 Palette，任何 Tip 不允许白色表面。",
    "长内容：自动化验收必须真实运行全部命令；截图需展示五颜六色、不等高、Masonry 与 Used 独立存放。",
    "短便签：Ctrl + F12 快速记录。",
    "中等：绑定多个 Agent 时每个绑定独立保存默认携带开关。",
    "长内容：验证变高效果：内容越多 textarea 越高、卡片越高、不出现内部滚动条；下方便签自动重新排布。",
    "短便签：已归档示例。",
    "中等：hover 时显示展开与标记已使用两个轻量操作。",
    "长内容：Detailed Editor 使用当前便签自己的颜色作为纸面，背景保持中性；负责 Agent、复制与删除。",
    "短便签：不把 node.exe 当 Claude。",
    "中等：发布前跑全量验收与原生冒烟。",
    "短便签：时间统一 UTC。",
]
used_titles = {1, 3, 7, 11, 14, 17}
for i, content in enumerate(contents, start=1):
    tip_id = str(uuid.uuid4())
    title = f"截图演示-{i:02d}"
    used_at = now if i in used_titles else None
    cur.execute(
        "INSERT INTO tips (id, title, content, status, created_at, updated_at, deleted_at, color_key, used_at) VALUES (?,?,?,'active',?,?,NULL,?,?)",
        (tip_id, title, content, now, now, colors[i-1], used_at),
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

  async setTextareaBySelector(selector, text) {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }

  async openQuickNoteWithColor(target) {
    for (let i = 0; i < 80; i++) {
      // 整页导航强制 Quick Note 重新挂载，从而重新请求 suggestNoteColor
      await this.evaluate(`location.href = ${JSON.stringify(`${DEV_URL}/?window=quick-note`)}`);
      await this.waitForExpression(
        `document.readyState === 'complete' && Boolean(document.querySelector('[data-testid="note-surface"]'))`,
        "note surface",
      );
      await this.waitForExpression(
        `Boolean(document.querySelector('[data-testid="note-surface"]'))`,
        "note surface",
      );
      const color = await this.evaluate(
        `document.querySelector('[data-testid="note-surface"]')?.getAttribute('data-color')`,
      );
      if (color === target) return;
    }
    throw new Error(`未在 80 次内获得 ${target}`);
  }

  async openUsedView() {
    const clicked = await this.evaluate(`(() => {
      const el = document.querySelector('[aria-label="更多操作"]');
      if (!el) return false;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error("更多操作按钮不存在");
    await sleep(400);
    await this.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes('已使用便签'))`,
      "已使用菜单项",
    );
    await this.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      items.find((el) => (el.textContent ?? '').includes('已使用便签'))?.click();
    })()`);
    await this.waitForExpression(
      `document.body.textContent.includes('还没有已使用的便签') || document.querySelectorAll('[data-testid="tip-card"]').length >= 1`,
      "Used View",
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

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  cleanupDb();
  seedDemoTips();

  const logDir = mkdtempSync(join(tmpdir(), "agenttips-shots24r-"));
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

    // 首页 14 张未使用彩色便签墙（4 列）
    await client.switchRoute("main");
    await client.waitForExpression(
      `document.querySelectorAll('[data-testid="tip-card"]').length >= 14`,
      "14 卡",
    );
    shots.push(await client.screenshot("home-color-wall-many.png"));
    shots.push(await client.screenshot("home-four-columns.png"));

    // hover
    await client.mouseMove('[data-testid="tip-card"]');
    shots.push(await client.screenshot("home-note-hover.png"));
    await client.evaluate(`document.body.click()`);
    await sleep(200);

    // inline title / body 编辑态
    await client.realClick('[data-testid="tip-card"] input[aria-label="标题"]');
    shots.push(await client.screenshot("home-inline-title.png"));
    await client.realClick('[data-testid="tip-card"] textarea[aria-label="正文"]');
    shots.push(await client.screenshot("home-inline-body.png"));

    // 长 Note
    await client.setTextareaBySelector(
      '[data-testid="tip-card"] textarea[aria-label="正文"]',
      Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 行内容`).join("\n"),
    );
    await sleep(900);
    shots.push(await client.screenshot("home-long-note.png"));
    await client.evaluate(`document.body.click()`);
    await sleep(900);

    // Quick Note lemon / mint（循环直到命中）
    await client.openQuickNoteWithColor("lemon");
    shots.push(await client.screenshot("quick-note-lemon.png"));
    await client.openQuickNoteWithColor("mint");
    shots.push(await client.screenshot("quick-note-mint.png"));

    // Quick Note 多 Agent
    await client.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find((b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled);
      if (!target) return false;
      target.dataset.pickAgent = '1';
      return true;
    })()`);
    await client.realClick('button[data-pick-agent="1"]');
    await client.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes('Cursor'))`,
      "菜单",
    );
    await client.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      items.find((el) => (el.textContent ?? '').includes('Cursor'))?.click();
    })()`);
    await sleep(200);
    await client.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find((b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled);
      if (!target) return false;
      target.dataset.pickAgent = '2';
      return true;
    })()`);
    await client.realClick('button[data-pick-agent="2"]');
    await client.waitForExpression(
      `[...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent ?? '').includes('Claude Code'))`,
      "菜单 2",
    );
    await client.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      items.find((el) => (el.textContent ?? '').includes('Claude Code'))?.click();
    })()`);
    await client.waitForExpression(
      `Boolean(document.querySelector('[aria-label="Cursor 默认携带"]'))`,
      "绑定行",
    );
    shots.push(await client.screenshot("quick-note-multiple-agents.png"));

    // Used View（6 张不同色）
    await client.switchRoute("main");
    await client.waitForExpression(`document.body.textContent.includes("AgentTips")`, "main");
    await client.openUsedView();
    const usedCount = await client.evaluate(
      `document.querySelectorAll('[data-testid="tip-card"]').length`,
    );
    console.log("USED_COUNT:", usedCount);
    if (usedCount < 6) {
      throw new Error(`Used View 少于 6 张: ${usedCount}`);
    }
    shots.push(await client.screenshot("used-notes.png"));

    // Used View Empty（恢复一张后剩余 5 张 → 不足以演示 empty；恢复全部需要多次菜单）
    // used-notes-empty 由浏览器 Mock E2E 生成（已有）
    // note-detail
    await client.evaluate(`location.href = ${JSON.stringify(`${DEV_URL}/?window=main`)}`);
    await client.waitForExpression(`document.body.textContent.includes("AgentTips")`, "main");
    await client.mouseMove('[data-testid="tip-card"]');
    await client.realClick('[data-testid="tip-card"] button[aria-label="展开详情"]');
    await client.waitForExpression(
      `document.querySelector('[role="dialog"] input[aria-label="标题"]') !== null`,
      "editor",
    );
    shots.push(await client.screenshot("note-detail.png"));

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
