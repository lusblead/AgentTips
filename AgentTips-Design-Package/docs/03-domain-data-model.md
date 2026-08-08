# 03. 领域模型与数据设计

## 1. 核心实体

### Tip

```text
Tip
- id: UUID
- title: string?  # 新便签保持 NULL；仅兼容旧数据
- content: string
- tags: string[]
- status: draft | active | archived
- created_at
- updated_at
- deleted_at?
```

不变量：

- `active` Tip 的正文不能为空；
- 新 Tip 不从正文派生标题；标题为空是正常状态；
- 标签由用户自由输入，去除前导 `#` 和多余空白后按大小写不敏感去重；每条最多 8 个、每个最多 32 个字符；
- `draft` 可暂时没有 Agent 绑定；
- `archived` 不参与自动提醒；
- 软删除记录不出现在正常查询中。

### Agent

```text
Agent
- id: UUID
- key: string unique
- name: string
- kind: desktop | terminal
- built_in: boolean
- enabled: boolean
- reminder_enabled: boolean
- created_at
- updated_at
```

`key` 是稳定程序标识，例如 `cursor`、`claude-code`，不得使用可变显示名称作为关联键。

### TipAgentBinding

```text
TipAgentBinding
- tip_id
- agent_id
- auto_attach: boolean
- sort_order: integer
- created_at
- updated_at
```

不变量：

- `(tip_id, agent_id)` 唯一；
- 默认携带属于绑定关系；
- 删除 Agent 或 Tip 时通过事务处理关联记录。

### Tag / TipTag

```text
Tag
- id: UUID
- name: string
- normalized_name: string unique
- created_at
- updated_at

TipTag
- tip_id
- tag_id
- sort_order: integer
- created_at
```

标签不是预设枚举。用户可以输入新标签，也可以复用历史标签；`normalized_name` 只用于大小写不敏感去重，界面展示首次保存的 `name`。`(tip_id, tag_id)` 唯一，排序按用户添加顺序稳定保存。

### AgentRule

```text
AgentRule
- id
- agent_id
- rule_type
- pattern
- weight
- enabled
- case_sensitive
```

支持类型：

- `process_name_exact`；
- `executable_path_regex`；
- `window_title_regex`；
- `terminal_child_process_exact`；
- `terminal_command_line_regex`；
- `window_class_exact`。

### AgentActivationState

```text
AgentActivationState
- agent_id
- last_detected_at?
- last_prompted_at?
- last_context_signature?
- updated_at
```

冷却状态按 Agent 保存，不按便签保存。

### HotkeyBinding

```text
HotkeyBinding
- schema_version: integer
- modifier: Ctrl
- key_code: SupportedKeyCode
```

不变量：

- modifier 固定为 `Ctrl`；
- key_code 恰好一个且来自统一支持集合；
- 不接受任意用户字符串、额外修饰键或 Esc；
- 展示文本由 key_code 派生，不作为业务主键；
- 高冲突只是警告分类，系统能否注册由 `HotkeyRegistrar` 决定。

## 2. SQLite Schema

以下为逻辑结构，Agent 可根据 Rust migration 工具调整具体语法，但字段语义不可改变。

```sql
CREATE TABLE tips (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX idx_tips_updated_at ON tips(updated_at DESC);
CREATE INDEX idx_tips_status ON tips(status);

CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tip_tags (
    tip_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tip_id, tag_id),
    FOREIGN KEY (tip_id) REFERENCES tips(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_tip_tags_tag ON tip_tags(tag_id, tip_id);

CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('desktop', 'terminal')),
    built_in INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    reminder_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tip_agent_bindings (
    tip_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    auto_attach INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tip_id, agent_id),
    FOREIGN KEY (tip_id) REFERENCES tips(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_bindings_agent_auto
ON tip_agent_bindings(agent_id, auto_attach);

CREATE TABLE agent_rules (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    pattern TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 10,
    enabled INTEGER NOT NULL DEFAULT 1,
    case_sensitive INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_rules_agent ON agent_rules(agent_id, enabled);

CREATE TABLE agent_activation_state (
    agent_id TEXT PRIMARY KEY,
    last_detected_at TEXT,
    last_prompted_at TEXT,
    last_context_signature TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- global_hotkey 的 value_json 示例：
-- {"schemaVersion":1,"modifier":"Ctrl","keyCode":"F12"}

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
```

必须执行：

```sql
PRAGMA foreign_keys = ON;
```

## 3. 设置值与版本化

- `global_hotkey` 必须保存结构化 JSON，而不是 `Ctrl+F12` 这样的自由字符串；
- 默认值为 `{ "schemaVersion": 1, "modifier": "Ctrl", "keyCode": "F12" }`；
- 设置解析失败时记录错误并回退到安全默认值，不覆盖损坏原值；
- 后续扩展快捷键 schema 时通过 `schemaVersion` 显式迁移；
- 设置 repository 对外返回领域值对象，其他模块不得直接解析 `value_json`。

## 4. 内置 Agent 种子数据

首次迁移后创建以下 Agent，但检测规则应允许后续校准：

| key               | name        | kind     |
| ----------------- | ----------- | -------- |
| `chatgpt-desktop` | ChatGPT     | desktop  |
| `cursor`          | Cursor      | desktop  |
| `trae`            | Trae        | desktop  |
| `claude-code`     | Claude Code | terminal |
| `opencode`        | OpenCode    | terminal |
| `codex-cli`       | Codex       | terminal |

不能假设某个可执行文件名在所有安装方式中都固定。内置规则是初始配置，不是不可修改的硬编码。

## 5. 查询语义

### 获取某 Agent 的自动携带便签

条件：

- Agent 启用且 `reminder_enabled = true`；
- Tip `status = active`；
- Tip 未删除；
- 绑定 `auto_attach = true`。

排序：

1. `sort_order` 升序；
2. `tip.updated_at` 降序；
3. `tip.id` 稳定排序。

### 搜索

MVP 使用 SQLite `LIKE` 搜索兼容旧标题、正文和标签即可，不增加 FTS 或向量索引。数据量增长后再评估 FTS5。

### 历史标签建议

只返回标签名，不加载历史便签正文；按最近复用时间倒序并设置受控上限。建议查询失败时，快捷窗口仍允许输入新标签。

## 6. 事务边界

以下操作必须为事务：

- 创建 Tip + 创建或复用标签 + 创建 TipTag + 创建多个绑定；
- 更新 Tip + 全量同步标签与绑定；
- 删除 Agent + 清理规则与状态；
- 归档 Tip；
- 提醒显示成功后更新激活状态；
- 快捷键设置持久化。快捷键系统注册不属于数据库事务，必须按架构文档执行补偿回滚。

窗口显示不能在数据库事务持有期间执行。推荐流程：

1. 读取资格与内容；
2. 创建/显示窗口；
3. 成功后开启短事务更新 `last_prompted_at`。

## 7. 迁移要求

- 迁移文件只追加，不修改已发布迁移；
- 应用启动自动执行迁移；
- 迁移失败时停止进入正常 UI，显示可恢复错误；
- 测试必须从空数据库执行所有迁移；
- 对现有数据库重复启动应保持幂等。
