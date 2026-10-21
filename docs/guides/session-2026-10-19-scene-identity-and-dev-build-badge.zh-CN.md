# 2026-10-19：场景要让会话「知道自己在场景里」，DEV 版要一眼认得出

## 1. 场景会话里的模型不认场景

**现象**：从场景（如「数据分析与报告」）进入会话，问「你能做什么？」，模型答「我是 Agnes，由 Sapiens AI 开发」，再追问还是在罗列所有已装技能；用户看不出用场景和不用有什么区别。

**根因**：场景的规则（`preset_rules`）确实进了系统提示（dream-core `dream_engine.rs` 把它并进 `system_prompt`，引擎 `context.rs` 把它当一段 `custom` 追加在工具说明、工作风格之后），但内容只是一句「你是一名严谨的数据分析师」。它夹在很长的系统提示里，模型被问到「你是谁」时按训练出来的身份和全部技能作答，根本不提场景。没有写完整提示词的场景（尤其是旧服务端没下发 `intent` 的公司场景）最明显。

**修法（纯客户端，不用等后端发版）**：

- `sceneProtocol.buildSceneFrame`：在角色规则前加一层「身份」——这个会话来自场景「X」，用途是……；被问到「你是谁 / 能做什么」时要以这个场景作答，说出三到五件具体能接的事和需要用户先给什么，不要自称通用助手或底层模型名，不要罗列无关技能；场景有示例开场就一并写进去。`buildSceneRules` 现在是 `身份 + ## Your role in this scene + 角色`，开了「先问清」再接工作方法、硬性规则、交付。
- 会话里让人看得见区别：空会话的问候卡多了「和普通会话的区别」、**我的角色**、**工作方式**、**硬性规则**、**交付内容**（这几项只在场景「先问清」时才真的下发，所以问候卡也只在那时展示，不虚报）；标题栏多了常驻的**「场景」徽标**，点开是同样的内容，首条消息之后问候卡消失了也能随时查。数据写在 `conversation.extra.scene_greeting`（新增 `role` / `rules` / `deliverables`，旧会话没有这几项，界面自动略过）。
- 真机验证（DEV，deepseek-flash-vision）：「官网与 AI 助理搭建」场景里问「你能做什么？」，答「我是这个场景里的前线交付工程师（FDE）……先不写代码」，并列出该场景的五类具体工作和一句示例开场。

**没有覆盖到的**：公司场景在旧企业服务端拿不到 `intent`（不下发 discovery / 规则 / 交付），这些只能升企业镜像；身份层不依赖它，所以旧服务端下的场景至少会以场景身份作答。

## 2. DEV 版标识

用户既开发又使用，桌面安装版和 `bun run dev` 的 DEV 版长得一样，常常分不清。现在 DEV 版（`!app.isPackaged`）有这些标记，安装版没有：

- 托盘图标右下角红点（`devBadge.withDevDot`，在 32px 位图上画，不改原图）；托盘提示 `[DEV] One Work`；托盘菜单第一项（灰色）`[DEV] One Work`。
- Windows 任务栏图标红点叠加（`setOverlayIcon`）。
- 窗口标题 `[DEV] One Work`（`DocumentTitle`，`MODE === 'test'` 时不加，免得所有测试跟着变）。
- 标题栏右侧红色 `DEV` 胶囊。

**没真机看到的**：托盘右键菜单和任务栏红点是原生界面，没法用 CDP 截图；逻辑由单测覆盖（红点像素、非方形图标不处理、`isPackaged` 判定），标题栏胶囊和窗口标题在 DEV 里实测可见。

## 3. 托盘菜单一堆英文

**根因**：渲染进程没存语言时用 `navigator.language`（所以窗口是中文），主进程只读 `ProcessConfig.get('language')`，没存就停在默认 en-US——托盘菜单、系统对话框都是英文。`setInitialLanguage` 现在没存语言时回退到 `app.getLocale()`（`process/services/i18n/index.ts`），和渲染进程同一套回退；取不到系统语言就保持原样。

## 4. 同日顺带

- 员工页的 `<Spin>` 被全局 `.arco-spin { inline-flex; 居中 }` 收缩（见 `knowledge-library-handoff-2026-10-16` §10.16）。
- ⚠️ Bash 工具里 heredoc 写 Python 会吃掉反斜杠（`\n`、`\r` 变成真换行/回车），改含转义的源码要么用 Edit 工具，要么把脚本先用 Write 落盘再跑。

## 5. 10-20 追加：场景带项目文件夹、任务过程叙述

- **场景会话没法选本地项目文件夹**：`startSceneConversation` 之前把工作区写死成临时目录。现在首页输入框下方「在项目中工作」选的文件夹会带进场景（`workspace` + `custom_workspace: true`），场景网格的提示行会写「点击场景将在「xxx」文件夹中工作」，场景问候卡新增「工作目录」一栏（没选则说明用的是临时目录，以及怎么改）。**会话创建后目录不能再换**：后端 `local` 引用只收普通文件、不收文件夹，工作区也没有创建后修改的接口，所以必须在点场景前选好。真机验证：选 `onework测试` 后点场景，工作目录和右侧文件树都是该项目。
- **长任务没有实时叙述**：UI 本来就会把工具调用之间的文字逐条渲染（真机上看得到），缺的是模型不说话——dream-engine 的 `# Doing tasks` 写着「用户要的是结果，不是对话」。已加一条「工具调用前用一句话说要做什么，有发现后说一句学到什么，不要标题和列表，不要求许可」（dream-engine `5c30e02`）。真机验证（deepseek-flash）：一个多步任务里出现「我先看看根目录结构…」「Glob 结果被截断到 100 条，所以我改用系统命令…」「统计文件数返回 0，可能是链接类型…」等逐步叙述。
- ⚠️ **要进安装包**：这条在引擎里，dream-core 的 `Cargo.lock` 要指到 `5c30e02`，dream-core 发版并 bump dream-ui 的 `dreamcoreVersion` 之后安装版才有。本机 DEV 已用重编的 `dreamcore` 替换了 bundled 版本。
- ⚠️ 验证对话文字别用 `document.body.innerText`：Markdown 在 Shadow DOM 里，取不到；用截图或直接读 `/api/conversations/<id>/messages`。

## 6. 10-20 追加：问候卡重排 + 场景调用链路审查

- **问候卡排版**：原来是一长串竖排文字，现在是一张卡：标题 + 一行「和普通会话的区别」，下面「角色 / 方式 / 目录 / 技能 / 工具」用固定宽度标签列对齐，**硬性规则和交付内容默认折叠**（标题写明规则条数）；临时目录只留一句短话，完整说明放悬停提示里。头部「场景」徽标弹层复用同一个 `SceneDetails`。样式在 `SceneGreeting.module.css`，深色下折叠行是安静的分隔线而不是黑条。
- **审查出并已修的问题**：
  1. **首页已输入的文字和附件点场景后全丢**——现在带进场景发送框作草稿（`requestConversationSendBoxPrefill` / `Files`），不会替用户发送。
  2. **场景会话标题永远是场景名**，历史列表里一排同名行分不清——`useAutoTitle` 现在把「仍等于场景名」也当默认标题，首轮对话后改成首句摘要（`name_source: 'auto'`，用户改过的、agent 起的标题不动）。
  3. **点场景串行等两次读取**（技能列表、MCP 目录）——改 `Promise.all`。实测（真实后端）：`/api/skills` 12ms，创建会话 300ms，所以总耗时的大头是创建会话本身，不是前端。
- **审查后留给用户定的四项（用户已同意，下面第 7 节已做）**：
  - 每点一次场景就新建一个会话，没发消息也留着空会话（我测试时就攒了好几个同名的）。可以做成「复用该场景最近一个还没发过消息的会话」。
  - 场景管理页只能编辑、不能直接「用这个场景开始」。
  - 场景固定开 `dream` 类型会话，首页选的是 Claude Code / Codex 也一样；点场景前没有任何提示。
  - 公司场景每 30 秒轮询一次企业服务器（离开首页才停）。
- ⚠️ **本次又犯了一次「起第二个 DEV」**：见记忆 `never-start-or-kill-dev-without-checking-now`。需要 CDP 验证又不想碰你的 DEV，用 `DREAM_MULTI_INSTANCE=1` 起隔离 profile（`dream-ui-Dev-2`）。

## 7. 10-20 再追加：把「留给用户定的」四项做掉

- **复用空会话**（`sceneChat.startSceneConversation`）：每次开场景前先看「该场景上一个会话」是否仍是空的——存在、没有任何消息、名字还是场景名、**规则/技能/工具/文件夹/模型指纹一致**——是就直接打开它，不再新建；场景被编辑、换了文件夹或模型、对方已发过消息/被改名/被删，都新建。记录在 `localStorage` 的 `one-work:scene-empty-conversation:<sceneKey>`，任何查询失败都回退为新建。真机：连点三次同一场景，落在同一个会话 id。
- **场景管理页「开始对话」**：每行一个按钮，走 `navigate('/guid', { state: { openSceneKey } })`，首页的 `SceneGrid` 在列表加载后用 `autoOpenKey` **只开一次**（被首页关掉的场景也能从这里开）。模型、文件夹和打开逻辑仍只有首页这一份。
- **首页提示场景固定用 1ONE CLI**：选了 Claude Code / Codex 等别的引擎时，场景那一栏的提示行追加「场景固定用 1ONE CLI 打开，不受上方所选引擎影响」，选了文件夹时与文件夹提示并列。
- **公司场景轮询 30 秒 → 5 分钟**（仍有获得焦点时刷新）。
- ⚠️ 真机顺带看到、**没修**的：首页的默认模型取的是 provider 列表里第一个可用模型，而这份列表在「刚从别的页面跳回来（用缓存）」和「整页刷新（取最新）」时顺序可能不同，所以同一个场景从管理页打开和从首页点开，可能用到不同的默认模型（`my-personal-model` vs `openrouter/free`）。复用空会话的指纹里带了模型，所以不会把别的模型的会话错当成这个。根因在首页默认模型的选法，不是场景特有的问题。
- ⚠️ 隔离 profile（`DREAM_MULTI_INSTANCE=1` → `dream-ui-Dev-2`）里 `GET /api/conversations` 一直 500（后端 1ms 内失败，侧栏历史因此是空的），用户自己的 `dream-ui-Dev` 正常。那份库用了几个月、混过不同分支的二进制，怀疑某一行数据读不出来，没深查；验证场景会话时要用页面 URL 里的会话 id，别靠列表接口。

## 8. 10-20 深查：隔离 profile 的会话列表 500 + 首页默认模型不稳

### 8.1 会话列表 500 的真因：本机数据文件的一页坏了

- **现象**：`GET /api/conversations?limit=10000` 返回 500，侧栏历史是空的；`limit` ≤ 8 正常、≥ 9 就 500。
- **根因**：隔离 profile（`dream-ui-Dev-2`）的 `one-backend.db` 里 `conversations` 表有一页损坏——整库 `PRAGMA integrity_check` 报 `database disk image is malformed`，全表扫描读到第 9 行失败。10-11 的备份能通过检查，所以不是迁移引起的；第一次失败在 10-20 15:24，那段时间正好 C 盘写满（**物理原因没有证据，只是时间吻合，没法下定论**）。这个 profile 09-05 也坏过一次。
- **为什么之前"查不出来"**：后端 `ApiError::Internal` 的原因只留在内存里、不进日志，访问日志里只有 `Internal server error.`；启动期的损坏检测只在启动时的那条查询失败时才触发，而这种"启动能过、某张表某页坏"的库完全绕过它。前端又把失败吞掉、保留上一份列表（首次加载就是空），于是和"没有历史"看起来一模一样。
- **已修（dream-core `887f80e`）**：①访问日志新增 `error_cause`（Internal/BadGateway/Timeout 的私有原因，截断 400 字，响应体不变）；②`DbError::is_corruption` 成为"SQLite 说文件坏了"的唯一判据，启动恢复复用它；③`ConversationError::DatabaseCorrupted` → `503 DATABASE_CORRUPT`，不再是笼统的 500；④启动后台跑一次 `PRAGMA quick_check(1)`，坏了打 `DATABASE_FILE_DAMAGED`（带文件路径）。
- **已修（dream-ui）**：会话列表加载失败不再静默——侧栏出提示：普通失败给「重试」，`DATABASE_CORRUPT` 单独说「本机数据文件已损坏，数据没有被删除，请先别删数据目录」且不给重试（重试没用）。`useConversationListSync` 新增 `listLoadError` / `retryLoadConversations`；组件 `ListLoadErrorNotice`；文案 `conversation.history.{loadFailed,databaseCorrupt,databaseCorruptHint}` 13 种语言。
- **真机验证（新编的 debug dreamcore 对着损坏库的副本）**：启动即在日志里打出 `DATABASE_FILE_DAMAGED`，verdict 是 `Tree 103 page 103 cell 0: 2nd reference to page 868`（同一页被两处引用，即页面交叉链接）；`GET /api/conversations?limit=10000` 返回 `503 {"code":"DATABASE_CORRUPT"}`，访问日志 `error_code="DATABASE_CORRUPT"`。页面被重复引用更像是**两个写入者同时改一个文件**或写入被截断，而不是单纯"读坏了"；这个 profile 当天确实发生过两个 dreamcore 抢同一数据目录，但**没有直接证据**把两者连起来，别当结论用。
- **抢救这份库**（按行读，遇坏页停）：新建空库、照搬原库 schema 与 `_sqlx_migrations`，逐表拷贝可读行，会话/消息缺的部分用 10-11 备份 `INSERT OR IGNORE` 补齐，结果 18 个会话、`integrity_check` ok。原件保留为 `one-backend.db.corrupt-1020` / `-wal.corrupt-1020` / `-shm.corrupt-1020`。脚本在 scratchpad `salvage-1020/salvage.py`。⚠️ `text_factory=bytes` 会让 CHECK 约束全挂（bytes ≠ text），要用解码函数。

### 8.2 首页默认模型不稳：默认值是"挂载那一刻的第一个"

- **根因**：`useGuidModelSelection` 的默认值取"挂载时 provider 列表里第一个可用模型"，之后只要它还可用就**永远不动**；`persistPreference` 参数根本没用上。所以同一个 App，列表还没加载全时挂载的页面会停在先到的那个（`openrouter/free`），整页重新挂载的页面则是此刻的第一个（`my-personal-model`）。
- **改法**：默认值变成"此刻的列表 + 用户上次手动选的那个"的纯函数——上次手动选的还在就用它，不在就用第一个；还处于"自动默认"状态时，列表变了会跟着重算；用户手选、助理默认（`persistPreference: false`）不会被挪动，也不会被记成用户的选择。记录在 `localStorage` 的 `guid.lastPickedModelKey`，只有首页无助理时的手选才写入。

## 9. 首页引擎胶囊条：最多 5 个 + 「更多」

- 之前把所有已安装的 CLI（含 Cursor、Pi 等未激活的）一字排开，条被撑得很长。现在 `splitBackendPills`（`pages/guid/utils/backendPills.ts`）只露 5 个，其余收进「更多 N」下拉。
- **排序**：用「助手与专家 → 已启用」里拖拽出来的顺序（`assistants.enabledOrder`，首页胶囊条此前没读它，只按内置 `sort_order`），没设过就走旧顺序；**能用的在前、未激活的排在后面**，所以露出来的 5 个都是能点的；当前选中的引擎永远可见（原本落在「更多」里就顶掉最后一个位置）。
- 下拉里未激活的引擎置灰不可选，悬停显示原因；列表超过 360px 高度可滚动。

## 10. 过程行折叠：一串「思考完成 / View Steps」变成一行

- **问题**：agent 每想一下、调一批工具，对话里就多两行灰字（「思考完成 · 0秒」「View Steps · 2」），长任务里整屏都是，和正文叙述混在一起，远不如 WorkBuddy 那种「文字叙述在外、过程在内」的观感。
- **改法**：`foldProcessRuns`（`Messages/processRuns.ts`）把**两个以上连续的思考/工具组**折成一个 `process_run`，由 `MessageProcessRun` 渲染成一行：进行中显示**正在做的那一步**（运行中的工具名+描述，没有就用当前思考的主题，再没有就「正在处理…」）+ 已用时间 + 共几步；完成后显示「已完成 N 个步骤」。点开才看原来的逐条思考和工具详情。agent 自己的文字、文件变更、提问、权限请求都会**断开**一个过程段，所以叙述文字始终在外面。落单的一步保持原样。
- 顺带把写死的英文 `View Steps` 改成 i18n（`conversation.process.viewSteps`）。
- 真机（隔离 profile 的历史会话）：连续 10 步折成「已完成 10 个步骤」，展开后还是原来的明细。**进行中的实时那一行没在真机看**（没有跑着的长任务），只有单测覆盖。
- ⚠️ 叙述文字本身（agent 在干活间隙说一句「我在做什么」）来自引擎提示词，是模型是否照做的事，折叠只解决「过程行太吵」；这部分要进安装包仍需 dream-core 发版并 bump pin。
