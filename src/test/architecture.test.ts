import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const src = join(root, "src");
const srcTauri = join(root, "src-tauri");
const featuresDir = join(src, "features");

function listFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...listFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

function listRustFiles(dir: string): string[] {
  return listFiles(dir).filter((file) => file.endsWith(".rs"));
}

describe("架构边界（静态检查）", () => {
  it("feature 目录不得直接导入 @tauri-apps/api", () => {
    const violations: string[] = [];
    for (const file of listFiles(featuresDir)) {
      const content = readFileSync(file, "utf8");
      if (/from\s+["']@tauri-apps\/api/.test(content)) {
        violations.push(relative(src, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("feature 目录不得直接调用 invoke() 或 listen()", () => {
    const violations: string[] = [];
    for (const file of listFiles(featuresDir)) {
      const content = readFileSync(file, "utf8");
      if (/\binvoke\s*\(|\blisten\s*\(/.test(content)) {
        violations.push(relative(src, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("React 源码中不得出现 SQL", () => {
    const violations: string[] = [];
    for (const file of listFiles(src)) {
      if (/\.test\.(ts|tsx)$/.test(file)) {
        continue;
      }
      const content = readFileSync(file, "utf8");
      if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/.test(content)) {
        violations.push(relative(src, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("feature 之间不得深层导入其他 feature 的私有文件", () => {
    const featureDirs = readdirSync(featuresDir).filter((entry) =>
      statSync(join(featuresDir, entry)).isDirectory(),
    );
    const violations: string[] = [];
    for (const file of listFiles(featuresDir)) {
      const content = readFileSync(file, "utf8");
      const thisFeature = relative(featuresDir, file).split(/[\\/]/)[0];
      for (const other of featureDirs) {
        if (other === thisFeature) continue;
        const pattern = new RegExp(`features/${other}/`, "i");
        if (pattern.test(content)) {
          violations.push(`${relative(featuresDir, file)} -> features/${other}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("Rust domain 不依赖 Tauri / rusqlite / Windows", () => {
    const domainDir = join(srcTauri, "src", "domain");
    const violations: string[] = [];
    for (const file of listRustFiles(domainDir)) {
      const content = readFileSync(file, "utf8");
      for (const forbidden of ["tauri::", "rusqlite", "windows::"]) {
        if (content.includes(forbidden)) {
          violations.push(`${relative(root, file)} -> ${forbidden}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("Rust application 不依赖 adapters / commands / rusqlite", () => {
    const appDir = join(srcTauri, "src", "application");
    const violations: string[] = [];
    for (const file of listRustFiles(appDir)) {
      const content = readFileSync(file, "utf8");
      for (const forbidden of ["crate::adapters", "crate::commands", "rusqlite"]) {
        if (content.includes(forbidden)) {
          violations.push(`${relative(root, file)} -> ${forbidden}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("SQL 只存在于 migrations 与 adapters/sqlite.rs", () => {
    const violations: string[] = [];
    for (const file of listRustFiles(join(srcTauri, "src"))) {
      if (file.endsWith(join("adapters", "sqlite.rs"))) continue;
      const content = readFileSync(file, "utf8");
      if (/\b(SELECT |INSERT INTO|CREATE TABLE|UPDATE |DELETE FROM)\b/.test(content)) {
        violations.push(relative(root, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("Tauri commands 不直接引用 rusqlite", () => {
    const violations: string[] = [];
    for (const file of listRustFiles(join(srcTauri, "src", "commands"))) {
      const content = readFileSync(file, "utf8");
      if (content.includes("rusqlite")) {
        violations.push(relative(root, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("生产 composition root 使用 TauriDesktopApi", () => {
    const content = readFileSync(join(src, "App.tsx"), "utf8");
    expect(content).toContain("new TauriDesktopApi()");
    expect(content).not.toContain("if (window.__TAURI__)");
  });

  it("feature 组件测试不直接实例化 TauriDesktopApi", () => {
    const violations: string[] = [];
    for (const file of listFiles(featuresDir)) {
      if (!/\.test\.(ts|tsx)$/.test(file)) continue;
      const content = readFileSync(file, "utf8");
      if (content.includes("TauriDesktopApi")) {
        violations.push(relative(src, file));
      }
    }
    expect(violations).toEqual([]);
  });
});
