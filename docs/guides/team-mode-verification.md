# Team Mode 验证报告（#18）

> 状态：2026-07-07 代码层验证。**运行时 E2E 未做**——需用户在桌面端实测，且完整多用户场景卡 D5（多用户企业组织环境）。
>
> 范围：fork AionUi `4c5ec67` + AionCore `6c398e6`（含 aionui-team crate）。

## 一、代码层验证结果

### 1. 前端入口链路 ✅

- `common/config/constants.ts:61` `TEAM_MODE_ENABLED = true` —— 团队模式默认开启。
- `Router.tsx:62` `/team/:id` 路由就绪，`TEAM_MODE_ENABLED` 为 true 时渲染 `TeamIndex`。
- `Layout.tsx:148` `/team/` 路径不显示侧栏（全屏团队页）。
- `Titlebar/index.tsx:222,404` Titlebar 识别 `/team/:id` 路径，渲染团队专属控件。
- `pages/team/index.tsx` 通过 `useSWR` 拉取 `ipcBridge.team.get.invoke({ id })`，加载后渲染 `TeamPage`。
- `Sider/TeamSiderSection` 在侧栏显示团队会话分组。

### 2. IPC 通道 ✅

`ipcBridge.ts:1955-2054` team 区块完整：

- CRUD：`create` / `list` / `get` / `remove`
- Session：`ensureSession` / `stop` / `activeLease` / `setSessionMode` / `getRunState`
- Agent：`spawnAgent` / `removeAgent` / `renameAgent` / `listAgents`
- Messaging：`sendTeamMessage` / `sendAgentMessage` / `listMessages` / `listAgentMessages`
- Run 控制：`cancelTeamRun` / `cancelAgentRun` / `pauseAgentRun`
- WebSocket 事件：`agentStatusChanged` / `agentSpawned` / `agentRemoved` / `agentRenamed` / `listChanged` / `created` / `removed` / `sessionChanged` / `taskChanged` / `run` / `runAck` / `runState` / `teammateMessage` / `mcpStatus`

### 3. 后端 aionui-team crate ✅

- `TEAM_CAPABLE_BACKENDS = ["claude", "codex", "gemini", "aionrs", "codebuddy"]`（`aionui-common/constants.rs:34`）—— 5 个 backend 支持 team。
- `team_spawn_agent` MCP 工具（`mcp/tools.rs:53` `SpawnAgentInput`）—— **要求 `name` 字段**（issue #3363 提到的"missing field name"已修复：`pub name: String` 非 Option）。
- `team_send_message` MCP 工具（`mcp/tools.rs:48` `SendMessageInput`）—— `to: String` 非 Option，支持 `"*"` 广播（`scheduler/actions.rs:132`）。
- 调度器 `SchedulerAction::SendMessage` → `handle_send_message`（`scheduler/actions.rs:131`）实现单播 / 广播。
- 任务看板 `team_task_create` / `team_task_update` 完整。
- 单测覆盖：`mcp/tools.rs` 内 `team_spawn_agent_schema_requires_name_and_assistant_id` / `team_send_message` parse 测试等。

### 4. 已知 issue 状态

| Issue | 描述                                                                    | fork 状态                                                                     |
| ----- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| #3363 | team_spawn_agent fails with 'missing field name' for non-ACP CLI agents | ✅ 已修：`SpawnAgentInput.name: String` 必填，schema 要求 name + assistant_id |
| #3428 | team_send_message behind_active_turn 消息抑制 & to 参数缺失             | ⚠️ `to: String` 必填已对；`behind_active_turn` 抑制逻辑需运行时验证           |
| #3389 | Team-owned conversation becomes unable to send after app restart        | ⚠️ 需运行时验证（涉及 session resume + mailbox 持久化）                       |
| #3525 | Team mode should not require non-standard mcpCapabilities.stdio field   | ⚠️ 需运行时验证                                                               |

## 二、运行时验证清单（用户实测时按此走）

### 前置

- 桌面端 `npm run restart`（不是 WebUI，避免 PATH 不全导致 claude CLI not found）
- 至少一个 provider 配好（建议先支持 function-calling 的模型，避开 #15 坑）
- 至少一个 TEAM_CAPABLE_BACKENDS 的 CLI 已安装（claude / codex / gemini / aionrs / codebuddy）

### 步骤

1. **创建 team**：侧栏 → 超级助手 → 协作看板 → 新建 team（或 `/guid` 内触发团队会话）
2. **spawn agent**：在 team 内 spawn 一个 agent（选 assistant + 可选 model）
   - 预期：agent 出现在团队面板，状态 `idle` → `running` → `idle`
3. **send message**：lead 给 agent 发消息
   - 预期：agent 收到消息并响应；消息列表显示双向消息
4. **agent 间通信**：spawn 第二个 agent，让第一个 agent `team_send_message` 给第二个
   - 预期：第二个 agent 收到消息（验证 `to` 参数路由正确，#3428）
5. **任务看板**：lead `team_task_create` → assign 给 agent → agent `team_task_update`
   - 预期：任务状态在团队面板同步
6. **重启恢复**：关闭 app → 重开 → 回到 team
   - 预期：团队会话恢复，消息历史可见（#3389）
7. **多用户场景**（卡 D5）：在多用户企业组织下，A 用户创建 team，B 用户加入
   - 预期：B 能看到 team，能 spawn agent，能收发消息

### 失败排查

- agent 不响应 → 先看 #15（模型是否支持 function-calling）
- `team_spawn_agent` 报 missing field → 检查 `SpawnAgentInput` 序列化（name 必填）
- 消息不到达 → 看 aioncore 日志 `mailbox.write` 调用 + `to` 字段值
- 重启后丢失 → 看 `SessionManager::load` 日志 + `.aionrs/sessions` 目录

## 三、本会话不做的事

- 不做运行时 E2E（需用户桌面端实测，且多用户场景卡 D5）
- 不改 team crate 代码（代码层验证通过，剩余 issue 需运行时定性后再改）
- 不补 #3428 `behind_active_turn` 抑制逻辑（需运行时复现确认当前行为是否符合 issue 描述）
