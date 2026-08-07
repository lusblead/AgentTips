/**
 * Phase 3A 真实多窗口截图
 *
 * 截图来自真实 Tauri WebView（WebView2 CDP Page.captureScreenshot），
 * 输出 artifacts/screenshots/phase-3a/：
 *   main-window.png
 *   quick-note-window.png
 *   quick-note-filled-window.png
 *   settings-window.png
 *   main-and-quick-note.png   （双窗口合成）
 *   main-and-settings.png     （双窗口合成）
 *
 * 截图后对每张图做像素统计（尺寸/非空白/颜色数），并断言 quick-note 不是 main 尺寸。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP_PORT = 9233;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}/json/list`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, "artifacts", "screenshots", "phase-3a");

let appProcess = null;
let logDir = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  throw new Error(`wait timeout: ${label}`);
}

function runPython(code) {
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  return result.stdout.trim();
}

function dbCleanupPrefix(prefix) {
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
  console.log(`db cleanup (${prefix}): removed ${Number(runPython(code))}`);
}

function seedDemoTips() {
  const code = `
import sqlite3, os, uuid
from datetime import datetime, timezone
db = os.path.join(os.environ['APPDATA'], 'com.agenttips.app', 'agenttips.sqlite3')
conn = sqlite3.connect(db)
cur = conn.cursor()
agents = [r[0] for r in cur.execute("SELECT id FROM agents ORDER BY name LIMIT 3").fetchall()]
now = datetime.now(timezone.utc).isoformat()
contents = [
    "为重构准备一条边界用例",
    "验证失败时保留用户输入并展示结构化错误",
    "快捷键只负责打开窗口，不负责业务",
    "颜色在创建时随机分配一次并永久保存",
    "已使用与归档是两种不同的状态",
    "发布前运行全部验收命令并检查截图",
]
colors = ["lemon", "sky", "mint", "coral", "sage", "lavender"]
for i, content in enumerate(contents, start=1):
    tip_id = str(uuid.uuid4())
    title = f"截图演示-{i:02d}"
    cur.execute(
        "INSERT INTO tips (id, title, content, status, created_at, updated_at, deleted_at, color_key, used_at) VALUES (?,?,?,'active',?,?,NULL,?,NULL)",
        (tip_id, title, content, now, now, colors[i - 1]),
    )
    cur.execute(
        "INSERT INTO tip_agents (tip_id, agent_id, auto_attach, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (tip_id, agents[i % len(agents)], 1 if i % 2 == 0 else 0, 0, now, now),
    )
conn.commit()
print(len(contents))
conn.close()
`;
  console.log("db seeded:", Number(runPython(code)));
}

async function listPageTargets() {
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
      }, 8_000);
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

  async screenshot(name) {
    const result = await this.send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT_DIR, name);
    writeFileSync(file, Buffer.from(result.data, "base64"));
    return file;
  }

  async realClick(selector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!box) throw new Error(`click target missing: ${selector}`);
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
    await sleep(200);
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
  await waitFor(
    async () => {
      const targets = await listPageTargets();
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
    },
    { timeout: 30_000, label: `window ${kind}` },
  );
  return clients.get(kind);
}

async function openWindow(kind) {
  const command = {
    main: "window_open_main",
    "quick-note": "window_open_quick_note",
    settings: "window_open_settings",
  }[kind];
  for (const client of clients.values()) {
    await client.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)})`);
    break;
  }
  await sleep(500);
  return ensureClient(kind);
}

function pixelReport(files) {
  const list = files.map((f) => JSON.stringify(f)).join(",");
  const code = `
from PIL import Image
import json
files = [${list}]
for f in files:
    im = Image.open(f).convert("RGB")
    colors = im.getcolors(maxcolors=2000000)
    unique = len(colors) if colors else 0
    w, h = im.size
    print(f + "\t" + str(w) + "x" + str(h) + "\t" + str(unique))
`;
  const output = runPython(code);
  console.log(output);
  return output;
}

function compositeTwo(mainFile, secondFile, outFile, secondLabel) {
  const code = `
from PIL import Image, ImageDraw
m = Image.open(${JSON.stringify(mainFile)}).convert("RGB")
s = Image.open(${JSON.stringify(secondFile)}).convert("RGB")
pad, title_h, gap = 36, 34, 24
canvas = Image.new("RGB", (m.width + s.width + pad * 3 + gap, max(m.height, s.height) + pad * 2 + title_h), (34, 39, 50))
d = ImageDraw.Draw(canvas)
d.text((pad, 10), "AgentTips - Main", fill=(200, 205, 214))
d.text((pad * 2 + m.width + gap, 10), "AgentTips - " + ${JSON.stringify(secondLabel)}, fill=(200, 205, 214))
canvas.paste(m, (pad, pad + title_h))
canvas.paste(s, (pad * 2 + m.width + gap, pad + title_h))
canvas.save(${JSON.stringify(outFile)})
print(canvas.size)
`;
  console.log("composite:", runPython(code));
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const prefix = "截图演示";
  const filledPrefix = "截图填写";
  dbCleanupPrefix(prefix);
  dbCleanupPrefix(filledPrefix);
  seedDemoTips();

  logDir = mkdtempSync(join(tmpdir(), "agenttips-shots3a-"));
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
  appProcess = child;

  try {
    const main = await ensureClient("main");
    await waitFor(
      async () =>
        (await main.evaluate(
          `document.querySelectorAll('[data-testid="tip-card"]').length`,
        )) >= 6,
      { timeout: 30_000, label: "seeded tips on main" },
    );
    await sleep(600);
    await main.screenshot("main-window.png");

    // Quick Note 空状态
    const quick = await openWindow("quick-note");
    await waitFor(
      async () =>
        Boolean(
          await quick.evaluate(
            `document.querySelector('[data-testid="note-surface"]') !== null`,
          ),
        ),
      { timeout: 10_000, label: "note surface" },
    );
    await sleep(500);
    await quick.screenshot("quick-note-window.png");

    // Quick Note 已填写：正文 + 两个 Agent
    const filledText = `${filledPrefix}-${Date.now()} 的迁移备份检查清单`;
    await quick.evaluate(`(() => {
      const ta = document.querySelector('textarea[aria-label="正文"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(filledText)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    for (const agent of ["Cursor", "Claude Code"]) {
      const found = await quick.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')];
        const target = buttons.find((b) => (b.textContent ?? '').includes('添加 Agent') && !b.disabled);
        if (!target) return false;
        target.dataset.pickAgent = '1';
        return true;
      })()`);
      if (!found) throw new Error("add agent button missing");
      await quick.realClick('button[data-pick-agent="1"]');
      await quick.evaluate(`(() => {
        const items = [...document.querySelectorAll('[role="menuitem"]')];
        const target = items.find((el) => (el.textContent ?? '').includes(${JSON.stringify(agent)}));
        if (target) target.click();
      })()`);
      await sleep(200);
    }
    await sleep(400);
    await quick.screenshot("quick-note-filled-window.png");

    // 保存（隐藏 Quick Note）后打开 Settings
    await quick.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim().includes('保存') && !b.disabled,
      );
      if (btn) btn.click();
    })()`);
    await sleep(1_500);
    const settings = await openWindow("settings");
    await waitFor(
      async () =>
        Boolean(
          await settings.evaluate(
            `document.querySelector('[data-testid="hotkey-display"]') !== null`,
          ),
        ),
      { timeout: 10_000, label: "settings" },
    );
    await sleep(500);
    await settings.screenshot("settings-window.png");

    // 双窗口合成（截图顺序：先 quick-note 再 main；settings 再 main）
    const quickReopen = await openWindow("quick-note");
    await sleep(600);
    await quickReopen.screenshot("quick-note-again.png");
    await main.screenshot("main-for-composite.png");
    await settings.screenshot("settings-for-composite.png");

    const p1 = join(OUT_DIR, "main-for-composite.png");
    const p2 = join(OUT_DIR, "quick-note-again.png");
    const p3 = join(OUT_DIR, "settings-for-composite.png");
    compositeTwo(p1, p2, join(OUT_DIR, "main-and-quick-note.png"), "Quick Note");
    compositeTwo(p1, p3, join(OUT_DIR, "main-and-settings.png"), "Settings");
    rmSync(p2, { force: true });
    rmSync(p3, { force: true });

    // 像素校验
    const report = pixelReport([
      join(OUT_DIR, "main-window.png"),
      join(OUT_DIR, "quick-note-window.png"),
      join(OUT_DIR, "quick-note-filled-window.png"),
      join(OUT_DIR, "settings-window.png"),
      join(OUT_DIR, "main-and-quick-note.png"),
      join(OUT_DIR, "main-and-settings.png"),
    ]);
    const lines = report.split(/\r?\n/).filter(Boolean);
    const sizeOf = {};
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length === 3) {
        sizeOf[parts[0]] = { size: parts[1], unique: Number(parts[2]) };
      }
    }
    const quickShot = sizeOf[join(OUT_DIR, "quick-note-window.png")] ?? {};
    const mainShot = sizeOf[join(OUT_DIR, "main-window.png")] ?? {};
    if (!quickShot.size || !mainShot.size) throw new Error("pixel report incomplete");
    const [qw, qh] = quickShot.size.split("x").map(Number);
    const [mw, mh] = mainShot.size.split("x").map(Number);
    if (qw >= mw) throw new Error(`quick-note screenshot must be smaller than main (${qw} >= ${mw})`);
    if (qh >= mh) throw new Error(`quick-note height must be smaller than main (${qh} >= ${mh})`);
    for (const key of Object.keys(sizeOf)) {
      if (sizeOf[key].unique < 50) throw new Error(`screenshot may be blank: ${key}`);
    }
    console.log("SCREENSHOTS (PHASE 3A) = PASS");
  } finally {
    for (const client of clients.values()) client.close();
    clients.clear();
    try {
      if (appProcess) spawnSync("taskkill", ["/pid", String(appProcess.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* ignore */
    }
    if (logDir) rmSync(logDir, { recursive: true, force: true });
    dbCleanupPrefix(prefix);
    dbCleanupPrefix(filledPrefix);
  }
}

run().catch((error) => {
  console.error(`SCREENSHOTS (PHASE 3A) = FAIL: ${error.message}`);
  process.exit(1);
});
