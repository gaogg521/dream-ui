# 2026-10-10 回复中途插话 + 草稿箱改为输入框上方的排队行

> 用户诉求：前一个任务还没结束时也能插入新消息，给正在跑的会话补充信息——「现在所有的
> AGENT 几乎都能做这个事情」。之前 1ONE CLI 会话在回复中点发送，直接弹
> 「当前 Agent 正在处理，暂时不能直接发送。可以先存到草稿箱，稍后发送。」
>
> 做到一半用户又补充：「草稿箱放这里也不合适了，没啥意义，完全可以设计成像 zcode 这种形式的，
> 用户在发送前都能随便编辑」——于是草稿箱改成了输入框上方的排队行（§3）。
>
> 三仓提交：dream-engine `68559492` `c51f1e2` `302d9f1`；dream-core `ae7fc99` `a91ff2f` `46a3c48`；
> dream-ui `cd90c95` `1a3e485` + 本次排队行改版。
> **打包版要等 dreamcore 发版 + bump `dreamcoreVersion` 才生效**；在旧 dreamcore 上前端行为完全不变
> （后端对 dream 会话报 `supports_midturn_delivery=false`，前端照旧拦截）。

## 1. 为什么以前做不到

中途投递这套链路（B5）**早就有**，Claude / Codex 会话一直能用：

- dream-core 会话层：`ConversationService::send_message` 里，有活跃 turn 且
  `agent.supports_midturn_delivery()` 为真 → `deliver_midturn_message`（持久化用户消息、
  不新开 turn、回 200 带当前 turn_id）；否则走原来的 claim（忙就 409）。
- 前端：`AcpSendBox` 按 `runtimeView.supportsMidturnDelivery` 决定忙时是否放行发送。

1ONE CLI（`AgentType::DreamEngine`）被排除在外，原因在引擎：dream-core 进程内调用
`engine.run_with_blocks()`，**整个 turn 期间持有 engine 的 Mutex**，消息没有任何入口能塞进去。
所以 `AgentInstance::deliver_midturn` 对 DreamEngine 直接返回「not supported」，前端
`DreamEngineSendBox` 干脆写死「dream backends never support mid-turn delivery」。

## 2. 做法

### dream-engine：`PendingInput` 信箱（`crates/dream-engine-agent/src/pending_input.rs`）

- 一个 `Arc<Mutex<{open, queue}>>` 的可克隆句柄。宿主 `engine.pending_input()` 拿一份克隆，
  **推消息不需要 engine 锁**。
- **只在 run 期间开着**：`run_with_blocks` 进入时 `open()`，返回时关闭。关着的时候 `push` 返回
  `false`——意思是「没有正在跑的 turn，去开新 turn」。
- 引擎在**每次请求模型之前**（循环顶部）把信箱里的消息作为 user 消息并入历史
  （`absorb_pending_input`），所以「工具跑一半时用户插话」下一次请求就带上了。
- 模型正在写最终回答时用户插话：`Final` 分支用 `close_if_empty()` **检查和关闭是同一步原子操作**，
  有消息就 `continue` 再走一轮去回答它。这一步原子化是关键——否则消息可能落在「引擎最后一次看
  信箱」和「宿主宣布 turn 结束」之间，被收下却永远没人回答。
- 其他退出路径（报错、守卫中止、`abort_current_turn` 取消/超时）关闭信箱，残留消息**写进历史**
  而不是丢掉——消息已经显示为已送达，下一轮模型能看到。
- `OutputSink::emit_user_input_injected()`（默认空实现）：消息并入时通知宿主。

### dream-core

- `DreamEngineAgentManager` 声明 `supports_midturn_delivery = true`；`deliver_midturn` 把内容
  （同样经过企业记忆召回前缀、`build_content_blocks`）推进信箱。推不进去（turn 刚结束）返回
  含 `no active turn to steer` 的错误——会话层 `steer_rejection_is_turn_ended` 认这句话，
  自动改为新开 turn，跟 codex 的竞态处理同一条路。**这个短语不能改。**
- `BackendOutputSink::emit_user_input_injected` → 发 `AgentStreamEvent::SegmentBreak`：
  关闭正在流式输出的那个气泡，插话之后的回答另起一个新气泡（显示在用户那条消息下面），
  否则回答会接在用户消息**上方**那段旧回复后面。
- 会话层 `static_supports_midturn_delivery`：原来只认 `extra.backend`，dream 会话没有这个字段，
  agent 还没建起来时（首轮发送响应可能就在这个窗口里算出来）会报 `false`、前端继续拦。
  改为按会话类型 `dream` 直接返回 `true`。

### 引擎补充：插话要带一句说明（dream-engine `302d9f1`）

真机第一轮发现：用户在 ping 跑着的时候插一句「顺便说下今天星期几」，模型只答了「周六」，把原任务
（最大延迟）丢了——插话裸着并入历史，就是「最新一条用户消息」，模型把它当成了整个新任务。
现在并入时在用户原话前加一段 `MID_RUN_INPUT_NOTE`（「用户在你工作时发来下面这条，兼顾它并继续手上的
工作，除非它让你改方向」）。改完同样的场景模型两件事都答了。说明文字刻意保持中性：用户插话也可能是
要改方向，那由他自己的话说了算。

### dream-ui

**草稿箱 → 排队行（照 zcode / Claude Code 的交互）**，ACP（Claude/Codex 等）和 1ONE CLI 两个发送框一致：

| 场景                              | 以前                                         | 现在                                                                              |
| --------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| 回复中按回车                      | 不支持中途投递的拦下弹 toast；支持的直接插话 | **一律排到输入框上方**，可编辑/删除/拖拽排序                                      |
| 输入框占位                        | 「发送消息到 …」                             | 回复中显示「继续输入以排队后续消息」                                              |
| 「存到草稿箱」按钮 + ⌘/Ctrl+Enter | 有                                           | 去掉（回车就是排队）                                                              |
| 排队行上的操作                    | 图标按钮                                     | 「↑ 立即发送」带文字 + 编辑 + 删除                                                |
| 「立即发送」                      | —                                            | 支持中途投递 → 直接插进当前回合；不支持 → 先停当前回复再发                        |
| 何时自动发出                      | 默认「手动」，要切到「自动」                 | **默认自动**：每结束一轮发下一条；面板上不再有自动/手动切换、标题、计数、清空菜单 |

- `CommandQueuePanel.tsx`：删掉标题行（草稿箱图标/标题/计数/模式切换/更多菜单/清空确认），
  props 去掉 `mode` / `onToggleMode` / `onClear`。
- `useConversationCommandQueue.ts`：默认模式 `manual` → `auto`。hook 的 `toggleMode` 和手动模式
  保留（存量 sessionStorage 里显式存了 manual 的照旧尊重），只是界面不再提供入口。空队列 + 默认
  模式不落 sessionStorage（规则没变，只是「默认」从 manual 变成了 auto）。
- 团队成员会话：忙时回车也是排队，排队消息回合结束后走团队邮箱发出；「立即发送」对团队成员
  走「先停再发」（成员不经过会话层的中途投递分支）。
- 新文案键只有一个：`conversation.commandQueue.queuedPlaceholder`（13 种语言）；
  「立即发送」复用 `conversation.commandQueue.sendNow`。旧的 `midturnBlocked*`、`addToQueue*`
  键还被 SendBox 内部引用，没删。

**顺带修的存量 bug（`1a3e485`）**：`MessageList.tsx` 消息行的 `React.memo` 比较函数比较了
id/content/position/type，**唯独没比较 `status`**。插话消息先以 `pending`（「投递中」）出现，再由
单独的 `message.statusChanged` 翻成 `finish`；两个事件落在同一帧时显示正常，隔开哪怕一帧（实测相隔
26ms）该行就不再重渲染，「投递中」一直挂到回合结束整页对账才消失。抓 WebSocket 帧确认事件是按序
到达的、数据库里早已是 `finish`，问题纯在前端。Claude/Codex 的插话徽标同样受影响。
回归测试 `tests/unit/renderer/messageListRowMemo.dom.test.tsx`（修复前失败、修复后通过）。

## 3. 验证

自动化：

- dream-engine：`pending_input_test.rs`（信箱开关语义）+ `engine_test.rs`（工具执行中插话进入下一次请求且排在
  工具结果之后、带插话说明；最终回答生成时插话会再走一轮；取消时残留消息写进历史；空闲时拒收）。
  `cargo nextest run --workspace` 2467 全过。
- dream-core：`agent_test.rs`（声明支持、无回合时的拒绝文案能被会话层识别为 turn-ended、有回合时进信箱）、
  `backend_output_sink` 的 SegmentBreak、`service_test` 的 dream 类型静态能力；
  `dream-core-ai-agent` + `dream-core-conversation` 1722 全过，`midturn_e2e` 2 个全过。
- dream-ui：队列 hook / 面板 / 两个发送框 / MessageList 行 memo 的单测。

## 4. 真机验证（dev + CDP，qwen3.7-flash）

本地 debug 编的 dreamcore 临时替换 `resources/bundled-dreamcore/win32-x64/dreamcore.exe`（验证前在二进制
里 grep 到 `no active turn to steer: the dream turn already ended` / `while you were still working`
确认含修复，验证后已还原成 v0.1.80）。

1. ping 跑着时插话「17×23」→ 后端日志 `queued for the running turn` → 工具结束后 `folding mid-run user
input count=1` → 一个回复里答了丢包率和 391，回答出现在插话**下方**的新气泡。
2. 连续两条插话 → `count=2` 一起并入。
3. 改版后：回复中回车 → 进排队行、占位提示变化、草稿箱按钮消失；不点任何东西 → 本轮结束后自动发出并得到
   回答；点「↑ 立即发送」→ 立即插进当前回合，「投递中」秒消失，模型在同一回复里答了丢包率和 19×21=399。

⚠️ CDP 驱动坑：这台机器 `devicePixelRatio = 1.25`，`Page.captureScreenshot` 是物理像素，
`Input.dispatchMouseEvent` 要 CSS 像素——拿截图坐标直接点会点偏（我点「停止」和「立即发送」都因此落空过）。
用 `getBoundingClientRect()` 取坐标，或者截图坐标除以 DPR。

## 5. 打包生效条件

- dream-ui 改动跟下一个安装包走。
- 后端（中途投递 + 插话说明）要 **dreamcore 发版 + bump `dreamcoreVersion`**；在旧 dreamcore 上：
  1ONE CLI 报不支持中途投递 → 「立即发送」走「先停再发」，排队/自动发出照常可用。

## 6. 追加：设置开关 + 团队作战

用户反馈：「中途插话和排队默认不能并存，默认立即插话，也可以选排队、手动点立即发送，做成设置开关；团队作战也要这样，方便及时干预。」

- **设置 → 系统 →「回复中发送消息」**（`chat.sendWhileBusy`：`interject` 默认 / `queue`）。
  - 立即插话：回复中按回车直接送进当前回合，占位提示「补充说明，消息会立即送达」。
  - 排队：进输入框上方的排队行（§3），本轮结束自动发出，「↑ 立即发送」= 插话。
  - 对方不支持中途接收（如 antigravity、旧版 dreamcore）时无论设置都排队。
  - 发送框用 `useConfig` 订阅；设置页沿用该页 `useState + configService.get/set` 的写法
    （该页单测 mock 的 configService 没有 `subscribe`）。
- **团队作战**（dream-core `b9bdcc8`）：`POST /api/teams/{id}/messages` 与 `/agents/{slot}/messages`
  新增可选 `interject`（默认 false，旧调用方不变）。为 true 且目标正在跑回合时，经
  `AgentTurnExecutionPort::deliver_into_running_turn`（默认实现返回 false）→
  `ConversationService::deliver_into_active_turn`（不落消息行，团队自己投影气泡）送进成员的当前回合，
  内容按唤醒消息的格式包装（`- From \`user\` [message]: …`）。送达后照常写邮箱留痕但**立即标记已读**，
下一次唤醒不会重复投递；回执带 `delivered_midturn: true`。送不进去（空闲、后端不支持、有待确认卡片、
回合刚好结束）时此前什么都没写，走原来的邮箱排队；斜杠命令永远不插话。
前端团队发送一律带 `interject: true`，何时发送由发送框（按上面的设置）决定。
- 真机：团队「测试」里对成员「游戏开发」发 ping 任务后插话 13×17 → 日志依次出现
  `team user message delivered into the running turn` → `upper-layer message delivered into the active turn`
  → `DreamEngine mid-turn message queued for the running turn`，回复里 ping 结果后接着答了额外计算。
  单会话下默认模式直接插话（无排队行）、切到排队后进排队行且本轮结束自动发出，均已验证。

## 7. 追加：「变更」面板（源代码管理）

用户问「变更」面板有啥用——它是 git 源代码管理面板（同 VS Code），但多数会话的工作区是自动建的
`dream-temp-*` 普通目录，永远显示「该文件夹未纳入版本控制」。用户选了方案 B（保留并提供初始化）：

- **初始化版本控制**（dream-core `1627082`，dream-ui `7d68065`）：空状态加说明 + 按钮；后端新增
  `scm/init`（git2 实现，不依赖用户装 git）：`git init` + 把当前文件提交为起点快照
  （用户没配 git 身份时署名 One Work），之后面板只列出 AI 后来的改动。已是仓库则原样不动；
  多根项目必须传 `pe_id`。完成后推 `repositoriesChanged`，前端把 reply 当同一帧 delta 应用，两者幂等。
- **技能链接排除**：会话目录里 `.dream/skills/<名>` 等是指向全局技能库的 **junction**。初始化时把所有
  链接、以及「只含链接的目录」写进仓库自己的 `.git/info/exclude`（不在用户目录里新建 `.gitignore`）。
  否则会把整个技能库扫进快照，技能更新也会显示成改动。
- **技能服务不再补 `.gitignore`**（dream-core `549b020`）：它原本发现工作区在 git 仓库里就往
  `.gitignore` 追加 `/.dream/skills/`——初始化后的下一轮因此冒出一个「AI 新增了 .gitignore」。
  现在 `info/exclude` 里已有同一条规则时视为已覆盖。
- **按状态上色**（dream-ui `ad14b46`）：文件名随徽标同色——新增绿、修改橙、删除红+删除线，悬停徽标显示全称。
- **一轮结束自动刷新**（dream-ui `e202b10`）：后端 scm 只监听 `.git` 元数据，不监听工作区文件，AI 写的
  文件不会自己推送状态；之前只有窗口重新获得焦点才刷新（我第一次验证时「自动出现」其实是 CDP 点击触发的
  焦点刷新，第二次不碰界面就复现了「没有变更」）。现在会话每轮结束刷新一次。
- 真机：新会话 → AI 建 keep.md/old.md → 初始化 → AI 追加 keep.md、删 old.md、建 new.md →
  面板显示 M/D/A 三色，磁盘 `git status` 一致、无 `.gitignore`；再让 AI 建 extra.md，不碰面板自动出现。

## 8. 追加：「连企业后 Agent 图标没了」——构建假象，不是产品问题

用户在 dev 里看到 Agents 页图标全挂。排查结论：**与企业无关**——图标地址由 `resolveBackendAssetUrl`
拼到 `getLocalBaseUrl()`，永远是本机 dreamcore；个人版下同样全挂。根因是我换进 dev 的**本地 debug 版
dreamcore**：debug 构建的 rust-embed 不把文件嵌入，运行时去编译时记录的源码路径读，而共享 `target/` 复用的
`dream-core-assets` 来自已删除的 `D:\dream\wt-core-sec` 工作树 → 全部 404。**正式版 v0.1.80 隔离起服实测 200**。
已修：dream-core `39f7337` 打开 rust-embed `debug-embed`，debug 构建也嵌入。

## 9. 追加：「添加文件夹到项目」后会话看不到那些文件夹

文件树右上角「添加文件夹到项目」只登记在项目表里，agent 启动时只拿到工作区目录，从没被告知还有别的根——
问「这个目录有什么」只会答工作区。dream-core `1e8ec59`：每个新回合把项目里额外挂的文件夹（名称 + 绝对路径）
作为一段 `[Project folders]` 说明前置到**发给 agent 的内容**（不进持久化消息，聊天记录仍是原话）；每回合都带，
因为文件夹会增删、重建的会话也不记得旧说明；斜杠命令开头不加。所有后端、团队回合（`run_user_turn` 是共同入口）都覆盖。
验证：dev 库副本隔离起服，原截图会话问同一句，模型 `tree` 了 `Desktop\测试123` 并在答案里单列出 `666.md`。

## 10. 追加：临时会话目录层级压平

旧布局：`工作目录\conversations\users\system_default_user\2026\10\10\dream-temp-<id>`，比工作目录深 7 层，
单机版里账号层毫无隔离作用、日期占 3 层。dream-core `498ab34`：

- 本地（单用户）：`conversations\2026-10-10\dream-temp-<id>`；多账号部署保留 `users\<账号>\`，日期同样并成一层。
- **存量路径不搬**：库里存的是绝对路径；判断「是不是我们建的 / 丢了能否重建 / 删除时清理哪些空目录」的三处
  识别逻辑统一走 `dated_parent_depth`，新旧布局都认；删除只清日期层，不碰账号层和 `conversations` 本身。
- 顺带修复：技能链接守卫拿「今天的预期路径」比对，**非当天创建的临时会话从来拿不到技能链接**，改为按结构识别。
  验证：crate 587 + 相关 e2e 1511 个测试全过；隔离起服用中文工作目录建会话→跑一轮写文件→删除，目录与空日期层都清干净。
