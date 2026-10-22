# 2026-10-22 团队作战耗时分析 + 添加成员看不到专家

用户反馈两件事：①团队作战任务耗时很长；②创建团队/添加成员时只能看到 Agent（CLI），看不到专家助手。

## 1. 添加成员看不到专家（dream-ui，已修，`29e5a2eb`）

**根因**：两个选择器（团队页「添加成员」、新建团队弹窗）的数据源是
`useConversationAssistants().presetAssistants`，即「已安装 + 已启用」的助手。

- 专家市场的 252 位专家**只有在搜索框里打字时**才会被 `mergeWithMarketplaceMatches` 合并进来；
- 官方模板（Word/PPT/Excel 助手等 20 个）出厂是 `enabled: false`，被 `selectableAssistants` 过滤掉，**搜也搜不到**；
- CLI（`source: generated`）排在最前面——dev 机上 17 个，其中 9 个因未登录/握手失败不可用，照样占着前排。

实测 dev 机 `/api/assistants` 返回 38 条，全是 CLI 和内置助手，一个专家都没装。用户打开下拉看到的就只有 Agent，
自然得出「专家不能进团队」的结论。数字员工绑定那边（`EmployeeBindingFields`）早就是「整个目录直接展示、点一下自动添加」，
团队这边没跟上。

**修法**：

- `buildTeamMemberCatalog`（`pages/team/components/assistantSelectUtils.tsx`）一次给出完整目录：
  智能体（可用的在前，不可用的沉到分组末尾）→ 已启用的专家 → 未启用的官方模板 → 专家市场未安装的专家；
- 选择器加「全部 / 专家 N / 智能体 N」切换和分组小标题，搜索同时匹配名称和简介（搜「安全」能找到安全工程师）；
- `useTeamAssistantOptions().adoptAssistant`：未启用的官方模板 → `setState(enabled)`；市场专家 → `install`；然后加入团队。
  原来的 install-only 路径对官方模板会直接失败。

真机（dev，CDP）：下拉显示「智能体 · 17 / 专家 · 273」；新建团队弹窗切到专家、点未启用的「Star Office 助手」→ 后端
`enabled` 变 true 并进入已选成员（验证完已恢复成未启用）。

## 2. 团队作战为什么慢——用真实运行数据量出来的

数据来源：dev 库（`dream-ui-Dev/1one/one-backend.db` 的副本）里 4 个团队的 `mailbox` 时间线 + 每个成员会话的 `messages`
时间线（工具调用、思考、输出逐条带时间戳）。下面的秒数都是相对团队创建时间。

### 2.1 新成员先空跑一轮「我已就位」（已修，后端）

Leader 调 `team_spawn_agent` 后，后端给新成员写一条 *"You have been spawned as a teammate. Read your mailbox and wait for
instructions."* 并唤醒它。成员于是完整跑一轮：读信箱 → 发「收到，已就位」→ 结束。这条确认又会唤醒 Leader。

炒股咨询团队：135.4s 拉了 3 个人 → 144.9~145.6s 三条「已就位」→ 160.3s 才派出第一个任务；每个成员这一轮约 10 秒
（K线专家 137.0→147.8s）。股票资讯团队更典型：用户手动加的成员回「已就位」→ 唤醒 Leader → Leader 整轮只回了一句「请待命」。

**修法**（`dream-core-team/src/session.rs`）：Leader 拉人不再写欢迎消息；用户手动加人的欢迎消息照常显示给用户，但**写入即已读**、不入队。
成员的第一轮就是 Leader 的第一个任务（角色提示词本来就在首次真正唤醒时注入）。

⚠️ 只「不入队」是不够的：`reconcile_mailbox_snapshot` 会把**任何没有工作意图的未读消息**转成 `RecoveryDrain` 唤醒，
欢迎消息只要还是未读，下一次调度照样会把成员叫起来空跑。

### 2.2 依赖任务每一跳都绕回 Leader 一整轮（已修，提示词）

任务板早就支持 `blocked_by`：上游任务 `completed` 时，`exec_task_update` 会自动唤醒下游负责人
（`mcp/server.rs` `maybe_notify_task_owner(..., "unblock")`）。但 Leader 提示词里那段
**「Sequencing Dependent Work (CRITICAL)」写于这个能力之前**，要求「先派 A，等 A 汇报，再派 B」。

炒股咨询团队：K线专家 309.5s 完成 → Leader 被唤醒、重查成员和消息、再派任务 → 342.9s 量化分析师才开工，**一跳 33 秒**，
而且这段时间所有人都在等 Leader。

**修法**（`dream-core-team-prompts/src/role_prompt.rs`）：一次性建好整个计划，独立任务分给不同成员并行；有依赖的任务
在同一轮用 `blocked_by` 建好，由任务板在上游完成时自动启动下游，Leader 不必中转。仍然保留「别给 B 下『等 A 做完』的指令」
这条（会挂在打开的流里撞服务商超时）。工具说明里 `blocked_by` 的描述也改成「上游全部完成时自动唤醒负责人」。

### 2.3 每一轮都有固定的冗余工具调用（已修，提示词）

提示词要求 Leader「每次派活前调 `team_members`」「结束前、派活前各调一次 `team_read_messages`」，成员也被要求结束前读一次信箱。
但**唤醒消息里本来就带了新消息和任务板**（`prompts/mod.rs` `build_wake_payload`），而本轮期间新到的消息会在下一次唤醒时投递，
结束本轮不会丢。每个工具调用都是一次完整的模型往返：Leader 第 3 轮 327.8~332.3s 就花在重查成员和消息上，第 2 轮 172.6~176.5s 同理。

**修法**：`team_members` 只在首轮和成员可能变化时调；开头不再重查消息和任务板；不再要求结束前读信箱。

### 2.4 Leader 不并行派活（提示词已加引导）

游戏创作小组：4 个成员只派了 1 个任务，其余人闲着，直到用户说「其他成员也分配点任务」；炒股咨询团队拉了「研究看板制作员」却一直没给活。
提示词原来只讲怎么派，没要求一次把计划建完、把独立任务并行分出去。现在 Workflow 第 13 步明确了。

### 2.5 不是我们能省的时间

- 成员干活本身：K线专家写 996 行文档 166.9→297.3s（130s 纯生成），这是模型速度。
- 首轮 `ToolSearch`：Leader 第一轮先调了一次 `ToolSearch` 找 `team_*` 工具（22.3→33.7s），随后自己说「工具其实已经直接可用」。
  **未核实**原因（可能是 dream 引擎延迟加载工具的提示让模型多此一举），需要抓一次引擎侧的工具列表再下结论。

## 3. 留给产品决定的

**阵容确认回合**：Leader 遇到「需要加人」时必须先发阵容表、结束本轮、等用户回「同意」才拉人（提示词 Workflow 5~11 步）。
数据里这一来回是 18→97.8s（炒股）、13.5→44.4s（股票资讯），包含一整轮 Leader 和用户阅读回复的时间。这是产品行为，没有动。
可选方向：用户在需求里已经点名成员或说了「直接开干」时跳过（现在已有这个例外，但模型不总是认），或给团队加一个「自动组队」开关。

## 4. 验证

- dream-ui：`tests/unit/renderer/team` 37 文件 229 测试全过；`tsc`、`check-i18n`、全量 `lint`（退出码 0）通过；CDP 真机见 §1。
- dream-core：§2.1~2.4 的改动在 worktree `D:\dream\scratchpad\team-latency-core`（基于 origin/main），**尚未提交**；
  `cargo nextest -p dream-core-team -p dream-core-team-prompts -p dream-core-api-types` 已在后台启动，结果未确认。
  通过后再提交推送、编 release 放进 bundled 目录；进安装包还需 dreamcore 发版并 bump pin。
