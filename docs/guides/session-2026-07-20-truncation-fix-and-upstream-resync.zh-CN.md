# 输出截断续写修复 + 三仓上游二次同步（07-20 批次）

> **2026-07-20**。给后续 AI / 人类读的本轮完整交接。
> 07-18/19 那轮同步见 [`session-2026-07-19-upstream-sync-changelog.zh-CN.md`](session-2026-07-19-upstream-sync-changelog.zh-CN.md)（基线：aionrs v0.2.5+#230 / Core v0.1.48 / UI 内容≈v2.1.37）。
> 本轮是在那个基线之上，补上游 07-20 当天新落地的提交（三仓合计 20 个），外加一个独立的 aionrs 运行时 bug 修复。

---

## 0. 起因：用户报告输出被截断

用户反馈用 DeepSeek/kimi 等模型生成长代码时，输出在几百行后被硬生生截断，UI 提示「The response was cut off by the token limit and could not be completed automatically」。用户自己定位到两个线索：

1. 能力强的模型遇到超长生成任务会直接说"不能这么输出"，不会真的尝试硬撑——所以这个 bug 主要打在中等能力模型身上。
2. 怀疑是 `max_tokens` 配置问题：测试的 DeepSeek V4 实际支持 384K 输出，但当时代码路径可能在用老掉的 4096/8192 默认值。

诊断过程澄清了机制，比用户最初的猜测更精确：

- **根因不是硬编码 4096/8192**（那张表只挂在 `anthropic_defaults()`/`bedrock_defaults()`，DeepSeek 走的是 `openai_defaults()`，压根碰不到）。真正的机制是：aionrs 的 `openai_defaults()` 从不设置 `default_max_tokens`，所以当 UI 没有为该模型显式配置输出上限时，`max_tokens` 字段被**整个省略**，由上游网关自己的默认值兜底（往往远低于模型真实能力）。
- 撞上限后，aionrs 引擎（`aion-agent`）之前的逻辑是**只补救一轮**：截断后追加一次"请把话说完，不要再调工具"的控制提示，这一轮如果还是不够长（对真正的长内容几乎必然不够），直接判定失败，吐出兜底报错，白白扔掉已经生成的内容。

---

## 1. aionrs 独立修复：截断改为有界续写

仓库：`aionrs-local`，`master` 分支，commit `9fa951e`（+ `66f4db0` 修 rustfmt 违规，纯格式）。

### 改动点

1. **`turn.rs`**：截断判定提到工具调用判断之前。原逻辑先看 `tool_calls` 是否非空——如果模型正在流式吐一个工具调用的参数时撞上限，之前会被误判成正常的工具轮，把截了一半的 JSON 交给畸形调用消毒器，截断信号彻底丢失。现在 `stop_reason == MaxTokens` 优先判定。
2. **`engine.rs`** 新增 `continue_truncated()`：把"单发补救失败即放弃"改成最多 **12 轮**有界续写，每轮把恢复到的文本拼接起来；半截的工具调用不写入历史（否则留下没有 `tool_result` 的孤儿 `tool_use`，会被下游 provider 拒绝）。抽出 `finalize_fallback()` 给两条兜底路径复用。
3. 兜底提示词从"立刻收尾"（`Finish the answer now`）改成"从中断处继续，不要重复"，因为原措辞会让模型在还剩大量内容时压缩收场。
4. 兜底报错文案从纯粹的"被截断了"改成指向具体设置项——因为"没配置输出上限"这件事本身是完全静默的（字段被省略、上游网关默认值接管），用户除了报错内容外拿不到任何线索。

### 刻意保留的两条既有契约

改动过程中撞到两条既有单测锁死的行为，判断为有意设计，没有推翻：

- **续写轮不计入 turn 预算**：turn 预算是防工具调用死循环的熔断器，长回答不是循环也不是失败。
- **续写轮不带工具**：带了工具也只会重试同一个超长写入再次撞上限；截断恰好发生在工具调用中途时，续写仍然补不回来，正解是让 agent 分批写文件，属于另一个更大的改动，本轮未做。

### 验证

新增 `crates/aion-agent/tests/truncation_e2e.rs`——用真实 HTTP + 真实 SSE 解析 + 真实 OpenAI provider 栈（不是 mock），配合 wiremock 模拟一个小输出上限的网关，跑通 3000 行 Python 代码生成。做过**反向对照**：把续写预算临时调到 1（等价修复前的单发补救），测试立刻复现用户截图里的故障（停在 500 行 + 同一条报错），确认测试确实锁住了这个 bug，而非碰巧通过。

全 workspace 测试（`cargo test --workspace`）跑通，7 个 fork 专属补丁（含本次新增这个）全部存活。

---

## 2. 三仓上游二次同步（07-20 批次）

07-18/19 那轮同步完之后，上游三个仓库当天又各自落了一批新提交（本轮同步时间点：三仓 upstream 均已 fetch 到 07-20 当天最新）。**同步原则本轮起改为**：默认信上游（他们更专业，可能带更多 bug 修复），冲突时只守两条红线——**图标/视觉资源** 和 **关键描述文字里的 "1One Work"/"1ONE" 品牌替换**，除此之外的功能性分歧一律向上游看齐，不为保留 fork 自建的平行实现而硬扛。

### 版本对照

| 仓             | 同步前                 | 上游新增                            | 结果                                                    |
| -------------- | ---------------------- | ----------------------------------- | ------------------------------------------------------- |
| `aionrs-local` | v0.2.5 + #230 + 6 补丁 | v0.2.6（openai responses api 支持） | `master` @ `b2b7bde`（v0.2.6 + 7 补丁，含本轮截断修复） |
| `1oneCore`     | v0.1.48                | 9 个提交                            | `one-main` @ `faebcbe5`                                 |
| `1oneUI`       | 内容≈v2.1.37           | 5 个提交                            | `one-main` @ `55757cee7`                                |

### 2.1 aionrs → v0.2.6

干净合并，无冲突。新增 OpenAI Responses API 支持（`gpt-5.6` 系列走 `/responses` 而非 `/chat/completions`）。

### 2.2 1oneCore（9 个上游提交）

新增：#641 修 max_tokens 泄漏、#642 keep-awake 客户端偏好、#640 team idle-cleanup 会话 Stopped 广播、#638 会话重命名命令、#637 ACP Registry 目录同步、gpt-5.6 走 responses api、aionrs 依赖升到 v0.2.6。

**3 处真实冲突**，处理方式：

1. **`Cargo.toml`**：上游把 `aion-*` 依赖改成钉官方 `iOfficeAI/aionrs` 的 tag——**保 fork 铁律**，改回 `gaogg521/aionrs` `master`，因为 6 个 fork 专属补丁（文本化工具历史、deferred schema 提升等）只有 fork 分支才有，绝不能切官方裸 tag。
2. **`factory/aionrs.rs` 的 `max_tokens` 字段**：这是本轮唯一一处真正需要拍板的功能冲突。上游 **#641 "ignore max token limits for aionui requests"** 把 `max_tokens` 全链路强制清 `None`，理由是"防止独立部署的 aionrs 配置文件把值泄漏进内嵌运行时"。fork 这边曾经（07-12）加过一个"按模型配置最大输出 Token 数"的 UI 功能（`providers.model_max_tokens` 列 + 设置页输入框），一度想保留这个分支行为——**后来按用户明确指示"跟上游的 BUG 修复方案走"，完全撤销了这个分支**，`max_tokens` 现在和上游一样全链路恒为 `None`。副作用：**那个"最大输出"输入框现在是死 UI**——填了会存进数据库，但运行时不再读取，见下方「已知遗留」。
3. **迁移号撞车**：上游新增 `025_sync_and_add_acp_registry_agents.sql`，撞上 fork 07-14 已占用的 `025_add_user_data_secret.sql`，按既有惯例重排为 `030`。

**顺带发现并修复的既有测试欠账**（`cargo test --workspace` 全量跑通才暴露，均与本次合并内容无关，但用同一次机会一起清了）：

- `aionui-db` 里两个品牌断言过期：`"Aion CLI"`/`aion.svg` 改成 `"1ONE CLI"`/`1one.png`（fork 迁移 019/021 早在 07-11 就把数据改了，测试断言从那时起就没跟上，红了 9 天没人发现）。
- `assistant_definition_field_removal_migration.rs` 还在跑迁移号 24，实际内容 07-19 已重排到 029。
- `cron_assistant_first_migration.rs` 里两个测试引用的是**更早一次未文档化的编号占用**：fork 早期把 `019`/`020` 让给了改名/内置 Cursor Agent CLI 命令，上游原本"清理遗留 client_preferences"和"清 codex ACP 桥接"两个迁移的真实内容被并入了 fork 的 `022`/`023`，测试从未跟着改——说明这个仓子有相当一段时间没人真正跑过 `cargo test --workspace`。

（注：`020_fix_cursor_agent_cli_command.sql` 里的 "cursor" 指的是内置代理列表里的 **Cursor Agent CLI**（和 Codex、Claude Code 并列的可选后端），不是编辑器工具，别搞混。）

**另发现 1 个既有 Windows 平台 bug，本轮不修**：`aionui-conversation::create_rejects_unavailable_workspace_with_trailing_whitespace_in_request` 失败，是 CLAUDE.md 早已记录的 `aionui-common` workspace 路径尾随空格校验在 Win32 API 下失效问题（07-18 上游同步带入），今日改动未触及相关 crate，非本次回归。

### 2.3 1oneUI（5 个上游提交）

新增：#3616 助手/代理搜索、#3617 移动端隐藏搜索入口、#3618 team idle-cleanup 会话标记可恢复、#3619 installer 架构校验提前、#3620 keep-awake 阻断器职责移交后端。

**7 处冲突**，逐一按内容合并（不是简单二选一）：

1. **`systemSettingsBridge.ts`**：
   - 一半冲突是 keep-awake：上游把阻断器逻辑整个移到后端（对应 1oneCore 新模块 `keep_awake.rs`），删掉了前端的本地恢复逻辑——照上游删。
   - 另一半冲突里，上游同一处引入了"桌面宠物"设置的 IPC provider（`getPetEnabled`/`setPetEnabled`/…）。**这里第一次合并时我直接采纳了上游这半边，结果 `tsc` 报错**——因为桌面宠物整个子系统在 **07-07 已按用户明确要求删除**（fork 提交 `33f8aae28 feat: 移除桌面宠物功能(整个子系统)`，删了 `process/pet`、`renderer/pet`、8 个 IPC 通道、设置 tab、tray 菜单等）。上游自己还留着这个功能，我们不要。修正：把这半边也删掉，恢复到"无宠物"状态，`ProcessConfig` 未使用的 import 一并清理。
2. **`LocalAgents.tsx`**：两边各自给同一行 import 加了不同的 React hook（fork 加了 `useEffect`/`useRef`，上游加了 `useMemo`），取并集。
3. **`AssistantHomeTabs.tsx`**（最复杂的一处，6 段冲突）：fork 自建的"扫描全部代理"按钮和上游新增的搜索框/`SettingsPageHeader` 改版不是互斥的，两个都留。关键细节：搜索过滤要建立在 fork 已经做过的 `visibleAssistants`（只显示已安装且在线的 CLI 助手）之上，而不是上游原本写的从裸 `assistants` 过滤——否则搜索会把本该隐藏的助手翻出来。
4. **`i18n-keys.d.ts` + `en-US`/`zh-CN`/`zh-TW` 的 `cron.json`**：品牌文案冲突（`"AionUi"` vs 我们的 `"1One Work"`）按红线保 fork 品牌；上游新增的搜索相关 key（`searchPlaceholder`/`noSearchResults`）一并合入。

**验证过程中意外揪出两类真实 bug**（都不是本次合并引入，是全量跑 `bun run test` 第一次真正跑到才暴露）：

**Bug① 品牌替换脚本误伤内部错误码标识符**——某次早前的品牌重写（commit `cf49252cc`）把 "AIONUI" 全局替换成 "1One Work" 时，连 **JSON 对象的 key 本身**也一起替换了，而这些 key 不是可翻译文本，是要和源码里的字面量精确匹配的错误码常量：

- `agentError.codes` 下 5 个 key（`AIONUI_CONVERSATION_BUSY`、`AIONUI_INTERNAL_ERROR`、`AIONUI_PERMISSION_ERROR`、`AIONUI_STATE_INCONSISTENT`、`AIONUI_STREAM_BROKEN`）被改成了 `"1One Work_CONVERSATION_BUSY"` 等。
- `agentError.ownership` 下的 `aionui` key 同样被改成 `"1One Work"`。

源码（`buildSendFailureError.ts`、`hooks.ts`、`AgentErrorOwnership` 联合类型）用字面量精确匹配这些 code，key 一旦被本地化就永远查不到对应文案——**用户侧实际表现是：对话繁忙、内部错误、权限错误、状态不一致、流中断这 5 种真实错误状态，在全部 13 个语言下都显示不出正确提示文案**（要么空白要么直接显示原始 key）。已在全部 13 个 locale 文件里恢复正确 key，**只改 key，已经翻译好的显示文本原样不动**（例如 `zh-CN` 下 `aionui` 的值仍然是"应用"，没有被误伤，被误伤的只是外层 key 名）。

**Bug② 自动更新 CDN 测试断言过期**——自动更新从上游默认域名 `static.aionui.com` 改指向自建腾讯 COS 桶是 07-16 已经落地的既定架构决策（含下载来源白名单收紧，`static.aionui.com` 已经不在白名单里），但三个测试文件（`updateBridgeCdnRewrite.test.ts`、`updateBridgeDownloadDedupe.test.ts`、`autoUpdaterService.test.ts`）里的断言从那次改动起就没跟着更新，一直断言旧域名。已同步更新为断言当前实际的 COS 域名。

**其余测试失败逐一排查确认与本次合并无关，顺手补上**：

- `SettingsSider.dom.test.tsx` 缺 `IdCard` 图标 mock——今天早些时候「企业组织 vs 项目组解耦」（`b3a85002`，见 [`session-2026-07-20-enterprise-org-decouple.zh-CN.md`](session-2026-07-20-enterprise-org-decouple.zh-CN.md)）新增的图标，mock 没跟上。
- `EnterpriseDeploymentModeCard.dom.test.tsx` 断言的文案还是"已加入企业"，源码已经是"已加入项目组"——同一次改动的措辞变化没同步到测试。
- `ToolsModalContentImageGuide.dom.test.tsx`：缺 `MemoryRouter` 包装导致 `useNavigate()` 抛错（生产环境这个组件必然嵌在 app 级 Router 里，纯测试环境缺失）；另有一处断言仍期待渲染成 `<a>` 标签，源码早已改成语义更准确的 `<button>`（程序化导航而非真实 href 跳转）。

**今天合并真正带来的新逻辑补了完整测试**：`useTeamRunView.ts` 新增 `sessionStopped` 状态字段（对应上游 #3618，监听后端 `sessionStatusChanged` 广播，idle-cleanup 回收会话时标记为"已停止但可恢复"），原本连编译都过不了（mock 里没这个 channel），补了 mock + 3 个新用例（标记停止/恢复、跨 team 隔离、新 run 事件自愈清除标记）。

**已知不修，本次不展开**（记录，留给下一轮或产品侧确认意图）：

- `SortableConversationRow.dom.test.tsx` 两个用例断言的 `data-testid="conversation-drag-handle-*"` 在当前组件树任何位置都不存在——`SortableConversationRow.tsx` 现在是整行绑定 dnd-kit 的 `listeners`（`{...attributes} {...listeners}` 直接 spread 在最外层 div 上），从未有过独立的拖拽手柄子元素。与本次合并无关，需要先确认当前 UX 是否就是"整行可拖拽"（而不是恢复一个单独的拖拽手柄），才能决定怎么改，先只记录不动。
- `ToolsModalContentImageGuide.dom.test.tsx` 里"无 provider 时渲染纯文本"那条用例查询 `<a>` 标签断言数量为 0——但两种状态下这个元素从来都是 `<button>`，从未是 `<a>`，所以这条断言现在**恒为真但没测到任何东西**（假阳性）。更麻烦的是这条用例的标题（"无 tab navigator 时不可点击"）和源码自己的注释（"fallback 存在就是为了让 go-configure 链接永远不会变成死文字"）**语义直接矛盾**——源码明确说无论有没有 provider 都要保证可点击，测试标题却说要变成不可点击纯文本。这是个产品意图层面的分歧，不是我能单方面猜测修的，先记录。

---

## 3. 验证方式

- **aionrs**：`cargo fmt --check` + `cargo clippy --workspace --all-targets`（0 error）+ `cargo test --workspace`（既有两个 `aion-skills` flaky 用例单独重跑 540/0 全过，与本次改动无关）。
- **1oneCore**：`cargo build` + `cargo clippy --workspace --all-targets`（0 error）+ `cargo test --workspace`（唯一失败是上面提到的既有 Windows workspace-path bug）。
- **1oneUI**：`bun run lint:fix`（0 error，833 个既有 warning 不算失败标准）+ `bun run format` + `bun run i18n:types` + `node scripts/check-i18n.js` + `bunx tsc --noEmit`（0 错误）+ `bun run test`（310/312 测试文件通过，2330/2338 用例通过，唯二失败即上面记录的 `SortableConversationRow` 两条已知项）。

## 4. 三仓最终 commit

| 仓             | 分支       | commit      | 已推送 |
| -------------- | ---------- | ----------- | ------ |
| `aionrs-local` | `master`   | `b2b7bde`   | ✅     |
| `1oneCore`     | `one-main` | `faebcbe5`  | ✅     |
| `1oneUI`       | `one-main` | `55757cee7` | ✅     |

## 5. 已知遗留 / 下一轮接手注意

1. **"按模型配置最大输出 Token 数" UI 输入框现在是死功能**（见 §2.2 第 2 点）。设置页里 `ModelModalContent.tsx` 的"最大输出"输入框仍然存在、仍然能填、仍然会存进 `providers.model_max_tokens` 列，但 aionrs 运行时已经不再读取这个值（永远 `None`，交给各 provider 预设默认值处理）。这是本轮为了完全对齐上游 #641 的修复方案而产生的副作用，**没有删掉这个输入框/字段/迁移**，只是让它失效——下一轮要么彻底删掉这套死 UI（输入框 + `AionrsResolvedConfig.max_tokens` 字段 + migration 024），要么重新设计一套不与"防配置泄漏"冲突的实现。
2. `SortableConversationRow` 的拖拽手柄测试 UX 意图待确认（见 §2.3 已知不修第一条）。
3. `ToolsModalContentImageGuide` 的"无 provider 纯文本"用例语义矛盾待产品侧拍板（见 §2.3 已知不修第二条）。
4. 品牌替换脚本误伤内部标识符这个 bug 类型（§2.3 Bug①）值得写进以后跑品牌重写脚本前的检查清单——**只替换用户可见文案，不要碰任何看起来像常量/错误码/枚举值的 SCREAMING_SNAKE_CASE 或纯英文单值 key**。目前只在 `conversation.json` 的这两处发现，但没有做过全仓库范围的系统性扫描，不能排除其他 locale 文件里还有类似遗漏。
