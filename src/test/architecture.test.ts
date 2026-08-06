import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const src = join(root, "src");
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
});
