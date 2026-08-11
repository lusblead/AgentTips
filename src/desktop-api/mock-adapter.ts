import type {
  Agent,
  AgentBinding,
  AppSettings,
  CreateTipInput,
  DesktopApi,
  HotkeyBinding,
  HotkeyCandidate,
  HotkeyPreviewResult,
  HotkeyRuntimeState,
  DesktopDetectionStatus,
  MockFailureKind,
  NoteColorKey,
  QuickNoteCloseRequestedPayload,
  QuickNoteResetPayload,
  ReminderPayloadDto,
  ReminderSettings,
  ReminderSnoozeResult,
  ReminderTipDto,
  TipDetail,
  TipBindingDto,
  TipQuery,
  TipSummary,
  UpdateTipInput,
  WindowKind,
} from "./contract";

/** 统一支持键集合（KeyboardEvent.code 格式），与 Rust 侧保持一致。 */
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
    enabled: true,
    reminderEnabled: true,
  },
  {
    id: AGENT_IDS.cursor,
    key: "cursor",
    name: "Cursor",
    kind: "desktop",
    enabled: true,
    reminderEnabled: true,
  },
  {
    id: AGENT_IDS.trae,
    key: "trae",
    name: "Trae",
    kind: "desktop",
    enabled: true,
    reminderEnabled: true,
  },
  {
    id: AGENT_IDS.claudeCode,
    key: "claude-code",
    name: "Claude Code",
    kind: "terminal",
    enabled: true,
    reminderEnabled: true,
  },
  {
    id: AGENT_IDS.opencode,
    key: "opencode",
    name: "OpenCode",
    kind: "terminal",
    enabled: true,
    reminderEnabled: true,
  },
  {
    id: AGENT_IDS.codex,
    key: "codex-cli",
    name: "Codex",
    kind: "terminal",
    enabled: true,
    reminderEnabled: true,
  },
];

const FIXED_NOW = "2026-08-06T12:00:00.000Z";

interface SeedTip {
  id: string;
  title: string;
  content: string;
  tags: string[];
  status: "active" | "archived";
  colorKey: NoteColorKey;
  usedAt: string | null;
  updatedAt: string;
  bindings: AgentBinding[];
}

const SEED_COLORS: NoteColorKey[] = [
  "lemon",
  "apricot",
  "coral",
  "rose",
  "lavender",
  "periwinkle",
  "sky",
  "aqua",
  "mint",
  "sage",
];

const SEED_USED_TIP: SeedTip = {
  id: "tip-used-1",
  title: "已使用的示例",
  content: "这条便签已经完成使命，收进「已使用」盒子。",
  tags: ["已完成"],
  status: "active",
  colorKey: "sage",
  usedAt: "2026-08-06T13:00:00.000Z",
  updatedAt: FIXED_NOW,
  bindings: [{ agentId: AGENT_IDS.codex, autoAttach: true }],
};

type SeedTipBase = Omit<SeedTip, "colorKey" | "usedAt" | "updatedAt" | "tags"> & {
  tags?: string[];
};

function seedColorFor(id: string): NoteColorKey {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return SEED_COLORS[(hash >>> 0) % SEED_COLORS.length];
}

const SEED_TIPS: SeedTipBase[] = [
  {
    id: "tip-1",
    title: "修改前解释调用链",
    content: "修改任何核心模块前，先用一两句话说明调用链和影响范围。",
    tags: ["代码审查", "调用链"],
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
    tags: ["测试"],
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
  {
    id: "tip-6",
    title: "提交信息要可检索",
    content:
      "提交信息写明改动原因与影响面，避免只写 update/fix。团队需要能从 git log 快速定位变更动机。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.cursor, autoAttach: true },
      { agentId: AGENT_IDS.opencode, autoAttach: true },
      { agentId: AGENT_IDS.codex, autoAttach: false },
    ],
  },
  {
    id: "tip-7",
    title: "迁移先备份",
    content: "任何数据库迁移前先确认备份存在，迁移失败时保留原库不清空。",
    tags: ["数据库", "迁移"],
    status: "active",
    bindings: [{ agentId: AGENT_IDS.claudeCode, autoAttach: true }],
  },
  {
    id: "tip-8",
    title: "错误信息面向用户",
    content: "界面展示的错误要可理解，堆栈与原始 SQL 只写日志。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.chatgpt, autoAttach: true },
      { agentId: AGENT_IDS.cursor, autoAttach: true },
    ],
  },
  {
    id: "tip-9",
    title: "快捷键只触发窗口",
    content: "全局快捷键回调只负责打开快捷窗口，不执行耗时数据库查询。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.trae, autoAttach: true }],
  },
  {
    id: "tip-10",
    title: "时间统一 UTC",
    content: "数据库时间一律 UTC RFC3339，展示层再转换本地时区。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.codex, autoAttach: true },
      { agentId: AGENT_IDS.claudeCode, autoAttach: true },
    ],
  },
  {
    id: "tip-11",
    title: "不把 node.exe 当 Claude",
    content:
      "终端识别禁止以任意 node 进程作为 Claude Code 的唯一判断，必须匹配命令行与父子进程树。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.claudeCode, autoAttach: true }],
  },
  {
    id: "tip-12",
    title: "发布前跑全量验收",
    content: "acceptance 脚本全绿且原生冒烟无阻断项才允许宣称 MVP 完成。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.opencode, autoAttach: true },
      { agentId: AGENT_IDS.cursor, autoAttach: true },
    ],
  },
  {
    id: "tip-13",
    title: "便签墙隐喻",
    content: "首页是桌面，Tip 是一张真实便签纸，颜色来自 10 色正式 Palette。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.trae, autoAttach: true }],
  },
  {
    id: "tip-14",
    title: "首页直接书写",
    content: "看到文字点文字即可输入，650ms 自动保存，不出现传统输入框外框。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.cursor, autoAttach: true },
      { agentId: AGENT_IDS.chatgpt, autoAttach: false },
    ],
  },
  {
    id: "tip-15",
    title: "长便签向下生长",
    content: "正文越来越多时，便签纸向下生长而不加宽；下方便签自动重新排布，形成不等高的便签墙。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.claudeCode, autoAttach: true }],
  },
  {
    id: "tip-16",
    title: "已使用与归档不同",
    content: "used 表示完成使命收进盒子，archived 表示主动长期收纳，二者互不等同。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.codex, autoAttach: true },
      { agentId: AGENT_IDS.opencode, autoAttach: true },
    ],
  },
  {
    id: "tip-17",
    title: "颜色创建时分配",
    content: "颜色建议排除最近两张便签的颜色，连续三张不会同色；保存后永久持久化。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.trae, autoAttach: true }],
  },
  {
    id: "tip-18",
    title: "Mark Used 收进盒子",
    content: "hover 显示两个轻量操作：展开详情与标记已使用；标记后 160ms 动画离开首页。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.cursor, autoAttach: true },
      { agentId: AGENT_IDS.claudeCode, autoAttach: true },
    ],
  },
  {
    id: "tip-19",
    title: "详细编辑聚焦管理",
    content:
      "Detailed Editor 负责 Agent、autoAttach、复制与删除；正文区可滚动，Agent 与底部操作不被覆盖。",
    status: "active",
    bindings: [{ agentId: AGENT_IDS.opencode, autoAttach: true }],
  },
  {
    id: "tip-20",
    title: "颜色随机但稳定",
    content:
      "每次打开快捷窗口重新建议颜色；保存成功后颜色不变，重启、搜索、筛选、编辑、标记使用与恢复都不改变。",
    status: "active",
    bindings: [
      { agentId: AGENT_IDS.codex, autoAttach: true },
      { agentId: AGENT_IDS.trae, autoAttach: true },
    ],
  },
];

function withSeedMeta(tip: SeedTipBase): SeedTip {
  return {
    ...tip,
    tags: [...(tip.tags ?? [])],
    colorKey: seedColorFor(tip.id),
    usedAt: null,
    updatedAt: FIXED_NOW,
  };
}

const SEED_SETTINGS: AppSettings = {
  theme: "system",
  globalPause: false,
  hotkey: hotkeyBinding("F12"),
};

const SEED_REMINDER_PAYLOAD: ReminderPayloadDto = {
  agentKey: "cursor",
  agentId: AGENT_IDS.cursor,
  agentDisplayName: "Cursor",
  generatedAt: FIXED_NOW,
  tips: SEED_TIPS.slice(0, 3).map((tip): ReminderTipDto => ({
    tipId: tip.id,
    title: tip.title,
    body: tip.content,
    colorKey: seedColorFor(tip.id),
  })),
};

function summarize(tip: SeedTip): TipSummary {
  return {
    id: tip.id,
    title: tip.title,
    content: tip.content,
    tags: [...tip.tags],
    status: tip.status,
    updatedAt: FIXED_NOW,
    colorKey: tip.colorKey,
    usedAt: tip.usedAt,
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
    tags: [...tip.tags],
    status: tip.status,
    updatedAt: FIXED_NOW,
    colorKey: tip.colorKey,
    usedAt: tip.usedAt,
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
  private reminderSettings: ReminderSettings;
  private agentReminderSnoozes: Map<string, string>;
  private currentReminderPayload: ReminderPayloadDto | null;
  private reminderShowListeners: Array<(payload: ReminderPayloadDto) => void>;
  private failures: Record<MockFailureKind, boolean> = {
    save: false,
    delete: false,
    hotkey: false,
  };
  private saveDelayMs = 0;
  windowCalls: string[] = [];
  hotkeyCalls: string[] = [];
  reminderSnoozeCalls: number[] = [];
  agentReminderSnoozeCalls: Array<{ agentKey: string; hours: number }> = [];
  agentReminderResumeCalls: string[] = [];
  private listeners: {
    quickNoteReset: Array<(payload: QuickNoteResetPayload) => void>;
    quickNoteCloseRequested: Array<(payload: QuickNoteCloseRequestedPayload) => void>;
  } = {
    quickNoteReset: [],
    quickNoteCloseRequested: [],
  };

  constructor(options?: { withSeed?: boolean; withUsedTip?: boolean }) {
    this.agents = SEED_AGENTS.map((agent) => ({ ...agent }));
    this.tips = (options?.withSeed === false ? [] : SEED_TIPS).map((tip) => ({
      ...withSeedMeta(tip),
      tags: [...(tip.tags ?? [])],
      bindings: tip.bindings.map((b) => ({ ...b })),
    }));
    if (options?.withSeed !== false && options?.withUsedTip !== false) {
      this.tips.push({
        ...SEED_USED_TIP,
        tags: [...SEED_USED_TIP.tags],
        bindings: SEED_USED_TIP.bindings.map((b) => ({ ...b })),
      });
    }
    this.settings = {
      ...SEED_SETTINGS,
      hotkey: { ...SEED_SETTINGS.hotkey },
    };
    this.reminderSettings = {
      cooldownMinutes: 15,
      updatedAt: FIXED_NOW,
    };
    this.agentReminderSnoozes = new Map();
    this.currentReminderPayload = null;
    this.reminderShowListeners = [];
  }

  async listTips(query?: TipQuery): Promise<TipSummary[]> {
    let items = this.tips.map((tip) => summarize(tip));
    const used = query?.used ?? false;
    items = items.filter((tip) => (used ? tip.usedAt !== null : tip.usedAt === null));
    if (query?.agentId) {
      items = items.filter((tip) => tip.agentIds.includes(query.agentId as string));
    }
    if (query?.search?.trim()) {
      const needle = query.search.trim().toLowerCase();
      items = items.filter(
        (tip) =>
          tip.title.toLowerCase().includes(needle) ||
          tip.content.toLowerCase().includes(needle) ||
          tip.tags.some((tag) => tag.toLowerCase().includes(needle)),
      );
    }
    return items;
  }

  async listTags(): Promise<string[]> {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const tip of this.tips) {
      for (const tag of tip.tags) {
        const key = tag.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
      }
    }
    return tags;
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
      title: input.title?.trim() ?? "",
      content,
      tags: normalizeMockTags(input.tags ?? []),
      status: "active",
      colorKey: input.colorKey ?? (await this.suggestNoteColor()),
      usedAt: null,
      updatedAt: now,
      bindings: input.bindings.map((b) => ({ ...b })),
    };
    this.tips.unshift({
      ...tip,
      tags: [...tip.tags],
      bindings: tip.bindings.map((b) => ({ ...b })),
    });
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
      tip.title = input.title.trim();
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
    if (input.tags !== undefined) {
      tip.tags = normalizeMockTags(input.tags);
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

  async suggestNoteColor(): Promise<NoteColorKey> {
    const recent = this.tips
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, 2)
      .map((tip) => tip.colorKey);
    const pool = SEED_COLORS.filter((color) => !recent.includes(color));
    const candidates = pool.length > 0 ? pool : SEED_COLORS;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  async updateTipText(id: string, title: string, content: string): Promise<TipDetail> {
    if (this.failures.save) {
      throw new Error("模拟保存失败：数据库写入被拒绝");
    }
    const tip = this.tips.find((t) => t.id === id);
    if (!tip) {
      throw new Error(`便签不存在: ${id}`);
    }
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("便签正文不能为空");
    }
    const previousColor = tip.colorKey;
    const previousUsedAt = tip.usedAt;
    const previousBindings = tip.bindings;
    const previousTags = tip.tags;
    tip.title = title.trim();
    tip.content = trimmed;
    tip.updatedAt = new Date().toISOString();
    const result = detailOf(tip);
    // text-only 不触碰其他字段
    result.colorKey = previousColor;
    result.usedAt = previousUsedAt;
    tip.colorKey = previousColor;
    tip.usedAt = previousUsedAt;
    tip.bindings = previousBindings;
    tip.tags = previousTags;
    return result;
  }

  async markTipUsed(id: string): Promise<TipDetail> {
    const tip = this.tips.find((t) => t.id === id);
    if (!tip) {
      throw new Error(`便签不存在: ${id}`);
    }
    tip.usedAt = new Date().toISOString();
    return detailOf(tip);
  }

  async restoreTipUsed(id: string): Promise<TipDetail> {
    const tip = this.tips.find((t) => t.id === id);
    if (!tip) {
      throw new Error(`便签不存在: ${id}`);
    }
    tip.usedAt = null;
    return detailOf(tip);
  }

  async updateTipColor(id: string, colorKey: NoteColorKey): Promise<TipDetail> {
    const tip = this.tips.find((t) => t.id === id);
    if (!tip) {
      throw new Error(`便签不存在: ${id}`);
    }
    tip.colorKey = colorKey;
    return detailOf(tip);
  }

  async openMainWindow(): Promise<void> {
    this.windowCalls.push("openMainWindow");
  }

  async openQuickNoteWindow(): Promise<void> {
    this.windowCalls.push("openQuickNoteWindow");
  }

  async openSettingsWindow(): Promise<void> {
    this.windowCalls.push("openSettingsWindow");
  }

  async hideCurrentWindow(_label: string): Promise<void> {
    this.windowCalls.push("hideCurrentWindow");
    // 浏览器模式：隐藏 Quick Note 等价于重置 draft（与生产 show 事件语义一致）
    this.emitQuickNoteReset({ openedAt: new Date().toISOString() });
  }

  async getWindowKind(): Promise<WindowKind> {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("window");
    if (kind === "quick-note" || kind === "settings" || kind === "reminder") {
      return kind;
    }
    return "main";
  }

  async subscribeQuickNoteReset(
    handler: (payload: QuickNoteResetPayload) => void,
  ): Promise<() => void> {
    this.listeners.quickNoteReset.push(handler);
    return () => {
      const idx = this.listeners.quickNoteReset.indexOf(handler);
      if (idx >= 0) this.listeners.quickNoteReset.splice(idx, 1);
    };
  }

  /** 测试/浏览器模拟：模拟 Quick Note 显示时的新 Draft Session。 */
  simulateQuickNoteReset(): void {
    this.emitQuickNoteReset({ openedAt: new Date().toISOString() });
  }

  private emitQuickNoteReset(payload: QuickNoteResetPayload): void {
    this.listeners.quickNoteReset.forEach((handler) => handler(payload));
  }

  async subscribeQuickNoteCloseRequested(
    handler: (payload: QuickNoteCloseRequestedPayload) => void,
  ): Promise<() => void> {
    this.listeners.quickNoteCloseRequested.push(handler);
    return () => {
      const idx = this.listeners.quickNoteCloseRequested.indexOf(handler);
      if (idx >= 0) this.listeners.quickNoteCloseRequested.splice(idx, 1);
    };
  }

  /** 测试/浏览器模拟：模拟系统标题栏关闭请求。 */
  simulateQuickNoteCloseRequested(): void {
    const payload = { requestedAt: new Date().toISOString() };
    this.listeners.quickNoteCloseRequested.forEach((handler) => handler(payload));
  }

  async listAgents(): Promise<Agent[]> {
    return this.agents.map((agent) => ({ ...agent }));
  }

  async updateAgentEnabled(agentId: string, enabled: boolean): Promise<Agent> {
    const index = this.agents.findIndex((agent) => agent.id === agentId);
    if (index < 0) {
      throw Object.assign(new Error("Agent 不存在"), { code: "NOT_FOUND" });
    }
    this.agents[index] = { ...this.agents[index], enabled };
    return { ...this.agents[index] };
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
        ok: true,
        binding,
        warning: {
          code: "HIGH_CONFLICT",
          message: `Ctrl + ${hotkeyDisplayKey(input.keyCode)} 通常用于系统常用操作，设为全局快捷键可能影响其他软件`,
        },
      };
    }
    return { ok: true, binding };
  }

  async getHotkeySettings(): Promise<HotkeyRuntimeState> {
    return {
      configured: { ...this.settings.hotkey },
      active: { ...this.settings.hotkey },
      registrationError: null,
    };
  }

  async updateHotkey(input: HotkeyCandidate): Promise<HotkeyBinding> {
    if (input.modifier !== "Ctrl") {
      throw {
        code: "HOTKEY_INVALID",
        message: "快捷键只能使用 Ctrl + 一个按键",
      };
    }
    if (!SUPPORTED_KEY_CODES.includes(input.keyCode as (typeof SUPPORTED_KEY_CODES)[number])) {
      throw {
        code: "HOTKEY_UNSUPPORTED_KEY",
        message: `按键 ${input.keyCode} 不在支持范围`,
      };
    }
    if (this.failures.hotkey) {
      throw {
        code: "HOTKEY_REGISTRATION_FAILED",
        message: `无法注册 Ctrl + ${hotkeyDisplayKey(input.keyCode)}：该快捷键可能已被系统或其他程序占用`,
      };
    }
    this.hotkeyCalls.push(`update:${input.keyCode}`);
    this.settings.hotkey = hotkeyBinding(input.keyCode);
    return { ...this.settings.hotkey };
  }

  async beginHotkeyRecording(): Promise<void> {
    this.hotkeyCalls.push("begin");
  }

  async endHotkeyRecording(): Promise<void> {
    this.hotkeyCalls.push("end");
  }

  async getDesktopDetectionStatus(): Promise<DesktopDetectionStatus> {
    return {
      status: "NoMatch",
      agentId: null,
      processName: "mock-browser.exe",
      matchKind: null,
      source: "Desktop",
      terminalStatus: null,
      effectiveExternalAgent: null,
      observedAt: FIXED_NOW,
    };
  }

  async getReminderSettings(): Promise<ReminderSettings> {
    return { ...this.reminderSettings };
  }

  async updateReminderSettings(cooldownMinutes: number): Promise<ReminderSettings> {
    if (cooldownMinutes < 1 || cooldownMinutes > 120) {
      throw Object.assign(new Error("冷却时长必须在 1 ～ 120 分钟之间"), {
        code: "VALIDATION_ERROR",
      });
    }
    this.reminderSettings = {
      cooldownMinutes,
      updatedAt: FIXED_NOW,
    };
    return { ...this.reminderSettings };
  }

  async dismissReminder(): Promise<void> {
    this.currentReminderPayload = null;
    return undefined;
  }

  async snoozeReminder(hours: number): Promise<ReminderSnoozeResult> {
    if (![1, 2, 4, 8, 24].includes(hours)) {
      throw Object.assign(new Error("稍后提醒时长必须是 1、2、4、8 或 24 小时"), {
        code: "VALIDATION_ERROR",
      });
    }
    if (!this.currentReminderPayload) {
      throw Object.assign(new Error("当前没有可暂停的提醒"), { code: "VALIDATION_ERROR" });
    }
    const payload = this.currentReminderPayload;
    const result = await this.snoozeAgentReminders(payload.agentKey, hours);
    this.reminderSnoozeCalls.push(hours);
    this.currentReminderPayload = null;
    return result;
  }

  async getAgentReminderSnoozes(): Promise<ReminderSnoozeResult[]> {
    return [...this.agentReminderSnoozes.entries()].map(([agentKey, snoozedUntil]) => ({
      agentKey,
      snoozedUntil,
    }));
  }

  async snoozeAgentReminders(agentKey: string, hours: number): Promise<ReminderSnoozeResult> {
    if (![1, 2, 4, 8, 24].includes(hours)) {
      throw Object.assign(new Error("稍后提醒时长必须是 1、2、4、8 或 24 小时"), {
        code: "VALIDATION_ERROR",
      });
    }
    if (!this.agents.some((agent) => agent.key === agentKey)) {
      throw Object.assign(new Error("Agent 不存在"), { code: "NOT_FOUND" });
    }
    const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    this.agentReminderSnoozes.set(agentKey, snoozedUntil);
    this.agentReminderSnoozeCalls.push({ agentKey, hours });
    return { agentKey, snoozedUntil };
  }

  async resumeAgentReminders(agentKey: string): Promise<void> {
    if (!this.agents.some((agent) => agent.key === agentKey)) {
      throw Object.assign(new Error("Agent 不存在"), { code: "NOT_FOUND" });
    }
    this.agentReminderSnoozes.delete(agentKey);
    this.agentReminderResumeCalls.push(agentKey);
  }

  async getCurrentReminderPayload(): Promise<ReminderPayloadDto | null> {
    return this.currentReminderPayload ? clonePayload(this.currentReminderPayload) : null;
  }

  async subscribeReminderShow(handler: (payload: ReminderPayloadDto) => void): Promise<() => void> {
    this.reminderShowListeners.push(handler);
    return () => {
      this.reminderShowListeners = this.reminderShowListeners.filter((h) => h !== handler);
    };
  }

  /** 测试/调试辅助：模拟后端展示事件（不进入生产 Tauri 路径）。 */
  emitReminder(payload: ReminderPayloadDto): void {
    this.currentReminderPayload = clonePayload(payload);
    for (const handler of [...this.reminderShowListeners]) {
      handler(clonePayload(payload));
    }
  }

  /** 测试/调试辅助：返回内置固定演示 payload。 */
  seedReminderPayload(): ReminderPayloadDto {
    return clonePayload(SEED_REMINDER_PAYLOAD);
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
      ...withSeedMeta(tip),
      tags: [...(tip.tags ?? [])],
      bindings: tip.bindings.map((b) => ({ ...b })),
    }));
    this.settings = {
      ...SEED_SETTINGS,
      hotkey: { ...SEED_SETTINGS.hotkey },
    };
    this.reminderSettings = {
      cooldownMinutes: 15,
      updatedAt: FIXED_NOW,
    };
    this.agentReminderSnoozes = new Map();
    this.currentReminderPayload = null;
    this.reminderShowListeners = [];
    this.failures = { save: false, delete: false, hotkey: false };
    this.saveDelayMs = 0;
    this.windowCalls = [];
    this.reminderSnoozeCalls = [];
    this.agentReminderSnoozeCalls = [];
    this.agentReminderResumeCalls = [];
  }
}

function clonePayload(payload: ReminderPayloadDto): ReminderPayloadDto {
  return {
    ...payload,
    tips: payload.tips.map((tip) => ({ ...tip })),
  };
}

function normalizeMockTags(values: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = value.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    if ([...name].length > 32) throw new Error(`标签“${name}”不能超过 32 个字符`);
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(name);
  }
  if (tags.length > 8) throw new Error("每条便签最多添加 8 个标签");
  return tags;
}
