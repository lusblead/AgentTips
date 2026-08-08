# Phase 5 人工 Reminder Smoke 报告

- 日期：2026-08-08
- 状态：**PENDING USER MANUAL SMOKE**
  - 工程实现与自动化运行时测试已完成；以下逐项结果未经用户实机确认，不得视为 PASS。

## 待人工验证场景

| 场景                                                                  | 预期                              | 状态    |
| --------------------------------------------------------------------- | --------------------------------- | ------- |
| A. 创建 Tip "Cursor Test" 绑定 Cursor + Default Carry=ON，进入 Cursor | Reminder 出现                     | PENDING |
| B. Cursor 保持输入焦点，Reminder 出现时继续键盘输入正常               | 不抢焦点                          | PENDING |
| C. Reminder 内容正确显示 Cursor Test                                  | 内容正确                          | PENDING |
| D. Dismiss 后离开 Cursor → Chrome → 立即回 Cursor                     | 15 分钟冷却内不再提醒             | PENDING |
| E. Settings 临时改 cooldown=1 分钟，等待超过 1 分钟后离开再进入       | 再次提醒；测试后恢复 15 分钟      | PENDING |
| F. Cursor Tip + ChatGPT Tip 均 Default Carry=ON                       | 先 Cursor 后 ChatGPT 各自独立提醒 | PENDING |
| G. Default Carry OFF                                                  | 下一次合法 entry 不得提醒对应 Tip | PENDING |
| H. Mark Used / Restore                                                | Used 不提醒；Restore 后可提醒     | PENDING |
| I. Cursor → Reminder → 点击 Reminder → Cursor                         | 不产生重复 Reminder               | PENDING |
| J. 第二显示器进入 Cursor/ChatGPT（可选）                              | Reminder 出现在同一 monitor       | PENDING |

## 人工验证约束

- 冷却人工验证不要求等 15 分钟：允许通过 Settings 临时改为 1 分钟，测试后恢复 15。
- 不得为 smoke 直接修改正式 SQLite，只能通过正式 Settings UI。
- Reminder 人工重点：不抢焦点、不永久置顶、不挡住所有应用、位置合理、
  内容可读、Copy 正常、Dismiss 正常、不自动发送、同 Agent 不重复 spam。

## 自动化已覆盖（运行时测试）

`pnpm test:reminder-runtime`（独立测试数据库）：
Matched+Entered 显示含 Tip A 不含 Tip B、不抢焦点（foreground 保持）、SelfWindow 无重复、
Dismiss 隐藏、cooldown active 不重复、cooldown 过期重新显示、per-agent 独立 +
Changed payload 替换、No eligible 不消耗 cooldown、Used 排除 / Restore 恢复。
