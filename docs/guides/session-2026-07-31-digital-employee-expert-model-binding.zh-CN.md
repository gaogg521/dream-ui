# 2026-07-31 数字员工接上专家库与模型（修 `Provider '' not found`）

> 起因：用户真机截图三个问题——①协作看板一直显示「知识库未就绪」②数字员工运行历史里全是 `Provider '' not found`
> ③创建弹窗的 Agent 类型下拉写着内部代号 `Aionrs`，而且**没有地方选专家**。
> 用户一句话点破根因：「我以前理解为用户选择了 AGENTS 就会自动调用模型，但是感觉会给用户误导。」

## 一、三个问题的定性

| 现象                        | 定性                              | 根因                                                                                                                                                                                                        |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 「知识库未就绪」            | **不是 bug，是文案误导**          | `useCollaborationContext.ts:41` 就是 `ragReady = ragDocuments.length > 0`。项目组知识库 0 篇 → 灰标。「未就绪」读起来像功能坏了，实际语义是「你还没上传」，而同一行的「暂无 Skills / 暂无 MCP」没有这个歧义 |
| `Provider '' not found`     | **真 bug，aionrs 员工 100% 必挂** | 见下方链路                                                                                                                                                                                                  |
| 下拉写 `Aionrs`、不能选专家 | **真缺口**                        | `CreateAgentModal.tsx` 硬编码三个裸字符串，不走 i18n、不走 agent registry；后端 `provision_run` 硬写 `assistant: None`                                                                                      |

### `Provider '' not found` 的完整链路（每一环都核过代码）

1. `CreateAgentModal` 没有模型字段
2. `one-employee/service.rs` 建会话时硬写 `model: None`
3. 会话表 `model` 列存 NULL
4. `aionui-conversation/task_options.rs:42` 把 NULL 解析成哨兵值 `provider_id: ""`
5. `aionui-ai-agent/factory/aionrs.rs:81-87` 拿空串查 provider → 查不到 → 报错

`task_options.rs:35-41` 的注释**把这个报错写成了预期行为**——哨兵设计假定「调用方一定会给 model」，数字员工这条路径从来没接上。
ACP 后端（claude/gemini）不受影响：`acp::build` 的 `FactoryContext`（`factory/context.rs:8-13`）结构上就没有 model 字段。

**误导的真正来源**：三个选项塞在同一个下拉里，但语义不一致——Claude/Gemini 自带模型（走 CLI 账号或桥接），aionrs 必须显式给 provider + model，UI 却毫无提示。

## 二、照抄定时任务，不另造轮子

定时任务（cron job）是形态最接近的已解决案例，前后端都成熟，本轮逐条复用：

| 关注点                                | 定时任务既有实现                                                                                          | 本轮                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 只有 aionrs 带顶层 model              | `aionui-cron/executor.rs:965-970` `resolve_model()`                                                       | 逐字照搬进 one-employee                                       |
| 人设 → `AssistantConversationRequest` | `executor.rs:1070-1090` `build_assistant_request()`（`assistant_id` 优先、legacy `custom_agent_id` 兜底） | 照搬，顺带让写死不读的 `custom_agent_id` 列**第一次有了意义** |
| 有人设时 `r#type` 必须为 None         | `executor.rs:553`                                                                                         | 必须照做，否则人设的后端绑定不生效                            |
| 弹窗 UI：选人设→派生后端→条件显示模型 | `pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx`                                                      | 作为 `EmployeeBindingFields` 的模板                           |

**硬约束（已核实）**：`aionui-conversation/service.rs:795-802` —— 顶层 `model` **只允许 aionrs**，其他类型传了直接 400。

**后端手动覆盖的唯一通道**：有 `assistant` 时 `r#type` 被忽略，effective type 由人设快照推导。覆盖必须走 07-28 加的
`AssistantConversationOverridesRequest.agent_id`（`aionui-api-types/conversation.rs:44-49`，doc 注释原文就点名 "1ONE CLI"），
优先级见 `aionui-conversation/service.rs:1473-1477`。

## 三、⚠️ 中途被用户纠正的一次理解偏差（重要）

第一版把「专家」下拉喂成了 `useConversationAssistants` → `selectableAssistants`，结果真机上只有 3 条：Claude Code / 1ONE CLI / 1ONE 管家。
用户当场指出：**「我们口头说的专家是指侧边栏里面官方助手和专家市场 252」**，而那 3 条是 CLI 助手。

实测数据坐实（fresh DB）：

| 分组                                 | 数量                | 第一版下拉里        |
| ------------------------------------ | ------------------- | ------------------- |
| `generated` CLI 助手                 | 4（2 个过安装过滤） | ✅ 有（**不该有**） |
| `builtin` 官方助手 enabled=true      | 1                   | ✅ 有               |
| `builtin` 官方助手 **enabled=false** | **21**              | ❌ 被滤掉           |
| 专家市场 personas                    | **252**             | ❌ 只在搜索时合并   |

两个根因：

1. `selectableAssistants`（`utils/model/assistantSelection.ts:70`）按 `enabled !== false` 过滤，21 个未启用的官方助手全被滤掉
2. `mergeWithMarketplaceMatches` 是**只在搜索时**才合并市场目录的策略（团队成员选择器的设计）

**修正后的语义**（用户拍板）：

- 「专家」= 官方助手 + 专家市场 + 用户自建/导入人设，**默认全量可浏览**（275 条 = 1 + 22 + 252）
- **裸 CLI 不再作为「专家」出现**——它本质就是后端，已经有独立的「运行后端」字段。这正是第一版读起来像「CLI 助手列表」的原因
- 新增显式的**「不指定专家（仅用运行后端）」**选项，保留「就要个裸 CLI + 我自己的运行指令」这种员工
- 选中未启用的官方助手 → **自动启用并选中**（`ipcBridge.assistants.setState({enabled:true})`，照抄 `useTalkToButler.ts:60`）；选中未安装的市场专家 → 自动安装并选中

## 四、改了什么

### 后端（1oneCore `crates/one-employee`）

- **迁移 `004_persona_and_model.sql`** + 账本条目 `employee_004_persona_model`，四列：
  `assistant_id` / `agent_id_override` / `model_id`(ACP) / `model`(aionrs 的 ProviderWithModel JSON)。
  `agent_type` 列保留，继续存**生效后端**，仍是 model 的门控依据
- `provision_run()` 核心修复：`resolve_model()` + `build_assistant_request()` + `r#type = assistant.is_some() ? None : Some(...)`。
  **一处修复覆盖全部 4 个建会话入口**（手动运行 / devops 派发 / devops 拆解 / cron 扫描——已核实都走同一个 `provision_run`，
  employee 的定时路径没有第二套模型解析）；`run_now_team` 复用团队会话，不受影响
- `validate_model_binding()` 三条保存期规则：aionrs **必须**有模型（否则又会退回 `Provider '' not found`）、
  非 aionrs **不许**带顶层 model（否则撞 795 那条 400）、模型必须来自**已启用**的 provider
  （参照 `aionui-team/provisioning.rs:702-714`）。第一条只在请求真的动了绑定时才强制，
  所以**改名一个 004 之前的存量员工不会被拦**
- `update` 端点扩到可改 `agent_type`/`assistant_id`/`agent_id_override`/`model_id`/`model`（空串=清空）
- `EmployeeService::with_provider_repo()` 走既有 `with_team_session` 的可选 builder 套路，未接线时降级为只做形状校验

### 前端（1oneUI）

- 新增 `hooks/useEmployeeAgentBinding.ts`——专家 × 后端 × 模型的单一真相，Create/Manage 两个弹窗共用，防止两条路径漂移。
  后端默认跟随专家、手动改一次后**一次性闩锁解耦**（照抄 Guid 页 `backendOverriddenRef`）
- 新增 `components/EmployeeBindingFields.tsx`——复用 `TeamAssistantPickerDropdown` + `assistantSelectUtils`（专家选择器）
  和 `GuidModelSelector`（模型选择器，已被 `CreateTaskDialog` 证明可在无关 Modal 里直接用、不需要 `conversation_id`）
- 新增 `utils/employeeDisplay.ts`——品牌名解析（catalog 里 aionrs 那行**就是** `1ONE CLI`，迁移 019 设的，**永远不要硬编码 label**）
  - 运行错误友好化
- `CreateAgentModal` 重写、`ManageAgentModal` 支持编辑绑定、`AgentsTab`/`DigitalEmployeeDetailModal` 不再裸渲染 `agentType`
- `CollaborationContextPanel` 文案「知识库未就绪」→「知识库为空，去上传」，并让标签可点击直达上传
- i18n **13 语言全填**；删掉不再使用的 `fieldAgentType`/`expertRequired`/`pickExpertPlaceholder`

## 五、验证

- `cargo test -p one-employee` **17 绿**（含迁移四列断言 + 绑定序列化/兜底/覆盖等 9 条新用例）
- 前端 `tsc` / `lint`(0 error) / `check-i18n`(exit 0，`i18n-keys.d.ts` 已同步) 全过
- 新增 `tests/unit/renderer/superAssistant/` **23 绿**（含「裸 CLI 不得出现在专家列表」「未启用官方助手走 setState 而非 install」两条回归锁）
- 全量 `bun run test`：**309 通过 / 7 失败**，与改动前**逐文件一致**（通过数 2366→2370，+4 是本轮新增）。
  那 7 个失败文件对本轮改的模块**零引用**、文件本身也未被本轮碰过，失败断言是拖拽手柄 / About 更新态 / GuidActionRow 搜索框 /
  设置侧栏 / AssistantSettings 编辑器 / 已死组件 `assistant-selection-area`，属工作区里并行会话的在途改动
- **真机端到端（29 条断言全绿）**，脚本直连后端 HTTP API + 用 `node:sqlite` 读真实库核对落库：

  **核心判据**——同一条路径上报错从 `Provider '' not found` 变成
  `Aionrs agent error: Provider error: HTTP error: error sending request for url (http://127.0.0.1:59999/v1/chat/completions)`，
  即 provider 查找与模型解析都成功，失败点前移到真实网络调用（占位 provider 指向死端口，本该如此）。
  另核对：会话行 `model` 列非空且 `provider_id` 正确 / ACP 员工 `model` 列恒为 NULL（守住 795 的 400）/
  后端覆盖真的把会话 type 翻成 `aionrs`（证明 `conversation_overrides.agent_id` 生效）/ 编辑改模型落库 / 存量 backend-only 员工照常

- **真机 CDP UI 验证**：专家下拉 275 条、裸 CLI 不在列、官方助手与市场专家同列、搜索「安全」命中 4 个真专家、
  未选专家时后端可选、选中专家后后端自动派生为「1ONE CLI」且模型选择器随之出现

### ⚠️ 验证环境的一个坑（不是本轮引入）

用本机真实 dev 数据目录起不来，后端报 `Migration failed: migration 19 was previously applied but has been modified`
——那是 `aionui-db` 的 sqlx 账本（我的迁移在 one-employee 的独立 `_one_migrations` 账本里，与之无关），
对应工作区里并行会话正在改的 `.gitattributes` / `database.rs` 行尾校验和问题。
绕开方式：项目自带的 E2E 隔离（`AIONUI_E2E_TEST=1` + `AIONUI_E2E_USER_DATA_DIR=<临时目录>`，
`configureChromium.ts:22-26` 的注释写明它就是为「共享 DB 迁移失败导致后端拒绝启动」准备的）。

## 六、遗留 / 相邻问题（本轮明确不做）

- **团队路径的友好错误已失效**：`team_conversation_adapters.rs:570-572` 的 `is_stale_provider_binding` 只匹配
  `ConversationError::BadRequest`，但 warmup 现在走**类型化**的 `ConversationError::ProviderNotFound`
  （`aionui-conversation/error.rs:80-81`），落进 `other =>` 分支直接透出原文。单测是手搓 `BadRequest` 所以测不出来
- `pages/guid/components/AssistantSelectionArea.tsx` 是无引用死代码
- `extra.one_employee_id` / `one_employee_owner`（`service.rs:537-541`）全仓无读取方
- 未打包
