# features 目录

按 `docs/02-system-architecture.md` 组织功能模块，每个 feature 有唯一公开入口：

| 模块              | 公开入口    | 职责                                                     |
| ----------------- | ----------- | -------------------------------------------------------- |
| `quick-note`      | `index.tsx` | 快捷新建便签窗口（只新建、无历史）                       |
| `note-library`    | `index.tsx` | 主管理窗口三栏：Agent 导航 / 列表+搜索 / 详情编辑        |
| `reminder`        | `index.tsx` | Agent 提醒窗口：聚合展示、展开/收起/胶囊、忽略、查看全部 |
| `hotkey-settings` | `index.tsx` | 设置页 + 快捷键录制控件（结构化候选、冲突警告）          |

约束：

- feature 只能导入自身文件、`components/shared`、`components/ui`、`desktop-api`；
- 不得直接 import `@tauri-apps/api`，不得调用 `invoke()`/`listen()`；
- feature A 不得导入 feature B 的私有文件（检查见 `scripts/check-architecture.ps1` 与 `src/test/architecture.test.ts`）；
- 窗口选择通过 `desktop-api/window-context.ts` 适配器，feature 不读 URL。
