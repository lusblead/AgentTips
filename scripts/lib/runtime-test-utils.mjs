/**
 * Runtime/E2E 测试共享基础设施（最小集）。
 *
 * - sleep / waitFor：等待原语
 * - makeTestDataDir：统一测试数据目录 %TEMP%\agenttips-tests\<name>-<uuid>
 *   每个 run 唯一，绝不与正式 %APPDATA%\com.agenttips.app 共享 SQLite
 * - makeLogDir：临时日志目录
 * - killProcessTree：按根 PID 结束整个进程树
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(
  predicate,
  { timeout = 60_000, interval = 250, label = "condition" } = {},
) {
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

/** 每个测试 run 使用唯一数据目录，两个测试脚本绝不会共享同一 SQLite 文件。 */
export function makeTestDataDir(testName) {
  const base = join(tmpdir(), "agenttips-tests");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${testName}-${randomUUID()}-`));
}

export function makeLogDir(testName) {
  return mkdtempSync(join(tmpdir(), `agenttips-${testName}-logs-`));
}

/** 结束整个进程树（含 pnpm/cargo 子进程）。 */
export function killProcessTree(rootPid) {
  try {
    spawnSync("taskkill", ["/pid", String(rootPid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}
