# 2026-09-18：上下文压缩提示 + 团队额度暂停提示 + 等待确认图标（#4198）

> **新会话/新 AI 首读**：本文档只记录 dream-ui 这一侧。后端（1M 窗口、溢出自愈、团队调度
> 三个 bug、服务商额度拒绝停全队）见 dream-core
> `docs/guides/session-2026-09-18-team-provider-spend-block.zh-CN.md`。

## 一句话总结

四件用户直接反馈的事：上下文快满了没人提醒 → 加指示器与压缩提示；团队窗口不能拖动；
发送框图标挤在一起；以及最重的一条——**服务商额度耗尽时团队不停，主对话堆了 87 条无效
排队**，前端把它显示成"正在处理中"，恰恰是当时**唯一没在发生**的事。

## 一、上下文用量指示与压缩提示

| 文件                                         | 改动                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/agent/ContextUsageIndicator.tsx` | `COMPACT_REMINDER_PCT = 80` / `DANGER_PCT = 90`；行内徽标 `{pct}% · 建议压缩` + 悬浮说明，**只在 `hasWindow` 时显示**（没有声明窗口就不猜）                                                                                           |
| i18n（13 语）                                | `conversation.contextUsage.compactReminder` / `compactBadge`；`conversation.agentTip.codes.` 下 `AUTOCOMPACT_DONE` / `CONTEXT_WINDOW_LEARNED` / `AUTOCOMPACT_FAILED` / `MESSAGE_LARGER_THAN_WINDOW`；重写 `settings.contextWindowTip` |

**引擎发给用户的文案要走 code，不要直接发英文串。** 链路
`OutputSink::emit_info_coded(code, params, fallback)` → dream-core `BackendOutputSink` 填
`TipsEventData.code/params` → 这里按 `conversation.agentTip.codes.<CODE>.body` 渲染，
`content` 只是没词条时的兜底。这条链路本来就在（`ACP_EMPTY_TURN` 等一堆 code 在用）。

**模型上下文 ≠ 编辑器长度限制**，两者在设置页里容易被混为一谈，`settings.contextWindowTip`
就是为此重写的。

## 二、团队窗口可拖动

`components/base/DreamModal.tsx` 加 `draggable` prop + `useModalDrag` hook：pointer events、
`setPointerCapture` 包 try/catch、监听挂在 window 上（指针移出弹窗也不丢）、
`DRAG_VISIBLE_MARGIN = 80` 保证不会被拖出屏幕、**重开时位置重置**。
`TeamCreateModal` 用 `draggable={!isMobile}`。

## 三、发送框图标挤压

用户报了两次"图标看起来没变化"，两轮改动都没生效。

**根因：`sendbox.css` 里同一段规则写了两遍**，后一份覆盖前一份，我改的是**死代码**。
CDP 实测才看出来——SVG 属性是 16，渲染出来是 20。

处理：删掉重复块；幸存那份把图标 20px→16px、disabled 态背景从 `var(--color-fill-3)` 改成
`transparent`；`.sendbox-left-tool-group` 从 `flex: 0 0 auto` / `max-width: max-content`
改成 `flex: 0 1 auto` / `min-width: 0` / `max-width: 100%`，让它能收缩而不是把右侧挤掉；
`.sendbox-actions .arco-btn-shape-circle { flex-shrink: 0 }`。

> **教训**：改 CSS 没效果时，先确认自己改的那条规则是不是被同文件后面的重复块覆盖了。
> 这个文件可能还有其他重复块，本次没有全量清理。

## 四、分清"在等你"和"在忙"（移植上游 #4198）

上游 `iOfficeAI/AionUi` 提交 `7d1c7b7`。侧边栏里等待用户授权的会话和正在跑的会话长得
一模一样，都是转圈。

| 文件                                                   | 改动                                                                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GroupedHistory/hooks/useConversationListSync.ts`      | 等待态是**每会话的待确认 id 集合**而不是布尔值，所以两个并发请求能一个一个清掉。id 从触发帧取：`ask` 用 `request_id`、`permission` 用 `call_id`、`acp_permission` 用 `tool_call.tool_call_id` |
| `GroupedHistory/ConversationRow.tsx`                   | `Attention` 图标（`text-warning animate-wiggle`），**优先于 `<Spin>`**                                                                                                                        |
| `hooks/system/notification/browserNotificationCore.ts` | `CONFIRMATION_TYPES` 加 `'ask'`；按 `conversation_id:msg_id` 去重，重连重放不会重复弹                                                                                                         |

两个要点：**等待优先于转圈**——暂停的轮次仍在推流、仍被标记为 generating，不加优先级新
图标永远抢不到。**重载靠 `runtime.pending_confirmations` 补**，它只报数量不报 id，所以用
哨兵 id 标记；reconcile 只负责标记、从不清除，避免过期的 idle 快照和实时帧打架。

**我们比上游多一个 `SessionCenter` 页面**，它渲染同一个行组件，上游补丁里没有——移植时得
一并接上，否则 tsc 直接红。另外新监听 `confirmation.remove` 挂上去会炸三个既有测试的
`ipcBridge` mock（手写白名单），加新监听必然要同步。

## 五、团队额度暂停提示（本次重点）

后端在服务商因额度拒绝时会暂停整个团队，前端要把它说清楚。

| 文件                                       | 改动                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `common/types/team/teamTypes.ts`           | `TeamSlotBlockedReason` 加 `'provider_spend_blocked'`；`ITeamSlotWork` 加 `provider_blocked_slot_id` |
| `pages/team/components/teamSendRuntime.ts` | `blocked_reason` 分支加一条，把 `provider_blocked_slot_id` 交给格式化函数                            |
| `pages/team/components/TeamChatView.tsx`   | 从 `useTeamTabs()` 拿 assistants 反查专家名（该组件本来就在调它，不用加 props）                      |
| i18n（13 语）                              | `team.work.providerSpendBlocked`（不点名）+ `team.work.providerSpendBlockedBy`（带 `{{name}}`）      |

### 三个刻意的决定

**发送框不锁。** `provider_spend_blocked` **不进 `FATAL_BLOCK_REASONS`**——发消息正是解除
暂停的唯一手段，锁了就死循环。

**专家名放句首。** 不同专家可以配不同服务商，所以必须点名是谁。而这行状态文字是
`truncate` 的，团队 3~4 个分栏并排时宽度很窄，名字放句尾必被截掉。完整文案靠
`ThoughtDisplay` 已有的 `title={statusText}` 悬浮兜底。

**查不到名字要回落。** 专家被删、快照过期时 `provider_blocked_slot_id` 可能反查不到，
这时用不点名的那条文案，而不是渲染出空引号。

### 文案定稿过程

先写成「您的额度已经被限制了…处理好后发送一条消息即可唤醒团队。」，CDP 实测**被截断**成
「…再次尝试。处理...」。去掉第二句——用户原话里的"再次尝试"本身就是解除动作的说明。
后来用户指出不同专家配不同渠道，才改成点名版。

## 六、验证

- 全量 `bunx vitest run`：**588 文件 / 5544 测试通过**（基线 5541 + 本次新增 3）。
  **判据是计数不是退出码**——vitest 会静默跳过文件仍然 exit 0。
- `bunx tsc --noEmit` 干净；`bun run i18n:types` + `node scripts/check-i18n.js` 通过。
- 真机 CDP（dev + 本地假 429 服务）：状态行显示
  「「Probe Lead」的额度已被限制，请联系该专家所用的服务商检查额度后再次尝试。」，
  `spinners: 0`（卡死的转圈消失），发送框仍可用，再发一条消息团队恢复。
- **pre-push 钩子拦过一次**（oxfmt 漂移）。选择 `bun run format` 修，不是 `--no-verify`。

## 七、还没做

- `sendbox.css` 可能还有其他重复规则块，本次只删了造成本问题的那一处。
- 团队里成员因**非额度**原因反复失败时，队长信箱仍会收到重复的"已暂停"通知，前端没做合并。
