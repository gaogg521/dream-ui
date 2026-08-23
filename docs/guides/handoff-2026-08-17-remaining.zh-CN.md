# 交接：2026-08-17 收尾后仍未做的事

> 这一轮把上游同步待办基本清空了（详见
> [`upstream-sync-backlog-2026-08-16.zh-CN.md`](upstream-sync-backlog-2026-08-16.zh-CN.md)）。
> 这份文档只列**还没做的**，按可独立开会话的粒度切好，每条都写明"为什么它不是随手能改的"。

---

## ✅ 2026-08-18 更新：本文列出的事项已全部处置

**下面正文保留原样**（含当时的错误判断），因为其中几处前提**后来被证伪**，
留着比删掉有用——它记录了「哪一类前提最容易写错」。逐条结论：

| 原事项                  | 结论                | 关键点                                                                                                                                                                                       |
| ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 图片识别           | ✅ 已做             | 新增 aionrs 的 `ReadImage` 工具（不要求主模型视觉能力）+ 1oneCore 的 `resolve_vision_delegate`。**范围比原文小**：ACP（Claude Code）后端本来就是好的，坏的只有 aionrs，详见下方「§真机证据」 |
| P0-2 生图丢文字回复     | ✅ 已随 2.1.55 发出 | 代码早在主干，只差发版                                                                                                                                                                       |
| P1-1 C 组 `eb4bd7f7`    | ⛔ **已定不采纳**   | 原文说难点是「撞 fork 改过的 `watch_service.rs`」——**证伪**，fork 对那几个文件零独立改动（blob 逐字节相同）。真实风险是它会删掉五个前端在用的端点。证据见 backlog §2.C-1                     |
| P1-1 C 组 `b678d839e`   | ✅ 已做（等价重写） | 它与 `eb4bd7f7` **无依赖**，原文把二者归成一对是分组错误                                                                                                                                     |
| P1-2 claude CLI 2.1.233 | ✅ 已做             | 先验证 npm 上真实可获取才动手                                                                                                                                                                |
| P1-3 会话分叉           | ✅ 已做（完整移植） | 原文说「后端已合入只差前端」——**证伪**，`/api/conversations/{id}/fork` 在 1oneCore 整个不存在，直接合前端只会做出一个必然 404 的按钮                                                         |
| P1-4 CDP 失效           | ✅ 已恢复           | 加回应用级调试端口，但改成**两道闸**：打包版无条件拒绝 + dev 下需显式设 `AIONUI_DEVTOOLS_CDP_PORT`。`cdp.md` 已重写                                                                          |
| P2 发版                 | ✅ 已做             | 2.1.55                                                                                                                                                                                       |
| P3-1 flaky              | ✅ 已做             | 全量 vitest 连跑两轮真实退出码 0                                                                                                                                                             |
| P3-2 SessionCenter 覆盖 | ✅ 已做             | 17 条 dom 测试                                                                                                                                                                               |
| P3-3 License 轮换       | ⬜ **仍待人工**     | 涉及私钥保管，AI 不代做                                                                                                                                                                      |
| P3-4 杀软排除           | ⬜ **仍待人工**     | 属修改系统安全设置                                                                                                                                                                           |

### §真机证据：图片问题的范围比原文写的小

原文说「与用哪个文本模型无关」，这话对，但**漏了「与用哪个后端极其有关」**。
同一句「分析以下这张图片」、同一台机器：

- **ACP 会话**（Claude Code）→ **本来就是好的**。它自己的 `Read` 工具直接返回
  base64，模型正确分析出了内容（认出是股票行情图、均线、MACD、KDJ、五档盘口）。
- **aionrs 会话**（`deepseek-v4-flash`）→ 坏。

所以**不要把它做成内置 MCP** 去覆盖所有后端——那是给本来就正常的后端添乱。

aionrs 会话里模型实际走过的四步（真机轨迹，可作为回归对照）：
`ToolSearch("view_image")` → `No deferred tools matching` →
`Read` → `(binary file, 137968 bytes)` → 硬调 `ViewImage` → `not available` →
模型自己宣布「我来改用本机 Windows OCR 能力……先写一个 PowerShell 脚本」。

**这段轨迹直接决定了两条设计**：新工具 `requires_image_input()` 必须为 false
（否则同样被过滤掉），且**必须不是 deferred**（否则要经 ToolSearch 才找得到，
而上面正是这一步失败的）。两条都有测试钉死。

### ⚠️ 两条方法论（本轮新增，值得写进流程）

1. **子任务/交接文档的结论是线索，不是事实。** 本轮有 **3 条前提被证伪**
   （fork 后端已合入、`eb4bd7f7` 撞 fork 改动、`b678d839e` 与它配对）。判据必须是
   自己开文件核对，尤其是「某某已经存在/不存在」这类**存在性断言**——一个没查到的
   文件就能推翻它。
2. **中途被打断的负向验证会留下没恢复的破坏。** 本轮真实发生：一个子任务在
   「故意破坏 → 看测试是否变红」的中途因额度中断，工作区里留下了
   `return ToolResult { content: String::new(), is_error: false };`
   —— 正好让「没有视觉模型」时静默返回空结果，即这个功能要防的那个失败模式。
   **接手任何被打断的工作，先全仓搜 `unreachable_code` / `NEGATIVE` / `TEMPORARY`
   这类标记再跑测试。**

---

## 🔴 P0-1 图片识别（文本模型拿到图片后无能力处理）

**用户报告**：2.1.54 发图片，"默认不识别"；且**与用哪个文本模型无关**。

### 已查清的机制（代码级，非推测）

当前链路：附件在后端被解析成**纯文本路径**注入提示词
（`1oneCore/crates/aionui-ai-agent/src/manager/aionrs/content.rs`
的 `build_content_blocks` → `[Attached files]\n<绝对路径>`）。
然后：

- aionrs 引擎里 `ViewImage` 工具带 `requires_image_input() == true`
  （`aionrs/crates/aion-tools/src/view_image.rs:155`）；
- 引擎在组装工具清单时按能力过滤掉它
  （`aionrs/crates/aion-agent/src/engine.rs:706` 与 `:713`：
  `!tool.requires_image_input() || image_input.supports_images()`）；
- 于是**文本模型的工具清单里根本没有任何能读图的工具**，
  它只拿到一个自己打不开的文件路径。

### 关键发现：本仓从来没有"图片转文字"这一层

记忆里记着一套 `describeImagesForPrompt` / `visionModelResolver.ts` /
`attachmentTextExtractor.ts` / `buildAttachmentContextBlock` 的多模态转文字管线
（图片走 vision API 转描述、PDF/docx 抽文本、音视频转写 + 关键帧）。
**实测这些在当前代码里全部为 0 命中，且 `git log -S` 在本仓全部历史里也 0 命中**——
即它属于更早的仓库形态（记忆里的路径是 `src/process/worker/aionrs.ts`，
没有 `packages/desktop/` 前缀，是 monorepo 重构之前的布局），
**从来没有被带进现在这套结构**。

```
attachmentTextExtractor        -> 0 files
buildAttachmentContextBlock    -> 0 files
buildPromptAugmentationPrefix  -> 0 files
isExtractableAttachmentPath    -> 0 files
conversationSendService        -> 0 files
```

`content.rs` 自己的注释点明了现设计的意图：
"a text-only leader can still receive the turn and **delegate the path**"——
它假设有个带视觉的队友/子 agent 去接手。
**单个文本模型、没有视觉队友时，没有任何人接手。**

### ⚠️ 尚未证实的部分（下一个会话务必自己验，别继承我的结论）

1. **我没能找到 2.1.53 → 2.1.54 之间任何与图片相关的改动。**
   `git log v2.1.53..v2.1.54`（12 条）与 `v0.1.63..v0.1.65`（16 条）逐条看过，
   无一条碰图片/附件/vision。所以"**2.1.53 好的、2.1.54 坏的**"这个前提我**没验证成**。
   可能是记忆偏差（更早的版本才有那套转文字管线），也可能有更隐蔽的改动我没找到。
   **动手前先钉死这一点**：拿 2.1.53 的安装包实测同一张图，确认它到底行不行。
2. **我没有跑 CDP 实测复现——因为这个能力已经从应用里删掉了**（见下面 P1-4）。
   上面全是静态代码证据（能证明"文本模型没有读图工具"这个机制），
   但没有一次真机 send 的观测记录。**要真机验证只能人工点界面。**

### 我做过又回退的一次错误尝试（别重犯）

我一度把 `1oneCore/crates/aionui-ai-agent/src/capability/image_input.rs` 里
自定义网关未匹配模型的默认值从 `Unknown` 改成 `Supported`（提交 `7cf40b96`），
想让图片"照常发出去让 provider 报错"。**用户当场否掉并已 revert（`a1caef8e`）**——
理由是：文本模型不认图片本来就正常，正确做法是**插件/OCR/工具转文字**，
而不是硬塞给 provider 让它报错。**方向记住：补兜底转换能力，不是放宽能力判定。**

### 建议方向（用户已明确的意图）

给文本模型一条**不依赖模型视觉能力**的读图路径，例如：
内置 OCR 工具 / 本地 OCR MCP / 或恢复"发送前把图片转成文字描述"那一层。
注意 `image_input.rs` 的白名单机制本身是刻意设计（有测试锁死
`minimax-2-7`/`deepseek-v4-flash` 这类纯文本 lookalike 不许放行），**别去削弱它**。

---

## 🟡 P0-2 生图工具丢弃模型文字回复 —— 已修但未发版

`2d387b9f0`（本仓 `one-main`）已修：`MediaJobManager` 成功分支此前只接
`assets`/`droppedParams`，`outcome.text` 被丢掉，于是 Form B（本质是一次
chat completion）只回文字不产图时，agent 只拿到一句空洞的
`(job xxx, status done)`，只能自己编内容。

**状态**：代码在主干，但 **2.1.54 是这条修复之前打的包**，所以线上仍是坏的。
**要做的只有一件事：下次发版把它带上。**

---

## 🟡 P1 上游同步剩余项（每条都不是随手 pick）

| #   | 事项                                                                      | 为什么不是简单 pick                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ~~**C 组剩 2 条**~~ → **已决定不采纳（2026-08-17 结案，别再重做）**       | **本行原先的判断已被证伪、作废**：它写着「正面撞 fork 自己独立改过的 `watch_service.rs`/`file_watching.rs`」——实测这几个文件 fork **零独立改动**，blob 哈希与上游同一 PR（`7f8ed6c5`）逐字节相同。真实不采纳理由是另外四条：①`eb4bd7f7` 删掉的五个端点 fork 前端全在用（`ipcBridge.ts:981-982` 的 office-watch、`:1455-1473` 的 preview-history）②它建在 fork 未采纳的 `6e77158c` 之上，而后者删的 browse/zip/remove/rename 前端有三处在用 ③夹带独立未评估功能 `system_file_opener.rs` ④会威胁 fork 原创 `8c8cf349` 的 `to_relative_path_string()`（Windows 反斜杠导致文件树塌成一个节点的修复）。**完整证据、复现命令与「将来若要做的正确路径」见 [`upstream-sync-backlog-2026-08-16.zh-CN.md`](upstream-sync-backlog-2026-08-16.zh-CN.md) §2.C-1。** 配对的 UI `b678d839e` 经核实与 `eb4bd7f7` **无任何依赖**（纯前端保存按钮），已按 fork 现状**等价手写实现**，不是 cherry-pick。 |
| 2   | **内置 claude CLI 从 2.1.215 升到 2.1.233**（Core `9645dc5b`/`77acec68`） | 这两条各有一半落在 `aionui-session/backend/cli_version.rs`，而该文件来自上游 `ae817e32`「改用用户自己的 claude/codex、不再内置」——**fork 没采纳那套架构**（仍内置，pin 在 `aionui-runtime/managed_cli/mod.rs` 的 `CLAUDE_CLI_VERSION`）。另一半改的是 `claude_flags.rs` 里**刻意绑在 fork 自己 pin 值上**的断言。所以它等价于"fork 要不要升内置 CLI"的**打包决策**，需验证该版本二进制可获取。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3   | **会话分叉（session fork）前端半边** UI `ae2d2f53e`                       | aionrs 后端半边已随整体 merge 进来（`df1cf85`+`5889110`），但前端入口未合，所以功能不可见。**属产品决策**：要不要这个能力。注意它牵着 `ForkBranchIcon` 组件与 turn-id 两处（本轮已从别的提交里剥离过，见待办文档"顺带混进未同步功能"那节）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4   | **`docs/guides/cdp.md` 已失效，需重写或删除**                             | 那份文档教你连 `http://127.0.0.1:9230` 调试应用界面，**但应用级 `remote-debugging-port` 开关早已从代码里删掉**（`configureChromium.ts:97-98`/`245-255` 的注释明确写着"随应用级 remote-debugging-port 一起删除"，并连 9230-9250 号段预留也移除了）；文档里"设置 → 系统 → 开发者调试 → 启用远程调试"那个开关也不存在了（`enableRemoteDebugging`/`remoteDebugging`/`developerDebug` 全仓 0 命中）。**实测启动 dev 后 9230 确实不监听。** 现在唯一的 CDP 是 D 组新加的**单目标 agent 浏览器桥**（`127.0.0.1:<随机端口>`，需 token），而它**按设计就碰不到 AionUi 界面本身**（i18n 文案原话："它只能操作应用内浏览器这一个页面，碰不到 AionUi 界面本身"）。**后果：过去那套"用 CDP 驱动真实界面做验收"的方法论现在不可用**，真机验证只能人工点，或者先把应用级 CDP 开关加回来。                                                                                                            |

### ⛔ 已明确不采纳的，别再重做

- `e187ac746` 移除 11 套社区主题 —— **用户拍板永久保留主题**
- `fe99ff60` 恢复 direct CLI Team MCP —— 会把 `route_for_backend` 的
  claude/codex 重新指回 `DirectCli`，破坏 fork 的桥接注入
  （`acp.rs:1549-1550` 有测试锁死），且新增契约测试在本仓必失败
- `36d632de5` / `48a8b9bf` 版本号提交 —— 按 fork 自己节奏，不照搬
- `eb4bd7f7` 预览 v2 后端半边 —— 删掉的五个端点 fork 前端全在用，且建在
  fork 未采纳的 `6e77158c` 之上；证据见
  [`upstream-sync-backlog-2026-08-16.zh-CN.md`](upstream-sync-backlog-2026-08-16.zh-CN.md) §2.C-1

---

## 🟡 P2 打包与发布

1. **D 组动了 `asarUnpack`，下次打包必须验证** `out/main/builtin-mcp-browser.js`
   真的被解包出来——它要被外部 node 进程执行，留在 asar 里就用不了。
2. **打 Mac 包前先跑**
   [`mac-packaging-preflight.zh-CN.md`](mac-packaging-preflight.zh-CN.md) §1 的四条。
   Mac 是本仓**唯一带质量门禁**的路径（Windows 本地打包完全不跑
   lint/format/tsc/test），主干上的漂移会攒到那一刻一次性爆掉。
3. **本轮未 bump 版本号**（按约定打包前才 bump patch）。

---

## 🟢 P3 环境与既有欠账

1. **两个测试在并行负载下 flaky**（单独跑必绿，非本轮回归）：
   `tests/unit/previews/PreviewPanel.dom.test.tsx`（已知既有）、
   `tests/unit/renderer/hooks/guidPage.dom.test.tsx`（2 条 focus 断言）。
   已核实本轮所有提交**没碰 guid 页面源码**。值得单独一轮做稳定化。
2. **会话中心（`pages/SessionCenter/`）零测试覆盖**。本轮给它补了「标为未读」
   的新必填 props，**仅由 tsc 保证类型正确，无行为验证**。
3. **License 公私钥仍需轮换**——当前内置的是开发占位公钥，私钥已泄露
   （会话里打印过，且明文在桌面 `feishu.txt`）。**上线前必须 keygen 换掉**，属人工离线操作。
4. **给托管 node 目录加杀软排除**——本机起一个 node 要 1~1.7 秒
   （Defender 逐进程扫 89.8MB `node.exe`），是 `npx` 型 MCP 慢且不稳的根因。属人工操作。

---

## 📋 交接话术（直接复制给新会话，每段自包含）

> 下面每段都可以**原样粘贴**给一个新的 AI 会话。已经把「必读什么、坑在哪、
> 什么算做完、什么绝对不要做」都写进去了，新会话不需要看这轮对话。
> **共同前置**（每段开头都带了）：工作目录 `D:\aionui-m0`，三仓 fork
> （`1oneUI` 前端 / `1oneCore` Rust 后端 / `aionrs-local` agent 引擎），
> 只单向同步上游、永不反向提 PR。

---

### 话术 A —— 图片识别（P0，最该先做）

```
工作目录 D:\aionui-m0，三仓 fork：1oneUI(前端Electron) / 1oneCore(Rust后端) /
aionrs-local(agent引擎)。先读 1oneUI/CLAUDE.md 和
1oneUI/docs/guides/handoff-2026-08-17-remaining.zh-CN.md 的 P0-1 那节。

任务：让文本模型也能处理用户发的图片。

现状（已由上一轮查到代码行，可直接复用，但请自己开文件复核）：
- 附件目前只作为纯文本路径注入提示词：
  1oneCore/crates/aionui-ai-agent/src/manager/aionrs/content.rs 的
  build_content_blocks() → "[Attached files]\n<绝对路径>"
- 唯一能读图的 ViewImage 工具带 requires_image_input()==true
  (aionrs-local/crates/aion-tools/src/view_image.rs:155)
- aionrs 引擎按能力把它过滤掉：
  aionrs-local/crates/aion-agent/src/engine.rs:706 和 :713
  (!tool.requires_image_input() || image_input.supports_images())
- 结论：文本模型的工具清单里没有任何能读图的工具，只拿到一个打不开的路径。
  这与用哪个文本模型无关（用户已确认"不管哪个文本模型都有问题"）。

⚠️ 两件事上一轮没证实，你要先自己钉死，别继承结论：
1. 用户说 2.1.53 正常、2.1.54 不正常，但 git log v2.1.53..v2.1.54(12条) 与
   aioncore v0.1.63..v0.1.65(16条) 逐条看过，没有任何图片/附件/vision 相关改动。
   所以"53好54坏"这个前提没验证成。请先拿 2.1.53 的安装包实测同一张图。
2. 上一轮没做真机复现。注意：CDP 驱动界面的老办法已失效（见下面），
   真机验证只能人工点界面。

⛔ 绝对不要做的（上一轮做过、被用户当场否掉并已 revert）：
不要去放宽 1oneCore/crates/aionui-ai-agent/src/capability/image_input.rs 里
"自定义网关未匹配模型"的默认能力判定（曾把 Unknown 改成 Supported，
提交 7cf40b96，已被 revert a1caef8e）。用户明确的方向是：
"文本模型不认图片本来就正常，应该靠插件/工具/MCP/OCR 转文字来识别，
provider 一定不会说自己不认识图片"。
也不要削弱 image_input.rs 的白名单——它有测试锁死 minimax-2-7 /
deepseek-v4-flash 这类纯文本 lookalike 不许被误放行，那是刻意设计。

正确方向：给文本模型一条不依赖模型视觉能力的读图路径
（内置 OCR 工具 / 本地 OCR MCP / 或"发送前把图片转成文字描述"那一层）。
补充背景：记忆里记着一套 describeImagesForPrompt / attachmentTextExtractor /
visionModelResolver 的"多模态转文字"管线，但 git log -S 在 1oneUI 全部历史里
0 命中——它属于 monorepo 重构之前的旧仓库形态，从未被带进现在这套结构。
所以这是"要新建能力"，不是"要找回被删的代码"。

算做完：文本模型发一张图，agent 能说出图里的内容（人工真机验证一次），
并补上覆盖该路径的测试。
```

---

### 话术 B —— 上游同步剩余项（P1，可一次会话做完前两条）

```
工作目录 D:\aionui-m0，三仓 fork，只单向同步上游、永不反向提 PR。
必读：1oneUI/docs/guides/upstream-sync-backlog-2026-08-16.zh-CN.md
（尤其 §1 的九个坑）和 handoff-2026-08-17-remaining.zh-CN.md 的 P1 表。

上游同步待办已基本清空，只剩这三条，每条都不是随手 pick：

1) C组剩2条：1oneCore eb4bd7f7 + 1oneUI b678d839e
   eb4bd7f7 实际是文件监听子系统整体重写（45文件，
   aionui-file/watch_service.rs 629行 + aionui-office/snapshot.rs 523行
   整体删掉换成 watch_manager.rs/proxy.rs），远超原描述的"office刷新"量级，
   且正面撞 fork 自己独立改过的 watch_service.rs / file_watching.rs。
   建议单独一轮，逐个冲突核对。

2) 内置 claude CLI 从 2.1.215 升到 2.1.233（1oneCore 9645dc5b + 77acec68）
   这不是例行 pick：两条各有一半落在
   aionui-session/backend/cli_version.rs，而该文件来自上游 ae817e32
   「改用用户自己的 claude/codex、不再内置」——本 fork 没采纳那套架构
   （仍内置，pin 在 aionui-runtime/managed_cli/mod.rs 的 CLAUDE_CLI_VERSION）。
   另一半改的是 claude_flags.rs 里刻意绑在 fork 自己 pin 值上的断言。
   所以它等价于"要不要升内置 CLI"的打包决策，动手前先验证该版本二进制可获取。

3) 会话分叉前端半边：1oneUI ae2d2f53e
   aionrs 后端半边已随整体 merge 进来（df1cf85+5889110），但前端入口未合，
   功能不可见。属产品决策，先问用户要不要这个能力。
   它牵着 ForkBranchIcon 组件与 turn-id 两处。

⛔ 以下三条已明确不采纳，不要重做：
- 1oneUI e187ac746（移除11套社区主题）——用户拍板永久保留主题
- 1oneCore fe99ff60（恢复 direct CLI Team MCP）——会把 route_for_backend 的
  claude/codex 重新指回 DirectCli，破坏 fork 的桥接注入
  （acp.rs:1549-1550 有测试锁死），且它新增的契约测试在本仓必失败
- 版本号提交 36d632de5 / 48a8b9bf——按 fork 自己节奏，不照搬

⚠️ 本轮反复踩到的坑（必守）：
cherry-pick 的冲突视图里会混进"相邻但未同步"的功能代码
（本轮实例：ForkBranchIcon、markCompleted(id,turn_id) 签名、Search面板、
SCM面板、open-system）。判据：git show <commit> -- <file> 里
只有 +/- 行才是这个 commit 的，前导空格是上下文，照搬上下文会引入
不存在的模块或半截功能。这个坑还会藏在测试块里，而 cargo build
不编译 test 目标——本轮就有两条误带入的测试躲过了 build。

⚠️ 判定测试是否通过，必须取被测命令自己的退出码：
用 `cargo test ... > log 2>&1; echo $?`，
不要用 `cargo test ... | grep ...`（管道退出码是 grep 的，
上一轮我据此把2个编译错误读成了 exit 0）。

改完 1oneCore 的 Rust 必须跑 D:\aionui-m0\scripts\backend-rebuild.ps1
重编内嵌，否则 dev 用的还是旧后端（跑之前先确认应用没在跑，否则 EPERM）。
```

---

### 话术 C —— CDP 调试能力已失效，需重建或改文档（P1）

```
工作目录 D:\aionui-m0。任务：处理 1oneUI/docs/guides/cdp.md 已失效的问题。

实测结论（上一轮验证过，你可复核）：
- cdp.md 教你连 http://127.0.0.1:9230 调试应用界面，但应用级
  remote-debugging-port 开关早已从代码删除——
  packages/desktop/src/process/utils/configureChromium.ts 的注释
  (约 97-98 行、245-255 行) 明确写着"随应用级 remote-debugging-port 一起删除"，
  连 9230-9250 号段预留也移除了。
- 文档里"设置→系统→开发者调试→启用远程调试"那个开关也不存在了：
  enableRemoteDebugging / remoteDebugging / developerDebug 全仓 0 命中。
- 实测 `bun run dev` 起来后 9230 确实不监听。
- 现在唯一的 CDP 是新加的单目标 agent 浏览器桥
  (启动日志: "[CDP] Single-target bridge listening on 127.0.0.1:<port>")，
  而它按设计就碰不到 AionUi 界面本身
  (i18n 原话："它只能操作应用内浏览器这一个页面，碰不到 AionUi 界面本身")。

影响：本仓历史上大量验收都依赖"用 CDP 驱动真实界面"这套方法论
（见各 session 文档里的"真机 CDP 验证"），现在这条路断了，
新会话照着 cdp.md 做只会白折腾。

请先问用户选哪条：
(a) 把应用级 CDP 开关加回来（仅 dev 或需显式开启，别默认对生产开）
    并更新 cdp.md；
(b) 只把 cdp.md 改成如实描述现状 + 说明真机验证改为人工，
    并在 CLAUDE.md 标注老方法论失效。
```

---

### 话术 D —— 发版（P0-2 顺带修复 + 打包注意）

```
工作目录 D:\aionui-m0。任务：发一个新版本。

必须知道的两件事：
1) 提交 2d387b9f0（在 1oneUI one-main）修了"生图工具在无产出时丢弃模型
   文字回复"，但 2.1.54 是这条修复之前打的包，所以线上仍是坏的。
   这次发版会把它带上——请在更新说明里写上。
2) 本轮合入的内置浏览器功能动了 packages/desktop/electron-builder.yml
   的 asarUnpack，新增了 out/main/builtin-mcp-browser.js。
   **打完包必须验证它真的被解包出来**（它要被外部 node 进程执行，
   留在 asar 里就用不了）。

打包前必读 1oneUI/docs/guides/mac-packaging-preflight.zh-CN.md §1 的四条并跑完
——Mac 是本仓唯一带质量门禁的路径（Windows 本地打包完全不跑
lint/format/tsc/test），主干上的漂移会攒到打 Mac 包那一刻一次性爆掉，
且失败会伪装成"Mac 构建失败"。历史上连挂三次全是这个原因。

打包前按约定先 bump version patch +1 并 commit push。
Windows 打包必须设 AIONUI_BACKEND_LOCAL_PATH 指向本地 aioncore
（已封装 scripts/package-win.ps1）。
⚠️ 不许删任何旧的 .exe 安装包。
```

---

### 话术 E —— 测试稳定性与欠账（P3，适合并行会话）

```
工作目录 D:\aionui-m0。任务：清理测试稳定性欠账。读
1oneUI/docs/guides/handoff-2026-08-17-remaining.zh-CN.md 的 P3。

1) 两个测试在并行负载下 flaky，单独跑必绿，非功能回归：
   - tests/unit/previews/PreviewPanel.dom.test.tsx（已知既有，
     全量跑时 60 秒超时，单独跑 7 秒通过）
   - tests/unit/renderer/hooks/guidPage.dom.test.tsx（2 条 focus 断言，
     单独跑 14/14 全绿；已核实上一轮所有提交都没碰 guid 页面源码）
   目标：让 `bunx vitest run tests/unit` 真实退出码为 0。
   ⚠️ 判据取 vitest 自己的退出码，别隔着管道看。

2) packages/desktop/src/renderer/pages/SessionCenter/ 零测试覆盖。
   上一轮给它补了"标为未读"的新必填 props，仅由 tsc 保证类型正确、
   无行为验证。建议补 dom 测试。

⚠️ 修 flaky 测试时不许削弱断言、不许删测试。若断言本身是对的，
就去修实现或修测试的等待方式（本仓 AGENTS.md 明文规定）。
```

---

### 话术 F —— 人工操作项（不能让 AI 做，给你自己留的）

```
这两条属安全/人工操作，AI 不应代做：

1) License 公私钥轮换：当前内置的是开发占位公钥，私钥已泄露
   （会话里打印过，且明文在桌面 feishu.txt）。上线前必须 keygen 换掉。
   ⚠️ 运行 keygen 时不要把私钥贴进任何对话。

2) 给托管 node 目录加杀软排除：本机启动一个 node 要 1~1.7 秒
   （Defender 逐进程扫 89.8MB node.exe），这是 npx 型 MCP 慢且不稳的根因。
   目录：%APPDATA%\1one-Dev\1one\runtime\node\
```

---

## 🔧 方法论：本轮踩到、值得写进流程的两条

1. **冲突视图里会混进"相邻但未同步"的功能代码。** 本轮实例：
   `ForkBranchIcon`（会话分叉）、`markCompleted(id, turn_id)` 签名（turn-id）、
   Search 面板、SCM 面板、`open-system`。
   **判据：`git show <commit> -- <file>` 里 `+`/`-` 才是这个 commit 的，
   前导空格是上下文。** 照搬上下文会引入不存在的模块或半截功能。
   ⚠️ 这个坑还会出现在**测试块**里，而 `cargo build` 不编译 test 目标——
   本轮就有两条误带入的测试（引用不存在的 `rig_with`/`name_source`）躲过了 build。
2. **`cargo test ... | grep ...` 的退出码是 grep 的，不是 cargo 的。**
   本轮我据此把 2 个编译错误读成了"exit 0"。
   **判定测试通过必须取被测命令自己的退出码**（重定向到文件后再 grep）。
