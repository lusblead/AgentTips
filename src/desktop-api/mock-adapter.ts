import type {
  Agent,
  AgentBinding,
  AppSettings,
  CreateTipInput,
  DesktopApi,
  HotkeyBinding,
  HotkeyCandidate,
  HotkeyPreviewResult,
  MockFailureKind,
  ReminderPreview,
  TipDetail,
  TipBindingDto,
  TipQuery,
  TipSummary,
  UpdateTipInput,
} from "./contract";

/** 统一支持键集合（KeyboardEvent.code 格式）。Phase 2 起与 Rust 侧一致。 */
export const SUPPORTED_KEY_CODES: readonly string[] = [
  "KeyA",
  "KeyB",
  "KeyC",
  "KeyD",
  "KeyE",
  "KeyF",
  "KeyG",
  "KeyH",
  "KeyI",
  "KeyJ",
  "KeyK",
  "KeyL",
  "KeyM",
  "KeyN",
  "KeyO",
  "KeyP",
  "KeyQ",
  "KeyR",
  "KeyS",
  "KeyT",
  "KeyU",
  "KeyV",
  "KeyW",
  "KeyX",
  "KeyY",
  "KeyZ",
  "Digit0",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
] as const;

export const HIGH_CONFLICT_KEY_CODES: readonly string[] = [
  "KeyA",
  "KeyC",
  "KeyV",
  "KeyX",
  "KeyZ",
  "KeyS",
  "KeyF",
  "KeyO",
  "KeyP",
  "KeyN",
  "KeyW",
  "KeyT",
  "KeyR",
  "KeyL",
] as const;

export function hotkeyDisplayKey(keyCode: string): string {
  if (keyCode.startsWith("Key")) return keyCode.slice(3);
  if (keyCode.startsWith("Digit")) return keyCode.slice(5);
  const punctuation: Record<string, string> = {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };
  return punctuation[keyCode] ?? keyCode;
}

function hotkeyBinding(keyCode: string): HotkeyBinding {
  return {
    modifier: "Ctrl",
    keyCode,
    displayLabel: `Ctrl + ${hotkeyDisplayKey(keyCode)}`,
    highConflict: HIGH_CONFLICT_KEY_CODES.includes(keyCode),
  };
}

const AGENT_IDS = {
  chatgpt: "agent-chatgpt",
  cursor: "agent-cursor",
  trae: "agent-trae",
  claudeCode: "agent-claude-code",
  opencode: "agent-opencode",
  codex: "agent-codex",
} as const;

const SEED_AGENTS: Agent[] = [
  {
    id: AGENT_IDS.chatgpt,
    key: "chatgpt-desktop",
    name: "ChatGPT",
    kind: "desktop",
    reminderEnabled: true,
  },
  { id: AGENT_IDS.cursor, key: "cursor", name: "Cursor", kind: "desktop", reminderEnabled: true },
  { id: AGENT_IDS.trae, key: "trae", name: "Trae", kind: "desktop", reminderEnabled: true },
  {
    id: AGENT_IDS.claudeCode,
    key: "claude-code",
    name: "Claude Code",
    kind: "terminal",
    reminderEnabled: true,
  },
  {
    id: AGENT_IDS.opencode,
    key: "opencode",
    name: "OpenCode",
    kind: "terminal",
    reminderEnabled: true,
  },
  { id: AGENT_IDS.codex, key: "codex-cli", name: "Codex", kind: "terminal", reminderEnabled: true },
];

const FIXED_NOW = "2026-08-06T12:00:00.000Z";

interface SeedTip {
  id: string;
  title: string;
  content: string;
  status: "active" | "archived";
  bindings: AgentBinding[];
}

const SEED_TIPS: SeedTip[] = [
  {
    id: "tip-1",
    title: "修改前解释调用链",
    content: "修改任何核心模块前，先用一两句话说明调用链和影响范围。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.cursor, autoAttach: true },
      { agentId: AGENT_IDS.claudeCode, autoAttach: true },
    ],
  },
  {
    id: "tip-2",
    title: "完成后运行全部测试",
    content: "提交前运行 pnpm test、cargo test 与 acceptance 脚本。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.claudeCode, autoAttach: true }],
  },
  {
    id: "tip-3",
    title: "不做无关重构",
    content: "保持最小、有界的修改，不顺手改动无关文件。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.cursor, autoAttach: false }],
  },
  {
    id: "tip-4",
    title: "依赖先读锁文件",
    content: "新增依赖前检查 pnpm-lock.yaml 与 Cargo.lock 是否已锁定。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.codex, autoAttach: true }],
  },
  {
    id: "tip-5",
    title: "已归档示例",
    content: "这条便签已归档，不参与自动提醒。",
    status: "archived",
    bindings: [{ agentId: AGENT_IDS.trae, autoAttach: false }],
  },
];

const SEED_SETTINGS: AppSettings = {
  theme: "system",
  globalPause: false,
  hotkey: hotkeyBinding("F12"),
};

const SEED_REMINDER_PREVIEW: ReminderPreview = {
  agent: { id: AGENT_IDS.cursor, name: "Cursor" },
  tips: SEED_TIPS.slice(0, 3).map((tip) => ({
    id: tip.id,
    title: tip.title,
    content: tip.content,
  })),
};

function summarize(tip: SeedTip): TipSummary {
  return {
    id: tip.id,
    title: tip.title,
    content: tip.content,
    status: tip.status,
    updatedAt: FIXED_NOW,
    agentIds: tip.bindings.map((b) => b.agentId),
  };
}

function detailOf(tip: SeedTip): TipDetail {
  const bindings: TipBindingDto[] = tip.bindings.map((binding, index) => ({
    ...binding,
    sortOrder: index,
  }));
  return {
    id: tip.id,
    title: tip.title,
    content: tip.content,
    status: tip.status,
    updatedAt: FIXED_NOW,
    bindings,
  };
}

/**
 * MockDesktopApi：内存实现，数据可预测、支持 reset 与模拟失败。
 * 仅用于浏览器调试与自动测试，不进入 Tauri 生产路径。
 */
export class MockDesktopApi implements DesktopApi {
  private agents: Agent[];
  private tips: SeedTip[];
  private settings: AppSettings;
  private reminderPreview: ReminderPreview;
  private failures: Record<MockFailureKind, boolean> = { save: false, delete: false };
  private saveDelayMs = 0;

  constructor(options?: { withSeed?: boolean }) {
    this.agents = SEED_AGENTS.map((agent) => ({ ...agent }));
    this.tips = (options?.withSeed === false ? [] : SEED_TIPS).map((tip) => ({
      ...tip,
      bindings: tip.bindings.map((b) => ({ ...b })),
    }));
    this.settings = {
      ...SEED_SETTINGS,
      hotkey: { ...SEED_SETTINGS.hotkey },
    };
    this.reminderPreview = {
      agent: { ...SEED_REMINDER_PREVIEW.agent },
      tips: SEED_REMINDER_PREVIEW.tips.map((tip) => ({ ...tip })),
    };
  }

  async listTips(query?: TipQuery): Promise<TipSummary[]> {
    let items = this.tips.map((tip) => summarize(tip));
    if (query?.agentId) {
      items = items.filter((tip) => tip.agentIds.includes(query.agentId as string));
    }
    if (query?.search?.trim()) {
      const needle = query.search.trim().toLowerCase();
      items = items.filter(
        (tip) =>
          tip.title.toLowerCase().includes(needle) || tip.content.toLowerCase().includes(needle),
      );
    }
    return items;
  }

  async getTip(id: string): Promise<TipDetail | null> {
    const tip = this.tips.find((t) => t.id === id);
    return tip ? detailOf(tip) : null;
  }

  async createTip(input: CreateTipInput): Promise<TipDetail> {
    if (this.saveDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.saveDelayMs));
    }
    if (this.failures.save) {
      throw new Error("模拟保存失败：数据库写入被拒绝");
    }
    const content = input.content.trim();
    if (!content) {
      throw new Error("便签正文不能为空");
    }
    const now = new Date().toISOString();
    const bindings: TipBindingDto[] = input.bindings.map((binding, index) => ({
      ...binding,
      sortOrder: index,
    }));
    const tip: SeedTip = {
      id: `tip-${this.tips.length + 1}`,
      title: input.title?.trim() || firstLine(content),
      content,
      status: "active",
      bindings: input.bindings.map((b) => ({ ...b })),
    };
    this.tips.unshift({ ...tip, bindings: tip.bindings.map((b) => ({ ...b })) });
    return { ...detailOf(tip), updatedAt: now, bindings };
  }

  async updateTip(id: string, input: UpdateTipInput): Promise<TipDetail> {
    if (this.failures.save) {
      throw new Error("模拟保存失败：数据库写入被拒绝");
    }
    const tip = this.tips.find((t) => t.id === id);
    if (!tip) {
      throw new Error(`便签不存在: ${id}`);
    }
    if (input.title !== undefined) {
      tip.title = input.title.trim() || firstLine(tip.content);
    }
    if (input.content !== undefined) {
      const content = input.content.trim();
      if (!content) {
        throw new Error("便签正文不能为空");
      }
      tip.content = content;
    }
    if (input.bindings !== undefined) {
      tip.bindings = input.bindings.map((b) => ({ ...b }));
    }
    return detailOf(tip);
  }

  async deleteTip(id: string): Promise<void> {
    if (this.failures.delete) {
      throw new Error("模拟删除失败：数据库错误");
    }
    const before = this.tips.length;
    this.tips = this.tips.filter((t) => t.id !== id);
    if (this.tips.length === before) {
      throw new Error(`便签不存在: ${id}`);
    }
  }

  async listAgents(): Promise<Agent[]> {
    return this.agents.map((agent) => ({ ...agent }));
  }

  async getSettings(): Promise<AppSettings> {
    return {
      ...this.settings,
      hotkey: { ...this.settings.hotkey },
    };
  }

  async previewHotkey(input: HotkeyCandidate): Promise<HotkeyPreviewResult> {
    if (input.modifier !== "Ctrl") {
      return { ok: false, reason: "invalid", message: "主快捷键必须为 Ctrl + 一个键" };
    }
    if (!SUPPORTED_KEY_CODES.includes(input.keyCode as (typeof SUPPORTED_KEY_CODES)[number])) {
      return { ok: false, reason: "unsupported", message: `不支持的按键: ${input.keyCode}` };
    }
    const binding = hotkeyBinding(input.keyCode);
    if (binding.highConflict) {
      return {
        ok: false,
        reason: "highConflict",
        message: `Ctrl + ${hotkeyDisplayKey(input.keyCode)} 可能覆盖系统常用操作，请确认后使用`,
      };
    }
    return { ok: true, binding };
  }

  async getReminderPreview(): Promise<ReminderPreview> {
    return {
      agent: { ...this.reminderPreview.agent },
      tips: this.reminderPreview.tips.map((tip) => ({ ...tip })),
    };
  }

  setMockFailure(kind: MockFailureKind, enabled: boolean): void {
    this.failures[kind] = enabled;
  }

  /** 测试辅助：模拟异步写入耗时，用于验证防重复提交。 */
  setSaveDelay(ms: number): void {
    this.saveDelayMs = ms;
  }

  reset(): void {
    this.agents = SEED_AGENTS.map((agent) => ({ ...agent }));
    this.tips = SEED_TIPS.map((tip) => ({
      ...tip,
      bindings: tip.bindings.map((b) => ({ ...b })),
    }));
    this.settings = {
      ...SEED_SETTINGS,
      hotkey: { ...SEED_SETTINGS.hotkey },
    };
    this.reminderPreview = {
      agent: { ...SEED_REMINDER_PREVIEW.agent },
      tips: SEED_REMINDER_PREVIEW.tips.map((tip) => ({ ...tip })),
    };
    this.failures = { save: false, delete: false };
    this.saveDelayMs = 0;
  }
}

function firstLine(content: string): string {
  return content.trim().split(/\r?\n/, 1)[0]?.trim() ?? content;
}
