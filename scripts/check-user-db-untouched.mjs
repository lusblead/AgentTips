/**
 * 正式用户数据库保护检查。
 *
 * 用法：
 *   node scripts/check-user-db-untouched.mjs --snapshot <snapshot-file>
 *   node scripts/check-user-db-untouched.mjs --verify <snapshot-file>
 *
 * 正式数据库位于 %APPDATA%\com.agenttips.app\agenttips.sqlite3。
 * 所有 Runtime/E2E 测试必须使用 AGENTTIPS_TEST_DATA_DIR 隔离目录，
 * 完整 acceptance 前后该文件的 checksum / mtime 必须保持不变。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

function userDbPath() {
  return join(process.env.APPDATA ?? "", "com.agenttips.app", "agenttips.sqlite3");
}

function snapshotState() {
  const db = userDbPath();
  if (!existsSync(db)) {
    return { exists: false };
  }
  const stat = readFileSync(db);
  const meta = statSync(db);
  return {
    exists: true,
    sha256: createHash("sha256").update(stat).digest("hex"),
    mtimeMs: Math.round(meta.mtimeMs),
    size: meta.size,
  };
}

function main() {
  const [mode, file] = process.argv.slice(2);
  if (!mode || !file) {
    console.error("usage: node scripts/check-user-db-untouched.mjs --snapshot|--verify <file>");
    process.exit(2);
  }
  const current = snapshotState();
  if (mode === "--snapshot") {
    writeFileSync(file, JSON.stringify(current, null, 2));
    console.log(`snapshot saved: ${JSON.stringify(current)}`);
    return;
  }
  if (mode === "--verify") {
    if (!existsSync(file)) {
      console.error("snapshot file missing");
      process.exit(2);
    }
    const before = JSON.parse(readFileSync(file, "utf8"));
    if (JSON.stringify(before) !== JSON.stringify(current)) {
      console.error(`USER DB CHANGED:\n  before=${JSON.stringify(before)}\n  after =${JSON.stringify(current)}`);
      process.exit(1);
    }
    console.log("user db untouched: " + JSON.stringify(current));
    return;
  }
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}

main();
