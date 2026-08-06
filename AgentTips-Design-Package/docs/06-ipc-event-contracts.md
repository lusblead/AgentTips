# 06. IPC、Command 与事件契约

## 1. 原则

- IPC DTO 与领域实体分离；
- 所有 Command 返回结构化结果或结构化错误；
- 前端只通过 `DesktopApi` 调用，不在组件中使用任意字符串命令；
- Rust 发出的事件应少而稳定；
- 日期使用 ISO 8601 UTC 字符串；
- 字段命名统一使用 camelCase 对外、Rust 内部可用 snake_case 并通过 serde 转换。

## 2. Tip Commands

### `tip_create`

输入：

```ts
interface CreateTipInput {
  title?: string;
  content: string;
  status: "draft" | "active";
  bindings: Array<{
    agentId: string;
    autoAttach: boolean;
  }>;
}
```

输出：`TipDetailDto`

校验：

- active 正文不能为空；
- Agent 必须存在且未删除；
- bindings 中 agentId 不重复；
- 创建 Tip 与 bindings 必须同事务。

### `tip_update`

输入包含 `id`、可编辑字段和完整绑定集合。MVP 采用“全量替换绑定”语义，避免前端计算增删差异。

### `tip_list`

```ts
interface TipQuery {
  search?: string;
  agentId?: string;
  status?: "draft" | "active" | "archived";
  autoAttachOnly?: boolean;
  cursor?: string;
  limit?: number;
}
```

MVP 数据量较小，可先使用 offset 或简单 cursor；实现必须稳定排序。

### 其他

- `tip_get`
- `tip_archive`
- `tip_restore`
- `tip_delete`

## 3. Agent Commands

- `agent_list`
- `agent_get`
- `agent_create_custom`
- `agent_update`
- `agent_reset_builtin_rules`
- `agent_set_reminder_enabled`
- `agent_get_diagnostics`

自定义 Agent 输入需验证规则正则可编译。

## 4. Settings 与 Hotkey Commands

- `settings_get`
- `settings_get_hotkey`
- `settings_update_hotkey`
- `settings_set_global_pause`
- `settings_set_autostart`
- `settings_get_app_info`

```ts
interface HotkeyCandidateDto {
  modifier: "Ctrl";
  keyCode: string; // 例如 KeyK、Digit1、F12；禁止自由组合字符串
  confirmedHighConflict?: boolean;
}

interface HotkeyBindingDto {
  modifier: "Ctrl";
  keyCode: string;
  displayLabel: string;
  highConflict: boolean;
}

interface HotkeyUpdateResultDto {
  binding: HotkeyBindingDto;
  changed: boolean;
}
```

更新流程：

1. 前端录制控件提交结构化候选；
2. Rust 重新校验必须为 `Ctrl + 单个支持键`；
3. 高冲突组合未确认时返回警告型错误；
4. 先注册新组合；冲突或失败时保留旧组合；
5. 注册成功后持久化；持久化失败则注销新组合并继续使用旧组合；
6. 更新当前 generation/binding，再注销旧组合；
7. 发布设置变化事件。

前端不得直接调用 Tauri global shortcut 插件。

## 5. Window Commands

- `window_open_main(filter?)`
- `window_open_quick_note()`
- `window_hide_current()`
- `window_close_reminder()`
- `window_copy_reminder_content()`

敏感窗口生命周期操作在 Rust 中实现，前端不得自行创建任意 label 的窗口。

## 6. 事件

### `agenttips://reminder/show`

```ts
interface ReminderPayload {
  reminderId: string;
  agent: {
    id: string;
    key: string;
    name: string;
    kind: "desktop" | "terminal";
  };
  tips: Array<{
    id: string;
    title?: string;
    content: string;
  }>;
  triggeredAt: string;
}
```

### `agenttips://quick-note/reset`

快捷窗口每次显示前发送，前端清空上一次编辑状态并携带当前检测 Agent 推荐：

```ts
interface QuickNoteResetPayload {
  suggestedAgentId?: string;
  openedAt: string;
}
```

### `agenttips://settings/changed`

用于多窗口同步主题、全局暂停和当前快捷键。快捷键 payload 只包含规范化后的绑定，不包含录制按键历史。

### `agenttips://agent/current-changed`

仅供主窗口诊断区使用，不驱动前端业务冷却。

## 7. 错误契约

```ts
interface AppErrorDto {
  code: string;
  message: string;
  field?: string;
  retryable: boolean;
  traceId?: string;
}
```

建议错误码：

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `DATABASE_ERROR`
- `MIGRATION_ERROR`
- `HOTKEY_INVALID_FORMAT`
- `HOTKEY_UNSUPPORTED_KEY`
- `HOTKEY_HIGH_CONFLICT_CONFIRMATION_REQUIRED`
- `HOTKEY_CONFLICT`
- `HOTKEY_REGISTRATION_FAILED`
- `WINDOW_ERROR`
- `AGENT_RULE_INVALID`
- `PLATFORM_ACCESS_DENIED`
- `INTERNAL_ERROR`

用户界面显示可理解的信息；详细堆栈只写日志。

## 8. 强类型同步

建议从 Rust DTO 生成 TypeScript 类型，或建立契约测试确保字段一致。若使用生成工具，必须保持简单并提交生成结果；若不使用，至少添加序列化 fixture 测试。

## 9. Mock Desktop API

浏览器模式下提供内存实现，支持：

- CRUD；
- 模拟 Agent 切换；
- 模拟提醒事件；
- 模拟保存失败；
- 模拟空 Agent 列表；
- 模拟主题设置。

Mock 只用于开发预览和自动测试，不进入发布构建的默认路径。
