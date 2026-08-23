# PDF 导出 Agent 不选用 export_to_pdf + 团队成员 Provider 'aionrs' not found 修复（2026-07-13）

> 本轮修的两个 bug 都**独立于**同一天更早的 max_tokens/PDF 导出搬运/13 助手改名那几件事（见 `round23-maxtokens-pdfexport-rebrand` 记忆条目），是用户实测时发现的**第二批**问题。三仓改动均已提交推送。

## 问题 1：PDF 导出重启后仍然走 PowerShell 兜底，不调用 export_to_pdf

**症状**：`export_to_pdf` MCP 工具已注册、已连接（设置 → MCP 服务页面绿勾，工具描述完整），完整重启桌面应用后仍然复现——Agent 主动调用 `ToolSearch{"query": "export_to_pdf"}`，得到 `No deferred tools matching "export_to_pdf" found.`，误判工具不存在，转而用 `ExecCommand`(PowerShell) 兜底。

**根因**（在 **aionrs-local** 仓库，不在 1oneUI/1oneCore）：`export_to_pdf` 是 1oneCore 每会话动态注入的 MCP server，aionrs 侧把所有动态注入的 server 硬编码为 `deferred: Some(false)`（`aion-cli/src/json_stream/pre_message.rs`）。`deferred=false` 意味着完整 schema 每轮都直接发给模型——它本来就能直接调用，完全不需要 ToolSearch。但 `ToolSearchTool::execute()`（`aion-tools/src/tool_search.rs`）只在 `deferred=true` 的池子里搜，`export_to_pdf` 必然搜不到，误导性的 "not found" 文案让模型以为工具不存在。

**修复**（`aionrs-local` commit `f06eb40`，已推 origin/master）：只改文案，不改匹配算法/索引机制：

- `tool_search.rs` 的 "not found" 结果补一句：如果这个工具名已经出现在可用工具列表里，直接调用，不需要再搜。
- `context.rs` 系统提示词补一句：大多数工具不是 deferred 的，已经带着完整参数出现在列表里，可以直接调用。

**已知但本次不修的相关 bug**（记录备查）：`ToolSearchTool` 的候选池是 `AgentBootstrap::build()` 结束时对 registry 的一次性值拷贝快照，早于动态 `AddMcpServer` 连接——任何**真正 deferred=true 的动态工具**理论上也搜不到。这个不影响 `export_to_pdf`（它本来就是 deferred=false），风险/收益不对等，本次不修。

**生效方式**：aionrs-local 是 `1oneCore/Cargo.toml` 的 git 依赖（`branch=master`），改完在 1oneCore 跑 `cargo update -p aion-agent`（会连带更新 `aion-tools` 等同源 crate），然后照常重编 `aioncore.exe`（`backend-rebuild.ps1`）才会生效——**这不是 spawn 的独立子进程，是直接编译进 aioncore.exe 里的**，之前以为要单独找"aionrs 二进制怎么被 spawn"是错的方向。

## 问题 2：团队成员重建报错 Provider 'aionrs' not found

**症状**：用户自己创建的团队"团队测试3"里，"PPT 演示助手"这个成员重建/warmup 时报 `failed to attach rebuilt agent ... Provider 'aionrs' not found`。

**根因链**：

1. 前端 `teamCreateModelResolver.ts` 的 `resolveAionrsDefaultModel()` 在助手没有显式配置模型时，硬编码返回字面量字符串 `"default"`（代码注释自己承认是已知技术债 mnemo #297）。
2. `teamMapper.ts` 的 `toBackendAssistant` 有 `model: a.model || 'default'` 同一 bug 模式的第二处兜底。
3. 后端 `provisioning.rs::create_team_conversation_for_agent`：`resolve_provider_for_model("default")` 遍历所有 provider 找"models 列表里有没有字面量 default"，必然找不到，`.unwrap_or_else(|| backend.to_owned())` 把 `backend`（值是字符串 `"aionrs"`）当 provider_id 使用，**永久写入**这个 teammate 对应 conversation 的持久化行。之后每次 rebuild/warmup 都读回这份坏数据，必然复现。

**修复**（1oneCore + 1oneUI，均已提交推送 one-main）：

- `crates/aionui-team/src/provisioning.rs`：`unwrap_or_else` → `ok_or_else`，解析不到 provider 时直接返回 `TeamError::InvalidRequest`，不再伪造 provider_id 写坏数据。
- `crates/aionui-app/src/router/team_conversation_adapters.rs`：`map_conversation_update_error` 给 `ConversationError::BadRequest{reason}` 加一个字符串前缀匹配分支（`is_stale_provider_binding`），识别 "Provider '...' not found" 这类历史脏数据触发的报错，转成"该团队成员未配置有效模型，请移除后重新添加"这种可操作提示，而不是泄露内部实现细节。**这是启发式字符串匹配，不是类型化错误变体**——`AgentError::BadRequest` 是各处校验共用的通用字符串错误，做成类型化变体要跨 crate 穿透错误类型，本次判断改动面不值当，未来如果这类"字符串前缀识别"场景变多可以考虑。
- `packages/desktop/src/renderer/pages/team/components/teamCreateModelResolver.ts`：`resolveAionrsDefaultModel()` 改成真的查 `ipcBridge.mode.listProviders.invoke()`，取第一个 enabled 且有 enabled 模型的 provider，解析不到就**抛错**（两个调用方 `TeamCreateModal.tsx`/`TeamAddMemberPopover.tsx` 早就有 try/catch 会展示成 `Message.error`，不用改 UI）。
- `packages/desktop/src/common/adapter/teamMapper.ts`：去掉 `|| 'default'` 兜底，直接透传 `a.model`。
- `resolveAcpDefaultModel`（ACP 后端分支）**没动**：ACP 走 `backend.to_owned()` 直接当 provider_id，不经过会失败的 `resolve_provider_for_model`，字面量 "default" 对 ACP 无害，不在这次 bug 范围内。

**不做的事**（用户已确认）：不做"团队测试3"里那个已经写坏的"PPT 演示助手"历史数据自愈——用户自己手动删除重加即可，重加时会走已修复的解析逻辑，得到真实 provider_id。

## 顺带发现但本次不修的第三个问题（用户已确认暂缓）

用户实测 PDF 导出时，1ONE 管家（内置预设助手）自己诊断"因为 `enabled_skills` 不包含 `one-export-pdf`"——**这个归因是错的**，`enabled_skills` 只管 skills（markdown 技能包）系统，和 MCP server 绑定是两套完全独立的机制，代码上没有任何交集。

但**症状本身大概率是真的**，真根因是：`builtin: true` 标记的 MCP server（`one-export-pdf`、图片生成都是）不会像普通 MCP 那样"全局 enabled 就默认给所有助手"，必须出现在**该助手自己的 `defaults.mcps` 绑定**（fixed 列表，或退化成 `preferences.last_mcp_ids`）里才会真正塞进会话。内置预设助手（`BuiltinAssistant` struct / `assistants.json`）目前**没有任何 MCP 相关字段**能声明"这个预设助手默认应该用 MCP server X"，所以新增的 `one-export-pdf` 不会自动出现在 1ONE 管家这类已有预设助手的默认绑定里——对新增的 builtin MCP server 来说，这个缺口对所有内置预设助手都存在，不只是 1ONE 管家。

修法思路（下次处理时参考）：给 `BuiltinAssistant`/`assistants.json` 加一个类似 `default_mcp_ids` 的字段，仿照现有 `enabled_skills` 的穿线路径（`builtin.rs` → `aionui-assistant/src/service.rs` 里 `default_skill_ids` 那套序列化/合并逻辑）接入 `AssistantDetail.defaults.mcps`。

## 三仓提交索引

| 仓           | commit                                          | 内容                                                |
| ------------ | ----------------------------------------------- | --------------------------------------------------- |
| aionrs-local | `f06eb40`                                       | ToolSearch/system prompt 文案澄清                   |
| 1oneCore     | provisioning.rs + team_conversation_adapters.rs | provider 解析失败报错而非伪造 + 友好错误文案        |
| 1oneUI       | teamCreateModelResolver.ts + teamMapper.ts      | 真实解析 aionrs 默认模型，不再落地 "default" 占位符 |

（具体 commit hash 见对应仓库 `git log one-main`/`git log master`。）
