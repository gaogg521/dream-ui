# ACP / Aion CLI 工具调用失败静态分析（#15）

> 状态：2026-07-07 静态分析。**未做运行时复现**——需用户换支持 function-calling 的模型定性。
>
> 范围：fork AionUi `4c5ec67` + AionCore `6c398e6`（含 one-\* crates）。
> 参考 issue：`#3419 Aion Cli no Response`、`#2648 Aion CLI 中无法连接到智谱的模型`、`#3247 Cannot use custom model providers (DeepSeek) — Only Aion CLI supported`、`#2728 飞牛安装 linux 版本后 Aion CLI 报错`、`#3087 和 aion cli 对话，经常卡死`。

## 一、调用链概览

1. 渲染层 `pages/conversation/platforms/acp/useAcpMessage.ts` 通过 `runtime.ensureRuntime` → `POST /api/conversations/:id/runtime/ensure` 拿到 ACP runtime 句柄；本机 ACP 走 `src/process/agent/acp/**`（Electron 主进程 spawn CLI 子进程），远端走 aioncore。
2. **aionrs/Aion CLI** 走 aioncore 后端：`aionui-ai-agent::factory::aionrs::build` → `AionrsAgentManager::new` → 上游 `aion_agent` crate（`aionrs v0.1.38`）。
3. 上游 aionrs 解析 `Config`（provider / api_key / base_url / model / max_tokens / max_turns / max_tool_call_malformed_turns / max_tool_call_failure_turns），调 LLM provider，把 tool_use / function_call 事件经 `OutputSink` 投给 `BackendOutputSink` → `AgentStreamEvent` 广播。

## 二、可能的失败点（按概率排序）

### 1. 模型不支持 function-calling（最高概率，与 issue 描述吻合）

**证据**：

- `modelCapabilities.ts:15` `function_calling: /gpt-4|claude-3|gemini|qwen|deepseek/i` —— 仅按模型名正则匹配，**未把"智谱 glm"列入白名单**。智谱 GLM-4 / GLM-4.5 / GLM-4-Plus 支持 function-calling，但 fork 不识别。
- `factory/aionrs.rs:224` `map_aionrs_provider` 默认 fallback 到 `"openai"` —— 当 provider 平台是 `custom`/`zhipu`/`lms`/`new-api` 等非 anthropic/bedrock/vertex 平台时，aionrs 走 OpenAI 兼容协议（`/v1/chat/completions`）。
- 上游 aionrs 的 OpenAI 兼容协议分支会**主动发送 `tools` 字段**给 provider；如果模型本身不支持 function-calling，provider 会返回 400 / 500 / 空响应 → aionrs 收不到 `tool_use` 事件 → sink 不发 `tool_call` → 渲染层"无响应"（issue #3419 / #2648 描述）。

**用户复现定性方式**（**关键**）：换一个**明确支持 function-calling** 的模型（GPT-4o / Claude 3.5 / Gemini 1.5 Pro / Qwen-Max / DeepSeek-Chat），同 provider 配置下试 Aion CLI；如果能正常响应，则确认是模型能力问题，不是 fork bug。

### 2. `max_tool_call_malformed_turns` / `max_tool_call_failure_turns` 限制过严

**证据**：

- `factory/aionrs.rs:163-164` 默认从 `overrides` 传入；`agent.rs:141-142` 写入 CliArgs。
- `services/provider_health.rs:85-86` 健康检查用 `Some(1)`（容错仅 1 轮）。
- 上游 aionrs 行为：超过限制 → agent 终止 turn。某些 OpenAI 兼容 provider 偶发返回 malformed tool_call（字段缺失 / JSON 不合法），1 轮容错会立即失败 → 用户看到"卡死 / 无响应"（issue #3087）。

**修复方向**：调高到 3-5 轮；或在 `AionrsResolvedConfig` 默认值里放宽。

### 3. base_url 规范化导致 provider 404

**证据**：

- `factory/aionrs.rs:281` `normalize_aionrs_base_url` 仅剥离尾部 `/v1` 或 `/`。
- `factory/aionrs.rs:247` `is_full_url=true` 时 `compat.api_path = Some(String::new())` —— 把 api_path 设为**空字符串**而非 None。
- 用户 issue #3408 提到智谱报 `404 /v4/v1/chat/completions` —— 路径叠加两层（用户填的 `/v4` + aionrs 自动 `/v1/chat/completions`）。**`is_full_url` 开关是为此设计的**（issue #3514 提出），但用户如果**没开** `is_full_url`，base_url 带 `/v4` 就会被错误拼接。

**修复方向**：当 `base_url` 已含路径段（非空 path）且非 `/v1` 时，自动等同 `is_full_url=true`；或文档明确告知用户开启 `is_full_url`。

### 4. session resume 携带"孤儿" assistant tool_call 被严格 provider 拒绝

**证据**：

- `factory/aionrs.rs:107-152` resume session 时调 `sanitize_session_messages`，删掉"无匹配 tool_result 的 assistant tool_call"。
- 但注释提到 "Strict providers (Ollama-style, some OpenAI-compatible proxies) reject replayed assistants with `tool_calls != null` and `content == null`" —— 即使 sanitize 后，**如果 tool_result 存在但格式不对**，严格 provider 仍会拒绝。
- 用户 issue #3087（卡死 / 上下文大一点假死）可能与此相关。

### 5. ACP 协议层（CLI 子进程 fork 路径）——**与本任务 #15 关系小**

issue #3419 提到"Aion CLI no response"——需区分两种"Aion CLI"：

- **本机 ACP CLI 子进程**（claude/gemini/codex 等，由 `src/process/agent/acp/**` spawn）：fork 上游 ACP 2.0 协议层已迁移完成（见 CONTEXT 第十九轮 Phase 2 记录），主要 bug 已修。
- **aionrs（后端 LLM 调用）**：即上文分析。

issue #3419 在 macOS 远端 lms provider 上"Aion Cli no response" —— 大概率是 aionrs 路径（model 不支持 function-calling 或 base_url 拼接问题），不是 ACP 子进程路径。

## 三、建议的下一步

1. **用户侧定性**（必须）：换支持 function-calling 的模型复现，确认是模型能力问题还是 fork bug。
2. **fork 侧防御性改进**（无需复现即可做）：
   - 在 `modelCapabilities.ts:15` 把 `glm` / `glm-4` 加入 `function_calling` 正则；或在 provider 配置里加显式 `supports_function_calling` 字段。
   - 在 `factory/aionrs.rs` 当 `max_tool_call_malformed_turns` / `max_tool_call_failure_turns` 为 `None` 时给个默认值（3-5 轮而非 1）。
   - 在 `factory/aionrs.rs:281` `normalize_aionrs_base_url` 检测 path 非空时自动按 `is_full_url` 处理。
   - 在渲染层 AcpSendBox / 错误诊断里加"当前模型可能不支持 function-calling"提示（已有 `errorDiagnostics.ts`，可扩展）。

3. **日志增强**：在 `BackendOutputSink::emit_tool_call` / `emit_tool_result` 失败路径加 `tracing::warn`，让后端日志能看到"tool_use_id 为空被忽略"等静默失败（当前只在 `tracing::error` 级别打，但生产日志级别可能是 info）。

## 四、不做的事

- 不在本文档会话里改 aionrs 上游 crate（`aion_agent` v0.1.38 是 git 依赖，改需 fork 上游）。
- 不做运行时复现（需用户换模型定性后再决定方向）。
- 不改 `modelCapabilities.ts` 白名单（等用户复现确认后再改，避免误伤）。
