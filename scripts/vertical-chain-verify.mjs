/**
 * Phase 2 真实垂直链路验证：通过 WebView2 CDP 在 Tauri 窗口内调用
 * window.__TAURI_INTERNALS__.invoke，覆盖创建 → 查询 → 修改 → 删除。
 * 重启持久化由调用方（脚本外部）重启应用后再跑 phase:reload 部分。
 *
 * 用法：
 *   node scripts/vertical-chain-verify.mjs all     # 创建/查询/修改/删除
 *   node scripts/vertical-chain-verify.mjs reload  # 重启后读取（幂等）
 */
const CDP_ENDPOINT = "http://127.0.0.1:9222/json/list";

async function getTarget() {
  const response = await fetch(CDP_ENDPOINT);
  const targets = await response.json();
  const page = targets.find((target) => target.type === "page");
  if (!page) {
    throw new Error("未找到 Tauri 页面 target");
  }
  return page.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
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
      }
    };
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
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

async function invoke(client, command, args = undefined) {
  const expression = `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args ?? {})})`;
  return client.evaluate(expression);
}

async function readBack(client) {
  const list = await invoke(client, "tip_list", { query: {} });
  const target = list.find((tip) => tip.title === "垂直链路验证");
  if (!target) {
    throw new Error("创建后未在 tip_list 中找到目标提示");
  }
  const detail = await invoke(client, "tip_get", { id: target.id });
  return { target, detail };
}

async function runAll(client) {
  const agents = await invoke(client, "agent_list");
  if (!Array.isArray(agents) || agents.length !== 6) {
    throw new Error(`内置 Agent 数量异常: ${JSON.stringify(agents)}`);
  }
  const cursor = agents.find((agent) => agent.key === "cursor");
  const claude = agents.find((agent) => agent.key === "claude-code");
  if (!cursor || !claude) {
    throw new Error("缺少 cursor / claude-code 内置 Agent");
  }
  console.log("agents:", agents.map((a) => a.key).join(", "));

  const created = await invoke(client, "tip_create", {
    input: {
      title: "垂直链路验证",
      content: "通过真实 Tauri invoke 创建",
      bindings: [
        { agentId: cursor.id, autoAttach: true },
        { agentId: claude.id, autoAttach: false },
      ],
    },
  });
  console.log("created:", JSON.stringify(created));

  const { detail } = await readBack(client);
  console.log("readBack:", JSON.stringify(detail));
  if (detail.bindings.length !== 2) {
    throw new Error("bindings 数量不正确");
  }
  if (!detail.bindings.some((b) => b.agentId === cursor.id && b.autoAttach && b.sortOrder === 0)) {
    throw new Error("Cursor 绑定 autoAttach/sortOrder 不正确");
  }
  if (!detail.bindings.some((b) => b.agentId === claude.id && !b.autoAttach && b.sortOrder === 1)) {
    throw new Error("Claude Code 绑定 autoAttach/sortOrder 不正确");
  }

  const updated = await invoke(client, "tip_update", {
    input: {
      id: created.id,
      content: "修改后的正文",
      bindings: [{ agentId: claude.id, autoAttach: true }],
    },
  });
  console.log("updated:", JSON.stringify(updated));
  if (updated.content !== "修改后的正文" || updated.bindings.length !== 1) {
    throw new Error("修改失败");
  }

  await invoke(client, "tip_delete", { id: created.id });
  const afterDelete = await invoke(client, "tip_list", { query: {} });
  if (afterDelete.some((tip) => tip.id === created.id)) {
    throw new Error("删除后仍存在");
  }
  console.log("delete ok, remaining:", afterDelete.length);
  return created.id;
}

async function runReload(client) {
  const list = await invoke(client, "tip_list", { query: {} });
  const target = list.find((tip) => tip.title === "垂直链路验证");
  if (!target) {
    throw new Error("重启后未找到持久化的提示");
  }
  const detail = await invoke(client, "tip_get", { id: target.id });
  console.log("reload persisted:", JSON.stringify(detail));
  return detail;
}

async function runCreatePersist(client) {
  const agents = await invoke(client, "agent_list");
  const cursor = agents.find((agent) => agent.key === "cursor");
  const created = await invoke(client, "tip_create", {
    input: {
      title: "垂直链路验证",
      content: "用于重启持久化验证",
      bindings: [{ agentId: cursor.id, autoAttach: true }],
    },
  });
  console.log("persist-created:", JSON.stringify(created));
  return created;
}

async function runCleanup(client) {
  const list = await invoke(client, "tip_list", { query: {} });
  for (const tip of list) {
    await invoke(client, "tip_delete", { id: tip.id });
    console.log("deleted:", tip.title);
  }
  console.log("cleanup done, remaining:", (await invoke(client, "tip_list", { query: {} })).length);
}

const mode = process.argv[2] ?? "all";
const client = new CdpClient(await getTarget());
await client.open();
try {
  if (mode === "reload") {
    await runReload(client);
  } else if (mode === "create-persist") {
    await runCreatePersist(client);
  } else if (mode === "cleanup") {
    await runCleanup(client);
  } else {
    await runAll(client);
  }
  console.log(`VERTICAL_CHAIN_${mode.toUpperCase()}=PASS`);
} finally {
  client.close();
}
