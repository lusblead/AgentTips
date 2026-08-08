---
feature_id: "quick-note.create"
title: "Create a quick note"
status: "implemented"
---

# Create a quick note

## Purpose

让用户从全局快捷键、托盘或主窗口快速打开一个紧凑便签，在无标题、正文无边框的纸面上记录内容，自由输入标签或复用以前写过的标签，再按需绑定零个或多个 Agent。历史标签只是输入建议，不是固定分类；建议加载失败也不能阻止新标签输入。所有关闭入口都必须保护未保存的正文、标签和绑定。

## Entry, preconditions, and terminal outcomes

- Create entry: 全局快捷键、托盘菜单或主窗口“新建提示”动作显示 `quick-note` 窗口。
- Close entry: 用户按 `Esc`、点击便签内关闭按钮，或点击系统标题栏关闭按钮。
- Save preconditions: 正文去除首尾空白后非空，并且同一时刻没有正在进行的保存请求；标签由用户自由输入，历史标签仅作为可复用建议，标签与 Agent 绑定均可为空。
- Save success: 标题保持为空，Tip、规范化标签与零个或多个 Agent 绑定被原子持久化；界面显示短暂成功反馈，清空草稿并隐藏窗口。
- Save rejection: 正文为空或已有保存请求时不调用创建接口，窗口继续显示当前草稿。
- Save failure: 创建失败时完整显示可滚动、可选择的错误文本，正文、标签输入、已选标签、绑定和窗口可见状态都保持不变。
- Close success: 空草稿直接隐藏；非空草稿只有在用户明确确认放弃后才清空并隐藏。
- Close cancellation: 用户选择继续编辑，或保存仍在进行时，窗口保持可见且草稿不变。

## Runtime flow

```mermaid
flowchart TD
    E1(["E1 快捷键、托盘或主窗口打开快速便签"]) --> A1["A1 隐藏到显示时重置草稿并聚焦正文"]
    A1 --> A7["A7 请求可复用的历史标签"]
    A7 --> D7{"D7 历史标签是否加载成功？"}
    D7 -->|是| A2["A2 用户编辑正文、自由输入或复用标签并可选绑定 Agent"]
    D7 -->|否| A8["A8 保留自由输入标签能力，不展示历史建议"]
    A8 --> A2
    A2 -->|保存| D1{"D1 正文是否非空？"}
    D1 -->|否| X1(["X1 保留草稿且不创建 Tip"])
    D1 -->|是| D2{"D2 是否已有保存请求进行中？"}
    D2 -->|是| X2(["X2 忽略重复提交并保留当前状态"])
    D2 -->|否| A3["A3 调用 createTip 保存无标题正文、标签与零个或多个绑定"]
    A3 --> D3{"D3 保存是否成功？"}
    D3 -->|否| X3(["X3 完整显示错误并保留正文、标签与绑定"])
    D3 -->|是| T1["T1 无标题 Tip、标签与绑定原子持久化"]
    T1 --> A4["A4 显示成功反馈、清空草稿并隐藏窗口"]
    A4 --> X4(["X4 新便签可在主窗口读取"])

    E2(["E2 Esc、界面关闭或系统标题栏关闭"]) --> D4{"D4 保存是否正在进行？"}
    D4 -->|是| X5(["X5 保持窗口和草稿，等待保存完成"])
    D4 -->|否| D5{"D5 是否有未保存正文、标签或绑定？"}
    D5 -->|否| A5["A5 清理空会话并隐藏窗口"]
    D5 -->|是| A6["A6 显示放弃未保存内容确认"]
    A6 --> D6{"D6 用户是否确认放弃？"}
    D6 -->|否| X6(["X6 关闭确认并继续编辑"])
    D6 -->|是| A5
    A5 --> X7(["X7 窗口隐藏且未创建 Tip"])

    G1["G1 正文创建校验"] -.-> D1
    G1 -.-> A3
    G2["G2 保存互斥锁"] -.-> D2
    G2 -.-> A3
    G3["G3 保存失败保留并完整呈现"] -.-> X3
    G4["G4 紧凑无重叠布局"] -.-> A2
    G4 -.-> A6
    G5["G5 未保存草稿保护"] -.-> D5
    G5 -.-> A5
    G5 -.-> X7
    G6["G6 标签规范化与边界校验"] -.-> A3
    G6 -.-> T1
    G7["G7 Tip、标签与绑定事务原子性"] -.-> T1
    G8["G8 历史标签加载失败可降级"] -.-> A8
    G8 -.-> A2
```

## Component sequence

```mermaid
sequenceDiagram
    actor U as User
    participant H as Hotkey / Tray / Main
    participant W as Tauri Window Layer
    participant Q as QuickNoteWindow
    participant API as DesktopApi
    participant S as TipService
    participant DB as SQLite

    U->>H: 打开快速便签
    H->>W: show(quick-note)
    W-->>Q: 首次显示或 reset 事件
    Q->>Q: 清空正文、标签与绑定草稿并聚焦正文
    Q->>API: listTags()
    alt 历史标签加载成功
        API-->>Q: 最近使用的标签建议
    else 历史标签加载失败
        API-->>Q: error
        Q-->>U: 保持自由输入标签，不阻止创建
    end
    U->>Q: 输入正文、写新标签或复用旧标签、可选绑定 Agent、保存
    Q->>Q: 校验正文并锁定本次提交
    Q->>API: createTip(title omitted, content, tags, bindings=[] or more)
    API->>S: CreateTipCommand
    S->>DB: 原子写入 title=NULL 的 Tip、tags、tip_tags 与 bindings
    alt 保存成功
        DB-->>S: persisted Tip
        S-->>API: Tip
        API-->>Q: success
        Q->>API: hideCurrentWindow(quick-note)
        Q-->>U: 成功反馈后隐藏
    else 保存失败
        DB-->>S: error
        S-->>API: error
        API-->>Q: rejected promise
        Q-->>U: 完整显示错误并保留正文、标签与绑定草稿
    end

    opt 用户请求关闭
        alt 系统标题栏关闭
            U->>W: CloseRequested
            W-->>Q: quick-note close-requested event
        else Esc 或界面关闭按钮
            U->>Q: requestClose
        end
        alt 保存进行中
            Q-->>U: 保持窗口，等待保存结果
        else 空草稿
            Q->>API: hideCurrentWindow(quick-note)
        else 有未保存草稿
            Q-->>U: 显示放弃确认
            alt 继续编辑
                U->>Q: cancel discard
                Q-->>U: 保留草稿并聚焦正文
            else 确认放弃
                U->>Q: confirm discard
                Q->>API: hideCurrentWindow(quick-note)
            end
        end
    end
```

## State lifecycle

```mermaid
stateDiagram-v2
    [*] --> ABSENT
    ABSENT --> ACTIVE: T1 save_valid / atomically create titleless Tip, tags and zero or more bindings
```

## Safeguards

- `G1`：只有正文为空时禁止创建；没有 Agent 不再阻止保存。
- `G2`：保存进行期间使用同步互斥标记抑制重复点击和连续快捷键提交。
- `G3`：创建异常不清空草稿、不隐藏窗口；错误全文可滚动查看和选择复制。
- `G4`：默认与最小窗口尺寸下，正文、Agent 列表、错误和放弃确认都不溢出或互相遮挡。
- `G5`：Esc、界面关闭和系统标题栏关闭统一经过同一草稿检查；非空草稿没有明确确认就不能被清空或隐藏。
- `G6`：标签去除多余空白与前导 `#`，按大小写不敏感去重；超出数量或长度边界时拒绝创建且不产生持久化副作用。
- `G7`：Tip、首次出现的标签、Tip-Tag 关联和 Agent 绑定在同一 SQLite 事务提交，任一步失败都不留下部分记录。
- `G8`：历史标签建议是增强能力；读取失败时仍保留自由输入，不让辅助查询阻断快速记录。

## Failure, recovery, and observability

创建调用不自动重试，避免一次用户动作产生重复便签。失败由窗口内 `alert` 完整呈现，并保留可编辑的正文、标签和绑定草稿，用户确认后手动重试。历史标签建议读取失败静默降级为自由输入；重复提交被本地互斥标记直接忽略。系统标题栏关闭事件若成功送达前端，由同一关闭协调器处理；监听失败时不静默隐藏快速便签，避免丢稿优先于关闭便利。当前链路没有额外日志、指标或告警；持久化错误沿既有 Desktop API 错误通道返回。

## Implementation notes

快速便签不提交显式标题，后端与 Mock adapter 都保持标题为空，不再从正文派生标题。新标签由用户自由输入；已持久化标签只作为后续输入建议并可点击复用。零标签或零 Agent 的便签仍是合法 Active Tip，之后可在详细编辑器中调整标签与绑定。机器可读的代码与测试映射维护在 `traceability.yaml`。
