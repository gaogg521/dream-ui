# 上游（dream-ui / dream-core）两个月增量的取舍与移植 + 跨会话消息/归档体系调研

> 日期：2026-09-18 ｜ 涉及仓：`dream-ui`、`dream-core`
>
> 本轮做了两件事：
>
> 1. 把上游 2026-08-21 之后的**缺陷修复与低风险功能**逐条核对并移植（A、B 两类）。
> 2. 对上游的**跨会话消息（`@@`）**与**侧边栏归档体系**做设计调研（C 类，**只调研不落地**）。
>
> 基线始终是「绝对不能破坏我们自己的应用」，所以每一条都先证明「这个 bug 我们确实有」或「这个改动碰不到我们改过的地方」，再动手。

---

## 0. 先确定分叉点（这决定了「增量」到底是哪些提交）

我们两个仓都是 2026-08-23 从 `1oneUI` / `1oneCore` 原样快照复制的，没有共享 git 历史，所以不能靠 `git log` 比对。改用**文件存在性**定位：

把上游 `packages/desktop/src` 的文件清单和我们的清单取差集，再查每个「上游有我们没有」的文件是哪天新增的。结果非常干净：

- 上游 2026-08-21 及之后新增的文件，我们**一个都没有**；
- 上游 2026-08-20 及之前的，我们**全都有**（抽查了 `74512d3e` 的 `refactor(feedback): attach account email automatically`，在我们树里）。

**结论：分叉点 = 上游 dream-ui `74512d3e`（2026-08-20 20:36）**。dream-core 同日（`dream-ui-sidebar`、`dream-core-session-message` 两个 crate 都是 08-21 新建的，我们没有）。

所以「最近两个月」里 07-18 → 08-20 那一半我们本来就有（顺带确认了两个 `fix(security)` 路径穿越修复都在：`HTMLRenderer.tsx` 的 `isWithinRoot` / `normalizeAbsolute`）。真正的增量是 **08-21 → 09-18**：dream-ui 30 个提交，dream-core 55 个（后者一大半是 ACP registry 版本 pin）。

### 复现方法（下次再做同样的事照抄）

```bash
# 只拉提交树、不拉文件内容，几秒钟
git clone --filter=blob:none --no-checkout https://github.com/gaogg521/dream-ui.git
# 然后对每个「上游独有」的文件跑 git log -1 --diff-filter=A
```

---

## 1. 移植时用的两个工具（关键：先证明差异是机械性的）

我们和上游在同名文件上的差异，绝大多数是**改名造成的机械差异**，不是真的分歧。验证办法是：**把上游「改动前」的文件套上我们的改名规则，看能不能逐字还原出我们的当前文件**。能还原，就说明这个文件我们没有自己的改动，可以直接取上游「改动后」的版本。

- 前端（`scratchpad/patches/localize.py`）：`bg-bg-N` → `bg-N`、`border-border-N` → `border-N`（`ecf2eac` 那次 176 处失效类名修复）、`Aion*` 基础组件 → `Dream*`、版权头。
  - 逐字还原验证通过：`PreviewContextMenu.tsx`、`PreviewTabs.tsx`。
- 后端（`scratchpad/patches/localize_core.py`）：`dream_core_process` → `dream_core_process`、`dream_core_common` → `dream_core_common`、`dream_core_session` → `dream_core_session`、`DREAM_*` 环境变量 → `ONE_*`、品牌串。
  - 逐字还原验证通过：`claude_conn.rs`（7118 行，完全一致）。

**反例**：`PreviewPanel.tsx` 还原不出来——我们有自己的 `handleToolbarSave`（修过一个静默丢编辑的 bug）。这种就不能整文件取，只能打 diff。`session_agent.rs` 同理（我们多了一处 `..Default::default()`）。

> ⚠️ **本轮自伤过一次，记下来**：`io.open(p,'w').write(localize(io.open(p).read()))` 这种写法，Python 会**先**求值 `io.open(p,'w')`（当场把文件截断），**再**去读那个已经空了的文件 —— 一次清空了 9 个文件，其中 `types.d.ts` 是已跟踪文件。改用 `loc.py`：先完整读进变量，读到空就直接报错退出，再写。

---

## 2. A 类：逐字核对确认「我们必然存在」的缺陷（全部已修）

| #   | 问题                                                                                                                                | 我们的证据                                                                                                                  | 提交                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| A1  | **claude 模型选择**：`--model` 这个 spawn flag 会改写它自己被读取的那份 catalog；`--model default` 还会覆盖用户的 `ANTHROPIC_MODEL` | `claude_conn.rs:245` 照样 push `--model`；`useGuidAssistantSelection.ts:294` 与 `useGuidSend.ts:259` 与上游修复前逐字相同   | `dc88fab`(core) `d8bcf74`(ui) |
| A2  | **远程 WebUI 一天后进 401 死循环**：JWT 24h 装在 30 天的 cookie 里 + 客户端重连退避形同虚设                                         | `jwt.rs:14` = 24h 而 `COOKIE_MAX_AGE_DAYS` = 30；`browser.ts` 的 `open` 无条件重置退避、`ensureSocket()` 每次 emit 直接重拨 | `0cd9425`(core) `c635fd0`(ui) |
| A3  | Markdown 表头居中、正文靠左                                                                                                         | `markdown.css:131` / `ShadowView.tsx:252` 的 `th` 块与上游修复前逐字相同                                                    | `062cb81`                     |
| A4  | 快速输入时 Enter 把裸的 `/command` 当消息发出去                                                                                     | `useSlashCommandController.ts:146` 用 memo 出来的状态判断                                                                   | `28d7d9f`                     |
| A5  | 预览页标签右键菜单跑到屏幕外（看起来像"没反应"）                                                                                    | `.preview-panel` 的 `animation ... forwards` + `PreviewContextMenu` 用 `fixed` 且没有 portal                                | `bae0f6b`                     |
| A6  | 空名会话的标题点不动、永远改不了名                                                                                                  | 后端 `req.name.unwrap_or_default()` 会落空名，前端 `title: conversation.name` 裸传                                          | `793dbce`                     |
| A7  | auto-inject 技能描述超预算（`one-config` 677 字符）                                                                                 | 见下方说明                                                                                                                  | `7800d1c`                     |

### A1 值得单独说：两个缺陷是上游实测探出来的，不是推断

`initialize` 回复里的 `models[]` 是 `--model` flag 的**函数**：

| spawn             | catalog                                    |
| ----------------- | ------------------------------------------ |
| 不带 flag         | 6 行，最后一行来自用户的 `ANTHROPIC_MODEL` |
| `--model default` | 6 行，但最后一行变成账号默认               |
| `--model <别名>`  | 5 行，那一行直接没了                       |

catalog 是**按 agent 持久化、后写覆盖**的 —— 所以某个会话选了别名，就把**其他所有会话**选择器里那一行抹掉了。这就是"同一台机器同一个 CLI，两个环境显示不同模型列表"的根因。

修法：spawn 不带 flag，选择改走 in-band 的 `control_request{set_model}`（实测它不动 catalog）；首轮之前下发，**并且每次 idle-wake 重生后重新下发**（`--resume` 不恢复模型，实测）。语义上改成**用「有没有」而不是「值是什么」区分**：没选就什么都不发（CLI 自己从用户配置解析），选了 `default` 照发（那是 catalog 里一个真实的行）。

我们本来就有很厚的 `set_model` 机制（带 2.1.187/2.1.191 的实测注释），所以是接上去，不是新建。

### A2 我们比上游还干净一点，值得记

上游说"只有默认路径不一致"。我们这边更明确：`mint_session` 在企业 `LoginRiskGate` 给了 TTL 时，**cookie 的 max-age 就是用同一个 TTL 算的**，所以策略绑定的企业会话本来就一致，从来没坏过。坏的只有默认路径。新测试因此断言的是**关系**（token 必须活得比装它的 cookie 久）而不是常量，以后把 TTL 改短必须连 cookie 一起改，否则测试红。

### A7 我们的实际损失比上游小，别照搬结论

上游说索引条目从 1453 字符降到 908。**我们不一样**：`prompt_builder.rs:11` 有 `INDEX_DESCRIPTION_CAP = 120`，走提示注入的 agent 本来就被截断了。

真正付全额的是**原生技能交付的 agent（claude、codex）**——技能目录直接交给 CLI，CLI 自己读 frontmatter 的 `description` 放进它的常驻目录，没有任何截断。所以这个修复对我们**只在原生交付路径上成立**，测试注释里把这个区别写清楚了。

---

## 3. B 类：已移植的低风险功能

| 功能                                                                | 上游                | 提交      |
| ------------------------------------------------------------------- | ------------------- | --------- |
| 预览面板最大化 + 标签操作（关闭 / 关闭未修改 / 复制路径 / `Cmd+W`） | #4153 #4164         | `bae0f6b` |
| 聊天区 mermaid 平移缩放 + WaveDrom 时序图                           | #4108 #4135         | `04e6a3f` |
| 通知里带上会话名                                                    | #4195               | `31c8be5` |
| Explorer「全部折叠」                                                | #4202（只取这一半） | `53f93ab` |
| 分区字体：字族 + 字重 + 字号（全局/聊天/Markdown/代码）             | #4138 #4152         | `45891a5` |
| SCM 发现阶段枚举 linked worktrees                                   | dream-core #959     | `d1ea6bc` |

### 两件移植时踩到的事

**1）`bun install` 会顺手改 410 个包，把 CodeMirror 测试全弄红。**
加 WaveDrom 时跑了一次普通 `bun install`，它把 `wavedrom` 解析成 3.7.0 并**重新解析了约 410 个无关锁条目**，结果加载了第二份 `@codemirror/state`，`codeEditor` / `editorDegradation` 共 21 个测试全挂。
改用 `bun add wavedrom@3.6.2 json5@2.2.3`（精确锁版本）后只动了 15 行锁文件。**这两个依赖因此是精确 pin 而不是 `^`**，故意的。

顺带修了一处真的品牌残留：锁文件里 `@dream/web-cli` 的 bin 还写着改名前的 `dream-web`，而它的 `package.json` 和磁盘上的文件早就是 `dream-web` 了。

**2）Explorer 只取了一半，另一半有后端依赖。**
上游 #4202 的另一半是「tab 级刷新」，它建立在 `refreshRoot` 上，而 `refreshRoot` 调的是 `fs/remount` 这个 monitor 方法 —— **我们 core 没有**（`dispatch.rs` 里只有 subscribe/unsubscribe/mkdir/createFile/remove/rename/copy/move/search）。上游那条提交是纯前端的，因为它后端早就有了。

要补齐就得给 FS 监视器加一个方法（重新 arm watch + 重读 baseline）。这类改动做错了能把整个文件监视弄坏，所以本轮**明确不做**，留作独立一条。

---

## 4. C 类调研：跨会话消息 与 归档体系

> 结论先行：**这两个功能我们不是"做得不好"，是根本没有。**上游的设计基本可以照抄思路，但**代码不能照抄**（新建 crate + 数据库迁移，而我们的迁移已经到 056，上游才 040/041，schema 早就分叉了）。

### 4.1 现状核对

**跨会话消息：完全没有。**
全仓搜 `session_message` / `cross_session` / `@@`，命中的只有 `markdownUtils.ts`、`diffUtils.ts`（无关）和 `dream_engine/history_sanitize`（无关）。

我们唯一沾边的是**团队邮箱**（`dream-core-team/src/mailbox.rs`），但它是按 `(team_id, agent_id)` 键控的 —— **严格team 内、agent 对 agent**。一个普通会话的 agent 没有任何办法够到另一个普通会话。

**归档：完全没有。**
侧边栏有置顶、手动未读、拖拽排序、重命名、删除（单条 + 批量）、搜索 —— 唯独没有归档。

这不是少了个装饰功能，而是：

> **`ConversationService::delete` 是硬删除**——删行、跑 delete hooks，并且在没有其他会话共享时**连自动开的 workspace 目录一起删**（`auto_provisioned_workspace_to_delete`）。
>
> 也就是说，用户想让侧边栏清爽一点，**唯一的手段是永久销毁会话，还可能带走工作目录里的文件。**

再叠加一条：`useConversationListSync.ts:336` 是 `getUserConversations.invoke({ limit: 10000 })` —— **一次性把最多一万条会话拉进渲染进程**，没有分页。重度用户每次启动都付这个代价，而唯一能缩小它的操作是不可逆删除。

> 补充一个准确的背景：上游的「后端驱动分组 + 分页」（#3969/#3983，08-11）**在 08-12 被他们自己 revert 了**，所以上游和我们在分页这件事上处境一样。`8d6f6cc` 的说明里也明说「左面板暂时留在旧读模型上，只有归档路径打通了端到端」。**别误以为抄了归档就顺便解决了分页。**

### 4.2 上游怎么做的（可抄的是设计，不是代码）

#### 归档（dream-core `8d6f6cc` + `7ac84f9`，dream-ui `18e4fddd` + `3fce329b`）

- 新建 `dream-ui-sidebar` crate（10 个文件）：聚合读模型、级联逻辑、ports、routes、service。
- 迁移 `040`：给会话和团队加 `archived_at` 列 + 按用户的排序表。
- **所有"活跃"查询加 `archived_at IS NULL`**，恢复路径走专门的变体，所以归档项始终可恢复。
- `7ac84f9` 补了关键一刀：**归档要像删除一样把 agent 进程停掉**。原来归档只翻 `archived_at`，agent 还在后台跑着、还在给一个用户已经移出工作区的会话推流。做法是加 `AgentKillReason::Archived`，从 `archive_conversation` / `archive_team` 提交后**尽力而为**地调用——拆不掉只 warn，绝不让归档失败。

**对我们最有价值的三点**（和代码无关，是设计判断）：

1. **归档 = 停运行时 + 留数据**。只翻标志位不停进程是个半成品 bug。
2. **拆进程失败不能让归档失败**（best-effort + warn）。
3. **恢复路径必须是独立查询变体**，不能靠在活跃查询上开洞。

#### 跨会话消息（dream-core `f2b490f` + `1c37366` + `1f511e5` + `9bfb2ad`，dream-ui `c83bc49e`）

语义定义得很干净：**一个 agent 给同一用户的另一个会话发消息，等价于用户打开那个会话按了发送**；收件会话自己起一轮，自己决定要不要回。

上游几个值得照抄的判断：

- **投递复用 `ConversationService::send_message`，不另写第二条发送路径。** 这让"跨会话投递 ≡ 人按发送"成为结构性事实，而不是要靠纪律维持。附带好处：拒绝 team 会话是免费的，因为那条路径本来就拒。
- **用 `send_message` 而不是 `run_agent_turn`。** 前者排上轮次就返回；后者要等整轮结束，一个目标就能把单线 drainer 堵几分钟。
- **固定 1 秒 drain tick，不做退避。** 退避在这里方向是反的：目标那轮跑得越久，等待就越长，结果正好在目标空出来的时候在睡觉。
- **排队由错误驱动，不由能力表驱动。** 一个"支持轮次中投递"的目标，如果它那轮正卡在确认卡片上，照样得排队——按能力表推断"支持 ⇒ 直接投递"会漏掉这个case。
- **固定校验顺序**，让同时命中多个拒绝条件的请求总是返回同一个码；**限流闸故意排在目标查询之前**，这样刷垃圾请求不会每次都付一次 DB 读。
- **取消和重启是不同意图**：用户点停止要清掉发给该会话的待投递（否则"停止"是假的，drainer 马上又把它叫醒）；运行时重启要保留，因为重启后会话回到 idle，而 idle 正是待投递在等的状态。
- **两个滑动窗口防风暴**：会话级出站 + 会话对之间的往返。触发时广播事件让 UI 能给出"停止"。
- **按用户的总开关**，默认开；关掉后投递、两个列表出口、`@@` 入口全关，但 `capabilities` 仍可用（它不碰任何会话数据）。

### 4.3 给我们的建议

**顺序：先归档，后跨会话消息。** 归档面窄、收益直接（现在唯一的整理手段是不可逆删除），而且它不依赖跨会话消息；反过来不成立。

#### 第一步：归档（建议做）

范围（我们自己的实现，不抄代码）：

1. `dream-core-db` 新迁移（我们的号段接 057）：会话加 `archived_at`。**先不做团队和排序表** —— 团队归档牵扯 team runtime，排序表我们已经有拖拽排序了，别一次吞两个。
2. 活跃查询加 `archived_at IS NULL`；恢复走独立变体。
3. **归档时停 agent 运行时**（照抄上游那一刀），best-effort，失败只 warn。
4. 前端：行菜单加「归档」，设置里加一个「已归档」页；**删除保留但降级为二级操作**。

风险点（必须盯）：

- 我们的 `delete` 会删自动 workspace，**归档绝对不能碰 workspace**。
- `list_associated`（fork 共享 workspace 的守卫）在归档路径上不需要，但**取消归档时要确认 workspace 还在**。
- 我们的侧边栏是一次性拉 10000 条，归档只是让这个数字变小，**没有解决分页**，别在收尾时把两件事混成一件说已经解决了。

#### 第二步：跨会话消息（建议先拿设计、暂不实现）

它比归档大一个量级：上游是 60 个文件 / 8520 行 + 新 crate（21 个文件）+ 迁移 + 一个 agent-facing CLI + 前端 87 个文件。而且它和我们自己的东西有真实冲突面：

- 我们有**团队邮箱**（team 内 agent 对 agent）。再加一套「会话对会话」的投递，就有了两套消息语义。**动手之前必须先决定这两套是合并、还是明确分层**（团队内走邮箱、跨会话走投递），否则会变成两个各做一半的系统 —— 这大概就是你说的"做得不好"的来源。
- 它需要一个 agent 能调的 CLI 表面。我们有 `one-config` 这条路（`"$ONE_HELPER_BIN" config ...`），扩一个 `session` 域是自然的，但那会**再加一条常驻注入的技能描述**，而我们刚把这块的预算压下去（见 A7）。

**建议**：这一步先只做一个决定 —— 团队邮箱和跨会话投递的关系。这个决定定了，实现路径才有意义；没定之前写代码一定返工。

> **已完成**：这个决定和完整设计写在 dream-core `docs/guides/design-cross-conversation-message-delivery.zh-CN.md`。
> 结论是**分层、不合并** —— 团队成员本身就是会话、团队投递也已经落在 `ConversationService` 上，但两者的**并发模型**（每 slot 独立循环 vs 共享 drainer）、**持久化语义**（`persist_user_message: false` + 投影 vs 必须成为真实用户消息）和**寻址权威**（有 leader 的编排 vs 无编排的对等）三条都相反，合并会同时弄坏两边。共享的是 `ConversationService`，不是投递层。

---

## 5. 本轮的验证状态（有一处没做完，明说）

- `dream-ui`：`tsc --noEmit` 干净；**全量 603 个测试文件 / 5642 个测试通过**（按 AGENTS.md 的要求核对过文件数，不是只看退出码）；`bun run format`、`check-i18n` 通过。
- `dream-core`：改动涉及的 crate 全部 `cargo test` 通过（`dream-core-session` 599、`dream-core-ai-agent` 1082、`dream-core-project` scm 134、`dream-core-auth` jwt 21、`dream-core-extension`）；`cargo fmt --check` 干净。
- **每一条 A 类修复都验证过"不打补丁时测试会红"**，不是只看绿。
- 渲染层整包 `electron-vite build` 通过（含新增的 wavedrom 依赖），WebUI 起得来、登录页正常渲染、13 种语言都在，控制台除了未登录的 401 没有任何导入/打包错误 —— 而且能看到新加的 `Failed to apply persisted font families / font weights` 在正常执行并优雅降级。

**没做完的**：登录之后那一遍真机点检没做。应用级 `remote-debugging-port` 开关早就从代码里删掉了（见 `docs/guides/cdp.md`），所以没法用 CDP 驱动真实界面；WebUI 这条路需要登录，而**代输密码不是我该做的事**。要补这一遍，需要人工登录后过一下：表格表头对齐、聊天里的 mermaid/WaveDrom 缩放、预览标签右键菜单、字体设置三个下拉、Explorer 全部折叠。

---

## 6. 明确没做、以及为什么

| 上游改动                                                             | 为什么不做                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat(skills)!` 技能交付改造（89 文件 + 迁移 043）                   | 破坏性变更，和我们自己的 SkillsHub / 仓库下载+用户导入 架构正面冲突。**但它要解决的问题值得单独查**：上游的动机是别把技能符号链接物化进用户的 git 仓库，我们 `constants.rs:111` 也有 `(".claude/skills", "claude")`，需要确认我们是不是也在往用户仓库里写东西 |
| `@@` 跨会话、sidebar 归档                                            | 见第 4 节，转调研                                                                                                                                                                                                                                             |
| `feat(auth)` 双 token + singleflight、account/secret CLI、解耦加密根 | 直接压在我们改造过的企业身份 / `one_user_org` / SSO 上，风险最高                                                                                                                                                                                              |
| `feat(conversation)` agent 驱动建会话 API                            | 新 API 面，没有明确收益                                                                                                                                                                                                                                       |
| Explorer tab 级刷新                                                  | 依赖我们 core 没有的 `fs/remount`，见第 3 节                                                                                                                                                                                                                  |
