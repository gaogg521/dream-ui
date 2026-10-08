# 2026-10-08：提问弹窗 + 聊天记录导出 + 「先干活、少打断」

跨三仓的一轮改动，来自三条用户反馈：

1. AI 让用户做选择时，只会在正文里写「A. … B. … C. …」然后停下来等用户打字（截图：「问题 1/4：目标用户是谁？」）。希望改成**弹出框选择**。
2. 聊天记录要能导出：**当前会话 → 导出 MD**；**侧边栏历史会话 → 打包成压缩包**。
3. AI 太爱停下来问「下一步要不要……」，用户要的是结果。

## 1. 提问弹窗

### 根因

不是前端的问题。前端早就有问题卡片（`MessageQuestion`，`ask` 帧，claude 的 AskUserQuestion 用了一年了），
但**默认的 dream 引擎根本没有「向用户提问」的工具**——模型想问只能把选项写进正文，然后结束这一轮。
截图里就是这个。

### 改动

| 仓库         | 改动                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dream-engine | 新增 `AskUserQuestion` 工具（`dream-engine-agent/src/ask_user_tool.rs`）；协议新增 `ask_user` 事件 / `ask_user_answer` 命令 / `AskUserManager`（`dream-engine-protocol/src/ask.rs`）；`Tool::requires_approval()`（默认 true，提问工具返回 false——提问本身就是和用户交互，再弹一次审批等于问两遍）；JSON stream 模式注册该工具并路由回答。终端 REPL **不注册**（没法渲染）。 |
| dream-core   | `BackendProtocolSink` 把 `ask_user` 转成 `Ask` 帧（和 claude 共用同一个前端卡片），同时登记一条带 `questions[]` 的待确认项供刷新后恢复；`DreamEngineAgentManager::answer_ask` 把回答送回引擎；`AgentInstance::answer_ask` 不再对 DreamEngine 报「不支持」。                                                                                                                  |
| dream-ui     | `Messages/question/QuestionDialog.tsx`：挂在 `SendBox` 里，浮在输入框上方，一次一题（「问题 1/4」）、单选自动跳下一题、「其它」可自由输入、可「稍后回答」收成小胶囊、✕ = 明确拒绝。`MessageQuestion` 改为消息流里的只读记录（待回答 → 「去回答」按钮；已回答 → 显示所选）。两者读同一个 `askSettlementStore`，不会一边显示已答一边显示待答。                                 |

### 关键语义（改之前先读）

- **一次提交全部答案**：后端（claude 和 dream 都是）对没回答的问题不会重问。弹窗最后一题的「提交」在还有未答题时会先跳回第一道未答题。
- **拒绝 ≠ 空回答**：✕ 发 `decline: true`，引擎告诉模型「用户不想答，别再问，按默认继续并说明假设」。
- **停止生成后回答 = 4xx**：引擎那边的等待者随这一轮被丢弃（`PendingGuard` 在 drop 时清掉登记），dream-core 回 400，前端据此把卡片标成「已失效」并收起弹窗。**5xx / 超时则保留弹窗**让用户重试——这条区分在 `submitAsk.ts`。
- **不受「全自动」模式影响**：模式只决定工具要不要审批；提问工具不走审批，也没有任何模式会自动替用户答题。
- 弹窗不是居中 Modal 而是贴在输入框上方：用户经常要往上翻看 AI 刚才说了什么再回答，居中遮罩会挡住。

## 2. 聊天记录导出

之前其实有现成代码，但入口在「kanban #14」时被整体隐藏（行菜单、批量导出、`/export` 都没注册），
而且导出内容是「JSON + Markdown + **整个工作区文件**」——工作区可能是带 node_modules 的项目目录，
这多半就是当初隐藏它的原因。

- **当前会话**：标题栏右侧新增下载图标（`ConversationExportButton.tsx`）。桌面端弹系统「另存为」（默认落在会话工作区，没有则桌面），保存后可「在文件夹中显示」；WebUI 走浏览器下载（WebUI 下的保存对话框指向的是服务器的磁盘，用户看不到）。
- **侧边栏**：行菜单「导出」恢复；批量管理栏新增「导出所选」「导出全部」。都打成 ZIP，**每个会话一个 `.md`**（`名称__id前8位.md`，同名会话不会互相覆盖），不再带 JSON 和工作区文件。「导出全部」按 4 个一组拉历史，避免几百个会话同时打后端。
- Markdown 格式统一由 `buildConversationMarkdownTranscript`（`utils/chat/conversationExport.ts`）生成：只保留用户/AI 正文（工具调用、思考、提示条都是过程噪音），同一说话人被工具调用切开的几段合并到一个标题下；AI 正文本来就是 Markdown，**原样写入不加代码块**（旧实现把每条都包进 ```text，导出来没法读）。团队成员消息用成员名做标题。
- `/export` 斜杠命令仍保持隐藏（它导出的是 .txt，和这次的 MD 是两套格式，没必要再多一个入口）。

## 3. 「先干活、少打断」

dream-engine 系统提示新增 `# Doing tasks` 一节（`context.rs` 的 `WORKING_STYLE_GUIDANCE`），放在工具说明之后、**助手预设（custom prompt）之前**——真正需要「访谈式」流程的预设仍可以覆盖它：

- 从请求、上下文、工作区推断意图，在这一轮把结果做完；
- 细节没说就按常规默认值做，最后简短说明假设，而不是先问；
- 只有「答案实质改变结果 + 推断不出 + 猜错代价大」才问，而且**一次问完、走 AskUserQuestion**，禁止在正文里列 A/B/C 等用户打字；
- 不要中途停下来汇报进度问要不要继续，不要在结尾列「下一步建议」菜单；
- 用户明确要求先确认/先看方案时，以用户为准。

`AskUserQuestion` 的工具描述里重复了这套约束（模型选工具时看的是描述）。

## 4. 验证

- dream-engine：`cargo nextest -p dream-engine-{protocol,agent,cli,tools}` 956/956；新增测试覆盖回答/拒绝/部分回答/停止后撤回/宿主发不出去/非法输入。
- dream-core：`dream-core-ai-agent` + `dream-core-conversation` 1718/1718；新增 sink 转帧 + 恢复登记、manager 回答送达 / 撤回后 400。
- dream-ui：`vitest --changed` 31 文件 237 例全过；新增 `QuestionDialog` / `MessageQuestion` / Markdown 导出测试。
- 真机：见 §5。

## 5. 生效方式

- 前端：dev 热更新即可。
- **后端（提问弹窗依赖它）**：必须用新的 dreamcore。dev 下 `cargo build -p dream-core-app --release` 后
  `DREAM_BACKEND_LOCAL_PATH=..\dream-core\target\release\dreamcore.exe node scripts/prepareDreamcore.js`；
  打包版要等 dreamcore 出新版本并在 dream-ui 里 bump pin。旧 dreamcore + 新前端：导出功能正常，模型拿不到提问工具（行为同以前）。
