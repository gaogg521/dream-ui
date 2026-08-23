# 长 Write 工具调用被截断后静默丢失 —— 修复 + 留下的一个网关超时新坑

> **2026-07-21**。给后续 AI / 人类读的本轮完整交接。
> 承接 07-20 那轮 [`session-2026-07-20-truncation-fix-and-upstream-resync.zh-CN.md`](session-2026-07-20-truncation-fix-and-upstream-resync.zh-CN.md) 明确留下的遗留项："截断恰好发生在工具调用中途时，续写还是补不回来"——本轮把这条补上了。

---

## 0. 起因：聊天里"写完了"，磁盘上没有文件

用户反馈：用 kimi-k3 / glm-5-2（经内部网关 `litellm-internal.123u.com`，OpenAI 兼容协议）生成长文件（"写1000行python代码"）时，聊天记录里看着代码"写完了"，但目标文件从未出现在磁盘上。要求现场抓包定位，不满足于代码审查。

搭了一个本地转发代理，把涉事 provider 的 `base_url` 临时指向它，在 dev 环境实测复现，拿到了完整的真实请求/响应。机制比想象中更清楚：

1. 请求体里**从不带 `max_tokens`**——`aion-config::compat::ProviderCompat::openai_defaults()` 没有设置 `default_max_tokens`（对比 `anthropic_defaults()` 会设 `Some(128_000)`），OpenAI 兼容这条协议路径永远解析成 `None`。上游网关按自己的默认值兜底，实测是 **4096 completion tokens**。
2. 模型流式吐出一个巨大的 `Write` 工具调用（`content` 参数是整份文件）时，写到 4096 token 被硬截断（`finish_reason:"length"`），JSON 参数字符串截在文件内容中间。
3. `aion-providers::openai.rs` 的 SSE 解析里，`finish_reason=="length"` 分支**只设置了 `pending_done`，从未处理 `state.tool_calls`**——这个半截的 `Write` 调用连 `LlmEvent::ToolUse` 都没触发，直接在 `StreamState` 作用域结束时被扔掉。`aion-agent` 层压根不知道曾经有过一次工具调用。
4. `aion-agent::engine.rs::continue_truncated`（07-20 那次"有界续写"补丁引入）在续写轮里通过 `TurnKind::disable_tools()` **禁用工具**，注入"continue ... do not call any tools"。模型只能把"其实还没写完"的内容当纯文本继续吐——聊天记录看着像是把代码写完了，实际上从未再调用 `Write`，文件从始至终没有被创建。

`continue_truncated` 里那句 `debug!("dropped tool calls truncated mid-stream ...")` 对 OpenAI 这条路径其实是**死代码**——因为 `first.tool_calls` 在这条路径上早就是空的（真正携带半截参数的是 provider 层的 `ToolCallAccumulator`，还没等传到 `aion-agent` 就被丢了）。

---

## 1. aionrs 修复：两处

仓库：`aionrs-local`，`master` 分支，commit `33c2bd2`。

### 方案 1：给 OpenAI 兼容请求补一个合理的 `default_max_tokens`

`aion-config/src/compat.rs` 的 `openai_defaults()` 加一行：

```rust
default_max_tokens: Some(32_000),
```

这条路径本来就是打通的（`OpenAiProjector::project()` 早就在做 `request.max_tokens.or_else(|| compat.default_max_tokens_for_model(...))`），只是 OpenAI 兼容这条协议家族从没设过默认值。**没有碰** `1oneCore` 里那三处刻意把 `max_tokens` 锁死成 `None` 的地方（`factory/aionrs.rs`、`manager/aionrs/agent.rs`——对齐上游 #641，防止 standalone aionrs 配置泄漏进嵌入式运行时）；`compat.rs` 的 provider-family 级默认值正是为"调用方没给值"设计的兜底层，两者不冲突。

### 方案 2：工具调用被截断时，可见提示 + 保留工具重试

不做"续写半截 JSON 参数"这种复杂方案（要造流式局部 JSON 解析、给 Write 加 append 语义、处理 `file_path` 还没流出时不知道写哪的边界情况）。改成更简单、配合方案 1 之后大概率一次就成的做法：

1. **`aion-types::llm::LlmEvent`** 新增 `ToolCallTruncated { id, name }`——一个"这个工具调用被截断了，没有真的执行"的标记事件，不是正常 `ToolUse`。
2. **`aion-providers::openai.rs`** 的 `finish_reason=="length"` 分支：不再放任 `state.tool_calls` 被扔掉，逐个 drain 出来发 `ToolCallTruncated`。
3. **`aion-agent::stream.rs`** 的 `StreamOutcome` 新增 `truncated_tool_calls: Vec<(String, String)>` 字段；`consume_stream` 收集这个新事件。
4. **`aion-agent::engine.rs` 的 `run_inner`**：`TurnOutcome::Truncated(outcome)` 分支里，如果 `outcome.truncated_tool_calls` 非空——**不**走老的 `continue_truncated`（禁用工具续写纯文本），而是 `emit_info` 一条点名工具的可见提示，往历史里追加一条"上一次工具调用没有真正执行，请重新完整调用一次"的用户消息，然后 `continue` 外层循环——下一轮是完全**正常**的 `TurnKind::Normal`（工具照常开启）。纯文本被截断（没有工具调用）的场景完全不变，还是走原来的 `continue_truncated`。

**没有改 `Write` 工具本身**——重试就是从头整份重新调用一次，复用现成的原子覆盖写，不引入 append/offset 语义。

**范围说明**：Anthropic 原生协议路径（`anthropic_shared.rs`）的截断机制不同——它的 `content_block_stop` 会把半截 `input` 坍缩成 `{}` 再当成正常 `ToolUse` 发出，不是"直接丢弃"，是另一条相关但不同的缺口。⚠️**2026-07-21 晚些时候两次跟进已全部闭合**：①aionrs `34f827b` 补上了与本节 §2 同款的"连接中途断连、没走到终止事件就静默报成功"缺口（`process_anthropic_sse_stream` 现在没见到 `message_stop` 时返回 `FailedPartial`/`FailedEmpty`）；②aionrs `d309fb5` 补上了 `content_block_stop` 坍缩成 `{}` 这半个——现在区分「合法空参调用」与「被截断」（非空但解析失败→发 `ToolCallTruncated` 而非空参 `ToolUse`），并防御性地在 `message_delta` 收到 `max_tokens` 而 tool_use 块仍未闭合时补发 `ToolCallTruncated`；下游复用 `33c2bd2` 的可见提示+保留工具重试机制（协议无关),对 Anthropic/Vertex 一并生效。含 3 个 parse 级用例 + 1 个走真实 `/v1/messages` 的 wiremock e2e。至此 Anthropic 原生协议两半截断缺口全部闭合,详见 aionrs `CLAUDE.md` 第 10/11 条补丁。

### 验证

- `crates/aion-agent/tests/truncation_e2e.rs` 新增 `truncated_write_tool_call_recovers_via_retry_with_tools_enabled`：wiremock 模拟"第一轮 Write 调用被截断 + 第二轮完整重试"，断言截断当下文件不存在、截断提示确实被 emit、续写请求体里带 `tools`（证明走的是新分支不是老分支）、最终文件内容正确。
- `cargo test --workspace` / `cargo clippy --workspace --all-targets -- -D warnings` / `cargo fmt --all -- --check` 全部通过（`just` 未装，手工按 `Justfile` 的 `push` recipe 顺序跑的等价检查）。
- **实机复测**（不是只跑单测）：dev 环境（`%APPDATA%\1one-Dev`）重编嵌入新二进制后，用 CDP 登录桌面应用的 WebUI（端口 25809），拿 glm-5-2 重新发"写一个包含1000行代码的Python任务管理系统"——这次 `Write` 一次成功（`duration_ms:2`），磁盘上真实生成了 1560 行语法完整的文件，请求体里也确认带了 `max_tokens`。

---

## 2. 新发现、本轮**没有修**的问题：kimi-k3 长请求撞网关超时，同样静默失败

用 kimi-k3 测"写3000行"（一个纯控制台 RPG 游戏）时复现了**另一个**问题：

- kimi-k3 光"思考"就用了将近 4 分钟，整个请求跑了约 **10 分钟**（`duration_ms:595566`）
- `stream_diagnostics` 里确认网关确实吐出过 `finish_reason:"length"`，但紧接着连接直接 **EOF 断开**（`termination:"eof"`, `done_seen:false`, `incomplete_stream:true`），没等到收尾的 `[DONE]`
- 结果：整个 agent 运行以 `status:"finished"` 收场，**没有任何 ERROR 级别日志，聊天里也没有任何可见报错**，只停在"思考完成"那句话，什么也没写、没有触发本轮新加的截断提示（因为这次连 `finish_reason:"length"` 之后的正常收尾都没走到，是连接层面直接断了，不是 SSE 帧层面的干净截断）

**根因推测**：这更像是上游网关（Kong 代理）自己的读超时——过去 `default_max_tokens` 是隐式的 4096（本轮方案1修复的那个问题），大多数请求几分钟内就会撞上限提前结束，从来没机会跑到需要网关超时介入的时长。本轮把上限提到 32000 后，像 kimi-k3 这种慢速重推理模型现在有机会把单次请求拖到十分钟量级，从而撞上了这个此前被"跑得快"意外掩盖掉的边界情况。**不是本轮改动引入的新 bug，是本轮改动让一个本来就存在的潜在问题第一次有机会被触发。**

### 后续处理（同日另一会话已跟进,2026-07-21 21～22 点）

1. ✅ 确认 aionrs 的 HTTP 客户端（`reqwest::Client`，`aion-providers::transport.rs`）没有设置连接/读超时——`OpenAiTransport::new`/`AnthropicTransport::new` 两处都是 `reqwest::Client::new()`。**判定为不改**：这条路径要支持合法的 10+ 分钟长生成，笼统的总请求超时会把真实长流提前腰斩，风险大于收益。
2. ✅ **已修**（aionrs commit `45cce3a`，Anthropic 原生协议同款缺口另补于 `34f827b`，详见 CLAUDE.md 第 9/10 条补丁）：`stream_process.rs::process_openai_sse_stream` 此前无论有没有见到 `[DONE]` 终止帧，循环自然结束就一律返回 `StreamOutcome::Ok`——`finish_reason` 到达时暂存进 `state.pending_done`，但 `OpenAiParser::finish()` 是空实现从不 flush，于是网关中途断连时这条 Done 事件连同 `finish_reason` 直接被吞掉，agent 侧静默以 `finished` 收场。改法是照抄同文件里姊妹函数 `process_openai_responses_sse_stream` 已有的正确写法：EOF 未见终止帧时按 `emitted_content` 返回 `FailedPartial`（已出内容→`stream_runner` 转成可见 `LlmEvent::Error`）或 `FailedEmpty`（全空→走既有重试退避逻辑自动重发）。新增单测；`cargo clippy` / `cargo fmt --all -- --check` 均通过。
3. ✅ **2026-07-21 22 点左右已完成真机 CDP 复现验证**（用户主动要求补做）：1oneCore `cargo update` 对齐 aionrs `760d8b1` 并 `cargo build -p aionui-app --release` 重编、内嵌新 `aioncore.exe`、重启 dev 应用；CDP 直连渲染进程（端口 9230,`ws://127.0.0.1:9230/devtools/page/...`）模拟原生 DOM 操作发送 kimi-k3 消息「写一个纯控制台的贪吃蛇+俄罗斯方块+扫雷三合一小游戏，代码大约3000行」；**9 分 55 秒后真实复现**（`duration_ms:595137`，`termination:"eof"`，`done_seen:false`，`reasoning_delta_count:17565` 全程只在思考、`finish_reason:"length"` 已到达但没等到 `[DONE]`），修复前这种情况会静默收场；本次实测 UI 上出现**清晰可见的错误卡片**：「上游 Agent 或模型服务商出错」+「可重试」标签 + 技术详情 `Aionrs agent error: API error: Connection error: OpenAI stream ended without a terminal [DONE] event`——与修复代码里的错误文案完全吻合，确认端到端生效。复现方法记录供以后参考：kimi-k3 + 类似"写3000行"这种会让模型光思考就要好几分钟、总时长拖到 10 分钟量级的超大单文件请求。

---

## 3. 下游影响

- `1oneCore` 的 `aion-* = { git="gaogg521/aionrs", branch="master" }` 直接吃 `aionrs-local` 新 commit，已 `cargo update` 对齐到 `33c2bd22`，`backend-rebuild.ps1` 重编并内嵌验证过。
- 本轮改动全部在 `aionrs-local` 内，`1oneCore`/`1oneUI` 侧代码没有改动。
- ⚠️ 同日另一个并行会话在 [`session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md`](session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md) 里打了正式安装包 `v2.1.48` 并建了 GitHub Release——但那次重编依赖的版本 bump 提交（`6054185e`，15:30）早于本轮 1oneCore 对齐提交（`700e7f75`，20:22），**那个已打好的安装包大概率不含本轮这条修复**。如果要发布 `v2.1.48`，先看那份文档的「§8」再决定要不要重编。
